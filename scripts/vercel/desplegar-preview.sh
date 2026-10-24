#!/usr/bin/env bash
# Despliegue de PREVIEW (nunca producción) de ULIT Censo en un proyecto propio de Vercel, con dirección fija.
#   - Solo se ejecuta desde la rama $RAMA_PERMITIDA (además, el entorno «preview» de GitHub lo restringe).
#   - Solo actúa sobre el proyecto $PROYECTO (lo crea si no existe). No toca ningún otro proyecto.
#   - Exige «Vercel Authentication» en el proyecto (comprobado por la API) ANTES de desplegar.
#   - Publica exactamente lo compilado en este workflow (.vercel/output), sin que Vercel compile nada.
#   - Comprueba SIN sesión que el despliegue está protegido ANTES de asignarle la dirección fija
#     (401/403 de Vercel, o redirección al inicio de sesión de Vercel; cualquier otra respuesta falla).
#     Después vuelve a comprobar la dirección fija. Si algo no se confirma: retira lo publicado y falla.
# El token se lee de la variable de entorno VERCEL_TOKEN (secreto del entorno «preview»); nunca aparece
# en la orden ni en los registros.
set -euo pipefail
: "${PROYECTO:?}" "${DIRECCION_FIJA:?}" "${VERCEL_CLI:?}" "${RAMA_PERMITIDA:?}"
URL_FIJA="${URL_FIJA:-https://$DIRECCION_FIJA}"
COMPROBAR="node $(dirname "$0")/proteccion.mjs"
resumen() { echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; echo "$1"; }
fallar() { resumen "❌ **$1**"; echo "::error::$1"; exit 1; }

if [ "${GITHUB_REF_NAME:-}" != "$RAMA_PERMITIDA" ]; then
  fallar "Rama «${GITHUB_REF_NAME:-desconocida}»: solo se despliega desde «$RAMA_PERMITIDA»."
fi
if [ -z "${VERCEL_TOKEN:-}" ]; then
  resumen "⚠️ **No se ha desplegado**: falta el secreto \`VERCEL_TOKEN\` en el entorno \`preview\` (Settings → Environments → preview)."
  echo "::warning::Falta el secreto VERCEL_TOKEN en el entorno preview: no se despliega la vista previa."
  exit 0
fi
vc() { npx --yes "$VERCEL_CLI" "$@" --non-interactive; }

# 1. Proyecto propio (se crea solo la primera vez).
if vc project inspect "$PROYECTO" >/dev/null 2>&1; then
  echo "Proyecto existente: $PROYECTO"
else
  vc project create "$PROYECTO"
  resumen "🆕 Proyecto de Vercel creado: \`$PROYECTO\`."
fi
vc link --yes --project "$PROYECTO"
ID=$(node -p "require('./.vercel/project.json').projectId")
ORG=$(node -p "require('./.vercel/project.json').orgId")
EQUIPO=""; case "$ORG" in team_*) EQUIPO="?teamId=$ORG" ;; esac
API="https://api.vercel.com/v9/projects/$ID$EQUIPO"

# 2a. Sin barra de herramientas de Vercel en las vistas previas (inyectaría scripts de terceros en la página).
if curl -fsS -X PATCH "$API" -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' \
     -d '{"enablePreviewFeedback":false,"enableProductionFeedback":false}' -o /dev/null; then
  echo "Barra de herramientas de Vercel desactivada en $PROYECTO"
else
  echo "::warning::No se ha podido desactivar la barra de herramientas de Vercel; la aplicación lo detectará (huellas) y no habilitará el análisis del Excel real."
fi

# 2b. Protección: Vercel Authentication. Se activa y se CONFIRMA por la API antes de desplegar nada.
vc project protection enable "$PROYECTO" --sso || echo "::warning::La CLI no ha confirmado la activación; se comprueba por la API."
if ! curl -fsS "$API" -H "Authorization: Bearer $VERCEL_TOKEN" | $COMPROBAR configuracion; then
  fallar "No se puede confirmar que Vercel Authentication esté activada en $PROYECTO. No se ha desplegado nada."
fi

# 3. Despliegue de PREVIEW de lo ya compilado (sin --prod). Todavía SIN dirección fija.
URL=$(vc deploy --prebuilt --target preview --yes)
echo "Despliegue: $URL"
retirar_despliegue() { vc remove "$URL" --yes >/dev/null 2>&1 || echo "::warning::Retire a mano el despliegue $URL en Vercel."; }

# 4. Protección del despliegue, sin sesión, ANTES de asignar la dirección fija.
if ! $COMPROBAR urls "$URL"; then
  retirar_despliegue
  fallar "El despliegue no está protegido (o no se ha podido confirmar). Se ha retirado y NO se ha asignado la dirección fija."
fi

# 5. Dirección fija para favoritos y nueva comprobación sobre ella.
vc alias set "$URL" "$DIRECCION_FIJA"
if ! $COMPROBAR urls "$URL_FIJA"; then
  vc alias rm "$DIRECCION_FIJA" --yes || true
  retirar_despliegue
  fallar "La dirección fija $URL_FIJA no está protegida (o no se ha podido confirmar). Se ha retirado. No use esta vista previa."
fi

resumen "✅ **Vista previa protegida** (sin sesión: solo 401/403 de Vercel o redirección a su inicio de sesión)."
resumen ""
resumen "- Dirección fija: $URL_FIJA"
resumen "- Commit: \`${GITHUB_SHA:-?}\` · rama \`${GITHUB_REF_NAME:-?}\`"
resumen "- Despliegue (preview, no producción): $URL"
