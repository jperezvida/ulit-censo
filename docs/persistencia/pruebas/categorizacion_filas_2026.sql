-- PostgreSQL 17 SIN RED. Se ejecuta solo después de migraciones Fase 1 hasta versión sintética 21.
-- Comprueba que solo se categorizan filas reales de itinerario 2026, nunca 2025
-- ni locales vacíos, y que ninguna categoría preexistente queda confirmada sola.
select pg_catalog.set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-00000000000c',false);

-- Preparar UNA fila SINTÉTICA ocupada con categorización previa.
update ulit_censo.entidad set valor =
  pg_catalog.jsonb_set(valor,'{datos}',coalesce(valor->'datos','{}'::jsonb) ||
  '{"GrActividad":"Servicios","Subgrupo de actividad":"Religiosos","Actividad":"",
    "Nombre del negocio":"Salón de reuniones sintético"}'::jsonb)
where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
  and id='reg-sintetico-it5-26';

do $pruebas$
declare
  v_estado jsonb;
  v_res jsonb;
  v_origen jsonb;
  v_revisiones_antes bigint;
  v_copias bigint;
  v_historico text;
begin
  if (select version from ulit_censo.espacio where id='real-medina-del-campo-2026') <> 21 then
    raise exception 'Fixture no está en versión 21';
  end if;
  v_estado := public.ulit_censo_categoria_registro_2026(
    'real-medina-del-campo-2026','estado',0,'','','');
  if v_estado->>'alcance' <> 'clasificacion-por-fila-2026'
    or v_estado->>'catalogo' <> 'clasificacion-2026@v1'
    or v_estado->>'habilitada' <> 'true' then
    raise exception 'La RPC no declara autorización o catálogo correcto';
  end if;
  if (select count(*) from ulit_censo.catalogo_nodos_2026) < 120 then
    raise exception 'Catálogo oficial incompleto';
  end if;
  v_origen := (select valor from ulit_censo.entidad where
    espacio_id='real-medina-del-campo-2026' and coleccion='registros'
    and id='reg-sintetico-it5-26');
  v_copias := (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026');
  v_historico := (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    valor::text,'|' order by id),'')) from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
    and id <> 'reg-sintetico-it5-26');
  v_revisiones_antes := (select count(*) from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='revisionesCategoriaRegistros');
  if v_revisiones_antes <> 0 then raise exception 'Ya hay aprobaciones categoriales'; end if;

  begin
    perform public.ulit_censo_categoria_registro_2026(
      'real-medina-del-campo-2026','aceptar',20,'reg-sintetico-it5-26','c26.S.religiosos','');
    raise exception 'No bloqueó versión obsoleta';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.ulit_censo_categoria_registro_2026(
      'real-medina-del-campo-2026','aceptar',21,'reg-sintetico-it5-26','a1-comercio','');
    raise exception 'Aceptó categoría demo';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.ulit_censo_categoria_registro_2026(
      'real-medina-del-campo-2026','aceptar',21,'reg-sintetico-it5-26','c26.C.A.carnes','');
    raise exception 'Permitió subgrupo con actividad sin descripción';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.ulit_censo_categoria_registro_2026(
      'real-medina-del-campo-2026','aceptar',21,'reg-sintetico-3','c26.S.religiosos','');
    raise exception 'Permitió categorizar un local vacío';
  exception when sqlstate '42501' then null; end;
  if (select version from ulit_censo.espacio where id='real-medina-del-campo-2026') <>21 then
    raise exception 'Una operación inválida cambió el censo';
  end if;

  v_res := public.ulit_censo_categoria_registro_2026(
    'real-medina-del-campo-2026','aceptar',21,'reg-sintetico-it5-26','c26.S.religiosos','');
  if v_res->>'version' <> '22'
    or v_res->'revision'->>'estado' <> 'aceptada'
    or v_res->'revision'->'valores'->>'grupoActividad' <> 'Servicios'
    or v_res->'revision'->'valores'->>'subgrupo' <> 'Religiosos'
    or v_res->'revision'->>'catalogoId' <> 'clasificacion-2026@v1'
    or v_res->'revision'->>'nombreRevisado' <> 'Salón de reuniones sintético' then
    raise exception 'Revisión humana aceptada mal persistida: %',v_res;
  end if;

  if (select valor from ulit_censo.entidad where
    espacio_id='real-medina-del-campo-2026' and coleccion='registros'
    and id='reg-sintetico-it5-26') is distinct from v_origen then
    raise exception 'La clasificación reescribió el Excel original';
  end if;
  if (select pg_catalog.md5(coalesce(pg_catalog.string_agg(
    valor::text,'|' order by id),'')) from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
    and id <> 'reg-sintetico-it5-26') is distinct from v_historico then
    raise exception 'La revisión modificó otros itinerarios o 2025';
  end if;
  if (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026')<>v_copias+1
    or not exists(select 1 from ulit_censo.copia where espacio_id='real-medina-del-campo-2026'
      and version=21 and sha256 ~ '^[0-9a-f]{64}$' and bytes>0) then
    raise exception 'Copia íntegra previa a categorizar no verificada';
  end if;
  if (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026') then
    raise exception 'La escritura general permanece habilitada';
  end if;

  v_res := public.ulit_censo_categoria_registro_2026(
    'real-medina-del-campo-2026','rechazar',22,'reg-sintetico-it5-26','','');
  if v_res->>'version'<>'23'
    or v_res->'revision'->>'estado'<>'rechazada'
    or v_res->'revision'->'nodoId' <> 'null'::jsonb then
    raise exception 'Rechazo no persistido';
  end if;
  v_res := public.ulit_censo_categoria_registro_2026(
    'real-medina-del-campo-2026','corregir',23,
    'reg-sintetico-it5-26','c26.S.patrimonio-historico','Museo sintético');
  if v_res->>'version'<>'24'
    or v_res->'revision'->>'estado'<>'corregida'
    or v_res->'revision'->>'descripcion'<>'Museo sintético' then
    raise exception 'Corrección nueva no persistida';
  end if;
  if (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026')<>v_copias+1 then
    raise exception 'Se generó respaldo íntegro innecesario por cada registro';
  end if;
  if (select count(*) from ulit_censo.entidad_historial where
    espacio_id='real-medina-del-campo-2026' and coleccion='revisionesCategoriaRegistros'
    and id='reg-sintetico-it5-26') <> 3 then
    raise exception 'Historial técnico de las tres decisiones incompleto';
  end if;
end $pruebas$;

select 'OK · categoría por fila con tres decisiones, fuente y 2025 inmutables' prueba;
