-- 0016 · Revisión obligatoria de la clasificación de los OCUPADOS de IT1/2026.
-- Nunca requiere vincular el registro a un local; nunca modifica el Excel original.
-- El resto de itinerarios, 2025 y las escrituras genéricas permanecen cerrados.
begin;
-- Registrar la nueva colección en la lista blanca de entidades de ULIT.
create or replace function ulit_censo.coleccion_valida(c text)
returns boolean language sql immutable set search_path = ''
as $lista$
  select c = any(array[
    '_raiz','municipios','calles','campanas','itinerarios','coberturas','situacionesPrevias',
    'callesRevisadasPlan','locales','negocios','ocupaciones','observaciones','registros','vinculos',
    'importaciones','revisiones','digital','clasificaciones','franquicias',
    'oficinaItinerarios','personas','correccionesRegistros','revisionesCategoriaRegistros'
  ]);
$lista$;

create or replace function public.ulit_censo_categorizar_it1_2026(
  p_espacio text, p_accion text, p_version_esperada bigint,
  p_registro_id text, p_valores jsonb
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
  v_reg jsonb;
  v_imp jsonb;
  v_prev jsonb;
  v_corr jsonb;
  v_actual jsonb := '{}'::jsonb;
  v_nuevo jsonb;
  v_copia uuid;
  v_version bigint;
  v_campo text;
  v_original text;
  v_efectivo text;
  v_claves constant text[] := array[
    'grupoActividad','grupoComercio','subgrupo','actividad','descripcionActividad'
  ];
begin
  if p_espacio is distinct from 'real-medina-del-campo-2026'
     or p_accion is null or p_accion not in ('estado','aceptar','rechazar','corregir') then
    raise exception 'ULIT Censo: categorización fuera de alcance' using errcode='42501';
  end if;
  v_m := ulit_censo.exigir(p_espacio, array['administrador','coordinador']);
  if p_accion='estado' then
    select * into v_e from ulit_censo.espacio where id=p_espacio;
  else
    select * into v_e from ulit_censo.espacio where id=p_espacio for update;
  end if;
  if not found or v_e.tipo <> 'real' or v_e.version < 8
     or v_e.escritura_habilitada or v_e.preparacion_habilitada
     or not exists(select 1 from ulit_censo.entidad where espacio_id=p_espacio
       and coleccion='campanas' and id=v_camp and valor->>'anio'='2026') then
    raise exception 'ULIT Censo: datos reales de 2026 no verificables' using errcode='42501';
  end if;
  if p_accion='estado' then
    return pg_catalog.jsonb_build_object('habilitada',true,'motivo','',
      'version',v_e.version,'alcance','it1-categorias-supervisadas');
  end if;
  if p_version_esperada is null or p_version_esperada <> v_e.version then
    raise exception 'ULIT Censo: hay otra versión; recarga antes de guardar'
      using errcode='PT409';
  end if;
  if p_registro_id is null or length(p_registro_id) not between 5 and 350
     or p_valores is null or pg_catalog.jsonb_typeof(p_valores) <> 'object'
     or (select count(*) from pg_catalog.jsonb_object_keys(p_valores)) <> 5 then
    raise exception 'ULIT Censo: clasificación incompleta' using errcode='22023';
  end if;
  foreach v_campo in array v_claves loop
    if pg_catalog.jsonb_typeof(p_valores->v_campo) is distinct from 'string'
       or length(p_valores->>v_campo) > 300
       or (p_valores->>v_campo) is distinct from pg_catalog.btrim(p_valores->>v_campo) then
      raise exception 'ULIT Censo: campo de categoría incorrecto (%)',v_campo
        using errcode='22023';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_object_keys(p_valores) as x(k)
      where k <> all(v_claves)) then
    raise exception 'ULIT Censo: columna no permitida' using errcode='22023';
  end if;
  select valor into v_reg from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='registros' and id=p_registro_id;
  if v_reg is null or v_reg ? 'exclusion'
     or v_reg->>'itinerarioId' is distinct from v_it then
    raise exception 'ULIT Censo: el registro no es de IT1' using errcode='42501';
  end if;
  select valor into v_imp from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='importaciones'
      and id=v_reg->>'importacionId';
  if v_imp is null or v_imp->>'campanaId' is distinct from v_camp
     or v_imp->>'estado' is distinct from 'confirmada'
     or v_imp->>'tipo' not in ('C-excel-itinerario','D-actualizacion') then
    raise exception 'ULIT Censo: el Excel IT1 no está confirmado' using errcode='42501';
  end if;
  select valor into v_corr from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='correccionesRegistros' and id=p_registro_id;
  if coalesce(v_corr->'valores'->>'vacio',
    v_reg->'original'->'vacio'->>'v',v_reg->'datos'->>'Local Vacío') <> '0' then
    raise exception 'ULIT Censo: los locales vacíos no se categorizan' using errcode='42501';
  end if;
  select valor into v_prev from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='revisionesCategoriaRegistros'
      and id=p_registro_id;
  if v_prev is not null and (v_prev->>'registroId' is distinct from p_registro_id
    or v_prev->>'campanaId' is distinct from v_camp) then
    raise exception 'ULIT Censo: revisión anterior inválida' using errcode='42501';
  end if;
  -- Valores de origen fieles: Fase 1 prevalece (limpieza o corrección).
  -- Si existe una categorización corregida para 2026, es la vigente.
  foreach v_campo in array v_claves loop
    v_original := case v_campo
      when 'grupoActividad' then 'GrActividad'
      when 'grupoComercio' then 'Gr Comercio'
      when 'subgrupo' then 'Subgrupo de actividad'
      when 'actividad' then 'Actividad'
      else 'Descripción'
    end;
    v_efectivo := coalesce(v_corr->'valores'->>v_campo,
      case when v_prev->>'estado'='corregida'
        then v_prev->'valores'->>v_campo end,
      v_reg->'original'->v_campo->>'v',
      v_reg->'datos'->>v_original, '');
    v_actual := v_actual || pg_catalog.jsonb_build_object(v_campo,pg_catalog.btrim(v_efectivo));
  end loop;
  if p_accion in ('aceptar','rechazar') then
    if not exists(select 1 from pg_catalog.jsonb_each_text(v_actual) as a
        where pg_catalog.btrim(a.value)<>'') then
      raise exception 'ULIT Censo: no hay categoría que aceptar o rechazar' using errcode='22023';
    end if;
    if p_valores is distinct from v_actual then
      raise exception 'ULIT Censo: la propuesta cambió; revisa de nuevo' using errcode='PT409';
    end if;
  elsif p_accion='corregir' then
    if p_valores->>'grupoActividad' not in ('Comercio','Servicios','Hostelería y Restauración')
      or pg_catalog.btrim(p_valores->>'subgrupo')=''
      or (p_valores->>'grupoActividad'='Comercio'
        and pg_catalog.btrim(p_valores->>'grupoComercio')='')
      or (p_valores->>'grupoActividad'<>'Comercio'
        and p_valores->>'grupoComercio'<>'') then
      raise exception 'ULIT Censo: selecciona una categoría oficial de 2026 coherente'
        using errcode='22023';
    end if;
  end if;
  if v_prev is not null and v_prev->'valores'=p_valores
     and v_prev->>'estado'=(case p_accion when 'aceptar' then 'aceptada'
       when 'rechazar' then 'rechazada' else 'corregida' end) then
    raise exception 'ULIT Censo: esta decisión ya está guardada' using errcode='22023';
  end if;

  -- Respaldo verificable al iniciar el trabajo con la NUEVA colección.
  if not exists(select 1 from ulit_censo.entidad
      where espacio_id=p_espacio and coleccion='revisionesCategoriaRegistros') then
    v_copia := public.ulit_censo_crear_copia(
      p_espacio,'Copia previa a iniciar la categorización IT1/2026');
    if not exists(select 1 from ulit_censo.copia
        where id=v_copia and espacio_id=p_espacio and version=v_e.version
          and sha256 ~ '^[a-f0-9]{64}$' and bytes>0
          and contenido->>'version'=v_e.version::text
          and contenido->>'espacioId'=p_espacio) then
      raise exception 'ULIT Censo: copia previa no verificable' using errcode='42501';
    end if;
  end if;
  v_nuevo := pg_catalog.jsonb_build_object(
    'id',p_registro_id,'registroId',p_registro_id,'campanaId',v_camp,
    'estado',case p_accion when 'aceptar' then 'aceptada'
      when 'rechazar' then 'rechazada' else 'corregida' end,
    'valores',p_valores,'porId',v_m.persona_id,
    'fecha',pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
  v_version := ulit_censo.aplicar_interno(v_m,p_espacio,p_version_esperada,
    'Oficina 2026 · IT1 · ' || p_accion || ' categorización',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'c','revisionesCategoriaRegistros','id',p_registro_id,'v',v_nuevo)));
  update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio;
  return pg_catalog.jsonb_build_object(
    'version',v_version,'registroId',p_registro_id,'accion',p_accion,'revision',v_nuevo);
end;
$func$;

revoke all on function public.ulit_censo_categorizar_it1_2026(text,text,bigint,text,jsonb)
  from public,anon,service_role;
grant execute on function public.ulit_censo_categorizar_it1_2026(text,text,bigint,text,jsonb)
  to authenticated;
commit;
