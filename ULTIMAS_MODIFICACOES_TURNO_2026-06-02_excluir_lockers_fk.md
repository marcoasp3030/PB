## Correção aplicada (2026-06-02) — Exclusão de armários sem violar FK

- **Erro original:** ao excluir armário, violação de FK em `locker_reservations.locker_id` por causa de registros existentes apontando para `lockers.id`.
- **Causa no backend:** `DELETE /api/lockers/:id` apagava apenas `locker_doors`, mas não removia `locker_reservations` e `locker_waitlist`, e ainda existia FK circular envolvendo `locker_doors.scheduled_reservation_id`.
- **Correção implementada:**
  - Antes de deletar reservas, o backend zera `locker_doors.scheduled_reservation_id` para o armário alvo.
  - Depois deleta `locker_reservations` e `locker_waitlist` pelo `locker_id`.
  - Em seguida deleta `locker_doors` e por fim o registro em `lockers`.
- **Arquivo alterado:** `backend/src/routes/lockers.ts`

