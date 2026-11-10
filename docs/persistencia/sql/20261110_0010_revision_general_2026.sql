-- ULIT Censo · PROPUESTA 0010: correcciones supervisadas de coherencia 2026.
-- BORRADOR: no aplicar a Supabase real sin auditoría, restauración ensayada y autorización.
-- Este archivo no altera ningún Excel ni RegistroOrigen; las correcciones son otra colección.
-- Requiere el esquema de persistencia y las importaciones 2026 ya instaladas.
begin;

-- Autorización administrativa INDEPENDIENTE, desactivada por defecto.
-- No se inserta ninguna fila aquí: habilitarla exige auditoría y permiso posterior.
create table if not exists ulit_censo.autorizacion_revision_general_2026 (
  espacio_id text primary key references ulit_censo.espacio(id),
  habilitada boolean not null default false,
  autorizada_por uuid,
  autorizada_en timestamptz,
  motivo text,
  constraint autorizacion_revision_consistente
    check (not habilitada or (autorizada_por is not null and autorizada_en is not null
      and length(coalesce(nullif(btrim(motivo),''),'')) >= 8))
);
alter table ulit_censo.autorizacion_revision_general_2026 enable row level security;
revoke all on ulit_censo.autorizacion_revision_general_2026 from public,anon,authenticated,service_role;

-- Entidad privada adicional, incluida en las copias y en la lectura normal del espacio.
-- Ampliamos la lista explícita completa; nunca concedemos DML sobre las tablas.
create or replace function ulit_censo.coleccion_valida(c text)
returns boolean language sql immutable set search_path = ''
as $func$
  select c = any (array[
    '_raiz', 'municipios', 'calles', 'campanas', 'itinerarios', 'coberturas', 'situacionesPrevias',
    'callesRevisadasPlan', 'locales', 'negocios', 'ocupaciones', 'observaciones', 'registros', 'vinculos',
    'importaciones', 'revisiones', 'digital', 'clasificaciones', 'franquicias',
    'oficinaItinerarios', 'personas', 'correccionesRegistros'
  ]);
$func$;

-- El revisor puede introducir anotaciones de revisión de esta campaña;
-- la RPC y el espacio cerrado siguen siendo la única vía de escritura real.
create or replace function ulit_censo.colecciones_de_rol(p_rol text)
returns text[] language sql immutable set search_path = ''
as $func$
  select case p_rol
    when 'revisor' then array['locales', 'negocios', 'ocupaciones', 'observaciones', 'vinculos',
      'revisiones', 'digital', 'clasificaciones', 'franquicias', 'coberturas', 'correccionesRegistros']
    when 'investigador' then array['observaciones', 'ocupaciones', 'negocios', 'revisiones', 'coberturas']
    else array[]::text[] end;
$func$;

create function public.ulit_censo_revision_general_2026(
  p_espacio text,
  p_accion text,
  p_version_esperada bigint,
  p_registro_id text,
  p_valores jsonb,
  p_motivo text
) returns jsonb
language plpgsql security definer set search_path = ''
as $revision$
declare
  m ulit_censo.miembro;
  e ulit_censo.espacio;
  v_camp constant text := 'real-camp-medina-2026-censo-medina-del-campo-2026';
  v_reg jsonb;
  v_imp jsonb;
  v_ant jsonb;
  v_nuevo jsonb;
  v_ahora text;
  v_nueva bigint;
  v_estado text;
  v_backup boolean;
  v_iniciada boolean;
  v_autorizada boolean;
  v_clave text;
  v_valor jsonb;
  v_permitidas constant text[] := array[
    'vacio', 'fachada', 'nombre', 'grupoActividad', 'grupoComercio', 'subgrupo', 'actividad',
    'descripcionActividad', 'franquicia', 'web', 'googleBusiness', 'ventaOnline',
    'numResenas', 'respondeResenas', 'instagram', 'seguidoresInstagram',
    'facebook', 'seguidoresFacebook', 'twitter', 'seguidoresTwitter', 'numRedes'
  ];
  v_binarias constant text[] := array[
    'vacio', 'franquicia', 'web', 'googleBusiness', 'ventaOnline', 'respondeResenas',
    'instagram', 'facebook', 'twitter'
  ];
  v_enteras constant text[] := array[
    'numResenas', 'seguidoresInstagram', 'seguidoresFacebook', 'seguidoresTwitter', 'numRedes'
  ];
begin
  if p_espacio is distinct from 'real-medina-del-campo-2026'
     or p_accion is null or p_accion not in ('estado','guardar') then
    raise exception 'ULIT Censo: petición ajena a la revisión 2026'
      using errcode = '42501';
  end if;

  m := ulit_censo.exigir(p_espacio, array['administrador','coordinador','revisor']);
  if p_accion = 'estado' then
    select * into e from ulit_censo.espacio where id=p_espacio;
  else
    select * into e from ulit_censo.espacio where id=p_espacio for update;
  end if;
  if not found or e.tipo <> 'real' or e.version < 8
     or e.escritura_habilitada or e.preparacion_habilitada then
    raise exception 'ULIT Censo: revisión fuera de un espacio real cerrado compatible'
      using errcode = '42501';
  end if;
  if not exists (select 1 from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='campanas' and id=v_camp
    and valor->>'anio'='2026') then
    raise exception 'ULIT Censo: campaña 2026 no verificable' using errcode = '42501';
  end if;

  select exists(select 1 from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='correccionesRegistros')
  into v_iniciada;
  select exists(select 1 from ulit_censo.copia
    where espacio_id=p_espacio and version=e.version
    and sha256 ~ '^[0-9a-f]{64}$' and bytes > 0
    and contenido->>'espacioId'=p_espacio
    and contenido->>'tipo'='real'
    and contenido->>'version'=e.version::text
    and pg_catalog.jsonb_typeof(contenido->'entidades')='object')
  into v_backup;

  select exists(select 1 from ulit_censo.autorizacion_revision_general_2026
    where espacio_id=p_espacio and habilitada and autorizada_por is not null)
  into v_autorizada;

  -- Antes de la PRIMERA corrección, respaldo exactamente de la versión vigente.
  -- Las siguientes correcciones cuentan con ese respaldo inicial y el historial
  -- atómico de entidad_historial y operacion para cada revisión.
  if p_accion = 'estado' then
    return pg_catalog.jsonb_build_object('habilitada', v_autorizada and (v_iniciada or v_backup),
      'version',e.version,'motivo',case
        when not v_autorizada then 'El guardado de esta fase aún no ha recibido autorización administrativa.'
        when v_iniciada or v_backup then ''
        else 'Falta una copia íntegra de la versión actual antes de guardar la primera corrección.' end);
  end if;

  if not v_autorizada then
    raise exception 'ULIT Censo: la fase de corrección no está autorizada'
      using errcode='42501';
  end if;
  if not (v_iniciada or v_backup) then
    raise exception 'ULIT Censo: falta respaldo de la versión actual, sin cambios'
      using errcode='42501';
  end if;
  if p_version_esperada is null or e.version <> p_version_esperada then
    raise exception 'ULIT Censo: versión desactualizada, recargue antes de guardar'
      using errcode='PT409';
  end if;
  if p_registro_id is null or length(p_registro_id) not between 5 and 350
     or p_valores is null or pg_catalog.jsonb_typeof(p_valores) <> 'object'
     or pg_catalog.octet_length(p_valores::text) > 10000
     or p_motivo is null or length(pg_catalog.btrim(p_motivo)) not between 8 and 400 then
    raise exception 'ULIT Censo: corrección o motivo con formato incorrecto'
      using errcode='22023';
  end if;

  select valor into v_reg from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='registros' and id=p_registro_id;
  select valor into v_imp from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='importaciones'
      and id=v_reg->>'importacionId';
  if v_reg is null or v_reg ? 'exclusion' or v_imp is null
     or v_imp->>'campanaId' <> v_camp or v_imp->>'estado' <> 'confirmada'
     or v_imp->>'tipo' not in ('C-excel-itinerario','D-actualizacion')
     or not exists (
       select 1 from ulit_censo.entidad
       where espacio_id=p_espacio and coleccion='itinerarios'
         and id=v_reg->>'itinerarioId'
         and valor->>'campanaId'=v_camp
     ) then
    raise exception 'ULIT Censo: registro fuera de la campaña e itinerarios autorizados'
      using errcode='42501';
  end if;

  -- Lista blanca de campos, únicamente valores string acotados.
  for v_clave, v_valor in
    select key,value from pg_catalog.jsonb_each(p_valores)
  loop
    if not (v_clave = any(v_permitidas))
       or pg_catalog.jsonb_typeof(v_valor) is distinct from 'string'
       or length(v_valor #>> '{}') > 500 then
      raise exception 'ULIT Censo: campo no corregible (%).',v_clave using errcode='22023';
    end if;
    v_estado := v_valor #>> '{}';
    if v_clave = 'vacio' and v_estado not in ('0','1') then
      raise exception 'ULIT Censo: estado vacío sólo 0/1' using errcode='22023';
    end if;
    if v_clave = any(v_binarias) and v_clave <> 'vacio' and v_estado not in ('','0','1') then
      raise exception 'ULIT Censo: indicador binario incorrecto (%)',v_clave using errcode='22023';
    end if;
    if v_clave = any(v_enteras) and v_estado <> ''
       and (v_estado !~ '^[0-9]{1,8}$') then
      raise exception 'ULIT Censo: contador incorrecto (%)',v_clave using errcode='22023';
    end if;
    if v_clave = 'fachada' and v_estado <> ''
       and (replace(v_estado,',','.') !~ '^[0-9]{1,5}(\.[0-9]{1,3})?$'
         or (replace(v_estado,',','.'))::numeric <= 0) then
      raise exception 'ULIT Censo: metros de fachada incorrectos' using errcode='22023';
    end if;
  end loop;

  select valor into v_ant from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='correccionesRegistros' and id=p_registro_id;
  if v_ant is not null
     and (v_ant->>'registroId' is distinct from p_registro_id
       or v_ant->>'campanaId' is distinct from v_camp
       or pg_catalog.jsonb_typeof(v_ant->'valores') is distinct from 'object'
       or pg_catalog.jsonb_typeof(v_ant->'historial') is distinct from 'array') then
    raise exception 'ULIT Censo: revisión previa corrupta, requiere soporte'
      using errcode='42501';
  end if;
  if v_ant is null and p_valores = '{}'::jsonb then
    raise exception 'ULIT Censo: no se puede registrar una corrección vacía'
      using errcode='22023';
  end if;
  if v_ant->'valores' = p_valores then
    raise exception 'ULIT Censo: la propuesta no tiene cambios' using errcode='22023';
  end if;
  v_ahora := pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_nuevo := pg_catalog.jsonb_build_object(
    'id',p_registro_id,'registroId',p_registro_id,'campanaId',v_camp,
    'valores',p_valores,'motivo',pg_catalog.btrim(p_motivo),
    'porId',m.persona_id,'fecha',v_ahora,
    'historial',coalesce(v_ant->'historial','[]'::jsonb) ||
      case when v_ant is null then '[]'::jsonb else
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'fecha',v_ant->>'fecha','porId',v_ant->>'porId','motivo',v_ant->>'motivo',
          'valoresAnteriores',v_ant->'valores')) end
  );
  -- El único elemento aplicado es la nueva entidad de correcciones.
  -- No se aceptan cambios genéricos enviados por el cliente.
  update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
  v_nueva := ulit_censo.aplicar_interno(m,p_espacio,p_version_esperada,
    'Oficina · Fase 1 · revisión de registro 2026',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'c','correccionesRegistros','id',p_registro_id,'v',v_nuevo)));
  update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio;

  return pg_catalog.jsonb_build_object('version',v_nueva,'registroId',p_registro_id);
end;
$revision$;

revoke all on function public.ulit_censo_revision_general_2026(text,text,bigint,text,jsonb,text)
  from public,anon,service_role;
grant execute on function public.ulit_censo_revision_general_2026(text,text,bigint,text,jsonb,text)
  to authenticated;

commit;
