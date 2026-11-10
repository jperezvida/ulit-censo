#!/usr/bin/env bash
# PostgreSQL 17 completamente desechable: NO se conecta a Supabase ni a redes.
set -euo pipefail
D="${1:?directorio temporal}"
B=/usr/lib/postgresql/17/bin
SQL=/work/docs/persistencia/sql
P=/work/docs/persistencia/pruebas
rm -rf "$D"
mkdir -p "$D"
chown postgres "$D"
su postgres -c "$B/initdb -D $D/datos -A trust -U postgres >/dev/null"
su postgres -c "$B/pg_ctl -D $D/datos -o '-p 54339 -k $D -c listen_addresses=' -l $D/log.txt start >/dev/null"
trap 'su postgres -c "$B/pg_ctl -D $D/datos stop -m fast >/dev/null"' EXIT
q() { psql -h "$D" -p 54339 -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q "$@"; }
q -f "$P/emulacion_supabase.sql"
q -f "$SQL/20261104_0001_ulit_censo_esquema.sql"
q -f "$SQL/20261104_0002_ulit_censo_operaciones.sql"
q -f "$SQL/20261105_0004_ulit_censo_inicializacion_real.sql"
q -f "$SQL/20261110_0010_revision_general_2026.sql"
q -f "$P/revision_general_2026.sql"
echo '✓ Migración 0010 verificada con PostgreSQL 17 y datos ficticios'
