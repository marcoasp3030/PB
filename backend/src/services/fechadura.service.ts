/**
 * Fila de comandos das fechaduras, isolada por empresa.
 *
 * Roteamento dos comandos:
 *   - Comando com company_id C vai para o agente da empresa C (chave própria), se C tiver agente ativo.
 *   - Caso contrário (ou company_id nulo), vai para o agente global legado (fechaduras_api_key).
 */
import crypto from "crypto";
import { pool } from "../config/database";
import { HttpError, isUuid } from "./tenant";

export type Agente = { id: string | null; company_id: string | null; global: boolean };

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): string {
  return `pbk_${crypto.randomBytes(24).toString("hex")}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Porta exata que será aberta (com o armário/placa e a empresa dona). */
export type DoorTarget = {
  door_id: string;
  locker_id: string;
  lock_id: number;
  company_id: string;
  board_address: string | null;
  board_port: number | null;
  status: string;
  occupied_by_person: string | null;
};

const DOOR_SELECT = `
  SELECT ld.id AS door_id, ld.locker_id, ld.lock_id, ld.status, ld.occupied_by_person,
         l.company_id, l.board_address, l.board_port
    FROM locker_doors ld JOIN lockers l ON l.id = ld.locker_id`;

/**
 * Resolve a porta a ser aberta. O lock_id é o número do relé NA PLACA do armário, então
 * se repete entre armários — por isso o alvo é sempre a porta (door_id).
 *   - door_id: porta exata (recomendado);
 *   - lock_id (+ locker_id opcional): só aceito se identificar UMA porta no escopo.
 * `companyId` restringe à empresa (null = qualquer empresa, só para superadmin/agente global).
 */
export async function resolveDoor(opts: {
  doorId?: string | null;
  lockId?: number | null;
  lockerId?: string | null;
  companyId: string | null;
}): Promise<DoorTarget> {
  const { doorId, lockId, lockerId, companyId } = opts;
  let rows: DoorTarget[];

  if (doorId) {
    if (!isUuid(doorId)) throw new HttpError(404, "Porta não encontrada.");
    ({ rows } = await pool.query(
      `${DOOR_SELECT} WHERE ld.id = $1 AND ($2::uuid IS NULL OR l.company_id = $2::uuid)`,
      [doorId, companyId]
    ));
  } else if (lockId) {
    ({ rows } = await pool.query(
      `${DOOR_SELECT}
        WHERE ld.lock_id = $1
          AND ($2::uuid IS NULL OR l.company_id = $2::uuid)
          AND ($3::uuid IS NULL OR l.id = $3::uuid)`,
      [lockId, companyId, isUuid(lockerId) ? lockerId : null]
    ));
    if (rows.length > 1) {
      throw new HttpError(
        409,
        `A fechadura ${lockId} existe em ${rows.length} portas/armários. Informe door_id (ou locker_id) para abrir a porta certa.`
      );
    }
  } else {
    throw new HttpError(400, "Informe door_id ou lock_id.");
  }

  const target = rows[0];
  if (!target) throw new HttpError(404, "Porta/fechadura não encontrada na sua empresa.");
  if (!target.lock_id) throw new HttpError(422, "Esta porta não possui fechadura (lock_id) vinculada.");
  await assertBoardUnambiguous(target);
  return target;
}

/**
 * Sem endereço de placa, o agente usa a placa padrão dele. Isso só é seguro se nenhuma
 * outra porta da empresa — também sem placa configurada — usar o mesmo lock_id.
 */
async function assertBoardUnambiguous(target: DoorTarget): Promise<void> {
  if (target.board_address && target.board_address.trim()) return;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM locker_doors ld JOIN lockers l ON l.id = ld.locker_id
      WHERE l.company_id = $1 AND ld.lock_id = $2 AND ld.id <> $3
        AND COALESCE(TRIM(l.board_address), '') = ''`,
    [target.company_id, target.lock_id, target.door_id]
  );
  if (rows[0].total > 0) {
    throw new HttpError(
      422,
      "Este armário não tem o endereço da placa configurado e outro armário usa o mesmo número de fechadura. " +
        "Configure o endereço da placa (IP) de cada armário para o agente acionar a placa certa."
    );
  }
}

export async function enqueueOpenCommand(
  target: DoorTarget,
  origem: string,
  personId: string | null
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO comandos_fechadura (acao, lock_id, status, origem, person_id, company_id, door_id, locker_id)
     VALUES ('abrir', $1, 'pendente', $2, $3, $4, $5, $6)
     RETURNING id`,
    [target.lock_id, origem, personId, target.company_id, target.door_id, target.locker_id]
  );
  return rows[0].id;
}

/** Condição SQL dos comandos que um agente pode consumir/ver. */
export function agentCommandFilter(agente: Agente, paramIndex: number, alias = "cf") {
  if (agente.global) {
    return {
      sql: `(${alias}.company_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM fechadura_agentes a WHERE a.company_id = ${alias}.company_id AND a.ativo))`,
      params: [] as any[],
    };
  }
  return { sql: `${alias}.company_id = $${paramIndex}`, params: [agente.company_id] };
}
