import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireAdminOrAbove } from "../middleware/permissions";
import { pool } from "../config/database";
import { tenantParam, bodyRefsGuard } from "../services/tenant";

const router = Router();

// Isolamento multi-tenant: todo :param abaixo precisa ser da empresa do usuário
router.param("id", tenantParam("setores", "Setor não encontrado"));


// ============================================
// GET /api/sectors
// ============================================
router.get("/", async (req: Request, res: Response) => {
  try {
    let query = `SELECT s.*, d.nome as departamento_nome FROM setores s
       LEFT JOIN departamentos d ON d.id = s.departamento_id WHERE 1=1`;
    const params: any[] = [];

    if (req.user!.role !== "superadmin") {
      query += ` AND s.company_id = $${params.length + 1}`;
      params.push(req.user!.company_id);
    } else if (req.query.company_id) {
      query += ` AND s.company_id = $${params.length + 1}`;
      params.push(req.query.company_id);
    }

    if (req.query.departamento_id) {
      query += ` AND s.departamento_id = $${params.length + 1}`;
      params.push(req.query.departamento_id);
    }

    query += " ORDER BY s.nome";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /api/sectors
// ============================================
const createSchema = z.object({
  company_id: z.string().uuid(),
  departamento_id: z.string().uuid().optional().or(z.null()),
  nome: z.string().trim().min(1).max(200),
  descricao: z.string().max(500).default(""),
});

router.post("/", requireAdminOrAbove, validate(createSchema), bodyRefsGuard, async (req: Request, res: Response) => {
  const { company_id, departamento_id, nome, descricao } = req.body;

  if (req.user!.role !== "superadmin" && company_id !== req.user!.company_id) {
    return res.status(403).json({ error: "Acesso restrito" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO setores (company_id, departamento_id, nome, descricao)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [company_id, departamento_id || null, nome, descricao]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/sectors/:id
// ============================================
router.put("/:id", requireAdminOrAbove, bodyRefsGuard, async (req: Request, res: Response) => {
  try {
    const { nome, descricao, ativo, departamento_id } = req.body;
    const { rows } = await pool.query(
      `UPDATE setores SET nome = COALESCE($2, nome), descricao = COALESCE($3, descricao),
       ativo = COALESCE($4, ativo), departamento_id = COALESCE($5, departamento_id),
       updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, nome, descricao, ativo, departamento_id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Setor não encontrado" });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DELETE /api/sectors/:id
// ============================================
router.delete("/:id", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `UPDATE setores SET ativo = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Setor não encontrado" });
    res.json({ message: "Setor desativado" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as sectorsRouter };
