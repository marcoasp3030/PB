import { Router, Request, Response } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { requireSuperAdmin, requireAdminOrAbove } from "../middleware/permissions";
import { pool } from "../config/database";
import { whatsappWebhookUrl } from "../services/whatsapp-webhook.service";
import { tenantParam, companyIdParam, isSuper } from "../services/tenant";
import { createUserWithCompany, resetPassword, revokeSessions } from "../services/auth.service";

const router = Router();

// Isolamento multi-tenant: todo :param abaixo precisa ser da empresa do usuário
router.param("companyId", companyIdParam);
router.param("id", tenantParam("company_notification_templates", "Template não encontrado"));


// ============================================
// POST /api/admin/users - Create company user (superadmin)
// ============================================
const createUserSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(6).max(128),
  full_name: z.string().trim().min(1).max(100),
  company_id: z.string().uuid().nullable().optional(),
  role: z.enum(["admin", "user", "superadmin"]).default("admin"),
});

router.post("/users", requireSuperAdmin, validate(createUserSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, full_name, company_id, role } = req.body;

    // Superadmin não exige company_id; admin/user exigem
    if (role !== "superadmin" && !company_id) {
      return res.status(400).json({ error: "company_id é obrigatório para admin/user" });
    }

    const user = await createUserWithCompany(email, password, full_name, company_id || null, role);

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, category, details, company_id)
       VALUES ($1, 'user_created', 'profile', 'admin', $2, $3)`,
      [req.user!.user_id, JSON.stringify({ created_email: email, role, company_id }), company_id || null]
    );

    res.status(201).json({ user_id: user.id, message: `Usuário ${email} criado com sucesso` });
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Este e-mail já está cadastrado" });
    }
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/admin/users - List all users (superadmin)
// ============================================
router.get("/users", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.email, c.name as company_name
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN companies c ON c.id = p.company_id
       ORDER BY u.email`
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/admin/users/:userId/role
// ============================================
router.put("/users/:userId/role", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { role } = req.body;
    if (!["user", "admin", "superadmin"].includes(role)) {
      return res.status(400).json({ error: "Papel inválido" });
    }

    const { rows } = await pool.query(
      `UPDATE profiles SET role = $2, updated_at = NOW() WHERE user_id = $1 RETURNING *`,
      [req.params.userId, role]
    );

    if (!rows[0]) return res.status(404).json({ error: "Usuário não encontrado" });

    // Papel mudou: sessões antigas (com o papel anterior) deixam de valer
    await revokeSessions(req.params.userId);

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, resource_type, category, details)
       VALUES ($1, 'permission_change', 'profile', 'admin', $2)`,
      [req.user!.user_id, JSON.stringify({ target_user: req.params.userId, new_role: role })]
    );

    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/admin/users/:userId/reset-password
// ============================================
router.put("/users/:userId/reset-password", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Senha deve ter pelo menos 6 caracteres" });
    }

    await resetPassword(req.params.userId, password);

    await pool.query(
      `UPDATE profiles SET password_changed = false WHERE user_id = $1`,
      [req.params.userId]
    );

    res.json({ message: "Senha resetada com sucesso" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/admin/profiles
// ============================================
router.get("/profiles", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    if (req.user!.role === "superadmin") {
      const { rows } = await pool.query(
        `SELECT p.*, u.email FROM profiles p JOIN users u ON u.id = p.user_id ORDER BY p.full_name`
      );
      return res.json(rows);
    }

    const { rows } = await pool.query(
      `SELECT p.*, u.email FROM profiles p JOIN users u ON u.id = p.user_id
       WHERE p.company_id = $1 ORDER BY p.full_name`,
      [req.user!.company_id]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/admin/profiles/:userId
// ============================================
router.put("/profiles/:userId", async (req: Request, res: Response) => {
  // Users can update their own profile, admins can update company profiles
  if (req.user!.role === "user" && req.params.userId !== req.user!.user_id) {
    return res.status(403).json({ error: "Acesso restrito" });
  }

  try {
    const { full_name, avatar_url } = req.body;
    // Admin só edita perfis da própria empresa
    const scoped = !isSuper(req.user) && req.params.userId !== req.user!.user_id;
    const { rows } = await pool.query(
      `UPDATE profiles SET full_name = COALESCE($2, full_name),
       avatar_url = COALESCE($3, avatar_url), updated_at = NOW()
       WHERE user_id = $1 ${scoped ? "AND company_id = $4" : ""} RETURNING *`,
      scoped
        ? [req.params.userId, full_name, avatar_url, req.user!.company_id]
        : [req.params.userId, full_name, avatar_url]
    );

    if (!rows[0]) return res.status(404).json({ error: "Perfil não encontrado" });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/admin/whatsapp-webhook-global (superadmin)
// URL única para o webhook global da UAZAPI; a empresa é identificada pela instância do payload.
// ============================================
router.get("/whatsapp-webhook-global", requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'whatsapp_webhook_secret' LIMIT 1`
    );
    const secret = typeof rows[0]?.value === "string" ? rows[0].value : null;
    res.json({ webhook_url: secret ? whatsappWebhookUrl(secret) : null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// WhatsApp config per company
// ============================================
router.get("/whatsapp/:companyId", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM company_whatsapp WHERE company_id = $1`,
      [req.params.companyId]
    );
    if (!rows[0]) return res.json(null);
    // Segredos nunca saem inteiros pela API
    const { instance_token, webhook_secret, ...rest } = rows[0];
    res.json({
      ...rest,
      instance_token: instance_token ? `${String(instance_token).slice(0, 4)}••••` : null,
      webhook_url: webhook_secret ? whatsappWebhookUrl(webhook_secret) : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/whatsapp/:companyId", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { instance_name, instance_token, phone_number, status } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO company_whatsapp (company_id, instance_name, instance_token, phone_number, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id) DO UPDATE SET
       instance_name = COALESCE($2, company_whatsapp.instance_name),
       instance_token = COALESCE($3, company_whatsapp.instance_token),
       phone_number = COALESCE($4, company_whatsapp.phone_number),
       status = COALESCE($5, company_whatsapp.status),
       updated_at = NOW()
       RETURNING *`,
      [req.params.companyId, instance_name, instance_token, phone_number, status || "disconnected"]
    );

    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// Notification templates
// ============================================
router.get("/templates/:companyId", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM company_notification_templates WHERE company_id = $1 ORDER BY type`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/templates/:id", requireAdminOrAbove, async (req: Request, res: Response) => {
  try {
    const { template_text, footer, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE company_notification_templates SET
       template_text = COALESCE($2, template_text),
       footer = COALESCE($3, footer),
       active = COALESCE($4, active),
       updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, template_text, footer, active]
    );

    if (!rows[0]) return res.status(404).json({ error: "Template não encontrado" });
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as adminRouter };
