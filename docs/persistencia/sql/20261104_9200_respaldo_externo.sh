#!/usr/bin/env bash
# ULIT Censo · RESPALDO EXTERNO de TODO el proyecto compartido (ULIT base incluida), FUERA de su base de datos.
# Solo LEE el proyecto. Requiere autorización expresa. Uso:
#   PGPASSWORD=…  ORIGEN="postgresql://postgres@<host>:5432/postgres?sslmode=require" \
#   DESTINO=/ruta/institucional/con/control/de/acceso  ./20261104_9200_respaldo_externo.sh
# - La contraseña va SOLO en PGPASSWORD (nunca en ORIGEN, en la línea de órdenes ni en los registros).
# - DESTINO: carpeta institucional, fuera del repositorio; los archivos quedan con permisos 600.
# - Además del volcado, guarda (solo lectura) la huella 9101 y el inventario 9102 del ORIGEN, para validar
#   después la restauración (9201). No imprime datos: solo rutas, tamaños, recuentos y huellas.
# - Supabase Storage: los ARCHIVOS de los buckets no están en la base; si ULIT base los usa, se respaldan aparte.
set -euo pipefail
umask 077
: "${ORIGEN:?cadena de conexión SIN contraseña}"; : "${DESTINO:?carpeta institucional}"
case "$ORIGEN" in *://*:*@*) echo "✗ ORIGEN no debe incluir la contraseña (use PGPASSWORD)." >&2; exit 91;; esac
S="$(cd "$(dirname "$0")" && pwd)"
[ -d "$DESTINO" ] || { echo "✗ DESTINO no existe." >&2; exit 91; }
case "$(cd "$DESTINO" && pwd)/" in "$(cd "$S/../../.." && pwd)/"*) echo "✗ DESTINO no puede estar dentro del repositorio." >&2; exit 91;; esac
IMAGEN_PG=${IMAGEN_PG:-supabase/postgres:17.6.1.043}   # misma versión mayor que el servidor
pgd() { docker run --rm -i --network host -e PGPASSWORD "$IMAGEN_PG" "$@"; }
# Sesiones de SOLO LECTURA contra el origen (pg_dump ya lo es; psql, también por configuración).
export PGOPTIONS="-c default_transaction_read_only=on"
F="$DESTINO/censo-comercios-$(date -u +%Y%m%dT%H%M%SZ).dump"
pgd pg_dump --format=custom --no-owner --dbname="$ORIGEN" > "$F"
pgd pg_restore --list < "$F" > "$F.indice"
psql "$ORIGEN" -v ON_ERROR_STOP=1 -At -F' ' -f "$S/20261104_9101_huella_ulit_base.sql" > "$F.huella"
psql "$ORIGEN" -v ON_ERROR_STOP=1 -At -f "$S/20261104_9102_inventario_datos.sql" | grep -E '^(objeto|datos)\|' > "$F.inventario"
sha256sum "$F" "$F.indice" "$F.huella" "$F.inventario" > "$F.sha256"
chmod 600 "$F" "$F".*
echo "Respaldo: $F ($(du -h "$F" | cut -f1)) · $(wc -l < "$F.indice") entradas · $(grep -c '^datos|' "$F.inventario") tablas inventariadas · SHA-256 $(head -c 64 "$F.sha256")"
