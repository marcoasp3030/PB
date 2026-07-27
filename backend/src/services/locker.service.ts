import type { PoolClient } from "pg";

/** Remove armário e dependências na ordem correta (evita violação de FK). */
export async function excluirArmario(
  client: PoolClient,
  lockerId: string
): Promise<boolean> {
  await client.query(
    `UPDATE locker_doors
     SET scheduled_reservation_id = NULL
     WHERE locker_id = $1 AND scheduled_reservation_id IS NOT NULL`,
    [lockerId]
  );

  await client.query(
    `DELETE FROM renewal_requests
     WHERE door_id IN (SELECT id FROM locker_doors WHERE locker_id = $1)`,
    [lockerId]
  );

  await client.query(`DELETE FROM locker_reservations WHERE locker_id = $1`, [lockerId]);
  await client.query(`DELETE FROM locker_waitlist WHERE locker_id = $1`, [lockerId]);
  await client.query(`DELETE FROM locker_doors WHERE locker_id = $1`, [lockerId]);

  const { rows } = await client.query(
    `DELETE FROM lockers WHERE id = $1 RETURNING id`,
    [lockerId]
  );

  return rows.length > 0;
}
