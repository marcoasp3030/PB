/**
 * Webhook do WhatsApp (UAZAPI) — autenticação e identificação seguras.
 *
 * Cada empresa tem uma URL própria com segredo: /api/webhooks/whatsapp/<webhook_secret>.
 * A mensagem só é processada para a empresa dona daquela URL, e a pessoa é procurada
 * por telefone EXATO (normalizado) apenas dentro dessa empresa.
 */
import { pool } from "../config/database";
import { safeEqual } from "./fechadura.service";

export function whatsappWebhookUrl(secret: string): string {
  const base = (process.env.API_URL || `http://localhost:${process.env.PORT || 3001}/api`).replace(/\/+$/, "");
  return `${base}/webhooks/whatsapp/${secret}`;
}

/**
 * Normaliza um telefone brasileiro para DDD + número e devolve as variantes
 * com e sem o nono dígito. Retorna [] se não for um número completo.
 */
export function phoneVariants(raw: string): string[] {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length === 11 && digits[2] === "9") return [digits, digits.slice(0, 2) + digits.slice(3)];
  if (digits.length === 10) return [digits, digits.slice(0, 2) + "9" + digits.slice(2)];
  if (digits.length === 11) return [digits];
  return [];
}

type CompanyWa = { company_id: string; instance_token: string };

/** Identificadores da instância que algumas versões da UAZAPI enviam no payload. */
function payloadInstance(body: any): { token: string | null; name: string | null } {
  const inst = body?.instance;
  const token = body?.token ?? body?.instanceToken ?? body?.instance_token ?? (typeof inst === "object" ? inst?.token : null);
  const name =
    body?.instanceName ?? body?.instance_name ?? body?.data?.instanceName ??
    (typeof inst === "string" ? inst : inst?.name ?? null);
  return { token: token ? String(token) : null, name: name ? String(name) : null };
}

/**
 * Descobre a empresa da mensagem:
 *   - /webhooks/whatsapp/<segredo da empresa>  → aquela empresa;
 *   - /webhooks/whatsapp/<segredo global>      → empresa pela instância informada no payload;
 *   - /webhooks/whatsapp (sem segredo)         → só se o payload trouxer o token da instância.
 * Retorna null quando a origem não pode ser comprovada.
 */
export async function resolveWebhookCompany(secret: string | undefined, body: any): Promise<CompanyWa | null> {
  const baseQuery = `
    SELECT cw.company_id, cw.instance_token
      FROM company_whatsapp cw JOIN companies c ON c.id = cw.company_id
     WHERE cw.status = 'connected' AND c.active IS NOT FALSE`;
  const { token, name } = payloadInstance(body);

  if (secret) {
    const { rows } = await pool.query(`${baseQuery} AND cw.webhook_secret = $1 LIMIT 1`, [secret]);
    if (rows[0]) return rows[0];

    const { rows: g } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'whatsapp_webhook_secret' LIMIT 1`
    );
    const globalSecret = typeof g[0]?.value === "string" ? g[0].value : "";
    if (!globalSecret || !safeEqual(secret, globalSecret)) return null;

    if (!token && !name) return null;
    const { rows: byInstance } = await pool.query(
      `${baseQuery} AND (($1::text IS NOT NULL AND cw.instance_token = $1) OR ($2::text IS NOT NULL AND cw.instance_name = $2))`,
      [token, name]
    );
    return byInstance.length === 1 ? byInstance[0] : null;
  }

  if (!token) return null;
  const { rows } = await pool.query(`${baseQuery} AND cw.instance_token = $1 LIMIT 1`, [token]);
  return rows[0] || null;
}

/** Pessoa ativa da empresa com aquele telefone. Ambíguo (2+ pessoas) → null. */
export async function findPersonByPhone(companyId: string, phone: string) {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return null;
  const { rows } = await pool.query(
    `SELECT id, nome, company_id, telefone FROM funcionarios_clientes
      WHERE company_id = $1 AND ativo = true
        AND regexp_replace(regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g'), '^55(\\d{10,11})$', '\\1') = ANY($2)
      LIMIT 2`,
    [companyId, variants]
  );
  return rows.length === 1 ? rows[0] : null;
}
