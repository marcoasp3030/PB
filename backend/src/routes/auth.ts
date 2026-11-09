import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { validate } from "../middleware/validate";
import { pool } from "../config/database";
import {
  authenticateUser,
  createUser,
  changePassword,
  resetPassword,
  issueTokenForUser,
  CompanySuspendedError,
} from "../services/auth.service";
import { authMiddleware } from "../middleware/auth";
import { sendEmail } from "../services/email.service";
import rateLimit from "express-rate-limit";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max: 30,
  message: { error: "Muitas tentativas de login. Tente novamente mais tarde." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// POST /api/auth/login
// ============================================
const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(128),
});

router.post("/login", loginLimiter, validate(loginSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    // Check lockout
    const { rows: lockout } = await pool.query(
      `SELECT * FROM get_login_lockout_status($1)`,
      [email]
    );
    if (lockout[0]?.bloqueado) {
      await pool.query(`SELECT register_login_attempt($1, $2)`, [email, false]);
      return res.status(429).json({
        error: lockout[0].mensagem,
        lockout: {
          blocked: true,
          seconds_remaining: lockout[0].segundos_restantes,
        },
      });
    }

    const result = await authenticateUser(email, password);

    // Run non-critical queries in parallel for speed
    const [profileResult] = await Promise.all([
      pool.query(
        `SELECT role, company_id, full_name, password_changed FROM profiles WHERE user_id = $1`,
        [result.user.id]
      ),
      pool.query(`SELECT register_login_attempt($1, $2)`, [email, true]),
      pool.query(
        `INSERT INTO audit_logs (user_id, action, resource_type, category, details, user_agent, ip_address)
         VALUES ($1, 'login_success', 'auth', 'auth', '{}', $2, $3)`,
        [result.user.id, req.headers["user-agent"] || "", req.ip || ""]
      ),
    ]);

    res.json({
      token: result.token,
      user: {
        id: result.user.id,
        email: result.user.email,
        ...profileResult.rows[0],
      },
    });
  } catch (err: any) {
    if (err instanceof CompanySuspendedError) {
      return res.status(403).json({ error: err.message, code: "company_suspended" });
    }

    // Run failed-login queries in parallel
    const [, lockoutResult] = await Promise.all([
      pool.query(
        `INSERT INTO audit_logs (action, resource_type, category, details, user_agent, ip_address)
         VALUES ('login_failed', 'auth', 'auth', $1, $2, $3)`,
        [JSON.stringify({ email }), req.headers["user-agent"] || "", req.ip || ""]
      ),
      (async () => {
        await pool.query(`SELECT register_login_attempt($1, $2)`, [email, false]);
        // Re-check lockout AFTER registering the attempt
        const { rows } = await pool.query(
          `SELECT * FROM get_login_lockout_status($1)`,
          [email]
        );
        return rows;
      })(),
    ]);

    const lockout = lockoutResult[0];

    res.status(401).json({
      error: lockout?.mensagem || "Credenciais inválidas",
      lockout: lockout
        ? {
            blocked: lockout.bloqueado,
            attempts_remaining: lockout.tentativas_restantes,
            seconds_remaining: lockout.segundos_restantes,
            level: lockout.nivel,
          }
        : null,
    });
  }
});

// ============================================
// POST /api/auth/register
// ============================================
const registerSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(128),
  full_name: z.string().trim().min(1).max(100),
});

router.post("/register", validate(registerSchema), async (req: Request, res: Response) => {
  const { email, password, full_name } = req.body;

  try {
    const user = await createUser(email, password, full_name);
    res.status(201).json({ message: "Conta criada com sucesso", user_id: user.id });
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Este e-mail já está cadastrado" });
    }
    res.status(500).json({ error: "Erro ao criar conta" });
  }
});

// ============================================
// GET /api/auth/me
// ============================================
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.user_id, p.role, p.company_id, p.full_name, p.avatar_url,
              p.password_changed, u.email
       FROM profiles p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1`,
      [req.user!.user_id]
    );

    if (!rows[0]) return res.status(404).json({ error: "Perfil não encontrado" });

    res.json({ user: { id: rows[0].user_id, ...rows[0] } });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao carregar perfil" });
  }
});

// ============================================
// POST /api/auth/change-password
// ============================================
// Aceita snake_case e camelCase (o portal envia currentPassword/newPassword)
const changePasswordSchema = z
  .object({
    current_password: z.string().min(1).optional(),
    currentPassword: z.string().min(1).optional(),
    new_password: z.string().min(6).max(128).optional(),
    newPassword: z.string().min(6).max(128).optional(),
  })
  .transform((d) => ({
    current_password: d.current_password ?? d.currentPassword ?? "",
    new_password: d.new_password ?? d.newPassword ?? "",
  }))
  .refine((d) => d.current_password.length > 0, { message: "Informe a senha atual", path: ["current_password"] })
  .refine((d) => d.new_password.length >= 6, { message: "A nova senha deve ter ao menos 6 caracteres", path: ["new_password"] });

router.post("/change-password", authMiddleware, validate(changePasswordSchema), async (req: Request, res: Response) => {
  const userId = req.user!.user_id;
  try {
    // Troca a senha e encerra as outras sessões; devolve um token novo para esta
    await changePassword(userId, req.body.current_password, req.body.new_password);
    const token = await issueTokenForUser(userId);

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, category, company_id)
       VALUES ($1, 'password_change', 'auth', 'auth', $2)`,
      [userId, req.user!.company_id]
    );

    res.json({ message: "Senha alterada com sucesso", token });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================
// POST /api/auth/forgot-password
// ============================================
const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(255),
});

router.post("/forgot-password", loginLimiter, validate(forgotPasswordSchema), async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    // Always return success to prevent email enumeration
    const { rows: userRows } = await pool.query(
      `SELECT u.id, u.email FROM users u WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );

    if (!userRows[0]) {
      // Don't reveal that the email doesn't exist
      return res.json({ message: "Se o e-mail existir, enviaremos um link de redefinição." });
    }

    const user = userRows[0];

    // Invalidate any previous tokens for this user
    await pool.query(
      `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
      [user.id]
    );

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt.toISOString()]
    );

    // Build reset URL
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    // Load custom email template from platform_settings
    const { rows: templateRows } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'recovery_email_template' LIMIT 1`
    );
    const tmpl = (templateRows[0]?.value as Record<string, any>) || {};

    const primaryColor = tmpl.primary_color || "#2563eb";
    const heading = tmpl.heading || "Redefinir sua senha";
    const body = tmpl.body || "Você solicitou a redefinição de sua senha. Clique no botão abaixo para criar uma nova senha.";
    const buttonText = tmpl.button_text || "Redefinir Senha";
    const footer = tmpl.footer || "Este link expira em 1 hora. Se você não solicitou esta redefinição, ignore este e-mail.";
    const logoUrl = tmpl.logo_url || "";

    // Load SMTP config from platform_settings or env
    const { rows: smtpRows } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'smtp_config' LIMIT 1`
    );
    const smtpConfig = smtpRows[0]?.value as Record<string, any> | null;
    const fromName = smtpConfig?.from_name || "Sistema";

    const html = `
      <div style="max-width:520px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:${primaryColor};padding:32px 24px;text-align:center;">
          ${logoUrl ? `<img src="${logoUrl}" alt="Logo" style="height:40px;margin-bottom:16px;" />` : ""}
          <h1 style="color:#ffffff;font-size:22px;margin:0;font-weight:700;">${heading}</h1>
        </div>
        <div style="padding:32px 24px;">
          <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px;">${body}</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:${primaryColor};color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">${buttonText}</a>
          </div>
          <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:24px 0 0;text-align:center;">${footer}</p>
        </div>
        <div style="background:#f9fafb;padding:16px 24px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">© ${new Date().getFullYear()} ${fromName}</p>
        </div>
      </div>
    `;

    // Try custom SMTP first, then env SMTP
    let emailSent = false;

    if (smtpConfig?.enabled && smtpConfig?.host) {
      try {
        const nodemailer = require("nodemailer");
        const portNum = parseInt(smtpConfig.port, 10);
        const useTls = smtpConfig.encryption === "tls" || smtpConfig.encryption === "ssl";

        const transporter = nodemailer.createTransport({
          host: smtpConfig.host,
          port: portNum,
          secure: useTls && portNum === 465,
          auth: smtpConfig.user && smtpConfig.password
            ? { user: smtpConfig.user, pass: smtpConfig.password }
            : undefined,
          tls: useTls ? { rejectUnauthorized: false } : undefined,
        });

        await transporter.sendMail({
          from: `${fromName} <${smtpConfig.from_email || smtpConfig.user}>`,
          to: email,
          subject: tmpl.subject || "Recuperação de Senha",
          html,
        });
        emailSent = true;
      } catch (e) {
        console.error("Custom SMTP failed, trying env SMTP:", e);
      }
    }

    if (!emailSent) {
      // Fallback to env-based SMTP
      emailSent = await sendEmail({
        to: email,
        subject: tmpl.subject || "Recuperação de Senha",
        html,
      });
    }

    if (!emailSent) {
      console.error("Failed to send password reset email to:", email);
    }

    // Audit log
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, category, details)
       VALUES ($1, 'password_reset_requested', 'auth', 'auth', $2)`,
      [user.id, JSON.stringify({ email })]
    );

    res.json({ message: "Se o e-mail existir, enviaremos um link de redefinição." });
  } catch (err: any) {
    console.error("forgot-password error:", err);
    res.status(500).json({ error: "Erro interno ao processar solicitação" });
  }
});

// ============================================
// POST /api/auth/reset-password
// ============================================
const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6).max(128),
});

router.post("/reset-password", validate(resetPasswordSchema), async (req: Request, res: Response) => {
  const { token, password } = req.body;

  try {
    // Find valid token
    const { rows: tokenRows } = await pool.query(
      `SELECT * FROM password_reset_tokens 
       WHERE token = $1 AND used = false AND expires_at > NOW()
       LIMIT 1`,
      [token]
    );

    if (!tokenRows[0]) {
      return res.status(400).json({ error: "Token inválido ou expirado. Solicite um novo link de redefinição." });
    }

    const resetToken = tokenRows[0];

    // Update password
    await resetPassword(resetToken.user_id, password);

    // Mark token as used
    await pool.query(
      `UPDATE password_reset_tokens SET used = true WHERE id = $1`,
      [resetToken.id]
    );

    // Mark password as changed in profiles
    await pool.query(
      `UPDATE profiles SET password_changed = true WHERE user_id = $1`,
      [resetToken.user_id]
    );

    // Audit log
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, category)
       VALUES ($1, 'password_reset_completed', 'auth', 'auth')`,
      [resetToken.user_id]
    );

    res.json({ message: "Senha redefinida com sucesso! Faça login com sua nova senha." });
  } catch (err: any) {
    console.error("reset-password error:", err);
    res.status(500).json({ error: "Erro ao redefinir senha" });
  }
});

export { router as authRouter };
