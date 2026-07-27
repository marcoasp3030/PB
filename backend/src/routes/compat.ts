/**
 * Compatibility route that mimics Supabase PostgREST API patterns.
 * Handles: GET (select), POST (insert), PUT (update/upsert), DELETE
 * with query params for filtering, ordering, limiting.
 */
import { Router, Request, Response } from "express";
import { pool } from "../config/database";
import { excluirArmario } from "../services/locker.service";

const router = Router();

const ALLOWED_TABLES = [
  "companies", "company_branding", "company_permissions", "company_whatsapp",
  "company_notification_templates", "departamentos", "setores", "funcionarios_clientes",
  "lockers", "locker_doors", "locker_reservations", "locker_waitlist",
  "renewal_requests", "notifications", "audit_logs", "login_attempts",
  "platform_settings", "platform_settings_history", "profiles", "permission_groups",
];

function parseFilters(params: Record<string, any>): { clauses: string[]; values: any[]; idx: number } {
  const clauses: string[] = [];
  const values: any[] = [];
  let idx = 1;

  for (const [key, val] of Object.entries(params)) {
    if (key.startsWith("_")) continue; // skip meta params

    if (key.includes("__")) {
      const [col, op] = key.split("__");
      switch (op) {
        case "neq":
          clauses.push(`${col} != $${idx++}`);
          values.push(val);
          break;
        case "in":
          const inVals = (val as string).split(",");
          const placeholders = inVals.map(() => `$${idx++}`).join(",");
          clauses.push(`${col} IN (${placeholders})`);
          values.push(...inVals);
          break;
        case "not_is":
          clauses.push(`${col} IS NOT ${val === "null" ? "NULL" : val}`);
          break;
        case "is":
          clauses.push(`${col} IS ${val === "null" ? "NULL" : val}`);
          break;
        case "gte":
          clauses.push(`${col} >= $${idx++}`);
          values.push(val);
          break;
        case "lte":
          clauses.push(`${col} <= $${idx++}`);
          values.push(val);
          break;
        case "gt":
          clauses.push(`${col} > $${idx++}`);
          values.push(val);
          break;
        case "lt":
          clauses.push(`${col} < $${idx++}`);
          values.push(val);
          break;
      }
    } else {
      clauses.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }

  return { clauses, values, idx };
}

// GET /api/compat/:table - SELECT
router.get("/:table", async (req: Request, res: Response) => {
  const { table } = req.params;
  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `Table ${table} not allowed` });
  }

  try {
    const { clauses, values } = parseFilters(req.query as Record<string, any>);

    // Company scoping for non-superadmins
    if (req.user!.role !== "superadmin" && req.user!.company_id) {
      const tablesWithCompany = [
        "companies", "company_branding", "company_permissions", "company_whatsapp",
        "company_notification_templates", "departamentos", "setores", "funcionarios_clientes",
        "lockers", "locker_waitlist", "renewal_requests", "audit_logs",
      ];
      if (tablesWithCompany.includes(table)) {
        clauses.push(`company_id = $${values.length + 1}`);
        values.push(req.user!.company_id);
      }
    }

    let query = `SELECT * FROM ${table}`;
    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }

    // Ordering
    if (req.query._order) {
      const dir = req.query._asc === "false" ? "DESC" : "ASC";
      query += ` ORDER BY ${req.query._order} ${dir}`;
    }

    // Limit
    if (req.query._limit) {
      query += ` LIMIT ${parseInt(req.query._limit as string)}`;
    }

    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/compat/:table - INSERT
router.post("/:table", async (req: Request, res: Response) => {
  const { table } = req.params;
  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `Table ${table} not allowed` });
  }

  try {
    const data = req.body.data || req.body;
    const isArray = Array.isArray(data);
    const items = isArray ? data : [data];
    const results: any[] = [];

    for (const item of items) {
      const keys = Object.keys(item).filter(k => !k.startsWith("_"));
      const vals = keys.map(k => {
        const v = item[k];
        // Auto-serialize objects/arrays for jsonb columns
        if (v !== null && typeof v === "object" && !(v instanceof Date)) {
          return JSON.stringify(v);
        }
        return v;
      });
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

      const { rows } = await pool.query(
        `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        vals
      );
      results.push(rows[0]);
    }

    res.json(isArray ? results : results[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/compat/:table - UPDATE/UPSERT
router.put("/:table", async (req: Request, res: Response) => {
  const { table } = req.params;
  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `Table ${table} not allowed` });
  }

  try {
    const data = req.body.data || req.body;
    const params = req.body.params || req.query;
    const isUpsert = data._upsert;
    const conflictColumn = data._onConflict || null;
    delete data._upsert;
    delete data._onConflict;

    // Auto-serialize objects/arrays for jsonb columns
    const serializeValue = (v: any) => {
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        return JSON.stringify(v);
      }
      return v;
    };

    if (isUpsert) {
      const keys = Object.keys(data).filter(k => !k.startsWith("_"));
      const vals = keys.map(k => serializeValue(data[k]));
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const updateKeys = keys.filter(k => k !== conflictColumn);
      const updates = updateKeys.map((k) => `${k} = EXCLUDED.${k}`).join(", ");
      const conflictClause = conflictColumn ? `(${conflictColumn})` : `(id)`;

      const { rows } = await pool.query(
        `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})
         ON CONFLICT ${conflictClause} DO UPDATE SET ${updates}, updated_at = NOW() RETURNING *`,
        vals
      );
      return res.json(rows[0]);
    }

    // Regular update
    const updateKeys = Object.keys(data).filter(k => !k.startsWith("_"));
    const updateVals = updateKeys.map(k => serializeValue(data[k]));
    const setClauses = updateKeys.map((k, i) => `${k} = $${i + 1}`).join(", ");

    const { clauses, values } = parseFilters(params as Record<string, any>);
    // Offset parameter indices
    const offsetClauses = clauses.map((c, i) => {
      const paramCount = (c.match(/\$/g) || []).length;
      let result = c;
      for (let j = paramCount; j >= 1; j--) {
        result = result.replace(`$${j}`, `$${updateKeys.length + j}`);
      }
      return result;
    });

    let query = `UPDATE ${table} SET ${setClauses}, updated_at = NOW()`;
    if (offsetClauses.length > 0) {
      query += ` WHERE ${offsetClauses.join(" AND ")}`;
    }
    query += ` RETURNING *`;

    const { rows } = await pool.query(query, [...updateVals, ...values]);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/compat/:table - DELETE
router.delete("/:table", async (req: Request, res: Response) => {
  const { table } = req.params;
  if (!ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `Table ${table} not allowed` });
  }

  // Frontend usa supabase.from("lockers").delete().eq("id", ...) → compat
  if (table === "lockers") {
    const lockerId = req.query.id as string | undefined;
    if (!lockerId) {
      return res.status(400).json({ error: "Informe o id do armário para excluir." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const excluido = await excluirArmario(client, lockerId);
      await client.query("COMMIT");
      if (!excluido) {
        return res.status(404).json({ error: "Armário não encontrado" });
      }
      return res.json([{ id: lockerId }]);
    } catch (err: any) {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  }

  try {
    const { clauses, values } = parseFilters(req.query as Record<string, any>);

    let query = `DELETE FROM ${table}`;
    if (clauses.length > 0) {
      query += ` WHERE ${clauses.join(" AND ")}`;
    }
    query += ` RETURNING *`;

    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as compatRouter };
