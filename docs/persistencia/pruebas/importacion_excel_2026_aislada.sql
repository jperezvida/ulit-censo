-- Pruebas SQL 0009 · SOLO PostgreSQL efímero, datos de empresa y portal sintéticos.
\set ON_ERROR_STOP on
\echo '00 · Semilla sintética de espacio real bloqueado (versión 4)'
insert into ulit_censo.espacio (id,tipo,nombre,version,escritura_habilitada,preparacion_habilitada)
values ('real-medina-del-campo-2026','real','Medina simulada',4,false,false);
insert into ulit_censo.miembro(espacio_id,usuario_id,rol,persona_id)
values ('real-medina-del-campo-2026','00000000-0000-0000-0000-00000000000c','administrador','p-admin'),
 ('real-medina-del-campo-2026','00000000-0000-0000-0000-00000000000e','revisor','p-revisor'),
 ('real-medina-del-campo-2026','00000000-0000-0000-0000-00000000000d','lector','p-lector');
insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
values
('real-medina-del-campo-2026','_raiz','raiz',
 '{"version":11,"secuencia":400,"meta":{"espacio":"real","espacioId":"real-medina-del-campo-2026"},"colaSync":[]}',4),
('real-medina-del-campo-2026','campanas','camp-hist-real-mun-medina-2025-9e367ca51c',
 '{"id":"camp-hist-real-mun-medina-2025-9e367ca51c","anio":2025,"tipo":"historico-importado"}',4),
('real-medina-del-campo-2026','campanas','real-camp-medina-2026-censo-medina-del-campo-2026',
 '{"id":"real-camp-medina-2026-censo-medina-del-campo-2026","anio":2026,"tipo":"actualizacion"}',4),
('real-medina-del-campo-2026','calles','calle-2',
 '{"id":"calle-2","municipioId":"real-mun-medina","nombre":"Calle de ensayo"}',4),
('real-medina-del-campo-2026','itinerarios','real-it-it1',
 '{"id":"real-it-it1","campanaId":"real-camp-medina-2026-censo-medina-del-campo-2026","codigo":"IT1"}',4),
('real-medina-del-campo-2026','importaciones','imp-it1',
 '{"id":"imp-it1","campanaId":"real-camp-medina-2026-censo-medina-del-campo-2026","estado":"confirmada","tipo":"C-excel-itinerario","huella":"sha-previa","c1":{"itinerario":{"id":"real-it-it1"}}}',4),
('real-medina-del-campo-2026','registros','hist-r-1',
 '{"id":"hist-r-1","importacionId":"imp-hist","fila":2,"datos":{"Nombre del negocio":"Histórica intacta"}}',4);

create function pg_temp.plan_it2() returns jsonb
language sql stable security definer set search_path=''
as $fixture$
select jsonb_build_array(
 jsonb_build_object('c','_raiz','id','raiz','v',
   '{"version":11,"secuencia":401,"meta":{"espacio":"real","espacioId":"real-medina-del-campo-2026"},"colaSync":[]}'::jsonb),
 jsonb_build_object('c','itinerarios','id','real-it-it2','v',
   jsonb_build_object('id','real-it-it2','campanaId','real-camp-medina-2026-censo-medina-del-campo-2026','codigo','IT2','origen','excel')),
 jsonb_build_object('c','importaciones','id','imp-it2','v',
   jsonb_build_object('id','imp-it2','campanaId','real-camp-medina-2026-censo-medina-del-campo-2026',
     'municipioId','real-mun-medina','tipo','C-excel-itinerario',
     'huella',repeat('a',64),'estado','confirmada','filas',2,
     'c1',jsonb_build_object('sha256',repeat('a',64),'anio',2026,
          'itinerario',jsonb_build_object('id','real-it-it2','codigo','IT2')))),
 jsonb_build_object('c','registros','id','it2-r2','v',jsonb_build_object(
   'id','it2-r2','importacionId','imp-it2','itinerarioId','real-it-it2','fila',2,
   'datos',jsonb_build_object('Dirección','Calle de ensayo','Num','9','Nombre del negocio','Negocio IT2'))),
 jsonb_build_object('c','registros','id','it2-r3','v',jsonb_build_object(
   'id','it2-r3','importacionId','imp-it2','itinerarioId','real-it-it2','fila',3,
   'datos',jsonb_build_object('Dirección','Calle de ensayo','Num','11'))),
 jsonb_build_object('c','vinculos','id','vin-it2-2','v',jsonb_build_object('id','vin-it2-2',
   'origen',jsonb_build_object('tipo','registro','id','it2-r2'),'localId','loc-it2-9','confianza','probable','criterio','Importación pendiente de supervisión')),
 jsonb_build_object('c','vinculos','id','vin-it2-3','v',jsonb_build_object('id','vin-it2-3',
   'origen',jsonb_build_object('tipo','registro','id','it2-r3'),'localId',null,'confianza','sin-vinculo','criterio','No se conoce local')),
 jsonb_build_object('c','locales','id','loc-it2-9','v',jsonb_build_object('id','loc-it2-9',
   'municipioId','real-mun-medina','procedencia','importado','estado','activo',
   'direcciones',jsonb_build_array(jsonb_build_object('calleId','calle-2','numero',9)))),
 jsonb_build_object('c','negocios','id','neg-it2','v',jsonb_build_object('id','neg-it2','nombre','Negocio ficticio IT2')),
 jsonb_build_object('c','observaciones','id','obs-it2-2','v',jsonb_build_object(
   'id','obs-it2-2','campanaId','real-camp-medina-2026-censo-medina-del-campo-2026',
   'itinerarioId','real-it-it2','registroId','it2-r2','localId','loc-it2-9',
   'calleId','calle-2','fuente','importacion','tipo','confirmado','verificacion','pendiente','datos',jsonb_build_object('numero',9,'vacio',false,'negocioId','neg-it2'))),
 jsonb_build_object('c','ocupaciones','id','ocu-it2-2','v',jsonb_build_object(
   'id','ocu-it2-2','localId','loc-it2-9','negocioId','neg-it2',
   'desdeCampanaId','real-camp-medina-2026-censo-medina-del-campo-2026',
   'desdeObservacionId','obs-it2-2'))
);
$fixture$;
grant execute on function pg_temp.plan_it2() to authenticated;

create function pg_temp.plan_parte() returns jsonb
language sql stable security definer set search_path=''
as $fixture$
select jsonb_build_array(
 jsonb_build_object('c','_raiz','id','raiz','v',
   '{"version":11,"secuencia":402,"meta":{"espacio":"real","espacioId":"real-medina-del-campo-2026"},"colaSync":[]}'::jsonb),
 jsonb_build_object('c','importaciones','id','imp-it2-parte2','v',
   jsonb_build_object('id','imp-it2-parte2','campanaId','real-camp-medina-2026-censo-medina-del-campo-2026',
    'municipioId','real-mun-medina','tipo','C-excel-itinerario','huella',repeat('b',64),
    'estado','confirmada','filas',1,
    'c1',jsonb_build_object('sha256',repeat('b',64),'anio',2026,
     'itinerario',jsonb_build_object('id','real-it-it2','codigo','IT2')))),
 jsonb_build_object('c','registros','id','it2-r4','v',jsonb_build_object(
  'id','it2-r4','importacionId','imp-it2-parte2','itinerarioId','real-it-it2',
  'fila',2,'datos',jsonb_build_object('Dirección','Calle de ensayo','Num','13'))),
 jsonb_build_object('c','vinculos','id','vin-it2-4','v',jsonb_build_object(
  'id','vin-it2-4','origen',jsonb_build_object('tipo','registro','id','it2-r4'),'localId',null,'confianza','sin-vinculo','criterio','Sin vínculo'))
);
$fixture$;
grant execute on function pg_temp.plan_parte() to authenticated;

create function pg_temp.rechazado(stmt text, esperado text)
returns void language plpgsql security definer set search_path=''
as $fn$
declare recibido text;
begin
 begin
  execute stmt;
 exception when others then
  recibido:=sqlstate;
  if recibido<>esperado then
   raise exception 'Esperado error %, recibido %: %', esperado, recibido, sqlerrm;
  end if;
  return;
 end;
 raise exception 'No se rechazó operación que debía fallar: %', stmt;
end $fn$;
grant execute on function pg_temp.rechazado(text,text) to authenticated;

\echo '01 · Privilegios API y bloqueo general'
do $t$
begin
 assert has_function_privilege('authenticated','public.ulit_censo_importar_excel_2026(text,bigint,text,text,boolean,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','public.ulit_censo_importar_excel_2026(text,bigint,text,text,boolean,jsonb)','EXECUTE');
 assert not has_function_privilege('service_role','public.ulit_censo_importar_excel_2026(text,bigint,text,text,boolean,jsonb)','EXECUTE');
 assert not has_table_privilege('authenticated','ulit_censo.entidad','INSERT');
end $t$;

\echo '02 · Rol de solo lectura y sesión inexistente'
set role authenticated;
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,pg_temp.plan_it2())$q$,'28000');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,pg_temp.plan_it2())$q$,'42501');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,pg_temp.plan_it2())$q$,'42501');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';

\echo '03 · El estado de capacidad no escribe'
do $t$ begin
 assert (public.ulit_censo_estado_excel_2026('real-medina-del-campo-2026')->>'habilitada')='true';
end $t$;
select pg_temp.rechazado($q$select public.ulit_censo_aplicar(
 'real-medina-del-campo-2026',4,'vía general',
 '[{"c":"registros","id":"atajo-no-autorizado","v":{"id":"atajo-no-autorizado"}}]'::jsonb)$q$,'42501');

\echo '03b · Ataques: vínculo falso, negocio inexistente y ocupación discrepante'
-- No hay ninguna copia ni nueva versión después de las tres operaciones rechazadas.
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 jsonb_set(pg_temp.plan_it2(),'{5,v,localId}','null'::jsonb))$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 jsonb_set(pg_temp.plan_it2(),'{9,v,datos,negocioId}','"negocio-falso"'::jsonb))$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 jsonb_set(pg_temp.plan_it2(),'{10,v,negocioId}','null'::jsonb))$q$,'42501');
reset role;
do $t$ begin
 assert (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')=4;
 assert (select count(*) from ulit_censo.copia)=0;
 assert not (select escritura_habilitada from ulit_censo.espacio
    where id='real-medina-del-campo-2026');
end $t$;
set role authenticated;

\echo '03c · Auditoría externa: decisiones, verificación y Oficina fabricadas'
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 jsonb_set(pg_temp.plan_it2(),'{5,v,conciliaciones}',
 '[{"accion":"vincular","porId":"otra-persona","campanaId":"campana-falsa"}]'::jsonb))$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 jsonb_set(pg_temp.plan_it2(),'{5,v,confianza}','"confirmada"'::jsonb))$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 jsonb_set(pg_temp.plan_it2(),'{9,v,verificacion}','"verificada"'::jsonb))$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 jsonb_set(pg_temp.plan_it2(),'{2,v,c1,decisiones}',
 '{"correspondencias":[{"porId":"otro-usuario","accion":"local-existente"}]}'::jsonb))$q$,'42501');
\echo '03d · Claves y atribuciones digitales o de clasificación falsas'
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 pg_temp.plan_it2()||jsonb_build_array(jsonb_build_object(
 'c','digital','id','negocio-historico|real-camp-medina-2026-censo-medina-del-campo-2026',
 'v',jsonb_build_object('negocioId','neg-it2','campanaId',
 'real-camp-medina-2026-censo-medina-del-campo-2026','datos','{}'::jsonb,
 'estado','borrador','historial','[]'::jsonb))))$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 pg_temp.plan_it2()||jsonb_build_array(jsonb_build_object(
 'c','digital','id','neg-it2|real-camp-medina-2026-censo-medina-del-campo-2026',
 'v',jsonb_build_object('negocioId','neg-it2','campanaId',
 'real-camp-medina-2026-censo-medina-del-campo-2026','datos',
 '{"instagram":{"origen":"manual","respuesta":"si","porId":"otro"}}'::jsonb,
 'estado','verificada','historial','[]'::jsonb))))$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 pg_temp.plan_it2()||jsonb_build_array(jsonb_build_object(
 'c','clasificaciones','id','neg-it2|real-camp-medina-2026-censo-medina-del-campo-2026',
 'v',jsonb_build_object('negocioId','neg-it2','campanaId',
 'real-camp-medina-2026-censo-medina-del-campo-2026','actividadId','a1',
 'origen','manual','confirmada',true,'porId','tercero'))))$q$,'42501');
\echo '03e · Dos observaciones contradictorias para una fila'
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,
 pg_temp.plan_it2()||jsonb_build_array(jsonb_build_object(
 'c','observaciones','id','obs-duplicada',
 'v',jsonb_set(jsonb_set(pg_temp.plan_it2()->9->'v','{id}','"obs-duplicada"'::jsonb),
  '{datos,vacio}','true'::jsonb))))$q$,'42501');
reset role;
do $t$ begin
 assert (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')=4;
 assert (select count(*) from ulit_censo.copia)=0;
 assert not (select escritura_habilitada from ulit_censo.espacio
    where id='real-medina-del-campo-2026');
end $t$;
set role authenticated;

\echo '04 · Primer IT2: copia anterior, 2 filas, 1 local, 1 pendiente'
do $t$
declare r jsonb;
begin
 r:=public.ulit_censo_importar_excel_2026(
  'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,pg_temp.plan_it2());
 assert r->>'version'='5';
 assert r->>'filas'='2';
 assert r->>'itinerario'='IT2';
end $t$;
reset role;
do $t$
declare c ulit_censo.copia;
begin
 assert (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')=5;
 assert not (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026');
 assert (select count(*) from ulit_censo.entidad where coleccion='registros' and valor->>'importacionId'='imp-it2')=2;
 assert (select count(*) from ulit_censo.entidad where coleccion='vinculos'
  and valor->'origen'->>'id'='it2-r3' and valor->>'localId' is null)=1;
 assert (select count(*) from ulit_censo.entidad where coleccion='registros' and id='hist-r-1'
  and valor->'datos'->>'Nombre del negocio'='Histórica intacta')=1;
 select * into c from ulit_censo.copia where espacio_id='real-medina-del-campo-2026' and version=4;
 assert c.id is not null;
 assert c.contenido->>'version'='4';
 assert c.contenido->'entidades'->'registros'->'hist-r-1' is not null;
 assert encode(pg_catalog.sha256(pg_catalog.convert_to(c.contenido::text,'UTF8')),'hex')=c.sha256;
 assert (select count(*) from ulit_censo.operacion where version=5)=1;
end $t$;

\echo '05 · Versión caducada y archivo repetido'
set role authenticated;
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',4,'IT2',repeat('a',64),false,pg_temp.plan_it2())$q$,'PT409');
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',5,'IT2',repeat('a',64),false,pg_temp.plan_it2())$q$,'42501');

\echo '05b · No duplicar las mismas celdas XLSX como parte adicional'
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',5,'IT2',repeat('b',64),true,
 jsonb_set(pg_temp.plan_parte(),'{2,v,datos}',pg_temp.plan_it2()->3->'v'->'datos'))$q$,'42501');

\echo '06 · Parte adicional de IT2 requiere confirmación expresa'
select pg_temp.rechazado($q$select public.ulit_censo_importar_excel_2026(
 'real-medina-del-campo-2026',5,'IT2',repeat('b',64),false,pg_temp.plan_parte())$q$,'42501');
do $t$
declare r jsonb;
begin
 r:=public.ulit_censo_importar_excel_2026(
  'real-medina-del-campo-2026',5,'IT2',repeat('b',64),true,pg_temp.plan_parte());
 assert r->>'version'='6';
 assert r->>'filas'='1';
end $t$;
reset role;
do $t$ begin
 assert (select count(*) from ulit_censo.entidad where coleccion='importaciones'
  and id in ('imp-it2','imp-it2-parte2'))=2;
 assert (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026')=2;
 assert not (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026');
end $t$;

\echo '07 · Copias inviolables y raíz histórica estable'
select pg_temp.rechazado($q$delete from ulit_censo.copia
 where espacio_id='real-medina-del-campo-2026'$q$,'42501');
do $t$ begin
 assert (select count(*) from ulit_censo.entidad where coleccion='campanas')=2;
 assert (select count(*) from ulit_censo.entidad where coleccion='registros'
  and id='hist-r-1')=1;
end $t$;

\echo '08 · ENSAYO de recuperación: exportar JSON fuera de la base, importar y reconstruir clon'
-- Ruta local solo del runner Ubuntu; nunca se exportan datos reales.
\copy (select contenido::text from ulit_censo.copia where espacio_id='real-medina-del-campo-2026' and version=4 order by creada_en desc limit 1) to '/tmp/ulit-censo-it2-copia-sintetica.json'
create temporary table _respaldo_externo(texto text) on commit preserve rows;
\copy _respaldo_externo(texto) from '/tmp/ulit-censo-it2-copia-sintetica.json'
do $t$
declare instantanea jsonb;
begin
 assert (select count(*) from pg_temp._respaldo_externo)=1, 'La copia exportada debe contener un único JSON';
 select texto::jsonb into instantanea from pg_temp._respaldo_externo;
 assert instantanea->>'espacioId'='real-medina-del-campo-2026';
 assert instantanea->>'version'='4';
 assert jsonb_typeof(instantanea->'entidades')='object';
 assert (select sha256 from ulit_censo.copia where version=4 limit 1)
  = encode(pg_catalog.sha256(pg_catalog.convert_to(instantanea::text,'UTF8')),'hex');
 -- El clon es OTRO espacio, sin credenciales ni escritura en producción.
 insert into ulit_censo.espacio
   (id,tipo,nombre,version,escritura_habilitada)
 values('ensayo-recuperacion-it2','ensayo','Recuperación aislada de IT2',4,true);
 insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
 select 'ensayo-recuperacion-it2',coleccion.key,registro.key,registro.value,4
   from jsonb_each(instantanea->'entidades') as coleccion
   cross join lateral jsonb_each(coleccion.value) as registro;
 assert ulit_censo.contenido('ensayo-recuperacion-it2')=instantanea->'entidades',
   'La restauración en el clon debe coincidir byte-a-byte como JSONB';
 assert (select count(*) from ulit_censo.entidad
   where espacio_id='ensayo-recuperacion-it2' and coleccion='registros')=1;
 assert (select count(*) from ulit_censo.entidad
   where espacio_id='ensayo-recuperacion-it2' and coleccion='importaciones')=1;
 assert (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')=6;
 assert not (select escritura_habilitada from ulit_censo.espacio
   where id='real-medina-del-campo-2026');
end $t$;
\echo 'ÉXITO · JSON externo con SHA-256 verificado y clon recuperado sin alterar espacio de origen'

\echo 'ÉXITO: IT2, parte adicional, permisos, versión, integridad, copias e histórico.';
