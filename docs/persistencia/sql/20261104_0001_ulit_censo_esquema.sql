-- ULIT Censo · Migración PROPUESTA 0001 · Esquema privado `ulit_censo`.
-- NO APLICADA. Requiere autorización expresa antes de ejecutarse en el Supabase compartido.
--
-- Principios:
--  * Solo CREA objetos nuevos dentro del esquema `ulit_censo`. No altera ninguna tabla, función, política
--    ni permiso existente de ULIT base (sigue el precedente de `ulit_go`: esquema privado sin privilegios
--    para ningún rol de la API; acceso solo mediante funciones `public.ulit_censo_*`, migración 0002).
--  * El esquema NO se expone en la API (no se cambia la configuración «Exposed schemas»).
--  * El acceso a ULIT Censo NO se deriva de `public.perfiles` ni de `es_admin_base_catedra()`: una
--    cuenta de Supabase Auth solo entra si figura en `ulit_censo.miembro`.

begin;

create schema ulit_censo;
comment on schema ulit_censo is
  'ULIT Censo: datos privados (espacios de ensayo y real). Sin acceso directo desde la API; solo mediante public.ulit_censo_*.';
revoke all on schema ulit_censo from public, anon, authenticated, service_role;

-- Espacio de trabajo (ensayo o real). La escritura del espacio real está deshabilitada por defecto.
create table ulit_censo.espacio (
  id text primary key check (id ~ '^(ensayo|real)-[a-z0-9-]{3,80}$'),
  tipo text not null check (tipo in ('ensayo', 'real')),
  nombre text not null check (length(nombre) between 1 and 120),
  version bigint not null default 0 check (version >= 0),
  escritura_habilitada boolean not null default false,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  constraint espacio_prefijo check (id like tipo || '-%'),
  -- Un espacio de ensayo siempre admite escritura; el real solo cuando se autorice la confirmación real.
  constraint espacio_ensayo_escribible check (tipo = 'real' or escritura_habilitada)
);

-- Pertenencia: quién puede ver o modificar cada espacio, con qué rol y qué persona ULIT representa.
create table ulit_censo.miembro (
  espacio_id text not null references ulit_censo.espacio (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  rol text not null check (rol in ('administrador', 'coordinador', 'revisor', 'investigador', 'lector')),
  persona_id text not null check (length(persona_id) between 1 and 120),
  alta_por uuid,
  alta_en timestamptz not null default now(),
  baja_en timestamptz,
  primary key (espacio_id, usuario_id)
);
create index miembro_usuario on ulit_censo.miembro (usuario_id) where baja_en is null;

-- Colecciones de la BaseDatos de ULIT Censo (una fila por entidad). `_raiz` guarda los valores escalares
-- (version del modelo, secuencia, meta, colaSync…). Lista cerrada: cualquier otra se rechaza.
create function ulit_censo.coleccion_valida(c text) returns boolean
language sql immutable set search_path = '' as $$
  select c = any (array[
    '_raiz', 'municipios', 'calles', 'campanas', 'itinerarios', 'coberturas', 'situacionesPrevias',
    'callesRevisadasPlan', 'locales', 'negocios', 'ocupaciones', 'observaciones', 'registros', 'vinculos',
    'importaciones', 'revisiones', 'digital', 'clasificaciones', 'franquicias', 'oficinaItinerarios', 'personas'
  ]);
$$;
revoke all on function ulit_censo.coleccion_valida(text) from public, anon, authenticated, service_role;

-- Estado vigente: una fila por entidad (documento JSON con el mismo formato que usa la aplicación).
-- Columnas derivadas e indexadas para consultas y, en 2027, para permisos por campaña o itinerario.
create table ulit_censo.entidad (
  espacio_id text not null references ulit_censo.espacio (id) on delete cascade,
  coleccion text not null check (ulit_censo.coleccion_valida(coleccion)),
  id text not null check (length(id) between 1 and 400),
  valor jsonb not null,
  version bigint not null,
  actualizado_por uuid,
  actualizado_en timestamptz not null default now(),
  campana_id text generated always as (valor ->> 'campanaId') stored,
  itinerario_id text generated always as (valor ->> 'itinerarioId') stored,
  local_id text generated always as (valor ->> 'localId') stored,
  primary key (espacio_id, coleccion, id)
);
create index entidad_campana on ulit_censo.entidad (espacio_id, campana_id) where campana_id is not null;
create index entidad_itinerario on ulit_censo.entidad (espacio_id, itinerario_id) where itinerario_id is not null;
create index entidad_local on ulit_censo.entidad (espacio_id, local_id) where local_id is not null;
create index entidad_negocio on ulit_censo.entidad (espacio_id, (valor ->> 'negocioId')) where coleccion = 'ocupaciones';

-- Registro de operaciones (una por guardado): quién, cuándo, qué etiqueta y qué versión produjo.
create table ulit_censo.operacion (
  id bigint generated always as identity primary key,
  espacio_id text not null references ulit_censo.espacio (id) on delete cascade,
  version bigint not null,
  tipo text not null default 'cambio' check (tipo in ('cambio', 'restauracion', 'carga-inicial')),
  etiqueta text not null check (length(etiqueta) between 1 and 300),
  usuario_id uuid not null,
  persona_id text not null,
  n_cambios integer not null check (n_cambios >= 0),
  en timestamptz not null default now(),
  unique (espacio_id, version)
);

-- Historial por entidad: valor anterior y nuevo de cada cambio (solo se añade; nunca se modifica).
create table ulit_censo.entidad_historial (
  operacion_id bigint not null references ulit_censo.operacion (id) on delete cascade,
  espacio_id text not null,
  coleccion text not null,
  id text not null,
  valor_anterior jsonb,
  valor_nuevo jsonb,
  primary key (operacion_id, coleccion, id)
);
create index historial_entidad on ulit_censo.entidad_historial (espacio_id, coleccion, id);

-- Copias de seguridad PROPIAS de ULIT Censo (independientes de las copias del proyecto compartido).
create table ulit_censo.copia (
  id uuid primary key default gen_random_uuid(),
  espacio_id text not null references ulit_censo.espacio (id) on delete cascade,
  version bigint not null,
  motivo text not null check (length(motivo) between 1 and 300),
  contenido jsonb not null,
  sha256 text not null,
  bytes integer not null,
  creada_por uuid not null,
  creada_en timestamptz not null default now()
);
create index copia_espacio on ulit_censo.copia (espacio_id, creada_en desc);

-- Inmutabilidad del historial, las operaciones y las copias (ni siquiera las funciones las modifican).
create function ulit_censo.impedir_cambio() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'ULIT Censo: % es de solo añadir', tg_table_name using errcode = '42501';
end;
$$;
revoke all on function ulit_censo.impedir_cambio() from public, anon, authenticated, service_role;
create trigger historial_inmutable before update or delete on ulit_censo.entidad_historial
  for each row execute function ulit_censo.impedir_cambio();
create trigger operacion_inmutable before update or delete on ulit_censo.operacion
  for each row execute function ulit_censo.impedir_cambio();
create trigger copia_inmutable before update on ulit_censo.copia
  for each row execute function ulit_censo.impedir_cambio();

-- Sin privilegios para los roles de la API y RLS activada sin políticas (defensa en profundidad:
-- aunque algún día se concediera un privilegio por error, no se vería ninguna fila). No se usa FORCE:
-- las funciones SECURITY DEFINER, propiedad del rol que aplica la migración, deben poder leer y escribir.
do $$
declare t text;
begin
  foreach t in array array['espacio', 'miembro', 'entidad', 'operacion', 'entidad_historial', 'copia'] loop
    execute format('revoke all on table ulit_censo.%I from public, anon, authenticated, service_role', t);
    execute format('alter table ulit_censo.%I enable row level security', t);
  end loop;
end;
$$;
alter default privileges in schema ulit_censo revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema ulit_censo revoke all on functions from public, anon, authenticated, service_role;
alter default privileges in schema ulit_censo revoke all on sequences from public, anon, authenticated, service_role;

commit;
