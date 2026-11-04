-- ULIT Censo · Comprobaciones PREVIAS en el Supabase compartido. Solo lectura (no modifica nada).
-- Ejecutar y guardar el resultado antes de cualquier migración; repetir 9101 después para comparar.

-- 1. El esquema y las funciones de ULIT Censo no existen aún (deben salir 0 filas).
select nspname from pg_namespace where nspname = 'ulit_censo';
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname like 'ulit\_censo\_%';
-- 2. Rol con el que se aplicarán las migraciones y sus atributos (propietario de las funciones).
select current_user, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = current_user;
-- 3. Esquemas expuestos por la API: `ulit_censo` NO debe estar ni añadirse.
select rolname, rolconfig from pg_roles where rolname = 'authenticator';
-- 4. Funciones disponibles que usa ULIT Censo.
select to_regprocedure('auth.uid()') is not null as auth_uid, to_regprocedure('gen_random_uuid()') is not null as uuid, to_regprocedure('sha256(bytea)') is not null as sha256;
-- 5. Huella de los objetos de ULIT base (para comparar después: debe ser idéntica).
select n.nspname, count(*) filter (where c.relkind = 'r') as tablas, count(*) filter (where c.relkind = 'v') as vistas
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'ulit_censo') group by 1 order by 1;
select md5(string_agg(format('%s.%s|%s|%s', schemaname, tablename, policyname, coalesce(qual, '') || coalesce(with_check, '')), ',' order by schemaname, tablename, policyname)) as huella_politicas from pg_policies;
select md5(string_agg(p.oid::regprocedure::text || '|' || md5(p.prosrc) || '|' || coalesce(array_to_string(p.proacl, ','), ''), ',' order by p.oid::regprocedure::text)) as huella_funciones
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog', 'information_schema', 'ulit_censo') and p.proname not like 'ulit\_censo\_%';
select md5(string_agg(format('%s|%s|%s|%s', table_schema, table_name, grantee, privilege_type), ',' order by 1)) as huella_permisos
  from information_schema.role_table_grants where table_schema not in ('pg_catalog', 'information_schema', 'ulit_censo');
-- 6. Espacio ocupado por la base (margen frente al cupo del plan).
select pg_size_pretty(pg_database_size(current_database())) as tamano_base;
