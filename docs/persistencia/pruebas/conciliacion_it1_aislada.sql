-- Integración REAL de SQL 0008 en PostgreSQL 17 AISLADO.
-- Solo datos sintéticos. La base original de Supabase no interviene.
\set ON_ERROR_STOP on
\echo 'SEED · esquema y datos sintéticos'
insert into ulit_censo.espacio(id,tipo,nombre,version,escritura_habilitada,preparacion_habilitada)
values ('real-medina-del-campo-2026','real','Medina sintética',4,false,false);
insert into ulit_censo.miembro(espacio_id,usuario_id,rol,persona_id)
values
('real-medina-del-campo-2026','00000000-0000-0000-0000-00000000000c','administrador','p-admin'),
('real-medina-del-campo-2026','00000000-0000-0000-0000-00000000000e','revisor','p-revisor'),
('real-medina-del-campo-2026','00000000-0000-0000-0000-00000000000d','lector','p-lector'),
('real-medina-del-campo-2026','00000000-0000-0000-0000-00000000000f','investigador','p-investigador');

insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
values
('real-medina-del-campo-2026','_raiz','raiz',
 '{"version":12,"secuencia":2000,"meta":{"espacio":"real","espacioId":"real-medina-del-campo-2026"}}',4),
('real-medina-del-campo-2026','campanas','camp-hist-real-mun-medina-2025-9e367ca51c',
 '{"id":"camp-hist-real-mun-medina-2025-9e367ca51c","tipo":"historico-importado","anio":2025}',4),
('real-medina-del-campo-2026','campanas','real-camp-medina-2026-censo-medina-del-campo-2026',
 '{"id":"real-camp-medina-2026-censo-medina-del-campo-2026","tipo":"actualizacion","anio":2026,"campanaReferenciaId":"camp-hist-real-mun-medina-2025-9e367ca51c"}',4),
('real-medina-del-campo-2026','itinerarios','it1',
 '{"id":"it1","campanaId":"real-camp-medina-2026-censo-medina-del-campo-2026","codigo":"IT1"}',4),
('real-medina-del-campo-2026','importaciones','imp-hist',
 '{"id":"imp-hist","campanaId":"camp-hist-real-mun-medina-2025-9e367ca51c","estado":"confirmada","tipo":"A-censo-historico"}',4),
('real-medina-del-campo-2026','importaciones','imp-it1',
 '{"id":"imp-it1","campanaId":"real-camp-medina-2026-censo-medina-del-campo-2026","estado":"confirmada","tipo":"C-excel-itinerario","huella":"7a6d4230a68370cc0bb0245ce68e8c56648be4d89e76531cc0edbd9ab341da61"}',4),
('real-medina-del-campo-2026','calles','calle-1',
 '{"id":"calle-1","nombre":"Calle de prueba","municipioId":"real-mun-medina"}',4),
('real-medina-del-campo-2026','locales','hist-local-3',
 '{"id":"hist-local-3","municipioId":"real-mun-medina","estado":"activo","procedencia":"importado","direcciones":[{"calleId":"calle-1","numero":3}]}',4),
('real-medina-del-campo-2026','observaciones','obs-hist',
 '{"id":"obs-hist","localId":"hist-local-3","campanaId":"camp-hist-real-mun-medina-2025-9e367ca51c","calleId":"calle-1","datos":{"vacio":false,"numero":3,"nombre":"Negocio anterior"}}',4);

-- 889 filas de histórico sintético, 105 filas IT1 y sus 105 vínculos.
insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
select 'real-medina-del-campo-2026','registros','hist-r-'||n,
 jsonb_build_object('id','hist-r-'||n,'importacionId','imp-hist','fila',n),4
from generate_series(1,889) n;

insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
select 'real-medina-del-campo-2026','registros','it1-r-'||n,
 jsonb_build_object('id','it1-r-'||n,'importacionId','imp-it1','itinerarioId','it1',
   'fila',n,'datos',jsonb_build_object('Dirección','Calle de prueba','Num',n)),4
from generate_series(2,106) n;

insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
select 'real-medina-del-campo-2026','vinculos','vin-it1-r-'||n,
 jsonb_build_object('id','vin-it1-r-'||n,'origen',jsonb_build_object('tipo','registro','id','it1-r-'||n),
   'localId',case when n>92 then to_jsonb('local-it1-'||n) else 'null'::jsonb end,
   'confianza',case when n>92 then 'confirmada' else 'sin-vinculo' end,
   'criterio','Importación IT1'),4
from generate_series(2,106) n;

insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
select 'real-medina-del-campo-2026','locales','local-it1-'||n,
 jsonb_build_object('id','local-it1-'||n,'municipioId','real-mun-medina',
   'estado','activo','procedencia','importado',
   'direcciones',jsonb_build_array(jsonb_build_object('calleId','calle-1','numero',n))),4
from generate_series(93,106) n;

-- 61 observaciones pendientes: 59 con número (2..60) y 2 sin número (61..62).
insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
select 'real-medina-del-campo-2026','observaciones','it1-o-'||n,
 jsonb_build_object('id','it1-o-'||n,'campanaId','real-camp-medina-2026-censo-medina-del-campo-2026',
   'itinerarioId','it1','registroId','it1-r-'||n,'calleId','calle-1',
   'localId',null,'datos',
   jsonb_build_object('vacio',false,'numero',case when n>60 then 'null'::jsonb else to_jsonb(case when n=2 or n=3 then 3 else n end) end,
   'nombre','Prueba comercio '||n)),4
from generate_series(2,62) n;

create function pg_temp.rechazado(sentencia text, codigo text)
returns void language plpgsql as $body$
declare recibido text;
begin
  begin
    execute sentencia;
  exception when others then
    recibido:=sqlstate;
    if recibido<>codigo then
      raise exception 'Error diferente al esperado: %, se esperaba %: %', recibido,codigo,sqlerrm;
    end if;
    return;
  end;
  raise exception 'No se rechazó petición que debía fallar con %',codigo;
end $body$;

\echo '01 · Estructura, permisos y situación inicial'
do $t$
begin
  assert (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')=4;
  assert (select count(*) from ulit_censo.entidad where coleccion='registros')=994;
  assert (select count(*) from ulit_censo.entidad where coleccion='vinculos' and valor->>'localId' is null)=91;
  assert (select count(*) from ulit_censo.entidad where coleccion='observaciones' and valor->>'campanaId'='real-camp-medina-2026-censo-medina-del-campo-2026')=61;
  assert not has_function_privilege('anon','public.ulit_censo_conciliar_it1_2026(text,bigint,text,text,text,text)','EXECUTE');
  assert not has_function_privilege('service_role','public.ulit_censo_conciliar_it1_2026(text,bigint,text,text,text,text)','EXECUTE');
  assert has_function_privilege('authenticated','public.ulit_censo_conciliar_it1_2026(text,bigint,text,text,text,text)','EXECUTE');
  assert not has_table_privilege('authenticated','ulit_censo.entidad','UPDATE');
end $t$;

\echo '02 · Sin sesión, otros roles y campañas: rechazados'
set role authenticated;
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',4,'it1-r-2','mantener-pendiente',null,'Sin sesión válida')$q$,'28000');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',4,'it1-r-2','mantener-pendiente',null,'Revisado por lector')$q$,'42501');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',4,'it1-r-2','mantener-pendiente',null,'Revisado por investigador')$q$,'42501');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('ensayo-prueba',4,'it1-r-2','mantener-pendiente',null,'Espacio ajeno')$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',4,'hist-r-2','mantener-pendiente',null,'Otro año histórico')$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',4,'it1-r-2','inexistente',null,'Acción inválida')$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',3,'it1-r-2','mantener-pendiente',null,'Versión vieja')$q$,'PT409');
-- Las aserciones de integridad usan rol postgres SOLO en base efímera.
-- La identidad de petición sigue siendo la cuenta de Auth simulada.
reset role;

\echo '03 · Lectura de capacidad y prohibición de escritura general'
do $t$
begin
 assert (public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',4,'','estado')->>'habilitada')='true';
 assert (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')=4;
end $t$;
select pg_temp.rechazado($q$select public.ulit_censo_aplicar('real-medina-del-campo-2026',4,'atajo general','[{"c":"registros","id":"it1-r-2","v":null}]')$q$,'42501');

\echo '04 · Vincular a local histórico: v5, copia v4, ocupación propia 2026'
do $t$
declare respuesta jsonb;
begin
 respuesta:=public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',4,'it1-r-2','vincular','hist-local-3','Confirmado mismo local físico en visita');
 assert (respuesta->>'version')='5';
 assert (select valor->>'localId' from ulit_censo.entidad where coleccion='vinculos' and id='vin-it1-r-2')='hist-local-3';
 assert (select valor->>'localId' from ulit_censo.entidad where coleccion='observaciones' and id='it1-o-2')='hist-local-3';
 assert (select count(*) from ulit_censo.entidad where coleccion='ocupaciones' and id='ocu-g5-it1-r-2')=1;
 assert (select count(*) from ulit_censo.copia where version=4)=1;
 assert (select count(*) from ulit_censo.operacion where version=5 and n_cambios>=3)=1;
 assert (select valor->>'campanaId' from ulit_censo.entidad where coleccion='observaciones' and id='obs-hist')='camp-hist-real-mun-medina-2025-9e367ca51c';
 assert (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026')=false;
end $t$;

\echo '05 · Reintento y doble uso del local histórico: rechazados'
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',4,'it1-r-2','vincular','hist-local-3','No repetir misma vinculación')$q$,'PT409');
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',5,'it1-r-3','vincular','hist-local-3','El mismo local ya vinculado')$q$,'42501');

\echo '06 · Mantener pendiente con motivo y deshacer sin cambiar estado'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
do $t$
declare respuesta jsonb;
begin
 respuesta:=public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',5,'it1-r-3','mantener-pendiente',null,'Pendiente de visita para distinguir');
 assert respuesta->>'version'='6';
 assert (select valor->>'localId' from ulit_censo.entidad where coleccion='vinculos' and id='vin-it1-r-3') is null;
 assert (select valor->'conciliaciones'->0->>'porId' from ulit_censo.entidad where coleccion='vinculos' and id='vin-it1-r-3')='p-revisor';
 respuesta:=public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',6,'it1-r-3','deshacer',null,null);
 assert respuesta->>'version'='7';
 assert (select valor->'conciliaciones'->0 ? 'deshecha' from ulit_censo.entidad where coleccion='vinculos' and id='vin-it1-r-3');
end $t$;

\echo '07 · Deshacer vínculo histórico y conservar observación original'
do $t$
declare respuesta jsonb;
begin
 respuesta:=public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',7,'it1-r-2','deshacer',null,null);
 assert respuesta->>'version'='8';
 assert (select valor->>'localId' from ulit_censo.entidad where coleccion='vinculos' and id='vin-it1-r-2') is null;
 assert (select valor->>'localId' from ulit_censo.entidad where coleccion='observaciones' and id='it1-o-2') is null;
 assert (select count(*) from ulit_censo.entidad where coleccion='ocupaciones' and id='ocu-g5-it1-r-2')=0;
 assert (select count(*) from ulit_censo.entidad where coleccion='locales' and id='hist-local-3')=1;
end $t$;

\echo '08 · Local nuevo, v9, autoría, original intacto; después deshacer v10'
do $t$
declare respuesta jsonb;
begin
 respuesta:=public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',8,'it1-r-4','local-nuevo',null,'Nueva entrada independiente confirmada');
 assert respuesta->>'version'='9';
 assert respuesta->>'localId'='loc-g5-it1-r-4';
 assert (select count(*) from ulit_censo.entidad where coleccion='locales' and id='loc-g5-it1-r-4')=1;
 assert (select valor->'direcciones'->0->>'numero' from ulit_censo.entidad where coleccion='locales' and id='loc-g5-it1-r-4')='4';
 assert (select valor->'conciliaciones'->0->>'porId' from ulit_censo.entidad where coleccion='vinculos' and id='vin-it1-r-4')='p-revisor';
 assert (select valor->>'fila' from ulit_censo.entidad where coleccion='registros' and id='it1-r-4')='4';
 respuesta:=public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',9,'it1-r-4','deshacer',null,null);
 assert respuesta->>'version'='10';
 assert (select count(*) from ulit_censo.entidad where coleccion='locales' and id='loc-g5-it1-r-4')=0;
 assert (select count(*) from ulit_censo.entidad where coleccion='ocupaciones' and id='ocu-g5-it1-r-4')=0;
end $t$;

\echo '09 · 30 registros sin observación: mantener pendiente, sin fabricar local'
do $t$
declare respuesta jsonb;
begin
 respuesta:=public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',10,'it1-r-70','mantener-pendiente',null,'Sin observación; falta documentación');
 assert respuesta->>'version'='11';
 assert (select count(*) from ulit_censo.entidad where coleccion='observaciones' and valor->>'registroId'='it1-r-70')=0;
end $t$;
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',11,'it1-r-70','local-nuevo',null,'Inventando local desde Excel')$q$,'42501');

\echo '10 · Dos observaciones sin número: no crear local; motivo corto'
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',11,'it1-r-61','local-nuevo',null,'Confirmación inventada')$q$,'42501');
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',11,'it1-r-60','mantener-pendiente',null,'duda')$q$,'22023');

\echo '11 · Contabilidad, historial, bloqueo final y estabilidad 2025'
reset role;
do $t$
declare cambios integer;
begin
 assert (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')=11;
 assert not (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026');
 assert (select count(*) from ulit_censo.entidad where coleccion='registros')=994;
 assert (select count(*) from ulit_censo.entidad where coleccion='campanas')=2;
 assert (select count(*) from ulit_censo.operacion where version>=5)=7;
 assert (select count(*) from ulit_censo.copia)=1;
 assert (select count(*) from ulit_censo.entidad_historial h join ulit_censo.operacion o on o.id=h.operacion_id
         where h.coleccion='registros' or h.coleccion='campanas')=0;
 assert (select count(*) from ulit_censo.entidad where coleccion='observaciones'
         and valor->>'campanaId'='camp-hist-real-mun-medina-2025-9e367ca51c')=1;
end $t$;

\echo '12 · Ataques de duplicado sin observación y portal 0'
-- Las 14 filas vinculadas de IT1 pueden carecer de observación en algunas
-- importaciones. La RPC NO debe asignar el mismo local histórico a otra fila.
update ulit_censo.entidad
  set valor=pg_catalog.jsonb_set(valor,'{localId}',to_jsonb('hist-local-3'::text))
  where espacio_id='real-medina-del-campo-2026'
    and coleccion='vinculos' and id='vin-it1-r-93';
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026(
  'real-medina-del-campo-2026',11,'it1-r-3','vincular','hist-local-3',
  'Otro vínculo de IT1 ya apunta al mismo local')$q$,'42501');

-- Un campo numérico 0 no es un número de portal comprobado.
update ulit_censo.entidad
  set valor=pg_catalog.jsonb_set(valor,'{datos,numero}','0'::jsonb)
  where espacio_id='real-medina-del-campo-2026'
    and coleccion='observaciones' and id='it1-o-5';
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026(
  'real-medina-del-campo-2026',11,'it1-r-5','local-nuevo',null,
  'Validación de portal cero no permitida')$q$,'42501');
do $t$
begin
 assert (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')=11,
  'un intento rechazado no incrementa versión';
 assert not (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026'),
  'la guarda de escritura debe permanecer cerrada';
end $t$;
\echo '13 · Deshacer no borra un local/ocupación que otra operación modificó'
-- Estado actual v11. Crear otra pareja y verificar que una modificación
-- posterior impide deshacer y mantiene la versión intacta.
do $t$
declare r jsonb;
begin
 r:=public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',
   11,'it1-r-6','local-nuevo',null,'Otro local diferenciado, verificado en campo');
 assert r->>'version'='12';
end $t$;
update ulit_censo.entidad
 set valor=pg_catalog.jsonb_set(valor,'{estado}','"desaparecido"'::jsonb)
 where coleccion='locales' and id='loc-g5-it1-r-6';
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026(
 'real-medina-del-campo-2026',12,'it1-r-6','deshacer',null,null)$q$,'42501');
update ulit_censo.entidad
 set valor=pg_catalog.jsonb_set(valor,'{estado}','"activo"'::jsonb)
 where coleccion='locales' and id='loc-g5-it1-r-6';
update ulit_censo.entidad
 set valor=pg_catalog.jsonb_set(valor,'{orden}','99999'::jsonb)
 where coleccion='ocupaciones' and id='ocu-g5-it1-r-6';
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026(
 'real-medina-del-campo-2026',12,'it1-r-6','deshacer',null,null)$q$,'42501');
update ulit_censo.entidad
 set valor=pg_catalog.jsonb_set(valor,'{orden}','2003'::jsonb)
 where coleccion='ocupaciones' and id='ocu-g5-it1-r-6';
-- Cobertura adicional que hace referencia al nuevo local: bloquea el borrado
-- incluso si no está entre las cuatro colecciones habituales de G5.
insert into ulit_censo.entidad (espacio_id,coleccion,id,valor,version)
values ('real-medina-del-campo-2026','coberturas','cobertura-r6',
        '{"id":"cobertura-r6","localId":"loc-g5-it1-r-6","nota":"referencia posterior"}',12);
select pg_temp.rechazado($q$select public.ulit_censo_conciliar_it1_2026(
 'real-medina-del-campo-2026',12,'it1-r-6','deshacer',null,null)$q$,'42501');
delete from ulit_censo.entidad where coleccion='coberturas' and id='cobertura-r6';
do $t$
declare r jsonb;
begin
 r:=public.ulit_censo_conciliar_it1_2026('real-medina-del-campo-2026',
   12,'it1-r-6','deshacer',null,null);
 assert r->>'version'='13';
 assert not exists (select 1 from ulit_censo.entidad where coleccion='locales' and id='loc-g5-it1-r-6');
 assert not exists (select 1 from ulit_censo.entidad where coleccion='ocupaciones' and id='ocu-g5-it1-r-6');
 assert not (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026');
end $t$;

\echo 'ÉXITO · Defensas adicionales: doble vínculo y portal cero'

\echo 'ÉXITO · Integración PostgreSQL aislada: permisos, atomicidad, auditabilidad, reversión y protección 2025'
