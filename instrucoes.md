# Instruções de desenvolvimento — Locker System

Registro das fases do projeto (America/Sao_Paulo).

## Fase 13 — Inventário de credenciais para migração (2026-07-27)

- **Entrega:** `CREDENCIAIS_MIGRACAO.md` com banco, `.env`, JWT, API Key fechaduras, UaZapi, usuários, volumes, Apache e checklist de dump/restore.
- **Sem alteração de código.** Arquivo confidencial — não publicar.

## Fase 12 — API Key fechaduras: logout e app sem abrir (2026-07-15)

- **Sintomas:** após gerar/ativar API Key, (1) app não abre armários; (2) ao abrir Configurações→Fechaduras o usuário é deslogado.
- **Causa logout:** `GET /fechaduras/agent-status` ficava atrás de `apiKeyMiddleware`; o painel envia JWT → 401 → interceptor do frontend limpa token e manda para `/auth`.
- **Causa app:** agente Python continua com a chave antiga (`Token inválido` em `GET /comandos`).
- **Correção:** `agent-status` com `authMiddleware` antes da API Key; interceptor não desloga em 401 de API Key; aviso na UI para atualizar o agente.

## Fase 11 — Manual do usuário leigo (2026-07-15)

- **Objetivo:** analisar todas as funcionalidades e documentar passo a passo para usuário não técnico.
- **Entrega:** `GUIA_USUARIO.md` (login, papéis, empresas, deptos/setores, pessoas, armários, dashboard, histórico, renovações, auditoria, configurações, portal, app mobile, personalização, fluxos e problemas comuns).
- **Sem alteração de código.**

## Fase 9 — Login com erro 502 (backend não conectava ao banco) (2026-06-02)

- **Sintoma:** login retorna `Request failed with status code 502`.
- **Diagnóstico:** `docker compose ps` → `pblocker-api` em `Restarting`; logs: `password authentication failed for user "admin"`.
- **Causa:** senha do volume PostgreSQL diferente da `DATABASE_URL` no `.env` (comum após recriar containers).
- **Correção:** `ALTER USER admin WITH PASSWORD '<DB_PASSWORD do .env>';` no `pblocker-db` e `docker compose restart backend`.
- **Nota:** senhas com `@` ou `#` exigem `DB_PASSWORD_URL_ENCODED` no `.env` para a `DATABASE_URL`.

## Fase 10 — Exclusão de armário com FK (2026-06-02)

- **Sintoma:** ao excluir armário: `locker_reservations_locker_id_fkey`.
- **Causa:** tela usava `supabase.from("lockers").delete()` → rota compat com `DELETE FROM lockers` simples, sem limpar dependências.
- **Correção:** `excluirArmario()` em `backend/src/services/locker.service.ts`; aplicado em `DELETE /api/lockers/:id` e `DELETE /api/compat/lockers`; frontend usa `api.delete(/lockers/:id)`.

## Fase 8 — Erro ao definir senha de pessoa: `users_email_key` duplicado (2026-06-01)

- **Sintoma:** ao criar acesso em Pessoas — `duplicate key value violates unique constraint "users_email_key"`.
- **Causa:** endpoint `POST /api/functions/create-person-login` sempre fazia `INSERT` em `users`, mesmo quando o e-mail já existia (admin, tentativa anterior, etc.).
- **Correção:** reutilizar usuário existente pelo e-mail, atualizar senha, fazer upsert em `profiles` e vincular `funcionarios_clientes.user_id`.
- **Arquivo:** `backend/src/routes/functions.ts`

## Fase 7 — Erro ao criar armário: coluna `board_address` inexistente (2026-06-01)

- **Sintoma:** `Error ao criar armário` — `column "board_address" of relation "lockers" does not exist`.
- **Causa:** banco PostgreSQL criado antes da migration que adiciona `board_address` e `board_port` em `lockers` (o `schema-completo` no init do Docker só roda na primeira criação do volume).
- **Correção:** executar `scripts/migration-lockers-board-address.sql` no container `pblocker-db`.
- **Comando:** `docker exec -i pblocker-db psql -U admin -d pblocker < scripts/migration-lockers-board-address.sql`
- **Migration Supabase equivalente:** `supabase/migrations/20260409015853_4cf97444-f386-4ea4-ab1d-0a712b60d05e.sql`

## Fase 6 — Atualização do GitHub e publicação em `https://pblocker.sistembr.com.br` (2026-04-17)

- `git pull --rebase --autostash origin main` aplicado com sucesso.
- Arquivo `.env` criado para produção com domínio `pblocker.sistembr.com.br` e credenciais do PostgreSQL Docker.
- Deploy executado com `docker compose up -d --build`.
- Verificação local: `http://127.0.0.1:8082/api/health` = `healthy`.
- Verificação pública: `https://pblocker.sistembr.com.br/` respondeu `HTTP/2 200`; `https://pblocker.sistembr.com.br/api/health` respondeu `healthy`.
- Usuário `marcoasp.r@outlook.com` garantido com perfil `admin` e senha atualizada para `32443030`.

## Fase 1 — Domínio público isolado (`pbonelocker.com.br`)

- **Objetivo:** servir o sistema em `https://pbonelocker.com.br` sem ocupar portas 80/443 nos containers e sem alterar outros sites no mesmo servidor.
- **Abordagem:** frontend Docker escuta apenas em `127.0.0.1:8082`; no Nginx (ou outro proxy já existente no host) cria-se **apenas** um novo `server` para esse `server_name`, com TLS (ex.: Certbot). O proxy interno do container (`/api` → backend) permanece igual.
- **Arquivos:** `docker-compose.yml`, `install/docker-compose.yml`, `.env.docker`, `docker/nginx-host-pbonelocker.conf`, `docker/DOMINIO_PBONELOCKER.md`, `backend/src/index.ts`, `src/lib/api.ts`, `src/components/configuracoes/ConfigAppMobile.tsx`, `vite.config.ts`.

## Fase 2 — HTTP 403 no domínio (Apache)

- **Causa típica:** a VPS responde com **`Server: Apache`** e **403** porque não existe `VirtualHost` para `pbonelocker.com.br` encaminhando para `127.0.0.1:8082` (o pedido cai no site padrão / diretório sem permissão de leitura).
- **Correção:** módulos `proxy` + `proxy_http` (e `headers`), site `apache-pbonelocker-vhost.conf`, `a2ensite`, reload; depois Certbot com `--apache`.
- **Arquivos:** `docker/apache-pbonelocker-vhost.conf`, atualização em `docker/DOMINIO_PBONELOCKER.md`.

## Fase 3 — Automação Apache + HTTPS correto atrás do proxy

- **Script:** `scripts/instalar-apache-pbonelocker.sh` (executar na VPS com `sudo`) instala o VirtualHost e reinicia o Apache.
- **Apache:** `RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}` para HTTP e HTTPS após Certbot.
- **Container Nginx:** `docker/00-forwarded-proto-map.conf` + uso de `$esquema_cliente` em `docker/nginx.conf` para repassar o protocolo real ao Express (`trust proxy`).
- **Dockerfile** (raiz e `install/`): copia o `map` antes do `default.conf`.

## Fase 4 — Deploy na VPS (2026-04-17)

- Repositório atualizado, frontend rebuildado, `docker compose up -d`, script Apache aplicado, Certbot para `pbonelocker.com.br` (sem `www` — registro **A** para `www.pbonelocker.com.br` inexistente no DNS).

## Fase 5 — Login “senha incorreta” com banco vazio

- **Causa:** tabela `users` sem registros nesta instância (PostgreSQL novo do Docker ≠ dados da VPS antiga).
- **Correção:** inserir empresa + `users` + `profiles` (superadmin) ou usar `scripts/criar-superadmin-db-vazio.sh` + `scripts/criar-superadmin-db-vazio.cjs` (documentado em `docker/DOMINIO_PBONELOCKER.md` §7).

---

_Sempre que houver nova fase, acrescente uma seção acima com data e resumo._
