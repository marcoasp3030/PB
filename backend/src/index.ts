import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { testConnection } from "./config/database";
import { authMiddleware } from "./middleware/auth";
import { startExpireDoorsJob } from "./cron/expire-doors";

// Routes
import { authRouter } from "./routes/auth";
import { healthRouter } from "./routes/health";
import { companiesRouter } from "./routes/companies";
import { lockersRouter } from "./routes/lockers";
import { peopleRouter } from "./routes/people";
import { departmentsRouter } from "./routes/departments";
import { sectorsRouter } from "./routes/sectors";
import { notificationsRouter } from "./routes/notifications";
import { renewalsRouter } from "./routes/renewals";
import { waitlistRouter } from "./routes/waitlist";
import { auditRouter } from "./routes/audit";
import { settingsRouter } from "./routes/settings";
import { adminRouter } from "./routes/admin";
import { uploadRouter } from "./routes/upload";
import { reservationsRouter } from "./routes/reservations";
import { emailRouter } from "./routes/email";
import { whatsappRouter } from "./routes/whatsapp";
import { compatRouter } from "./routes/compat";
import { rpcRouter } from "./routes/rpc";
import { functionsRouter } from "./routes/functions";
import { smtpRouter } from "./routes/smtp";
import { emailNotifyRouter } from "./routes/email-notify";
import { whatsappNotifyRouter } from "./routes/whatsapp-notify";
import { whatsappWebhookRouter } from "./routes/whatsapp-webhook";
import { uazapiProxyRouter } from "./routes/uazapi-proxy";
import { waitlistNotifyRouter } from "./routes/waitlist-notify";
import { systemUpdateRouter } from "./routes/system-update";
import { changelogRouter } from "./routes/changelog";
import { fechadurasRouter } from "./routes/fechaduras";
import { mobileRouter } from "./routes/mobile";
import { requireAdminOrAbove, requireSuperAdmin } from "./middleware/permissions";
import { tenantBodyGuard } from "./services/tenant";
import { runTenantMigrations } from "./config/tenant-migrations";

const app = express();
app.set("trust proxy", 1);
const PORT = parseInt(process.env.PORT || "3001");

// ============================================
// Global Middleware
// ============================================
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições sem Origin (health checks, curl, server-to-server)
    if (!origin) return callback(null, true);

    const staticAllowed = new Set<string>([
      process.env.FRONTEND_URL || "http://localhost:5173",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ]);

    const extras = process.env.CORS_ORIGENS_ADICIONAIS || "";
    extras
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((o) => staticAllowed.add(o));

    const isLovableOrigin = /^https:\/\/[\w-]+\.lovable\.app$/i.test(origin)
      || /^https:\/\/[\w-]+\.lovableproject\.com$/i.test(origin);

    if (staticAllowed.has(origin) || isLovableOrigin) {
      return callback(null, true);
    }

    console.warn(`[CORS] Origin bloqueada: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// Static files (uploads)
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
app.use("/uploads", express.static(path.resolve(UPLOAD_DIR)));
// O upload devolve URLs em ${API_URL}/uploads/... (API_URL termina em /api)
app.use("/api/uploads", express.static(path.resolve(UPLOAD_DIR)));

// ============================================
// Public Routes (no auth required)
// ============================================
app.use("/api/auth", authRouter);
app.use("/api/health", healthRouter);

// Webhook routes (no auth - validated by their own mechanism)
app.use("/api/webhooks/whatsapp", whatsappWebhookRouter);

// Public changelog
app.use("/api/changelog", changelogRouter);

// Fechaduras IoT - sem auth na fase inicial (agente Python consulta)
app.use("/api/fechaduras", fechadurasRouter);

// Mobile API (JWT auth handled internally)
app.use("/api/mobile", mobileRouter);

// ============================================
// Protected Routes
// ============================================
app.use("/api/companies", authMiddleware, companiesRouter);
app.use("/api/lockers", authMiddleware, requireAdminOrAbove, lockersRouter); // gestão: só admin
app.use("/api/people", authMiddleware, requireAdminOrAbove, peopleRouter); // gestão: só admin
app.use("/api/departments", authMiddleware, requireAdminOrAbove, departmentsRouter); // gestão: só admin
app.use("/api/sectors", authMiddleware, requireAdminOrAbove, sectorsRouter); // gestão: só admin
app.use("/api/notifications", authMiddleware, notificationsRouter);
app.use("/api/renewals", authMiddleware, requireAdminOrAbove, renewalsRouter); // gestão: só admin
app.use("/api/waitlist", authMiddleware, requireAdminOrAbove, waitlistRouter); // gestão: só admin
app.use("/api/reservations", authMiddleware, requireAdminOrAbove, reservationsRouter); // gestão: só admin
app.use("/api/audit", authMiddleware, requireAdminOrAbove, auditRouter); // gestão: só admin
app.use("/api/settings", authMiddleware, settingsRouter);
app.use("/api/admin", authMiddleware, adminRouter);
app.use("/api/upload", authMiddleware, uploadRouter);
app.use("/api/email", authMiddleware, emailRouter);
app.use("/api/whatsapp", authMiddleware, requireSuperAdmin, whatsappRouter); // token global da plataforma
app.use("/api/compat", authMiddleware, compatRouter);
app.use("/api/rpc", rpcRouter); // Public - individual functions handle their own security
app.use("/api/functions", authMiddleware, functionsRouter);
app.use("/api/smtp", authMiddleware, requireAdminOrAbove, smtpRouter);
app.use("/api/email-notify", authMiddleware, requireAdminOrAbove, tenantBodyGuard, emailNotifyRouter);
app.use("/api/whatsapp-notify", authMiddleware, requireAdminOrAbove, tenantBodyGuard, whatsappNotifyRouter);
app.use("/api/uazapi-proxy", authMiddleware, requireAdminOrAbove, tenantBodyGuard, uazapiProxyRouter);
app.use("/api/waitlist-notify", authMiddleware, requireAdminOrAbove, tenantBodyGuard, waitlistNotifyRouter);
app.use("/api/system", authMiddleware, systemUpdateRouter);

// ============================================
// Error handler
// ============================================
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Erro interno do servidor" });
});

// ============================================
// Start
// ============================================
async function start() {
  const dbOk = await testConnection();
  if (!dbOk) {
    console.error("❌ Não foi possível conectar ao banco. Verifique DATABASE_URL.");
    process.exit(1);
  }

  // Migrações idempotentes (multi-tenant / fechaduras por empresa)
  await runTenantMigrations();

  // Start cron jobs
  startExpireDoorsJob();

  app.listen(PORT, () => {
    console.log(`🚀 Locker System API rodando na porta ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  });
}

start();
