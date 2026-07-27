/**
 * Cria empresa + superadmin quando não há usuários (PostgreSQL via DATABASE_URL).
 * Executado dentro do container pblocker-api (extensão .cjs: raiz do projeto usa "type": "module").
 *
 * Variáveis de ambiente obrigatórias: ADMIN_EMAIL, ADMIN_PASSWORD
 * Opcionais: ADMIN_NOME, EMPRESA_NOME
 */
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "";
const nomeAdmin = process.env.ADMIN_NOME || "Administrador";
const nomeEmpresa = process.env.EMPRESA_NOME || "PBLocker";

if (!email || !password) {
  console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const { rows: cnt } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (cnt[0].n > 0) {
    console.error(`Abortando: já existem ${cnt[0].n} usuário(s) na tabela users.`);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: comp } = await client.query(
      `INSERT INTO companies (name, type, description) VALUES ($1, 'employee', 'Empresa principal') RETURNING id`,
      [nomeEmpresa]
    );
    const { rows: usr } = await client.query(
      `INSERT INTO users (email, password_hash, email_confirmed) VALUES ($1, $2, true) RETURNING id`,
      [email, hash]
    );
    await client.query(
      `INSERT INTO profiles (user_id, full_name, role, company_id, password_changed)
       VALUES ($1, $2, 'superadmin', $3, false)`,
      [usr[0].id, nomeAdmin, comp[0].id]
    );
    await client.query("COMMIT");
    console.log("Superadmin criado:", email);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
