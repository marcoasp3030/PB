/**
 * Compatibility route that mimics Supabase PostgREST API patterns.
 * Handles: GET (select), POST (insert), PUT (update/upsert), DELETE
 * with query params for filtering, ordering, limiting.
 *
 * SEGURANÇA (multi-tenant):
 *   - Cada tabela tem uma política por operação e perfil (TABLE_POLICIES).
 *   - Para não-superadmin, toda operação é restrita à empresa do usuário
 *     (services/tenant.ts) — inclusive UPDATE/DELETE/UPSERT.
 *   - Nomes de colunas (filtros, dados, ordenação, onConflict) são validados
 *     contra o information_schema, evitando SQL injection por identificador.
 */
import { Router, Request, Response } from "express";
import { pool } from "../config/database";
import { excluirArmario } from "../services/locker.service";
import {
  AuthUser,
  HttpError,
  assertColumn,
  assertReferencesInTenant,
  getColumns,
  isSuper,
  rowInTenant,
  scopeCondition,
} from "../services/tenant";

const router = Router();

type Role = "admin" | "user";
type Op = "read" | "insert" | "update" | "delete";
type TablePolicy = Record<Op, Role[]>; // superadmin sempre permitido

const A: Role[] = ["admin"];
const AU: Role[] = ["admin", "user"];
const NONE: Role[] = [];

const policy = (read: Role[], insert: Role[], update: Role[], del: Role[]): TablePolicy => ({
  read,
  insert,
  update,
  delete: del,
});

const TABLE_POLICIES: Record<string, TablePolicy> = {
  companies: policy(AU, NONE, NONE, NONE),
  company_branding: policy(AU, A, A, NONE),
  company_permissions: policy(AU, A, A, NONE), // admin: apenas ADMIN_EDITABLE_PERMISSIONS
  company_whatsapp: policy(A, NONE, NONE, NONE),
  company_notification_templates: policy(A, A, A, A),
  departamentos: policy(AU, A, A, A),
  setores: policy(AU, A, A, A),
  funcionarios_clientes: policy(AU, A, AU, A), // user: só o próprio registro, colunas limitadas
  lockers: policy(AU, A, A, A),
  locker_doors: policy(AU, A, A, A),
  locker_reservations: policy(A, A, A, NONE),
  locker_waitlist: policy(A, A, A, A),
  renewal_requests: policy(A, NONE, A, NONE),
  notifications: policy(AU, NONE, AU, AU),
  audit_logs: policy(A, AU, NONE, NONE),
  login_attempts: policy(NONE, NONE, NONE, NONE),
  platform_settings: policy(AU, A, A, NONE), // filtrado/limitado (ver abaixo)
  platform_settings_history: policy(NONE, NONE, NONE, NONE),
  profiles: policy(AU, NONE, AU, NONE), // colunas limitadas para não-superadmin
  permission_groups: policy(NONE, NONE, NONE, NONE),
};

// Colunas que não-superadmin pode alterar (quando a tabela tem restrição)
const WRITABLE_COLUMNS_NON_SUPER: Record<string, Partial<Record<Role, string[]>>> = {
  profiles: {
    admin: ["full_name", "avatar_url", "password_changed"],
    user: ["full_name", "avatar_url", "password_changed"],
  },
  funcionarios_clientes: { user: ["avatar_url"] },
  notifications: { admin: ["read"], user: ["read"] },
};

// Permissões de empresa que o próprio admin pode ligar/desligar
const ADMIN_EDITABLE_PERMISSIONS = ["hygienization_enabled"];

// Chaves de platform_settings que nunca são expostas a não-superadmin
const SECRET_SETTINGS = ["fechaduras_api_key", "smtp_config", "uazapi_admin_token", "uazapi_server_url", "whatsapp_webhook_secret"];
const UUID_SUFFIX_REGEX = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

// Escopo extra para o perfil "user" (portal): só os próprios registros
const USER_ROW_SCOPE: Record<string, (p: string) => string> = {
  profiles: (p) => `user_id = ${p}`,
  funcionarios_clientes: (p) => `user_id = ${p}`,
  locker_doors: (p) => `occupied_by_person IN (SELECT id FROM funcionarios_clientes WHERE user_id = ${p})`,
};

// Parâmetros de metadados (Supabase/PostgREST) que não são filtros
const META_PARAMS = new Set(["select", "limit", "order", "offset"]);

function roleOf(user: AuthUser): Role | "superadmin" {
  return user.role === "superadmin" ? "superadmin" : user.role === "admin" ? "admin" : "user";
}

function checkPolicy(table: string, op: Op, user: AuthUser): TablePolicy {
  const pol = TABLE_POLICIES[table];
  if (!pol) throw new HttpError(400, `Table ${table} not allowed`);
  const role = roleOf(user);
  if (role !== "superadmin" && !pol[op].includes(role)) {
    throw new HttpError(403, "Operação não permitida para o seu perfil");
  }
  return pol;
}

function sendError(res: Response, err: any) {
  const status = err instanceof HttpError ? err.status : 500;
  res.status(status).json({ error: err.message });
}

/** Remove o prefixo PostgREST "eq." usado por algumas telas. */
function normalizeValue(val: any) {
  return typeof val === "string" && val.startsWith("eq.") ? val.slice(3) : val;
}

async function parseFilters(
  table: string,
  params: Record<string, any>,
  startIdx = 1
): Promise<{ clauses: string[]; values: any[]; idx: number }> {
  const clauses: string[] = [];
  const values: any[] = [];
  let idx = startIdx;

  for (const [key, rawVal] of Object.entries(params || {})) {
    if (key.startsWith("_") || META_PARAMS.has(key)) continue;
    const val = normalizeValue(rawVal);

    const [col, op] = key.includes("__") ? key.split("__") : [key, "eq"];
    await assertColumn(table, col);

    switch (op) {
      case "eq":
        clauses.push(`${col} = $${idx++}`);
        values.push(val);
        break;
      case "neq":
        clauses.push(`${col} != $${idx++}`);
        values.push(val);
        break;
      case "in": {
        const inVals = String(val).split(",");
        const placeholders = inVals.map(() => `$${idx++}`).join(",");
        clauses.push(`${col} IN (${placeholders})`);
        values.push(...inVals);
        break;
      }
      case "is":
      case "not_is": {
        const literal = String(val).toLowerCase();
        if (!["null", "true", "false"].includes(literal)) {
          throw new HttpError(400, `Valor inválido para ${op}: ${val}`);
        }
        clauses.push(`${col} IS ${op === "not_is" ? "NOT " : ""}${literal.toUpperCase()}`);
        break;
      }
      case "gte":
      case "lte":
      case "gt":
      case "lt": {
        const sym = { gte: ">=", lte: "<=", gt: ">", lt: "<" }[op];
        clauses.push(`${col} ${sym} $${idx++}`);
        values.push(val);
        break;
      }
      default:
        throw new HttpError(400, `Operador inválido: ${op}`);
    }
  }

  return { clauses, values, idx };
}

/** Condições de isolamento (empresa, linha própria, settings) para não-superadmin. */
function tenantClauses(
  table: string,
  user: AuthUser,
  startIdx: number,
  op: Op,
  alias?: string
): { clauses: string[]; values: any[] } {
  if (isSuper(user)) return { clauses: [], values: [] };
  const clauses: string[] = [];
  const values: any[] = [];
  let idx = startIdx;
  const col = (c: string) => (alias ? `${alias}.${c}` : c);

  if (table === "platform_settings") {
    if (op === "read") {
      clauses.push(`${col("key")} <> ALL($${idx++}::text[])`);
      values.push(SECRET_SETTINGS);
      // Chaves por empresa (sufixo UUID) só da própria empresa
      clauses.push(`(${col("key")} !~* '${UUID_SUFFIX_REGEX}' OR ${col("key")} LIKE '%' || $${idx++})`);
      values.push(user.company_id);
    } else {
      clauses.push(`${col("key")} = ANY($${idx++}::text[])`);
      values.push(adminWritableSettingKeys(user));
    }
    return { clauses, values };
  }

  const scope = scopeCondition(table, user, idx, alias);
  if (scope) {
    clauses.push(scope.sql);
    values.push(...scope.params);
    idx += scope.params.length;
  }

  if (roleOf(user) === "user" && USER_ROW_SCOPE[table]) {
    clauses.push(USER_ROW_SCOPE[table](`$${idx++}`).replace(/^(\w+)/, (m) => col(m)));
    values.push(user.user_id);
  }

  if (table === "company_permissions" && op !== "read") {
    clauses.push(`${col("permission")} = ANY($${idx++}::text[])`);
    values.push(ADMIN_EDITABLE_PERMISSIONS);
  }

  return { clauses, values };
}

function adminWritableSettingKeys(user: AuthUser): string[] {
  return user.company_id ? [`hygienization_minutes_${user.company_id}`] : [];
}

/** Valida e prepara um registro a ser gravado por um não-superadmin. */
async function prepareWrite(
  table: string,
  item: Record<string, any>,
  user: AuthUser,
  mode: "insert" | "update"
): Promise<Record<string, any>> {
  const data: Record<string, any> = {};
  for (const [k, v] of Object.entries(item)) {
    if (k.startsWith("_")) continue;
    await assertColumn(table, k);
    data[k] = v;
  }

  if (isSuper(user)) return data;
  const role = roleOf(user) as Role;

  if (mode === "update") delete data.id;

  const allowedCols = WRITABLE_COLUMNS_NON_SUPER[table]?.[role];
  if (allowedCols) {
    const blocked = Object.keys(data).filter((k) => !allowedCols.includes(k));
    if (blocked.length) {
      throw new HttpError(403, `Campos não permitidos para o seu perfil: ${blocked.join(", ")}`);
    }
  }

  const scope = TENANT_SCOPES_COMPANY_COLUMN(table);
  if (scope && mode === "insert" && data[scope] == null) {
    data[scope] = user.company_id;
  }

  if (table === "audit_logs") {
    data.company_id = user.company_id;
    data.user_id = user.user_id;
  }

  if (table === "platform_settings" && mode === "insert") {
    if (!adminWritableSettingKeys(user).includes(data.key)) {
      throw new HttpError(403, "Configuração restrita ao superadministrador");
    }
  }

  if (table === "company_permissions" && data.permission != null && !ADMIN_EDITABLE_PERMISSIONS.includes(data.permission)) {
    throw new HttpError(403, "Permissão restrita ao superadministrador");
  }

  await assertReferencesInTenant(data, user);
  return data;
}

function TENANT_SCOPES_COMPANY_COLUMN(table: string): string | null {
  const companyTables = [
    "company_branding", "company_permissions", "company_whatsapp", "company_notification_templates",
    "departamentos", "setores", "funcionarios_clientes", "lockers", "locker_waitlist",
    "renewal_requests", "audit_logs", "profiles",
  ];
  return companyTables.includes(table) ? "company_id" : null;
}

const serializeValue = (v: any) =>
  v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;

// GET /api/compat/:table - SELECT
router.get("/:table", async (req: Request, res: Response) => {
  const { table } = req.params;
  try {
    checkPolicy(table, "read", req.user!);
    const { clauses, values, idx } = await parseFilters(table, req.query as Record<string, any>);
    const tenant = tenantClauses(table, req.user!, idx, "read");
    clauses.push(...tenant.clauses);
    values.push(...tenant.values);

    let query = `SELECT * FROM ${table}`;
    if (clauses.length > 0) query += ` WHERE ${clauses.join(" AND ")}`;

    if (req.query._order) {
      const orderCol = String(req.query._order);
      await assertColumn(table, orderCol);
      const dir = req.query._asc === "false" ? "DESC" : "ASC";
      query += ` ORDER BY ${orderCol} ${dir}`;
    }

    const limit = parseInt(String(req.query._limit ?? req.query.limit ?? ""), 10);
    if (Number.isFinite(limit) && limit > 0) query += ` LIMIT ${Math.min(limit, 10000)}`;

    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (err: any) {
    sendError(res, err);
  }
});

// POST /api/compat/:table - INSERT
router.post("/:table", async (req: Request, res: Response) => {
  const { table } = req.params;
  try {
    checkPolicy(table, "insert", req.user!);
    const raw = req.body.data || req.body;
    const isArray = Array.isArray(raw);
    const items: Record<string, any>[] = isArray ? raw : [raw];
    const results: any[] = [];

    for (const item of items) {
      const data = await prepareWrite(table, item, req.user!, "insert");
      const keys = Object.keys(data);
      if (keys.length === 0) throw new HttpError(400, "Nenhum campo informado");
      const vals = keys.map((k) => serializeValue(data[k]));
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

      const { rows } = await pool.query(
        `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        vals
      );
      results.push(rows[0]);
    }

    res.json(isArray ? results : results[0]);
  } catch (err: any) {
    sendError(res, err);
  }
});

// PUT /api/compat/:table - UPDATE/UPSERT
router.put("/:table", async (req: Request, res: Response) => {
  const { table } = req.params;
  const user = req.user!;
  try {
    const body = { ...(req.body.data || req.body) };
    const params = req.body.params || req.query;
    const isUpsert = body._upsert;
    const conflictRaw: string | null = body._onConflict || null;
    delete body._upsert;
    delete body._onConflict;
    delete body.params;

    const columns = await getColumns(table);
    const touchUpdatedAt = columns.has("updated_at");

    if (isUpsert) {
      checkPolicy(table, "insert", user);
      checkPolicy(table, "update", user);

      const data = await prepareWrite(table, body, user, "insert");
      const conflictCols = (conflictRaw || "id").split(",").map((c) => c.trim());
      for (const c of conflictCols) await assertColumn(table, c);

      const keys = Object.keys(data);
      const vals = keys.map((k) => serializeValue(data[k]));
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const updateKeys = keys.filter((k) => !conflictCols.includes(k));
      const sets = updateKeys.map((k) => `${k} = EXCLUDED.${k}`);
      if (touchUpdatedAt) sets.push("updated_at = NOW()");

      // Só atualiza a linha existente se ela for da empresa do usuário
      const tenant = tenantClauses(table, user, keys.length + 1, "update", table);
      const conflictAction = sets.length
        ? `DO UPDATE SET ${sets.join(", ")}${tenant.clauses.length ? ` WHERE ${tenant.clauses.join(" AND ")}` : ""}`
        : "DO NOTHING";

      const { rows } = await pool.query(
        `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})
         ON CONFLICT (${conflictCols.join(", ")}) ${conflictAction} RETURNING *`,
        [...vals, ...tenant.values]
      );
      if (!rows[0]) throw new HttpError(403, "Registro pertence a outra empresa ou não pode ser alterado");
      return res.json(rows[0]);
    }

    checkPolicy(table, "update", user);
    const data = await prepareWrite(table, body, user, "update");
    const updateKeys = Object.keys(data);
    if (updateKeys.length === 0) throw new HttpError(400, "Nenhum campo para atualizar");

    const updateVals = updateKeys.map((k) => serializeValue(data[k]));
    const sets = updateKeys.map((k, i) => `${k} = $${i + 1}`);
    if (touchUpdatedAt) sets.push("updated_at = NOW()");

    const { clauses, values, idx } = await parseFilters(table, params as Record<string, any>, updateKeys.length + 1);
    if (clauses.length === 0 && !isSuper(user)) {
      throw new HttpError(400, "Informe um filtro para a atualização");
    }
    const tenant = tenantClauses(table, user, idx, "update");
    clauses.push(...tenant.clauses);

    let query = `UPDATE ${table} SET ${sets.join(", ")}`;
    if (clauses.length > 0) query += ` WHERE ${clauses.join(" AND ")}`;
    query += ` RETURNING *`;

    const { rows } = await pool.query(query, [...updateVals, ...values, ...tenant.values]);
    res.json(rows);
  } catch (err: any) {
    sendError(res, err);
  }
});

// DELETE /api/compat/:table - DELETE
router.delete("/:table", async (req: Request, res: Response) => {
  const { table } = req.params;
  const user = req.user!;
  try {
    checkPolicy(table, "delete", user);

    // Frontend usa supabase.from("lockers").delete().eq("id", ...) → compat
    if (table === "lockers") {
      const lockerId = normalizeValue(req.query.id) as string | undefined;
      if (!lockerId) {
        return res.status(400).json({ error: "Informe o id do armário para excluir." });
      }
      if (!(await rowInTenant("lockers", lockerId, user))) {
        return res.status(404).json({ error: "Armário não encontrado" });
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

    const { clauses, values, idx } = await parseFilters(table, req.query as Record<string, any>);
    if (clauses.length === 0 && !isSuper(user)) {
      throw new HttpError(400, "Informe um filtro para a exclusão");
    }
    const tenant = tenantClauses(table, user, idx, "delete");
    clauses.push(...tenant.clauses);

    let query = `DELETE FROM ${table}`;
    if (clauses.length > 0) query += ` WHERE ${clauses.join(" AND ")}`;
    query += ` RETURNING *`;

    const { rows } = await pool.query(query, [...values, ...tenant.values]);
    res.json(rows);
  } catch (err: any) {
    sendError(res, err);
  }
});

export { router as compatRouter };
