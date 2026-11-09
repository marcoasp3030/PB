import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { pool } from "../config/database";
import { authMiddleware } from "../middleware/auth";
import { enqueueOpenCommand, resolveDoor } from "../services/fechadura.service";
import { HttpError } from "../services/tenant";

const router = Router();

// ============================================
// GET /api/mobile/version — Versão da API (público, sem auth)
// ============================================
const API_VERSION = {
  api_version: "1.0.0",
  min_app_version: "1.0.0",
  force_update: false,
  changelog: "Versão inicial da API mobile",
  updated_at: "2026-04-03",
};

router.get("/version", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'mobile_api_version' LIMIT 1`
    );

    const config = rows[0]?.value || API_VERSION;

    res.json({ success: true, data: config });
  } catch {
    res.json({ success: true, data: API_VERSION });
  }
});

// ============================================
// GET /api/mobile/theme/:companyId — Tema/cores da empresa (público, sem auth)
// Usado pelo app Flutter na tela de login e inicialização
// ============================================
router.get("/theme/:companyId", async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;

    // 1. Cores globais da plataforma (platform_settings)
    const { rows: globalColors } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'theme_colors' LIMIT 1`
    );

    // 2. Branding específico da empresa (company_branding)
    const { rows: companyBranding } = await pool.query(
      `SELECT logo_url, sidebar_logo_url, favicon_url, platform_name, login_title, login_subtitle, login_bg_url, theme_colors
       FROM company_branding WHERE company_id = $1 LIMIT 1`,
      [companyId]
    );

    // 3. Imagens globais (logo, favicon, login_bg)
    const { rows: globalImages } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'images' LIMIT 1`
    );

    // 4. Branding global (platform_name, login_title, etc.)
    const { rows: globalBranding } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'branding' LIMIT 1`
    );

    const platformColors = globalColors[0]?.value || {};
    const companyColors = companyBranding[0]?.theme_colors || {};

    // Mesclar: empresa sobrescreve plataforma
    const mergedColors = { ...platformColors, ...companyColors };

    const cb = companyBranding[0] || {};
    const globalImg = globalImages[0]?.value || {};
    const globalBrand = globalBranding[0]?.value || {};

    res.json({
      success: true,
      data: {
        theme_colors: mergedColors,
        logo_url: cb.logo_url || globalImg.logo_url || null,
        sidebar_logo_url: cb.sidebar_logo_url || globalImg.sidebar_logo_url || null,
        favicon_url: cb.favicon_url || globalImg.favicon_url || null,
        login_bg_url: cb.login_bg_url || globalImg.login_bg_url || null,
        platform_name: cb.platform_name || globalBrand.platform_name || "PBlocker",
        login_title: cb.login_title || globalBrand.login_title || "",
        login_subtitle: cb.login_subtitle || globalBrand.login_subtitle || "",
      },
    });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao buscar tema:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar tema" });
  }
});

// ============================================
// GET /api/mobile/theme — Tema global da plataforma (público, sem auth)
// Usado quando o app não sabe o company_id ainda
// ============================================
router.get("/theme", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM platform_settings WHERE key IN ('theme_colors', 'branding', 'images')`
    );

    const result: Record<string, any> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }

    res.json({
      success: true,
      data: {
        theme_colors: result.theme_colors || {},
        logo_url: result.images?.logo_url || null,
        platform_name: result.branding?.platform_name || "PBlocker",
        login_title: result.branding?.login_title || "",
        login_subtitle: result.branding?.login_subtitle || "",
        login_bg_url: result.images?.login_bg_url || null,
      },
    });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao buscar tema global:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar tema" });
  }
});

// Todas as rotas abaixo exigem JWT
router.use(authMiddleware);

// ============================================
// GET /api/mobile/me — Perfil completo do usuário
// ============================================
router.get("/me", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    const { rows: personRows } = await pool.query(
      `SELECT fc.id, fc.nome, fc.cargo, fc.tipo, fc.company_id, fc.email, fc.telefone,
              fc.matricula, fc.avatar_url, fc.notification_email, fc.notification_whatsapp,
              fc.notification_expiry, fc.notification_renewal,
              c.name AS company_name
       FROM funcionarios_clientes fc
       JOIN companies c ON c.id = fc.company_id
       WHERE fc.user_id = $1`,
      [userId]
    );

    if (!personRows[0]) {
      return res.status(404).json({ success: false, error: "Perfil não encontrado" });
    }

    const person = personRows[0];

    // Buscar configurações do app para esta empresa
    const { rows: appSettings } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = $1 LIMIT 1`,
      [`app_features_${person.company_id}`]
    );

    const features = appSettings[0]?.value || {};

    res.json({
      success: true,
      data: {
        person,
        app_features: features,
      },
    });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao buscar perfil:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar perfil" });
  }
});

// ============================================
// GET /api/mobile/portas — Portas vinculadas ao usuário
// ============================================
router.get("/portas", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    const { rows: personRows } = await pool.query(
      `SELECT id, company_id FROM funcionarios_clientes WHERE user_id = $1`,
      [userId]
    );

    if (!personRows[0]) {
      return res.json({ success: true, data: [] });
    }

    const personId = personRows[0].id;

    const { rows: doors } = await pool.query(
      `SELECT ld.id, ld.door_number, ld.label, ld.size, ld.status, ld.expires_at,
              ld.occupied_at, ld.usage_type, ld.lock_id,
              l.name AS locker_name, l.location AS locker_location
       FROM locker_doors ld
       JOIN lockers l ON l.id = ld.locker_id
       WHERE ld.occupied_by_person = $1`,
      [personId]
    );

    res.json({ success: true, data: doors });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao buscar portas:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar portas" });
  }
});

// ============================================
// POST /api/mobile/abrir — Abrir fechadura vinculada
// Aceita lock_id/lockId ou door_id/doorId para compatibilidade com apps Flutter
// ============================================
const abrirSchema = z.object({
  lock_id: z.coerce.number().int().positive().optional(),
  lockId: z.coerce.number().int().positive().optional(),
  door_id: z.string().uuid().optional(),
  doorId: z.string().uuid().optional(),
  origem: z.string().trim().max(30).optional(),
}).superRefine((data, ctx) => {
  if (!data.lock_id && !data.lockId && !data.door_id && !data.doorId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe lock_id ou door_id para abrir a fechadura.",
      path: ["lock_id"],
    });
  }
});

router.post("/abrir", validate(abrirSchema), async (req: Request, res: Response) => {
  const requestedLockId = req.body.lock_id ?? req.body.lockId ?? null;
  const requestedDoorId = req.body.door_id ?? req.body.doorId ?? null;
  const origem = req.body.origem?.trim() || "app";

  try {
    const userId = req.user?.user_id;

    const { rows: personRows } = await pool.query(
      `SELECT fc.id AS person_id, fc.company_id, ld.id AS door_id, ld.lock_id, ld.status
       FROM funcionarios_clientes fc
       JOIN locker_doors ld ON ld.occupied_by_person = fc.id
       JOIN lockers l ON l.id = ld.locker_id AND l.company_id = fc.company_id
       WHERE fc.user_id = $1
         AND (
           ($2::uuid IS NOT NULL AND ld.id = $2::uuid)
           OR ($2::uuid IS NULL AND ld.lock_id = $3)
         )
       ORDER BY CASE
         WHEN ld.status = 'occupied' THEN 0
         WHEN ld.status = 'reserved' THEN 1
         ELSE 2
       END,
       ld.updated_at DESC
       LIMIT 2`,
      [userId, requestedDoorId, requestedLockId]
    );

    if (personRows.length === 0) {
      return res.status(403).json({ success: false, error: "Você não tem permissão para abrir esta fechadura." });
    }

    const door = personRows[0];

    if (!door.lock_id) {
      return res.status(422).json({ success: false, error: "Esta porta ainda não possui lock_id configurado." });
    }
    if (!requestedDoorId && personRows.length > 1) {
      return res.status(409).json({ success: false, error: "Mais de uma porta sua usa esta fechadura. Informe door_id." });
    }

    if (!["occupied", "reserved"].includes(door.status)) {
      return res.status(409).json({
        success: false,
        error: `A porta vinculada não está disponível para abertura no momento (status: ${door.status}).`,
      });
    }

    const target = await resolveDoor({ doorId: door.door_id, companyId: door.company_id });
    const commandId = await enqueueOpenCommand(target, origem, door.person_id);

    console.log(
      `[MOBILE] Comando de abertura criado: cmd=#${commandId} lock_id=${door.lock_id} door=${door.door_id} person=${door.person_id} origem=${origem}`
    );

    res.status(201).json({
      success: true,
      message: "Comando enviado",
      id: commandId,
      lock_id: door.lock_id,
      door_id: door.door_id,
    });
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ success: false, error: err.message });
    console.error("[MOBILE] Erro ao criar comando:", err);
    res.status(500).json({ success: false, error: "Erro ao criar comando" });
  }
});

// ============================================
// GET /api/mobile/comando/:id — Status de um comando
// ============================================
router.get("/comando/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, error: "ID inválido" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, acao, lock_id, status, resposta, origem, criado_em, executado_em
       FROM comandos_fechadura
       WHERE id = $1 AND person_id IN (SELECT id FROM funcionarios_clientes WHERE user_id = $2)`,
      [id, req.user?.user_id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, error: "Comando não encontrado" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao consultar comando:", err);
    res.status(500).json({ success: false, error: "Erro ao consultar comando" });
  }
});

// ============================================
// GET /api/mobile/historico — Histórico de comandos do usuário
// ============================================
router.get("/historico", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    // Comandos das fechaduras ocupadas pelo usuário, sempre na empresa dele
    const doorsCte = `
      WITH minhas AS (
        SELECT ld.id AS door_id, ld.lock_id, ld.label, ld.door_number, l.name, l.location, l.company_id
        FROM locker_doors ld
        JOIN lockers l ON l.id = ld.locker_id
        JOIN funcionarios_clientes fc ON fc.id = ld.occupied_by_person AND fc.company_id = l.company_id
        WHERE fc.user_id = $1 AND ld.lock_id IS NOT NULL
      )`;

    const { rows } = await pool.query(
      `${doorsCte}
       SELECT cf.id, cf.acao, cf.lock_id, cf.status, cf.resposta, cf.origem,
              cf.criado_em, cf.executado_em,
              COALESCE(m.label, 'Porta ' || m.door_number) AS door_label,
              m.door_number,
              m.name AS locker_name,
              m.location AS locker_location
       FROM comandos_fechadura cf
       JOIN minhas m ON m.company_id = cf.company_id
        AND (cf.door_id = m.door_id OR (cf.door_id IS NULL AND m.lock_id = cf.lock_id))
       ORDER BY cf.criado_em DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `${doorsCte}
       SELECT COUNT(*)::int AS total
       FROM comandos_fechadura cf
       JOIN minhas m ON m.company_id = cf.company_id
        AND (cf.door_id = m.door_id OR (cf.door_id IS NULL AND m.lock_id = cf.lock_id))`,
      [userId]
    );

    res.json({ success: true, data: rows, total: countRows[0]?.total || 0 });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao buscar histórico:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar histórico" });
  }
});

// ============================================
// GET /api/mobile/notificacoes — Notificações do usuário
// ============================================
router.get("/notificacoes", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const unreadOnly = req.query.unread === "true";

    let query = `SELECT id, title, message, type, read, created_at FROM notifications WHERE user_id = $1`;
    const params: any[] = [userId];

    if (unreadOnly) {
      query += ` AND read = false`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(query, params);

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id = $1 AND read = false`,
      [userId]
    );

    res.json({ success: true, data: rows, unread_count: countRows[0]?.unread_count || 0 });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao buscar notificações:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar notificações" });
  }
});

// ============================================
// PUT /api/mobile/notificacoes/:id/lida — Marcar como lida
// ============================================
router.put("/notificacoes/:id/lida", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { id } = req.params;

    const { rowCount } = await pool.query(
      `UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: "Notificação não encontrada" });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao marcar notificação:", err);
    res.status(500).json({ success: false, error: "Erro ao atualizar notificação" });
  }
});

// ============================================
// POST /api/mobile/renovacao — Solicitar renovação
// ============================================
const renovacaoSchema = z.object({
  door_id: z.string().uuid(),
  requested_hours: z.number().int().min(1).max(720),
});

router.post("/renovacao", validate(renovacaoSchema), async (req: Request, res: Response) => {
  const { door_id, requested_hours } = req.body;

  try {
    const userId = req.user?.user_id;

    const { rows: personRows } = await pool.query(
      `SELECT fc.id, fc.company_id FROM funcionarios_clientes fc
       JOIN locker_doors ld ON ld.occupied_by_person = fc.id
       WHERE fc.user_id = $1 AND ld.id = $2`,
      [userId, door_id]
    );

    if (personRows.length === 0) {
      return res.status(403).json({ success: false, error: "Porta não vinculada ao seu perfil." });
    }

    const { id: personId, company_id } = personRows[0];

    // Verificar se já existe solicitação pendente
    const { rows: existing } = await pool.query(
      `SELECT id FROM renewal_requests WHERE person_id = $1 AND door_id = $2 AND status = 'pending'`,
      [personId, door_id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: "Já existe uma solicitação pendente para esta porta." });
    }

    const { rows } = await pool.query(
      `INSERT INTO renewal_requests (person_id, door_id, company_id, requested_hours)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [personId, door_id, company_id, requested_hours]
    );

    res.status(201).json({ success: true, message: "Solicitação enviada", id: rows[0].id });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao solicitar renovação:", err);
    res.status(500).json({ success: false, error: "Erro ao solicitar renovação" });
  }
});

// ============================================
// GET /api/mobile/renovacoes — Listar solicitações
// ============================================
router.get("/renovacoes", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    const { rows } = await pool.query(
      `SELECT rr.id, rr.door_id, rr.status, rr.requested_hours, rr.admin_notes, rr.created_at,
              ld.door_number, ld.label AS door_label
       FROM renewal_requests rr
       JOIN funcionarios_clientes fc ON fc.id = rr.person_id
       LEFT JOIN locker_doors ld ON ld.id = rr.door_id
       WHERE fc.user_id = $1
       ORDER BY rr.created_at DESC
       LIMIT 50`,
      [userId]
    );

    res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao listar renovações:", err);
    res.status(500).json({ success: false, error: "Erro ao listar renovações" });
  }
});

// ============================================
// POST /api/mobile/liberar — Devolver/liberar porta
// ============================================
const liberarSchema = z.object({
  door_id: z.string().uuid(),
});

router.post("/liberar", validate(liberarSchema), async (req: Request, res: Response) => {
  const { door_id } = req.body;

  try {
    const userId = req.user?.user_id;

    const { rows: personRows } = await pool.query(
      `SELECT fc.id FROM funcionarios_clientes fc
       JOIN locker_doors ld ON ld.occupied_by_person = fc.id
       WHERE fc.user_id = $1 AND ld.id = $2 AND ld.usage_type = 'temporary'`,
      [userId, door_id]
    );

    if (personRows.length === 0) {
      return res.status(403).json({ success: false, error: "Porta não vinculada ou não é temporária." });
    }

    const personId = personRows[0].id;

    // Liberar porta
    await pool.query(
      `UPDATE locker_doors SET status = 'available', occupied_by = NULL, occupied_by_person = NULL,
       occupied_at = NULL, expires_at = NULL WHERE id = $1`,
      [door_id]
    );

    // Encerrar reserva ativa
    await pool.query(
      `UPDATE locker_reservations SET status = 'released', released_at = NOW()
       WHERE door_id = $1 AND person_id = $2 AND status = 'active'`,
      [door_id, personId]
    );

    console.log(`[MOBILE] Porta liberada: door=${door_id} person=${personId}`);

    res.json({ success: true, message: "Porta liberada com sucesso" });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao liberar porta:", err);
    res.status(500).json({ success: false, error: "Erro ao liberar porta" });
  }
});

// ============================================
// PUT /api/mobile/perfil — Atualizar dados do perfil
// ============================================
const perfilSchema = z.object({
  telefone: z.string().max(20).optional(),
  notification_email: z.boolean().optional(),
  notification_whatsapp: z.boolean().optional(),
  notification_expiry: z.boolean().optional(),
  notification_renewal: z.boolean().optional(),
});

router.put("/perfil", validate(perfilSchema), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const updates = req.body;

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        setClauses.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, error: "Nenhum campo para atualizar" });
    }

    params.push(userId);
    await pool.query(
      `UPDATE funcionarios_clientes SET ${setClauses.join(", ")}, updated_at = NOW() WHERE user_id = $${paramIndex}`,
      params
    );

    res.json({ success: true, message: "Perfil atualizado" });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao atualizar perfil:", err);
    res.status(500).json({ success: false, error: "Erro ao atualizar perfil" });
  }
});

// ============================================
// GET /api/mobile/config — Configurações gerais do app
// ============================================
router.get("/config", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    const { rows: personRows } = await pool.query(
      `SELECT company_id FROM funcionarios_clientes WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (!personRows[0]) {
      return res.json({ success: true, data: {} });
    }

    const companyId = personRows[0].company_id;

    // Buscar features do app para esta empresa
    const { rows: settings } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = $1 LIMIT 1`,
      [`app_features_${companyId}`]
    );

    // Buscar branding da empresa
    const { rows: branding } = await pool.query(
      `SELECT logo_url, sidebar_logo_url, favicon_url, platform_name, login_title, login_subtitle, login_bg_url, theme_colors FROM company_branding WHERE company_id = $1 LIMIT 1`,
      [companyId]
    );

    // Buscar cores globais da plataforma
    const { rows: globalColors } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'theme_colors' LIMIT 1`
    );
    const { rows: globalImages } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'images' LIMIT 1`
    );
    const { rows: globalBrand } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'branding' LIMIT 1`
    );

    const platformColors = globalColors[0]?.value || {};
    const companyColors = branding[0]?.theme_colors || {};
    const mergedColors = { ...platformColors, ...companyColors };
    const globalImg = globalImages[0]?.value || {};
    const globalBr = globalBrand[0]?.value || {};
    const cb = branding[0] || {};

    res.json({
      success: true,
      data: {
        features: settings[0]?.value || {},
        branding: {
          logo_url: cb.logo_url || globalImg.logo_url || null,
          sidebar_logo_url: cb.sidebar_logo_url || globalImg.sidebar_logo_url || null,
          platform_name: cb.platform_name || globalBr.platform_name || "PBlocker",
          theme_colors: mergedColors,
          login_title: cb.login_title || globalBr.login_title || "",
          login_subtitle: cb.login_subtitle || globalBr.login_subtitle || "",
          login_bg_url: cb.login_bg_url || globalImg.login_bg_url || null,
        },
      },
    });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao buscar configuração:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar configuração" });
  }
});

// ============================================
// GET /api/mobile/reservas — Histórico de reservas do usuário
// ============================================
router.get("/reservas", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    const { rows: personRows } = await pool.query(
      `SELECT id FROM funcionarios_clientes WHERE user_id = $1`,
      [userId]
    );

    if (!personRows[0]) {
      return res.json({ success: true, data: [] });
    }

    const personId = personRows[0].id;

    const { rows } = await pool.query(
      `SELECT lr.id, lr.starts_at, lr.expires_at, lr.released_at, lr.status, lr.usage_type,
              lr.renewed_count, lr.notes, lr.created_at, lr.door_id, lr.locker_id,
              ld.door_number, ld.label AS door_label, ld.size AS door_size,
              l.name AS locker_name, l.location AS locker_location
       FROM locker_reservations lr
       LEFT JOIN locker_doors ld ON ld.id = lr.door_id
       LEFT JOIN lockers l ON l.id = lr.locker_id
       WHERE lr.person_id = $1
       ORDER BY lr.created_at DESC
       LIMIT 100`,
      [personId]
    );

    res.json({ success: true, data: rows });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao buscar reservas:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar reservas" });
  }
});

// ============================================
// PUT /api/mobile/notificacoes/ler-todas — Marcar todas como lidas
// ============================================
router.put("/notificacoes/ler-todas", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    await pool.query(
      `UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`,
      [userId]
    );

    res.json({ success: true });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao marcar notificações:", err);
    res.status(500).json({ success: false, error: "Erro ao marcar notificações" });
  }
});

// ============================================
// GET /api/mobile/fila — Entradas na fila de espera do usuário
// ============================================
router.get("/fila", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;

    const { rows: personRows } = await pool.query(
      `SELECT id, company_id FROM funcionarios_clientes WHERE user_id = $1`,
      [userId]
    );

    if (!personRows[0]) {
      return res.json({ success: true, data: { entries: [], lockers: [] } });
    }

    const { id: personId, company_id } = personRows[0];

    const [entriesRes, lockersRes] = await Promise.all([
      pool.query(
        `SELECT lw.id, lw.locker_id, lw.preferred_size, lw.status, lw.created_at, lw.notified_at,
                l.name AS locker_name, l.location AS locker_location
         FROM locker_waitlist lw
         LEFT JOIN lockers l ON l.id = lw.locker_id
         WHERE lw.person_id = $1
         ORDER BY lw.created_at DESC`,
        [personId]
      ),
      pool.query(
        `SELECT id, name, location FROM lockers WHERE company_id = $1`,
        [company_id]
      ),
    ]);

    res.json({
      success: true,
      data: {
        entries: entriesRes.rows,
        lockers: lockersRes.rows,
      },
    });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao buscar fila:", err);
    res.status(500).json({ success: false, error: "Erro ao buscar fila" });
  }
});

// ============================================
// POST /api/mobile/fila — Entrar na fila de espera
// ============================================
const filaSchema = z.object({
  locker_id: z.string().uuid(),
  preferred_size: z.string().optional(),
});

router.post("/fila", validate(filaSchema), async (req: Request, res: Response) => {
  const { locker_id, preferred_size } = req.body;

  try {
    const userId = req.user?.user_id;

    const { rows: personRows } = await pool.query(
      `SELECT id, company_id FROM funcionarios_clientes WHERE user_id = $1`,
      [userId]
    );

    if (!personRows[0]) {
      return res.status(404).json({ success: false, error: "Perfil não encontrado" });
    }

    const { id: personId, company_id } = personRows[0];

    // O armário precisa ser da empresa da pessoa
    const { rows: lockerRows } = await pool.query(
      `SELECT 1 FROM lockers WHERE id = $1 AND company_id = $2`,
      [locker_id, company_id]
    );
    if (!lockerRows[0]) {
      return res.status(404).json({ success: false, error: "Armário não encontrado" });
    }

    // Check if already waiting
    const { rows: existing } = await pool.query(
      `SELECT id FROM locker_waitlist WHERE person_id = $1 AND locker_id = $2 AND status = 'waiting'`,
      [personId, locker_id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: "Você já está na fila de espera deste armário." });
    }

    const { rows } = await pool.query(
      `INSERT INTO locker_waitlist (locker_id, person_id, company_id, requested_by, preferred_size)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [locker_id, personId, company_id, userId, preferred_size || null]
    );

    res.status(201).json({ success: true, message: "Entrou na fila de espera", id: rows[0].id });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao entrar na fila:", err);
    res.status(500).json({ success: false, error: "Erro ao entrar na fila" });
  }
});

// ============================================
// PUT /api/mobile/fila/:id/cancelar — Sair da fila de espera
// ============================================
router.put("/fila/:id/cancelar", async (req: Request, res: Response) => {
  try {
    const userId = req.user?.user_id;
    const { id } = req.params;

    const { rows: personRows } = await pool.query(
      `SELECT id FROM funcionarios_clientes WHERE user_id = $1`,
      [userId]
    );

    if (!personRows[0]) {
      return res.status(404).json({ success: false, error: "Perfil não encontrado" });
    }

    const { rowCount } = await pool.query(
      `UPDATE locker_waitlist SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND person_id = $2 AND status = 'waiting'`,
      [id, personRows[0].id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, error: "Entrada não encontrada ou já cancelada" });
    }

    res.json({ success: true, message: "Saiu da fila de espera" });
  } catch (err: any) {
    console.error("[MOBILE] Erro ao cancelar fila:", err);
    res.status(500).json({ success: false, error: "Erro ao cancelar fila" });
  }
});

export { router as mobileRouter };
