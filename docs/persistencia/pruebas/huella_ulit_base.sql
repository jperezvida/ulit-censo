-- Huella de todo lo que NO es de ULIT Censo (políticas, funciones con su código y permisos, permisos de tablas, columnas).
select md5(string_agg(x, ',' order by x)) from (
  select format('pol|%s.%s|%s|%s|%s', schemaname, tablename, policyname, coalesce(qual, ''), coalesce(with_check, '')) x from pg_policies where schemaname <> 'ulit_censo'
  union all select 'fn|' || p.oid::regprocedure::text || md5(p.prosrc) || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema', 'ulit_censo') and p.proname not like 'ulit\_censo\_%'
  union all select format('tb|%s.%s|%s|%s', table_schema, table_name, grantee, privilege_type) from information_schema.role_table_grants where table_schema not in ('pg_catalog', 'information_schema', 'ulit_censo')
  union all select format('col|%s.%s.%s|%s', table_schema, table_name, column_name, data_type) from information_schema.columns where table_schema not in ('pg_catalog', 'information_schema', 'ulit_censo')
) t;
