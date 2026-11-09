/**
 * Migrações idempotentes executadas na inicialização da API.
 * Seguras para rodar várias vezes (IF NOT EXISTS) em bancos novos ou antigos.
 */
import { pool } from "./database";

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "comandos_fechadura: tabela base",
    sql: `
      CREATE TABLE IF NOT EXISTS comandos_fechadura (
        id SERIAL PRIMARY KEY,
        acao VARCHAR(20) NOT NULL,
        lock_id INT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pendente',
        resposta TEXT,
        origem VARCHAR(30) DEFAULT 'web',
        person_id UUID,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        executado_em TIMESTAMPTZ
      );
      ALTER TABLE comandos_fechadura ADD COLUMN IF NOT EXISTS person_id UUID;
    `,
  },
  {
    name: "comandos_fechadura: company_id (fila por empresa)",
    sql: `
      ALTER TABLE comandos_fechadura
        ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_comandos_fechadura_company_status
        ON comandos_fechadura (company_id, status, id);
      -- Preenche comandos antigos com a empresa dona da fechadura
      UPDATE comandos_fechadura cf
         SET company_id = sub.company_id
        FROM (
          SELECT DISTINCT ON (ld.lock_id) ld.lock_id, l.company_id
            FROM locker_doors ld JOIN lockers l ON l.id = ld.locker_id
           WHERE ld.lock_id IS NOT NULL
           ORDER BY ld.lock_id, ld.updated_at DESC
        ) sub
       WHERE cf.company_id IS NULL AND cf.lock_id = sub.lock_id;
    `,
  },
  {
    name: "company_permissions: única por (empresa, permissão)",
    sql: `
      -- Remove duplicados mantendo o registro mais recente
      DELETE FROM company_permissions cp
       USING company_permissions newer
       WHERE cp.company_id = newer.company_id
         AND cp.permission = newer.permission
         AND (cp.updated_at, cp.id) < (newer.updated_at, newer.id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_company_permissions_company_permission
        ON company_permissions (company_id, permission);
    `,
  },
  {
    name: "comandos_fechadura: porta e armário exatos (door_id / locker_id)",
    sql: `
      ALTER TABLE comandos_fechadura
        ADD COLUMN IF NOT EXISTS door_id UUID REFERENCES locker_doors(id) ON DELETE SET NULL;
      ALTER TABLE comandos_fechadura
        ADD COLUMN IF NOT EXISTS locker_id UUID REFERENCES lockers(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_comandos_fechadura_door ON comandos_fechadura (door_id);
      -- Comandos antigos: preenche só quando o lock_id é inequívoco dentro da empresa
      UPDATE comandos_fechadura cf
         SET door_id = sub.door_id, locker_id = sub.locker_id
        FROM (
          SELECT ld.lock_id, l.company_id, MIN(ld.id::text)::uuid AS door_id, MIN(l.id::text)::uuid AS locker_id
            FROM locker_doors ld JOIN lockers l ON l.id = ld.locker_id
           WHERE ld.lock_id IS NOT NULL
           GROUP BY ld.lock_id, l.company_id
          HAVING COUNT(*) = 1
        ) sub
       WHERE cf.door_id IS NULL AND cf.lock_id = sub.lock_id AND cf.company_id = sub.company_id;
    `,
  },
  {
    name: "locker_doors: lock_id único dentro do mesmo armário",
    sql: `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM locker_doors WHERE lock_id IS NOT NULL
          GROUP BY locker_id, lock_id HAVING COUNT(*) > 1
        ) THEN
          RAISE WARNING 'Há portas do mesmo armário com lock_id repetido — corrija para ativar a restrição uq_locker_doors_locker_lock.';
        ELSE
          CREATE UNIQUE INDEX IF NOT EXISTS uq_locker_doors_locker_lock
            ON locker_doors (locker_id, lock_id) WHERE lock_id IS NOT NULL;
        END IF;
      END $$;
    `,
  },
  {
    name: "users: token_version (encerrar sessões)",
    sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;`,
  },
  {
    name: "company_whatsapp: segredo do webhook por empresa",
    sql: `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      ALTER TABLE company_whatsapp ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
      ALTER TABLE company_whatsapp ALTER COLUMN webhook_secret SET DEFAULT encode(gen_random_bytes(24), 'hex');
      UPDATE company_whatsapp SET webhook_secret = encode(gen_random_bytes(24), 'hex') WHERE webhook_secret IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_company_whatsapp_webhook_secret ON company_whatsapp (webhook_secret);
      INSERT INTO platform_settings (key, value)
        VALUES ('whatsapp_webhook_secret', to_jsonb(encode(gen_random_bytes(24), 'hex')))
        ON CONFLICT (key) DO NOTHING;
    `,
  },
  {
    name: "fechadura_agentes: chave de API por empresa",
    sql: `
      CREATE TABLE IF NOT EXISTS fechadura_agentes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        nome TEXT NOT NULL DEFAULT 'Agente',
        api_key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        last_seen_at TIMESTAMPTZ,
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_fechadura_agentes_company ON fechadura_agentes (company_id);
    `,
  },
];

export async function runTenantMigrations(): Promise<void> {
  for (const m of MIGRATIONS) {
    try {
      await pool.query(m.sql);
    } catch (err: any) {
      console.error(`❌ Migração falhou (${m.name}):`, err.message);
      throw err;
    }
  }
  console.log(`✅ Migrações multi-tenant aplicadas (${MIGRATIONS.length})`);
}
