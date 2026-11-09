#!/bin/bash
# ============================================================
# DEPLOY AUTOMATIZADO — PBLocker
# 
# Uso:
#   chmod +x scripts/deploy-vps.sh
#   ./scripts/deploy-vps.sh
#
# Este script configura TUDO na VPS:
#   1. Instala Node.js 20, PM2, Nginx, Certbot
#   2. Cria estrutura de diretórios
#   3. Configura o banco PostgreSQL
#   4. Compila e inicia o backend
#   5. Faz build do frontend
#   6. Configura Nginx com SSL
# ============================================================

set -euo pipefail

# ============================================================
# CORES PARA OUTPUT
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[AVISO]${NC} $1"; }
log_error() { echo -e "${RED}[ERRO]${NC} $1"; }

# ============================================================
# CONFIGURAÇÕES (EDITE ANTES DE EXECUTAR)
# ============================================================
DOMAIN="pblocker.sistembr.com.br"
PROJECT_DIR="/opt/locker-system"
BACKEND_PORT=3001
DB_NAME="pblocker"
DB_USER="admin"
DB_HOST="localhost"
DB_PORT="5432"
ADMIN_EMAIL="admin@pblocker.sistembr.com.br"
ADMIN_NAME="Administrador"
COMPANY_NAME="PBLocker"

# ============================================================
# FUNÇÕES AUXILIARES
# ============================================================

check_root() {
  if [ "$EUID" -ne 0 ]; then
    log_error "Execute como root: sudo ./deploy-vps.sh"
    exit 1
  fi
}

prompt_password() {
  local prompt_msg="$1"
  local password=""
  while [ -z "$password" ]; do
    read -sp "$prompt_msg: " password
    echo
    if [ ${#password} -lt 6 ]; then
      log_warn "Senha deve ter pelo menos 6 caracteres."
      password=""
    fi
  done
  echo "$password"
}

prompt_value() {
  local prompt_msg="$1"
  local default_val="${2:-}"
  local value=""
  if [ -n "$default_val" ]; then
    read -p "$prompt_msg [$default_val]: " value
    echo "${value:-$default_val}"
  else
    while [ -z "$value" ]; do
      read -p "$prompt_msg: " value
    done
    echo "$value"
  fi
}

# ============================================================
# ETAPA 0: COLETAR INFORMAÇÕES
# ============================================================

collect_info() {
  echo ""
  echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║     🚀 PBLocker — Deploy Automatizado       ║${NC}"
  echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
  echo ""

  DOMAIN=$(prompt_value "Domínio do sistema" "$DOMAIN")
  DB_NAME=$(prompt_value "Nome do banco PostgreSQL" "$DB_NAME")
  DB_USER=$(prompt_value "Usuário do banco" "$DB_USER")
  DB_HOST=$(prompt_value "Host do banco" "$DB_HOST")
  DB_PORT=$(prompt_value "Porta do banco" "$DB_PORT")
  DB_PASSWORD=$(prompt_password "Senha do banco PostgreSQL")
  ADMIN_EMAIL=$(prompt_value "E-mail do superadmin" "$ADMIN_EMAIL")
  ADMIN_NAME=$(prompt_value "Nome do superadmin" "$ADMIN_NAME")
  ADMIN_PASSWORD=$(prompt_password "Senha do superadmin")
  COMPANY_NAME=$(prompt_value "Nome da empresa padrão" "$COMPANY_NAME")
  CERTBOT_EMAIL=$(prompt_value "E-mail para certificado SSL (Let's Encrypt)" "$ADMIN_EMAIL")

  # URL-encode da senha do banco para a DATABASE_URL
  DB_PASSWORD_ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$DB_PASSWORD', safe=''))" 2>/dev/null || echo "$DB_PASSWORD")

  echo ""
  echo -e "${YELLOW}═══════════════════════════════════════${NC}"
  echo -e "  Domínio:      ${GREEN}$DOMAIN${NC}"
  echo -e "  Banco:        ${GREEN}$DB_NAME${NC} em ${GREEN}$DB_HOST:$DB_PORT${NC}"
  echo -e "  Superadmin:   ${GREEN}$ADMIN_EMAIL${NC}"
  echo -e "  Empresa:      ${GREEN}$COMPANY_NAME${NC}"
  echo -e "${YELLOW}═══════════════════════════════════════${NC}"
  echo ""
  
  read -p "Continuar com estas configurações? (s/n): " confirm
  if [[ "$confirm" != "s" && "$confirm" != "S" ]]; then
    log_warn "Deploy cancelado."
    exit 0
  fi
}

# ============================================================
# ETAPA 1: INSTALAR DEPENDÊNCIAS DO SISTEMA
# ============================================================

install_system_deps() {
  log_info "Instalando dependências do sistema..."

  # Node.js 20
  if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
    log_info "Instalando Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  log_ok "Node.js $(node -v)"

  # PM2
  if ! command -v pm2 &>/dev/null; then
    log_info "Instalando PM2..."
    npm install -g pm2
  fi
  log_ok "PM2 instalado"

  # Nginx
  if ! command -v nginx &>/dev/null; then
    log_info "Instalando Nginx..."
    apt-get install -y nginx
  fi
  log_ok "Nginx instalado"

  # Certbot
  if ! command -v certbot &>/dev/null; then
    log_info "Instalando Certbot..."
    apt-get install -y certbot python3-certbot-nginx
  fi
  log_ok "Certbot instalado"

  # Git
  if ! command -v git &>/dev/null; then
    apt-get install -y git
  fi
  log_ok "Git instalado"
}

# ============================================================
# ETAPA 2: ESTRUTURA DE DIRETÓRIOS
# ============================================================

setup_directories() {
  log_info "Criando estrutura de diretórios..."

  mkdir -p "$PROJECT_DIR"
  mkdir -p "$PROJECT_DIR/backend/uploads/avatars"
  mkdir -p "$PROJECT_DIR/backend/uploads/platform-assets"
  mkdir -p "$PROJECT_DIR/dist"

  # Verificar se o código fonte existe
  if [ ! -f "$PROJECT_DIR/package.json" ]; then
    log_warn "Código fonte não encontrado em $PROJECT_DIR"
    log_info "Clone o repositório primeiro:"
    echo ""
    echo "  git clone <URL_DO_REPO> $PROJECT_DIR"
    echo ""
    read -p "O código já está em $PROJECT_DIR? (s/n): " code_ready
    if [[ "$code_ready" != "s" && "$code_ready" != "S" ]]; then
      log_error "Copie o código para $PROJECT_DIR e execute novamente."
      exit 1
    fi
  fi

  log_ok "Diretórios criados"
}

# ============================================================
# ETAPA 3: CONFIGURAR BANCO DE DADOS
# ============================================================

setup_database() {
  log_info "Configurando banco de dados..."

  # Verificar se o schema SQL existe
  SCHEMA_FILE="$PROJECT_DIR/scripts/schema-completo-pblocker.sql"
  if [ ! -f "$SCHEMA_FILE" ]; then
    log_error "Arquivo $SCHEMA_FILE não encontrado!"
    exit 1
  fi

  # Testar conexão
  log_info "Testando conexão com PostgreSQL..."
  if PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -c "SELECT 1" &>/dev/null; then
    log_ok "Conexão com PostgreSQL OK"
  else
    log_error "Falha na conexão com PostgreSQL. Verifique credenciais e pg_hba.conf"
    exit 1
  fi

  # Verificar se tabelas já existem
  TABLE_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null | tr -d ' ')

  if [ "$TABLE_COUNT" -gt 5 ]; then
    log_warn "Banco já contém $TABLE_COUNT tabelas."
    read -p "Deseja recriar o schema? ISSO APAGARÁ TODOS OS DADOS! (s/n): " recreate
    if [[ "$recreate" != "s" && "$recreate" != "S" ]]; then
      log_info "Pulando criação do schema."
      return
    fi
  fi

  # Executar schema
  log_info "Criando tabelas, funções e triggers..."
  PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" -f "$SCHEMA_FILE"
  log_ok "Schema criado com sucesso"

  # Criar superadmin
  log_info "Criando superadmin..."
  
  ADMIN_HASH=$(node -e "require('bcryptjs').hash('$ADMIN_PASSWORD', 12).then(h => console.log(h))")

  PGPASSWORD="$DB_PASSWORD" psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -d "$DB_NAME" <<EOSQL
-- Criar usuário admin (ignorar se já existir)
INSERT INTO users (email, password_hash, email_confirmed)
VALUES ('$ADMIN_EMAIL', '$ADMIN_HASH', TRUE)
ON CONFLICT (email) DO UPDATE SET password_hash = '$ADMIN_HASH';

-- Criar empresa padrão
INSERT INTO companies (name, type)
SELECT '$COMPANY_NAME', 'employee'
WHERE NOT EXISTS (SELECT 1 FROM companies LIMIT 1);

-- Criar perfil superadmin
INSERT INTO profiles (user_id, full_name, role, company_id, password_changed)
SELECT
  u.id,
  '$ADMIN_NAME',
  'superadmin',
  (SELECT id FROM companies ORDER BY created_at LIMIT 1),
  TRUE
FROM users u WHERE u.email = '$ADMIN_EMAIL'
ON CONFLICT (user_id) DO UPDATE SET
  role = 'superadmin',
  full_name = '$ADMIN_NAME',
  company_id = (SELECT id FROM companies ORDER BY created_at LIMIT 1);
EOSQL

  log_ok "Superadmin criado: $ADMIN_EMAIL"
}

# ============================================================
# ETAPA 4: CONFIGURAR BACKEND
# ============================================================

setup_backend() {
  log_info "Configurando backend..."

  cd "$PROJECT_DIR/backend"

  # Gerar JWT_SECRET
  JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')

  # Criar .env do backend
  cat > .env <<EOF
# ============================================
# Banco de Dados
# ============================================
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD_ENCODED@$DB_HOST:$DB_PORT/$DB_NAME

# ============================================
# JWT
# ============================================
JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=7d

# ============================================
# Servidor
# ============================================
PORT=$BACKEND_PORT
FRONTEND_URL=https://$DOMAIN
API_URL=https://$DOMAIN/api

# ============================================
# Upload
# ============================================
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5242880
EOF

  log_ok "Backend .env criado"

  # Instalar dependências
  log_info "Instalando dependências do backend..."
  npm install --production=false
  log_ok "Dependências instaladas"

  # Compilar TypeScript
  log_info "Compilando TypeScript..."
  npx tsc
  log_ok "Backend compilado"

  # Parar instância anterior se existir
  pm2 delete locker-api 2>/dev/null || true

  # Iniciar com PM2
  log_info "Iniciando backend com PM2..."
  pm2 start dist/index.js \
    --name locker-api \
    --max-memory-restart 512M \
    --time

  # Testar health check
  sleep 3
  if curl -s "http://localhost:$BACKEND_PORT/api/health" | grep -q "ok\|healthy\|status"; then
    log_ok "Backend rodando na porta $BACKEND_PORT ✅"
  else
    log_warn "Backend pode não estar respondendo. Verifique: pm2 logs locker-api"
  fi

  # Salvar PM2 para restart automático
  pm2 save
  pm2 startup systemd -u root --hp /root 2>/dev/null || true

  log_ok "Backend configurado com PM2"
}

# ============================================================
# ETAPA 5: BUILD DO FRONTEND
# ============================================================

setup_frontend() {
  log_info "Fazendo build do frontend..."

  cd "$PROJECT_DIR"

  # Criar .env.production
  cat > .env.production <<EOF
VITE_API_URL=https://$DOMAIN/api
EOF

  # Instalar dependências do frontend
  log_info "Instalando dependências do frontend..."
  npm install
  log_ok "Dependências instaladas"

  # Build
  log_info "Executando build (pode demorar alguns minutos)..."
  npm run build
  log_ok "Frontend compilado em $PROJECT_DIR/dist/"
}

# ============================================================
# ETAPA 6: CONFIGURAR NGINX
# ============================================================

setup_nginx() {
  log_info "Configurando Nginx..."

  # Criar configuração do site
  cat > /etc/nginx/sites-available/pblocker <<NGINX
# PBLocker — Configuração Nginx
# Gerado automaticamente em $(date)

server {
    listen 80;
    server_name $DOMAIN;

    # Frontend (arquivos estáticos do React)
    root $PROJECT_DIR/dist;
    index index.html;

    # Limites
    client_max_body_size 10M;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # Cache para assets estáticos
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    # API Backend (proxy reverso para Express)
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

    # Webhooks (sem timeout estendido)
    location ^~ /api/webhooks/ {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Uploads (arquivos estáticos)
    location ^~ /uploads/ {
        alias $PROJECT_DIR/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # SPA: redireciona rotas desconhecidas para index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINX

  # Ativar site
  ln -sf /etc/nginx/sites-available/pblocker /etc/nginx/sites-enabled/
  
  # Remover default se existir
  rm -f /etc/nginx/sites-enabled/default

  # Testar configuração
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    log_ok "Nginx configurado e recarregado"
  else
    log_error "Erro na configuração do Nginx! Execute: nginx -t"
    exit 1
  fi
}

# ============================================================
# ETAPA 7: CONFIGURAR SSL
# ============================================================

setup_ssl() {
  log_info "Configurando SSL com Let's Encrypt..."

  # Verificar se o domínio resolve para este servidor
  SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || echo "desconhecido")
  DOMAIN_IP=$(dig +short "$DOMAIN" 2>/dev/null | head -1 || echo "")

  if [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
    log_warn "O domínio $DOMAIN aponta para $DOMAIN_IP mas este servidor é $SERVER_IP"
    log_warn "O SSL pode falhar se o DNS não estiver apontando para este servidor."
    read -p "Tentar configurar SSL mesmo assim? (s/n): " try_ssl
    if [[ "$try_ssl" != "s" && "$try_ssl" != "S" ]]; then
      log_warn "SSL pulado. Configure manualmente depois com:"
      echo "  certbot --nginx -d $DOMAIN"
      return
    fi
  fi

  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect || {
    log_warn "Certbot falhou. Configure SSL manualmente:"
    echo "  certbot --nginx -d $DOMAIN"
  }

  log_ok "SSL configurado"
}

# ============================================================
# ETAPA 8: VERIFICAÇÕES FINAIS
# ============================================================

final_checks() {
  echo ""
  echo -e "${BLUE}╔══════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║          ✅ DEPLOY FINALIZADO!               ║${NC}"
  echo -e "${BLUE}╚══════════════════════════════════════════════╝${NC}"
  echo ""

  # Status dos serviços
  echo -e "${YELLOW}Status dos serviços:${NC}"
  
  # PM2
  if pm2 pid locker-api &>/dev/null; then
    echo -e "  Backend PM2:  ${GREEN}✅ Rodando${NC}"
  else
    echo -e "  Backend PM2:  ${RED}❌ Parado${NC}"
  fi

  # Nginx
  if systemctl is-active --quiet nginx; then
    echo -e "  Nginx:        ${GREEN}✅ Rodando${NC}"
  else
    echo -e "  Nginx:        ${RED}❌ Parado${NC}"
  fi

  # Health check
  if curl -sf "http://localhost:$BACKEND_PORT/api/health" &>/dev/null; then
    echo -e "  Health Check: ${GREEN}✅ OK${NC}"
  else
    echo -e "  Health Check: ${RED}❌ Falhou${NC}"
  fi

  echo ""
  echo -e "${YELLOW}Acesse o sistema:${NC}"
  echo -e "  🌐 https://$DOMAIN"
  echo -e "  📧 Login: $ADMIN_EMAIL"
  echo ""
  echo -e "${YELLOW}Comandos úteis:${NC}"
  echo -e "  pm2 logs locker-api        → Ver logs do backend"
  echo -e "  pm2 restart locker-api     → Reiniciar backend"
  echo -e "  pm2 status                 → Status dos processos"
  echo -e "  tail -f /var/log/nginx/error.log → Logs do Nginx"
  echo ""
  echo -e "${YELLOW}Arquivos importantes:${NC}"
  echo -e "  Backend .env:    $PROJECT_DIR/backend/.env"
  echo -e "  Nginx config:    /etc/nginx/sites-available/pblocker"
  echo -e "  Uploads:         $PROJECT_DIR/backend/uploads/"
  echo -e "  Frontend build:  $PROJECT_DIR/dist/"
  echo ""
}

# ============================================================
# EXECUÇÃO PRINCIPAL
# ============================================================

main() {
  check_root
  collect_info

  echo ""
  log_info "Iniciando deploy..."
  echo ""

  install_system_deps
  setup_directories
  setup_database
  setup_backend
  setup_frontend
  setup_nginx
  setup_ssl
  final_checks
}

main "$@"
