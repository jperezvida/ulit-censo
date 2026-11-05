-- SOLO PARA PRUEBAS LOCALES (datos SINTÉTICOS). Cada bloque comprueba un requisito; cualquier fallo aborta.
\set ON_ERROR_STOP on
\set QUIET on
-- Auditoría del permiso excepcional de 2025. Debe ser invocable SOLO por Auth,
-- no exponer ni la autorización administrativa ni el esquema privado.
do $audit$
begin
  assert not has_table_privilege('anon', 'ulit_censo.autorizacion_historico_2025', 'SELECT'), 'anon lee la tabla privada de autorizaciones';
  assert not has_table_privilege('authenticated', 'ulit_censo.autorizacion_historico_2025', 'SELECT'), 'authenticated lee la tabla privada de autorizaciones';
  assert not has_table_privilege('service_role', 'ulit_censo.autorizacion_historico_2025', 'SELECT'), 'service_role lee la tabla privada de autorizaciones';
  assert not has_function_privilege('anon', 'public.ulit_censo_importar_historico_2025(text,uuid,integer,bigint,uuid)', 'EXECUTE'), 'anon ejecuta la importación';
  assert not has_function_privilege('service_role', 'public.ulit_censo_importar_historico_2025(text,uuid,integer,bigint,uuid)', 'EXECUTE'), 'service_role ejecuta la importación';
  assert has_function_privilege('authenticated', 'public.ulit_censo_importar_historico_2025(text,uuid,integer,bigint,uuid)', 'EXECUTE'), 'falta invocación Auth prevista';
  assert not exists(select 1 from ulit_censo.autorizacion_historico_2025), 'la migración concedió autorización sin aprobación';
end $audit$;
-- Alta inicial (plantilla 0003, como postgres)
insert into ulit_censo.espacio (id, tipo, nombre, escritura_habilitada) values ('ensayo-prueba', 'ensayo', 'Ensayo', true), ('real-medina', 'real', 'Real (bloqueado)', false);
insert into ulit_censo.miembro (espacio_id, usuario_id, rol, persona_id) values
  ('ensayo-prueba', '00000000-0000-0000-0000-00000000000c', 'administrador', 'ensayo-per-coord'),
  ('ensayo-prueba', '00000000-0000-0000-0000-00000000000d', 'lector', 'ensayo-per-lect'),
  ('real-medina', '00000000-0000-0000-0000-00000000000c', 'administrador', 'real-per-coord');

create function pg_temp.falla(sql text, estado text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if sqlstate <> estado then raise exception 'Esperaba % y salió % (%)', estado, sqlstate, sqlerrm; end if;
    raise notice 'OK rechazado (%): %', estado, left(sqlerrm, 90); return;
  end;
  raise exception 'Debía fallar con %: %', estado, sql;
end $$;
grant execute on function pg_temp.falla(text, text) to anon, authenticated, service_role;

\echo '1 · Los roles de la API no acceden al esquema privado'
set role anon;
select pg_temp.falla('select * from ulit_censo.entidad', '42501');
select pg_temp.falla($q$select public.ulit_censo_leer('ensayo-prueba')$q$, '42501');
reset role; set role service_role;
select pg_temp.falla('select * from ulit_censo.espacio', '42501');
reset role; set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.falla('select * from ulit_censo.miembro', '42501');

\echo '2 · Un administrador de ULIT base NO entra en ULIT Censo'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin assert public.es_admin_base_catedra(), 'debía ser admin de base'; end $$;
do $$ begin assert (select count(*) from public.ulit_censo_mis_espacios()) = 0, 'no debe ver espacios'; end $$;
select pg_temp.falla($q$select public.ulit_censo_leer('ensayo-prueba')$q$, '42501');
set request.jwt.claim.sub = '';
select pg_temp.falla($q$select public.ulit_censo_leer('ensayo-prueba')$q$, '28000');

\echo '3 · Carga inicial y cambios con versión esperada; conflicto si otra pestaña guardó antes'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 0, 'Carga inicial', '[
  {"c":"_raiz","id":"raiz","v":{"version":12,"meta":{"espacio":"ensayo","espacioId":"ensayo-prueba"}}},
  {"c":"locales","id":"ensayo-loc-1","v":{"id":"ensayo-loc-1","municipioId":"ensayo-mun-1"}},
  {"c":"revisiones","id":"ensayo-camp-2026|ensayo-loc-1","v":{"campanaId":"ensayo-camp-2026","localId":"ensayo-loc-1","campo":"terminado","categorizacion":"pendiente"}}]') = 1; end $$;
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 1, 'Clasificación', '[
  {"c":"revisiones","id":"ensayo-camp-2026|ensayo-loc-1","v":{"campanaId":"ensayo-camp-2026","localId":"ensayo-loc-1","campo":"terminado","categorizacion":"revisado"}}]') = 2; end $$;
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 1, 'Pestaña antigua', '[{"c":"locales","id":"ensayo-loc-1","v":null}]')$q$, 'PT409');
do $$ begin assert (public.ulit_censo_leer('ensayo-prueba') -> 'entidades' -> 'revisiones' -> 'ensayo-camp-2026|ensayo-loc-1' ->> 'categorizacion') = 'revisado'; end $$;
do $$ begin assert (public.ulit_censo_leer('ensayo-prueba') ->> 'version')::int = 2; end $$;

\echo '4 · Todo o nada: un cambio inválido no deja nada aplicado'
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 2, 'Mezcla', '[{"c":"locales","id":"ensayo-loc-2","v":{"id":"ensayo-loc-2"}},{"c":"tabla_inventada","id":"x","v":{}}]')$q$, '22023');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 2, 'Raíz ajena', '[{"c":"_raiz","id":"raiz","v":{"meta":{"espacio":"real","espacioId":"ensayo-prueba"}}}]')$q$, '22023');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 2, 'Otro espacio mismo tipo', '[{"c":"_raiz","id":"raiz","v":{"meta":{"espacio":"ensayo","espacioId":"ensayo-otro"}}}]')$q$, '22023');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 2, 'Repetida', '[{"c":"locales","id":"a","v":{}},{"c":"locales","id":"a","v":{}}]')$q$, '22023');
do $$ begin assert (public.ulit_censo_leer('ensayo-prueba') -> 'entidades' -> 'locales' -> 'ensayo-loc-2') is null; end $$;

\echo '5 · Lectora: lee pero no escribe; espacio real: escritura bloqueada'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
do $$ begin assert (public.ulit_censo_leer('ensayo-prueba') ->> 'rol') = 'lector'; end $$;
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 2, 'x', '[{"c":"locales","id":"b","v":{}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_leer('real-medina')$q$, '42501');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.falla($q$select public.ulit_censo_aplicar('real-medina', 0, 'x', '[{"c":"locales","id":"real-loc-1","v":{}}]')$q$, '42501');

\echo '6 · Historial por entidad (anterior → nuevo) e inmutabilidad'
do $$ begin assert (select count(*) from public.ulit_censo_historial('ensayo-prueba')) = 2; end $$;
reset role;
do $$ begin assert (select valor_anterior ->> 'categorizacion' || '>' || (valor_nuevo ->> 'categorizacion') from ulit_censo.entidad_historial h join ulit_censo.operacion o on o.id = h.operacion_id where o.version = 2) = 'pendiente>revisado'; end $$;
select pg_temp.falla($q$delete from ulit_censo.entidad_historial$q$, '42501');
select pg_temp.falla($q$update ulit_censo.operacion set etiqueta = 'x'$q$, '42501');
set role authenticated;

\echo '7 · Copia propia, cambio posterior, restauración trazada y copia automática previa'
do $$
declare c uuid; v bigint;
begin
  c := public.ulit_censo_crear_copia('ensayo-prueba', 'Antes de IT1');
  v := public.ulit_censo_aplicar('ensayo-prueba', 2, 'Borrar local (error)', '[{"c":"locales","id":"ensayo-loc-1","v":null}]');
  assert v = 3;
  assert (public.ulit_censo_leer('ensayo-prueba') -> 'entidades' -> 'locales' -> 'ensayo-loc-1') is null;
  v := public.ulit_censo_restaurar_copia('ensayo-prueba', c, 3, 'Deshacer el borrado');
  assert v = 4;
  assert (public.ulit_censo_leer('ensayo-prueba') -> 'entidades' -> 'locales' -> 'ensayo-loc-1' ->> 'id') = 'ensayo-loc-1';
  assert (select count(*) from public.ulit_censo_listar_copias('ensayo-prueba')) = 2;
  assert (select tipo from public.ulit_censo_historial('ensayo-prueba') limit 1) = 'restauracion';
  assert (public.ulit_censo_descargar_copia('ensayo-prueba', c) ->> 'sha256') ~ '^[0-9a-f]{64}$';
end $$;

\echo '8 · Miembros: solo administración; una cuenta inexistente no se crea'
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin assert public.ulit_censo_alta_miembro('ensayo-prueba', 'REVISORA@ejemplo.invalid', 'revisor', 'ensayo-per-rev') = '00000000-0000-0000-0000-00000000000e'; end $$;
select pg_temp.falla($q$select public.ulit_censo_alta_miembro('ensayo-prueba', 'nadie@ejemplo.invalid', 'lector', 'x')$q$, 'P0002');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.falla($q$select public.ulit_censo_alta_miembro('ensayo-prueba', 'admin.base@ejemplo.invalid', 'administrador', 'x')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_restaurar_copia('ensayo-prueba', gen_random_uuid(), 4, 'x')$q$, '42501');
reset role;

\echo '9 · Censo histórico y estructuras: solo coordinación'
insert into ulit_censo.miembro (espacio_id, usuario_id, rol, persona_id) values ('ensayo-prueba', '00000000-0000-0000-0000-00000000000f', 'investigador', 'ensayo-per-inv');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
-- Coordinación: carga estructural (campaña histórica 2025 con su importación, registro, observación y ocupación; campaña 2026)
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 4, 'Carga 2025 + campaña 2026', '[
  {"c":"campanas","id":"ensayo-camp-2025","v":{"id":"ensayo-camp-2025","tipo":"historico-importado","anio":2025}},
  {"c":"campanas","id":"ensayo-camp-2026","v":{"id":"ensayo-camp-2026","tipo":"actualizacion","anio":2026}},
  {"c":"importaciones","id":"ensayo-imp-2025","v":{"id":"ensayo-imp-2025","campanaId":"ensayo-camp-2025"}},
  {"c":"registros","id":"ensayo-reg-1","v":{"id":"ensayo-reg-1","importacionId":"ensayo-imp-2025","fila":2}},
  {"c":"vinculos","id":"vin-ensayo-reg-1","v":{"id":"vin-ensayo-reg-1","origen":{"tipo":"registro","id":"ensayo-reg-1"},"localId":"ensayo-loc-1"}},
  {"c":"observaciones","id":"ensayo-obs-2025","v":{"id":"ensayo-obs-2025","campanaId":"ensayo-camp-2025","localId":"ensayo-loc-1","datos":{"nombre":"BAR SINTÉTICO"}}},
  {"c":"ocupaciones","id":"ensayo-ocu-2025","v":{"id":"ensayo-ocu-2025","localId":"ensayo-loc-1","desdeCampanaId":"ensayo-camp-2025","hastaCampanaId":"ensayo-camp-2025"}}]') = 5; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';  -- revisora
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"campanas","id":"ensayo-camp-2026","v":{"id":"ensayo-camp-2026","tipo":"historico-importado"}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"personas","id":"ensayo-per-rev","v":{"id":"ensayo-per-rev","roles":["administrador"]}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"importaciones","id":"ensayo-imp-2025","v":null}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"municipios","id":"ensayo-mun-2","v":{"id":"ensayo-mun-2"}}]')$q$, '42501');
-- Histórico: ni modificar, ni borrar, ni crear en la campaña 2025, ni sacar una observación de ella
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"observaciones","id":"ensayo-obs-2025","v":{"id":"ensayo-obs-2025","campanaId":"ensayo-camp-2025","datos":{"nombre":"OTRO"}}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"observaciones","id":"ensayo-obs-2025","v":null}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"observaciones","id":"ensayo-obs-2025","v":{"id":"ensayo-obs-2025","campanaId":"ensayo-camp-2026"}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"observaciones","id":"ensayo-obs-nueva","v":{"id":"ensayo-obs-nueva","campanaId":"ensayo-camp-2025"}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"vinculos","id":"vin-ensayo-reg-1","v":{"id":"vin-ensayo-reg-1","origen":{"tipo":"registro","id":"ensayo-reg-1"},"localId":null}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"ocupaciones","id":"ensayo-ocu-2025","v":{"id":"ensayo-ocu-2025","localId":"otro","desdeCampanaId":"ensayo-camp-2025","hastaCampanaId":"ensayo-camp-2026"}}]')$q$, '42501');
-- Una raíz de otro espacio se rechaza por identidad antes de comprobar los permisos.
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"_raiz","id":"raiz","v":{"version":12,"meta":{"espacio":"ensayo","espacioId":"ensayo-otro"}}}]')$q$, '22023');
-- Con identidad correcta, una revisora NO puede cambiar la configuración del espacio.
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"_raiz","id":"raiz","v":{"version":12,"meta":{"espacio":"ensayo","espacioId":"ensayo-prueba","ajuste":true}}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"observaciones","id":"ensayo-obs-a","v":{"id":"ensayo-obs-b","campanaId":"ensayo-camp-2026"}}]')$q$, '22023');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 5, 'x', '[{"c":"observaciones","id":"ensayo-obs-a","v":[1,2]}]')$q$, '22023');
-- Lo que sí puede la revisión: trabajo de 2026 y el contador de la raíz, en la misma operación
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 5, 'Oficina 2026', '[
  {"c":"_raiz","id":"raiz","v":{"version":12,"secuencia":7,"meta":{"espacio":"ensayo","espacioId":"ensayo-prueba"}}},
  {"c":"observaciones","id":"ensayo-obs-2026","v":{"id":"ensayo-obs-2026","campanaId":"ensayo-camp-2026","localId":"ensayo-loc-1"}},
  {"c":"digital","id":"ensayo-neg-1|ensayo-camp-2026","v":{"negocioId":"ensayo-neg-1","campanaId":"ensayo-camp-2026","estado":"borrador"}}]') = 6; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';  -- investigadora
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 6, 'x', '[{"c":"digital","id":"ensayo-neg-1|ensayo-camp-2026","v":{"estado":"verificada"}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 6, 'x', '[{"c":"locales","id":"ensayo-loc-9","v":{"id":"ensayo-loc-9"}}]')$q$, '42501');
-- «Sin cambios» de Campo: prolongar la ocupación histórica hasta 2026 sí está permitido
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 6, 'Sin cambios', '[
  {"c":"ocupaciones","id":"ensayo-ocu-2025","v":{"id":"ensayo-ocu-2025","localId":"ensayo-loc-1","desdeCampanaId":"ensayo-camp-2025","hastaCampanaId":"ensayo-camp-2026"}}]') = 7; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 7, 'Coordinación corrige el histórico', '[{"c":"observaciones","id":"ensayo-obs-2025","v":{"id":"ensayo-obs-2025","campanaId":"ensayo-camp-2025","localId":"ensayo-loc-1","datos":{"nombre":"BAR SINTÉTICO (corregido)"}}}]') = 8; end $$;

\echo '10 · Envíos por partes: atómicos, solo de quien los sube y con versión esperada'
do $$
declare l uuid := gen_random_uuid();
begin
  perform public.ulit_censo_lote_subir('ensayo-prueba', l, 0, '[{"c":"locales","id":"ensayo-loc-a","v":{"id":"ensayo-loc-a"}}]');
  perform public.ulit_censo_lote_subir('ensayo-prueba', l, 1, '[{"c":"locales","id":"ensayo-loc-b","v":{"id":"ensayo-loc-b"}}]');
  assert public.ulit_censo_lote_aplicar('ensayo-prueba', l, 2, 8, 'Lote de dos partes') = 9;
  assert (select n_cambios from public.ulit_censo_historial('ensayo-prueba') where version = 9) = 2;
end $$;
create temporary table _l as select gen_random_uuid() as l;
grant select on _l to authenticated;
select public.ulit_censo_lote_subir('ensayo-prueba', (select l from _l), 0, '[{"c":"campanas","id":"ensayo-camp-2025","v":null}]');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.falla($q$select public.ulit_censo_lote_aplicar('ensayo-prueba', (select l from _l), 1, 9, 'ajeno')$q$, '22023');
select pg_temp.falla($q$select public.ulit_censo_lote_subir('ensayo-prueba', (select l from _l), 1, '[]')$q$, '42501');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.falla($q$select public.ulit_censo_lote_aplicar('ensayo-prueba', (select l from _l), 2, 9, 'incompleto')$q$, '22023');
select pg_temp.falla($q$select public.ulit_censo_lote_aplicar('ensayo-prueba', (select l from _l), 1, 3, 'versión antigua')$q$, 'PT409');
reset role; set role anon;
select pg_temp.falla($q$select public.ulit_censo_lote_subir('ensayo-prueba', gen_random_uuid(), 0, '[]')$q$, '42501');
reset role; set role service_role;
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 9, 'x', '[]')$q$, '42501');
reset role;

\echo '11 · Protección indirecta: locales y negocios ya vinculados al histórico 2025'
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 9, 'Negocio de 2025', '[
  {"c":"negocios","id":"ensayo-neg-25","v":{"id":"ensayo-neg-25","nombre":"DROGUERÍA SINTÉTICA"}},
  {"c":"ocupaciones","id":"ensayo-ocu-n25","v":{"id":"ensayo-ocu-n25","localId":"ensayo-loc-1","negocioId":"ensayo-neg-25","desdeCampanaId":"ensayo-camp-2025","hastaCampanaId":"ensayo-camp-2025"}}]') = 10; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';  -- revisora
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 10, 'x', '[{"c":"locales","id":"ensayo-loc-1","v":{"id":"ensayo-loc-1","municipioId":"ensayo-mun-1","estado":"desaparecido"}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 10, 'x', '[{"c":"locales","id":"ensayo-loc-1","v":null}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 10, 'x', '[{"c":"negocios","id":"ensayo-neg-25","v":{"id":"ensayo-neg-25","nombre":"MANIPULADO"}}]')$q$, '42501');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 10, 'x', '[{"c":"negocios","id":"ensayo-neg-25","v":null}]')$q$, '42501');
-- Lo nuevo de 2026 sí: alta de local y negocio, y después su corrección
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 10, 'Alta 2026', '[
  {"c":"locales","id":"ensayo-loc-26","v":{"id":"ensayo-loc-26","municipioId":"ensayo-mun-1"}},
  {"c":"negocios","id":"ensayo-neg-26","v":{"id":"ensayo-neg-26","nombre":"FERRETERÍA SINTÉTICA"}},
  {"c":"ocupaciones","id":"ensayo-ocu-26","v":{"id":"ensayo-ocu-26","localId":"ensayo-loc-26","negocioId":"ensayo-neg-26","desdeCampanaId":"ensayo-camp-2026","hastaCampanaId":"ensayo-camp-2026"}}]') = 11; end $$;
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 11, 'Corrección 2026', '[
  {"c":"negocios","id":"ensayo-neg-26","v":{"id":"ensayo-neg-26","nombre":"FERRETERÍA SINTÉTICA S.L."}},
  {"c":"locales","id":"ensayo-loc-26","v":{"id":"ensayo-loc-26","municipioId":"ensayo-mun-1","nota":"corregido"}}]') = 12; end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';  -- coordinación sí puede corregir el histórico
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 12, 'Corrección de coordinación', '[{"c":"negocios","id":"ensayo-neg-25","v":{"id":"ensayo-neg-25","nombre":"DROGUERÍA SINTÉTICA (corregido)"}}]') = 13; end $$;
reset role;
\echo 'TODAS LAS PRUEBAS SUPERADAS'


