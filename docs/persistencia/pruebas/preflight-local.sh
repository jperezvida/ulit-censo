#!/usr/bin/env bash
# Ensayo LOCAL del procedimiento de instalación (nunca contra el compartido): huella determinista (9101),
# respaldo externo recuperable (9200), aplicar 0001/0002, comparar huellas y retirar (9000).
# Uso: DB=postgresql://postgres:postgres@127.0.0.1:54322/postgres docs/persistencia/pruebas/preflight-local.sh <carpeta-temporal>
set -euo pipefail
P="$(cd "$(dirname "$0")/.." && pwd)"; T="${1:?carpeta temporal}"; mkdir -p "$T"; : "${DB:?cadena del Supabase local}"
. "$P/pruebas/solo-local.sh"; exigir_entorno_local "$DB"
q() { psql "$DB" -v ON_ERROR_STOP=1 -q "$@"; }
h() { q -At -F' ' -f "$P/sql/20261104_9101_huella_ulit_base.sql"; }
q -c "select 1 from pg_namespace where nspname = 'ulit_censo'" -At | grep -q 1 && q -f "$P/sql/20261104_9000_ulit_censo_retirada.sql" >/dev/null 2>&1 || true
A=$(h); [ "$A" = "$(h)" ] && echo "✓ Huella estable en dos ejecuciones ($A)"
# Reordenar privilegios sin cambiarlos (revocar y volver a conceder) no debe cambiar la huella
q -c "revoke execute on function public.es_admin_base_catedra() from authenticated; grant execute on function public.es_admin_base_catedra() to authenticated;
      revoke select on public.perfiles from authenticated; grant select on public.perfiles to authenticated;"
[ "$(h)" = "$A" ] && echo "✓ Huella independiente del orden de los privilegios"
# Un cambio real en ULIT base sí la cambia
q -c "create function public.zz_cambio_prueba() returns int language sql as 'select 1'"
[ "$(h)" != "$A" ] && echo "✓ Un cambio real en ULIT base cambia la huella"
q -c "drop function public.zz_cambio_prueba()"; [ "$(h)" = "$A" ] && echo "✓ Deshecho el cambio, vuelve la huella original"
# Respaldo externo (9200) y prueba de recuperación en un PostgreSQL desechable de la misma imagen
# 9200 exige la contraseña solo en PGPASSWORD (nunca en la cadena)
PGPASSWORD=$(printf '%s' "$DB" | sed -E 's#^[a-z]+://[^:]+:([^@]+)@.*#\1#') ORIGEN=$(printf '%s' "$DB" | sed -E 's#^([a-z]+://[^:]+):[^@]+@#\1@#') DESTINO="$T" "$P/sql/20261104_9200_respaldo_externo.sh"
F=$(ls "$T"/censo-comercios-*.dump | tail -1)
grep -q "TABLE public perfiles" "$F.indice" && echo "✓ El respaldo contiene los objetos de ULIT base (p. ej. public.perfiles)"
sha256sum -c "$F.sha256" >/dev/null && echo "✓ SHA-256 del respaldo comprobado"
# Aplicar ULIT Censo y comparar
q -f "$P/sql/20261104_0001_ulit_censo_esquema.sql"; q -f "$P/sql/20261104_0002_ulit_censo_operaciones.sql"
[ "$(h)" = "$A" ] && echo "✓ ULIT base idéntico tras aplicar 0001 y 0002"
q -f "$P/sql/20261104_9000_ulit_censo_retirada.sql" >/dev/null 2>&1
[ "$(h)" = "$A" ] && echo "✓ ULIT base idéntico tras la retirada (9000)"
# Recuperación COMPLETA del respaldo en un Supabase desechable, sin silenciar errores (9201)
"$P/sql/20261104_9201_prueba_restauracion.sh" "$F" "$DB"
