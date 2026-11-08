-- ULIT Censo · PROPUESTA 0008 · Conciliación supervisada IT1 2026.
-- NO APLICAR A PRODUCCIÓN SIN REVISIÓN Y AUTORIZACIÓN EXPRESA.
-- El backend es la autoridad: ningún cambio JSON suministrado por el cliente.
-- Función SECURITY DEFINER de superficie muy reducida; bloquea cualquier espacio,
-- campaña, importación, registro o rol fuera del caso autorizado.
-- Usa ulit_censo.aplicar_interno para conservar historial y versión atómica;
-- la escritura general se abre y se cierra DENTRO de la misma transacción bloqueada.
begin;

create function public.ulit_censo_conciliar_it1_2026(
  p_espacio text,
  p_version_esperada bigint,
  p_registro_id text,
  p_accion text,
  p_local_id text default null,
  p_motivo text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $conciliar$
declare
  m ulit_censo.miembro;
  e ulit_censo.espacio;
  v_camp constant text := 'real-camp-medina-2026-censo-medina-del-campo-2026';
  v_ref constant text := 'camp-hist-real-mun-medina-2025-9e367ca51c';
  v_reg jsonb;
  v_imp jsonb;
  v_vin jsonb;
  v_obs jsonb;
  v_local jsonb;
  v_raiz jsonb;
  v_num integer;
  v_sufijo text;
  v_fila text;
  v_ahora text;
  v_motivo text;
  v_nuevo_id text;
  v_ocup_id text;
  v_ocup jsonb;
  v_loc jsonb;
  v_dec jsonb;
  v_antes jsonb;
  v_cambios jsonb := '[]'::jsonb;
  v_creadas jsonb;
  v_lista jsonb;
  v_ultima jsonb;
  v_indice integer;
  v_orden bigint;
  v_vers bigint;
  v_previa jsonb;
  v_texto text;
begin
  if p_espacio is distinct from 'real-medina-del-campo-2026'
     or (p_accion is distinct from 'estado' and (p_registro_id is null or length(p_registro_id) > 350))
     or p_accion is null
     or p_accion not in ('estado','vincular','local-nuevo','mantener-pendiente','deshacer')
     or p_version_esperada is null then
    raise exception 'ULIT Censo: petición de conciliación no autorizada'
       using errcode = '42501';
  end if;
  m := ulit_censo.exigir(p_espacio, array['administrador','coordinador','revisor']);
  select * into e from ulit_censo.espacio where id=p_espacio for update;
  if not found or e.tipo <> 'real' or e.version < 4
     or e.escritura_habilitada or e.preparacion_habilitada then
    raise exception 'ULIT Censo: el espacio debe estar cerrado para conciliar'
       using errcode = '42501';
  end if;
  if p_accion = 'estado' then
    return jsonb_build_object('habilitada', true, 'version', e.version,
      'permisos', 'administrador,coordinador,revisor');
  end if;
  if e.version <> p_version_esperada then
    raise exception 'ULIT Censo: otro usuario ha modificado la base; recargue antes de continuar'
       using errcode = 'PT409';
  end if;
  if not exists (
      select 1 from ulit_censo.entidad where espacio_id=p_espacio
        and coleccion='campanas' and id=v_camp
        and valor->>'tipo'='actualizacion' and valor->>'anio'='2026'
        and valor->>'campanaReferenciaId'=v_ref
  ) or not exists (
      select 1 from ulit_censo.entidad where espacio_id=p_espacio
        and coleccion='campanas' and id=v_ref
        and valor->>'tipo'='historico-importado'
  ) then
    raise exception 'ULIT Censo: campañas de origen o referencia no verificadas'
       using errcode = '42501';
  end if;
  select valor into v_reg from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='registros' and id=p_registro_id;
  select valor into v_imp from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='importaciones'
      and id=v_reg->>'importacionId';
  if v_reg is null or v_reg ? 'exclusion'
     or coalesce(v_reg->>'itinerarioId','') = ''
     or coalesce(v_reg->>'fila','') !~ '^[0-9]{1,4}$'
     or (v_reg->>'fila')::integer not between 2 and 106
     or v_imp is null or v_imp->>'campanaId' <> v_camp
     or v_imp->>'tipo' <> 'C-excel-itinerario'
     or v_imp->>'estado' <> 'confirmada'
     or v_imp->>'huella' <> '7a6d4230a68370cc0bb0245ce68e8c56648be4d89e76531cc0edbd9ab341da61'
     or not exists (select 1 from ulit_censo.entidad
        where espacio_id=p_espacio and coleccion='itinerarios'
          and id=v_reg->>'itinerarioId'
          and valor->>'campanaId'=v_camp and valor->>'codigo'='IT1') then
    raise exception 'ULIT Censo: fila no perteneciente a IT1 autorizado'
       using errcode = '42501';
  end if;

  select valor into v_vin from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='vinculos' and id='vin-'||p_registro_id;
  if v_vin is null
     or v_vin->'origen'->>'tipo' is distinct from 'registro'
     or v_vin->'origen'->>'id' is distinct from p_registro_id then
    raise exception 'ULIT Censo: no coincide el vínculo original de la fila'
       using errcode = '42501';
  end if;
  if (select count(*) from ulit_censo.entidad
      where espacio_id=p_espacio and coleccion='vinculos'
        and valor->'origen'->>'id'=p_registro_id) <> 1 then
    raise exception 'ULIT Censo: vínculos duplicados o inconsistentes'
       using errcode = '42501';
  end if;
  select valor into v_obs from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='observaciones'
      and valor->>'registroId'=p_registro_id and valor->>'campanaId'=v_camp;
  if (select count(*) from ulit_censo.entidad
      where espacio_id=p_espacio and coleccion='observaciones'
        and valor->>'registroId'=p_registro_id and valor->>'campanaId'=v_camp) > 1 then
    raise exception 'ULIT Censo: más de una observación asociada; revisión manual requerida'
       using errcode = '42501';
  end if;
  v_ahora := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_motivo := nullif(btrim(coalesce(p_motivo,'')), '');
  if length(coalesce(v_motivo,'')) > 600 then
    raise exception 'ULIT Censo: justificación demasiado larga' using errcode='22023';
  end if;

  v_lista := coalesce(v_vin->'conciliaciones','[]'::jsonb);
  if pg_catalog.jsonb_typeof(v_lista) <> 'array' then
    raise exception 'ULIT Censo: el historial de conciliación no es válido'
       using errcode='42501';
  end if;
  select elemento, ordinalidad::integer-1 into v_ultima, v_indice
    from pg_catalog.jsonb_array_elements(v_lista) with ordinality as t(elemento,ordinalidad)
    where not elemento ? 'deshecha'
    order by ordinalidad desc limit 1;

  if p_accion = 'deshacer' then
    if v_ultima is null or v_ultima->>'campanaId' <> v_camp then
      raise exception 'ULIT Censo: no hay decisión vigente que deshacer'
         using errcode='42501';
    end if;
    if v_ultima->>'accion' <> 'mantener-pendiente' then
      if v_vin->>'localId' is distinct from v_ultima->>'localId'
         or v_obs is null or v_obs->>'localId' is distinct from v_ultima->>'localId' then
        raise exception 'ULIT Censo: el vínculo o la observación han cambiado; no se deshace'
          using errcode='42501';
      end if;
      -- No retirar un local, ocupación ni vínculo usado por otro registro,
      -- otra observación, revisión, resolución o un candidato persistido.
      if exists (select 1 from ulit_censo.entidad
        where espacio_id=p_espacio and coleccion='campanas'
          and jsonb_typeof(valor->'resolucionesEstado')='array'
          and exists (select 1 from pg_catalog.jsonb_array_elements(valor->'resolucionesEstado') x
            where x->>'localId'=v_ultima->>'localId' and not x ? 'retirada')) then
         raise exception 'ULIT Censo: hay una resolución de estado dependiente; no se deshace'
           using errcode='42501';
      end if;
      if jsonb_array_length(coalesce(v_ultima->'creadas'->'locales','[]'::jsonb)) > 0 then
        if exists (select 1 from ulit_censo.entidad
          where espacio_id=p_espacio and coleccion in ('vinculos','observaciones','ocupaciones','revisiones')
          and not (coleccion='vinculos' and id='vin-'||p_registro_id)
          and not (coleccion='observaciones' and id=v_obs->>'id')
          and not (coleccion='ocupaciones' and id=coalesce(v_ultima->'creadas'->'ocupaciones'->>0,''))
          and (valor->>'localId'=v_ultima->>'localId'
            or (coleccion='vinculos' and valor->'candidatos' @> jsonb_build_array(jsonb_build_object('localId',v_ultima->>'localId'))))) then
          raise exception 'ULIT Censo: otro registro depende del local creado; no se deshace'
            using errcode='42501';
        end if;
      end if;
    end if;

    v_antes := v_ultima->'antes';
    if v_antes is null or v_antes->>'localId' is not null then
      raise exception 'ULIT Censo: la decisión anterior no es reversible con seguridad'
        using errcode='42501';
    end if;
    v_lista := pg_catalog.jsonb_set(v_lista,array[v_indice::text],
       v_ultima || jsonb_build_object('deshecha',
         jsonb_build_object('porId',m.persona_id,'fecha',v_ahora)),false);
    v_vin := v_vin || jsonb_build_object('localId',null,
      'confianza',v_antes->>'confianza','conciliaciones',v_lista);
    if v_antes ? 'revisadoPorId' then
      v_vin := v_vin || jsonb_build_object('revisadoPorId',v_antes->>'revisadoPorId');
    else
      v_vin := v_vin - 'revisadoPorId';
    end if;
    v_cambios := v_cambios || jsonb_build_array(
      jsonb_build_object('c','vinculos','id','vin-'||p_registro_id,'v',v_vin));
    if v_ultima->>'accion' <> 'mantener-pendiente' then
      v_obs := v_obs || jsonb_build_object('localId',v_antes->'observacionLocalId');
      v_cambios := v_cambios || jsonb_build_array(
        jsonb_build_object('c','observaciones','id',v_obs->>'id','v',v_obs));
      if jsonb_array_length(coalesce(v_ultima->'creadas'->'ocupaciones','[]'::jsonb))=1 then
        v_ocup_id := v_ultima->'creadas'->'ocupaciones'->>0;
        if v_ocup_id is distinct from 'ocu-g5-'||p_registro_id or not exists (select 1 from ulit_censo.entidad
          where espacio_id=p_espacio and coleccion='ocupaciones'
            and id=v_ocup_id and valor->>'localId'=v_ultima->>'localId'
            and valor->>'desdeCampanaId'=v_camp) then
          raise exception 'ULIT Censo: la ocupación creada ha cambiado; no se deshace'
            using errcode='42501';
        end if;
        v_cambios := v_cambios || jsonb_build_array(
          jsonb_build_object('c','ocupaciones','id',v_ocup_id,'v',null));
      end if;
      if jsonb_array_length(coalesce(v_ultima->'creadas'->'locales','[]'::jsonb))=1 then
        v_nuevo_id := v_ultima->'creadas'->'locales'->>0;
        if v_nuevo_id is distinct from v_ultima->>'localId'
           or v_nuevo_id is distinct from 'loc-g5-'||p_registro_id
           or not exists (select 1 from ulit_censo.entidad
             where espacio_id=p_espacio and coleccion='locales'
               and id=v_nuevo_id and valor->>'procedencia'='importado') then
          raise exception 'ULIT Censo: el local creado ha cambiado; no se deshace'
            using errcode='42501';
        end if;
        v_cambios := v_cambios || jsonb_build_array(
          jsonb_build_object('c','locales','id',v_nuevo_id,'v',null));
      end if;
    end if;
  else
    if v_vin->>'localId' is not null or v_ultima is not null then
      raise exception 'ULIT Censo: la fila ya tiene un local o una decisión vigente; no repetir'
        using errcode='42501';
    end if;
    if v_motivo is null or length(v_motivo)<8 then
      raise exception 'ULIT Censo: cada decisión requiere una justificación concreta'
        using errcode='22023';
    end if;
    v_creadas := jsonb_build_object('locales',jsonb_build_array(),'ocupaciones',jsonb_build_array());
    v_antes := jsonb_build_object('localId',null,'confianza',v_vin->>'confianza');
    if v_vin ? 'revisadoPorId' then
      v_antes := v_antes || jsonb_build_object('revisadoPorId',v_vin->>'revisadoPorId');
    end if;
    if v_obs is not null then
      v_antes := v_antes || jsonb_build_object('observacionLocalId',v_obs->'localId');
    end if;

    if p_accion in ('vincular','local-nuevo') then
      if v_obs is null
         or v_obs->>'calleId' is null
         or not exists (select 1 from ulit_censo.entidad
           where espacio_id=p_espacio and coleccion='calles'
             and id=v_obs->>'calleId') then
        raise exception 'ULIT Censo: falta observación y calle reconocida; no se vincula'
          using errcode='42501';
      end if;
      if jsonb_typeof(v_obs->'datos'->'vacio') <> 'boolean' then
        raise exception 'ULIT Censo: no está confirmado el estado vacío/ocupado'
          using errcode='42501';
      end if;
      if v_obs->>'localId' is not null then
        raise exception 'ULIT Censo: la observación ya tiene un local'
          using errcode='42501';
      end if;

      if p_accion = 'vincular' then
        if p_local_id is null or length(p_local_id)>350 then
          raise exception 'ULIT Censo: seleccione un local físico existente'
             using errcode='22023';
        end if;
        select valor into v_local from ulit_censo.entidad where espacio_id=p_espacio
          and coleccion='locales' and id=p_local_id;
        if v_local is null or v_local->>'municipioId' <> 'real-mun-medina'
          or jsonb_typeof(v_local->'direcciones') <> 'array'
          or v_local->'direcciones'->-1->>'calleId' is distinct from v_obs->>'calleId'
          or not exists (select 1 from ulit_censo.entidad
             where espacio_id=p_espacio and coleccion='observaciones'
               and valor->>'campanaId'=v_ref and valor->>'localId'=p_local_id)
          or exists (select 1 from ulit_censo.entidad
             where espacio_id=p_espacio and coleccion='observaciones'
               and valor->>'campanaId'=v_camp and valor->>'localId'=p_local_id
               and valor->>'registroId' is distinct from p_registro_id) then
          raise exception 'ULIT Censo: local histórico incompatible, ya usado o de otra calle'
             using errcode='42501';
        end if;
        v_nuevo_id := p_local_id;
      else
        -- Crear otro local requiere número de portal ORIGINAL reconocible.
        if p_local_id is not null
           or jsonb_typeof(v_obs->'datos'->'numero') <> 'number'
           or coalesce(v_obs->'datos'->>'numero','') !~ '^[0-9]{1,5}$' then
          raise exception 'ULIT Censo: falta portal verificado; no se crea un local'
             using errcode='42501';
        end if;
        v_num := (v_obs->'datos'->>'numero')::integer;
        v_sufijo := nullif(v_obs->'datos'->>'sufijo','');
        v_nuevo_id := 'loc-g5-'||p_registro_id;
        if length(v_nuevo_id)>400 or exists (select 1 from ulit_censo.entidad
             where espacio_id=p_espacio and coleccion='locales' and id=v_nuevo_id) then
          raise exception 'ULIT Censo: local nuevo ya existente; no se duplica'
             using errcode='42501';
        end if;
        v_loc := jsonb_build_object('id',v_nuevo_id,'municipioId','real-mun-medina',
           'estado','activo','procedencia','importado','direcciones',
           jsonb_build_array(jsonb_build_object('calleId',v_obs->>'calleId',
             'numero',v_num,'desdeCampanaId',v_camp) ||
             case when v_sufijo is not null then jsonb_build_object('sufijo',v_sufijo)
             else '{}'::jsonb end));
        v_cambios := v_cambios || jsonb_build_array(
          jsonb_build_object('c','locales','id',v_nuevo_id,'v',v_loc));
        v_creadas := jsonb_build_object('locales',jsonb_build_array(v_nuevo_id),
                                        'ocupaciones',jsonb_build_array());
      end if;
      -- No reciclar una ocupación del histórico. Si no hay ninguna en 2026,
      -- crear una ocupación de 2026 con su observación original sin tocar 2025.
      if not exists (select 1 from ulit_censo.entidad
         where espacio_id=p_espacio and coleccion='ocupaciones'
           and valor->>'localId'=v_nuevo_id
           and (valor->>'desdeCampanaId'=v_camp or valor->>'hastaCampanaId'=v_camp)) then
        v_ocup_id := 'ocu-g5-'||p_registro_id;
        if exists(select 1 from ulit_censo.entidad
          where espacio_id=p_espacio and coleccion='ocupaciones' and id=v_ocup_id) then
          raise exception 'ULIT Censo: ocupación ya creada; revisar antes de guardar'
            using errcode='42501';
        end if;
        select valor into v_raiz from ulit_censo.entidad
         where espacio_id=p_espacio and coleccion='_raiz' and id='raiz';
        if coalesce(v_raiz->>'secuencia','') !~ '^[0-9]{1,12}$' then
          raise exception 'ULIT Censo: contador de orden inválido' using errcode='42501';
        end if;
        v_orden := (v_raiz->>'secuencia')::bigint+1;
        v_ocup := jsonb_build_object('id',v_ocup_id,'localId',v_nuevo_id,
          'negocioId',case when v_obs->'datos'->>'vacio'='true' then null
              else v_obs->'datos'->'negocioId' end,
          'desdeCampanaId',v_camp,'hastaCampanaId',v_camp,
          'desdeObservacionId',v_obs->>'id','orden',v_orden);
        if v_obs->>'fecha' is not null then
          v_ocup := v_ocup || jsonb_build_object('desdeFecha',v_obs->>'fecha');
        end if;
        if v_obs->'datos' ? 'metrosFachada' then
          v_ocup := v_ocup || jsonb_build_object('metrosFachada',v_obs->'datos'->'metrosFachada');
        end if;
        v_cambios := v_cambios || jsonb_build_array(
          jsonb_build_object('c','ocupaciones','id',v_ocup_id,'v',v_ocup),
          jsonb_build_object('c','_raiz','id','raiz','v',
            v_raiz || jsonb_build_object('secuencia',v_orden)));
        v_creadas := v_creadas || jsonb_build_object('ocupaciones',jsonb_build_array(v_ocup_id));
      end if;
      v_obs := v_obs || jsonb_build_object('localId',v_nuevo_id);
      v_cambios := v_cambios || jsonb_build_array(
        jsonb_build_object('c','observaciones','id',v_obs->>'id','v',v_obs));
    else
      if p_local_id is not null then
        raise exception 'ULIT Censo: mantener pendiente no admite local destino'
          using errcode='42501';
      end if;
    end if;
    v_dec := jsonb_build_object('accion',p_accion,'porId',m.persona_id,'fecha',v_ahora,
      'motivo',v_motivo,'campanaId',v_camp,
      'itinerarioId',v_reg->>'itinerarioId','antes',v_antes,'creadas',v_creadas);
    if v_nuevo_id is not null then
      v_dec := v_dec || jsonb_build_object('localId',v_nuevo_id);
      v_vin := v_vin || jsonb_build_object('localId',v_nuevo_id,
        'confianza','confirmada','revisadoPorId',m.persona_id);
    end if;
    v_vin := v_vin || jsonb_build_object('conciliaciones',v_lista || jsonb_build_array(v_dec));
    v_cambios := v_cambios || jsonb_build_array(
      jsonb_build_object('c','vinculos','id','vin-'||p_registro_id,'v',v_vin));
  end if;

  if jsonb_array_length(v_cambios) not between 1 and 5 then
    raise exception 'ULIT Censo: número de entidades fuera de la operación limitada'
       using errcode='42501';
  end if;

  -- Primera conciliación real: copia INTEGRA v4 antes de aplicar cambios,
  -- guardada en la MISMA transacción. Las sucesivas conservan el historial.
  if e.version = 4 then
    v_previa := jsonb_build_object('espacioId',p_espacio,'tipo','real','version',e.version,
       'entidades',ulit_censo.contenido(p_espacio));
    v_texto := v_previa::text;
    insert into ulit_censo.copia
      (espacio_id,version,motivo,contenido,sha256,bytes,creada_por)
    values (p_espacio,e.version,'Automática PREVIA a primera conciliación IT1 G5',
       v_previa,encode(pg_catalog.sha256(pg_catalog.convert_to(v_texto,'UTF8')),'hex'),
       pg_catalog.octet_length(v_texto),auth.uid());
  end if;
  -- Acceso efímero a la rutina interna solo en esta transacción con el
  -- candado de espacio tomado. Ningún otro cliente observa la guarda abierta.
  update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
  v_vers := ulit_censo.aplicar_interno(m,p_espacio,e.version,
    'IT1 2026 · conciliación supervisada '||p_accion||' · fila '||(v_reg->>'fila'),v_cambios);
  if v_vers <> e.version+1 then
    raise exception 'ULIT Censo: versión de conciliación inesperada'
      using errcode='42501';
  end if;
  update ulit_censo.espacio set escritura_habilitada=false
    where id=p_espacio and version=v_vers;
  if not found or (select count(*) from ulit_censo.entidad
     where espacio_id=p_espacio and coleccion='registros')<>994
     or (select count(*) from ulit_censo.entidad
     where espacio_id=p_espacio and coleccion='campanas')<>2 then
    raise exception 'ULIT Censo: verificación final fallida; operación revertida'
      using errcode='42501';
  end if;
  return jsonb_build_object('version',v_vers,'accion',p_accion,
     'registroId',p_registro_id,'localId',v_nuevo_id);
end;
$conciliar$;

-- Todas las comprobaciones anteriores son de servidor; los datos sólo se
-- exponen al miembro autenticado que supera ulit_censo.exigir.
revoke all on function public.ulit_censo_conciliar_it1_2026(
  text,bigint,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.ulit_censo_conciliar_it1_2026(
  text,bigint,text,text,text,text) to authenticated;
commit;
