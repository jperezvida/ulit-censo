-- ULIT Censo · Migración PROPUESTA 0002 · Operaciones transaccionales (únicas vías de acceso).
-- NO APLICADA. Requiere autorización expresa.
--
-- Todas son `security definer` con `search_path` vacío y nombres calificados. Se crean en `public` con el
-- prefijo `ulit_censo_` (mismo patrón que `ulit_go_*`) para no tener que exponer el esquema privado en la
-- API. Solo las ejecuta `authenticated`; `anon`, `public` y `service_role` no tienen permiso.
-- Cada función comprueba la pertenencia en `ulit_censo.miembro`: estar autenticado en ULIT base no basta.

begin;

-- ───────────── Pertenencia ─────────────

create function ulit_censo.exigir(p_espacio text, p_roles text[])
returns ulit_censo.miembro
language plpgsql stable security definer set search_path = '' as $$
declare m ulit_censo.miembro;
begin
  if auth.uid() is null then
    raise exception 'ULIT Censo: sesión no iniciada' using errcode = '28000';
  end if;
  select * into m from ulit_censo.miembro
   where espacio_id = p_espacio and usuario_id = auth.uid() and baja_en is null;
  if not found or not (m.rol = any (p_roles)) then
    raise exception 'ULIT Censo: sin permiso en este espacio' using errcode = '42501';
  end if;
  return m;
end;
$$;
revoke all on function ulit_censo.exigir(text, text[]) from public, anon, authenticated, service_role;

-- Roles: lector (solo lee) < investigador < revisor < coordinador < administrador (gestiona miembros y restaura).
create function ulit_censo.roles_escritura() returns text[] language sql immutable set search_path = '' as $$
  select array['investigador', 'revisor', 'coordinador', 'administrador'];
$$;
create function ulit_censo.roles_lectura() returns text[] language sql immutable set search_path = '' as $$
  select array['lector', 'investigador', 'revisor', 'coordinador', 'administrador'];
$$;
revoke all on function ulit_censo.roles_escritura() from public, anon, authenticated, service_role;
revoke all on function ulit_censo.roles_lectura() from public, anon, authenticated, service_role;

-- Contenido completo de un espacio: { coleccion: { id: valor } } (mismo formato que BaseDatos).
create function ulit_censo.contenido(p_espacio text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.coleccion, c.items), '{}'::jsonb)
    from (select e.coleccion, jsonb_object_agg(e.id, e.valor) as items
            from ulit_censo.entidad e where e.espacio_id = p_espacio group by e.coleccion) c;
$$;
revoke all on function ulit_censo.contenido(text) from public, anon, authenticated, service_role;

-- ───────────── Lectura ─────────────

create function public.ulit_censo_mis_espacios()
returns table (espacio_id text, tipo text, nombre text, version bigint, escritura_habilitada boolean, rol text, persona_id text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.tipo, e.nombre, e.version, e.escritura_habilitada, m.rol, m.persona_id
    from ulit_censo.miembro m join ulit_censo.espacio e on e.id = m.espacio_id
   where m.usuario_id = auth.uid() and m.baja_en is null
   order by e.tipo, e.nombre;
$$;

create function public.ulit_censo_leer(p_espacio text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m ulit_censo.miembro; e ulit_censo.espacio;
begin
  m := ulit_censo.exigir(p_espacio, ulit_censo.roles_lectura());
  select * into e from ulit_censo.espacio where id = p_espacio;
  return jsonb_build_object('espacioId', e.id, 'tipo', e.tipo, 'version', e.version,
    'escrituraHabilitada', e.escritura_habilitada, 'rol', m.rol, 'personaId', m.persona_id,
    'entidades', ulit_censo.contenido(p_espacio));
end;
$$;

create function public.ulit_censo_historial(p_espacio text, p_limite integer default 50)
returns table (version bigint, tipo text, etiqueta text, persona_id text, n_cambios integer, en timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ulit_censo.exigir(p_espacio, ulit_censo.roles_lectura());
  return query select o.version, o.tipo, o.etiqueta, o.persona_id, o.n_cambios, o.en
    from ulit_censo.operacion o where o.espacio_id = p_espacio
   order by o.version desc limit least(greatest(p_limite, 1), 500);
end;
$$;

-- ───────────── Escritura transaccional con control de concurrencia ─────────────
-- p_cambios: [{ "c": coleccion, "id": id, "v": valor | null }]  (null = eliminar la entidad)
-- Se aplica TODO o NADA. Si la versión del espacio no es la esperada (otra pestaña u otra persona ha
-- guardado antes), se rechaza con SQLSTATE 40001 y el cliente debe recargar: nada se sobrescribe.

create function public.ulit_censo_aplicar(p_espacio text, p_version_esperada bigint, p_etiqueta text, p_cambios jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  m ulit_censo.miembro; e ulit_censo.espacio; v_op bigint; v_nueva bigint; v_n integer; x jsonb;
begin
  m := ulit_censo.exigir(p_espacio, ulit_censo.roles_escritura());
  if jsonb_typeof(p_cambios) is distinct from 'array' then
    raise exception 'ULIT Censo: cambios con formato no válido' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_cambios);
  if v_n = 0 or v_n > 20000 then
    raise exception 'ULIT Censo: número de cambios fuera de límites (%)', v_n using errcode = '22023';
  end if;
  select * into e from ulit_censo.espacio where id = p_espacio for update;
  if e.tipo = 'real' and not e.escritura_habilitada then
    raise exception 'ULIT Censo: la escritura del espacio real no está habilitada' using errcode = '42501';
  end if;
  if e.version <> p_version_esperada then
    raise exception 'ULIT Censo: conflicto de versión (esperada %, actual %)', p_version_esperada, e.version using errcode = '40001';
  end if;
  for x in select * from jsonb_array_elements(p_cambios) loop
    if not ulit_censo.coleccion_valida(x ->> 'c') or coalesce(x ->> 'id', '') = '' then
      raise exception 'ULIT Censo: colección o identificador no válidos' using errcode = '22023';
    end if;
    if x ->> 'c' = '_raiz' and (x ->> 'id' <> 'raiz' or (x -> 'v') -> 'meta' ->> 'espacio' is distinct from e.tipo) then
      raise exception 'ULIT Censo: la raíz no corresponde a este espacio' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from (select distinct x2 ->> 'c', x2 ->> 'id' from jsonb_array_elements(p_cambios) x2) d) <> v_n then
    raise exception 'ULIT Censo: entidad repetida en la misma operación' using errcode = '22023';
  end if;

  v_nueva := e.version + 1;
  insert into ulit_censo.operacion (espacio_id, version, tipo, etiqueta, usuario_id, persona_id, n_cambios)
  values (p_espacio, v_nueva, case when e.version = 0 then 'carga-inicial' else 'cambio' end,
          left(coalesce(nullif(trim(p_etiqueta), ''), 'Cambio'), 300), auth.uid(), m.persona_id, v_n)
  returning id into v_op;

  insert into ulit_censo.entidad_historial (operacion_id, espacio_id, coleccion, id, valor_anterior, valor_nuevo)
  select v_op, p_espacio, c.x ->> 'c', c.x ->> 'id', en.valor, nullif(c.x -> 'v', 'null'::jsonb)
    from jsonb_array_elements(p_cambios) as c(x)
    left join ulit_censo.entidad en on en.espacio_id = p_espacio and en.coleccion = c.x ->> 'c' and en.id = c.x ->> 'id';

  delete from ulit_censo.entidad en using jsonb_array_elements(p_cambios) as c(x)
   where en.espacio_id = p_espacio and en.coleccion = c.x ->> 'c' and en.id = c.x ->> 'id'
     and jsonb_typeof(c.x -> 'v') is distinct from 'object';

  insert into ulit_censo.entidad (espacio_id, coleccion, id, valor, version, actualizado_por)
  select p_espacio, c.x ->> 'c', c.x ->> 'id', c.x -> 'v', v_nueva, auth.uid()
    from jsonb_array_elements(p_cambios) as c(x)
   where jsonb_typeof(c.x -> 'v') = 'object'
  on conflict (espacio_id, coleccion, id)
  do update set valor = excluded.valor, version = excluded.version, actualizado_por = excluded.actualizado_por, actualizado_en = now();

  update ulit_censo.espacio set version = v_nueva where id = p_espacio;
  return v_nueva;
end;
$$;

-- ───────────── Copias de seguridad y restauración propias ─────────────

create function public.ulit_censo_crear_copia(p_espacio text, p_motivo text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare e ulit_censo.espacio; v_c jsonb; v_id uuid; v_txt text;
begin
  perform ulit_censo.exigir(p_espacio, array['coordinador', 'administrador']);
  select * into e from ulit_censo.espacio where id = p_espacio for share;
  v_c := jsonb_build_object('espacioId', e.id, 'tipo', e.tipo, 'version', e.version, 'entidades', ulit_censo.contenido(p_espacio));
  v_txt := v_c::text;
  insert into ulit_censo.copia (espacio_id, version, motivo, contenido, sha256, bytes, creada_por)
  values (p_espacio, e.version, left(coalesce(nullif(trim(p_motivo), ''), 'Copia manual'), 300), v_c,
          encode(sha256(convert_to(v_txt, 'UTF8')), 'hex'), octet_length(v_txt), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create function public.ulit_censo_listar_copias(p_espacio text)
returns table (id uuid, version bigint, motivo text, sha256 text, bytes integer, creada_en timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform ulit_censo.exigir(p_espacio, array['coordinador', 'administrador']);
  return query select c.id, c.version, c.motivo, c.sha256, c.bytes, c.creada_en
    from ulit_censo.copia c where c.espacio_id = p_espacio order by c.creada_en desc;
end;
$$;

-- Exportación: el contenido de una copia, para descargarla y archivarla fuera de Supabase.
create function public.ulit_censo_descargar_copia(p_espacio text, p_copia uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform ulit_censo.exigir(p_espacio, array['coordinador', 'administrador']);
  select jsonb_build_object('copia', c.id, 'sha256', c.sha256, 'creadaEn', c.creada_en, 'motivo', c.motivo, 'contenido', c.contenido)
    into v from ulit_censo.copia c where c.id = p_copia and c.espacio_id = p_espacio;
  if v is null then raise exception 'ULIT Censo: copia inexistente en este espacio' using errcode = 'P0002'; end if;
  return v;
end;
$$;

-- Restaurar = una operación NUEVA que deja el estado igual al de la copia. Antes se crea otra copia
-- automática del estado actual; nada se pierde y todo queda en el historial.
create function public.ulit_censo_restaurar_copia(p_espacio text, p_copia uuid, p_version_esperada bigint, p_motivo text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare m ulit_censo.miembro; e ulit_censo.espacio; c ulit_censo.copia; v_op bigint; v_nueva bigint; v_n integer;
begin
  m := ulit_censo.exigir(p_espacio, array['administrador']);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'ULIT Censo: indique el motivo de la restauración' using errcode = '22023'; end if;
  select * into e from ulit_censo.espacio where id = p_espacio for update;
  if e.tipo = 'real' and not e.escritura_habilitada then
    raise exception 'ULIT Censo: la escritura del espacio real no está habilitada' using errcode = '42501';
  end if;
  if e.version <> p_version_esperada then
    raise exception 'ULIT Censo: conflicto de versión (esperada %, actual %)', p_version_esperada, e.version using errcode = '40001';
  end if;
  select * into c from ulit_censo.copia where id = p_copia and espacio_id = p_espacio;
  if not found then raise exception 'ULIT Censo: copia inexistente en este espacio' using errcode = 'P0002'; end if;
  if encode(sha256(convert_to(c.contenido::text, 'UTF8')), 'hex') <> c.sha256 then
    raise exception 'ULIT Censo: la copia no supera la comprobación de integridad' using errcode = 'XX001';
  end if;
  perform public.ulit_censo_crear_copia(p_espacio, 'Automática antes de restaurar: ' || left(p_motivo, 200));

  drop table if exists pg_temp._destino, pg_temp._dif;
  create temporary table _destino on commit drop as
    select k.key as coleccion, i.key as id, i.value as valor
      from jsonb_each(c.contenido -> 'entidades') k, jsonb_each(k.value) i;
  create temporary table _dif on commit drop as
    select coalesce(d.coleccion, en.coleccion) as coleccion, coalesce(d.id, en.id) as id, en.valor as anterior, d.valor as nuevo
      from pg_temp._destino d full join (select * from ulit_censo.entidad where espacio_id = p_espacio) en
        on en.coleccion = d.coleccion and en.id = d.id
     where en.valor is distinct from d.valor;
  select count(*) into v_n from pg_temp._dif;

  v_nueva := e.version + 1;
  insert into ulit_censo.operacion (espacio_id, version, tipo, etiqueta, usuario_id, persona_id, n_cambios)
  values (p_espacio, v_nueva, 'restauracion', left('Restauración de la copia ' || c.id || ' (v' || c.version || '): ' || p_motivo, 300), auth.uid(), m.persona_id, v_n)
  returning id into v_op;
  insert into ulit_censo.entidad_historial (operacion_id, espacio_id, coleccion, id, valor_anterior, valor_nuevo)
  select v_op, p_espacio, coleccion, id, anterior, nuevo from pg_temp._dif;
  delete from ulit_censo.entidad en using pg_temp._dif d where en.espacio_id = p_espacio and en.coleccion = d.coleccion and en.id = d.id and d.nuevo is null;
  insert into ulit_censo.entidad (espacio_id, coleccion, id, valor, version, actualizado_por)
  select p_espacio, coleccion, id, nuevo, v_nueva, auth.uid() from pg_temp._dif where nuevo is not null
  on conflict (espacio_id, coleccion, id)
  do update set valor = excluded.valor, version = excluded.version, actualizado_por = excluded.actualizado_por, actualizado_en = now();
  update ulit_censo.espacio set version = v_nueva where id = p_espacio;
  return v_nueva;
end;
$$;

-- ───────────── Gestión de miembros (solo administración del espacio) ─────────────
-- Dar de alta exige que la cuenta YA exista en Supabase Auth (no se crean cuentas ni se cambia la
-- configuración de Auth del proyecto compartido). Estar en ULIT base no da acceso por sí solo.

create function public.ulit_censo_alta_miembro(p_espacio text, p_email text, p_rol text, p_persona_id text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_usuario uuid;
begin
  perform ulit_censo.exigir(p_espacio, array['administrador']);
  select u.id into v_usuario from auth.users u where lower(u.email) = lower(trim(p_email));
  if v_usuario is null then raise exception 'ULIT Censo: no existe una cuenta con ese correo' using errcode = 'P0002'; end if;
  insert into ulit_censo.miembro (espacio_id, usuario_id, rol, persona_id, alta_por)
  values (p_espacio, v_usuario, p_rol, p_persona_id, auth.uid())
  on conflict (espacio_id, usuario_id)
  do update set rol = excluded.rol, persona_id = excluded.persona_id, alta_por = excluded.alta_por, alta_en = now(), baja_en = null;
  return v_usuario;
end;
$$;

create function public.ulit_censo_baja_miembro(p_espacio text, p_usuario uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform ulit_censo.exigir(p_espacio, array['administrador']);
  if p_usuario = auth.uid() then raise exception 'ULIT Censo: no puede darse de baja a sí mismo' using errcode = '22023'; end if;
  update ulit_censo.miembro set baja_en = now() where espacio_id = p_espacio and usuario_id = p_usuario and baja_en is null;
end;
$$;

-- ───────────── Permisos de ejecución ─────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.ulit_censo_mis_espacios()',
    'public.ulit_censo_leer(text)',
    'public.ulit_censo_historial(text, integer)',
    'public.ulit_censo_aplicar(text, bigint, text, jsonb)',
    'public.ulit_censo_crear_copia(text, text)',
    'public.ulit_censo_listar_copias(text)',
    'public.ulit_censo_descargar_copia(text, uuid)',
    'public.ulit_censo_restaurar_copia(text, uuid, bigint, text)',
    'public.ulit_censo_alta_miembro(text, text, text, text)',
    'public.ulit_censo_baja_miembro(text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
revoke all on function ulit_censo.contenido(text) from public, anon, authenticated, service_role;

commit;
