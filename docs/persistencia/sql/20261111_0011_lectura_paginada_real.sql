-- Censo 7 · PROPUESTA 0011 · Lectura paginada del espacio real 2026
-- Solo lectura, sin cambiar entidades ni abrir escritura.
-- NO INSTALAR EN PRODUCCIÓN antes de revisar permisos y probar restauración.
begin;

create or replace function public.ulit_censo_leer_parte(
  p_espacio text,
  p_version_esperada bigint,
  p_despues_coleccion text,
  p_despues_id text,
  p_limite integer
) returns jsonb
language plpgsql stable security definer
set search_path = ''
set statement_timeout = '12s'
as $func$
declare
  m ulit_censo.miembro;
  e ulit_censo.espacio;
  v_items jsonb;
begin
  -- Alcance explícito: la única aplicación auténtica de Medina 2026.
  if p_espacio is distinct from 'real-medina-del-campo-2026'
     or p_version_esperada is null
     or p_limite is null or p_limite not between 1 and 300
     or p_despues_coleccion is null or p_despues_id is null
     or length(p_despues_coleccion) > 120 or length(p_despues_id) > 350
     or (p_despues_coleccion = '' and p_despues_id <> '') then
    raise exception 'ULIT Censo: petición de lectura paginada incorrecta'
      using errcode = '22023';
  end if;
  m := ulit_censo.exigir(p_espacio, ulit_censo.roles_lectura());
  select * into e from ulit_censo.espacio where id=p_espacio;
  if not found or e.tipo <> 'real' then
    raise exception 'ULIT Censo: espacio real no verificable' using errcode='42501';
  end if;
  if e.version <> p_version_esperada then
    raise exception 'ULIT Censo: el censo cambió durante la lectura, recargue'
      using errcode='PT409';
  end if;

  -- Usa la clave primaria (espacio_id, coleccion, id): no se agrega
  -- el documento completo ni se ordenan miles de entidades en memoria.
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('c',c,'id',id,'v',v) order by c,id
    ), '[]'::jsonb)
  into v_items
  from (
    select coleccion as c,id,valor as v
    from ulit_censo.entidad
    where espacio_id=p_espacio
      and (coleccion,id) > (p_despues_coleccion,p_despues_id)
    order by coleccion,id
    limit p_limite
  ) p;

  return pg_catalog.jsonb_build_object(
    'version',e.version,'items',v_items,'cantidad',pg_catalog.jsonb_array_length(v_items)
  );
end;
$func$;

revoke all on function public.ulit_censo_leer_parte(text,bigint,text,text,integer)
  from public,anon,service_role;
grant execute on function public.ulit_censo_leer_parte(text,bigint,text,text,integer)
  to authenticated;

commit;
