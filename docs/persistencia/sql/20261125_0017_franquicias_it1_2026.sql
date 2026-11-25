-- 0017 · Franquicias por registro del Excel IT1/2026; sin exigir vínculo físico.
-- Instalar tras 0016. No escribe datos reales al instalarse.
-- Solo funciones autenticadas de administrador/coordinador, sin abrir escrituras genéricas.
begin;

create or replace function ulit_censo.coleccion_valida(c text)
returns boolean language sql immutable set search_path = ''
as $lista$
  select c = any(array[
    '_raiz','municipios','calles','campanas','itinerarios','coberturas','situacionesPrevias',
    'callesRevisadasPlan','locales','negocios','ocupaciones','observaciones','registros','vinculos',
    'importaciones','revisiones','digital','clasificaciones','franquicias',
    'oficinaItinerarios','personas','correccionesRegistros',
    'revisionesCategoriaRegistros','revisionesFranquiciaRegistros'
  ]);
$lista$;

create or replace function public.ulit_censo_franquicias_it1_2026(
  p_espacio text, p_accion text, p_version_esperada bigint, p_ids text[],
  p_respuesta text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
set statement_timeout = '60s'
as $func$
declare
  v_m ulit_censo.miembro;
  v_e ulit_censo.espacio;
  v_camp constant text := 'real-camp-medina-2026-censo-medina-del-campo-2026';
  v_it constant text := 'real-it-medina-2026-censo-medina-del-c-it1';
  v_id text;
  v_reg jsonb;
  v_imp jsonb;
  v_corr jsonb;
  v_prev jsonb;
  v_excel text;
  v_respuesta text;
  v_estado text;
  v_revision jsonb;
  v_revisiones jsonb := '[]'::jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_copia uuid;
  v_version bigint;
  v_fecha text;
begin
  if p_espacio is distinct from 'real-medina-del-campo-2026'
    or p_accion is null or p_accion not in
      ('estado','aceptar','rechazar','resolver','aceptar-todas') then
    raise exception 'ULIT Censo: revisión de franquicias fuera de alcance'
      using errcode = '42501';
  end if;
  v_m := ulit_censo.exigir(p_espacio, array['administrador','coordinador']);
  if p_accion = 'estado' then
    select * into v_e from ulit_censo.espacio where id=p_espacio;
  else
    select * into v_e from ulit_censo.espacio where id=p_espacio for update;
  end if;
  if not found or v_e.tipo <> 'real' or v_e.version < 8
    or v_e.escritura_habilitada or v_e.preparacion_habilitada
    or not exists(select 1 from ulit_censo.entidad where espacio_id=p_espacio
      and coleccion='campanas' and id=v_camp and valor->>'anio'='2026') then
    raise exception 'ULIT Censo: estado del censo real no verificable'
      using errcode='42501';
  end if;
  if p_accion = 'estado' then
    return pg_catalog.jsonb_build_object(
      'habilitada',true,'version',v_e.version,'alcance','it1-franquicias-supervisadas');
  end if;
  if p_version_esperada is null or p_version_esperada <> v_e.version then
    raise exception 'ULIT Censo: hay otra versión; recarga antes de guardar'
      using errcode='PT409';
  end if;
  if p_ids is null or pg_catalog.array_length(p_ids,1) is null
    or pg_catalog.array_length(p_ids,1) > 200
    or (select count(distinct a.id) from pg_catalog.unnest(p_ids) as a(id)) <> pg_catalog.array_length(p_ids,1)
    or exists(select 1 from pg_catalog.unnest(p_ids) as a(id) where a.id is null or length(a.id) not between 5 and 350)
    or (p_accion <> 'aceptar-todas' and pg_catalog.array_length(p_ids,1) <> 1)
    or (p_accion='resolver' and (p_respuesta is null or p_respuesta not in ('si','no')))
    or (p_accion <> 'resolver' and p_respuesta is not null) then
    raise exception 'ULIT Censo: decisión de franquicia inválida'
      using errcode='22023';
  end if;

  v_fecha := pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  foreach v_id in array p_ids loop
    select valor into v_reg from ulit_censo.entidad
      where espacio_id=p_espacio and coleccion='registros' and id=v_id;
    if v_reg is null or v_reg ? 'exclusion'
      or v_reg->>'itinerarioId' is distinct from v_it then
      raise exception 'ULIT Censo: registro ajeno a IT1'
        using errcode='42501';
    end if;
    select valor into v_imp from ulit_censo.entidad
      where espacio_id=p_espacio and coleccion='importaciones'
        and id=v_reg->>'importacionId';
    if v_imp is null or v_imp->>'campanaId' is distinct from v_camp
      or v_imp->>'estado' is distinct from 'confirmada'
      or v_imp->>'tipo' not in ('C-excel-itinerario','D-actualizacion') then
      raise exception 'ULIT Censo: el Excel IT1 no está confirmado'
        using errcode='42501';
    end if;
    select valor into v_corr from ulit_censo.entidad
      where espacio_id=p_espacio and coleccion='correccionesRegistros' and id=v_id;
    if coalesce(v_corr->'valores'->>'vacio',
      v_reg->'original'->'vacio'->>'v',v_reg->'datos'->>'Local Vacío') <> '0' then
      raise exception 'ULIT Censo: no se revisan franquicias de locales vacíos'
        using errcode='42501';
    end if;
    select valor into v_prev from ulit_censo.entidad
      where espacio_id=p_espacio and coleccion='revisionesFranquiciaRegistros' and id=v_id;
    if v_prev is not null and (v_prev->>'registroId' is distinct from v_id
      or v_prev->>'campanaId' is distinct from v_camp) then
      raise exception 'ULIT Censo: decisión anterior no verificable' using errcode='42501';
    end if;
    v_excel := pg_catalog.btrim(coalesce(v_corr->'valores'->>'franquicia',
      v_reg->'original'->'franquicia'->>'v',v_reg->'datos'->>'Franquicia',''));
    if p_accion in ('aceptar','rechazar','aceptar-todas') and v_excel not in ('0','1') then
      raise exception 'ULIT Censo: el Excel no tiene una propuesta 0/1'
        using errcode='22023';
    end if;
    if p_accion='aceptar-todas' and v_prev is not null then
      raise exception 'ULIT Censo: la propuesta cambió; revisa antes de confirmar todas'
        using errcode='PT409';
    end if;
    v_estado := case p_accion
      when 'aceptar' then 'aceptada' when 'aceptar-todas' then 'aceptada'
      when 'rechazar' then 'rechazada' else 'corregida' end;
    v_respuesta := case p_accion
      when 'aceptar' then case v_excel when '1' then 'si' else 'no' end
      when 'aceptar-todas' then case v_excel when '1' then 'si' else 'no' end
      when 'resolver' then p_respuesta else null end;
    if v_prev is not null and v_prev->>'estado'=v_estado
      and v_prev->>'respuesta' is not distinct from v_respuesta then
      raise exception 'ULIT Censo: esta decisión ya está guardada' using errcode='22023';
    end if;
    v_revision := pg_catalog.jsonb_build_object(
      'id',v_id,'registroId',v_id,'campanaId',v_camp,'estado',v_estado,
      'porId',v_m.persona_id,'fecha',v_fecha,
      'masiva',(p_accion='aceptar-todas')
    );
    if v_respuesta is not null then
      v_revision := v_revision || pg_catalog.jsonb_build_object('respuesta',v_respuesta);
    end if;
    v_revisiones := v_revisiones || pg_catalog.jsonb_build_array(v_revision);
    v_ops := v_ops || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'c','revisionesFranquiciaRegistros','id',v_id,'v',v_revision));
  end loop;

  -- Primera decisión de franquicias: respaldo íntegro con versión y huella verificadas.
  if not exists(select 1 from ulit_censo.entidad
      where espacio_id=p_espacio and coleccion='revisionesFranquiciaRegistros') then
    v_copia := public.ulit_censo_crear_copia(
      p_espacio,'Copia previa a revisar franquicias IT1/2026');
    if not exists(select 1 from ulit_censo.copia
        where id=v_copia and espacio_id=p_espacio and version=v_e.version
          and sha256 ~ '^[a-f0-9]{64}$' and bytes>0
          and contenido->>'version'=v_e.version::text
          and contenido->>'espacioId'=p_espacio) then
      raise exception 'ULIT Censo: copia previa no verificable' using errcode='42501';
    end if;
  end if;
  update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
  v_version := ulit_censo.aplicar_interno(v_m,p_espacio,p_version_esperada,
    'Oficina 2026 · IT1 · ' || p_accion || ' franquicias',v_ops);
  update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio;
  return pg_catalog.jsonb_build_object(
    'version',v_version,'accion',p_accion,'revisiones',v_revisiones);
end;
$func$;

revoke all on function public.ulit_censo_franquicias_it1_2026(text,text,bigint,text[],text)
  from public,anon,service_role;
grant execute on function public.ulit_censo_franquicias_it1_2026(text,text,bigint,text[],text)
  to authenticated;
commit;
