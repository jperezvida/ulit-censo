#!/usr/bin/env bash
# Mide el almacenamiento en un PostgreSQL LOCAL y DESECHABLE con operaciones SINTÉTICAS (medir-almacenamiento.ts).
# Uso: ./medir.sh <carpeta-temporal> <ops.ndjson>
set -euo pipefail
D="${1:?carpeta}"; OPS="${2:?ndjson}"; SQL="$(cd "$(dirname "$0")/../sql" && pwd)"; P="$(cd "$(dirname "$0")" && pwd)"
B=/usr/lib/postgresql/16/bin; rm -rf "$D"; mkdir -p "$D"; chown postgres "$D"; cp "$OPS" "$D/ops.ndjson"; chmod 644 "$D/ops.ndjson"
su postgres -c "$B/initdb -D $D/datos -A trust -U postgres >/dev/null"
su postgres -c "$B/pg_ctl -D $D/datos -o '-p 54330 -k $D -c listen_addresses=' -l $D/log.txt start >/dev/null"
trap 'su postgres -c "$B/pg_ctl -D $D/datos stop -m fast >/dev/null"' EXIT
q() { psql -h "$D" -p 54330 -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
q -f "$P/emulacion_supabase.sql"; q -f "$SQL/20261104_0001_ulit_censo_esquema.sql"; q -f "$SQL/20261104_0002_ulit_censo_operaciones.sql"
q <<SQL
insert into ulit_censo.espacio (id, tipo, nombre, escritura_habilitada) values ('ensayo-medida', 'ensayo', 'Medida', true);
insert into ulit_censo.miembro values ('ensayo-medida', '00000000-0000-0000-0000-00000000000c', 'administrador', 'ensayo-per-coord');
create table public._ops (n serial, linea jsonb);
\copy public._ops(linea) from '$D/ops.ndjson' with (format csv, quote E'\x01', delimiter E'\x02')
grant select on public._ops to authenticated;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
\timing on
do \$\$ declare r record; v bigint := 0; begin
  for r in select linea from public._ops order by n loop
    v := public.ulit_censo_aplicar('ensayo-medida', v, r.linea ->> 'etiqueta', r.linea -> 'cambios');
  end loop; raise notice 'versión final %', v; end \$\$;
select public.ulit_censo_crear_copia('ensayo-medida', 'Copia de prueba') is not null as copia;
\timing off
reset role;
select relname as tabla, pg_size_pretty(pg_total_relation_size(c.oid)) as tamano, (select reltuples::bigint) as filas
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ulit_censo' and c.relkind = 'r' order by pg_total_relation_size(c.oid) desc;
select pg_size_pretty(sum(pg_total_relation_size(c.oid))) as total_ulit_censo from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ulit_censo' and c.relkind = 'r';
select bytes as bytes_copia_json, pg_size_pretty(pg_column_size(contenido)::bigint) as copia_en_disco from ulit_censo.copia;
select pg_size_pretty(avg(pg_column_size(h.*))::bigint) as historial_medio_por_fila from ulit_censo.entidad_historial h join ulit_censo.operacion o on o.id = h.operacion_id where o.version > 1;
select octet_length(public.ulit_censo_leer('ensayo-medida')::text) as bytes_lectura_completa;
SQL
