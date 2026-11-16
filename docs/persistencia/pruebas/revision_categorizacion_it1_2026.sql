-- PostgreSQL 17 aislado: secuencia anterior deja el espacio sintético en v21.
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
-- Un negocio del IT1 con categoría antigua parcialmente completa.
update ulit_censo.entidad set valor=pg_catalog.jsonb_set(
  valor,'{datos}',(valor->'datos')||
  '{"GrActividad":"Comercio","Gr Comercio":"Alimentación","Subgrupo de actividad":"Carnes","Actividad":"Carnicería","Descripción":""}'::jsonb
) where espacio_id='real-medina-del-campo-2026' and coleccion='registros' and id='reg-sintetico-it5-26';

-- Otro ocupado de IT1 sin categoría.
insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
values ('real-medina-del-campo-2026','registros','reg-sintetico-it1-sin-clasificacion',
 '{"id":"reg-sintetico-it1-sin-clasificacion","importacionId":"imp-sintetica",
 "itinerarioId":"it-sintetico","fila":27,
 "datos":{"Local Vacío":"0","Nombre del negocio":"Tienda nueva","Dirección":"Calle Mayor","Num":"5"}}',21);

-- Una importación distinta no es objeto de esta fase.
insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version) values
('real-medina-del-campo-2026','itinerarios','it2-sintetico',
 '{"id":"it2-sintetico","campanaId":"real-camp-medina-2026-censo-medina-del-campo-2026","codigo":"IT2"}',21),
('real-medina-del-campo-2026','registros','reg-sintetico-it2-1',
 '{"id":"reg-sintetico-it2-1","importacionId":"imp-sintetica","itinerarioId":"it2-sintetico","fila":2,
 "datos":{"Local Vacío":"0","Nombre del negocio":"Comercio ajeno al IT1","GrActividad":"Comercio"}}',21);

do $prueba$
declare r jsonb; original jsonb; previo jsonb; version_actual bigint;
  nueva jsonb := '{"grupoActividad":"Servicios","grupoComercio":"","subgrupo":"Asesorías","actividad":"","descripcionActividad":"Asesoría profesional"}'::jsonb;
begin
  if has_function_privilege('anon',
      'public.ulit_censo_categoria_it1_2026(text,text,bigint,text,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated',
      'public.ulit_censo_categoria_it1_2026(text,text,bigint,text,jsonb)','EXECUTE') then
    raise exception 'Permisos incorrectos de RPC categorización';
  end if;
  r := public.ulit_censo_categoria_it1_2026('real-medina-del-campo-2026','estado',0,'',null);
  if r->>'habilitada'<>'true' or r->>'alcance'<>'categoria-it1-2026' then
    raise exception 'La capacidad de clasificación no está disponible';
  end if;

  original := (select valor from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
    and coleccion='registros' and id='reg-sintetico-it5-26');
  previo := (select valor from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
    and coleccion='correccionesRegistros' and id='reg-sintetico-it5-26');
  version_actual:=(select version from ulit_censo.espacio where id='real-medina-del-campo-2026');
  if version_actual<>21 then raise exception 'Fixture anterior incorrecto: %',version_actual; end if;
  begin
    perform public.ulit_censo_categoria_it1_2026(
      'real-medina-del-campo-2026','aceptar',20,'reg-sintetico-it5-26',null);
    raise exception 'No bloqueó versión anterior';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.ulit_censo_categoria_it1_2026(
      'real-medina-del-campo-2026','aceptar',21,'reg-sintetico-it2-1',null);
    raise exception 'Permitió IT2';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.ulit_censo_categoria_it1_2026(
      'real-medina-del-campo-2026','aceptar',21,'reg-sintetico-3',null);
    raise exception 'Permitió categorizar un vacío';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.ulit_censo_categoria_it1_2026(
      'real-medina-del-campo-2026','aceptar',21,'reg-sintetico-it1-sin-clasificacion',null);
    raise exception 'Se aceptó una clasificación inexistente';
  exception when sqlstate '22023' then null; end;

  r:=public.ulit_censo_categoria_it1_2026(
    'real-medina-del-campo-2026','aceptar',21,'reg-sintetico-it5-26',null);
  if r->>'version'<>'22' or r->'correccion'->'revisionClasificacion'->>'estado'<>'aceptada'
    or r->'correccion'->'revisionClasificacion'->'valores'->>'actividad'<>'Carnicería'
    or r->'correccion'->'valores' is distinct from previo->'valores' then
    raise exception 'La aceptación no ha respetado los valores actuales';
  end if;
  begin
    perform public.ulit_censo_categoria_it1_2026(
      'real-medina-del-campo-2026','aceptar',22,'reg-sintetico-it5-26',null);
    raise exception 'Permitió aceptación repetida';
  exception when sqlstate '22023' then null; end;
  r:=public.ulit_censo_categoria_it1_2026(
    'real-medina-del-campo-2026','rechazar',22,'reg-sintetico-it5-26',null);
  if r->>'version'<>'23' or r->'correccion'->'revisionClasificacion'->>'estado'<>'rechazada'
    or r->'correccion'->'valores' is distinct from previo->'valores' then
    raise exception 'Rechazo no ha conservado original y correcciones';
  end if;
  begin
    perform public.ulit_censo_categoria_it1_2026(
      'real-medina-del-campo-2026','asignar',23,'reg-sintetico-it5-26',
      '{"grupoActividad":"Comercio","grupoComercio":"","subgrupo":"Carnes","actividad":"Carnicería","descripcionActividad":""}'::jsonb);
    raise exception 'Permitió asignación estructuralmente incoherente';
  exception when sqlstate '22023' then null; end;
  r:=public.ulit_censo_categoria_it1_2026(
    'real-medina-del-campo-2026','asignar',23,'reg-sintetico-it5-26',nueva);
  if r->>'version'<>'24' or r->'correccion'->'revisionClasificacion'->'valores' is distinct from nueva
    or r->'correccion'->'valores'->>'actividad' is distinct from '' then
    raise exception 'Nueva categoría no guardada y aceptada';
  end if;

  r:=public.ulit_censo_categoria_it1_2026(
    'real-medina-del-campo-2026','asignar',24,'reg-sintetico-it1-sin-clasificacion',nueva);
  if r->>'version'<>'25' or r->'correccion'->'revisionClasificacion'->>'estado'<>'aceptada' then
    raise exception 'No admitió clasificar negocio que llegó sin categoría';
  end if;

  if (select valor from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
    and coleccion='registros' and id='reg-sintetico-it5-26') is distinct from original then
    raise exception 'Cambió el Excel original';
  end if;
  if (select escritura_habilitada from ulit_censo.espacio
    where id='real-medina-del-campo-2026') then
    raise exception 'Quedó abierta la escritura general';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
  begin
    perform public.ulit_censo_categoria_it1_2026(
      'real-medina-del-campo-2026','aceptar',25,'reg-sintetico-it5-26',null);
    raise exception 'Se permitió a usuario externo';
  exception when sqlstate '42501' then null; end;
end $prueba$;
select 'OK: aceptar/rechazar/asignar IT1, roles y versiones, origen intacto' as prueba;
