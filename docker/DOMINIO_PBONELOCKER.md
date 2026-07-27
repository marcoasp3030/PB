# Publicar em `https://pbonelocker.com.br` sem afetar outros sistemas

O servidor pode usar **Nginx** ou **Apache** na porta 80/443. Você só adiciona **um site novo** para este domínio.

## Diagnóstico rápido (erro “Forbidden” no navegador)

No seu computador ou na VPS:

```bash
curl -sI http://pbonelocker.com.br/ | grep -i '^server:\|^HTTP/'
```

- Se aparecer **`Server: Apache`** e **`403 Forbidden`**: o Apache está atendendo o domínio, mas **não há** (ou não está ativo) um `VirtualHost` que encaminhe para o Docker. Siga a seção **Apache** abaixo — o arquivo [`apache-pbonelocker-vhost.conf`](./apache-pbonelocker-vhost.conf) resolve isso.
- Se aparecer **`Server: nginx`**: use a seção **Nginx**.

Na própria VPS (com o stack Docker no ar):

```bash
curl -sI http://127.0.0.1:8082/ | head -5
```

Se aqui já der erro de conexão, suba o compose e confira `docker compose ps` e a porta no `docker-compose.yml`.

## Princípio

| O quê | Onde |
|--------|------|
| TLS (HTTPS) e porta 80/443 | **Nginx ou Apache do host** (o que já estiver instalado) |
| Frontend + proxy `/api` | Containers Docker, escutando só em **127.0.0.1:8082** |
| Banco PostgreSQL | Rede interna do Compose (porta 5433 no host só se precisar de acesso externo) |

Nenhum container precisa bindar `0.0.0.0:80` ou `:443`, então **não compete** com o que já usa essas portas.

---

## Apache do host (recomendado se `Server: Apache`)

1. Habilite os módulos (Debian/Ubuntu):

```bash
sudo a2enmod proxy proxy_http headers ssl rewrite
sudo systemctl restart apache2
```

2. **Automático (recomendado):** no diretório do repositório na VPS:

```bash
sudo bash scripts/instalar-apache-pbonelocker.sh
```

3. **Manual:** copie o exemplo e ative o site:

```bash
sudo cp /caminho/do/projeto/docker/apache-pbonelocker-vhost.conf /etc/apache2/sites-available/pbonelocker.conf
sudo a2ensite pbonelocker
sudo apache2ctl configtest && sudo systemctl reload apache2
```

4. Teste no navegador: `http://pbonelocker.com.br/` (deve carregar o React).

5. Depois, HTTPS com Certbot (plugin Apache):

```bash
sudo certbot --apache -d pbonelocker.com.br
```

Inclua `-d www.pbonelocker.com.br` **somente** se existir registro **A** (ou **AAAA**) para `www` no DNS; caso contrário o desafio HTTP-01 falha com `NXDOMAIN`.

O VirtualHost já usa `RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}`; após o Certbot, o bloco ***:443** herda o mesmo esquema (`https`) para o Node.js ver o protocolo correto.

**Se ainda der 403:** outro `VirtualHost` pode estar “ganhando” o nome. Confira com:

```bash
sudo apache2ctl -S
```

Deve listar `pbonelocker.com.br` no `*:80` apontando para o arquivo `pbonelocker.conf`. Ajuste `ServerName` / `ServerAlias` se usar só `www`.

---

## 1. DNS

No provedor do domínio, crie registros **A** (e **AAAA** se usar IPv6):

- `pbonelocker.com.br` → IP público da VPS
- Opcional: `www.pbonelocker.com.br` → mesmo IP

## 2. Variáveis no servidor

No diretório do projeto, copie `.env.docker` para `.env` (se ainda não existir) e defina:

```env
FRONTEND_URL=https://pbonelocker.com.br
API_URL=https://pbonelocker.com.br/api
VITE_API_URL=https://pbonelocker.com.br/api
```

- **`FRONTEND_URL` / `API_URL`:** consumidos pelo backend (CORS, e-mails, links).
- **`VITE_API_URL`:** embutido no build do React; **obrigatório** rodar `docker compose build --no-cache frontend` após mudar.

Opcional, se precisar liberar mais de uma origem no CORS (lista separada por vírgula):

```env
CORS_ORIGENS_ADICIONAIS=https://www.pbonelocker.com.br
```

## 3. Subir o stack

```bash
docker compose build --no-cache frontend backend
docker compose up -d
```

O `docker-compose.yml` publica o frontend em **`127.0.0.1:8082`** por padrão. Só o Nginx do host precisa enxergar essa porta.

Se, em ambiente de teste, você **não** tiver Nginx no host e quiser acessar pelo IP na porta 8082:

```env
HOST_BIND_FRONTEND=0.0.0.0
```

Depois `docker compose up -d` de novo.

## 4. Nginx do host (site isolado)

Use o arquivo de exemplo:

- [`nginx-host-pbonelocker.conf`](./nginx-host-pbonelocker.conf)

_(Se o servidor usa Apache, ignore esta seção e use a seção **Apache** no início deste documento.)_

Copie para `sites-available`, habilite com link em `sites-enabled`, teste e recarregue:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Certificado TLS (Let’s Encrypt)

- **Nginx:** `sudo certbot --nginx -d pbonelocker.com.br -d www.pbonelocker.com.br`
- **Apache:** `sudo certbot --apache -d pbonelocker.com.br -d www.pbonelocker.com.br`

O Certbot altera **somente** o bloco desse domínio.

## 6. Conferência rápida

```bash
curl -fsS https://pbonelocker.com.br/api/health
```

Se retornar JSON, API e proxy estão corretos.

## 7. Primeiro login (banco novo sem usuários)

O `schema-completo-pblocker.sql` **não** insere o administrador automaticamente (comandos comentados no final do arquivo). Com `users` vazio, qualquer e-mail retorna “credenciais inválidas”.

Na VPS, com os containers no ar e o volume do projeto montado em `/workspace` no `pblocker-api`:

```bash
cd /opt/locker-system
export ADMIN_EMAIL="admin@pblocker.sistembr.com.br"
export ADMIN_PASSWORD="sua_senha"
bash scripts/criar-superadmin-db-vazio.sh
unset ADMIN_PASSWORD
```

O script só roda se `SELECT COUNT(*) FROM users` for **0**. Depois faça login no painel com o mesmo e-mail e senha.

## Resolução de problemas

- **CORS no navegador:** confira se `FRONTEND_URL` é exatamente a origem do browser (com ou sem `www`, sempre `https`).
- **Frontend chama API errada:** rebuild do frontend com `VITE_API_URL` correto.
- **502 Bad Gateway:** container `pblocker-web` parado ou porta errada; confira `docker compose ps` e `curl -sI http://127.0.0.1:8082/`.
- **Porta 8082 já usada por outro serviço:** no `docker-compose.yml`, altere para `127.0.0.1:8083:80` (por exemplo) e ajuste `proxy_pass` no Nginx do host para `127.0.0.1:8083`.
