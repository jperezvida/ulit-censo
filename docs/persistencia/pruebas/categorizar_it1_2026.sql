-- PostgreSQL 17 aislado. Tras la Fase 1 el espacio sintético está en versión 21.
select pg_catalog.set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-00000000000c',false);

insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version) values
('real-medina-del-campo-2026','itinerarios','real-it-medina-2026-censo-medina-del-c-it1',
 '{"id":"real-it-medina-2026-censo-medina-del-c-it1","campanaId":"real-camp-medina-2026-censo-medina-del-campo-2026","codigo":"IT1"}',21),
('real-medina-del-campo-2026','importaciones','imp-sintetica-it1',
 '{"id":"imp-sintetica-it1","campanaId":"real-camp-medina-2026-censo-medina-del-campo-2026","estado":"confirmada","tipo":"C-excel-itinerario"}',21),
('real-medina-del-campo-2026','registros','reg-it1-cat-a',
 '{"id":"reg-it1-cat-a","importacionId":"imp-sintetica-it1","itinerarioId":"real-it-medina-2026-censo-medina-del-c-it1","fila":2,"datos":{"Local Vacío":"0","Nombre del negocio":"Antenas Eiras","GrActividad":"Servicios","Gr Comercio":"","Subgrupo de actividad":"Reparaciones","Actividad":"Reparaciones","Descripción":"Antenas"}}',21),
('real-medina-del-campo-2026','registros','reg-it1-cat-b',
 '{"id":"reg-it1-cat-b","importacionId":"imp-sintetica-it1","itinerarioId":"real-it-medina-2026-censo-medina-del-c-it1","fila":3,"datos":{"Local Vacío":"0","Nombre del negocio":"Negocio sin clasificar","GrActividad":"","Gr Comercio":"","Subgrupo de actividad":"","Actividad":"","Descripción":""}}',21),
('real-medina-del-campo-2026','registros','reg-it1-cat-vacio',
 '{"id":"reg-it1-cat-vacio","importacionId":"imp-sintetica-it1","itinerarioId":"real-it-medina-2026-censo-medina-del-c-it1","fila":4,"datos":{"Local Vacío":"1","Long fachada":"5","Nombre del negocio":""}}',21);

do $test$
declare
  v jsonb;
  a jsonb := '{"grupoActividad":"Servicios","grupoComercio":"","subgrupo":"Reparaciones","actividad":"Reparaciones","descripcionActividad":"Antenas"}';
  b jsonb := '{"grupoActividad":"Comercio","grupoComercio":"Alimentación","subgrupo":"Carnes","actividad":"Carnicería","descripcionActividad":""}';
  c jsonb := '{"grupoActividad":"Servicios","grupoComercio":"","subgrupo":"Servicios profesionales","actividad":"","descripcionActividad":"Gestión profesional"}';
  orig jsonb;
  anterior text;
  n_copias bigint;
begin
  if (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')<>21 then
    raise exception 'Fixture anterior no está en v21';
  end if;
  orig := (select valor from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026' and coleccion='registros' and id='reg-it1-cat-a');
  n_copias := (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026');

  v := public.ulit_censo_categorizar_it1_2026('real-medina-del-campo-2026','estado',0,'','{}');
  if v->>'alcance'<>'it1-categorias-supervisadas' then raise exception 'Estado no autorizado'; end if;
  begin
    perform public.ulit_censo_categorizar_it1_2026(
      'real-medina-del-campo-2026','aceptar',20,'reg-it1-cat-a',a);
    raise exception 'Versión antigua admitida';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.ulit_censo_categorizar_it1_2026(
      'real-medina-del-campo-2026','aceptar',21,'reg-it1-cat-a',a || '{"actividad":"No era ésta"}'::jsonb);
    raise exception 'Aceptación no coincide con Excel';
  exception when sqlstate 'PT409' then null;
  end;
  v := public.ulit_censo_categorizar_it1_2026(
    'real-medina-del-campo-2026','aceptar',21,'reg-it1-cat-a',a);
  if v->>'version'<>'22' or v->'revision'->>'estado'<>'aceptada'
    or v->'revision'->'valores' is distinct from a then raise exception 'No aceptó la categoría'; end if;

  -- Un clic rechaza la propuesta y deja el registro pendiente.
  v := public.ulit_censo_categorizar_it1_2026(
    'real-medina-del-campo-2026','rechazar',22,'reg-it1-cat-a',a);
  if v->>'version'<>'23' or v->'revision'->>'estado'<>'rechazada' then
    raise exception 'No rechazó la categoría'; end if;
  -- La corrección es de 2026 y no reescribe la importación.
  v := public.ulit_censo_categorizar_it1_2026(
    'real-medina-del-campo-2026','corregir',23,'reg-it1-cat-a',b);
  if v->>'version'<>'24' or v->'revision'->>'estado'<>'corregida'
    or v->'revision'->'valores'->>'actividad'<>'Carnicería' then
    raise exception 'No corrigió la categoría'; end if;
  if (select valor from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
      and coleccion='registros' and id='reg-it1-cat-a') is distinct from orig then
    raise exception 'Se modificó el Excel original'; end if;

  -- La categoría corregida puede confirmarse otra vez, sin regresar a la original.
  v := public.ulit_censo_categorizar_it1_2026(
    'real-medina-del-campo-2026','aceptar',24,'reg-it1-cat-a',b);
  if v->>'version'<>'25' then raise exception 'No pudo revalidar la categoría cambiada'; end if;

  begin
    perform public.ulit_censo_categorizar_it1_2026(
      'real-medina-del-campo-2026','aceptar',25,'reg-it1-cat-b',
      '{"grupoActividad":"","grupoComercio":"","subgrupo":"","actividad":"","descripcionActividad":""}');
    raise exception 'Se aceptó una categoría vacía';
  exception when sqlstate '22023' then null;
  end;
  v := public.ulit_censo_categorizar_it1_2026(
    'real-medina-del-campo-2026','corregir',25,'reg-it1-cat-b',c);
  if v->>'version'<>'26' then raise exception 'No pudo categorizar registro inicialmente vacío'; end if;
  begin
    perform public.ulit_censo_categorizar_it1_2026(
      'real-medina-del-campo-2026','aceptar',26,'reg-it1-cat-vacio',a);
    raise exception 'Categorizó un LV';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.ulit_censo_categorizar_it1_2026(
      'real-medina-del-campo-2026','aceptar',26,'reg-sintetico-it5-26',a);
    raise exception 'Categorizó otro itinerario';
  exception when sqlstate '42501' then null;
  end;
  if (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026')<>n_copias+1 then
    raise exception 'Debe haber una sola copia inicial de categoría';
  end if;
  if (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026') then
    raise exception 'Se dejó abierta la escritura general';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-00000000000d',false);
  begin
    perform public.ulit_censo_categorizar_it1_2026(
      'real-medina-del-campo-2026','estado',0,'','{}');
    raise exception 'El miembro externo pudo consultar la capacidad';
  exception when sqlstate '42501' then null;
  end;
end $test$;
select 'OK: IT1 clasificación aceptada, rechazada y corregida; 2025 y XLSX intactos' as resultado;
