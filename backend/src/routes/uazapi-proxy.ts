/**
 * UAZAPI proxy route - migrated from uazapi-proxy Edge Function.
 * Manages WhatsApp instances (create, QR code, status, disconnect, send).
 */
import { Router, Request, Response } from "express";
import { pool } from "../config/database";
import { whatsappWebhookUrl } from "../services/whatsapp-webhook.service";

/** Melhor esforço: aponta o webhook da instância para a URL segura da empresa. */
async function configureInstanceWebhook(baseUrl: string, instanceToken: string, companyId: string) {
  try {
    const { rows } = await pool.query(`SELECT webhook_secret FROM company_whatsapp WHERE company_id = $1`, [companyId]);
    if (!rows[0]?.webhook_secret || !instanceToken) return false;
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: instanceToken },
      body: JSON.stringify({ url: whatsappWebhookUrl(rows[0].webhook_secret), enabled: true, events: ["messages"] }),
    });
    return response.ok;
  } catch (e: any) {
    console.warn("[UAZAPI] Não foi possível configurar o webhook automaticamente:", e.message);
    return false;
  }
}

const router = Router();

async function getUazapiConfig() {
  const { rows: urlRows } = await pool.query(
    `SELECT value FROM platform_settings WHERE key = 'uazapi_server_url' LIMIT 1`
  );
  const { rows: tokenRows } = await pool.query(
    `SELECT value FROM platform_settings WHERE key = 'uazapi_admin_token' LIMIT 1`
  );
  return {
    serverUrl: urlRows[0]?.value as string | null,
    adminToken: tokenRows[0]?.value as string | null,
  };
}

// POST /api/uazapi-proxy
router.post("/", async (req: Request, res: Response) => {
  try {
    const { action, companyId, instanceName, phone, message } = req.body;
    const { serverUrl, adminToken } = await getUazapiConfig();

    if (!serverUrl || !adminToken) {
      return res.status(400).json({ error: "UAZAPI não configurada. O superadmin precisa configurar a Server URL e Admin Token." });
    }

    const baseUrl = (serverUrl as string).replace(/\/$/, "");

    // Get company WhatsApp config
    const { rows: waRows } = await pool.query(
      `SELECT * FROM company_whatsapp WHERE company_id = $1 LIMIT 1`,
      [companyId]
    );
    const companyWa = waRows[0];

    if (action === "create_instance") {
      const name = instanceName || `company_${(companyId as string).substring(0, 8)}`;
      const sanitizedToken = String(adminToken).trim();

      const endpoints = ["/instance/create", "/instance/init"];
      const bodies = [{ instanceName: name }, { Name: name }, { name }, { instName: name }];
      let result: any = null;
      let success = false;

      for (const endpoint of endpoints) {
        for (const bodyPayload of bodies) {
          try {
            const response = await fetch(`${baseUrl}${endpoint}`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "admintoken": sanitizedToken },
              body: JSON.stringify(bodyPayload),
            });
            const text = await response.text();
            try { result = JSON.parse(text); } catch { result = { raw: text }; }
            if (response.ok) { success = true; break; }
          } catch { continue; }
        }
        if (success) break;
      }

      if (!success) {
        return res.status(400).json({ error: "Erro ao criar instância", details: result });
      }

      const instanceToken = result?.token || result?.data?.token || "";
      await pool.query(
        `INSERT INTO company_whatsapp (company_id, instance_name, instance_token, status) 
         VALUES ($1, $2, $3, 'disconnected') 
         ON CONFLICT (company_id) DO UPDATE SET instance_name = $2, instance_token = $3, status = 'disconnected'`,
        [companyId, name, instanceToken]
      );

      const webhookConfigured = await configureInstanceWebhook(baseUrl, instanceToken, companyId);
      return res.json({ success: true, data: result, webhook_configured: webhookConfigured });
    }

    if (action === "get_qrcode") {
      if (!companyWa?.instance_name) {
        return res.status(400).json({ error: "Instância não criada para esta empresa" });
      }
      const instToken = companyWa.instance_token || adminToken;
      const response = await fetch(`${baseUrl}/instance/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "token": String(instToken), "admintoken": String(adminToken) },
        body: JSON.stringify({}),
      });
      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      return res.status(response.ok ? 200 : response.status).json({ success: response.ok, data });
    }

    if (action === "configure_webhook") {
      if (!companyWa?.instance_token) return res.status(400).json({ error: "Instância não criada para esta empresa" });
      const ok = await configureInstanceWebhook(baseUrl, companyWa.instance_token, companyId);
      return res.status(ok ? 200 : 502).json({
        success: ok,
        webhook_url: companyWa.webhook_secret ? whatsappWebhookUrl(companyWa.webhook_secret) : null,
      });
    }

    if (action === "get_status") {
      if (!companyWa?.instance_name) {
        return res.json({ status: "not_created" });
      }
      const instToken = companyWa.instance_token || adminToken;
      const response = await fetch(`${baseUrl}/instance/status`, {
        method: "GET",
        headers: { "Content-Type": "application/json", "token": String(instToken), "admintoken": String(adminToken) },
      });
      const text = await response.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      const connected = data?.instance?.state === "open" || data?.state === "open" ||
                        data?.status === "connected" || data?.instance?.status === "connected";
      const newStatus = connected ? "connected" : "disconnected";
      const phoneNum = data?.instance?.phoneNumber || data?.phoneNumber || data?.phone || companyWa.phone_number || "";

      await pool.query(
        `UPDATE company_whatsapp SET status = $1, phone_number = $2 WHERE company_id = $3`,
        [newStatus, phoneNum, companyId]
      );

      return res.json({
        success: true,
        status: newStatus,
        phone_number: phoneNum,
        data,
        webhook_url: companyWa.webhook_secret ? whatsappWebhookUrl(companyWa.webhook_secret) : null,
      });
    }

    if (action === "disconnect") {
      if (!companyWa?.instance_name) {
        return res.status(400).json({ error: "Instância não encontrada" });
      }
      const instToken = companyWa.instance_token || adminToken;
      await fetch(`${baseUrl}/instance/disconnect`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "token": String(instToken), "admintoken": String(adminToken) },
      });
      await pool.query(
        `UPDATE company_whatsapp SET status = 'disconnected', phone_number = '' WHERE company_id = $1`,
        [companyId]
      );
      return res.json({ success: true });
    }

    if (action === "send_message") {
      if (!companyWa?.instance_token) {
        return res.status(400).json({ error: "WhatsApp não conectado para esta empresa" });
      }
      const response = await fetch(`${baseUrl}/send/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "token": String(companyWa.instance_token) },
        body: JSON.stringify({ number: phone, text: message }),
      });
      const data = await response.json();
      return res.status(response.ok ? 200 : 400).json({ success: response.ok, data });
    }

    res.status(400).json({ error: "Ação não reconhecida" });
  } catch (error: any) {
    console.error("uazapi-proxy error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

export { router as uazapiProxyRouter };
