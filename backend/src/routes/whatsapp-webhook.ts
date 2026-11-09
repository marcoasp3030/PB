/**
 * WhatsApp webhook route - migrated from whatsapp-webhook Edge Function.
 * Processes button clicks and text commands from WhatsApp users.
 *
 * SEGURANÇA: a origem é comprovada pela URL com segredo da empresa
 * (/api/webhooks/whatsapp/<segredo>) ou pelo token da instância no payload.
 * A pessoa é identificada por telefone exato, só dentro da empresa.
 */
import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { pool } from "../config/database";
import { findPersonByPhone, resolveWebhookCompany } from "../services/whatsapp-webhook.service";

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

async function getActiveReservation(personId: string, companyId: string) {
  const { rows } = await pool.query(
    `SELECT ld.id, ld.door_number, ld.label, ld.locker_id, ld.expires_at, ld.status, ld.usage_type
       FROM locker_doors ld JOIN lockers l ON l.id = ld.locker_id
      WHERE ld.occupied_by_person = $1 AND ld.status = 'occupied' AND l.company_id = $2
      LIMIT 1`,
    [personId, companyId]
  );
  return rows[0] || null;
}

async function renewalsEnabled(companyId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT enabled FROM company_permissions WHERE company_id = $1 AND permission = 'manage_renewals' LIMIT 1`,
    [companyId]
  );
  return rows[0]?.enabled !== false;
}

async function sendReply(baseUrl: string, token: string, phone: string, text: string) {
  await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "token": token },
    body: JSON.stringify({ number: phone, text }),
  });
}

function parseTextCommand(text: string): string | null {
  const n = text.trim().toLowerCase();
  if (["status", "detalhes", "minha reserva", "1"].includes(n)) return "btn_view_details";
  if (["renovar", "estender", "renew", "2"].includes(n)) return "btn_extend";
  if (["renovar 1h", "+1h", "renovar +1h"].includes(n)) return "btn_renew_1h";
  if (["renovar 2h", "+2h", "renovar +2h"].includes(n)) return "btn_renew_2h";
  if (["liberar", "release", "soltar", "3"].includes(n)) return "btn_release";
  if (["liberar agora"].includes(n)) return "btn_release_now";
  if (["ajuda", "help", "como funciona", "?"].includes(n)) return "btn_how_it_works";
  if (["disponíveis", "disponiveis", "ver disponiveis", "portas"].includes(n)) return "btn_view_available";
  if (["reservar", "nova reserva"].includes(n)) return "btn_new_reservation";
  if (["histórico", "historico", "history"].includes(n)) return "btn_history";
  return null;
}

// POST /api/webhooks/whatsapp/:secret
router.post("/:secret?", webhookLimiter, async (req: Request, res: Response) => {
  try {
    const body = req.body;

    const company = await resolveWebhookCompany(req.params.secret, body);
    if (!company) {
      console.warn(`[WEBHOOK-WA] Origem não comprovada (ip=${req.ip}) — mensagem ignorada`);
      return res.status(401).json({ ok: false, error: "Webhook não autorizado" });
    }

    const event = body?.data || body;
    const key = event?.key || body?.key;
    // Mensagens enviadas pela própria empresa não são comandos
    if (key?.fromMe === true || event?.fromMe === true || body?.message?.fromMe === true) {
      return res.json({ ok: true, skipped: "from_me" });
    }

    const remoteJid = key?.remoteJid || "";
    const senderPhone = remoteJid.replace("@s.whatsapp.net", "").replace("@c.us", "");
    if (!senderPhone || remoteJid.includes("@g.us")) {
      return res.json({ ok: true, skipped: "no_sender" });
    }

    // Detect button click or text command
    let buttonId: string | null = null;
    const buttonResponse = event?.data?.buttonResponseMessage || event?.buttonResponseMessage;
    if (buttonResponse?.selectedButtonId) {
      buttonId = buttonResponse.selectedButtonId;
    }

    if (!buttonId) {
      const messageText =
        event?.data?.message?.conversation ||
        event?.data?.message?.extendedTextMessage?.text ||
        event?.message?.conversation ||
        event?.message?.extendedTextMessage?.text || "";
      if (messageText) buttonId = parseTextCommand(messageText);
    }

    if (!buttonId) {
      return res.json({ ok: true, skipped: "not_actionable" });
    }

    const { rows: serverRows } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'uazapi_server_url' LIMIT 1`
    );
    const serverUrl = serverRows[0]?.value as string;
    if (!serverUrl) return res.json({ ok: true, skipped: "no_uazapi" });

    const person = await findPersonByPhone(company.company_id, senderPhone);
    console.log(`[WEBHOOK-WA] empresa=${company.company_id} ação=${buttonId} pessoa=${person?.id || "não identificada"}`);

    const baseUrl = (serverUrl as string).replace(/\/$/, "");
    const companyId = company.company_id;
    let replyText = "";

    switch (buttonId) {
      case "btn_view_details": {
        if (!person) { replyText = "❌ Não foi possível identificar seu cadastro."; break; }
        const door = await getActiveReservation(person.id, companyId);
        if (!door) { replyText = "📦 Você não tem nenhuma reserva ativa no momento."; break; }
        const { rows: lockerRows } = await pool.query(`SELECT name, location FROM lockers WHERE id = $1`, [door.locker_id]);
        const locker = lockerRows[0];
        const doorLabel = door.label || `Porta #${door.door_number}`;
        const expiresTime = door.expires_at ? new Date(door.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "Sem prazo";
        replyText = `📋 *Detalhes da sua reserva*\n\n📦 *Porta:* ${doorLabel}\n🏢 *Armário:* ${locker?.name || "—"}\n📍 *Local:* ${locker?.location || "—"}\n⏰ *Expira às:* ${expiresTime}`;
        break;
      }
      case "btn_extend":
      case "btn_renew_1h":
      case "btn_renew_2h": {
        // Renovação pelo WhatsApp segue o mesmo fluxo do portal: vira solicitação para o admin aprovar
        if (!person) { replyText = "❌ Não identificado."; break; }
        if (!(await renewalsEnabled(companyId))) { replyText = "ℹ️ Renovações não estão disponíveis para sua empresa."; break; }
        const door = await getActiveReservation(person.id, companyId);
        if (!door) { replyText = "📦 Sem reserva ativa para renovar."; break; }
        if (!door.expires_at) { replyText = "ℹ️ Reserva permanente, não precisa renovar."; break; }
        const hours = buttonId === "btn_renew_2h" ? 2 : 1;
        const { rows: pending } = await pool.query(
          `SELECT 1 FROM renewal_requests WHERE person_id = $1 AND door_id = $2 AND status = 'pending' LIMIT 1`,
          [person.id, door.id]
        );
        if (pending[0]) { replyText = "⏳ Você já tem uma solicitação de renovação aguardando aprovação."; break; }
        await pool.query(
          `INSERT INTO renewal_requests (company_id, door_id, person_id, requested_hours) VALUES ($1, $2, $3, $4)`,
          [companyId, door.id, person.id, hours]
        );
        replyText = `📨 *Solicitação enviada!* Pedido de +${hours}h para ${door.label || `Porta #${door.door_number}`}. Você será avisado quando o administrador aprovar.`;
        break;
      }
      case "btn_release":
      case "btn_release_now": {
        if (!person) { replyText = "❌ Não identificado."; break; }
        const door = await getActiveReservation(person.id, companyId);
        if (!door) { replyText = "📦 Sem reserva ativa."; break; }
        if (door.usage_type !== "temporary") {
          replyText = "ℹ️ Esta porta é de uso fixo. Para liberar, fale com o administrador.";
          break;
        }
        const now = new Date().toISOString();
        await pool.query(`UPDATE locker_doors SET status = 'available', occupied_by = NULL, occupied_at = NULL, occupied_by_person = NULL, usage_type = 'temporary', expires_at = NULL, scheduled_reservation_id = NULL WHERE id = $1`, [door.id]);
        await pool.query(`UPDATE locker_reservations SET status = 'released', released_at = $1 WHERE door_id = $2 AND status = 'active'`, [now, door.id]);
        replyText = `🔓 *Porta liberada!* ${door.label || `Porta #${door.door_number}`}`;
        break;
      }
      case "btn_how_it_works":
        replyText = `❓ *Como funciona?*\n\n1️⃣ Reservar\n2️⃣ Usar\n3️⃣ Renovar\n4️⃣ Liberar\n\nComandos: *status*, *renovar*, *liberar*, *ajuda*`;
        break;
      case "btn_view_available":
      case "btn_see_lockers": {
        if (!person) { replyText = "❌ Não foi possível identificar seu cadastro."; break; }
        const { rows: lockers } = await pool.query(`SELECT id, name, location FROM lockers WHERE company_id = $1`, [companyId]);
        if (!lockers.length) { replyText = "📦 Nenhum armário cadastrado."; break; }
        const lockerIds = lockers.map((l: any) => l.id);
        const { rows: doors } = await pool.query(`SELECT locker_id, status FROM locker_doors WHERE locker_id = ANY($1)`, [lockerIds]);
        const summary = lockers.map((locker: any) => {
          const ld = doors.filter((d: any) => d.locker_id === locker.id);
          const avail = ld.filter((d: any) => d.status === "available").length;
          return `${avail > 0 ? "🟢" : "🔴"} *${locker.name}* — ${avail}/${ld.length} disponíveis`;
        }).join("\n");
        replyText = `🔍 *Armários*\n\n${summary}`;
        break;
      }
      case "btn_new_reservation":
        replyText = "📦 Para reservar, acesse o sistema ou peça a um administrador.\n\nResponda *disponíveis* para ver portas livres.";
        break;
      case "btn_history":
        replyText = "📊 Acesse a plataforma para ver seu histórico completo.";
        break;
      case "btn_contact_support":
        replyText = "💬 Entre em contato com o administrador da sua empresa.\n\nResponda *ajuda* para ver comandos.";
        break;
      default:
        replyText = "❓ Comando não reconhecido. Responda *ajuda*.";
    }

    try {
      await sendReply(baseUrl, company.instance_token, senderPhone, replyText);
    } catch (e: any) {
      console.warn("[WEBHOOK-WA] Falha ao enviar resposta:", e.message);
    }
    res.json({ ok: true, action: buttonId });
  } catch (error: any) {
    console.error("whatsapp-webhook error:", error.message);
    res.status(500).json({ error: "Erro ao processar webhook" });
  }
});

export { router as whatsappWebhookRouter };
