-- ULIT Censo · PLANTILLA (no es una migración) · Alta del espacio de ensayo y de su primera administradora.
-- Se ejecuta UNA vez, a mano, en el editor SQL, solo tras autorización expresa y después de 0001 y 0002.
-- Sustituir los marcadores <...>. La cuenta debe existir ya en Supabase Auth (no se crea aquí).
-- El espacio REAL no se da de alta en esta fase.

begin;
insert into ulit_censo.espacio (id, tipo, nombre, escritura_habilitada, creado_por)
values ('ensayo-<identificador>', 'ensayo', 'Ensayo ULIT Censo (sintético)', true,
        (select id from auth.users where lower(email) = lower('<correo-administradora>')));
insert into ulit_censo.miembro (espacio_id, usuario_id, rol, persona_id, alta_por)
select 'ensayo-<identificador>', u.id, 'administrador', '<persona-id-ULIT>', u.id
  from auth.users u where lower(u.email) = lower('<correo-administradora>');
-- Debe insertar exactamente 1 fila en cada tabla; si no, ROLLBACK.
commit;
