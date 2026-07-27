-- Migration: colunas de placa de fechaduras em armários (lockers)
-- Necessário em bancos criados antes de abril/2026.
-- Uso:
--   docker exec -i pblocker-db psql -U admin -d pblocker < scripts/migration-lockers-board-address.sql
--   psql -U admin -d pblocker -h localhost -p 5433 -f scripts/migration-lockers-board-address.sql

ALTER TABLE public.lockers
  ADD COLUMN IF NOT EXISTS board_address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS board_port integer DEFAULT 4370;
