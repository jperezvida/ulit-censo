-- 0012 · Solo guardar metros de fachada de locales vacíos, campaña real Medina 2026.
-- Copia completa automática ANTES de la primera escritura, en la misma transacción.
-- El Excel original (colección registros) queda inmutable. Escritura genérica nunca abierta al finalizar.
begin;

create or replace function ulit_censo.coleccion_valida(c text)
returns boolean language sql immutable set search_path=''
as $$
  select c = any (array[
    '_raiz','municipios','calles','campanas','itinerarios','coberturas','situacionesPrevias',
    'callesRevisadasPlan','locales','negocios','ocupaciones','observaciones','registros','vinculos',
    'importaciones','revisiones','digital','clasificaciones','franquicias',
    'oficinaItinerarios','personas','correccionesRegistros'
  ]);
$$;

create or replace function public.ulit_censo_fachada_2026(
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
  v_vals jsonb;
  v_nuevo jsonb;
  v_copia uuid;
  v_vacio text;
  v_actual text;
  v_fecha text;
  v_version bigint;
  v_iniciada boolean;
begin
  if p_espacio is distinct from 'real-medina-del-campo-2026'
     or p_accion not in ('estado','guardar') or p_accion is null then
    raise exception 'ULIT Censo: solicitud fuera de alcance' using errcode='42501';
  end if;
  -- De momento sólo administración/coordinación. Sin permisos por metadatos del usuario.
  v_m := ulit_censo.exigir(p_espacio,array['administrador','coordinador']);
  if p_accion = 'guardar' then
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
      'alcance','fachada-vacios','respaldoAutomatico',true
    );
  end if;
  if p_version_esperada is null or p_version_esperada <> v_e.version then
    raise exception 'ULIT Censo: la base cambió; recarga antes de guardar' using errcode='PT409';
  end if;
  if p_registro_id is null or length(p_registro_id) not between 5 and 350
     or p_metros is null or length(p_metros) > 20
     or replace(pg_catalog.btrim(p_metros),',','.') !~ '^[0-9]{1,5}(\.[0-9]{1,3})?$'
     or replace(pg_catalog.btrim(p_metros),',','.')::numeric <= 0 then
    raise exception 'ULIT Censo: los metros deben ser positivos, con máximo 3 decimales' using errcode='22023';
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
  v_vacio := coalesce(v_reg->'original'->'vacio'->>'v',v_reg->'datos'->>'Local Vacío');
  if v_vacio <> '1' then
    raise exception 'ULIT Censo: sólo se guardan metros de locales vacíos' using errcode='42501';
  end if;
  select valor into v_ant from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='correccionesRegistros' and id=p_registro_id;
  if v_ant is not null and (v_ant->>'registroId' is distinct from p_registro_id
      or v_ant->>'campanaId' is distinct from v_camp
      or pg_catalog.jsonb_typeof(v_ant->'valores') is distinct from 'object'
      or pg_catalog.jsonb_typeof(v_ant->'historial') is distinct from 'array') then
    raise exception 'ULIT Censo: revisión anterior incoherente' using errcode='42501';
  end if;
  v_actual := coalesce(v_ant->'valores'->>'fachada',
    v_reg->'original'->'fachada'->>'v',
    v_reg->'datos'->>'Long fachada','');
  if replace(pg_catalog.btrim(v_actual),',','.') = replace(pg_catalog.btrim(p_metros),',','.') then
    raise exception 'ULIT Censo: los metros no han cambiado' using errcode='22023';
  end if;
  v_iniciada := exists(select 1 from ulit_censo.entidad
     where espacio_id=p_espacio and coleccion='correccionesRegistros');
  if not v_iniciada then
    -- Copia VIGENTE; hash, tamaño y pertenencia comprobados en servidor.
    -- Si la copia falla, la transacción se revierte entera: NO se guarda.
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
  v_vals := coalesce(v_ant->'valores','{}'::jsonb)
    || pg_catalog.jsonb_build_object('fachada',pg_catalog.btrim(p_metros));
  -- Si el nuevo valor es exactamente el del Excel, no conservar una capa redundante.
  if replace(coalesce(v_reg->'original'->'fachada'->>'v',v_reg->'datos'->>'Long fachada',''),',','.')
     = replace(pg_catalog.btrim(p_metros),',','.') then
    v_vals := v_vals - 'fachada';
  end if;
  v_nuevo := pg_catalog.jsonb_build_object(
    'id',p_registro_id,'registroId',p_registro_id,'campanaId',v_camp,
    'valores',v_vals,'fecha',v_fecha,'porId',v_m.persona_id,
    'motivo','Medición de fachada registrada desde Oficina',
    'historial',coalesce(v_ant->'historial','[]'::jsonb) ||
      (case when v_ant is null then '[]'::jsonb else
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'fecha',v_ant->>'fecha','porId',v_ant->>'porId','motivo',v_ant->>'motivo',
          'valoresAnteriores',v_ant->'valores')) end)
  );
  -- Apertura exclusivamente transaccional: queda cerrada incluso si falla.
  update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
  v_version := ulit_censo.aplicar_interno(v_m,p_espacio,p_version_esperada,
    'Oficina 2026 · metros fachada (corrección supervisada)',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'c','correccionesRegistros','id',p_registro_id,'v',v_nuevo)));
  update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio;
  return pg_catalog.jsonb_build_object(
    'version',v_version,'registroId',p_registro_id,'fachada',p_metros
  );
end;
$func$;

revoke all on function public.ulit_censo_fachada_2026(text,text,bigint,text,text)
  from public,anon,service_role;
grant execute on function public.ulit_censo_fachada_2026(text,text,bigint,text,text)
  to authenticated;
commit;
