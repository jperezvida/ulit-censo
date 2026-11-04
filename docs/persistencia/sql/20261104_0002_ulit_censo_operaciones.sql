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
-- guardado antes), se rechaza con SQLSTATE PT409 (HTTP 409; no se usa 40001 porque PostgREST reintenta esas transacciones) y el cliente debe recargar: nada se sobrescribe.
--
-- Autorización en servidor (no se fía de lo que diga el cliente):
--  * coordinación y administración: cualquier colección (cargas estructurales, importación, deshacer);
--  * revisión: solo trabajo de oficina y conciliación (locales, negocios, ocupaciones, observaciones,
--    vínculos, revisiones, digital, clasificaciones, franquicias, coberturas);
--  * investigación: solo trabajo de campo (observaciones, ocupaciones, negocios, revisiones, coberturas);
--  * lectura: nada;
--  * fuera de coordinación nadie toca: municipios, calles, campañas, itinerarios, importaciones,
--    registros, personas, planificación, estado de oficina de los itinerarios ni la raíz (salvo el contador
--    `secuencia`, `generado` y `colaSync`, que cambian con cualquier operación);
--  * fuera de coordinación nadie toca nada de una campaña HISTÓRICA (antes o después del cambio), salvo
--    prolongar `hastaCampanaId` de una ocupación histórica («Sin cambios» de Campo).

-- Campaña a la que pertenece una entidad (para proteger el histórico). Busca primero en los cambios en curso.
create function ulit_censo.valor_vigente(p_espacio text, p_c text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; hay boolean;
begin
  select true, x.v into hay, v from pg_temp._c x where x.c = p_c and x.id = p_id;
  if hay then return v; end if;
  select e.valor into v from ulit_censo.entidad e where e.espacio_id = p_espacio and e.coleccion = p_c and e.id = p_id;
  return v;
end;
$$;

create function ulit_censo.campana_de(p_espacio text, p_c text, p_v jsonb) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_v is null then return null; end if;
  if p_c = 'ocupaciones' then return p_v ->> 'desdeCampanaId'; end if;
  if p_c = 'registros' then
    return ulit_censo.valor_vigente(p_espacio, 'importaciones', p_v ->> 'importacionId') ->> 'campanaId';
  end if;
  if p_c = 'vinculos' and p_v -> 'origen' ->> 'tipo' = 'registro' then
    r := ulit_censo.valor_vigente(p_espacio, 'registros', p_v -> 'origen' ->> 'id');
    return ulit_censo.valor_vigente(p_espacio, 'importaciones', r ->> 'importacionId') ->> 'campanaId';
  end if;
  return p_v ->> 'campanaId';
end;
$$;

create function ulit_censo.es_historica(p_espacio text, p_campana text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if p_campana is null then return false; end if;
  -- La campaña tal como estaba guardada: una campaña histórica no deja de serlo por cambiarla en el mismo envío.
  select e.valor into v from ulit_censo.entidad e where e.espacio_id = p_espacio and e.coleccion = 'campanas' and e.id = p_campana;
  if v is null then v := ulit_censo.valor_vigente(p_espacio, 'campanas', p_campana); end if;
  return coalesce(v ->> 'tipo' = 'historico-importado', false);
end;
$$;

create function ulit_censo.colecciones_de_rol(p_rol text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_rol
    when 'revisor' then array['locales', 'negocios', 'ocupaciones', 'observaciones', 'vinculos', 'revisiones', 'digital', 'clasificaciones', 'franquicias', 'coberturas']
    when 'investigador' then array['observaciones', 'ocupaciones', 'negocios', 'revisiones', 'coberturas']
    else array[]::text[] end;
$$;

-- Núcleo común de la escritura (lo usan `ulit_censo_aplicar` y `ulit_censo_lote_aplicar`).
create function ulit_censo.aplicar_interno(m ulit_censo.miembro, p_espacio text, p_version_esperada bigint, p_etiqueta text, p_cambios jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  e ulit_censo.espacio; v_op bigint; v_nueva bigint; v_n integer; v_mal text; v_coord boolean;
  v_campo constant text[] := array['secuencia', 'generado', 'colaSync'];
  v_por_id constant text[] := array['municipios', 'calles', 'campanas', 'itinerarios', 'locales', 'negocios', 'ocupaciones', 'observaciones', 'registros', 'vinculos', 'importaciones', 'personas'];
begin
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
    raise exception 'ULIT Censo: conflicto de versión (esperada %, actual %)', p_version_esperada, e.version using errcode = 'PT409';
  end if;

  drop table if exists pg_temp._c;
  create temporary table _c on commit drop as
    select x ->> 'c' as c, x ->> 'id' as id, x -> 'v' as v_bruto, nullif(x -> 'v', 'null'::jsonb) as v, en.valor as anterior
      from jsonb_array_elements(p_cambios) as t(x)
      left join ulit_censo.entidad en on en.espacio_id = p_espacio and en.coleccion = x ->> 'c' and en.id = x ->> 'id';

  -- Validación del formato (todo el envío se rechaza ante el primer problema).
  select format('%s/%s', c, id) into v_mal from pg_temp._c
   where not coalesce(ulit_censo.coleccion_valida(c), false) or coalesce(id, '') = '' or length(id) > 400
      or (v_bruto is not null and jsonb_typeof(v_bruto) not in ('object', 'null'))
      or (v is not null and octet_length(v::text) > 4194304)
      or (v is not null and c = any (v_por_id) and v ? 'id' and v ->> 'id' is distinct from id)
   limit 1;
  if v_mal is not null then raise exception 'ULIT Censo: colección o identificador no válidos (%)', v_mal using errcode = '22023'; end if;
  if (select count(*) from (select distinct c, id from pg_temp._c) d) <> v_n then
    raise exception 'ULIT Censo: entidad repetida en la misma operación' using errcode = '22023';
  end if;
  if exists (select 1 from pg_temp._c where c = '_raiz' and (id <> 'raiz' or (v is not null and v -> 'meta' ->> 'espacio' is distinct from e.tipo) or v is null)) then
    raise exception 'ULIT Censo: la raíz no corresponde a este espacio' using errcode = '22023';
  end if;

  -- Autorización por rol (servidor).
  v_coord := m.rol in ('coordinador', 'administrador');
  if not v_coord then
    select format('%s/%s', c, id) into v_mal from pg_temp._c x
     where x.c <> '_raiz' and not (x.c = any (ulit_censo.colecciones_de_rol(m.rol))) limit 1;
    if v_mal is not null then
      raise exception 'ULIT Censo: el rol % no puede modificar %', m.rol, v_mal using errcode = '42501';
    end if;
    if exists (select 1 from pg_temp._c where c = '_raiz' and (v - v_campo) is distinct from (anterior - v_campo)) then
      raise exception 'ULIT Censo: el rol % no puede modificar la configuración del espacio', m.rol using errcode = '42501';
    end if;
    select format('%s/%s', c, id) into v_mal from pg_temp._c x
     where (ulit_censo.es_historica(p_espacio, ulit_censo.campana_de(p_espacio, x.c, x.anterior))
            or ulit_censo.es_historica(p_espacio, ulit_censo.campana_de(p_espacio, x.c, x.v)))
       and not (x.c = 'ocupaciones' and x.anterior is not null and x.v is not null
                and (x.v - 'hastaCampanaId') = (x.anterior - 'hastaCampanaId'))
     limit 1;
    if v_mal is not null then
      raise exception 'ULIT Censo: el censo histórico solo lo modifica coordinación (%)', v_mal using errcode = '42501';
    end if;
  end if;

  v_nueva := e.version + 1;
  insert into ulit_censo.operacion (espacio_id, version, tipo, etiqueta, usuario_id, persona_id, n_cambios)
  values (p_espacio, v_nueva, case when e.version = 0 then 'carga-inicial' else 'cambio' end,
          left(coalesce(nullif(trim(p_etiqueta), ''), 'Cambio'), 300), auth.uid(), m.persona_id, v_n)
  returning id into v_op;
  insert into ulit_censo.entidad_historial (operacion_id, espacio_id, coleccion, id, valor_anterior, valor_nuevo)
  select v_op, p_espacio, c, id, anterior, v from pg_temp._c where anterior is distinct from v;
  delete from ulit_censo.entidad en using pg_temp._c x
   where en.espacio_id = p_espacio and en.coleccion = x.c and en.id = x.id and x.v is null;
  insert into ulit_censo.entidad (espacio_id, coleccion, id, valor, version, actualizado_por)
  select p_espacio, c, id, v, v_nueva, auth.uid() from pg_temp._c where v is not null
  on conflict (espacio_id, coleccion, id)
  do update set valor = excluded.valor, version = excluded.version, actualizado_por = excluded.actualizado_por, actualizado_en = now();
  update ulit_censo.espacio set version = v_nueva where id = p_espacio;
  drop table pg_temp._c;
  return v_nueva;
end;
$$;

create function public.ulit_censo_aplicar(p_espacio text, p_version_esperada bigint, p_etiqueta text, p_cambios jsonb)
returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  return ulit_censo.aplicar_interno(ulit_censo.exigir(p_espacio, ulit_censo.roles_escritura()), p_espacio, p_version_esperada, p_etiqueta, p_cambios);
end;
$$;

-- Envíos grandes (p. ej. la carga del censo 2025): se suben por partes y se aplican en UNA transacción.
-- Cada parte es de la persona que la sube; nadie más puede aplicarla. Las partes de más de un día se purgan.
create table ulit_censo.lote_parte (
  espacio_id text not null references ulit_censo.espacio (id) on delete cascade,
  lote uuid not null,
  usuario_id uuid not null,
  parte integer not null check (parte between 0 and 999),
  cambios jsonb not null check (jsonb_typeof(cambios) = 'array'),
  creado_en timestamptz not null default now(),
  primary key (lote, parte)
);
revoke all on table ulit_censo.lote_parte from public, anon, authenticated, service_role;
alter table ulit_censo.lote_parte enable row level security;

create function public.ulit_censo_lote_subir(p_espacio text, p_lote uuid, p_parte integer, p_cambios jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
begin
  perform ulit_censo.exigir(p_espacio, ulit_censo.roles_escritura());
  if jsonb_typeof(p_cambios) is distinct from 'array' or jsonb_array_length(p_cambios) > 5000 then
    raise exception 'ULIT Censo: parte de lote no válida' using errcode = '22023';
  end if;
  delete from ulit_censo.lote_parte where creado_en < now() - interval '1 day';
  if exists (select 1 from ulit_censo.lote_parte where lote = p_lote and (usuario_id <> auth.uid() or espacio_id <> p_espacio)) then
    raise exception 'ULIT Censo: lote ajeno' using errcode = '42501';
  end if;
  insert into ulit_censo.lote_parte (espacio_id, lote, usuario_id, parte, cambios) values (p_espacio, p_lote, auth.uid(), p_parte, p_cambios);
  return jsonb_array_length(p_cambios);
end;
$$;

create function public.ulit_censo_lote_aplicar(p_espacio text, p_lote uuid, p_partes integer, p_version_esperada bigint, p_etiqueta text)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare m ulit_censo.miembro; v_todo jsonb; v_n integer; v bigint;
begin
  m := ulit_censo.exigir(p_espacio, ulit_censo.roles_escritura());
  select count(*), coalesce(jsonb_agg(x order by p.parte, o.n), '[]'::jsonb) into v_n, v_todo
    from ulit_censo.lote_parte p, jsonb_array_elements(p.cambios) with ordinality as o(x, n)
   where p.lote = p_lote and p.espacio_id = p_espacio and p.usuario_id = auth.uid();
  if (select count(*) from ulit_censo.lote_parte where lote = p_lote and espacio_id = p_espacio and usuario_id = auth.uid()) <> p_partes then
    raise exception 'ULIT Censo: el lote no está completo' using errcode = '22023';
  end if;
  v := ulit_censo.aplicar_interno(m, p_espacio, p_version_esperada, p_etiqueta, v_todo);
  delete from ulit_censo.lote_parte where lote = p_lote;
  return v;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ulit_censo.valor_vigente(text, text, text)', 'ulit_censo.campana_de(text, text, jsonb)', 'ulit_censo.es_historica(text, text)',
    'ulit_censo.colecciones_de_rol(text)', 'ulit_censo.aplicar_interno(ulit_censo.miembro, text, bigint, text, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
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
    raise exception 'ULIT Censo: conflicto de versión (esperada %, actual %)', p_version_esperada, e.version using errcode = 'PT409';
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
    'public.ulit_censo_lote_subir(text, uuid, integer, jsonb)',
    'public.ulit_censo_lote_aplicar(text, uuid, integer, bigint, text)',
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
