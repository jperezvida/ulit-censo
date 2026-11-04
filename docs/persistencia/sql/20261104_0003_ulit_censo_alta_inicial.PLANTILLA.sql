-- ULIT Censo · PLANTILLA de alta inicial (NO migración). Solo tras autorización expresa.
-- Sustituir <...>. La cuenta Auth debe existir (una sola coincidencia), o se revierte TODO.
-- Este alta es SOLO para ensayo sintético, no crea el espacio de datos reales.
begin;
do $$
declare v_usuario uuid;
begin
  select id into strict v_usuario from auth.users
    where lower(email) = lower(trim('<correo-administradora>'));
  if '<persona-id-ULIT>' !~ '^ensayo-p-[a-z0-9-]+$' then
    raise exception 'ULIT Censo: persona_id debe empezar por ensayo-p- y ser válido';
  end if;
  insert into ulit_censo.espacio (id, tipo, nombre, escritura_habilitada, creado_por)
  values ('ensayo-<identificador>', 'ensayo', 'Ensayo ULIT Censo (sintético)', true, v_usuario);
  insert into ulit_censo.miembro (espacio_id, usuario_id, rol, persona_id, alta_por)
  values ('ensayo-<identificador>', v_usuario, 'administrador', '<persona-id-ULIT>', v_usuario);
exception
  when no_data_found then
    raise exception 'ULIT Censo: no existe la cuenta Auth indicada';
  when too_many_rows then
    raise exception 'ULIT Censo: existen varias cuentas Auth con ese correo';
end;
$$;
commit;
