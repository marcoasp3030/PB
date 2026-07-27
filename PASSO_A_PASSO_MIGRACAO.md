# Passo a passo — o que fazer e onde ir

Guia prático para migrar o **PB One / Locker System** usando o GitHub (`marcoasp3030/PB`) e um servidor novo, **sem derrubar o atual** até o cutover.

Documento complementar:
- Credenciais: [`CREDENCIAIS_MIGRACAO.md`](./CREDENCIAIS_MIGRACAO.md) *(CONFIDENCIAL — não vai para o GitHub)*
- Plano técnico: [`PLANO_MIGRACAO_SERVIDOR.md`](./PLANO_MIGRACAO_SERVIDOR.md)

---

## Mapa rápido: quem faz o quê

| Etapa | Quem | Onde |
|-------|------|------|
| 1. Subir código no GitHub | **Agente (eu)** via MCP | Repo https://github.com/marcoasp3030/PB |
| 2. Backup do banco + uploads | **Você** (ou me pedir) | Servidor atual `PBOT01` → `/opt/locker-system` |
| 3. Preparar servidor novo | **Você** | Nova VPS (SSH) |
| 4. Clonar código + `.env` | **Você** | Servidor novo |
| 5. Restaurar dados | **Você** | Servidor novo |
| 6. Testar sem DNS | **Você** | IP do servidor novo |
| 7. Trocar DNS + SSL | **Você** | Painel DNS + Apache/Certbot |
| 8. Agente fechaduras + WhatsApp | **Você** | PC do agente / painel UaZapi |

---

## Etapa 0 — Antes de começar (checklist)

1. Tenha acesso SSH ao **servidor atual** (já estamos em `/opt/locker-system`).
2. Tenha a **nova VPS** criada (IP anotado).
3. Confirme no Cursor: **Settings → MCP → github** ligado (verde), como no print.
4. Guarde `CREDENCIAIS_MIGRACAO.md` em local seguro (e-mail/Drive **privado**), **fora** do GitHub público.

---

## Etapa 1 — Código no GitHub (repo `PB`)

### Onde ir
- Navegador: https://github.com/marcoasp3030/PB  
- Cursor: esta conversa (MCP GitHub já autenticado)

### O que você faz
1. Abra https://github.com/marcoasp3030/PB e confirme que o repo existe (pode estar vazio).
2. Me diga: **“pode subir o código”**.

### O que eu faço (quando você autorizar)
1. Envio o código do projeto para `marcoasp3030/PB` (via MCP `push_files`).
2. **Não** envio: `.env`, `CREDENCIAIS_MIGRACAO.md`, dumps com senha.
3. Ao terminar, você confere em https://github.com/marcoasp3030/PB se apareceram pastas (`backend/`, `src/`, `docker/`, etc.).

### O que NÃO vai no GitHub
- Senha do banco, JWT, API Key, tokens WhatsApp  
- Dump do PostgreSQL e arquivos de upload  
Esses você copia **à parte** (Etapas 2 e 4).

---

## Etapa 2 — Backup no servidor ATUAL (sistema continua ligado)

### Onde ir
- Terminal SSH no servidor atual  
- Pasta: `/opt/locker-system`

### O que fazer

```bash
cd /opt/locker-system
mkdir -p /opt/backups-migracao

# 1) Dump do banco
docker exec pblocker-db pg_dump -U admin -d pblocker --clean --if-exists \
  > /opt/backups-migracao/pblocker-$(date +%Y%m%d-%H%M).sql

# 2) Uploads (logos, etc.)
sudo tar -czf /opt/backups-migracao/uploads-$(date +%Y%m%d-%H%M).tar.gz \
  -C /var/lib/docker/volumes/locker-system_uploads/_data .

# 3) Copiar o .env (credenciais de produção)
cp /opt/locker-system/.env /opt/backups-migracao/env-producao.bak

ls -lh /opt/backups-migracao/
```

### Onde ficam os arquivos
`/opt/backups-migracao/` no servidor atual.

> Se preferir, peça: **“gere o backup agora”** — eu executo esses comandos no servidor atual sem parar o sistema.

---

## Etapa 3 — Preparar o servidor NOVO

### Onde ir
1. Painel do provedor (DigitalOcean, Contabo, AWS, etc.) → criar VPS Ubuntu 22.04+.
2. Anotar o **IP público**.
3. Entrar por SSH:

```bash
ssh usuario@IP_DO_SERVIDOR_NOVO
```

### O que instalar

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Saia e entre de novo no SSH

docker --version
docker compose version
```

---

## Etapa 4 — Código + `.env` no servidor novo

### 4.1 Clonar do GitHub

### Onde ir
Terminal no **servidor novo**.

```bash
sudo mkdir -p /opt
cd /opt
git clone https://github.com/marcoasp3030/PB.git locker-system
cd locker-system
```

### 4.2 Colocar o `.env` de produção

### Onde ir
Arquivo: `/opt/locker-system/.env` no servidor novo.

1. Copie o conteúdo de `/opt/backups-migracao/env-producao.bak` (do servidor antigo)  
   **ou** use o bloco “Modelo mínimo de `.env`” em `CREDENCIAIS_MIGRACAO.md`.
2. Se o domínio for o mesmo (`pbonelocker.com.br`), pode manter as URLs.
3. Se for outro domínio, altere:

```env
FRONTEND_URL=https://SEU_DOMINIO
API_URL=https://SEU_DOMINIO/api
VITE_API_URL=https://SEU_DOMINIO/api
```

### 4.3 Transferir backups do antigo para o novo

No **seu PC** ou direto entre servidores:

```bash
# Exemplo: do antigo para o novo
scp usuario@IP_ANTIGO:/opt/backups-migracao/* usuario@IP_NOVO:/opt/backups-migracao/
```

Crie a pasta no novo antes: `mkdir -p /opt/backups-migracao`

---

## Etapa 5 — Subir Docker e restaurar dados

### Onde ir
Terminal no **servidor novo**, pasta `/opt/locker-system`.

```bash
cd /opt/locker-system

# Sobe containers (banco começa vazio)
docker compose up -d --build

# Espera o Postgres ficar healthy
docker compose ps

# Restaura o banco
docker exec -i pblocker-db psql -U admin -d pblocker < /opt/backups-migracao/pblocker-AAAAMMDD-HHMM.sql

# Restaura uploads
sudo tar -xzf /opt/backups-migracao/uploads-AAAAMMDD-HHMM.tar.gz \
  -C /var/lib/docker/volumes/locker-system_uploads/_data

docker compose restart backend frontend

# Teste local
curl -s http://127.0.0.1:8082/api/health
```

Troque `AAAAMMDD-HHMM` pelo nome real do arquivo em `/opt/backups-migracao/`.

Se mudou `VITE_API_URL`:

```bash
docker compose build --no-cache frontend
docker compose up -d frontend
```

---

## Etapa 6 — Configurar HTTPS no servidor novo (ainda sem mudar DNS)

### Onde ir
1. Arquivos de exemplo no projeto: `docker/apache-pbonelocker-vhost.conf`  
2. Ou script: `scripts/instalar-apache-pbonelocker.sh`  
3. Guia: `docker/DOMINIO_PBONELOCKER.md`

### Fluxo típico (Apache)

```bash
# Instalar Apache + módulos
sudo apt update
sudo apt install -y apache2
sudo a2enmod proxy proxy_http headers ssl rewrite

# Copiar/ajustar o VirtualHost apontando para 127.0.0.1:8082
# Depois:
sudo apache2ctl configtest
sudo systemctl reload apache2
```

### SSL (Certbot)
Só funciona bem **depois** que o DNS do domínio apontar para o IP novo (Etapa 7).  
Até lá, teste por IP:

```bash
curl -s http://127.0.0.1:8082/api/health
```

Ou no seu PC, arquivo hosts (temporário):

```text
IP_DO_SERVIDOR_NOVO   pbonelocker.com.br
```

Caminho no Windows: `C:\Windows\System32\drivers\etc\hosts`  
Caminho no Mac/Linux: `/etc/hosts`

Abra no navegador: `https://pbonelocker.com.br` (ou `http://IP:8082` se liberar a porta só para teste).

### Testes mínimos
- [ ] Login com `marcoasp.r@outlook.com`
- [ ] Dashboard / Armários / Pessoas
- [ ] Configurações abre sem deslogar

---

## Etapa 7 — Cutover (troca de DNS) — única janela curta

### Onde ir
1. Painel DNS do domínio (Registro.br, Cloudflare, GoDaddy, etc.)
2. Registro tipo **A** de `pbonelocker.com.br` → **IP do servidor novo**

### Antes (ideal, 24–48h)
- Baixe o **TTL** do registro A para **300** segundos.

### No dia

1. **Servidor atual** — dump final (opcional, recomendado):

```bash
docker exec pblocker-db pg_dump -U admin -d pblocker --clean --if-exists \
  > /opt/backups-migracao/pblocker-FINAL.sql
```

2. Copie e restaure esse dump no **servidor novo**.
3. No painel DNS: aponte **A** → IP novo.
4. No servidor novo: emitir SSL:

```bash
sudo apt install -y certbot python3-certbot-apache
sudo certbot --apache -d pbonelocker.com.br
```

5. Teste de outra rede: https://pbonelocker.com.br/api/health

### Servidor antigo
- **Não desligue** por 48–72 horas (rollback = DNS de volta para o IP antigo).

---

## Etapa 8 — Agente de fechaduras e WhatsApp

### Agente Python (PC/servidor das fechaduras)

### Onde ir
Arquivo de configuração do agente (onde está o `X-API-Key` e a URL da API).

1. URL base → `https://pbonelocker.com.br/api` (após DNS).
2. Header: `X-API-Key: <chave em CREDENCIAIS_MIGRACAO.md ou Configurações → Fechaduras>`.
3. Reinicie o agente.
4. No painel web: **Configurações → Fechaduras** → status do agente deve ficar **Online**.

### WhatsApp (UaZapi)

### Onde ir
Painel https://sistembr.uazapi.com (ou URL em `CREDENCIAIS_MIGRACAO.md`).

1. Webhook → `https://pbonelocker.com.br/api/whatsapp-webhook`
2. Confirme token/instância após o DNS.

---

## Etapa 9 — Encerrar o servidor antigo (só depois)

Quando tudo estiver estável 2–3 dias:

1. DNS já está no novo há dias.
2. Agente e WhatsApp ok.
3. Aí sim: `docker compose down` no antigo (sem `-v` no começo; volumes só depois de ter certeza).

---

## Ordem visual (resumo)

```text
1. Você: "pode subir o código"  →  eu envio para github.com/marcoasp3030/PB
2. Você: backup no atual         →  /opt/backups-migracao
3. Você: VPS nova + Docker
4. Você: git clone PB + .env + scp backups
5. Você: compose up + restore
6. Você: testa por IP/hosts
7. Você: DNS → IP novo + Certbot
8. Você: agente + webhook WhatsApp
9. Você: antigo em standby → desliga depois
```

---

## Links úteis

| O quê | Onde |
|-------|------|
| Repo do código | https://github.com/marcoasp3030/PB |
| Site produção (atual) | https://pbonelocker.com.br |
| Health API | https://pbonelocker.com.br/api/health |
| MCP GitHub no Cursor | Settings → Tools & MCP → github |
| Projeto no servidor atual | `/opt/locker-system` |
| Credenciais | `/opt/locker-system/CREDENCIAIS_MIGRACAO.md` |

---

## Próxima mensagem útil para mim

Escolha uma:

1. **“pode subir o código”** — eu envio o projeto para o repo `PB` (sem segredos).  
2. **“gere o backup agora”** — eu crio dump + tar em `/opt/backups-migracao` no servidor atual.  
3. **“tenho o IP do servidor novo: x.x.x.x”** — adapto os comandos com o IP real.
