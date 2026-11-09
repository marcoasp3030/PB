import { Request, Response, NextFunction } from "express";
import { pool } from "../config/database";
import { hashApiKey, safeEqual } from "../services/fechadura.service";

/**
 * Autenticação por API Key para o agente IoT das fechaduras.
 *
 * Aceita o token via header `X-API-Key` ou query `?api_key=`.
 *   1. Chave de empresa (tabela fechadura_agentes) → o agente só vê/abre fechaduras daquela empresa.
 *   2. Chave global legada (platform_settings.fechaduras_api_key) → agente da plataforma
 *      (atende empresas que ainda não têm agente próprio).
 *
 * A chave é SEMPRE exigida — não existe mais "modo aberto" quando nada está configurado.
 */
export async function apiKeyMiddleware(req: Request, res: Response, next: NextFunction) {
  const tokenFromHeader = req.headers["x-api-key"] as string | undefined;
  const tokenFromQuery = req.query.api_key as string | undefined;
  const token = (tokenFromHeader || tokenFromQuery || "").trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "API Key não fornecida. Envie via header X-API-Key ou query param api_key.",
    });
  }

  try {
    // 1) Chave por empresa
    const { rows: agentRows } = await pool.query(
      `SELECT a.id, a.company_id, c.active AS company_active
         FROM fechadura_agentes a JOIN companies c ON c.id = a.company_id
        WHERE a.api_key_hash = $1 AND a.ativo LIMIT 1`,
      [hashApiKey(token)]
    );
    if (agentRows[0]) {
      if (agentRows[0].company_active === false) {
        return res.status(403).json({ success: false, error: "Empresa suspensa." });
      }
      req.agente = { id: agentRows[0].id, company_id: agentRows[0].company_id, global: false };
      return next();
    }

    // 2) Chave global legada
    const { rows } = await pool.query(
      `SELECT value FROM platform_settings WHERE key = 'fechaduras_api_key' LIMIT 1`
    );
    const storedRaw = rows[0]?.value;
    const storedKey =
      typeof storedRaw === "string"
        ? storedRaw
        : storedRaw && typeof storedRaw === "object"
        ? String((storedRaw as any).key || "")
        : "";

    if (storedKey && safeEqual(token, storedKey)) {
      req.agente = { id: null, company_id: null, global: true };
      return next();
    }

    console.warn(`[API-KEY] Chave inválida para ${req.method} ${req.path}`);
    return res.status(403).json({ success: false, error: "API Key inválida." });
  } catch (err: any) {
    console.error("[API-KEY] Erro ao validar API Key:", err);
    return res.status(500).json({ success: false, error: "Erro interno ao validar autenticação." });
  }
}
