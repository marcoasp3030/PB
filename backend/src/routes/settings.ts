import { Router, Request, Response } from "express";
import { pool } from "../config/database";
import { companyIdParam, isSuper } from "../services/tenant";
import { requireSuperAdmin } from "../middleware/permissions";

const router = Router();

// Isolamento multi-tenant: todo :param abaixo precisa ser da empresa do usuário
router.param("companyId", companyIdParam);


// ============================================
// GET /api/settings
// ============================================
// Nunca expostas a não-superadmin (credenciais globais da plataforma)
const SECRET_SETTINGS = ["fechaduras_api_key", "smtp_config", "uazapi_admin_token", "uazapi_server_url", "whatsapp_webhook_secret"];

router.get("/", async (req: Request, res: Response) => {
  try {
    if (!isSuper(req.user)) {
      // Chaves por empresa (sufixo UUID) só da própria empresa
      const { rows } = await pool.query(
        `SELECT key, value FROM platform_settings
         WHERE key <> ALL($1::text[])
           AND (key !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR key LIKE '%' || $2)`,
        [SECRET_SETTINGS, req.user!.company_id]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query(`SELECT key, value FROM platform_settings`);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/settings/:key
// ============================================
router.put("/:key", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { value } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO platform_settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
       RETURNING *`,
      [req.params.key, JSON.stringify(value)]
    );

    // Save history
    await pool.query(
      `INSERT INTO platform_settings_history (setting_key, value, changed_by)
       VALUES ($1, $2, $3)`,
      [req.params.key, JSON.stringify(value), req.user!.user_id]
    );

    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/settings/history
// ============================================
router.get("/history", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT h.*, p.full_name as changed_by_name
       FROM platform_settings_history h
       LEFT JOIN profiles p ON p.user_id = h.changed_by
       ORDER BY h.created_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/settings/branding/:companyId
// ============================================
router.get("/branding/:companyId", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM company_branding WHERE company_id = $1`,
      [req.params.companyId]
    );
    res.json(rows[0] || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/settings/branding/:companyId
// ============================================
router.put("/branding/:companyId", async (req: Request, res: Response) => {
  if (req.user!.role !== "superadmin" && req.params.companyId !== req.user!.company_id) {
    return res.status(403).json({ error: "Acesso restrito" });
  }

  try {
    const { logo_url, sidebar_logo_url, favicon_url, login_bg_url,
      platform_name, login_title, login_subtitle, theme_colors } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO company_branding (company_id, logo_url, sidebar_logo_url, favicon_url,
       login_bg_url, platform_name, login_title, login_subtitle, theme_colors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (company_id) DO UPDATE SET
       logo_url = COALESCE($2, company_branding.logo_url),
       sidebar_logo_url = COALESCE($3, company_branding.sidebar_logo_url),
       favicon_url = COALESCE($4, company_branding.favicon_url),
       login_bg_url = COALESCE($5, company_branding.login_bg_url),
       platform_name = COALESCE($6, company_branding.platform_name),
       login_title = COALESCE($7, company_branding.login_title),
       login_subtitle = COALESCE($8, company_branding.login_subtitle),
       theme_colors = COALESCE($9, company_branding.theme_colors),
       updated_at = NOW()
       RETURNING *`,
      [req.params.companyId, logo_url, sidebar_logo_url, favicon_url,
       login_bg_url, platform_name, login_title, login_subtitle,
       theme_colors ? JSON.stringify(theme_colors) : null]
    );

    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// GET /api/settings/permissions/:companyId
// ============================================
router.get("/permissions/:companyId", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM company_permissions WHERE company_id = $1`,
      [req.params.companyId]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PUT /api/settings/permissions/:companyId
// ============================================
router.put("/permissions/:companyId", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { permission, enabled } = req.body;

    const { rows } = await pool.query(
      `INSERT INTO company_permissions (company_id, permission, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, permission) DO UPDATE SET enabled = $3, updated_at = NOW()
       RETURNING *`,
      [req.params.companyId, permission, enabled]
    );

    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as settingsRouter };
