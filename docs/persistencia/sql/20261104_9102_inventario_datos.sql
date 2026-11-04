-- ULIT Censo · INVENTARIO de objetos y datos para validar un respaldo (SOLO LECTURA; ejecutar con psql).
-- Esquemas de aplicación (todo lo que no gestiona la plataforma Supabase) + datos de `auth` y `storage`
-- (cuentas y metadatos de archivos). Se ejecuta en el origen y en la base restaurada: deben coincidir.
-- Solo imprime nombres, recuentos y huellas md5: nunca contenido.
\set ON_ERROR_STOP on
begin transaction read only;
\set gestionados '''auth'',''storage'',''realtime'',''_realtime'',''extensions'',''graphql'',''graphql_public'',''net'',''pgbouncer'',''supabase_functions'',''vault'',''cron'',''pgsodium'',''pgsodium_masks'',''supabase_migrations'',''_analytics'',''information_schema'''
-- 1. Objetos de los esquemas de aplicación (funciones con su código y permisos, políticas, relaciones, columnas)
select 'objeto|' || x from (
  select format('fn|%s|%s|%s', p.oid::regprocedure, md5(p.prosrc), coalesce(array_to_string(array(select a::text from unnest(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a order by 1), ','), '')) x
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname !~ '^pg_' and s.nspname not in (:gestionados)
  union all select format('pol|%s.%s|%s|%s|%s', schemaname, tablename, policyname, coalesce(qual, ''), coalesce(with_check, '')) from pg_policies where schemaname not in (:gestionados)
  union all select format('rel|%s.%s|%s|%s', s.nspname, c.relname, c.relkind, coalesce(array_to_string(array(select a::text from unnest(coalesce(c.relacl, acldefault((case c.relkind when 'S' then 's' else 'r' end)::"char", c.relowner))) a order by 1), ','), ''))
    from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname !~ '^pg_' and s.nspname not in (:gestionados) and c.relkind in ('r','v','m','p','S')
  union all select format('col|%s.%s.%s|%s', table_schema, table_name, column_name, data_type) from information_schema.columns where table_schema !~ '^pg_' and table_schema not in (:gestionados)
  union all select format('defacl|%s|%s|%s|%s', pg_get_userbyid(d.defaclrole), coalesce(n.nspname, '*'), d.defaclobjtype, array_to_string(array(select a::text from unnest(d.defaclacl) a order by 1), ','))
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
   where pg_get_userbyid(d.defaclrole) !~ '^supabase_' and coalesce(n.nspname, '*') not in (:gestionados)
) o order by 1;
-- 2. Datos: filas y huella md5 del contenido de cada tabla (ordenado), también auth y storage
select format('select %L || count(*) || ''|'' || coalesce(md5(string_agg(t::text, E''\n'' order by t::text)), ''-'') from %I.%I t', 'datos|' || s.nspname || '.' || c.relname || '|', s.nspname, c.relname)
  from pg_class c join pg_namespace s on s.oid = c.relnamespace
 where c.relkind in ('r', 'p') and (s.nspname in ('auth', 'storage') or (s.nspname !~ '^pg_' and s.nspname not in (:gestionados)))
   and not (s.nspname = 'auth' and c.relname = 'schema_migrations') and not (s.nspname = 'storage' and c.relname = 'migrations')
 order by s.nspname, c.relname
\gexec
rollback;
