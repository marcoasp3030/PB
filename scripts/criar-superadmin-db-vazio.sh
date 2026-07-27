#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Cria empresa + usuário superadmin quando o PostgreSQL está vazio (Docker).
# Uso na VPS, no diretório do projeto (com volume ./:/workspace no backend):
#
#   export ADMIN_EMAIL="admin@exemplo.com.br"
#   export ADMIN_PASSWORD="sua_senha_segura"
#   bash scripts/criar-superadmin-db-vazio.sh
#
# Opcional: ADMIN_NOME, EMPRESA_NOME
# -----------------------------------------------------------------------------

set -euo pipefail

ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
  echo "Defina ADMIN_EMAIL e ADMIN_PASSWORD (export) e execute de novo."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -q '^pblocker-api$'; then
  echo "Container pblocker-api não está em execução."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS="${SCRIPT_DIR}/criar-superadmin-db-vazio.cjs"

if [[ ! -f "$JS" ]]; then
  echo "Arquivo ausente: $JS"
  exit 1
fi

docker exec -w /app \
  -e NODE_PATH=/app/node_modules \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" \
  -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e ADMIN_NOME="${ADMIN_NOME:-Administrador}" \
  -e EMPRESA_NOME="${EMPRESA_NOME:-PBLocker}" \
  pblocker-api node /workspace/scripts/criar-superadmin-db-vazio.cjs

echo "Concluído. Execute: unset ADMIN_PASSWORD"
