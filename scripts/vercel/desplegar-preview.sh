#!/usr/bin/env bash
# Despliegue de PREVIEW (nunca producción) de ULIT Censo en un proyecto propio de Vercel, con dirección fija.
#   - Solo actúa sobre el proyecto $PROYECTO (lo crea si no existe). No toca ningún otro proyecto.
#   - Activa y exige la protección «Vercel Authentication» del proyecto.
#   - Publica exactamente lo compilado en este workflow (.vercel/output), sin que Vercel compile nada.
#   - Comprueba que la dirección fija y la del despliegue responden 401/403 sin sesión; si no, retira la
#     dirección fija y falla.
# El token se lee de la variable de entorno VERCEL_TOKEN (secreto de GitHub); nunca aparece en la orden.
set -euo pipefail
: "${PROYECTO:?}" "${DIRECCION_FIJA:?}" "${VERCEL_CLI:?}"
resumen() { echo "$1" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; echo "$1"; }

if [ -z "${VERCEL_TOKEN:-}" ]; then
  resumen "⚠️ **No se ha desplegado**: falta el secreto \`VERCEL_TOKEN\` en GitHub (Settings → Secrets and variables → Actions)."
  echo "::warning::Falta el secreto VERCEL_TOKEN: no se despliega la vista previa."
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

# 2a. Sin barra de herramientas de Vercel en las vistas previas (inyectaría scripts de terceros en la página).
#     Solo sobre ESTE proyecto (su identificador sale del enlace recién creado).
ID=$(node -p "require('./.vercel/project.json').projectId")
ORG=$(node -p "require('./.vercel/project.json').orgId")
EQUIPO=""; case "$ORG" in team_*) EQUIPO="?teamId=$ORG" ;; esac
if curl -fsS -X PATCH "https://api.vercel.com/v9/projects/$ID$EQUIPO" -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' \
     -d '{"enablePreviewFeedback":false,"enableProductionFeedback":false}' -o /dev/null; then
  echo "Barra de herramientas de Vercel desactivada en $PROYECTO"
else
  echo "::warning::No se ha podido desactivar la barra de herramientas de Vercel; la aplicación lo detectará (huellas) y no habilitará el análisis del Excel real."
fi

# 2b. Protección: Vercel Authentication (solo personas con acceso al proyecto en Vercel).
vc project protection enable "$PROYECTO" --sso || true
vc project protection "$PROYECTO" || true

# 3. Despliegue de PREVIEW de lo ya compilado (sin --prod).
URL=$(vc deploy --prebuilt --target preview --yes)
echo "Despliegue: $URL"

# 4. Dirección fija para favoritos.
vc alias set "$URL" "$DIRECCION_FIJA"

# 5. Comprobación de la protección: sin sesión, ni la dirección fija ni el despliegue deben ser accesibles.
proteger_o_fallar() {
  local u="$1" c
  c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$u/version.json")
  echo "$u/version.json → HTTP $c sin sesión"
  if [ "$c" != "401" ] && [ "$c" != "403" ]; then
    vc alias rm "$DIRECCION_FIJA" --yes || true
    resumen "❌ **$u responde $c sin sesión: NO está protegida.** Se ha retirado la dirección fija. No use esta vista previa."
    exit 1
  fi
}
proteger_o_fallar "https://$DIRECCION_FIJA"
proteger_o_fallar "$URL"

resumen "✅ **Vista previa protegida** (sin sesión: 401/403)."
resumen ""
resumen "- Dirección fija: https://$DIRECCION_FIJA"
resumen "- Commit: \`${GITHUB_SHA:-?}\` · rama \`${GITHUB_REF_NAME:-?}\`"
resumen "- Despliegue (preview, no producción): $URL"
