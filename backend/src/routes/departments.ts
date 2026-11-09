import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireAdminOrAbove } from "../middleware/permissions";
import { pool } from "../config/database";
import { tenantParam } from "../services/tenant";

const router = Router();

// Isolamento multi-tenant: todo :param abaixo precisa ser da empresa do usuário
router.param("id", tenantParam("departamentos", "Departamento não encontrado"));


// ============================================
// GET /api/departments
// ============================================
router.get("/", async (req: Request, res: Response) => {
  try {
    let query = `SELECT * FROM departamentos WHERE 1=1`;
    const params: any[] = [];

    if (req.user!.role !== "superadmin") {
      query += ` AND company_id = $${params.length + 1}`;
      params.push(req.user!.company_id);
    } else if (req.query.company_id) {
      query += ` AND company_id = $${params.length + 1}`;
      params.push(req.query.company_id);
    }

    query += " ORDER BY nome";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /api/departments
// ============================================
const createSchema = z.object({
  company_id: z.string().uuid(),
  nome: z.string().trim().min(1).max(200),
  descricao: z.string().max(500).default(""),
});

router.post("/", requireAdminOrAbove, validate(createSchema), async (req: Request, res: Response) => {
  const { company_id, nome, descricao } = req.body;

  if (req.user!.role !== "superadmin" && company_id !== req.user!.company_id) {
    return res.status(403).json({ error: "Acesso restrito" });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO departamentos (company_id, nome, descricao) VALUES ($1, $2, $3) RETURNING *`,
      [company_id, nome, descricao]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/departments/:id
// ============================================
router.put("/:id", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { nome, descricao, ativo } = req.body;
    const { rows } = await pool.query(
      `UPDATE departamentos SET nome = COALESCE($2, nome), descricao = COALESCE($3, descricao),
       ativo = COALESCE($4, ativo), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, nome, descricao, ativo]
    );

    if (!rows[0]) return res.status(404).json({ error: "Departamento não encontrado" });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DELETE /api/departments/:id
// ============================================
router.delete("/:id", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `UPDATE departamentos SET ativo = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Departamento não encontrado" });
    res.json({ message: "Departamento desativado" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as departmentsRouter };
