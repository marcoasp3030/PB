# PBlocker - Sistema de Gestão de Armários

## Sobre o Projeto

Sistema completo de gestão de armários inteligentes desenvolvido por **Pitney Bowes / SistemBR**.

## Tecnologias

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Node.js (Backend)
- Supabase (Banco de dados e autenticação)

## Desenvolvimento Local

```sh
# 1. Clone o repositório
git clone <URL_DO_REPO>

# 2. Acesse o diretório
cd <NOME_DO_PROJETO>

# 3. Instale as dependências
npm i

# 4. Inicie o servidor de desenvolvimento
npm run dev
```

## Deploy

Consulte os guias de deploy:
- [Deploy Rápido (VPS)](./DEPLOY_RAPIDO.md)
- [Deploy Docker](./DEPLOY_DOCKER.md)
- [Guia de Migração VPS](./GUIA_MIGRACAO_VPS.md)
- [Domínio `pbonelocker.com.br` — Nginx ou Apache, HTTPS sem conflitar com outros sites](./docker/DOMINIO_PBONELOCKER.md)  
  Na VPS com Apache: `sudo bash scripts/instalar-apache-pbonelocker.sh` (depois `docker compose build --no-cache frontend && docker compose up -d`).

Registro de fases do projeto: [instrucoes.md](./instrucoes.md). Últimas alterações: [ULTIMAS_MODIFICACOES.md](./ULTIMAS_MODIFICACOES.md).

**Manual para usuários (passo a passo, linguagem simples):** [GUIA_USUARIO.md](./GUIA_USUARIO.md).

**Credenciais de produção:** manter apenas no servidor (arquivo local `CREDENCIAIS_MIGRACAO.md` — não versionado).

**Plano de migração sem derrubar o atual:** [PLANO_MIGRACAO_SERVIDOR.md](./PLANO_MIGRACAO_SERVIDOR.md).

**Passo a passo (o que fazer e onde ir):** [PASSO_A_PASSO_MIGRACAO.md](./PASSO_A_PASSO_MIGRACAO.md).

### Banco existente: erro ao criar armário (`board_address` não existe)

Se o PostgreSQL foi criado antes de abril/2026, aplique a migration:

```sh
docker exec -i pblocker-db psql -U admin -d pblocker < scripts/migration-lockers-board-address.sql
```
