# Migração segura para outro servidor (sem derrubar o atual)

**Método recomendado:** migração em **paralelo** (blue/green simples).  
O servidor **atual continua no ar** até o novo estar testado. Só no final você muda o DNS (ou o apontamento).

Documento complementar com senhas/tokens: [`CREDENCIAIS_MIGRACAO.md`](./CREDENCIAIS_MIGRACAO.md) (CONFIDENCIAL).

---

## Por que esta é a melhor forma

| Abordagem | Risco no sistema atual | Quando usar |
|-----------|------------------------|-------------|
| **Paralelo (recomendado)** | Quase zero — antigo só para de receber tráfego no cutover | Produção em uso |
| Dump “ao vivo” + restore | Baixo (leitura no banco) | Sempre, no paralelo |
| Parar tudo → copiar → ligar no novo | Alto downtime | Só se aceitar horas fora |
| Trocar DNS antes de testar | Alto | Evitar |

**Não desligue** os containers atuais (`pblocker-web`, `pblocker-api`, `pblocker-db`) até o novo ambiente passar nos testes.

---

## Visão geral (4 fases)

```text
1) PREPARAR NOVO SERVIDOR     → Docker + código + .env (domínio ainda pode ser IP ou hostname interno)
2) COPIAR DADOS (antigo liga) → dump Postgres + uploads (sistema continua)
3) VALIDAR NO NOVO            → health, login, armários (via IP:porta ou hosts local)
4) CUTOVER                    → DNS → novo IP; atualizar agente e WhatsApp; antigo fica standby 48–72h
```

Janela crítica (quando o sistema “muda de lugar”): tipicamente **5–30 minutos** (DNS + dump final + restore + testes). Fora isso, o antigo segue normal.

---

## Pré-requisitos do servidor novo

- Linux (Ubuntu 22.04+ recomendado)
- Docker + Docker Compose plugin
- Portas livres: `80`, `443` (proxy); internamente o Compose usa `127.0.0.1:8082` e `5433`
- Acesso SSH root/sudo
- (Opcional) mesmo domínio `pbonelocker.com.br` — DNS só muda no cutover

---

## Fase 1 — Subir a aplicação no novo servidor (sem DNS ainda)

No **servidor novo**:

```bash
# 1. Instalar Docker (se ainda não tiver)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# relogue no SSH

# 2. Colocar o código
sudo mkdir -p /opt
# Opção A: copiar do antigo (rsync) — ver Fase 2
# Opção B: git clone do repositório + copiar só o .env do antigo

cd /opt/locker-system

# 3. Criar .env (copie de CREDENCIAIS_MIGRACAO.md)
# - Mantenha DB_PASSWORD e JWT_SECRET IGUAIS ao atual na primeira migração
# - FRONTEND_URL / API_URL / VITE_API_URL: use o domínio final OU o IP temporário
nano .env

# 4. Subir stack (cria banco VAZIO na primeira vez — ok)
docker compose up -d --build
curl -s http://127.0.0.1:8082/api/health
```

Nesse momento o **antigo ainda atende** `https://pbonelocker.com.br`. O novo só responde no IP dele (ou em um domínio de teste).

**Dica:** para testar sem mudar DNS, no seu PC:

```text
# /etc/hosts (temporário)
IP_NOVO_SERVIDOR  pbonelocker.com.br
```

Ou acesse `http://IP_NOVO:8082` se publicar a porta (só para teste; em produção mantenha `127.0.0.1:8082` + Apache/Nginx).

---

## Fase 2 — Copiar dados **sem parar** o sistema atual

Tudo abaixo roda no **servidor antigo**. O Postgres aceita `pg_dump` com o sistema ligado (snapshot lógico consistente o suficiente para este porte).

### 2.1 Dump do banco (sistema continua)

```bash
cd /opt/locker-system
mkdir -p /opt/backups-migracao
docker exec pblocker-db pg_dump -U admin -d pblocker --clean --if-exists \
  > /opt/backups-migracao/pblocker-$(date +%Y%m%d-%H%M).sql

ls -lh /opt/backups-migracao/
```

### 2.2 Backup dos uploads

```bash
sudo tar -czf /opt/backups-migracao/uploads-$(date +%Y%m%d-%H%M).tar.gz \
  -C /var/lib/docker/volumes/locker-system_uploads/_data .
```

### 2.3 Copiar código + `.env` (se ainda não estiver no novo)

```bash
# No servidor NOVO, puxe do antigo (substitua USUARIO e IP_ANTIGO):
rsync -avz --progress \
  --exclude node_modules --exclude backend/node_modules --exclude .git \
  USUARIO@IP_ANTIGO:/opt/locker-system/ /opt/locker-system/

# Ou só o backup:
scp USUARIO@IP_ANTIGO:/opt/backups-migracao/* /opt/backups-migracao/
```

### 2.4 Restaurar no servidor novo

```bash
# Banco: limpa o schema vazio e importa
docker exec -i pblocker-db psql -U admin -d pblocker < /opt/backups-migracao/pblocker-AAAAMMDD-HHMM.sql

# Uploads
sudo tar -xzf /opt/backups-migracao/uploads-AAAAMMDD-HHMM.tar.gz \
  -C /var/lib/docker/volumes/locker-system_uploads/_data
docker compose restart backend frontend
```

Confirme:

```bash
curl -s http://127.0.0.1:8082/api/health
docker exec pblocker-db psql -U admin -d pblocker -c "SELECT count(*) FROM users;"
```

---

## Fase 3 — Validar no novo (ainda sem afetar produção)

Checklist mínimo:

1. `GET /api/health` → `healthy`
2. Login admin (`marcoasp.r@outlook.com` ou outro superadmin)
3. Abrir Dashboard / Armários / Pessoas
4. Configurações → Fechaduras → status do agente (pode ficar offline até apontar o agente)
5. Conferir logos/uploads
6. Configurar Apache/Nginx + SSL **no novo** (Certbot) **sem** mudar o DNS ainda — o certificado pode exigir DNS já apontado; alternativas:
   - usar IP + HTTP só para teste; ou
   - baixar TTL do DNS agora (ex.: 300s) e emitir certificado no cutover; ou
   - certificado com DNS challenge

Enquanto o DNS aponta para o **antigo**, usuários reais **não** são afetados.

---

## Fase 4 — Cutover (única janela com impacto)

Objetivo: minimizar perda de dados entre o dump da Fase 2 e a troca.

### 4.1 Preparar DNS

1. Baixe o **TTL** do registro A de `pbonelocker.com.br` para **300** (5 min), com **24–48h de antecedência**.
2. No cutover, aponte o A para o **IP do servidor novo**.

### 4.2 Dump final (opcional mas recomendado)

Com o sistema ainda no antigo, faça um dump **fresco** e restaure de novo no novo (sobrescreve o restore da Fase 2):

```bash
# ANTIGO — dump final
docker exec pblocker-db pg_dump -U admin -d pblocker --clean --if-exists \
  > /opt/backups-migracao/pblocker-FINAL.sql

# Copiar e restaurar no NOVO (mesmo comando da Fase 2.4)
```

Para quase zero perda: após o dump final, coloque o antigo em **modo somente leitura** mental (avise usuários / evite criar armários por 10 min) — ou aceite que reservas feitas nesses minutos podem precisar reaplicar.

### 4.3 Trocar DNS → novo IP

1. Alterar registro A.
2. Emitir/renovar SSL no novo (`certbot`).
3. Testar `https://pbonelocker.com.br/api/health` de outra rede.

### 4.4 Serviços externos (obrigatório)

| Serviço | Ação |
|---------|------|
| **Agente Python (fechaduras)** | Atualizar URL base para o novo domínio/IP + mesma `X-API-Key` |
| **UaZapi webhook** | `https://pbonelocker.com.br/api/whatsapp-webhook` (já no domínio; confirma se o IP DNS bate) |
| App mobile | Se usa URL fixa, atualizar; se usa o domínio, só DNS |

### 4.5 Servidor antigo

- **Não apague** por 48–72 horas.
- Deixe os containers rodando como **rollback** (só não use o DNS nele).
- Se precisar voltar: DNS de volta para o IP antigo.

---

## O que NÃO fazer

- Não rode `docker compose down -v` no antigo (apaga volumes).
- Não mude `DB_PASSWORD` no meio da migração sem alinhar o Postgres.
- Não rebuild o frontend no antigo com `VITE_API_URL` do novo domínio **antes** do cutover (quebraria o site atual, como já aconteceu com `pblocker.sistembr.com.br`).
- Não apague o servidor antigo no mesmo dia do cutover.

---

## Rollback rápido

Se algo falhar após o DNS:

1. DNS A → IP do servidor **antigo** de novo.
2. Agente Python → URL antiga.
3. Investigar no novo com calma (`docker logs pblocker-api`).

---

## Tempo estimado

| Etapa | Tempo típico |
|-------|----------------|
| Preparar VPS + Docker + stack | 1–2 h |
| Dump + rsync + restore | 15–45 min (depende do tamanho) |
| Testes | 30–60 min |
| Cutover (DNS + SSL + agente) | 15–30 min |
| Observação / antigo em standby | 2–3 dias |

---

## Ordem prática resumida (cola)

```text
NOVO: instalar Docker → copiar projeto/.env → compose up
ANTIGO: pg_dump + tar uploads  (sistema ligado)
NOVO: restore dump + uploads → testar por IP/hosts
DNS TTL baixo (antecedência)
ANTIGO: dump FINAL → NOVO: restore FINAL
DNS → IP novo → SSL → agente + WhatsApp
ANTIGO: standby 48–72h → depois desligar
```

---

## Precisa de ajuda na execução?

Posso executar **só a parte segura no servidor atual** (gerar dump + tar de uploads em `/opt/backups-migracao`) **sem** parar os containers.  
A instalação no servidor novo e a troca de DNS dependem do acesso SSH/DNS que você tiver nesse outro host.

Quando tiver o IP do servidor novo, diga se quer:

1. **Só o backup** no atual, ou  
2. **Roteiro completo** passo a passo adaptado ao IP/domínio novo.
