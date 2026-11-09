import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { pool } from "../config/database";
import { apiKeyMiddleware } from "../middleware/apikey";
import { authMiddleware } from "../middleware/auth";
import { HttpError, isAdminOrAbove, isSuper, isUuid } from "../services/tenant";
import {
  agentCommandFilter,
  enqueueOpenCommand,
  generateApiKey,
  hashApiKey,
  resolveDoor,
} from "../services/fechadura.service";

const router = Router();

function sendError(res: Response, err: any, fallback: string) {
  if (err instanceof HttpError) return res.status(err.status).json({ success: false, error: err.message });
  console.error(`[FECHADURAS] ${fallback}:`, err);
  return res.status(500).json({ success: false, error: fallback });
}

// ============================================
// POST /api/fechaduras/abrir-portal  (JWT auth — usado pelo portal do usuário)
// ============================================
const abrirPortalSchema = z.object({
  door_id: z.string().uuid().optional(),
  lock_id: z.number().int().positive().optional(),
  origem: z.string().max(30).optional().default("portal"),
}).refine((d) => d.door_id || d.lock_id, { message: "Informe door_id ou lock_id" });

router.post("/abrir-portal", authMiddleware, validate(abrirPortalSchema), async (req: Request, res: Response) => {
  const { door_id, lock_id, origem } = req.body;

  try {
    // Só portas ocupadas pela própria pessoa, na empresa dela
    const { rows: personRows } = await pool.query(
      `SELECT fc.id AS person_id, fc.company_id, ld.id AS door_id
       FROM funcionarios_clientes fc
       JOIN locker_doors ld ON ld.occupied_by_person = fc.id
       JOIN lockers l ON l.id = ld.locker_id AND l.company_id = fc.company_id
       WHERE fc.user_id = $1 AND ld.status = 'occupied'
         AND (($2::uuid IS NOT NULL AND ld.id = $2::uuid) OR ($2::uuid IS NULL AND ld.lock_id = $3))`,
      [req.user!.user_id, door_id || null, lock_id || null]
    );

    if (personRows.length === 0) {
      return res.status(403).json({ success: false, error: "Você não tem permissão para abrir esta fechadura." });
    }
    if (personRows.length > 1) {
      return res.status(409).json({ success: false, error: "Mais de uma porta sua usa esta fechadura. Informe door_id." });
    }

    const { person_id, company_id } = personRows[0];
    const target = await resolveDoor({ doorId: personRows[0].door_id, companyId: company_id });
    const commandId = await enqueueOpenCommand(target, origem || "portal", person_id);

    res.status(201).json({ success: true, message: "Comando enviado", id: commandId });
  } catch (err: any) {
    sendError(res, err, "Erro ao criar comando");
  }
});

// ============================================
// POST /api/fechaduras/abrir-admin  (JWT auth — usado pelo painel admin)
// Admin só abre fechaduras de armários da própria empresa.
// ============================================
const abrirAdminSchema = z.object({
  door_id: z.string().uuid().optional(),
  lock_id: z.number().int().positive().optional(),
  locker_id: z.string().uuid().optional(),
  origem: z.string().max(30).optional().default("painel"),
  company_id: z.string().uuid().optional(),
}).refine((d) => d.door_id || d.lock_id, { message: "Informe door_id ou lock_id" });

router.post("/abrir-admin", authMiddleware, validate(abrirAdminSchema), async (req: Request, res: Response) => {
  const { door_id, lock_id, locker_id, origem, company_id } = req.body;

  try {
    if (!isAdminOrAbove(req.user)) {
      return res.status(403).json({ success: false, error: "Acesso restrito a administradores." });
    }

    // Admin: sempre a própria empresa. Superadmin: company_id opcional.
    const companyId = isSuper(req.user) ? company_id || null : req.user!.company_id;
    const target = await resolveDoor({ doorId: door_id, lockId: lock_id, lockerId: locker_id, companyId });
    const personId = isUuid(target.occupied_by_person) ? target.occupied_by_person : null;

    const commandId = await enqueueOpenCommand(target, origem || "painel", personId);

    res.status(201).json({ success: true, message: "Comando enviado", id: commandId });
  } catch (err: any) {
    sendError(res, err, "Erro ao criar comando");
  }
});

// ============================================
// GET /api/fechaduras/meu-historico  (JWT auth — histórico do usuário logado)
// ============================================
router.get("/meu-historico", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT cf.id, cf.acao, cf.lock_id, cf.status, cf.resposta, cf.origem, cf.criado_em, cf.executado_em
       FROM comandos_fechadura cf
       WHERE EXISTS (
         SELECT 1 FROM locker_doors ld
         JOIN lockers l ON l.id = ld.locker_id
         JOIN funcionarios_clientes fc ON fc.id = ld.occupied_by_person
         WHERE fc.user_id = $1 AND l.company_id = cf.company_id
           AND (cf.door_id = ld.id OR (cf.door_id IS NULL AND ld.lock_id = cf.lock_id))
       )
       ORDER BY cf.criado_em DESC
       LIMIT 100`,
      [req.user!.user_id]
    );
    res.json(rows);
  } catch (err: any) {
    console.error("[FECHADURAS] Erro ao buscar histórico do usuário:", err);
    res.status(500).json({ error: "Erro ao buscar histórico" });
  }
});

// ============================================
// GET /api/fechaduras/historico-admin  (JWT auth — comandos da empresa / todos p/ superadmin)
// ============================================
router.get("/historico-admin", authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!isAdminOrAbove(req.user)) {
      return res.status(403).json({ error: "Acesso restrito a administradores." });
    }

    // Admin: sempre a própria empresa (ignora company_id da query)
    const companyId = isSuper(req.user)
      ? ((req.query.company_id as string | undefined) || null)
      : req.user!.company_id;

    const params: any[] = [];
    let where = "";
    if (companyId) {
      params.push(companyId);
      where = `WHERE cf.company_id = $1`;
    }

    const { rows } = await pool.query(
      `SELECT
         cf.id, cf.acao, cf.lock_id, cf.status, cf.resposta, cf.origem, cf.criado_em, cf.executado_em,
         d.door_number, d.door_label, d.locker_name, d.locker_location,
         COALESCE(cf.company_id, d.company_id) AS company_id,
         COALESCE(fc_cmd.nome, fc_door.nome) AS person_name,
         COALESCE(fc_cmd.tipo, fc_door.tipo) AS person_type,
         COALESCE(fc_cmd.matricula, fc_door.matricula) AS person_matricula
       FROM comandos_fechadura cf
       LEFT JOIN LATERAL (
         SELECT ld.door_number, ld.label AS door_label, ld.occupied_by_person,
                l.name AS locker_name, l.location AS locker_location, l.company_id
         FROM locker_doors ld JOIN lockers l ON l.id = ld.locker_id
         WHERE (cf.door_id IS NOT NULL AND ld.id = cf.door_id)
            OR (cf.door_id IS NULL AND ld.lock_id = cf.lock_id
                AND (cf.company_id IS NULL OR l.company_id = cf.company_id))
         LIMIT 1
       ) d ON true
       LEFT JOIN funcionarios_clientes fc_cmd ON fc_cmd.id = cf.person_id
       LEFT JOIN funcionarios_clientes fc_door ON fc_door.id = d.occupied_by_person
       ${where}
       ORDER BY cf.criado_em DESC LIMIT 1000`,
      params
    );

    res.json(rows);
  } catch (err: any) {
    console.error("[FECHADURAS] Erro ao listar histórico (admin):", err);
    res.status(500).json({ error: "Erro ao listar histórico" });
  }
});

// ============================================
// GET /api/fechaduras/status/:id  (JWT auth — polling do portal/painel)
// ============================================
router.get("/status/:id", authMiddleware, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const user = req.user!;
    let scope = "";
    const params: any[] = [id];
    if (!isSuper(user)) {
      if (user.role === "admin") {
        params.push(user.company_id);
        scope = ` AND company_id = $2`;
      } else {
        params.push(user.user_id);
        scope = ` AND person_id IN (SELECT id FROM funcionarios_clientes WHERE user_id = $2)`;
      }
    }

    const { rows } = await pool.query(
      `SELECT id, acao, lock_id, status, resposta, origem, criado_em, executado_em
       FROM comandos_fechadura WHERE id = $1${scope}`,
      params
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "Comando não encontrado" });
    }
    res.json(rows[0]);
  } catch (err: any) {
    console.error("[FECHADURAS] Erro ao consultar status:", err);
    res.status(500).json({ error: "Erro ao consultar status" });
  }
});

/**
 * Enfileira "abrir_tudo". Com companyId: só aquela empresa.
 * Sem companyId (todas): um comando por empresa com agente próprio + um para o agente global.
 */
async function enqueueAbrirTudo(companyId: string | null, origem: string): Promise<{ ids: number[]; total: number }> {
  const countParams: any[] = [];
  let countQuery = `SELECT COUNT(DISTINCT ld.lock_id) AS total
                    FROM locker_doors ld JOIN lockers l ON l.id = ld.locker_id
                    WHERE ld.lock_id IS NOT NULL`;
  if (companyId) {
    countParams.push(companyId);
    countQuery += ` AND l.company_id = $1`;
  }
  const { rows: countRows } = await pool.query(countQuery, countParams);
  const total = parseInt(countRows[0]?.total || "0", 10);
  if (total === 0) return { ids: [], total };

  const targets: (string | null)[] = [];
  if (companyId) {
    targets.push(companyId);
  } else {
    const { rows } = await pool.query(`SELECT DISTINCT company_id FROM fechadura_agentes WHERE ativo`);
    targets.push(...rows.map((r) => r.company_id), null);
  }

  const ids: number[] = [];
  for (const target of targets) {
    const { rows } = await pool.query(
      `INSERT INTO comandos_fechadura (acao, lock_id, status, origem, company_id)
       VALUES ('abrir_tudo', 0, 'pendente', $1, $2) RETURNING id`,
      [origem, target]
    );
    ids.push(rows[0].id);
  }
  return { ids, total };
}

// ============================================
// POST /api/fechaduras/emergencia  (JWT auth)
// superadmin: todas ou uma empresa; admin: apenas a própria empresa
// ============================================
router.post("/emergencia", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (!isAdminOrAbove(user)) {
      return res.status(403).json({ success: false, error: "Acesso restrito a administradores." });
    }

    const requested = req.body.company_id as string | undefined;
    if (!isSuper(user) && requested && requested !== user.company_id) {
      return res.status(403).json({ success: false, error: "Acesso restrito à sua empresa." });
    }
    const companyId = isSuper(user) ? requested || null : user.company_id;
    if (!isSuper(user) && !companyId) {
      return res.status(403).json({ success: false, error: "Usuário sem empresa vinculada." });
    }

    const { ids, total } = await enqueueAbrirTudo(companyId, "emergencia");
    if (ids.length === 0) {
      return res.status(404).json({ success: false, error: "Nenhuma fechadura encontrada para abertura." });
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, category, details, company_id)
       VALUES ($1, 'emergency_unlock_all', 'fechadura', 'seguranca', $2, $3)`,
      [
        user.user_id,
        JSON.stringify({ total_locks: total, command_ids: ids, company_id: companyId || "all", acao: "abrir_tudo" }),
        companyId,
      ]
    );

    console.warn(`[FECHADURAS] ⚠️ EMERGÊNCIA: ${user.email} (${user.role}) disparou abrir_tudo empresa=${companyId || "todas"} cmds=${ids.join(",")}`);

    res.status(201).json({
      success: true,
      message: `Comando de emergência (abrir_tudo) enviado. ~${total} fechadura(s) serão abertas pelo agente.`,
      total,
      command_id: ids[0],
      command_ids: ids,
    });
  } catch (err: any) {
    sendError(res, err, "Erro ao executar comando de emergência");
  }
});

// ============================================
// GET /api/fechaduras/agent-status  (JWT — painel Configurações → Fechaduras)
// Admin: agentes da própria empresa (ou o agente global, se a empresa não tiver um).
// ============================================
router.get("/agent-status", authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    let lastSeen: Date | null = null;
    let source = "global";

    const companyId = isSuper(user) ? (req.query.company_id as string | undefined) || null : user.company_id;
    if (companyId) {
      const { rows } = await pool.query(
        `SELECT MAX(last_seen_at) AS last_seen, COUNT(*)::int AS total
         FROM fechadura_agentes WHERE company_id = $1 AND ativo`,
        [companyId]
      );
      if (rows[0]?.total > 0) {
        source = "empresa";
        lastSeen = rows[0].last_seen ? new Date(rows[0].last_seen) : null;
        if (!lastSeen) {
          return res.json({ online: false, last_seen: null, source, message: "Agente da empresa nunca conectou." });
        }
      }
    }

    if (source === "global") {
      const { rows } = await pool.query(
        `SELECT value, updated_at FROM platform_settings WHERE key = 'agent_last_heartbeat'`
      );
      if (!rows[0]) {
        return res.json({ online: false, last_seen: null, source, message: "Agente nunca conectou." });
      }
      lastSeen = new Date(rows[0].value?.replace?.(/"/g, "") || rows[0].updated_at);
    }

    const diffSeconds = Math.floor((Date.now() - lastSeen!.getTime()) / 1000);
    const online = diffSeconds < 30; // online se fez polling nos últimos 30s

    res.json({
      online,
      source,
      last_seen: lastSeen!.toISOString(),
      seconds_ago: diffSeconds,
      message: online
        ? "Agente online e consumindo comandos."
        : `Agente offline há ${diffSeconds > 60 ? Math.floor(diffSeconds / 60) + " minuto(s)" : diffSeconds + " segundo(s)"}.`,
    });
  } catch (err: any) {
    console.error("[FECHADURAS] Erro ao consultar status do agente:", err);
    res.status(500).json({ online: false, error: "Erro ao consultar status" });
  }
});

// ============================================
// Chaves de API por empresa (JWT — admin da empresa / superadmin)
// ============================================
function agentesCompany(req: Request): string | null {
  const user = req.user!;
  if (!isSuper(user)) return user.company_id;
  return (req.body?.company_id || req.query.company_id || null) as string | null;
}

// GET /api/fechaduras/agentes
router.get("/agentes", authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!isAdminOrAbove(req.user)) return res.status(403).json({ error: "Acesso restrito a administradores." });
    const companyId = agentesCompany(req);
    const { rows } = await pool.query(
      `SELECT a.id, a.company_id, c.name AS company_name, a.nome, a.key_prefix, a.ativo,
              a.last_seen_at, a.created_at, a.revoked_at
       FROM fechadura_agentes a JOIN companies c ON c.id = a.company_id
       WHERE ($1::uuid IS NULL OR a.company_id = $1::uuid)
       ORDER BY a.ativo DESC, a.created_at DESC`,
      [companyId]
    );
    res.json(rows);
  } catch (err: any) {
    console.error("[FECHADURAS] Erro ao listar agentes:", err);
    res.status(500).json({ error: "Erro ao listar agentes" });
  }
});

// POST /api/fechaduras/agentes  → gera uma nova chave (exibida uma única vez)
const criarAgenteSchema = z.object({
  nome: z.string().trim().min(1).max(100).optional().default("Agente"),
  company_id: z.string().uuid().optional(),
});

router.post("/agentes", authMiddleware, validate(criarAgenteSchema), async (req: Request, res: Response) => {
  try {
    if (!isAdminOrAbove(req.user)) return res.status(403).json({ error: "Acesso restrito a administradores." });
    if (!isSuper(req.user) && req.body.company_id && req.body.company_id !== req.user!.company_id) {
      return res.status(403).json({ error: "Acesso restrito à sua empresa." });
    }
    const companyId = agentesCompany(req);
    if (!companyId) return res.status(400).json({ error: "Informe company_id." });

    const apiKey = generateApiKey();
    const { rows } = await pool.query(
      `INSERT INTO fechadura_agentes (company_id, nome, api_key_hash, key_prefix, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, company_id, nome, key_prefix, ativo, created_at`,
      [companyId, req.body.nome, hashApiKey(apiKey), apiKey.slice(0, 12), req.user!.user_id]
    );

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, category, details, company_id)
       VALUES ($1, 'lock_agent_key_created', 'fechadura_agente', $2, 'seguranca', $3, $4)`,
      [req.user!.user_id, rows[0].id, JSON.stringify({ nome: req.body.nome, key_prefix: rows[0].key_prefix }), companyId]
    );

    res.status(201).json({ ...rows[0], api_key: apiKey });
  } catch (err: any) {
    console.error("[FECHADURAS] Erro ao criar agente:", err);
    res.status(500).json({ error: "Erro ao criar chave do agente" });
  }
});

// DELETE /api/fechaduras/agentes/:id  → revoga a chave
router.delete("/agentes/:id", authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!isAdminOrAbove(req.user)) return res.status(403).json({ error: "Acesso restrito a administradores." });
    if (!isUuid(req.params.id)) return res.status(404).json({ error: "Agente não encontrado" });

    const scoped = !isSuper(req.user);
    const { rows } = await pool.query(
      `UPDATE fechadura_agentes SET ativo = false, revoked_at = NOW()
       WHERE id = $1 ${scoped ? "AND company_id = $2" : ""} RETURNING id, company_id`,
      scoped ? [req.params.id, req.user!.company_id] : [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Agente não encontrado" });

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, category, details, company_id)
       VALUES ($1, 'lock_agent_key_revoked', 'fechadura_agente', $2, 'seguranca', '{}', $3)`,
      [req.user!.user_id, rows[0].id, rows[0].company_id]
    );

    res.json({ message: "Chave revogada" });
  } catch (err: any) {
    console.error("[FECHADURAS] Erro ao revogar agente:", err);
    res.status(500).json({ error: "Erro ao revogar chave" });
  }
});

// ============================================
// Rotas do agente IoT — exigem API Key (por empresa ou global)
// ============================================
router.use(apiKeyMiddleware);

// POST /api/fechaduras/abrir-tudo  (protocolo do agente Python: acao "abrir_tudo", lock_id 0)
router.post("/abrir-tudo", async (req: Request, res: Response) => {
  try {
    const agente = req.agente!;
    const { ids, total } = await enqueueAbrirTudo(agente.global ? null : agente.company_id, "emergencia");
    if (ids.length === 0) {
      return res.status(404).json({ success: false, error: "Nenhuma fechadura encontrada para abertura." });
    }

    await pool.query(
      `INSERT INTO audit_logs (action, resource_type, category, details, company_id)
       VALUES ('emergency_unlock_all', 'fechadura', 'seguranca', $1, $2)`,
      [
        JSON.stringify({ total_locks: total, command_ids: ids, acao: "abrir_tudo", via: "api_key", agente_id: agente.id }),
        agente.company_id,
      ]
    );

    console.warn(`[FECHADURAS] ⚠️ EMERGÊNCIA via API Key (empresa=${agente.company_id || "global"}): cmds=${ids.join(",")}`);

    res.status(201).json({
      success: true,
      message: `Comando de emergência (abrir_tudo) enviado. ~${total} fechadura(s) serão abertas pelo agente.`,
      total,
      command_id: ids[0],
    });
  } catch (err: any) {
    sendError(res, err, "Erro ao executar comando de emergência");
  }
});

// POST /api/fechaduras/abrir
const abrirSchema = z.object({
  door_id: z.string().uuid().optional(),
  lock_id: z.number().int().positive().optional(),
  locker_id: z.string().uuid().optional(),
  origem: z.string().max(30).optional().default("web"),
}).refine((d) => d.door_id || d.lock_id, { message: "Informe door_id ou lock_id" });

router.post("/abrir", validate(abrirSchema), async (req: Request, res: Response) => {
  const { door_id, lock_id, locker_id, origem } = req.body;
  try {
    const agente = req.agente!;
    const target = await resolveDoor({
      doorId: door_id,
      lockId: lock_id,
      lockerId: locker_id,
      companyId: agente.global ? null : agente.company_id,
    });
    const id = await enqueueOpenCommand(target, origem || "web", null);
    res.status(201).json({ success: true, message: "Comando enviado", id });
  } catch (err: any) {
    sendError(res, err, "Erro ao criar comando");
  }
});

// ============================================
// GET /api/fechaduras/comandos — próximo pendente do agente (atomic)
router.get("/comandos", async (req: Request, res: Response) => {
  try {
    const agente = req.agente!;

    // Heartbeat
    const heartbeat = agente.global
      ? pool.query(
          `INSERT INTO platform_settings (key, value)
           VALUES ('agent_last_heartbeat', to_jsonb(now()::text))
           ON CONFLICT (key) DO UPDATE SET value = to_jsonb(now()::text), updated_at = NOW()`
        )
      : pool.query(`UPDATE fechadura_agentes SET last_seen_at = NOW() WHERE id = $1`, [agente.id]);
    await heartbeat.catch((e: any) => console.warn("[FECHADURAS] Falha ao registrar heartbeat:", e.message));

    const filter = agentCommandFilter(agente, 1);
    const { rows } = await pool.query(
      `UPDATE comandos_fechadura
       SET status = 'executando'
       WHERE id = (
         SELECT cf.id FROM comandos_fechadura cf
         WHERE cf.status = 'pendente' AND ${filter.sql}
         ORDER BY cf.id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, acao, lock_id, company_id, locker_id`,
      filter.params
    );

    if (!rows[0]) {
      return res.json({ status: "vazio" });
    }

    // Placa do armário EXATO da porta (locker_id gravado no comando).
    // Comandos antigos (sem locker_id) só são enriquecidos se o lock_id for inequívoco na empresa.
    const { company_id, locker_id, ...cmd } = rows[0];
    let boardRows: any[] = [];
    if (cmd.acao === "abrir_tudo") {
      const { rows: boards } = await pool.query(
        `SELECT DISTINCT COALESCE(board_address, '') AS board_address, COALESCE(board_port, 4370) AS board_port
         FROM lockers l
         WHERE ($1::uuid IS NOT NULL AND l.company_id = $1::uuid)
            OR ($1::uuid IS NULL AND NOT EXISTS (
                  SELECT 1 FROM fechadura_agentes a WHERE a.company_id = l.company_id AND a.ativo))`,
        [company_id]
      );
      cmd.boards = boards; // placas da empresa (agente pode usar em vez de varrer a rede)
    } else if (locker_id) {
      ({ rows: boardRows } = await pool.query(
        `SELECT board_address, board_port FROM lockers WHERE id = $1`,
        [locker_id]
      ));
    } else {
      const { rows: legacy } = await pool.query(
        `SELECT l.board_address, l.board_port
         FROM locker_doors ld JOIN lockers l ON l.id = ld.locker_id
         WHERE ld.lock_id = $1 AND ($2::uuid IS NULL OR l.company_id = $2::uuid)`,
        [cmd.lock_id, company_id]
      );
      if (legacy.length === 1) boardRows = legacy;
      else console.warn(`[FECHADURAS] Comando legado #${cmd.id} com lock_id ${cmd.lock_id} ambíguo (${legacy.length} portas) — enviado sem placa.`);
    }

    if (boardRows[0]) {
      cmd.board_address = boardRows[0].board_address || "";
      cmd.board_port = boardRows[0].board_port || 4370;
    }

    res.json(cmd);
  } catch (err: any) {
    console.error("[FECHADURAS] Erro ao buscar comando:", err);
    res.status(500).json({ error: "Erro ao buscar comando pendente" });
  }
});

// POST /api/fechaduras/concluir
const concluirSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["executado", "erro"]),
  resposta: z.string().max(500).optional().default(""),
});

router.post("/concluir", validate(concluirSchema), async (req: Request, res: Response) => {
  const { id, status, resposta } = req.body;
  try {
    const filter = agentCommandFilter(req.agente!, 4);
    const { rowCount } = await pool.query(
      `UPDATE comandos_fechadura cf
       SET status = $1, resposta = $2, executado_em = NOW()
       WHERE cf.id = $3 AND cf.status = 'executando' AND ${filter.sql}`,
      [status, resposta || "", id, ...filter.params]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: "Comando não encontrado ou já finalizado" });
    }
    res.json({ success: true, message: "Comando finalizado" });
  } catch (err: any) {
    sendError(res, err, "Erro ao finalizar comando");
  }
});

// GET /api/fechaduras/historico
router.get("/historico", async (req: Request, res: Response) => {
  try {
    const filter = agentCommandFilter(req.agente!, 1);
    const { rows } = await pool.query(
      `SELECT cf.id, cf.acao, cf.lock_id, cf.status, cf.resposta, cf.origem, cf.criado_em, cf.executado_em
       FROM comandos_fechadura cf
       WHERE ${filter.sql}
       ORDER BY cf.criado_em DESC
       LIMIT 50`,
      filter.params
    );
    res.json(rows);
  } catch (err: any) {
    console.error("[FECHADURAS] Erro ao listar histórico:", err);
    res.status(500).json({ error: "Erro ao listar histórico" });
  }
});

export { router as fechadurasRouter };
