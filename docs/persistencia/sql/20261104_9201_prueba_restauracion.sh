#!/usr/bin/env bash
# ULIT Censo · PRUEBA DE RESTAURACIÓN COMPLETA de un respaldo 9200 en un Supabase DESECHABLE (Docker local).
# No toca el origen ni ningún proyecto: crea un contenedor nuevo de la misma imagen, restaura y compara.
#   ./20261104_9201_prueba_restauracion.sh <archivo.dump>
# Política de errores: --exit-on-error y --single-transaction; NINGÚN error se ignora. Solo se excluyen,
# una a una y por su identificador, las entradas que la propia plataforma crea en una base Supabase nueva:
#   E1. «DEFAULT ACL … FOR ROLE supabase_*»: privilegios por defecto de los roles internos de Supabase
#       (`postgres` no puede cambiarlos: «permission denied to change default privileges»). La imagen nueva
#       ya los trae; se comprueba que coinciden en la verificación.
#   E2. Datos de auth.schema_migrations y storage.migrations: versión de los servicios de la plataforma (la
#       imagen nueva ya los tiene; restaurarlos duplicaría filas).
# Orden: (1) DATOS de auth y storage (cuentas y metadatos; en el contenedor desechable, como supabase_admin), (2) esquemas de aplicación con sus datos
# (public, ulit_go, ulit_censo… todo lo que no es de la plataforma). Así se resuelven las claves foráneas a
# auth.users, que causaban el error de la restauración anterior (solo con --schema=public).
set -euo pipefail
DUMP="${1:?archivo .dump}"; S="$(cd "$(dirname "$0")" && pwd)"
[ -f "$DUMP.inventario" ] || { echo "✗ Falta $DUMP.inventario (lo genera 9200 en el origen)." >&2; exit 92; }
sha256sum -c "$DUMP.sha256" >/dev/null || { echo "✗ El SHA-256 del respaldo no coincide." >&2; exit 92; }
IMAGEN_PG=${IMAGEN_PG:-supabase/postgres:17.6.1.043}
# Destino: un Supabase local COMPLETO y desechable (con su servicio Auth, para que el esquema auth tenga la
# misma versión que el origen), en otros puertos y otra carpeta. Se elimina al terminar.
DR="$(mktemp -d /var/tmp/ulit-censo-restaura-XXXX)"
( cd "$DR" && npx -y supabase@2.58.5 init --force >/dev/null 2>&1 )
python3 - "$DR/supabase/config.toml" <<'PY'
import re, sys; p = sys.argv[1]; s = open(p).read()
s = re.sub(r'project_id = ".*"', 'project_id = "ulit-censo-restaura"', s)
for a, b in [('54321', '56321'), ('54322', '56322'), ('54320', '56320'), ('54323', '56323'), ('54324', '56324'), ('54327', '56327'), ('54329', '56329'), ('8083', '58083')]:
    s = s.replace(f'= {a}', f'= {b}')
for sec in ['realtime', 'studio', 'inbucket', 'storage', 'edge_runtime', 'analytics']:
    s = re.sub(r'(\[%s\]\n(?:#.*\n)*enabled = )true' % sec, r'\1false', s)
open(p, 'w').write(s)
PY
( cd "$DR" && SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx -y supabase@2.58.5 start >/dev/null )
trap '( cd "$DR" && npx -y supabase@2.58.5 stop --no-backup >/dev/null 2>&1 ); rm -rf "$DR"' EXIT
R="postgresql://postgres:postgres@127.0.0.1:56322/postgres"
# Los datos de auth/storage pertenecen a los roles internos de la plataforma: en el Supabase DESECHABLE se
# cargan como su administrador (supabase_admin); el resto, como postgres (igual que en un proyecto real).
RA="postgresql://supabase_admin:postgres@127.0.0.1:56322/postgres"
GEST="auth|storage|realtime|_realtime|extensions|graphql|graphql_public|net|pgbouncer|supabase_functions|vault|cron|pgsodium|pgsodium_masks|supabase_migrations|_analytics"
# Esquemas de aplicación presentes en el respaldo (todo lo que no es de la plataforma), más public
APP=$( (echo public; awk '$4 == "SCHEMA" && $5 == "-" {print $6}' "$DUMP.indice") | sort -u | grep -vxE "$GEST" )
D="$(cd "$(dirname "$DUMP")" && pwd)"; B="$(basename "$DUMP")"
pgr() { docker run --rm --network host -v "$D:/r:ro" "$IMAGEN_PG" pg_restore "$@"; }
LOG="$DUMP.restauracion.log"; : > "$LOG"; chmod 600 "$LOG"
# Exclusiones E1/E2, registradas una a una; el resto de la lista se restaura entero
grep -E ' DEFAULT ACL .* supabase_[a-z_]+$' "$DUMP.indice" | sed 's/^/EXCLUIDA E1: /' >> "$LOG" || true
grep -E ' TABLE DATA (auth schema_migrations|storage migrations) ' "$DUMP.indice" | sed 's/^/EXCLUIDA E2: /' >> "$LOG" || true
grep -vE ' DEFAULT ACL .* supabase_[a-z_]+$| TABLE DATA (auth schema_migrations|storage migrations) ' "$DUMP.indice" > "$D/$B.lista"
NS=(); for n in $APP; do NS+=(-n "$n"); done
echo "== (1) datos de auth y storage" >> "$LOG"
pgr --exit-on-error --single-transaction --data-only --disable-triggers -n auth -n storage -L "/r/$B.lista" --dbname="$RA" "/r/$B" >> "$LOG" 2>&1 \
  || { echo "✗ Error al restaurar los datos de auth/storage (detalle en $LOG)."; tail -3 "$LOG"; exit 93; }
echo "== (2) esquemas de aplicación: $(echo $APP)" >> "$LOG"
# (2a) Los esquemas en sí, con sus permisos y comentarios (`-n` no los incluye); public ya existe
OTROS=$(echo $APP | tr ' ' '\n' | grep -vx public | paste -sd'|' -)
if [ -n "$OTROS" ]; then
  grep -E "^[0-9]+; [0-9]+ [0-9]+ (SCHEMA - |ACL - SCHEMA |COMMENT - SCHEMA )($OTROS) " "$D/$B.lista" > "$D/$B.lista-esquemas"
  pgr --exit-on-error --single-transaction --no-owner -L "/r/$B.lista-esquemas" --dbname="$R" "/r/$B" >> "$LOG" 2>&1 \
    || { echo "✗ Error al crear los esquemas de aplicación (detalle en $LOG)."; tail -3 "$LOG"; exit 94; }
fi
# (2b) Sin privilegios por defecto durante la restauración: si no, cada objeto recreado recibiría los
# permisos por defecto del destino (p. ej. EXECUTE para anon y service_role en funciones de public) además
# de los suyos. Los privilegios por defecto del origen vuelven al final con las entradas DEFAULT ACL del volcado.
psql "$R" -v ON_ERROR_STOP=1 -q -c "do \$\$ declare x record; begin
  for x in select n.nspname as esquema, a.defaclobjtype as t from pg_default_acl a join pg_namespace n on n.oid = a.defaclnamespace where pg_get_userbyid(a.defaclrole) = 'postgres' loop
    execute format('alter default privileges for role postgres in schema %I revoke all on %s from public, anon, authenticated, service_role', x.esquema,
      case x.t when 'r' then 'tables' when 'f' then 'functions' when 'S' then 'sequences' when 'T' then 'types' end);
  end loop; end \$\$" >> "$LOG" 2>&1 || { echo "✗ No se han podido suspender los privilegios por defecto del destino (detalle en $LOG)."; exit 94; }
pgr --exit-on-error --single-transaction --no-owner "${NS[@]}" -L "/r/$B.lista" --dbname="$R" "/r/$B" >> "$LOG" 2>&1 \
  || { echo "✗ Error al restaurar los esquemas de aplicación (detalle en $LOG)."; tail -3 "$LOG"; exit 94; }
# Verificación: inventario de objetos y datos IDÉNTICO al del origen (tomado por 9200 en el momento del volcado)
psql "$R" -v ON_ERROR_STOP=1 -At -f "$S/20261104_9102_inventario_datos.sql" | grep -E '^(objeto|datos)\|' > "$DUMP.inventario-restaurado"
if diff -q "$DUMP.inventario" "$DUMP.inventario-restaurado" >/dev/null; then
  echo "✓ Restauración COMPLETA sin errores: $(grep -c '^objeto|' "$DUMP.inventario") objetos y $(grep -c '^datos|' "$DUMP.inventario") tablas (incl. auth y storage) idénticos al origen · esquemas: $(echo $APP) · exclusiones: $(grep -c '^EXCLUIDA E1' "$LOG") E1, $(grep -c '^EXCLUIDA E2' "$LOG") E2"
else
  echo "✗ La restauración difiere del origen:"; diff "$DUMP.inventario" "$DUMP.inventario-restaurado" | cut -c1-160 | head -20; exit 95
fi
