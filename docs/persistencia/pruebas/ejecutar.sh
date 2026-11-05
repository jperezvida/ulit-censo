#!/usr/bin/env bash
# Valida las migraciones en un PostgreSQL LOCAL y DESECHABLE (nunca en Supabase). Uso: ./ejecutar.sh <carpeta-temporal>
set -euo pipefail
D="${1:?carpeta temporal}"; SQL="$(cd "$(dirname "$0")/../sql" && pwd)"; P="$(cd "$(dirname "$0")" && pwd)"
B=/usr/lib/postgresql/16/bin; rm -rf "$D"; mkdir -p "$D"; chown postgres "$D"
run() { su postgres -c "$*"; }
run "$B/initdb -D $D/datos -A trust -U postgres >/dev/null"
run "$B/pg_ctl -D $D/datos -o '-p 54329 -k $D -c listen_addresses=' -l $D/log.txt start >/dev/null"
trap 'su postgres -c "$B/pg_ctl -D $D/datos stop -m fast >/dev/null"' EXIT
q() { psql -h "$D" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
huella() { q -At -c "select md5(string_agg(x, ',' order by x)) from (
  select format('%s.%s|%s|%s', schemaname, tablename, policyname, coalesce(qual, '')) x from pg_policies
  union all select p.oid::regprocedure::text || md5(p.prosrc) || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'auth') and p.proname not like 'ulit\_censo\_%'
  union all select format('%s.%s|%s|%s', table_schema, table_name, grantee, privilege_type) from information_schema.role_table_grants where table_schema in ('public', 'auth')) t"; }
q -f "$P/emulacion_supabase.sql"
ANTES=$(huella)
q -f "$SQL/20261104_0001_ulit_censo_esquema.sql"
q -f "$SQL/20261104_0002_ulit_censo_operaciones.sql"
q -f "$SQL/20261105_0004_ulit_censo_inicializacion_real.sql"
[ "$(huella)" = "$ANTES" ] && echo "✓ Objetos de ULIT base sin cambios tras aplicar 0001, 0002 y 0004" || { echo "✗ Cambió algo de ULIT base"; exit 1; }
q -t -f "$P/pruebas_ulit_censo.sql" 2>&1 | grep -E "^[0-9]+ ·|OK rechazado|SUPERADAS|ERROR|Esperaba|Debía" | sed -E "s/^psql:[^ ]+ NOTICE: +/   /"
q -f "$SQL/20261104_9000_ulit_censo_retirada.sql" 2>/dev/null
[ "$(q -At -c "select count(*) from pg_namespace where nspname = 'ulit_censo'")" = 0 ] && [ "$(q -At -c "select count(*) from pg_proc where proname like 'ulit\_censo\_%'")" = 0 ] && echo "✓ Retirada completa"
[ "$(huella)" = "$ANTES" ] && echo "✓ Objetos de ULIT base idénticos tras la retirada"
