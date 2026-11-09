import { Router, Request, Response } from "express";
import { pool } from "../config/database";
import { bodyRefsGuard } from "../services/tenant";

const router = Router();

// Isolamento multi-tenant: todo :param abaixo precisa ser da empresa do usuário


// ============================================
// GET /api/reservations
// ============================================
router.get("/", async (req: Request, res: Response) => {
  try {
    let query = `SELECT r.*, fc.nome as person_name,
       COALESCE(ld.label, 'Porta ' || ld.door_number) as door_label,
       l.name as locker_name
       FROM locker_reservations r
       JOIN locker_doors ld ON ld.id = r.door_id
       JOIN lockers l ON l.id = r.locker_id
       LEFT JOIN funcionarios_clientes fc ON fc.id = r.person_id
       WHERE 1=1`;
    const params: any[] = [];

    // Company scope
    if (req.user!.role !== "superadmin") {
      query += ` AND l.company_id = $${params.length + 1}`;
      params.push(req.user!.company_id);
    } else if (req.query.company_id) {
      query += ` AND l.company_id = $${params.length + 1}`;
      params.push(req.query.company_id);
    }

    if (req.query.status) {
      query += ` AND r.status = $${params.length + 1}`;
      params.push(req.query.status);
    }

    if (req.query.locker_id) {
      query += ` AND r.locker_id = $${params.length + 1}`;
      params.push(req.query.locker_id);
    }

    query += " ORDER BY r.created_at DESC";

    const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /api/reservations
// ============================================
router.post("/", bodyRefsGuard, async (req: Request, res: Response) => {
  const { door_id, locker_id, person_id, usage_type, expires_at, starts_at, notes } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO locker_reservations (door_id, locker_id, person_id, reserved_by,
       usage_type, expires_at, starts_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), $8) RETURNING *`,
      [door_id, locker_id, person_id || null, req.user!.user_id,
       usage_type || "temporary", expires_at || null, starts_at, notes || null]
    );

    // Update door status
    const shouldActivateNow = !starts_at || new Date(starts_at) <= new Date();
    if (shouldActivateNow) {
      await client.query(
        `UPDATE locker_doors SET status = 'occupied', occupied_by = $2,
         occupied_by_person = $3, occupied_at = NOW(), expires_at = $4,
         usage_type = $5, scheduled_reservation_id = NULL, updated_at = NOW()
         WHERE id = $1`,
        [door_id, req.user!.user_id, person_id || null, expires_at || null, usage_type || "temporary"]
      );
    } else {
      await client.query(
        `UPDATE locker_doors SET scheduled_reservation_id = $2, updated_at = NOW() WHERE id = $1`,
        [door_id, rows[0].id]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(rows[0]);
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export { router as reservationsRouter };
