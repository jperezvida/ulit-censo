-- SOLO PARA PRUEBAS LOCALES. Emula lo mínimo de Supabase y una muestra de ULIT base (sin datos reales).
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Muestra de ULIT base: perfiles con rol admin, una política y una función (no deben cambiar).
create table public.perfiles (id uuid primary key references auth.users(id), rol text);
alter table public.perfiles enable row level security;
create policy perfiles_propios on public.perfiles for select to authenticated using (id = auth.uid());
grant select on public.perfiles to authenticated;
create function public.es_admin_base_catedra() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin') $$;
grant execute on function public.es_admin_base_catedra() to authenticated;
-- Cuentas sintéticas: admin de ULIT base (sin acceso a ULIT Censo), coordinadora y lectora de ULIT Censo.
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'admin.base@ejemplo.invalid'),
  ('00000000-0000-0000-0000-00000000000c', 'coordinadora@ejemplo.invalid'),
  ('00000000-0000-0000-0000-00000000000d', 'lectora@ejemplo.invalid'),
  ('00000000-0000-0000-0000-00000000000e', 'revisora@ejemplo.invalid'),
  ('00000000-0000-0000-0000-00000000000f', 'investigadora@ejemplo.invalid');
insert into public.perfiles values ('00000000-0000-0000-0000-00000000000a', 'admin');
