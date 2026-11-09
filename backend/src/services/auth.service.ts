import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/database";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const SALT_ROUNDS = 12;

export interface AuthUser {
  id: string;
  email: string;
}

export async function createUser(
  email: string,
  password: string,
  fullName: string
): Promise<AuthUser> {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, raw_user_meta_data)
       VALUES ($1, $2, $3) RETURNING id, email`,
      [email.toLowerCase().trim(), passwordHash, JSON.stringify({ full_name: fullName })]
    );

    const user = rows[0];

    await client.query(
      `INSERT INTO profiles (user_id, full_name) VALUES ($1, $2)`,
      [user.id, fullName]
    );

    await client.query("COMMIT");
    return user;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createUserWithCompany(
  email: string,
  password: string,
  fullName: string,
  companyId: string | null,
  role: string = "admin"
): Promise<AuthUser> {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, email_confirmed, raw_user_meta_data)
       VALUES ($1, $2, true, $3) RETURNING id, email`,
      [email.toLowerCase().trim(), passwordHash, JSON.stringify({ full_name: fullName })]
    );

    const user = rows[0];

    await client.query(
      `INSERT INTO profiles (user_id, full_name, company_id, role, password_changed)
       VALUES ($1, $2, $3, $4, false)`,
      [user.id, fullName, companyId, role]
    );

    await client.query("COMMIT");
    return user;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<{ token: string; user: AuthUser }> {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.password_hash, u.token_version,
            p.role, c.active AS company_active
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       LEFT JOIN companies c ON c.id = p.company_id
      WHERE u.email = $1`,
    [email.toLowerCase().trim()]
  );

  if (!rows[0]) throw new Error("Credenciais inválidas");

  const valid = await bcrypt.compare(password, rows[0].password_hash);
  if (!valid) throw new Error("Credenciais inválidas");

  // Empresa suspensa: ninguém dela entra (exceto superadmin da plataforma)
  if (rows[0].role !== "superadmin" && rows[0].company_active === false) {
    throw new CompanySuspendedError();
  }

  const token = generateToken(rows[0].id, rows[0].email, rows[0].token_version ?? 0);
  return { token, user: { id: rows[0].id, email: rows[0].email } };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const { rows } = await pool.query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId]
  );

  if (!rows[0]) throw new Error("Usuário não encontrado");

  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) throw new Error("Senha atual incorreta");

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  // Troca a senha e encerra todas as sessões abertas (token_version + 1)
  await pool.query(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
    [newHash, userId]
  );

  await pool.query(
    `UPDATE profiles SET password_changed = true WHERE user_id = $1`,
    [userId]
  );
}

export async function resetPassword(
  userId: string,
  newPassword: string
): Promise<void> {
  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  // Redefinição de senha encerra todas as sessões abertas
  await pool.query(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2`,
    [newHash, userId]
  );
}

/** Encerra todas as sessões (JWT) do usuário — usado ao trocar papel, senha etc. */
export async function revokeSessions(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [userId]);
}

/** Novo token com a versão atual (após trocar a própria senha, por exemplo). */
export async function issueTokenForUser(userId: string): Promise<string> {
  const { rows } = await pool.query(`SELECT email, token_version FROM users WHERE id = $1`, [userId]);
  if (!rows[0]) throw new Error("Usuário não encontrado");
  return generateToken(userId, rows[0].email, rows[0].token_version ?? 0);
}

export class CompanySuspendedError extends Error {
  constructor() {
    super("Empresa suspensa. Entre em contato com o administrador da plataforma.");
  }
}

/** `tv` = token_version: tokens com versão antiga deixam de valer. */
export function generateToken(userId: string, email: string, tokenVersion = 0): string {
  return jwt.sign({ sub: userId, email, tv: tokenVersion }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}
