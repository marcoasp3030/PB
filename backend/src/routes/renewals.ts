import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireAdminOrAbove } from "../middleware/permissions";
import { pool } from "../config/database";
import { tenantParam, bodyRefsGuard } from "../services/tenant";

const router = Router();

// Isolamento multi-tenant: todo :param abaixo precisa ser da empresa do usuário
router.param("id", tenantParam("renewal_requests", "Solicitação não encontrada"));


// ============================================
// GET /api/renewals
// ============================================
router.get("/", async (req: Request, res: Response) => {
  try {
    let query = `SELECT rr.*, fc.nome as person_name,
       COALESCE(ld.label, 'Porta ' || ld.door_number) as door_label,
       c.name as company_name
       FROM renewal_requests rr
       JOIN funcionarios_clientes fc ON fc.id = rr.person_id
       JOIN locker_doors ld ON ld.id = rr.door_id
       JOIN companies c ON c.id = rr.company_id
       WHERE 1=1`;
    const params: any[] = [];

    if (req.user!.role !== "superadmin") {
      query += ` AND rr.company_id = $${params.length + 1}`;
      params.push(req.user!.company_id);
    } else if (req.query.company_id) {
      query += ` AND rr.company_id = $${params.length + 1}`;
      params.push(req.query.company_id);
    }

    if (req.query.status) {
      query += ` AND rr.status = $${params.length + 1}`;
      params.push(req.query.status);
    }

    query += " ORDER BY rr.created_at DESC";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /api/renewals
// ============================================
const createSchema = z.object({
  company_id: z.string().uuid(),
  door_id: z.string().uuid(),
  person_id: z.string().uuid(),
  requested_hours: z.number().int().min(1).max(24).default(1),
});

router.post("/", validate(createSchema), bodyRefsGuard, async (req: Request, res: Response) => {
  try {
    const { company_id, door_id, person_id, requested_hours } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO renewal_requests (company_id, door_id, person_id, requested_hours)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [company_id, door_id, person_id, requested_hours]
    );

    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/renewals/:id/approve
// ============================================
router.put("/:id/approve", requireAdminOrAbove, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: renewal } = await client.query(
      `UPDATE renewal_requests SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(),
       admin_notes = $3, updated_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id, req.user!.user_id, req.body.admin_notes || null]
    );

    if (!renewal[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Solicitação não encontrada ou já processada" });
    }

    // Extend door expiration
    await client.query(
      `UPDATE locker_doors SET
       expires_at = COALESCE(expires_at, NOW()) + interval '1 hour' * $2,
       updated_at = NOW()
       WHERE id = $1`,
      [renewal[0].door_id, renewal[0].requested_hours]
    );

    // Update reservation
    await client.query(
      `UPDATE locker_reservations SET
       expires_at = COALESCE(expires_at, NOW()) + interval '1 hour' * $2,
       renewed_count = renewed_count + 1, updated_at = NOW()
       WHERE door_id = $1 AND status = 'active'`,
      [renewal[0].door_id, renewal[0].requested_hours]
    );

    await client.query("COMMIT");
    res.json({ message: "Renovação aprovada", renewal: renewal[0] });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================
// PUT /api/renewals/:id/reject
// ============================================
router.put("/:id/reject", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `UPDATE renewal_requests SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(),
       admin_notes = $3, updated_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [req.params.id, req.user!.user_id, req.body.admin_notes || null]
    );

    if (!rows[0]) return res.status(404).json({ error: "Solicitação não encontrada" });
    res.json({ message: "Renovação rejeitada", renewal: rows[0] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as renewalsRouter };
