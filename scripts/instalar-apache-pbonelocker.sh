#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Configura o Apache do HOST para servir pbonelocker.com.br via reverse proxy
# até o frontend Docker (127.0.0.1:8082). Rode na VPS, no diretório do projeto:
#   sudo bash scripts/instalar-apache-pbonelocker.sh
#
# Requisitos: Apache 2.4 (Debian/Ubuntu), Docker Compose já publicando 8082 em 127.0.0.1
# -----------------------------------------------------------------------------

set -euo pipefail

if [[ "${EUID:-}" -ne 0 ]]; then
  echo "Execute como root: sudo bash scripts/instalar-apache-pbonelocker.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_CONF="${ROOT_DIR}/docker/apache-pbonelocker-vhost.conf"
DEST_CONF="/etc/apache2/sites-available/pbonelocker.conf"

if ! command -v apache2ctl >/dev/null 2>&1; then
  echo "apache2ctl não encontrado. Este script é para Debian/Ubuntu (pacote apache2)."
  exit 1
fi

if [[ ! -f "${SRC_CONF}" ]]; then
  echo "Arquivo ausente: ${SRC_CONF}"
  exit 1
fi

echo ">>> Habilitando módulos Apache necessários..."
a2enmod proxy proxy_http headers ssl rewrite >/dev/null 2>&1 || true

echo ">>> Instalando VirtualHost em ${DEST_CONF}"
install -m 0644 "${SRC_CONF}" "${DEST_CONF}"

echo ">>> Ativando site pbonelocker..."
a2ensite pbonelocker >/dev/null 2>&1 || true

echo ">>> Testando configuração..."
apache2ctl configtest

echo ">>> Reiniciando Apache (carrega módulos novos + site)..."
systemctl restart apache2

echo ""
echo "OK. Testes sugeridos (na VPS):"
echo "  curl -sI http://127.0.0.1:8082/ | head -3"
echo "  curl -sI http://pbonelocker.com.br/ | head -8"
echo ""
echo "HTTPS (quando o HTTP estiver ok):"
echo "  certbot --apache -d pbonelocker.com.br -d www.pbonelocker.com.br"
echo ""
