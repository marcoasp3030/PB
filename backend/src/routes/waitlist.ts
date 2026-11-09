import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireAdminOrAbove } from "../middleware/permissions";
import { pool } from "../config/database";
import { tenantParam, bodyRefsGuard } from "../services/tenant";

const router = Router();

// Isolamento multi-tenant: todo :param abaixo precisa ser da empresa do usuário
router.param("id", tenantParam("locker_waitlist", "Entrada não encontrada"));


// ============================================
// GET /api/waitlist
// ============================================
router.get("/", async (req: Request, res: Response) => {
  try {
    let query = `SELECT w.*, fc.nome as person_name, l.name as locker_name
       FROM locker_waitlist w
       JOIN funcionarios_clientes fc ON fc.id = w.person_id
       JOIN lockers l ON l.id = w.locker_id
       WHERE 1=1`;
    const params: any[] = [];

    if (req.user!.role !== "superadmin") {
      query += ` AND w.company_id = $${params.length + 1}`;
      params.push(req.user!.company_id);
    } else if (req.query.company_id) {
      query += ` AND w.company_id = $${params.length + 1}`;
      params.push(req.query.company_id);
    }

    if (req.query.status) {
      query += ` AND w.status = $${params.length + 1}`;
      params.push(req.query.status);
    }

    query += " ORDER BY w.created_at ASC";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /api/waitlist
// ============================================
const createSchema = z.object({
  company_id: z.string().uuid(),
  locker_id: z.string().uuid(),
  person_id: z.string().uuid(),
  preferred_size: z.string().default("any"),
});

router.post("/", requireAdminOrAbove, validate(createSchema), bodyRefsGuard, async (req: Request, res: Response) => {
  try {
    const { company_id, locker_id, person_id, preferred_size } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO locker_waitlist (company_id, locker_id, person_id, preferred_size, requested_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [company_id, locker_id, person_id, preferred_size, req.user!.user_id]
    );

    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/waitlist/:id/cancel
// ============================================
router.put("/:id/cancel", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `UPDATE locker_waitlist SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Entrada não encontrada" });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DELETE /api/waitlist/:id
// ============================================
router.delete("/:id", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM locker_waitlist WHERE id = $1 RETURNING id`,
      [req.params.id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Entrada não encontrada" });
    res.json({ message: "Entrada removida da lista de espera" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as waitlistRouter };
