-- Exclusivamente PostgreSQL 17 DESCARTABLE · tras 0013: espacio de ensayo en v14.
-- Comprueba limpieza, privacidad de historial funcional, origen intacto y deshacer.
select pg_catalog.set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-00000000000c',false);

-- Fila original contaminada, pero importada: no se debe reescribir al confirmar.
update ulit_censo.entidad
set valor = pg_catalog.jsonb_set(
    valor, '{datos}', (valor->'datos') ||
    '{"Nombre del negocio":"LV","Actividad":"Comercio antiguo","Franquicia":"1","Instagram":"1","Google My Bussines":"1","Nº reseñas Google":"13","Observaciones":"Nota del negocio anterior"}'::jsonb
)
where espacio_id='real-medina-del-campo-2026' and coleccion='registros' and id='reg-sintetico-2';

do $prueba$
declare
  v jsonb;
  v_guardado jsonb;
  v_original jsonb;
  v_restaurado jsonb;
  v_copia bigint;
  v_hist bigint;
  v_version bigint;
  v_historico text;
  v_campos constant text[] := array[
    'nombre','grupoActividad','grupoComercio','subgrupo','actividad','descripcionActividad',
    'franquicia','web','googleBusiness','ventaOnline','numResenas','respondeResenas',
    'instagram','seguidoresInstagram','facebook','seguidoresFacebook',
    'twitter','seguidoresTwitter','numRedes','observaciones'
  ];
  k text;
begin
  v_version:=(select version from ulit_censo.espacio where id='real-medina-del-campo-2026');
  if v_version<>14 then raise exception 'Fixture v14 ausente'; end if;
  v_original:=(select valor from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
      and id='reg-sintetico-2');
  v_guardado:=(select valor from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='correccionesRegistros'
      and id='reg-sintetico-2');
  v_copia:=(select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026');
  v_historico:=(select md5(coalesce(string_agg(valor::text,'|' order by id),''))
    from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
      and coleccion='registros' and id not in ('reg-sintetico-1','reg-sintetico-2'));

  v:=public.ulit_censo_revision_fase1_2026('real-medina-del-campo-2026','estado',0,'','');
  if v->>'alcance'<>'revision-vacios-completa' then raise exception 'No anuncia nuevo alcance'; end if;

  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','vaciar',14,'reg-sintetico-2','');
    raise exception 'No pidió metros';
  exception when sqlstate '22023' then null;
  end;
  if (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')<>14 then
    raise exception 'La prueba inválida modificó datos';
  end if;

  v:=public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','vaciar',14,'reg-sintetico-2','4,5');
  if v->>'version'<>'15' or v->>'accion'<>'vaciar'
    or v->'correccion'->>'tipoRevision'<>'vaciar'
    or v->'correccion'->'valores'->>'vacio'<>'1'
    or v->'correccion'->'valores'->>'fachada'<>'4,5' then
    raise exception 'Limpieza no confirmada';
  end if;
  foreach k in array v_campos loop
    if v->'correccion'->'valores'->>k is distinct from '' then
      raise exception 'Dato de negocio no limpiado: %', k;
    end if;
  end loop;
  if jsonb_array_length(v->'correccion'->'historial')<>0
    or v->'correccion'::text like '%Comercio antiguo%'
    or v->'correccion'::text like '%Nota del negocio anterior%' then
    raise exception 'Historial funcional contiene información de ocupante anterior';
  end if;
  if (select valor from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
      and id='reg-sintetico-2') is distinct from v_original then
    raise exception 'Cambió Excel original';
  end if;
  if (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026')<>v_copia
    or (select escritura_habilitada from ulit_censo.espacio
      where id='real-medina-del-campo-2026') then
    raise exception 'La limpieza alteró backups o dejó escritura general abierta';
  end if;
  if (select md5(coalesce(string_agg(valor::text,'|' order by id),''))
    from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
      and coleccion='registros' and id not in ('reg-sintetico-1','reg-sintetico-2'))
     is distinct from v_historico then
    raise exception 'Se tocó otro registro o el histórico';
  end if;

  -- Deshacer inmediatamente la limpieza recupera la corrección previa con su fachada.
  v:=public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','deshacer',15,'reg-sintetico-2','');
  if v->>'version'<>'16' or v->>'accion'<>'deshacer'
     or v->'correccion' is distinct from v_guardado then
    raise exception 'No restauró estado anterior de forma exacta';
  end if;
  if (select valor from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
    and coleccion='correccionesRegistros' and id='reg-sintetico-2')
    is distinct from v_guardado then
    raise exception 'El deshacer no restauró la entidad original de corrección';
  end if;
  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','deshacer',16,'reg-sintetico-2','');
    raise exception 'Se permitió deshacer una revisión que no era limpieza';
  exception when sqlstate '42501' then null;
  end;

  -- Transición desde ocupado a vacío con nombre comercial: debe quedar en blanco.
  v:=public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','vaciar',16,'reg-sintetico-1','6');
  if v->>'version'<>'17' or v->'correccion'->'valores'->>'nombre' is distinct from ''
    or v->'correccion'->'valores'->>'vacio' is distinct from '1' then
    raise exception 'No permitió la transición ocupado → vacío';
  end if;
  -- Y debe poder volver a ocupado con deshacer, sin tocar el Excel importado.
  v:=public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','deshacer',17,'reg-sintetico-1','');
  if v->>'version'<>'18' or v->'correccion'->'valores'->>'vacio'<>'0' then
    raise exception 'No se restauró el estado ocupado anterior';
  end if;
end $prueba$;

-- Una primera limpieza sin corrección previa se deshace ELIMINANDO la capa efectiva.
insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version) values
('real-medina-del-campo-2026','registros','reg-sintetico-3',
 '{"id":"reg-sintetico-3","importacionId":"imp-sintetica","itinerarioId":"it-sintetico","fila":9,"datos":{"Local Vacío":"1","Nombre del negocio":"Antiguo","Long fachada":"","Instagram":"1","Observaciones":"Nota anterior"}}',18);

do $prueba$
declare v jsonb;
begin
  v:=public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','vaciar',18,'reg-sintetico-3','5');
  if v->>'version'<>'19' or v->'correccion'->'valores'->>'nombre'<>''
    or v->'correccion'->'valores'->>'observaciones'<>''
    or v->'correccion'->'valores'->>'instagram'<>''
    or v->'correccion'->'valores'->>'fachada'<>'5' then
    raise exception 'Primera limpieza no guardada correctamente';
  end if;
  v:=public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','deshacer',19,'reg-sintetico-3','');
  if v->>'version'<>'20' or v->'correccion' is distinct from 'null'::jsonb
    or exists(select 1 from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
        and coleccion='correccionesRegistros' and id='reg-sintetico-3') then
    raise exception 'Deshacer no eliminó la capa de corrección inicial';
  end if;
  if (select escritura_habilitada from ulit_censo.espacio
    where id='real-medina-del-campo-2026') then
    raise exception 'Escritura general quedó abierta';
  end if;
end $prueba$;
select '✓ LV: limpieza total, origen y 2025 intactos, deshacer exacto' as comprobacion;
