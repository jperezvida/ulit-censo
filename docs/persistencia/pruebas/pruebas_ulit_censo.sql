-- SOLO PARA PRUEBAS LOCALES (datos SINTÉTICOS). Cada bloque comprueba un requisito; cualquier fallo aborta.
\set ON_ERROR_STOP on
\set QUIET on
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
  {"c":"_raiz","id":"raiz","v":{"version":12,"meta":{"espacio":"ensayo","espacioId":"prueba"}}},
  {"c":"locales","id":"ensayo-loc-1","v":{"id":"ensayo-loc-1","municipioId":"ensayo-mun-1"}},
  {"c":"revisiones","id":"ensayo-camp-2026|ensayo-loc-1","v":{"campanaId":"ensayo-camp-2026","localId":"ensayo-loc-1","campo":"terminado","categorizacion":"pendiente"}}]') = 1; end $$;
do $$ begin assert public.ulit_censo_aplicar('ensayo-prueba', 1, 'Clasificación', '[
  {"c":"revisiones","id":"ensayo-camp-2026|ensayo-loc-1","v":{"campanaId":"ensayo-camp-2026","localId":"ensayo-loc-1","campo":"terminado","categorizacion":"revisado"}}]') = 2; end $$;
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 1, 'Pestaña antigua', '[{"c":"locales","id":"ensayo-loc-1","v":null}]')$q$, '40001');
do $$ begin assert (public.ulit_censo_leer('ensayo-prueba') -> 'entidades' -> 'revisiones' -> 'ensayo-camp-2026|ensayo-loc-1' ->> 'categorizacion') = 'revisado'; end $$;
do $$ begin assert (public.ulit_censo_leer('ensayo-prueba') ->> 'version')::int = 2; end $$;

\echo '4 · Todo o nada: un cambio inválido no deja nada aplicado'
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 2, 'Mezcla', '[{"c":"locales","id":"ensayo-loc-2","v":{"id":"ensayo-loc-2"}},{"c":"tabla_inventada","id":"x","v":{}}]')$q$, '22023');
select pg_temp.falla($q$select public.ulit_censo_aplicar('ensayo-prueba', 2, 'Raíz ajena', '[{"c":"_raiz","id":"raiz","v":{"meta":{"espacio":"real"}}}]')$q$, '22023');
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
\echo 'TODAS LAS PRUEBAS SUPERADAS'
