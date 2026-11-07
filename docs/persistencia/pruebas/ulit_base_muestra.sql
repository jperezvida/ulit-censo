-- SOLO PRUEBAS LOCALES: objetos de muestra de ULIT base en el Supabase LOCAL (no existen en las migraciones de ULIT base).
create table if not exists public.perfiles (id uuid primary key references auth.users(id) on delete cascade, rol text);
alter table public.perfiles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'perfiles' and policyname = 'perfiles_propios') then
    create policy perfiles_propios on public.perfiles for select to authenticated using (id = auth.uid());
  end if;
end $$;
create or replace function public.es_admin_base_catedra() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin') $$;
