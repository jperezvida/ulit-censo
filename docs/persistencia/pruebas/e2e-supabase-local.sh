#!/usr/bin/env bash
# Recorrido completo contra un Supabase LOCAL (Docker), nunca contra el compartido. Datos SINTÉTICOS.
# Requisitos: Docker en marcha. Uso: docs/persistencia/pruebas/e2e-supabase-local.sh <carpeta-temporal>
set -euo pipefail
R="$(cd "$(dirname "$0")/../../.." && pwd)"; P="$R/docs/persistencia"; D="${1:?carpeta temporal}"
mkdir -p "$D" && cd "$D"
[ -f supabase/config.toml ] || npx -y supabase@2.58.5 init --force >/dev/null
# Solo los servicios necesarios: base de datos, Auth, PostgREST y Kong.
python3 - <<'PY'
import re; p='supabase/config.toml'; s=open(p).read()
for sec in ['realtime','studio','inbucket','storage','edge_runtime','analytics']:
    s=re.sub(r'(\[%s\]\n(?:#.*\n)*enabled = )true'%sec, r'\1false', s)
open(p,'w').write(s)
PY
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx -y supabase@2.58.5 start >/dev/null
ESTADO=$(npx -y supabase@2.58.5 status -o env)
URL=$(echo "$ESTADO" | sed -n 's/^API_URL="\(.*\)"/\1/p'); PUB=$(echo "$ESTADO" | sed -n 's/^PUBLISHABLE_KEY="\(.*\)"/\1/p'); SEC=$(echo "$ESTADO" | sed -n 's/^SECRET_KEY="\(.*\)"/\1/p'); DB=$(echo "$ESTADO" | sed -n 's/^DB_URL="\(.*\)"/\1/p')
q() { psql "$DB" -v ON_ERROR_STOP=1 -q "$@"; }
q -f "$P/pruebas/ulit_base_muestra.sql"
ANTES=$(q -At -f "$P/sql/20261104_9101_huella_ulit_base.sql")
q -c "select 1 from pg_namespace where nspname = 'ulit_censo'" -At | grep -q 1 && q -f "$P/sql/20261104_9000_ulit_censo_retirada.sql" >/dev/null 2>&1
q -f "$P/sql/20261104_0001_ulit_censo_esquema.sql"; q -f "$P/sql/20261104_0002_ulit_censo_operaciones.sql"
[ "$(q -At -f "$P/sql/20261104_9101_huella_ulit_base.sql")" = "$ANTES" ] && echo "✓ ULIT base intacto tras aplicar 0001 y 0002"
cd "$R"
env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy NO_PROXY=127.0.0.1,localhost \
  ULIT_CENSO_SUPABASE_LOCAL_URL="$URL" ULIT_CENSO_SUPABASE_LOCAL_PUBLICA="$PUB" ULIT_CENSO_SUPABASE_LOCAL_SECRETA="$SEC" ULIT_CENSO_SUPABASE_LOCAL_PSQL="$DB" \
  npx vitest run src/store/supabaseLocal.e2e.test.ts --reporter=verbose
