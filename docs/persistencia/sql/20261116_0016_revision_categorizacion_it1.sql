-- 0016 · IT1 · Validación humana de TODAS las clasificaciones de ocupados 2026.
-- No reescribe Excel ni histórico 2025; solo correccionesRegistros, con control de versión.
begin;

-- Si otra corrección de fachada conserva las categorías, debe conservar también
-- su comprobación humana. Si se vacía u ocupa el local, exige nueva revisión.
create or replace function public.ulit_censo_revision_fase1_2026(
  p_espacio text, p_accion text, p_version_esperada bigint,
  p_registro_id text, p_metros text
) returns jsonb
language plpgsql security definer
set search_path = ''
set statement_timeout = '60s'
as $func$
declare
  v_m ulit_censo.miembro;
  v_e ulit_censo.espacio;
  v_camp constant text := 'real-camp-medina-2026-censo-medina-del-campo-2026';
  v_reg jsonb;
  v_imp jsonb;
  v_ant jsonb;
  v_restaurado jsonb;
  v_ultimo_guardado jsonb;
  v_vals jsonb;
  v_campo text;
  v_campos_negocio constant text[] := array[
    'nombre','grupoActividad','grupoComercio','subgrupo','actividad','descripcionActividad',
    'franquicia','web','googleBusiness','ventaOnline','numResenas','respondeResenas',
    'instagram','seguidoresInstagram','facebook','seguidoresFacebook',
    'twitter','seguidoresTwitter','numRedes','observaciones'
  ];
  v_nuevo jsonb;
  v_copia uuid;
  v_vacio text;
  v_nombre text;
  v_original_fachada text;
  v_actual text;
  v_fecha text;
  v_version bigint;
  v_iniciada boolean;
begin
  if p_espacio is distinct from 'real-medina-del-campo-2026'
     or p_accion not in ('estado','guardar','ocupar','vaciar','deshacer','limpiar-fachada') or p_accion is null then
    raise exception 'ULIT Censo: solicitud fuera de alcance' using errcode='42501';
  end if;
  v_m := ulit_censo.exigir(p_espacio,array['administrador','coordinador']);
  if p_accion <> 'estado' then
    select * into v_e from ulit_censo.espacio where id=p_espacio for update;
  else
    select * into v_e from ulit_censo.espacio where id=p_espacio;
  end if;
  if not found or v_e.tipo <> 'real' or v_e.version < 8
     or v_e.escritura_habilitada or v_e.preparacion_habilitada then
    raise exception 'ULIT Censo: el espacio real no está cerrado o es incompatible' using errcode='42501';
  end if;
  if not exists(select 1 from ulit_censo.entidad
      where espacio_id=p_espacio and coleccion='campanas' and id=v_camp
        and valor->>'anio'='2026') then
    raise exception 'ULIT Censo: campaña 2026 no verificable' using errcode='42501';
  end if;
  if p_accion='estado' then
    return pg_catalog.jsonb_build_object(
      'habilitada',true,'version',v_e.version,'motivo','',
      'alcance','revision-vacios-completa','respaldoAutomatico',true
    );
  end if;
  if p_version_esperada is null or p_version_esperada <> v_e.version then
    raise exception 'ULIT Censo: la base cambió; recarga antes de guardar' using errcode='PT409';
  end if;
  if p_registro_id is null or length(p_registro_id) not between 5 and 350 then
    raise exception 'ULIT Censo: identificador incorrecto' using errcode='22023';
  end if;
  if p_accion in ('guardar','vaciar') then
    if p_metros is null or length(p_metros) > 20
       or replace(pg_catalog.btrim(p_metros),',','.') !~ '^[0-9]{1,5}([.][0-9]{1,3})?$'
       or replace(pg_catalog.btrim(p_metros),',','.')::numeric <= 0 then
      raise exception 'ULIT Censo: metros de fachada incorrectos' using errcode='22023';
    end if;
  elsif p_metros is distinct from '' then
    raise exception 'ULIT Censo: un negocio ocupado no lleva metros de local vacío' using errcode='22023';
  end if;
  select valor into v_reg from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='registros' and id=p_registro_id;
  if v_reg is null or v_reg ? 'exclusion' then
    raise exception 'ULIT Censo: la fila no está autorizada' using errcode='42501';
  end if;
  select valor into v_imp from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='importaciones'
      and id=v_reg->>'importacionId';
  if v_imp is null or v_imp->>'campanaId' <> v_camp
     or v_imp->>'estado' <> 'confirmada'
     or v_imp->>'tipo' not in ('C-excel-itinerario','D-actualizacion')
     or not exists(select 1 from ulit_censo.entidad
       where espacio_id=p_espacio and coleccion='itinerarios'
         and id=v_reg->>'itinerarioId' and valor->>'campanaId'=v_camp) then
    raise exception 'ULIT Censo: la fila no pertenece a los itinerarios confirmados 2026' using errcode='42501';
  end if;
  select valor into v_ant from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='correccionesRegistros' and id=p_registro_id;
  if v_ant is not null and (v_ant->>'registroId' is distinct from p_registro_id
      or v_ant->>'campanaId' is distinct from v_camp
      or pg_catalog.jsonb_typeof(v_ant->'valores') is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_ant->'historial') is distinct from 'array') then
    raise exception 'ULIT Censo: revisión anterior incoherente' using errcode='42501';
  end if;
  if p_accion='deshacer' then
    if v_ant is null or v_ant->>'tipoRevision' is distinct from 'vaciar' then
      raise exception 'ULIT Censo: no hay limpieza reciente que deshacer' using errcode='42501';
    end if;
    select h.valor_anterior, h.valor_nuevo into v_restaurado, v_ultimo_guardado
      from ulit_censo.entidad_historial h
      join ulit_censo.operacion o on o.id=h.operacion_id and o.espacio_id=h.espacio_id
      where h.espacio_id=p_espacio and h.coleccion='correccionesRegistros'
        and h.id=p_registro_id
      order by o.version desc limit 1;
    if not found or v_ultimo_guardado is distinct from v_ant
      or (v_restaurado is not null and
         (v_restaurado->>'campanaId' is distinct from v_camp
           or v_restaurado->>'registroId' is distinct from p_registro_id)) then
      raise exception 'ULIT Censo: falta revisión técnica coherente; no se ha modificado nada'
        using errcode='42501';
    end if;
    update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
    v_version := ulit_censo.aplicar_interno(v_m,p_espacio,p_version_esperada,
      'Oficina 2026 · deshacer confirmación de vacío',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'c','correccionesRegistros','id',p_registro_id,'v',v_restaurado)));
    update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio;
    return pg_catalog.jsonb_build_object('version',v_version,'registroId',p_registro_id,
      'accion','deshacer','correccion',v_restaurado);
  end if;
  v_vacio := coalesce(v_ant->'valores'->>'vacio',
    v_reg->'original'->'vacio'->>'v',v_reg->'datos'->>'Local Vacío');
  if v_vacio not in ('0','1') or v_vacio is null
     or (p_accion = 'limpiar-fachada' and v_vacio <> '0')
     or (p_accion not in ('vaciar','limpiar-fachada') and v_vacio <> '1') then
    raise exception 'ULIT Censo: estado efectivo no autorizado' using errcode='42501';
  end if;
  v_nombre := coalesce(v_ant->'valores'->>'nombre',
    v_reg->'original'->'nombre'->>'v',v_reg->'datos'->>'Nombre del negocio','');
  v_actual := coalesce(v_ant->'valores'->>'fachada',
    v_reg->'original'->'fachada'->>'v',v_reg->'datos'->>'Long fachada','');
  v_original_fachada := coalesce(v_reg->'original'->'fachada'->>'v',
    v_reg->'datos'->>'Long fachada','');
  if p_accion='ocupar' then
    if pg_catalog.btrim(v_nombre) = ''
       or pg_catalog.lower(pg_catalog.btrim(v_nombre)) = any(array[
          'lv','l.v.','l.v','vacio','vacío','local vacío','local vacio','sin ocupante','sin actividad'
        ]) then
      raise exception 'ULIT Censo: no hay nombre de negocio confirmado para marcar ocupado'
        using errcode='22023';
    end if;
  elsif p_accion='guardar' and replace(pg_catalog.btrim(v_actual),',','.')
      = replace(pg_catalog.btrim(p_metros),',','.') then
    raise exception 'ULIT Censo: los metros no han cambiado' using errcode='22023';
  elsif p_accion='limpiar-fachada' and pg_catalog.btrim(v_actual) = '' then
    raise exception 'ULIT Censo: el local ocupado ya tiene la fachada vacía'
      using errcode='22023';
  end if;
  v_iniciada := exists(select 1 from ulit_censo.entidad
     where espacio_id=p_espacio and coleccion='correccionesRegistros');
  if not v_iniciada then
    v_copia := public.ulit_censo_crear_copia(
      p_espacio,'Automática previa a guardar los primeros metros de fachada de 2026');
    if not exists(select 1 from ulit_censo.copia
      where id=v_copia and espacio_id=p_espacio and version=v_e.version
        and sha256 ~ '^[0-9a-f]{64}$' and bytes > 0
        and contenido->>'espacioId'=p_espacio
        and contenido->>'version'=v_e.version::text
        and contenido->>'tipo'='real') then
      raise exception 'ULIT Censo: no se verificó la copia previa; no se guardó' using errcode='42501';
    end if;
  end if;
  v_fecha := pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_vals := coalesce(v_ant->'valores','{}'::jsonb);
  if p_accion='vaciar' then
    v_vals := pg_catalog.jsonb_build_object('vacio','1','fachada',pg_catalog.btrim(p_metros));
    foreach v_campo in array v_campos_negocio loop
      v_vals := v_vals || pg_catalog.jsonb_build_object(v_campo,'');
    end loop;
  elsif p_accion='limpiar-fachada' then
    v_vals := v_vals || '{"fachada":""}'::jsonb;
  elsif p_accion='ocupar' then
    v_vals := v_vals || '{"vacio":"0"}'::jsonb;
    if pg_catalog.btrim(v_original_fachada) <> '' then
      v_vals := v_vals || '{"fachada":""}'::jsonb;
    else
      v_vals := v_vals - 'fachada';
    end if;
  else
    v_vals := v_vals || pg_catalog.jsonb_build_object('fachada',pg_catalog.btrim(p_metros));
    if replace(v_original_fachada,',','.')
       = replace(pg_catalog.btrim(p_metros),',','.') then
      v_vals := v_vals - 'fachada';
    end if;
  end if;
  v_nuevo := pg_catalog.jsonb_build_object(
    'id',p_registro_id,'registroId',p_registro_id,'campanaId',v_camp,
    'valores',v_vals,'fecha',v_fecha,'porId',v_m.persona_id,
    'tipoRevision',case when p_accion='vaciar' then 'vaciar'
      when p_accion='ocupar' then 'ocupar' else 'fachada' end,
    'motivo',case when p_accion='vaciar' then 'Confirmado vacío; datos de ocupante retirados'
      when p_accion='ocupar' then 'Revisión de Oficina: local actualmente ocupado por negocio'
      when p_accion='limpiar-fachada' then 'Retirada de fachada indebida en local ya ocupado'
      else 'Medición de fachada registrada desde Oficina' end,
    'historial',case when p_accion='vaciar' then '[]'::jsonb else
      coalesce(v_ant->'historial','[]'::jsonb) ||
      (case when v_ant is null then '[]'::jsonb else
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'fecha',v_ant->>'fecha','porId',v_ant->>'porId','motivo',v_ant->>'motivo',
          'valoresAnteriores',v_ant->'valores')) end) end
  );
  -- Mantener revisión de clasificación en operaciones que no cambian ocupación.
  if p_accion in ('guardar','limpiar-fachada')
     and v_ant ? 'revisionClasificacion' then
    v_nuevo := v_nuevo || pg_catalog.jsonb_build_object(
      'revisionClasificacion',v_ant->'revisionClasificacion');
  end if;
  update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
  v_version := ulit_censo.aplicar_interno(v_m,p_espacio,p_version_esperada,
    case when p_accion='vaciar' then 'Oficina 2026 · confirmar vacío y limpiar'
      when p_accion='ocupar' then 'Oficina 2026 · marcar local ocupado'
      when p_accion='limpiar-fachada' then 'Oficina 2026 · retirar fachada de ocupado'
      else 'Oficina 2026 · metros de fachada' end,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'c','correccionesRegistros','id',p_registro_id,'v',v_nuevo)));
  update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio;
  return pg_catalog.jsonb_build_object(
    'version',v_version,'registroId',p_registro_id,
    'accion',p_accion,'correccion',v_nuevo
  );
end;
$func$;
revoke all on function public.ulit_censo_revision_fase1_2026(text,text,bigint,text,text)
  from public,anon,service_role;
grant execute on function public.ulit_censo_revision_fase1_2026(text,text,bigint,text,text)
  to authenticated;

create function public.ulit_censo_categoria_it1_2026(
  p_espacio text, p_accion text, p_version_esperada bigint,
  p_registro_id text, p_valores jsonb default null
) returns jsonb
language plpgsql security definer
set search_path = ''
set statement_timeout = '60s'
as $categoria$
declare
  v_m ulit_censo.miembro;
  v_e ulit_censo.espacio;
  v_camp constant text := 'real-camp-medina-2026-censo-medina-del-campo-2026';
  v_reg jsonb;
  v_imp jsonb;
  v_it jsonb;
  v_ant jsonb;
  v_valores jsonb;
  v_categoria jsonb := '{}'::jsonb;
  v_nuevo jsonb;
  v_fecha text;
  v_campo text;
  v_cabecera text;
  v_dato text;
  v_i integer;
  v_claves constant text[] := array[
    'grupoActividad','grupoComercio','subgrupo','actividad','descripcionActividad'];
  v_cabeceras constant text[] := array[
    'GrActividad','Gr Comercio','Subgrupo de actividad','Actividad','Descripción'];
  v_version bigint;
  v_copia uuid;
begin
  if p_espacio is distinct from 'real-medina-del-campo-2026'
     or p_accion not in ('estado','aceptar','rechazar','asignar') or p_accion is null then
    raise exception 'ULIT Censo: fuera de revisión de categorías de IT1' using errcode='42501';
  end if;
  v_m := ulit_censo.exigir(p_espacio,array['administrador','coordinador']);
  if p_accion='estado' then
    select * into v_e from ulit_censo.espacio where id=p_espacio;
  else
    select * into v_e from ulit_censo.espacio where id=p_espacio for update;
  end if;
  if not found or v_e.tipo <> 'real' or v_e.version < 8
    or v_e.escritura_habilitada or v_e.preparacion_habilitada then
    raise exception 'ULIT Censo: espacio real no está cerrado' using errcode='42501';
  end if;
  if not exists(select 1 from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='campanas' and id=v_camp and valor->>'anio'='2026') then
    raise exception 'ULIT Censo: campaña 2026 no verificable' using errcode='42501';
  end if;
  if p_accion='estado' then
    return pg_catalog.jsonb_build_object('habilitada',true,'version',v_e.version,
      'alcance','categoria-it1-2026','motivo','');
  end if;
  if p_version_esperada is distinct from v_e.version then
    raise exception 'ULIT Censo: la base cambió; recarga antes de guardar' using errcode='PT409';
  end if;
  if p_registro_id is null or length(p_registro_id) not between 5 and 350 then
    raise exception 'ULIT Censo: registro incorrecto' using errcode='22023';
  end if;
  select valor into v_reg from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='registros' and id=p_registro_id;
  if v_reg is null or v_reg ? 'exclusion' then
    raise exception 'ULIT Censo: registro no válido' using errcode='42501';
  end if;
  select valor into v_imp from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='importaciones' and id=v_reg->>'importacionId';
  select valor into v_it from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='itinerarios' and id=v_reg->>'itinerarioId';
  if v_imp is null or v_imp->>'campanaId'<>v_camp or v_imp->>'estado'<>'confirmada'
     or v_imp->>'tipo' not in ('C-excel-itinerario','D-actualizacion')
     or v_it is null or v_it->>'campanaId'<>v_camp or v_it->>'codigo'<>'IT1' then
    raise exception 'ULIT Censo: sólo se permite revisión del IT1 confirmado' using errcode='42501';
  end if;
  select valor into v_ant from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='correccionesRegistros' and id=p_registro_id;
  if v_ant is not null and (v_ant->>'registroId' is distinct from p_registro_id
    or v_ant->>'campanaId' is distinct from v_camp
    or pg_catalog.jsonb_typeof(v_ant->'valores') is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_ant->'historial') is distinct from 'array') then
    raise exception 'ULIT Censo: corrección anterior no verificable' using errcode='42501';
  end if;
  v_valores := coalesce(v_ant->'valores','{}'::jsonb);
  if coalesce(v_valores->>'vacio',v_reg->'original'->'vacio'->>'v',
    v_reg->'datos'->>'Local Vacío') is distinct from '0' then
    raise exception 'ULIT Censo: los locales vacíos no se categorizan' using errcode='42501';
  end if;
  if pg_catalog.btrim(coalesce(v_valores->>'nombre',
    v_reg->'original'->'nombre'->>'v',v_reg->'datos'->>'Nombre del negocio','')) = '' then
    raise exception 'ULIT Censo: ocupado sin nombre requiere revisión de estado' using errcode='42501';
  end if;
  for v_i in 1..5 loop
    v_campo := v_claves[v_i];
    v_cabecera := v_cabeceras[v_i];
    v_dato := coalesce(v_valores->>v_campo, v_reg->'original'->v_campo->>'v',
      v_reg->'datos'->>v_cabecera,'');
    v_categoria := v_categoria || pg_catalog.jsonb_build_object(v_campo,v_dato);
  end loop;
  if p_accion='asignar' then
    if p_valores is null or pg_catalog.jsonb_typeof(p_valores)<>'object'
      or (select count(*) from pg_catalog.jsonb_object_keys(p_valores))<>5
      or pg_catalog.octet_length(p_valores::text)>1300 then
      raise exception 'ULIT Censo: nueva categorización incorrecta' using errcode='22023';
    end if;
    for v_i in 1..5 loop
      v_campo := v_claves[v_i];
      if not (p_valores ? v_campo)
        or pg_catalog.jsonb_typeof(p_valores->v_campo)<>'string'
        or length(p_valores->>v_campo)>220 then
        raise exception 'ULIT Censo: faltan campos válidos de categorización' using errcode='22023';
      end if;
    end loop;
    if (p_valores->>'grupoActividad') not in ('Comercio','Servicios','Hostelería y Restauración')
      or pg_catalog.btrim(p_valores->>'subgrupo')=''
      or ((p_valores->>'grupoActividad')='Comercio'
        and pg_catalog.btrim(p_valores->>'grupoComercio')='')
      or ((p_valores->>'grupoActividad')<>'Comercio'
        and pg_catalog.btrim(p_valores->>'grupoComercio')<>'')
      then
      raise exception 'ULIT Censo: clasificación incompleta o incoherente' using errcode='22023';
    end if;
    v_categoria := p_valores;
    v_valores := v_valores || p_valores;
  else
    if p_valores is not null and p_valores<>'{}'::jsonb then
      raise exception 'ULIT Censo: confirmar o rechazar no cambia valores' using errcode='22023';
    end if;
    if not exists (select 1 from pg_catalog.jsonb_each_text(v_categoria)
      where key in ('grupoActividad','grupoComercio','subgrupo','actividad','descripcionActividad')
        and pg_catalog.btrim(value)<>'') then
      raise exception 'ULIT Censo: no hay categoría anterior que aceptar o rechazar' using errcode='22023';
    end if;
  end if;

  if (v_ant->'revisionClasificacion'->>'estado' =
    case when p_accion='rechazar' then 'rechazada' else 'aceptada' end)
    and v_ant->'revisionClasificacion'->'valores' = v_categoria then
    raise exception 'ULIT Censo: esta decisión ya está guardada' using errcode='22023';
  end if;
  -- El primer acto de Fase 3 exige un respaldo íntegro de la versión ACTUAL.
  -- Las correcciones de Fase 1 no sustituyen esa copia, ya que pueden existir
  -- desde hace muchas versiones; las siguientes decisiones usan historial atómico.
  if not exists(select 1 from ulit_censo.entidad
       where espacio_id=p_espacio and coleccion='correccionesRegistros'
         and valor ? 'revisionClasificacion') then
    v_copia := public.ulit_censo_crear_copia(
      p_espacio,'Automática antes de la primera categorización IT1 2026');
    if not exists(select 1 from ulit_censo.copia
       where id=v_copia and espacio_id=p_espacio and version=v_e.version
       and length(sha256)=64 and sha256 ~ '^[0-9a-f]+$' and bytes>0
       and contenido->>'version'=v_e.version::text
       and contenido->>'espacioId'=p_espacio and contenido->>'tipo'='real') then
      raise exception 'ULIT Censo: sin respaldo íntegro actual, no se guardó' using errcode='42501';
    end if;
  end if;
  v_fecha := pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_nuevo := pg_catalog.jsonb_build_object(
    'id',p_registro_id,'registroId',p_registro_id,'campanaId',v_camp,
    'valores',v_valores,'fecha',v_fecha,'porId',v_m.persona_id,
    'motivo',case when p_accion='rechazar' then 'Clasificación existente rechazada'
      when p_accion='asignar' then 'Nueva clasificación elegida y confirmada'
      else 'Clasificación existente comprobada y aceptada' end,
    'historial',coalesce(v_ant->'historial','[]'::jsonb),
    'revisionClasificacion',pg_catalog.jsonb_build_object(
      'estado',case when p_accion='rechazar' then 'rechazada' else 'aceptada' end,
      'valores',v_categoria,'fecha',v_fecha,'porId',v_m.persona_id
    )
  );
  if v_ant ? 'tipoRevision' then
    v_nuevo := v_nuevo || pg_catalog.jsonb_build_object('tipoRevision',v_ant->'tipoRevision');
  end if;
  update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
  v_version := ulit_censo.aplicar_interno(v_m,p_espacio,p_version_esperada,
    'Oficina 2026 · revisión clasificación IT1 · '||p_accion,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'c','correccionesRegistros','id',p_registro_id,'v',v_nuevo)));
  update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio;
  return pg_catalog.jsonb_build_object('version',v_version,'registroId',p_registro_id,
    'accion',p_accion,'correccion',v_nuevo);
end;
$categoria$;

revoke all on function public.ulit_censo_categoria_it1_2026(text,text,bigint,text,jsonb)
  from public,anon,service_role;
grant execute on function public.ulit_censo_categoria_it1_2026(text,text,bigint,text,jsonb)
  to authenticated;
commit;
