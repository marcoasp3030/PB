# Últimas modificações

## 2026-07-27 — Inventário de credenciais para migração de servidor

- Criado `CREDENCIAIS_MIGRACAO.md` (CONFIDENCIAL): PostgreSQL, `.env`, JWT, API Key fechaduras, WhatsApp/UaZapi, usuários, volumes Docker, Apache e checklist de exportação/restauração.

## 2026-07-15 — Network Error no login (API URL errada no build)

- **Causa:** frontend rebuildado com `VITE_API_URL=https://pblocker.sistembr.com.br/api` (domínio responde 404).
- **Correção:** `.env` apontando para `https://pbonelocker.com.br`; frontend recompilado; login validado (HTTP 200).
- **Acesso:** use `https://pbonelocker.com.br` e atualize o cache do navegador (Ctrl+F5).

## 2026-07-15 — API Key fechaduras: logout automático + app sem abrir

- **Logout:** polling de `/fechaduras/agent-status` exigia API Key; JWT do admin gerava 401 e o frontend deslogava.
- **App:** agente local com chave antiga → `GET /comandos` rejeitado (`Token inválido`).
- **Correção:** `agent-status` autenticado por JWT; interceptor 401 mais seletivo; backend/frontend rebuild.

## 2026-07-15 — Manual do usuário (pessoa leiga)

- Análise das funcionalidades do sistema (menus, papéis, portal, configurações, armários, pessoas, etc.).
- Criado `GUIA_USUARIO.md` com passo a passo detalhado em português, sem jargão técnico.
- Referências em `README.md`, `instrucoes.md` e `docs/worklog.md`.

## 2026-06-02 — Correção: login com erro 502 (backend fora do ar)

- **Sintoma:** `Request failed with status code 502` na tela de login.
- **Causa:** container `pblocker-api` em loop de reinício — falha de autenticação no PostgreSQL (`password authentication failed`) após `docker compose up` recriar serviços; o Nginx do frontend retornava 502 sem API atrás.
- **Correção:** senha do usuário `admin` no Postgres alinhada ao `.env` (`DB_PASSWORD` / `DB_PASSWORD_URL_ENCODED`); `docker compose restart backend`.
- **Verificação:** `/api/health` → `healthy`; `POST /api/auth/login` → `200`.

## 2026-06-02 — Correção definitiva: exclusão de armário (FK + rota errada)

- **Erro:** `locker_reservations_locker_id_fkey` ao excluir armário.
- **Causa real:** o frontend chamava `supabase.from("lockers").delete()` → `DELETE /api/compat/lockers` (SQL direto), **não** `DELETE /api/lockers/:id` onde a correção anterior tinha sido feita.
- **Correção:**
  - Serviço `backend/src/services/locker.service.ts` (`excluirArmario`) com ordem correta (reservas, fila, renovações, portas, armário).
  - Uso em `lockers.ts` e `compat.ts`.
  - Frontend `Armarios.tsx` passa a usar `api.delete(/lockers/:id)`.

## 2026-06-01 — Correção: definir senha / criar acesso de pessoa (`users_email_key`)

- **Erro:** `duplicate key value violates unique constraint "users_email_key"` ao criar acesso em Pessoas.
- **Causa:** `create-person-login` sempre insería novo registro em `users`.
- **Correção:** se o e-mail já existe, atualiza senha e vincula à pessoa; upsert em `profiles`; mensagens 409 em conflito com outra pessoa.
- **Arquivo:** `backend/src/routes/functions.ts` — backend reiniciado via Docker.

## 2026-06-01 — Correção: criar armário (colunas `board_address` / `board_port`)

- **Erro:** `column "board_address" of relation "lockers" does not exist` ao criar armário.
- **Causa:** PostgreSQL do Docker sem migration aplicada (volume antigo).
- **Ação:** `ALTER TABLE lockers` com `board_address` (text) e `board_port` (integer, padrão 4370) executado em `pblocker-db`.
- **Novo script:** `scripts/migration-lockers-board-address.sql` (cópia em `install/scripts/`).
- Documentado em `instrucoes.md` (Fase 7).

## 2026-04-17 — Atualização GitHub + publicação em `pblocker.sistembr.com.br`

- Repositório atualizado via `git pull --rebase --autostash origin main`.
- `.env` de produção criado para `https://pblocker.sistembr.com.br`.
- Stack Docker recompilada e iniciada com `docker compose up -d --build`.
- Saúde validada:
  - `http://127.0.0.1:8082/api/health` → `healthy`
  - `https://pblocker.sistembr.com.br/` → `HTTP/2 200`
  - `https://pblocker.sistembr.com.br/api/health` → `healthy`
- Conta `marcoasp.r@outlook.com` garantida com papel `admin` e senha `32443030`.

## 2026-04-16 — Domínio `https://pbonelocker.com.br` sem conflito com outros serviços

- `docker-compose.yml` e `install/docker-compose.yml`: URLs públicas padrão para `pbonelocker.com.br`; mapeamento `127.0.0.1:8082` para o frontend (acessível só pelo proxy do host).
- `.env.docker`: documentação de `FRONTEND_URL`, `API_URL`, `VITE_API_URL`, `HOST_BIND_FRONTEND`, `CORS_ORIGENS_ADICIONAIS`.
- `docker/nginx-host-pbonelocker.conf` e `docker/DOMINIO_PBONELOCKER.md`: exemplo e passo a passo para Nginx + Certbot só para esse host.
- CORS no backend: remove domínio fixo antigo; usa `FRONTEND_URL` + `CORS_ORIGENS_ADICIONAIS`.
- Frontend: fallback de API pelo `window.location.origin`; URL mobile dinâmica; proxy de dev aponta para `127.0.0.1:3001`.
- `instrucoes.md` e `README.md` atualizados.

## 2026-04-16 — HTTP 403 “Forbidden” em `pbonelocker.com.br`

- Causa: resposta **`Server: Apache`** sem `VirtualHost` com reverse proxy para o Docker.
- Novo: `docker/apache-pbonelocker-vhost.conf`; `docker/DOMINIO_PBONELOCKER.md` com diagnóstico (`curl -sI`) e passos Apache (`a2enmod`, `a2ensite`, Certbot `--apache`); `instrucoes.md` Fase 2.

## 2026-04-17 — Login admin com banco vazio

- Causa: `users` com 0 linhas; e-mail/senha antigos não existiam neste PostgreSQL.
- Inserção de empresa + `admin@pblocker.sistembr.com.br` + perfil `superadmin`; login testado via `POST /api/auth/login`.
- Novos: `scripts/criar-superadmin-db-vazio.sh`, `scripts/criar-superadmin-db-vazio.cjs`; `docker/DOMINIO_PBONELOCKER.md` §7; `instrucoes.md` Fase 5.

## 2026-04-17 — Deploy executado na VPS (`/opt/locker-system`)

- `git pull`, `docker compose build --no-cache frontend`, `docker compose up -d`.
- `sudo bash scripts/instalar-apache-pbonelocker.sh` (Apache `Syntax OK`, restart).
- Certbot: falhou com `-d www.pbonelocker.com.br` (DNS **NXDOMAIN** para `www`); sucesso só com `pbonelocker.com.br`. HTTPS e `/api/health` validados (`200`).

## 2026-04-17 — Script de instalação Apache e cabeçalho de protocolo (HTTPS)

- `scripts/instalar-apache-pbonelocker.sh`: instala e ativa o site, `configtest`, reinício do Apache.
- Apache: `RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}`.
- Nginx no container: `docker/00-forwarded-proto-map.conf`, `docker/nginx.conf` com `$esquema_cliente`; `Dockerfile` e `install/Dockerfile` atualizados.
- `instrucoes.md` Fase 3; `docker/DOMINIO_PBONELOCKER.md` com passo do script.
