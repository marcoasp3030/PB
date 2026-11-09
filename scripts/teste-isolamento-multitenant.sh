#!/usr/bin/env bash
# ============================================================
# Teste de isolamento multi-tenant (empresa A x empresa B)
#
# Cria duas empresas de teste com admin, armário, porta e fechadura,
# tenta acessar dados da empresa A logado como admin da empresa B
# e confere que o uso legítimo continua funcionando.
# No final remove tudo o que criou.
#
# Uso:
#   SA_EMAIL=admin@pblocker.local SA_PASS='...' ./scripts/teste-isolamento-multitenant.sh
# Variáveis opcionais: API (padrão http://localhost:8082/api), DB_CONTAINER (padrão pblocker-db)
# ============================================================
set -uo pipefail

API="${API:-http://localhost:8082/api}"
DB_CONTAINER="${DB_CONTAINER:-pblocker-db}"
: "${SA_EMAIL:?Defina SA_EMAIL (superadmin)}"
: "${SA_PASS:?Defina SA_PASS (senha do superadmin)}"

PASS=0; FAIL=0
TAG="tst$(date +%s)"
J='Content-Type: application/json'

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
req() { # req METHOD PATH TOKEN [BODY] -> grava corpo em $BODY e status em $CODE
  local m="$1" p="$2" t="$3" b="${4:-}"
  local out; out=$(curl -s -w '\n%{http_code}' -X "$m" "$API$p" -H "$J" ${t:+-H "Authorization: Bearer $t"} ${b:+-d "$b"})
  CODE="${out##*$'\n'}"; BODY="${out%$'\n'*}"
}
check() { # check DESCRIÇÃO CONDIÇÃO(bash)
  if eval "$2"; then PASS=$((PASS+1)); echo "  ✅ $1"; else FAIL=$((FAIL+1)); echo "  ❌ $1  (HTTP $CODE: ${BODY:0:160})"; fi
}
psql_q() { docker exec -i "$DB_CONTAINER" psql -U admin -d pblocker -tAq -c "$1"; }

login() { req POST /auth/login "" "{\"email\":\"$1\",\"password\":\"$2\"}"; echo "$BODY" | json 'd["token"]'; }

echo "▶ Preparando dados de teste ($TAG)"
SA=$(login "$SA_EMAIL" "$SA_PASS"); [ -n "$SA" ] || { echo "Falha no login do superadmin"; exit 1; }

setup_company() { # setup_company LETRA LOCK_ID IP_DA_PLACA
  local L="$1" LOCK="$2" IP="$3"
  req POST /companies "$SA" "{\"name\":\"Empresa $L $TAG\",\"type\":\"employee\"}"; local C; C=$(echo "$BODY" | json 'd["id"]')
  req POST /functions/create-company-user "$SA" "{\"email\":\"admin$L.$TAG@teste.local\",\"password\":\"Senha$L-123!\",\"full_name\":\"Admin $L\",\"company_id\":\"$C\",\"role\":\"admin\"}"
  req POST /lockers "$SA" "{\"name\":\"Armario $L\",\"location\":\"Sede $L\",\"company_id\":\"$C\",\"rows\":1,\"columns\":1,\"orientation\":\"vertical\"}"
  local LK; LK=$(psql_q "update lockers set board_address='$IP' where company_id='$C' returning id" | head -1)
  local D; D=$(psql_q "update locker_doors set lock_id=$LOCK where locker_id='$LK' returning id" | head -1)
  req POST /people "$SA" "{\"company_id\":\"$C\",\"nome\":\"Pessoa $L\",\"tipo\":\"funcionario\"}"; local P; P=$(echo "$BODY" | json 'd["id"]')
  echo "$C $LK $D $P"
}
# As duas empresas usam o MESMO número de fechadura (9001), como acontece na prática
read -r CA LA DA PA <<<"$(setup_company A 9001 10.0.0.1)"
read -r CB LB DB PB <<<"$(setup_company B 9001 10.0.0.2)"
# Empresa A tem um 2º armário (outra placa) que também usa a fechadura 9001
req POST /lockers "$SA" "{\"name\":\"Armario A2\",\"location\":\"Sede A\",\"company_id\":\"$CA\",\"rows\":1,\"columns\":1,\"orientation\":\"vertical\"}"
LA2=$(psql_q "update lockers set board_address='10.0.0.12' where company_id='$CA' and name='Armario A2' returning id" | head -1)
DA2=$(psql_q "update locker_doors set lock_id=9001 where locker_id='$LA2' returning id" | head -1)
TA=$(login "adminA.$TAG@teste.local" "SenhaA-123!")
TB=$(login "adminB.$TAG@teste.local" "SenhaB-123!")
[ -n "$TA" ] && [ -n "$TB" ] || { echo "Falha ao preparar admins"; exit 1; }

echo
echo "▶ Uso legítimo (admin A na própria empresa)"
req GET /lockers "$TA";                              check "lista só os próprios armários (A1 e A2)" '[ "$(echo "$BODY" | json "len(d) == 2 and all(l[\"company_id\"] == \"$CA\" for l in d)")" = True ]'
req PUT "/lockers/$LA" "$TA" '{"name":"Armario A editado"}'; check "edita o próprio armário" '[ "$CODE" = 200 ]'
req GET "/compat/lockers?id=$LA" "$TA";              check "compat: lê o próprio armário" '[ "$(echo "$BODY" | json "len(d)")" = 1 ]'
req PUT /compat/locker_doors "$TA" "{\"data\":{\"label\":\"Porta A1\"},\"params\":{\"id\":\"$DA\"}}"
                                                     check "compat: edita a própria porta" '[ "$(echo "$BODY" | json "len(d)")" = 1 ]'
req POST /fechaduras/abrir-admin "$TA" '{"lock_id":9001}'
                                                     check "lock_id repetido em 2 armários → pede a porta (409)" '[ "$CODE" = 409 ]'
req POST /fechaduras/abrir-admin "$TA" "{\"door_id\":\"$DA2\"}"; CMD_A=$(echo "$BODY" | json 'd["id"]')
                                                     check "abre a porta exata do armário A2" '[ "$CODE" = 201 ]'
req GET "/fechaduras/status/$CMD_A" "$TA";           check "consulta status do próprio comando" '[ "$CODE" = 200 ]'
req POST /fechaduras/agentes "$TA" '{"nome":"Agente A"}'; KEY_A=$(echo "$BODY" | json 'd["api_key"]')
                                                     check "gera chave do agente da empresa" '[ "$CODE" = 201 ] && [ -n "$KEY_A" ]'
req POST /fechaduras/agentes "$TB" '{"nome":"Agente B"}'; KEY_B=$(echo "$BODY" | json 'd["api_key"]')

echo
echo "▶ Tentativas do admin B contra a empresa A (todas devem falhar)"
req PUT "/lockers/$LA" "$TB" '{"name":"INVADIDO"}';  check "renomear armário de A → 404" '[ "$CODE" = 404 ]'
req GET "/lockers/$LA/doors" "$TB";                  check "ler portas de A → 404" '[ "$CODE" = 404 ]'
req DELETE "/people/$PA" "$TB";                      check "excluir pessoa de A → 404" '[ "$CODE" = 404 ]'
req GET /compat/profiles "$TB";                      check "compat: só vê perfis da própria empresa" '[ "$(echo "$BODY" | json "all(p[\"company_id\"]==\"'"$CB"'\" for p in d)")" = True ]'
req PUT /compat/companies "$TB" "{\"data\":{\"name\":\"INVADIDA\"},\"params\":{\"id\":\"$CA\"}}"
                                                     check "compat: renomear empresa A → 403" '[ "$CODE" = 403 ]'
req PUT /compat/profiles "$TB" "{\"data\":{\"role\":\"superadmin\"},\"params\":{\"full_name\":\"Admin B\"}}"
                                                     check "compat: virar superadmin → 403" '[ "$CODE" = 403 ]'
req PUT /compat/lockers "$TB" "{\"data\":{\"name\":\"INVADIDO\"},\"params\":{\"id\":\"$LA\"}}"
                                                     check "compat: editar armário de A → 0 linhas" '[ "$(echo "$BODY" | json "len(d)")" = 0 ]'
req POST /compat/locker_doors "$TB" "{\"locker_id\":\"$LA\",\"door_number\":99}"
                                                     check "compat: criar porta no armário de A → 403" '[ "$CODE" = 403 ]'
req POST /compat/lockers "$TB" "{\"name\":\"X\",\"company_id\":\"$CA\"}"
                                                     check "compat: criar armário na empresa A → 403" '[ "$CODE" = 403 ]'
req GET "/compat/lockers?_order=id;DROP%20TABLE%20x" "$TB"; check "compat: SQL injection no _order → 400" '[ "$CODE" = 400 ]'
req POST /fechaduras/abrir-admin "$TB" "{\"door_id\":\"$DA\"}"; check "abrir porta de A → 404" '[ "$CODE" = 404 ]'
req POST /fechaduras/abrir-admin "$TB" '{"lock_id":9001}'; CMD_B=$(echo "$BODY" | json 'd["id"]')
                                                     check "mesmo nº de fechadura abre só a porta de B" '[ "$CODE" = 201 ]'
req GET "/fechaduras/status/$CMD_A" "$TB";           check "status de comando de A → 404" '[ "$CODE" = 404 ]'
req GET /fechaduras/historico-admin "$TB";           check "histórico não mostra comandos de A" '[ "$(echo "$BODY" | json "len([c for c in d if c[\"id\"]==$CMD_A])")" = 0 ]'
req POST /email-notify "$TB" "{\"companyId\":\"$CA\",\"type\":\"test\"}"; check "notificar usando empresa A → 403" '[ "$CODE" = 403 ]'
req POST /functions/create-person-login "$TB" "{\"person_id\":\"$PB\",\"email\":\"$SA_EMAIL\",\"password\":\"Hack-123456\"}"
                                                     check "sequestrar conta do superadmin → 409" '[ "$CODE" = 409 ]'
req DELETE "/upload/..%2F..%2Fdist/index.js" "$TB";  check "path traversal no upload → bloqueado" '[ "$CODE" != 200 ]'
req GET /settings "$TB";                             check "settings sem segredos da plataforma" '[ "$(echo "$BODY" | json "any(s[\"key\"] in (\"fechaduras_api_key\",\"smtp_config\") for s in d)")" = False ]'

echo
echo "▶ Agente IoT (fila por empresa)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/fechaduras/comandos"); BODY=""
                                                     check "sem API Key → 401" '[ "$CODE" = 401 ]'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: chave-falsa" "$API/fechaduras/comandos")
                                                     check "chave inválida → 403" '[ "$CODE" = 403 ]'
BODY=$(curl -s -H "X-API-Key: $KEY_B" "$API/fechaduras/comandos"); CODE=200
                                                     check "agente B recebe só o comando de B, na placa de B" '[ "$(echo "$BODY" | json "(d.get(\"id\"), d.get(\"board_address\"))")" = "($CMD_B, '"'"'10.0.0.2'"'"')" ]'
BODY=$(curl -s -H "X-API-Key: $KEY_B" "$API/fechaduras/comandos"); CODE=200
                                                     check "agente B não recebe comando de A" '[ "$(echo "$BODY" | json "d.get(\"status\")")" = vazio ]'
BODY=$(curl -s -H "X-API-Key: $KEY_A" "$API/fechaduras/comandos"); CODE=200
                                                     check "agente A recebe o comando com a placa do A2 (10.0.0.12)" '[ "$(echo "$BODY" | json "(d.get(\"id\"), d.get(\"board_address\"))")" = "($CMD_A, '"'"'10.0.0.12'"'"')" ]'
BODY=$(curl -s -X POST -H "X-API-Key: $KEY_B" -H "$J" -d "{\"id\":$CMD_A,\"status\":\"executado\"}" "$API/fechaduras/concluir"); CODE=x
                                                     check "agente B não conclui comando de A" '[ "$(echo "$BODY" | json "d.get(\"success\")")" = False ]'
BODY=$(curl -s -X POST -H "X-API-Key: $KEY_B" -H "$J" -d "{\"door_id\":\"$DA\"}" "$API/fechaduras/abrir"); CODE=x
                                                     check "agente B não abre fechadura de A" '[ "$(echo "$BODY" | json "d.get(\"success\")")" = False ]'

echo
echo "▶ WhatsApp (webhook) — origem comprovada e telefone exato"
UAZ_CREATED=$(psql_q "insert into platform_settings(key,value) values ('uazapi_server_url','\"http://127.0.0.1:9\"') on conflict (key) do nothing returning 1")
psql_q "update funcionarios_clientes set telefone='(11) 98888-7777' where id='$PA';
        update locker_doors set status='occupied', occupied_by_person='$PA', usage_type='temporary', occupied_at=now(), expires_at=now()+interval '2 hours' where id='$DA';" >/dev/null
SEC_A=$(psql_q "insert into company_whatsapp(company_id,instance_name,instance_token,status) values ('$CA','inst-a-$TAG','tok-a-$TAG','connected') returning webhook_secret" | head -1)
SEC_B=$(psql_q "insert into company_whatsapp(company_id,instance_name,instance_token,status) values ('$CB','inst-b-$TAG','tok-b-$TAG','connected') returning webhook_secret" | head -1)
porta_a() { psql_q "select status from locker_doors where id='$DA'"; }
MSG='{"key":{"remoteJid":"5511988887777@s.whatsapp.net"},"message":{"conversation":"liberar"}}'
req POST /webhooks/whatsapp "" "$MSG";               check "webhook sem segredo → 401" '[ "$CODE" = 401 ]'
req POST /webhooks/whatsapp/segredo-falso "" "$MSG"; check "webhook com segredo falso → 401" '[ "$CODE" = 401 ]'
req POST "/webhooks/whatsapp/$SEC_B" "" "$MSG";      check "URL da empresa B não acha pessoa de A (porta segue ocupada)" '[ "$(porta_a)" = occupied ]'
req POST "/webhooks/whatsapp/$SEC_A" "" '{"key":{"remoteJid":"5511@s.whatsapp.net"},"message":{"conversation":"liberar"}}'
                                                     check "número curto/falso não casa com ninguém" '[ "$(porta_a)" = occupied ]'
req POST "/webhooks/whatsapp/$SEC_A" "" '{"key":{"remoteJid":"5511988887777@s.whatsapp.net"},"message":{"conversation":"renovar"}}'
                                                     check "renovar vira solicitação pendente (não estende direto)" '[ "$(psql_q "select count(*) from renewal_requests where door_id='"'"'$DA'"'"' and status='"'"'pending'"'"'")" = 1 ]'
req POST "/webhooks/whatsapp/$SEC_A" "" "$MSG";      check "dono do telefone, na URL certa, libera a própria porta" '[ "$(porta_a)" = available ]'

echo
echo "▶ Login, perfis, sessões e suspensão"
req POST /rpc/register_login_attempt "" "{\"_email\":\"$SA_EMAIL\",\"_success\":false}"
                                                     check "RPC pública de tentativas de login removida" '[ "$CODE" = 400 ]'
req POST /functions/create-person-login "$TA" "{\"person_id\":\"$PA\",\"email\":\"portalA.$TAG@teste.local\",\"password\":\"Portal-123!\"}"
TU=$(login "portalA.$TAG@teste.local" "Portal-123!")
req GET /people "$TU";                               check "funcionário não lista pessoas → 403" '[ "$CODE" = 403 ]'
req GET /audit "$TU";                                check "funcionário não lê auditoria → 403" '[ "$CODE" = 403 ]'
req GET "/admin/whatsapp/$CA" "$TU";                 check "funcionário não lê config do WhatsApp → 403" '[ "$CODE" = 403 ]'
req POST /reservations "$TU" "{\"door_id\":\"$DA\",\"locker_id\":\"$LA\",\"person_id\":\"$PA\"}"
                                                     check "funcionário não cria reserva → 403" '[ "$CODE" = 403 ]'
req GET "/admin/whatsapp/$CA" "$TA";                 check "admin vê token do WhatsApp mascarado" '[ "$CODE" = 200 ] && ! echo "$BODY" | grep -q "tok-a-$TAG"'
TU_OUTRA=$(login "portalA.$TAG@teste.local" "Portal-123!")
req POST /auth/change-password "$TU" '{"currentPassword":"Portal-123!","newPassword":"Portal-456!"}'; TU_NOVO=$(echo "$BODY" | json 'd["token"]')
                                                     check "troca de senha (formato do portal) funciona" '[ "$CODE" = 200 ] && [ -n "$TU_NOVO" ]'
req GET /auth/me "$TU_OUTRA";                        check "sessão antiga é encerrada após trocar a senha" '[ "$CODE" = 401 ]'
req GET /auth/me "$TU_NOVO";                         check "token novo continua válido" '[ "$CODE" = 200 ]'
req PUT /compat/companies "$SA" "{\"data\":{\"active\":false},\"params\":{\"id\":\"$CB\"}}"
req GET /compat/lockers "$TB";                       check "empresa suspensa: sessão aberta bloqueada → 403" '[ "$CODE" = 403 ]'
req POST /auth/login "" "{\"email\":\"adminB.$TAG@teste.local\",\"password\":\"SenhaB-123!\"}"
                                                     check "empresa suspensa: login bloqueado → 403" '[ "$CODE" = 403 ]'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: $KEY_B" "$API/fechaduras/comandos"); BODY=""
                                                     check "empresa suspensa: agente bloqueado → 403" '[ "$CODE" = 403 ]'

echo
echo "▶ Uploads"
PNG=$(mktemp); python3 -c "import base64,sys;open(sys.argv[1],'wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='))" "$PNG"
UP=$(curl -s -X POST "$API/upload/avatars" -H "Authorization: Bearer $TA" -F "file=@$PNG;filename=teste.png"); rm -f "$PNG"
UP_URL=$(echo "$UP" | json 'd["url"]'); UP_FILE=$(echo "$UP" | json 'd["filename"]')
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$UP_URL"); BODY="$UP_URL"
                                                     check "imagem enviada abre pela URL devolvida" '[ "$CODE" = 200 ]'
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${API%/api}/uploads/avatars/$UP_FILE")
                                                     check "imagem abre por /uploads/ (Nginx)" '[ "$CODE" = 200 ]'
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/upload/platform-assets" -H "Authorization: Bearer $TU_NOVO" -F "file=@/dev/null;filename=x.png")
                                                     check "funcionário não envia arquivos da plataforma → 403" '[ "$CODE" = 403 ]'
docker exec pblocker-api sh -c "rm -f uploads/avatars/$UP_FILE" 2>/dev/null

echo
echo "▶ Limpando dados de teste"
psql_q "
  DELETE FROM comandos_fechadura WHERE company_id IN ('$CA','$CB');
  DELETE FROM renewal_requests WHERE company_id IN ('$CA','$CB');
  DELETE FROM company_whatsapp WHERE company_id IN ('$CA','$CB');
  DELETE FROM login_attempts WHERE email LIKE '%.$TAG@teste.local';
  DELETE FROM fechadura_agentes WHERE company_id IN ('$CA','$CB');
  DELETE FROM locker_reservations WHERE locker_id IN (SELECT id FROM lockers WHERE company_id IN ('$CA','$CB'));
  DELETE FROM locker_doors WHERE locker_id IN (SELECT id FROM lockers WHERE company_id IN ('$CA','$CB'));
  DELETE FROM lockers WHERE company_id IN ('$CA','$CB');
  DELETE FROM funcionarios_clientes WHERE company_id IN ('$CA','$CB');
  DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%.$TAG@teste.local');
  DELETE FROM users WHERE email LIKE '%.$TAG@teste.local';
  DELETE FROM company_permissions WHERE company_id IN ('$CA','$CB');
  DELETE FROM audit_logs WHERE company_id IN ('$CA','$CB');  -- por último: os triggers geram logs nas exclusões acima
  DELETE FROM companies WHERE id IN ('$CA','$CB');
" >/dev/null
[ "$UAZ_CREATED" = 1 ] && psql_q "DELETE FROM platform_settings WHERE key='uazapi_server_url'" >/dev/null

echo
echo "Resultado: $PASS ok, $FAIL falha(s)"
[ "$FAIL" -eq 0 ]
