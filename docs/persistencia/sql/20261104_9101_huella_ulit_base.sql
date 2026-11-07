-- ULIT Censo · HUELLA DETERMINISTA de todo lo que NO es de ULIT Censo (solo lectura).
-- Se ejecuta antes y después de 0001/0002 (y tras 9000): las dos huellas deben ser IDÉNTICAS.
-- Determinista: cada elemento se convierte en texto y se ordena por ese texto completo (también los
-- privilegios dentro de cada lista de permisos), sin depender del orden físico del catálogo.
\set ON_ERROR_STOP on
begin transaction read only;  -- garantía: este archivo no puede modificar nada
with elementos as (
  select format('pol|%s.%s|%s|%s|%s|%s|%s', schemaname, tablename, policyname, permissive, array_to_string(array(select unnest(roles) order by 1), ','), coalesce(qual, ''), coalesce(with_check, '')) as x
    from pg_policies where schemaname <> 'ulit_censo'
  union all
  select format('fn|%s|%s|%s|%s', p.oid::regprocedure, md5(p.prosrc), p.prosecdef, coalesce(array_to_string(array(select a::text from unnest(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) a order by 1), ','), ''))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema', 'ulit_censo') and p.proname not like 'ulit\_censo\_%'
  union all
  select format('rel|%s.%s|%s|%s|%s', n.nspname, c.relname, c.relkind, c.relrowsecurity, coalesce(array_to_string(array(select a::text from unnest(coalesce(c.relacl, acldefault((case c.relkind when 'S' then 's' else 'r' end)::"char", c.relowner))) a order by 1), ','), ''))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'ulit_censo') and c.relkind in ('r', 'v', 'm', 'p', 'f', 'S')
  union all
  select format('col|%s.%s.%s|%s|%s', table_schema, table_name, column_name, data_type, is_nullable)
    from information_schema.columns where table_schema not in ('pg_catalog', 'information_schema', 'ulit_censo')
  union all
  select format('nsp|%s|%s', nspname, coalesce(array_to_string(array(select a::text from unnest(coalesce(nspacl, acldefault('n'::"char", nspowner))) a order by 1), ','), ''))
    from pg_namespace where nspname not in ('ulit_censo') and nspname not like 'pg\_temp\_%' and nspname not like 'pg\_toast\_temp\_%'
)
select count(*) as elementos, md5(string_agg(x, E'\n' order by x)) as huella_ulit_base from elementos;
rollback;
