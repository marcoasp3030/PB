import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../config/database";

const JWT_SECRET = process.env.JWT_SECRET || "change-me";

/**
 * Valida o JWT e carrega o usuário.
 *   - Token com versão antiga (senha trocada, papel alterado...) é recusado.
 *   - Usuário de empresa suspensa (companies.active = false) é recusado (exceto superadmin).
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  let decoded: { sub: string; tv?: number };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as { sub: string; tv?: number };
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.user_id, p.role, p.company_id, p.full_name, u.email,
              u.token_version, c.active AS company_active
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN companies c ON c.id = p.company_id
       WHERE p.user_id = $1`,
      [decoded.sub]
    );

    const row = rows[0];
    if (!row) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    if ((decoded.tv ?? 0) !== (row.token_version ?? 0)) {
      return res.status(401).json({ error: "Sessão encerrada. Faça login novamente." });
    }

    if (row.role !== "superadmin" && row.company_active === false) {
      return res.status(403).json({
        error: "Empresa suspensa. Entre em contato com o administrador da plataforma.",
        code: "company_suspended",
      });
    }

    const { token_version: _tv, company_active: _ca, ...user } = row;
    req.user = user;
    next();
  } catch (err: any) {
    console.error("[AUTH] Erro ao validar sessão:", err);
    return res.status(500).json({ error: "Erro ao validar sessão" });
  }
}
