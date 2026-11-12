-- Pruebas exclusivamente sintéticas de la RPC de Fase 1.
-- Ejecutar en PostgreSQL aislado tras el esquema 0001/0002/0004 y la propuesta 0010.
do $prueba$
declare habilitada boolean;
begin
  if not ulit_censo.coleccion_valida('correccionesRegistros') then
    raise exception 'No se incorporó colección de correcciones';
  end if;
  if pg_catalog.has_function_privilege('anon','public.ulit_censo_revision_general_2026(text,text,bigint,text,jsonb,text)','EXECUTE')
     or pg_catalog.has_function_privilege('service_role','public.ulit_censo_revision_general_2026(text,text,bigint,text,jsonb,text)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated','public.ulit_censo_revision_general_2026(text,text,bigint,text,jsonb,text)','EXECUTE') then
    raise exception 'Privilegios RPC incorrectos';
  end if;
  if exists (select 1 from ulit_censo.autorizacion_revision_general_2026) then
    raise exception 'La migración ha activado escrituras sin autorización';
  end if;
end $prueba$;

insert into ulit_censo.espacio(id,tipo,nombre,version,escritura_habilitada,creado_por)
values ('real-medina-del-campo-2026','real','Datos SINTÉTICOS',8,false,'00000000-0000-0000-0000-00000000000c');
insert into ulit_censo.miembro(espacio_id,usuario_id,rol,persona_id)
values ('real-medina-del-campo-2026','00000000-0000-0000-0000-00000000000e','revisor','revisor');
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000e',false);

insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version) values
('real-medina-del-campo-2026','campanas','real-camp-medina-2026-censo-medina-del-campo-2026',
 '{"id":"real-camp-medina-2026-censo-medina-del-campo-2026","anio":2026,"tipo":"actualizacion"}',8),
('real-medina-del-campo-2026','importaciones','imp-sintetica',
 '{"id":"imp-sintetica","campanaId":"real-camp-medina-2026-censo-medina-del-campo-2026","estado":"confirmada","tipo":"C-excel-itinerario"}',8),
('real-medina-del-campo-2026','itinerarios','it-sintetico',
 '{"id":"it-sintetico","campanaId":"real-camp-medina-2026-censo-medina-del-campo-2026","codigo":"IT1"}',8),
('real-medina-del-campo-2026','registros','reg-sintetico-1',
 '{"id":"reg-sintetico-1","importacionId":"imp-sintetica","itinerarioId":"it-sintetico","fila":2,"datos":{"Local Vacío":"1","Nombre del negocio":"Anterior","Long fachada":"3.5"}}',8);

-- La fase debe seguir bloqueada si falta autorización o copia.
do $prueba$
declare x jsonb;
begin
 x:=public.ulit_censo_revision_general_2026('real-medina-del-campo-2026','estado',0,'','{}','');
 if x->>'habilitada' <> 'false' then raise exception 'Se habilitó sin autorización'; end if;
end $prueba$;

insert into ulit_censo.autorizacion_revision_general_2026
  (espacio_id,habilitada,autorizada_por,autorizada_en,motivo)
values ('real-medina-del-campo-2026',true,'00000000-0000-0000-0000-00000000000c',
  pg_catalog.now(),'Autorización solo para base de pruebas descartable');

do $prueba$
declare x jsonb;
begin
 x:=public.ulit_censo_revision_general_2026('real-medina-del-campo-2026','estado',0,'','{}','');
 if x->>'habilitada' <> 'false' then raise exception 'Se habilitó sin copia'; end if;
end $prueba$;

insert into ulit_censo.copia(espacio_id,version,motivo,contenido,sha256,bytes,creada_por)
values ('real-medina-del-campo-2026',8,'Copia sintética aislada',
 '{"espacioId":"real-medina-del-campo-2026","tipo":"real","version":8,"entidades":{}}',
 repeat('a',64),100,'00000000-0000-0000-0000-00000000000c');

do $prueba$
declare x jsonb;
begin
 x:=public.ulit_censo_revision_general_2026('real-medina-del-campo-2026','estado',0,'','{}','');
 if x->>'habilitada' <> 'true' then raise exception 'La RPC no reconoce el respaldo sintético'; end if;
 -- No debe aceptar modificaciones sobre registros inexistentes.
 begin
  perform public.ulit_censo_revision_general_2026('real-medina-del-campo-2026','guardar',8,'reg-inexistente','{"nombre":""}','Corrección de prueba');
  raise exception 'Debe rechazar registros inexistentes';
 exception when sqlstate '42501' then null;
 end;
 -- No debe aceptar campos no autorizados.
 begin
  perform public.ulit_censo_revision_general_2026('real-medina-del-campo-2026','guardar',8,'reg-sintetico-1','{"importacionId":"otro"}','Corrección de prueba');
  raise exception 'Debe rechazar campos ajenos a la lista';
 exception when sqlstate '22023' then null;
 end;
 -- El origen debe permanecer intacto tras la corrección.
 x:=public.ulit_censo_revision_general_2026('real-medina-del-campo-2026','guardar',8,'reg-sintetico-1','{"nombre":""}','Nombre anterior sin vigencia');
 if x->>'version'<>'9' then raise exception 'No incrementó la versión'; end if;
 if (select valor->'datos'->>'Nombre del negocio' from ulit_censo.entidad
     where coleccion='registros' and id='reg-sintetico-1') <> 'Anterior' then
   raise exception 'Se alteró el registro de origen';
 end if;
 if (select valor->'valores'->>'nombre' from ulit_censo.entidad
     where coleccion='correccionesRegistros' and id='reg-sintetico-1') <> '' then
   raise exception 'La corrección efectiva no se ha guardado';
 end if;
 if (select count(*) from ulit_censo.entidad_historial
     where coleccion='correccionesRegistros' and id='reg-sintetico-1')<>1 then
   raise exception 'No quedó historial auditable';
 end if;
 if (select escritura_habilitada from ulit_censo.espacio
     where id='real-medina-del-campo-2026') then
   raise exception 'La escritura general quedó abierta';
 end if;
 begin
  perform public.ulit_censo_revision_general_2026('real-medina-del-campo-2026','guardar',8,'reg-sintetico-1','{"nombre":"Test"}','Versión anticuada');
  raise exception 'Debe rechazar versión anterior';
 exception when sqlstate 'PT409' then null;
 end;
  -- Restaurar los valores efectivos originales conserva la operación anterior en historial.
  x:=public.ulit_censo_revision_general_2026('real-medina-del-campo-2026','guardar',9,'reg-sintetico-1','{}','Restituir valor anterior');
  if x->>'version'<>'10' then raise exception 'No incrementó versión al revertir'; end if;
  if (select valor->'historial'->0->'valoresAnteriores'->>'nombre' from ulit_censo.entidad
      where coleccion='correccionesRegistros' and id='reg-sintetico-1') <> '' then
    raise exception 'No conserva la versión corregida al revertir';
  end if;
  if (select valor->'valores' from ulit_censo.entidad
      where coleccion='correccionesRegistros' and id='reg-sintetico-1') <> '{}'::jsonb then
    raise exception 'La reversión no ha retirado el valor corregido';
  end if;
  if (select count(*) from ulit_censo.entidad_historial
      where coleccion='correccionesRegistros' and id='reg-sintetico-1') <> 2 then
    raise exception 'No se registraron ambas decisiones';
  end if;
end $prueba$;
select '✓ SQL aislado: autorización, copia, escritura, origen, historial y versión correctos' as verificado;
