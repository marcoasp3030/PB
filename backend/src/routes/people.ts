import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireAdminOrAbove } from "../middleware/permissions";
import { pool } from "../config/database";
import { tenantParam, bodyRefsGuard } from "../services/tenant";

const router = Router();

// Isolamento multi-tenant: todo :param abaixo precisa ser da empresa do usuário
router.param("id", tenantParam("funcionarios_clientes", "Pessoa não encontrada"));


function scopeQuery(user: Request["user"], baseIdx: number = 1): { clause: string; params: any[] } {
  if (user!.role === "superadmin") return { clause: "", params: [] };
  return { clause: ` AND company_id = $${baseIdx}`, params: [user!.company_id] };
}

// ============================================
// GET /api/people
// ============================================
router.get("/", async (req: Request, res: Response) => {
  try {
    const scope = scopeQuery(req.user, 1);
    let query = `SELECT fc.*, d.nome as departamento_nome, s.nome as setor_nome
       FROM funcionarios_clientes fc
       LEFT JOIN departamentos d ON d.id = fc.departamento_id
       LEFT JOIN setores s ON s.id = fc.setor_id
       WHERE 1=1`;
    const params: any[] = [];

    if (scope.clause) {
      query += ` AND fc.company_id = $${params.length + 1}`;
      params.push(...scope.params);
    }

    if (req.query.company_id && req.user!.role === "superadmin") {
      query += ` AND fc.company_id = $${params.length + 1}`;
      params.push(req.query.company_id);
    }

    if (req.query.tipo) {
      query += ` AND fc.tipo = $${params.length + 1}`;
      params.push(req.query.tipo);
    }

    if (req.query.ativo !== undefined) {
      query += ` AND fc.ativo = $${params.length + 1}`;
      params.push(req.query.ativo === "true");
    }

    query += " ORDER BY fc.nome";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/people/:id
// ============================================
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT fc.*, d.nome as departamento_nome, s.nome as setor_nome
       FROM funcionarios_clientes fc
       LEFT JOIN departamentos d ON d.id = fc.departamento_id
       LEFT JOIN setores s ON s.id = fc.setor_id
       WHERE fc.id = $1`,
      [req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Pessoa não encontrada" });

    if (req.user!.role !== "superadmin" && rows[0].company_id !== req.user!.company_id) {
      return res.status(403).json({ error: "Acesso restrito" });
    }

    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /api/people
// ============================================
const createSchema = z.object({
  company_id: z.string().uuid(),
  nome: z.string().trim().min(1).max(200),
  email: z.string().email().max(255).optional().or(z.literal("")).or(z.null()),
  telefone: z.string().max(20).optional().or(z.literal("")).or(z.null()),
  cargo: z.string().max(100).default(""),
  tipo: z.enum(["funcionario", "cliente"]).default("funcionario"),
  matricula: z.string().max(50).optional().or(z.null()),
  departamento_id: z.string().uuid().optional().or(z.null()),
  setor_id: z.string().uuid().optional().or(z.null()),
  notification_whatsapp: z.boolean().default(true),
  notification_email: z.boolean().default(true),
  notification_renewal: z.boolean().default(true),
  notification_expiry: z.boolean().default(true),
});

router.post("/", requireAdminOrAbove, validate(createSchema), bodyRefsGuard, async (req: Request, res: Response) => {
  const data = req.body;

  if (req.user!.role !== "superadmin" && data.company_id !== req.user!.company_id) {
    return res.status(403).json({ error: "Acesso restrito à sua empresa" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO funcionarios_clientes
       (company_id, nome, email, telefone, cargo, tipo, matricula, departamento_id, setor_id,
        notification_whatsapp, notification_email, notification_renewal, notification_expiry)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [data.company_id, data.nome, data.email || null, data.telefone || null,
       data.cargo, data.tipo, data.matricula || null, data.departamento_id || null,
       data.setor_id || null, data.notification_whatsapp, data.notification_email,
       data.notification_renewal, data.notification_expiry]
    );

    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/people/:id
// ============================================
// Campos editáveis (company_id/user_id/id nunca são alterados por esta rota)
const EDITABLE_FIELDS = [
  "nome", "email", "telefone", "cargo", "tipo", "matricula", "departamento_id", "setor_id",
  "notification_whatsapp", "notification_email", "notification_expiry", "notification_renewal",
  "avatar_url", "ativo",
];

router.put("/:id", requireAdminOrAbove, bodyRefsGuard, async (req: Request, res: Response) => {
  try {
    const invalid = Object.keys(req.body).filter((k) => k !== "id" && !EDITABLE_FIELDS.includes(k));
    if (invalid.length) return res.status(400).json({ error: `Campos não permitidos: ${invalid.join(", ")}` });

    const fields = Object.entries(req.body).filter(([k]) => EDITABLE_FIELDS.includes(k));
    if (fields.length === 0) return res.status(400).json({ error: "Nenhum campo" });

    const sets = fields.map(([key], i) => `${key} = $${i + 2}`).join(", ");
    const values = fields.map(([, val]) => val);

    const { rows } = await pool.query(
      `UPDATE funcionarios_clientes SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );

    if (!rows[0]) return res.status(404).json({ error: "Pessoa não encontrada" });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DELETE /api/people/:id
// ============================================
router.delete("/:id", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM funcionarios_clientes WHERE id = $1 RETURNING id`,
      [req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Pessoa não encontrada" });
    res.json({ message: "Pessoa excluída com sucesso" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as peopleRouter };
