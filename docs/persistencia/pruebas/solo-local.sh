# Se incluye (source) en los scripts que MODIFICAN la base: abortan si la conexión no es el Supabase LOCAL
# desechable de pruebas. Dos condiciones independientes:
#   1) la cadena de conexión apunta a esta máquina (127.0.0.1, localhost o ::1) y no a *.supabase.co / pooler;
#   2) la base tiene el rol marcador `ulit_censo_entorno_local_desechable`, que SOLO crea
#      e2e-supabase-local.sh sobre el Supabase que acaba de arrancar con Docker. No existe en censo-comercios.
exigir_entorno_local() {
  local url="$1" host
  host=$(printf '%s' "$url" | sed -E 's#^[a-z]+://([^@/]*@)?(\[[^]]+\]|[^:/?]+).*#\2#')
  case "$url" in *supabase.co*|*supabase.com*|*pooler*) echo "✗ ABORTADO: la conexión apunta a Supabase en la nube." >&2; exit 90;; esac
  case "$host" in 127.0.0.1|localhost|"[::1]") ;; *) echo "✗ ABORTADO: '$host' no es el entorno local de pruebas." >&2; exit 90;; esac
  if [ "$(psql "$url" -At -c "select count(*) from pg_roles where rolname = 'ulit_censo_entorno_local_desechable'" 2>/dev/null)" != "1" ]; then
    echo "✗ ABORTADO: la base no tiene el marcador del entorno local desechable (créelo con e2e-supabase-local.sh)." >&2; exit 90
  fi
}
