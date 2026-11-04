#!/usr/bin/env bash
# ULIT Censo · RESPALDO EXTERNO de TODO el proyecto compartido (ULIT base incluida), FUERA de su base de datos.
# Solo lectura sobre el proyecto. Requiere autorización expresa y una conexión de solo lectura o del rol postgres.
#   ORIGEN="postgresql://…"  DESTINO=/ruta/institucional  ./20261104_9200_respaldo_externo.sh
# Usa un cliente pg_dump de la MISMA versión mayor que el servidor (variable PG_DUMP; por defecto, Docker postgres:17).
set -euo pipefail
: "${ORIGEN:?cadena de conexión del proyecto}"; : "${DESTINO:?carpeta institucional fuera de Supabase}"
PG_DUMP=${PG_DUMP:-"docker run --rm -i --network host postgres:17 pg_dump"}
PG_RESTORE=${PG_RESTORE:-"docker run --rm -i postgres:17 pg_restore"}
F="$DESTINO/censo-comercios-$(date -u +%Y%m%dT%H%M%SZ).dump"
$PG_DUMP --format=custom --no-owner --dbname="$ORIGEN" > "$F"
sha256sum "$F" > "$F.sha256"
# Recuperable: el archivo se lee entero y lista sus objetos (ULIT base debe figurar).
$PG_RESTORE --list < "$F" > "$F.indice"
echo "Respaldo: $F ($(du -h "$F" | cut -f1)) · $(wc -l < "$F.indice") entradas · SHA-256 $(cut -d' ' -f1 "$F.sha256")"
echo "Prueba de recuperación recomendada: restaurar en un PostgreSQL desechable y comparar 9101 con la huella del origen."
