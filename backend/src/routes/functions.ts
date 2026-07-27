/**
 * Functions route - proxies calls that previously went to Edge Functions.
 * Now delegates to dedicated route handlers.
 */
import { Router, Request, Response } from "express";
import { pool } from "../config/database";
import bcrypt from "bcryptjs";
import axios from "axios";
const router = Router();

// POST /api/functions/create-company-user
router.post("/create-company-user", async (req: Request, res: Response) => {
  if (req.user!.role !== "superadmin") {
    return res.status(403).json({ error: "Acesso restrito ao superadministrador" });
  }

  const { email, password, full_name, company_id, role } = req.body;
  if (!email || !password || !company_id) {
    return res.status(400).json({ error: "E-mail, senha e empresa são obrigatórios" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, email_confirmed, raw_user_meta_data)
       VALUES ($1, $2, true, $3) RETURNING id, email`,
      [email.toLowerCase().trim(), passwordHash, JSON.stringify({ full_name: full_name || "" })]
    );

    const newUser = rows[0];
    const userRole = ["admin", "user"].includes(role) ? role : "admin";

    await client.query(
      `INSERT INTO profiles (user_id, full_name, company_id, role, password_changed)
       VALUES ($1, $2, $3, $4, false)`,
      [newUser.id, full_name || "", company_id, userRole]
    );

    await client.query("COMMIT");
    res.json({ success: true, user_id: newUser.id, message: `Usuário ${email} criado com sucesso` });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/functions/create-person-login
router.post("/create-person-login", async (req: Request, res: Response) => {
  const { person_id, email, password, send_whatsapp, send_email } = req.body;
  if (!person_id || !email || !password) {
    return res.status(400).json({ error: "Dados obrigatórios ausentes" });
  }

  const emailNorm = String(email).toLowerCase().trim();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: personRows } = await client.query(
      `SELECT id, company_id, nome, user_id FROM funcionarios_clientes WHERE id = $1`,
      [person_id]
    );
    if (personRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Pessoa não encontrada" });
    }
    const person = personRows[0];

    let userId: string;
    let reusedExistingUser = false;

    if (person.user_id) {
      // Já vinculada: apenas redefine a senha
      userId = person.user_id;
      reusedExistingUser = true;
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query(
        `UPDATE users SET password_hash = $1, email_confirmed = true, email = $2 WHERE id = $3`,
        [passwordHash, emailNorm, userId]
      );
    } else {
      const { rows: existingUsers } = await client.query(
        `SELECT id FROM users WHERE email = $1`,
        [emailNorm]
      );

      if (existingUsers.length > 0) {
        userId = existingUsers[0].id;
        reusedExistingUser = true;

        const { rows: otherPerson } = await client.query(
          `SELECT id, nome FROM funcionarios_clientes
           WHERE user_id = $1 AND id <> $2 LIMIT 1`,
          [userId, person_id]
        );
        if (otherPerson.length > 0) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: `Este e-mail já está vinculado a outra pessoa (${otherPerson[0].nome}).`,
          });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        await client.query(
          `UPDATE users SET password_hash = $1, email_confirmed = true WHERE id = $2`,
          [passwordHash, userId]
        );
      } else {
        const passwordHash = await bcrypt.hash(password, 12);
        const { rows: newUserRows } = await client.query(
          `INSERT INTO users (email, password_hash, email_confirmed, raw_user_meta_data)
           VALUES ($1, $2, true, $3) RETURNING id`,
          [emailNorm, passwordHash, JSON.stringify({ full_name: person.nome || "" })]
        );
        userId = newUserRows[0].id;
      }
    }

    const { rows: profileRows } = await client.query(
      `SELECT user_id FROM profiles WHERE user_id = $1`,
      [userId]
    );
    if (profileRows.length > 0) {
      await client.query(
        `UPDATE profiles
         SET company_id = COALESCE($2, company_id),
             full_name = COALESCE(NULLIF($3, ''), full_name),
             password_changed = false,
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId, person.company_id, person.nome || ""]
      );
    } else {
      await client.query(
        `INSERT INTO profiles (user_id, full_name, company_id, role, password_changed)
         VALUES ($1, $2, $3, 'user', false)`,
        [userId, person.nome || "", person.company_id]
      );
    }

    await client.query(
      `UPDATE funcionarios_clientes SET user_id = $1, email = $2, updated_at = NOW() WHERE id = $3`,
      [userId, emailNorm, person_id]
    );

    await client.query("COMMIT");

    const notifications: any[] = [];
    if (send_whatsapp) notifications.push({ channel: "whatsapp", success: false, reason: "not_configured" });
    if (send_email) notifications.push({ channel: "email", success: false, reason: "not_configured" });

    const action = reusedExistingUser ? "atualizado" : "criado";
    res.json({
      message: `Acesso ${action} para ${emailNorm}`,
      user_id: userId,
      notifications,
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: "Este e-mail já está cadastrado no sistema." });
    }
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Proxy to dedicated routes for migrated Edge Functions
router.post("/:functionName", async (req: Request, res: Response) => {
  const { functionName } = req.params;
  const apiBase = `http://localhost:${process.env.PORT || 3001}/api`;
  
  const routeMap: Record<string, string> = {
    "send-smtp-email": "/smtp/send",
    "test-smtp": "/smtp/test",
    "email-locker-notify": "/email-notify",
    "whatsapp-locker-notify": "/whatsapp-notify",
    "uazapi-proxy": "/uazapi-proxy",
    "waitlist-notify": "/waitlist-notify",
  };

  const targetPath = routeMap[functionName];
  if (targetPath) {
    try {
      const { data } = await axios.post(`${apiBase}${targetPath}`, req.body, {
        headers: { Authorization: req.headers.authorization || "" },
      });
      return res.json(data);
    } catch (err: any) {
      const status = err.response?.status || 500;
      return res.status(status).json(err.response?.data || { error: err.message });
    }
  }

  res.status(404).json({ error: `Function ${functionName} not implemented` });
});

export { router as functionsRouter };
