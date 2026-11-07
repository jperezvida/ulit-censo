-- ULIT Censo · RETIRADA de las migraciones 0001 y 0002 (vuelta atrás completa).
-- Solo afecta a objetos de ULIT Censo. Borra TODOS sus datos: exportar antes las copias necesarias.
begin;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'ulit\_censo\_%' loop
    execute format('drop function %s', f.firma);
  end loop;
end;
$$;
drop schema ulit_censo cascade;
commit;
