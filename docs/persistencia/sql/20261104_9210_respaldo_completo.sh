#!/usr/bin/env bash
# ULIT Censo · RESPALDO PREVIO COMPLETO de censo-comercios (se ejecuta en el equipo de la persona responsable).
# Solo LEE el proyecto: no aplica migraciones, no restaura nada sobre producción y no modifica ULIT base.
#
#   1. 9200: volcado PostgreSQL completo + índice + huella 9101 + inventario 9102 del origen (SHA-256).
#   2. 9201: restauración COMPLETA en un Supabase local desechable y comparación del inventario 9102.
#   3. 9202: copia de los archivos de Storage y verificación (tamaño, MD5/eTag, SHA-256).
#   4. Cotejo: objetos por bucket frente a storage.objects y huella 9101 frente a la registrada en la PR.
#
# Credenciales: SOLO en un archivo local (por defecto ~/.config/ulit-censo/respaldo.env, permisos 600, fuera del
# repositorio). Nunca en el chat, en GitHub ni en la línea de órdenes. Variables que debe contener:
#   ORIGEN=postgresql://postgres.<ref>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres?sslmode=require   (sin contraseña)
#   PGPASSWORD=<contraseña de la base>
#   SUPABASE_URL=https://<ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=<clave service_role>
#   DESTINO=<carpeta institucional con control de acceso>
# Uso:  docs/persistencia/sql/20261104_9210_respaldo_completo.sh
set -euo pipefail
umask 077
S="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$S/../../.." && pwd)"
HUELLA_PREVIA="${HUELLA_PREVIA:-2038 837914bad400a7000bc8d24700bf8346}"   # 9101 registrada en la PR #12 (04-11-2026)
CRED="${ULIT_CREDENCIALES:-$HOME/.config/ulit-censo/respaldo.env}"
[ -f "$CRED" ] || { echo "✗ No existe $CRED (créelo como se indica arriba)."; exit 80; }
case "$(cd "$(dirname "$CRED")" && pwd)/" in "$REPO/"*) echo "✗ El archivo de credenciales no puede estar dentro del repositorio."; exit 80;; esac
PERM=$(stat -c %a "$CRED" 2>/dev/null || stat -f %Lp "$CRED")
[ "$PERM" = "600" ] || { echo "✗ $CRED debe tener permisos 600 (chmod 600 \"$CRED\")."; exit 80; }
set -a; . "$CRED"; set +a
trap 'unset PGPASSWORD SUPABASE_SERVICE_ROLE_KEY' EXIT
: "${ORIGEN:?}" "${PGPASSWORD:?}" "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}" "${DESTINO:?}"
for c in docker node npx; do command -v "$c" >/dev/null || { echo "✗ Falta $c en este equipo."; exit 81; }; done
docker info >/dev/null 2>&1 || { echo "✗ Docker no está en marcha."; exit 81; }
T="$DESTINO/ulit-censo-respaldo-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$T"; chmod 700 "$T"
R="$T/resumen-respaldo.txt"; : > "$R"
anota() { echo "$*" | tee -a "$R"; }
anota "Respaldo previo de censo-comercios · $(date -u +%FT%TZ) · carpeta $T"

echo "== 1/4 Volcado PostgreSQL (9200)"
ORIGEN="$ORIGEN" DESTINO="$T" "$S/20261104_9200_respaldo_externo.sh" | tee -a "$R"
F=$(ls "$T"/censo-comercios-*.dump | tail -1)
anota "Huella 9101 del origen en el momento del volcado: $(cat "$F.huella") · registrada en la PR: $HUELLA_PREVIA · $([ "$(cat "$F.huella")" = "$HUELLA_PREVIA" ] && echo 'COINCIDE' || echo 'DISTINTA (algo cambió en ULIT base desde la comprobación previa: revisar antes de seguir)')"

echo "== 2/4 Restauración completa en un Supabase local desechable (9201)"
( unset PGPASSWORD SUPABASE_SERVICE_ROLE_KEY; "$S/20261104_9201_prueba_restauracion.sh" "$F" ) | grep -E '^(✓|✗)' | tee -a "$R"

echo "== 3/4 Archivos de Storage (9202)"
DESTINO="$T" node "$S/20261104_9202_respaldo_storage.mjs" | tee -a "$R"

echo "== 4/4 Cotejo de Storage con la base"
IMAGEN_PG=${IMAGEN_PG:-supabase/postgres:17.6.1.043}
if command -v psql >/dev/null; then psqlx() { psql "$@"; }; else psqlx() { docker run --rm -i -e PGPASSWORD -e PGOPTIONS "$IMAGEN_PG" psql "$@"; }; fi
PGOPTIONS="-c default_transaction_read_only=on" psqlx "$ORIGEN" -v ON_ERROR_STOP=1 -At -F' ' -c "select b.id, count(o.id) from storage.buckets b left join storage.objects o on o.bucket_id = b.id group by b.id order by b.id" > "$T/storage-esperado.txt"
M=$(ls -d "$T"/storage-*/ | tail -1)
node -e '
const fs = require("fs"); const [esp, man] = process.argv.slice(1);
const e = Object.fromEntries(fs.readFileSync(esp, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split(" ")).map(([b, n]) => [b, Number(n)]));
const m = {}; for (const x of JSON.parse(fs.readFileSync(man, "utf8"))) m[x.bucket] = (m[x.bucket] ?? 0) + 1;
const dif = Object.keys({ ...e, ...m }).filter((b) => (e[b] ?? 0) !== (m[b] ?? 0));
console.log(dif.length ? `✗ Storage no coincide con storage.objects en: ${dif.join(", ")}` : `✓ Storage coincide con storage.objects: ${Object.entries(e).map(([b, n]) => `${b} ${n}`).join(" · ")}`);
process.exit(dif.length ? 1 : 0);' "$T/storage-esperado.txt" "$M/manifiesto.json" | tee -a "$R"
( cd "$T" && if command -v sha256sum >/dev/null; then find . -type f ! -name '*.sha256' ! -name 'SHA256SUMS' ! -name 'resumen-respaldo.txt' -print0 | sort -z | xargs -0 sha256sum; else find . -type f ! -name '*.sha256' ! -name 'SHA256SUMS' ! -name 'resumen-respaldo.txt' -print0 | sort -z | xargs -0 shasum -a 256; fi > SHA256SUMS )
chmod -R go-rwx "$T"
anota "Integridad de toda la carpeta: $T/SHA256SUMS ($(wc -l < "$T/SHA256SUMS") archivos). Guarde la carpeta en el almacenamiento institucional."
echo; echo "Resumen (sin credenciales ni contenido): $R"
