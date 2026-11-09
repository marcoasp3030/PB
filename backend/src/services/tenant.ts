/**
 * Isolamento multi-tenant (empresa = tenant).
 *
 * Regras centrais usadas pela rota /compat e pelas rotas específicas:
 *   - superadmin enxerga e altera tudo;
 *   - admin/user só enxergam e alteram registros da própria empresa (profiles.company_id);
 *   - referências a outros registros (locker_id, person_id, ...) precisam pertencer à mesma empresa.
 */
import { Request, Response, NextFunction } from "express";
import { pool } from "../config/database";

export type AuthUser = NonNullable<Express.Request["user"]>;

type Queryable = { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> };

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_REGEX.test(v);

export const isSuper = (u?: AuthUser | null) => u?.role === "superadmin";
export const isAdminOrAbove = (u?: AuthUser | null) => u?.role === "admin" || u?.role === "superadmin";

// ------------------------------------------------------------
// Como cada tabela se liga a uma empresa
// ------------------------------------------------------------
type Scope =
  | { kind: "companyId" } // a própria tabela companies (id)
  | { kind: "company"; column: string } // coluna company_id direta
  | { kind: "locker"; column: string } // via lockers.company_id
  | { kind: "user"; column: string }; // pertence ao usuário logado

const company = (column = "company_id"): Scope => ({ kind: "company", column });

export const TENANT_SCOPES: Record<string, Scope> = {
  companies: { kind: "companyId" },
  company_branding: company(),
  company_permissions: company(),
  company_whatsapp: company(),
  company_notification_templates: company(),
  departamentos: company(),
  setores: company(),
  funcionarios_clientes: company(),
  lockers: company(),
  locker_waitlist: company(),
  renewal_requests: company(),
  audit_logs: company(),
  profiles: company(),
  locker_doors: { kind: "locker", column: "locker_id" },
  locker_reservations: { kind: "locker", column: "locker_id" },
  notifications: { kind: "user", column: "user_id" },
};

/**
 * Retorna a condição SQL que restringe `table` à empresa do usuário.
 * `null` para superadmin (sem restrição). Lança erro se a tabela não tiver escopo definido.
 */
export function scopeCondition(
  table: string,
  user: AuthUser,
  paramIndex: number,
  alias?: string
): { sql: string; params: any[] } | null {
  if (isSuper(user)) return null;
  const scope = TENANT_SCOPES[table];
  if (!scope) throw new HttpError(403, "Acesso restrito ao superadministrador");
  const col = (c: string) => (alias ? `${alias}.${c}` : c);
  const p = `$${paramIndex}`;

  switch (scope.kind) {
    case "companyId":
      return { sql: `${col("id")} = ${p}`, params: [user.company_id] };
    case "company":
      return { sql: `${col(scope.column)} = ${p}`, params: [user.company_id] };
    case "locker":
      return {
        sql: `${col(scope.column)} IN (SELECT id FROM lockers WHERE company_id = ${p})`,
        params: [user.company_id],
      };
    case "user":
      return { sql: `${col(scope.column)} = ${p}`, params: [user.user_id] };
  }
}

/** Verifica se o registro `id` de `table` existe e pertence à empresa do usuário. */
export async function rowInTenant(
  table: string,
  id: unknown,
  user: AuthUser,
  db: Queryable = pool
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const scope = scopeCondition(table, user, 2);
  const { rows } = await db.query(
    `SELECT 1 FROM ${table} WHERE id = $1${scope ? ` AND ${scope.sql}` : ""} LIMIT 1`,
    [id, ...(scope?.params || [])]
  );
  return rows.length > 0;
}

/** Igual a rowInTenant, mas responde 404 automaticamente. Retorna false se já respondeu. */
export async function ensureRowInTenant(
  res: Response,
  table: string,
  id: unknown,
  user: AuthUser,
  notFoundMessage = "Registro não encontrado"
): Promise<boolean> {
  if (await rowInTenant(table, id, user)) return true;
  res.status(404).json({ error: notFoundMessage });
  return false;
}

// Colunas que apontam para registros de uma empresa (snake_case e camelCase)
const REFERENCE_COLUMNS: Record<string, string> = {
  locker_id: "lockers",
  lockerId: "lockers",
  door_id: "locker_doors",
  doorId: "locker_doors",
  person_id: "funcionarios_clientes",
  personId: "funcionarios_clientes",
  occupied_by_person: "funcionarios_clientes",
  departamento_id: "departamentos",
  setor_id: "setores",
  scheduled_reservation_id: "locker_reservations",
};

/**
 * Valida que company_id/companyId (se informados) são da empresa do usuário
 * e que toda referência conhecida aponta para um registro da mesma empresa.
 * Lança HttpError(403) em caso de violação.
 */
export async function assertReferencesInTenant(
  data: Record<string, any> | null | undefined,
  user: AuthUser,
  db: Queryable = pool
): Promise<void> {
  if (!data || isSuper(user)) return;

  for (const key of ["company_id", "companyId"]) {
    if (data[key] != null && data[key] !== user.company_id) {
      throw new HttpError(403, "Acesso restrito à sua empresa");
    }
  }

  for (const [key, table] of Object.entries(REFERENCE_COLUMNS)) {
    const value = data[key];
    if (value == null || value === "") continue;
    if (!(await rowInTenant(table, value, user, db))) {
      throw new HttpError(403, `Referência inválida ou de outra empresa: ${key}`);
    }
  }
}

/**
 * Handler para router.param(): garante que o :param é um registro da empresa do usuário.
 * Ex.: router.param("id", tenantParam("lockers", "Armário não encontrado"))
 */
export function tenantParam(table: string, notFoundMessage = "Registro não encontrado") {
  return async (req: Request, res: Response, next: NextFunction, value: string) => {
    if (!req.user) return res.status(401).json({ error: "Não autenticado" });
    try {
      if (await rowInTenant(table, value, req.user)) return next();
      res.status(404).json({ error: notFoundMessage });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}

/** Handler para router.param("companyId"): não-superadmin só acessa a própria empresa. */
export function companyIdParam(req: Request, res: Response, next: NextFunction, value: string) {
  if (!req.user) return res.status(401).json({ error: "Não autenticado" });
  if (isSuper(req.user) || value === req.user.company_id) return next();
  res.status(403).json({ error: "Acesso restrito à sua empresa" });
}

/** Middleware: valida company_id e referências do corpo (sem preencher nada). */
export async function bodyRefsGuard(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Não autenticado" });
  try {
    await assertReferencesInTenant(req.body, req.user);
    next();
  } catch (err: any) {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message });
  }
}

/**
 * Middleware para rotas que recebem companyId/personId/lockerId no corpo
 * (notificações, UAZAPI etc.). Preenche companyId com a empresa do usuário quando ausente.
 */
export async function tenantBodyGuard(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "Não autenticado" });
  if (isSuper(user)) return next();

  try {
    if (req.body && typeof req.body === "object") {
      if (req.body.companyId == null && req.body.company_id == null) {
        req.body.companyId = user.company_id;
      }
      await assertReferencesInTenant(req.body, user);
    }
    next();
  } catch (err: any) {
    res.status(err instanceof HttpError ? err.status : 500).json({ error: err.message });
  }
}

// ------------------------------------------------------------
// Cache de colunas (whitelist de identificadores SQL)
// ------------------------------------------------------------
const columnsCache = new Map<string, Set<string>>();

export async function getColumns(table: string): Promise<Set<string>> {
  const cached = columnsCache.get(table);
  if (cached) return cached;
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const cols = new Set<string>(rows.map((r: any) => r.column_name));
  if (cols.size > 0) columnsCache.set(table, cols);
  return cols;
}

/** Garante que `name` é uma coluna real da tabela (evita SQL injection por identificador). */
export async function assertColumn(table: string, name: string): Promise<void> {
  const cols = await getColumns(table);
  if (!cols.has(name)) throw new HttpError(400, `Coluna inválida: ${name}`);
}
