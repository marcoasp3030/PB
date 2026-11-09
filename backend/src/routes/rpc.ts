/**
 * RPC route handler - calls database functions directly.
 */
import { Router, Request, Response } from "express";
import { pool } from "../config/database";

const router = Router();

// Rota PÚBLICA: só funções de leitura sem efeito colateral.
// register_login_attempt foi removida (permitia bloquear/desbloquear o login de qualquer conta;
// o próprio /auth/login já registra as tentativas) e get_user_role (expunha o papel de usuários).
const ALLOWED_FUNCTIONS = ["get_login_lockout_status"];

// POST /api/rpc/:functionName
router.post("/:functionName", async (req: Request, res: Response) => {
  const { functionName } = req.params;

  if (!ALLOWED_FUNCTIONS.includes(functionName)) {
    return res.status(400).json({ error: `Function ${functionName} not allowed` });
  }

  try {
    const params = req.body;
    const paramNames = Object.keys(params);
    const paramValues = Object.values(params);
    const placeholders = paramNames.map((_, i) => `$${i + 1}`).join(", ");

    const fnCall = paramNames.length > 0
      ? `SELECT * FROM ${functionName}(${paramNames.map((n, i) => `${n} := $${i + 1}`).join(", ")})`
      : `SELECT * FROM ${functionName}()`;

    const { rows } = await pool.query(fnCall, paramValues);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as rpcRouter };
