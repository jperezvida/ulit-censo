-- Solo PostgreSQL 17 desechable con datos SINTÉTICOS.
select pg_catalog.set_config('request.jwt.claim.sub',
 '00000000-0000-0000-0000-00000000000c',false);

insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version) values
('real-medina-del-campo-2026','registros','reg-it1-fran-a',
 '{"id":"reg-it1-fran-a","importacionId":"imp-sintetica-it1","itinerarioId":"real-it-medina-2026-censo-medina-del-c-it1","fila":20,"datos":{"Local Vacío":"0","Nombre del negocio":"Franquicia ficticia","Franquicia":"1"}}',26),
('real-medina-del-campo-2026','registros','reg-it1-fran-b',
 '{"id":"reg-it1-fran-b","importacionId":"imp-sintetica-it1","itinerarioId":"real-it-medina-2026-censo-medina-del-c-it1","fila":21,"datos":{"Local Vacío":"0","Nombre del negocio":"Negocio independiente ficticio","Franquicia":"0"}}',26),
('real-medina-del-campo-2026','registros','reg-it1-fran-nuevo',
 '{"id":"reg-it1-fran-nuevo","importacionId":"imp-sintetica-it1","itinerarioId":"real-it-medina-2026-censo-medina-del-c-it1","fila":22,"datos":{"Local Vacío":"0","Nombre del negocio":"Sin dato ficticio","Franquicia":""}}',26),
('real-medina-del-campo-2026','registros','reg-it1-fran-c',
 '{"id":"reg-it1-fran-c","importacionId":"imp-sintetica-it1","itinerarioId":"real-it-medina-2026-censo-medina-del-c-it1","fila":23,"datos":{"Local Vacío":"0","Nombre del negocio":"Tercer negocio ficticio","Franquicia":"1"}}',26),
('real-medina-del-campo-2026','registros','reg-it1-fran-d',
 '{"id":"reg-it1-fran-d","importacionId":"imp-sintetica-it1","itinerarioId":"real-it-medina-2026-censo-medina-del-c-it1","fila":24,"datos":{"Local Vacío":"0","Nombre del negocio":"Cuarto negocio ficticio","Franquicia":"0"}}',26);

do $prueba$
declare
  v jsonb;
  antes jsonb;
  n_copias integer;
begin
  if (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')<>26 then
    raise exception 'Fixture tras 0016 debe estar en v26';
  end if;
  antes := (select valor from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='registros' and id='reg-it1-fran-a');
  n_copias := (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026');
  v := public.ulit_censo_franquicias_it1_2026(
    'real-medina-del-campo-2026','estado',0,array[]::text[],null);
  if v->>'alcance'<>'it1-franquicias-supervisadas' then raise exception 'Permiso inexistente'; end if;
  begin
    perform public.ulit_censo_franquicias_it1_2026(
      'real-medina-del-campo-2026','aceptar',25,array['reg-it1-fran-a'],null);
    raise exception 'Se aceptó versión antigua';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.ulit_censo_franquicias_it1_2026(
      'real-medina-del-campo-2026','aceptar',26,array['reg-it1-fran-nuevo'],null);
    raise exception 'Una celda vacía se confirmó por error';
  exception when sqlstate '22023' then null;
  end;
  v := public.ulit_censo_franquicias_it1_2026(
    'real-medina-del-campo-2026','aceptar',26,array['reg-it1-fran-a'],null);
  if v->>'version'<>'27' or v->'revisiones'->0->>'respuesta'<>'si'
      or v->'revisiones'->0->>'estado'<>'aceptada' then
    raise exception 'No aceptó el valor positivo del Excel';
  end if;
  v := public.ulit_censo_franquicias_it1_2026(
    'real-medina-del-campo-2026','rechazar',27,array['reg-it1-fran-b'],null);
  if v->>'version'<>'28' or v->'revisiones'->0 ? 'respuesta' then
    raise exception 'El rechazo no debe adjudicar Sí/No';
  end if;
  v := public.ulit_censo_franquicias_it1_2026(
    'real-medina-del-campo-2026','resolver',28,array['reg-it1-fran-b'],'no');
  if v->>'version'<>'29' or v->'revisiones'->0->>'estado'<>'corregida'
    or v->'revisiones'->0->>'respuesta'<>'no' then
    raise exception 'No se corrigió un rechazo';
  end if;
  v := public.ulit_censo_franquicias_it1_2026(
    'real-medina-del-campo-2026','resolver',29,array['reg-it1-fran-nuevo'],'si');
  if v->>'version'<>'30' or v->'revisiones'->0->>'respuesta'<>'si' then
    raise exception 'No se completó un negocio sin dato';
  end if;
  begin
    perform public.ulit_censo_franquicias_it1_2026(
      'real-medina-del-campo-2026','aceptar-todas',30,
      array['reg-it1-fran-c','reg-it1-fran-nuevo'],null);
    raise exception 'Aceptación masiva incluyó una celda en blanco';
  exception when sqlstate '22023' then null;
  end;
  v := public.ulit_censo_franquicias_it1_2026(
    'real-medina-del-campo-2026','aceptar-todas',30,
    array['reg-it1-fran-c','reg-it1-fran-d'],null);
  if v->>'version'<>'31' or pg_catalog.jsonb_array_length(v->'revisiones')<>2
    or v->'revisiones'->0->>'respuesta'<>'si'
    or v->'revisiones'->1->>'respuesta'<>'no'
    or v->'revisiones'->0->>'masiva'<>'true' then
    raise exception 'La confirmación masiva no fue atómica o no auditó cada propuesta';
  end if;
  if (select count(*) from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
     and coleccion='revisionesFranquiciaRegistros')<>5 then
    raise exception 'La colección tiene un número incorrecto de decisiones';
  end if;
  if (select valor from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
     and coleccion='registros' and id='reg-it1-fran-a') is distinct from antes then
    raise exception 'Se modificó el Excel original';
  end if;
  if (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026')<>n_copias+1 then
    raise exception 'La nueva colección no generó su copia de respaldo';
  end if;
  if (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026') then
    raise exception 'Se quedó abierta la escritura general';
  end if;
  begin
    perform public.ulit_censo_franquicias_it1_2026(
      'real-medina-del-campo-2026','resolver',31,array['reg-it1-cat-vacio'],'no');
    raise exception 'Se revisó un local vacío';
  exception when sqlstate '42501' then null;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-00000000000d',false);
  begin
    perform public.ulit_censo_franquicias_it1_2026(
      'real-medina-del-campo-2026','estado',0,array[]::text[],null);
    raise exception 'Usuario externo vio la capacidad';
  exception when sqlstate '42501' then null;
  end;
end $prueba$;
select 'OK: Franquicia Sí/No, rechazo, nuevo, batch, versión, backup y XLSX original intacto' as resultado;
