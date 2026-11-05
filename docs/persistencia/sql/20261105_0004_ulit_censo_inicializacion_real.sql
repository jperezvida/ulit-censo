-- ULIT Censo · 0004 · Inicialización real de un solo uso (SIN importar Excel).
-- Requiere autorización expresa. El DDL no habilita ningún espacio existente.
-- Activación administrativa separada: solo un espacio real vacío y durante la creación inicial.
begin;

alter table ulit_censo.espacio
  add column preparacion_habilitada boolean not null default false;
alter table ulit_censo.espacio
  add constraint preparacion_real_un_solo_uso
  check (not preparacion_habilitada or
         (tipo = 'real' and version = 0 and escritura_habilitada));

-- La UI sabe que la escritura está habilitada SOLO para preparar el municipio y su callejero.
create or replace function public.ulit_censo_leer(p_espacio text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m ulit_censo.miembro; e ulit_censo.espacio;
begin
  m := ulit_censo.exigir(p_espacio, ulit_censo.roles_lectura());
  select * into e from ulit_censo.espacio where id = p_espacio;
  return jsonb_build_object(
    'espacioId', e.id, 'tipo', e.tipo, 'version', e.version,
    'escrituraHabilitada', e.escritura_habilitada,
    'preparacionHabilitada', e.preparacion_habilitada,
    'rol', m.rol, 'personaId', m.persona_id,
    'entidades', ulit_censo.contenido(p_espacio)
  );
end;
$$;

-- Incluso invocando la RPC directamente, no se admiten entidades de censo,
-- campañas, itinerarios, observaciones ni importaciones durante esta preparación.
create function ulit_censo.guardar_solo_inicializacion()
returns trigger
language plpgsql set search_path = '' as $$
declare
  v_id text;
  v_preparando boolean;
begin
  if tg_op = 'DELETE' then v_id := old.espacio_id; else v_id := new.espacio_id; end if;
  select e.preparacion_habilitada into v_preparando
    from ulit_censo.espacio e where e.id = v_id;
  if coalesce(v_preparando,false) then
    if tg_op <> 'INSERT' then
      raise exception 'ULIT Censo: durante la preparación solo se permite el alta inicial'
        using errcode='42501';
    end if;
    if new.coleccion not in ('_raiz','personas','municipios','calles') then
      raise exception 'ULIT Censo: las campañas, Excel y locales siguen bloqueados durante la preparación'
        using errcode='42501';
    end if;
    if new.coleccion = '_raiz' and
       (new.id <> 'raiz' or new.valor -> 'meta' ->> 'espacioId' is distinct from v_id or
        new.valor -> 'meta' ->> 'espacio' is distinct from 'real') then
      raise exception 'ULIT Censo: raíz ajena a este espacio' using errcode='42501';
    end if;
    if new.coleccion = 'municipios' and
       (new.id <> 'real-mun-medina' or new.valor ->> 'nombre' is distinct from 'Medina del Campo'
        or new.valor ->> 'provincia' is distinct from 'Valladolid') then
      raise exception 'ULIT Censo: la preparación solo admite Medina del Campo'
        using errcode='42501';
    end if;
    if new.coleccion = 'personas' and
       not exists(select 1 from ulit_censo.miembro m
                  where m.espacio_id=v_id and m.persona_id=new.id
                    and m.baja_en is null and m.rol in ('administrador','coordinador')) then
      raise exception 'ULIT Censo: la persona debe ser responsable del espacio'
        using errcode='42501';
    end if;
    if new.coleccion = 'calles' and
       (new.id not like 'real-%' or
        new.valor ->> 'municipioId' is distinct from 'real-mun-medina' or
        new.valor ->> 'procedencia' is distinct from 'osm') then
      raise exception 'ULIT Censo: solo se admite el callejero OSM de Medina del Campo'
        using errcode='42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function ulit_censo.guardar_solo_inicializacion() from public,anon,authenticated,service_role;
create trigger guardia_inicializacion_real_entidad
before insert or update or delete on ulit_censo.entidad
for each row execute function ulit_censo.guardar_solo_inicializacion();

-- Restaurar una copia (o cualquier operación alternativa) tampoco puede
-- saltarse la autorización limitada a carga inicial.
create function ulit_censo.validar_operacion_inicial()
returns trigger
language plpgsql set search_path = '' as $$
declare v_preparando boolean;
begin
  select preparacion_habilitada into v_preparando from ulit_censo.espacio where id=new.espacio_id;
  if coalesce(v_preparando,false) and (new.tipo <> 'carga-inicial' or new.version <> 1) then
    raise exception 'ULIT Censo: solo está autorizada una inicialización'
      using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function ulit_censo.validar_operacion_inicial() from public,anon,authenticated,service_role;
create trigger guardia_operacion_inicial
before insert on ulit_censo.operacion
for each row execute function ulit_censo.validar_operacion_inicial();

-- Solo tras guardarse raíz + municipio + al menos 20 calles OSM, se cierra
-- automáticamente el permiso limitado, en la MISMA transacción de versión 1.
create function ulit_censo.cerrar_inicializacion_real()
returns trigger
language plpgsql set search_path = '' as $$
declare
  v_calles bigint;
begin
  if old.preparacion_habilitada then
    if new.version <> 1 or old.version <> 0 or new.id <> old.id then
      raise exception 'ULIT Censo: inicialización real fuera de secuencia'
        using errcode='42501';
    end if;
    if (select count(*) from ulit_censo.entidad
         where espacio_id=old.id and coleccion='municipios') <> 1
       or not exists (select 1 from ulit_censo.entidad
         where espacio_id=old.id and coleccion='municipios' and id='real-mun-medina')
       or not exists (select 1 from ulit_censo.entidad
         where espacio_id=old.id and coleccion='_raiz' and id='raiz')
       or not exists (select 1 from ulit_censo.entidad
         where espacio_id=old.id and coleccion='personas'
           and id in (select persona_id from ulit_censo.miembro
                      where espacio_id=old.id and baja_en is null))
       or exists (select 1 from ulit_censo.entidad
         where espacio_id=old.id and coleccion not in ('_raiz','personas','municipios','calles')) then
      raise exception 'ULIT Censo: falta el municipio, la raíz o la persona responsable'
        using errcode='42501';
    end if;
    select count(*) into v_calles from ulit_censo.entidad
      where espacio_id=old.id and coleccion='calles';
    if v_calles < 20 then
      raise exception 'ULIT Censo: no se permite inicializar sin callejero real (mínimo 20 calles)'
        using errcode='42501';
    end if;
    new.preparacion_habilitada := false;
    new.escritura_habilitada := false;
  end if;
  return new;
end;
$$;
revoke all on function ulit_censo.cerrar_inicializacion_real() from public,anon,authenticated,service_role;
create trigger cerrar_preparacion_real_tras_primera_version
before update of version on ulit_censo.espacio
for each row execute function ulit_censo.cerrar_inicializacion_real();

commit;
