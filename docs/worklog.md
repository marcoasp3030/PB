# Worklog de desenvolvimento

## [2026-07-27 10:35] — Passo a passo de migração (o que fazer e onde ir)
- **Autor:** Composer (agente)
- **Objetivo:** Criar guia claro de etapas, locais (GitHub, SSH, DNS, UaZapi) e divisão agente vs usuário.
- **Arquivos alterados:**
 - `PASSO_A_PASSO_MIGRACAO.md` — criado
- **Resumo das mudanças:** Documentação; MCP GitHub confirmado para Etapa 1; backups/DNS ficam com o usuário.
- **Decisões e justificativas:** linguagem “onde ir” + comandos; próximo gatilho: “pode subir o código” ou “gere o backup”.
- **Comandos executados:** nenhum na produção
- **Erros e resoluções:** nenhum
- **Pendências / TODO:** aguardar autorização do usuário para upload MCP ou backup
- **Próximos passos:** usuário escolher próximo comando na conversa

---

## [2026-07-27 10:25] — Repo PB localizado; push ainda bloqueado
- **Autor:** Composer (agente)
- **Objetivo:** Ver repositório `PB` para subir o código.
- **Arquivos alterados:** nenhum (análise)
- **Resumo das mudanças:** Repo `https://github.com/marcoasp3030/PB` existe, **público**, **vazio** (ideal para primeiro push). Push deste servidor ainda falha sem credencial (sem token/SSH/`gh`).
- **Decisões e justificativas:** não subir até autenticação no servidor.
- **Comandos executados:** API GitHub OK; `git push --dry-run` → fatal sem username
- **Erros e resoluções:** pendente configurar PAT neste host
- **Pendências / TODO:** usuário autenticar; depois remote → PB, rm --cached .env, commit, push
- **Próximos passos:** configurar credential helper + token e avisar para subir

---

## [2026-07-27 10:05] — Verificação GitHub antes de subir código
- **Autor:** Composer (agente)
- **Objetivo:** Checar se dá para usar GitHub na migração; validar acesso antes de push.
- **Arquivos alterados:** nenhum (apenas diagnóstico)
- **Resumo das mudanças:**
 - Remote: `https://github.com/marcoasp3030/sparkle-heart-forge.git` (repositório **público**)
 - Leitura OK (`git ls-remote`); **push NÃO autorizado** (sem token HTTPS / sem chave SSH; `gh` não instalado)
 - `.env` ainda está **rastreado** no Git (versão antiga Supabase no HEAD); `.env` de produção NÃO deve ser commitado
 - `CREDENCIAIS_MIGRACAO.md` está no `.gitignore` (OK)
- **Decisões e justificativas:** não subir nada até o usuário autenticar e confirmar; risco alto em repo público.
- **Comandos executados:** `git ls-remote` OK; `git push --dry-run` → fatal sem username; `ssh -T git@github.com` → Permission denied
- **Erros e resoluções:** aguardando autenticação (PAT ou SSH)
- **Pendências / TODO:** instalar `gh` ou configurar PAT/SSH; `git rm --cached .env`; commit só do código; dump do banco separado
- **Próximos passos:** usuário criar token GitHub ou chave SSH e autorizar push

---

## [2026-07-27 09:20] — Plano de migração segura (paralelo / sem derrubar o atual)
- **Autor:** Composer (agente)
- **Objetivo:** Orientar a melhor forma de migrar para outro servidor sem afetar a produção.
- **Arquivos alterados:**
 - `PLANO_MIGRACAO_SERVIDOR.md` — criado — blue/green: dump ao vivo, validar no novo, cutover por DNS, rollback
- **Resumo das mudanças:** Documentação; nenhuma alteração em containers/produção.
- **Decisões e justificativas:** Paralelo é o menor risco; dump com sistema ligado; cutover curto; antigo em standby 48–72h.
- **Comandos executados:** nenhum destrutivo
- **Erros e resoluções:** nenhum
- **Pendências / TODO:** usuário fornecer IP do servidor novo; opcional gerar backup em `/opt/backups-migracao`
- **Próximos passos:** executar Fase 2 (dump) quando o novo estiver pronto

---

## [2026-07-27 09:15] — Inventário de credenciais para migração
- **Autor:** Composer (agente)
- **Objetivo:** Organizar todas as credenciais (banco, JWT, API Key, WhatsApp, domínio, volumes) em um .md para migrar de servidor.
- **Arquivos alterados:**
 - `CREDENCIAIS_MIGRACAO.md` — criado — inventário completo + checklist + comandos de dump/restore
 - `docs/worklog.md` — modificado — esta entrada
 - `instrucoes.md` / `ULTIMAS_MODIFICACOES.md` / `README.md` — referência ao documento
- **Resumo das mudanças:** Documentação apenas. Inclui `.env`, Postgres (`admin`/`pblocker`/porta 5433), JWT literal, API Key fechaduras, UaZapi, usuários, volumes e Apache.
- **Decisões e justificativas:** arquivo marcado CONFIDENCIAL; senhas de usuários (exceto a já documentada) não existem em texto claro — migram via dump.
- **Comandos executados:** leitura `.env`, `printenv`, queries SQL → OK
- **Erros e resoluções:** nenhum
- **Pendências / TODO:** usuário executar dump e transferir; rotacionar segredos após migração se vazou o .md
- **Próximos passos:** dump `pg_dump` + tar de uploads + DNS no servidor novo

---

## [2026-07-15 23:00] — Network Error no login (VITE_API_URL apontava domínio 404)
- **Autor:** Composer (agente)
- **Objetivo:** Corrigir “Network Error / verifique suas credenciais” no login.
- **Arquivos alterados:**
 - `.env` — modificado — `FRONTEND_URL`/`API_URL`/`VITE_API_URL` → `https://pbonelocker.com.br` (domínio Apache ativo); CORS extras
 - frontend rebuild
- **Resumo das mudanças:** Rebuild anterior tinha embutido `pblocker.sistembr.com.br/api`, que responde 404; browser falhava com Network Error. Domínio válido é `pbonelocker.com.br`.
- **Decisões e justificativas:** alinhar .env ao VirtualHost Apache `pbonelocker` que faz proxy para :8082.
- **Comandos executados:** rebuild frontend/backend → login público `POST /api/auth/login` → 200 OK
- **Erros e resoluções:** curl `pblocker.sistembr.com.br` → 404; `pbonelocker.com.br` → healthy
- **Pendências / TODO:** se quiser usar pblocker.sistembr.com.br, criar/ajustar VirtualHost Apache
- **Próximos passos:** usuário acessa https://pbonelocker.com.br (hard refresh Ctrl+F5)

---

## [2026-07-15 22:55] — Diagnóstico: API Key fechaduras (logout + app não abre)
- **Autor:** Composer (agente)
- **Objetivo:** Entender por que, após gerar/ativar API Key, o app não abre armários e Configurações→Fechaduras desloga.
- **Arquivos alterados:**
 - `backend/src/routes/fechaduras.ts` — modificado — `GET /agent-status` movido para antes do `apiKeyMiddleware`, com `authMiddleware`
 - `src/lib/api.ts` — modificado — interceptor 401 não desloga quando o erro é de API Key IoT
 - `src/components/configuracoes/ConfigFechaduras.tsx` — modificado — aviso para atualizar o agente após nova chave
- **Resumo das mudanças:** Dois problemas distintos: (1) logout causado por polling de agent-status atrás da API Key retornando 401 com JWT; (2) agente Python ainda com chave antiga (logs: Token inválido).
- **Decisões e justificativas:** Status do agente é recurso do painel admin (JWT), não do agente IoT.
- **Comandos executados:** docker compose build/up backend → OK; teste agent-status com JWT → OK
- **Erros e resoluções:** logs `[API-KEY] Token inválido para GET /comandos` → agente precisa da chave nova `plk_...` do banco
- **Pendências / TODO:** rebuild frontend em produção para o interceptor; atualizar config do agente Python com a chave ativa
- **Próximos passos:** usuário atualiza X-API-Key no agente local; opcional rebuild frontend

---

## [2026-07-15 15:30] — Manual do usuário leigo (análise das funcionalidades)
- **Autor:** Composer (agente)
- **Objetivo:** Analisar todas as funcionalidades do sistema e criar passo a passo detalhado para pessoa leiga.
- **Arquivos alterados:**
  - `GUIA_USUARIO.md` — criado — manual completo em linguagem simples
  - `docs/worklog.md` — criado — registro desta sessão
  - `instrucoes.md` — modificado — Fase 11
  - `ULTIMAS_MODIFICACOES.md` — modificado — entrada do guia
  - `README.md` — modificado — link para o guia
- **Resumo das mudanças:** Inventário das telas/menus/papéis e documentação passo a passo cobrindo login, empresas, pessoas, armários, portal, configurações, WhatsApp/e-mail, renovações e fluxos recomendados.
- **Decisões e justificativas:** Apenas documentação; nenhuma alteração de código/comportamento. Guia em PT-BR, organizado por papel e por tela.
- **Comandos executados:** exploração de código (leitura) → sem build/test
- **Erros e resoluções:** nenhum
- **Pendências / TODO:** opcional — capturas de tela por etapa; PDF impresso para treinamento
- **Próximos passos:** se desejado, adaptar o guia ao domínio/marca específico da instalação e incluir imagens reais das telas

---
