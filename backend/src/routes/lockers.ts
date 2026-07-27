import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireAdminOrAbove } from "../middleware/permissions";
import { pool } from "../config/database";
import { excluirArmario } from "../services/locker.service";

const router = Router();

function companyFilter(user: Request["user"]): { clause: string; params: any[] } {
  if (user!.role === "superadmin") return { clause: "", params: [] };
  return { clause: "AND l.company_id = $", params: [user!.company_id] };
}

// ============================================
// GET /api/lockers
// ============================================
router.get("/", async (req: Request, res: Response) => {
  try {
    const cf = companyFilter(req.user);
    const paramIdx = 1;
    let query = `SELECT l.*, 
      (SELECT count(*) FROM locker_doors d WHERE d.locker_id = l.id) as total_doors,
      (SELECT count(*) FROM locker_doors d WHERE d.locker_id = l.id AND d.status = 'occupied') as occupied_doors
      FROM lockers l WHERE 1=1`;

    const params: any[] = [];
    if (cf.clause) {
      query += ` AND l.company_id = $${paramIdx}`;
      params.push(...cf.params);
    }

    if (req.query.company_id && req.user!.role === "superadmin") {
      query += ` AND l.company_id = $${params.length + 1}`;
      params.push(req.query.company_id);
    }

    query += " ORDER BY l.name";
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/lockers/:id
// ============================================
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM lockers WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Armário não encontrado" });

    if (req.user!.role !== "superadmin" && rows[0].company_id !== req.user!.company_id) {
      return res.status(403).json({ error: "Acesso restrito" });
    }

    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /api/lockers
// ============================================
const createLockerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.string().max(200).default(""),
  company_id: z.string().uuid(),
  rows: z.number().int().min(1).max(50).default(4),
  columns: z.number().int().min(1).max(10).default(1),
  orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
});

router.post("/", requireAdminOrAbove, validate(createLockerSchema), async (req: Request, res: Response) => {
  const { name, location, company_id, rows: lockerRows, columns, orientation } = req.body;

  if (req.user!.role !== "superadmin" && company_id !== req.user!.company_id) {
    return res.status(403).json({ error: "Acesso restrito à sua empresa" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO lockers (name, location, company_id, rows, columns, orientation)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, location, company_id, lockerRows, columns, orientation]
    );

    const locker = rows[0];
    const totalDoors = lockerRows * columns;

    for (let i = 1; i <= totalDoors; i++) {
      await client.query(
        `INSERT INTO locker_doors (locker_id, door_number, label)
         VALUES ($1, $2, $3)`,
        [locker.id, i, `Porta ${i}`]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(locker);
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================
// PUT /api/lockers/:id
// ============================================
router.put("/:id", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { name, location, orientation } = req.body;
    const { rows } = await pool.query(
      `UPDATE lockers SET name = COALESCE($2, name), location = COALESCE($3, location),
       orientation = COALESCE($4, orientation), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, name, location, orientation]
    );

    if (!rows[0]) return res.status(404).json({ error: "Armário não encontrado" });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DELETE /api/lockers/:id
// ============================================
router.delete("/:id", requireAdminOrAbove, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const excluido = await excluirArmario(client, req.params.id);
    await client.query("COMMIT");

    if (!excluido) return res.status(404).json({ error: "Armário não encontrado" });
    res.json({ message: "Armário excluído com sucesso" });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================
// GET /api/lockers/:id/doors
// ============================================
router.get("/:id/doors", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, fc.nome as person_name, fc.email as person_email
       FROM locker_doors d
       LEFT JOIN funcionarios_clientes fc ON fc.id = d.occupied_by_person
       WHERE d.locker_id = $1
       ORDER BY d.door_number`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/lockers/doors/:doorId
// ============================================
router.put("/doors/:doorId", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { status, occupied_by_person, usage_type, expires_at, label, size } = req.body;

    const { rows } = await pool.query(
      `UPDATE locker_doors SET
        status = COALESCE($2, status),
        occupied_by_person = $3,
        usage_type = COALESCE($4, usage_type),
        expires_at = $5,
        label = COALESCE($6, label),
        size = COALESCE($7, size),
        occupied_by = $8,
        occupied_at = CASE WHEN $2 = 'occupied' AND status != 'occupied' THEN NOW() ELSE occupied_at END,
        updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.doorId, status, occupied_by_person ?? null, usage_type, expires_at ?? null, label, size, req.user!.user_id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Porta não encontrada" });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// POST /api/lockers/doors/:doorId/release
// ============================================
router.post("/doors/:doorId/release", requireAdminOrAbove, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check if company has hygienization enabled
    const { rows: doorInfo } = await client.query(
      `SELECT ld.*, l.company_id FROM locker_doors ld JOIN lockers l ON l.id = ld.locker_id WHERE ld.id = $1`,
      [req.params.doorId]
    );
    if (!doorInfo[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Porta não encontrada" });
    }

    const companyId = doorInfo[0].company_id;
    let useHygienization = false;
    let hygienizationMinutes = 15;

    if (companyId) {
      const { rows: permRows } = await client.query(
        `SELECT enabled FROM company_permissions WHERE company_id = $1 AND permission = 'hygienization_enabled'`,
        [companyId]
      );
      if (permRows[0]?.enabled) {
        useHygienization = true;
        const { rows: settingRows } = await client.query(
          `SELECT enabled::text as value FROM company_permissions WHERE company_id = $1 AND permission = 'hygienization_minutes'`,
          [companyId]
        );
        // hygienization_minutes is stored as a separate permission where 'permission' column holds the key
        // and we store the minutes value in platform_settings per company
        const { rows: minutesRows } = await client.query(
          `SELECT value FROM platform_settings WHERE key = $1`,
          [`hygienization_minutes_${companyId}`]
        );
        if (minutesRows[0]?.value) {
          hygienizationMinutes = parseInt(String(minutesRows[0].value)) || 15;
        }
      }
    }

    // Skip hygienization if explicitly requested (admin manual release of hygienizing door)
    const skipHygienization = req.body?.skipHygienization === true;

    if (useHygienization && !skipHygienization && doorInfo[0].status === "occupied") {
      const hygienizationExpiry = new Date(Date.now() + hygienizationMinutes * 60 * 1000).toISOString();
      const { rows } = await client.query(
        `UPDATE locker_doors SET
          status = 'hygienizing', occupied_by = NULL, occupied_by_person = NULL,
          occupied_at = NULL, expires_at = $2, scheduled_reservation_id = NULL,
          updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.doorId, hygienizationExpiry]
      );

      // Release active reservation
      await client.query(
        `UPDATE locker_reservations SET status = 'released', released_at = NOW()
         WHERE door_id = $1 AND status = 'active'`,
        [req.params.doorId]
      );

      await client.query("COMMIT");
      res.json({ message: `Porta em higienização por ${hygienizationMinutes} minutos`, door: rows[0], hygienizing: true });
    } else {
      const { rows } = await client.query(
        `UPDATE locker_doors SET
          status = 'available', occupied_by = NULL, occupied_by_person = NULL,
          occupied_at = NULL, expires_at = NULL, scheduled_reservation_id = NULL,
          updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.doorId]
      );

      // Release active reservation
      await client.query(
        `UPDATE locker_reservations SET status = 'released', released_at = NOW()
         WHERE door_id = $1 AND status IN ('active', 'hygienizing')`,
        [req.params.doorId]
      );

      await client.query("COMMIT");
      res.json({ message: "Porta liberada com sucesso", door: rows[0] });
    }
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export { router as lockersRouter };
