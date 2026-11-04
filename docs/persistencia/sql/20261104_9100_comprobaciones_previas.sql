-- ULIT Censo · Comprobaciones PREVIAS en el Supabase compartido. Solo lectura (no modifica nada).
-- Ejecutar y guardar el resultado antes de cualquier migración; repetir 9101 después para comparar.
-- ANTES de 0001/0002 hace falta además un RESPALDO EXTERNO recuperable de todo el proyecto (9200): las
-- copias internas `ulit_censo.copia` solo cubren ULIT Censo, nunca ULIT base.

-- 1. El esquema y las funciones de ULIT Censo no existen aún (deben salir 0 filas).
select nspname from pg_namespace where nspname = 'ulit_censo';
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname like 'ulit\_censo\_%';
-- 2. Rol con el que se aplicarán las migraciones y sus atributos (propietario de las funciones).
select current_user, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = current_user;
-- 3. Esquemas expuestos por la API: `ulit_censo` NO debe estar ni añadirse.
select rolname, rolconfig from pg_roles where rolname = 'authenticator';
-- 4. Funciones disponibles que usa ULIT Censo.
select to_regprocedure('auth.uid()') is not null as auth_uid, to_regprocedure('gen_random_uuid()') is not null as uuid, to_regprocedure('sha256(bytea)') is not null as sha256;
-- 5. Huella DETERMINISTA de ULIT base: ejecutar `20261104_9101_huella_ulit_base.sql` y guardar el resultado
--    (número de elementos y md5). Repetirla después de 0001/0002: debe ser idéntica.
-- 6. Espacio ocupado por la base (margen frente al cupo del plan).
select pg_size_pretty(pg_database_size(current_database())) as tamano_base;
