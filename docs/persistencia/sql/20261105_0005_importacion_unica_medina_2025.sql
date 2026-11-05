-- ULIT Censo · 0005 PROPUESTA: un solo censo histórico real de Medina 2025.
-- NO APLICAR EN PRODUCCIÓN SIN AUTORIZACIÓN EXPRESA, NUEVO RESPALDO Y REVISIÓN E2E.
-- Nunca deja escritura_habilitada=true en una transacción confirmada.
-- La autorización se introduce EXCLUSIVAMENTE por administración SQL, no por el navegador.
begin;

create table ulit_censo.autorizacion_historico_2025 (
  espacio_id text primary key references ulit_censo.espacio(id),
  usuario_id uuid not null references auth.users(id),
  version_esperada bigint not null check (version_esperada = 1),
  sha256_archivo text not null check (sha256_archivo ~ '^[a-f0-9]{64}$'),
  vigente_hasta timestamptz not null,
  motivo text not null check (length(motivo) between 15 and 500),
  autorizada_en timestamptz not null default now(),
  utilizada_en timestamptz,
  version_resultante bigint,
  constraint autoriza_una_vez check ((utilizada_en is null) = (version_resultante is null)),
  constraint autoriza_medina_unica check (espacio_id = 'real-medina-del-campo-2026')
);
revoke all on table ulit_censo.autorizacion_historico_2025 from public,anon,authenticated,service_role;
alter table ulit_censo.autorizacion_historico_2025 enable row level security;

-- Solo la RPC limitada puede activar brevemente la guarda genérica DENTRO de su
-- propia transacción. Otros clientes no observan nunca el estado abierto.
create function public.ulit_censo_importar_historico_2025(
  p_espacio text, p_lote uuid, p_partes integer, p_version_esperada bigint, p_copia uuid
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  m ulit_censo.miembro;
  e ulit_censo.espacio;
  a ulit_censo.autorizacion_historico_2025;
  copia ulit_censo.copia;
  n_partes integer;
  n integer;
  n_reg integer;
  n_vin integer;
  id_camp text;
  id_import text;
  x_import jsonb;
  x_camp jsonb;
  version_final bigint;
begin
  if p_espacio is distinct from 'real-medina-del-campo-2026' then
    raise exception 'ULIT Censo: operación de Medina 2025 solamente' using errcode='42501';
  end if;
  -- Solo el usuario Auth autorizado, con coordinación/administración vigente.
  m := ulit_censo.exigir(p_espacio, array['coordinador','administrador']);
  select * into e from ulit_censo.espacio where id=p_espacio for update;
  select * into a from ulit_censo.autorizacion_historico_2025
    where espacio_id=p_espacio for update;
  if not found or a.utilizada_en is not null or a.usuario_id is distinct from auth.uid()
      or a.vigente_hasta <= now() then
    raise exception 'ULIT Censo: autorización específica inexistente, consumida, caducada o de otra cuenta' using errcode='42501';
  end if;
  if e.tipo <> 'real' or e.preparacion_habilitada or e.escritura_habilitada
      or e.version <> 1 or p_version_esperada <> 1 or a.version_esperada <> 1 then
    raise exception 'ULIT Censo: espacio real no está exactamente en su estado inicial cerrado (v1)' using errcode='42501';
  end if;
  if p_partes is null or p_partes < 1 or p_partes > 999 or p_lote is null or p_copia is null then
    raise exception 'ULIT Censo: lote o copia incompletos' using errcode='22023';
  end if;
  -- No permitir que se incorporen otra vez datos ni actualizar calles/municipio.
  if (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='calles') <> 254
     or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='municipios' and id='real-mun-medina') <> 1
     or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='_raiz' and id='raiz') <> 1
     or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='personas') <> 1
     or exists (select 1 from ulit_censo.entidad where espacio_id=p_espacio
                 and coleccion not in ('_raiz','personas','municipios','calles')) then
    raise exception 'ULIT Censo: el espacio contiene datos ajenos a la primera incorporación' using errcode='42501';
  end if;

  -- La copia debe ser la instantánea intacta de v1, de este mismo espacio y actor.
  select * into copia from ulit_censo.copia where id=p_copia and espacio_id=p_espacio;
  if not found or copia.version <> 1 or copia.creada_por is distinct from auth.uid()
      or copia.contenido ->> 'espacioId' is distinct from p_espacio
      or copia.contenido ->> 'tipo' is distinct from 'real'
      or copia.contenido -> 'entidades' is distinct from ulit_censo.contenido(p_espacio)
      or encode(sha256(convert_to(copia.contenido::text,'UTF8')),'hex') is distinct from copia.sha256 then
    raise exception 'ULIT Censo: falta copia recuperable idéntica al estado v1' using errcode='42501';
  end if;

  select count(*) into n_partes from ulit_censo.lote_parte
    where lote=p_lote and espacio_id=p_espacio and usuario_id=auth.uid()
      and parte between 0 and p_partes-1;
  if n_partes <> p_partes
     or exists (select 1 from ulit_censo.lote_parte
                where lote=p_lote and (espacio_id <> p_espacio or usuario_id <> auth.uid() or parte >= p_partes)) then
    raise exception 'ULIT Censo: lote incompleto o ajeno' using errcode='22023';
  end if;

  create temporary table _h25_cambios on commit drop as
    select elemento.x ->> 'c' as c, elemento.x ->> 'id' as id,
           nullif(elemento.x -> 'v', 'null'::jsonb) as v
    from ulit_censo.lote_parte p
    cross join lateral jsonb_array_elements(p.cambios) as elemento(x)
    where p.lote=p_lote and p.espacio_id=p_espacio and p.usuario_id=auth.uid();

  select count(*) into n from pg_temp._h25_cambios;
  if n < 1780 or n > 13000
     or (select count(*) from (select distinct c,id from pg_temp._h25_cambios) d) <> n
     or exists (select 1 from pg_temp._h25_cambios
                where v is null or c not in
                   ('_raiz','campanas','registros','locales','negocios','observaciones',
                    'ocupaciones','vinculos','franquicias','digital','clasificaciones','importaciones'))
     or (select count(*) from pg_temp._h25_cambios where c='_raiz') > 1
     or exists (select 1 from pg_temp._h25_cambios h join ulit_censo.entidad d
               on d.espacio_id=p_espacio and d.coleccion=h.c and d.id=h.id
               where h.c <> '_raiz') then
    raise exception 'ULIT Censo: el lote no es una incorporación nueva y exclusiva' using errcode='42501';
  end if;

  select count(*) into n_reg from pg_temp._h25_cambios where c='registros';
  select count(*) into n_vin from pg_temp._h25_cambios where c='vinculos';
  if n_reg <> 889 or n_vin <> 889
     or (select count(*) from pg_temp._h25_cambios where c='campanas') <> 1
     or (select count(*) from pg_temp._h25_cambios where c='importaciones') <> 1
     or (select count(*) from pg_temp._h25_cambios where c='clasificaciones') <> 0 then
    raise exception 'ULIT Censo: se exigen 889 registros, 889 vínculos, una campaña e importación sin clasificación forzada'
       using errcode='42501';
  end if;

  select id,v into id_camp,x_camp from pg_temp._h25_cambios where c='campanas';
  select id,v into id_import,x_import from pg_temp._h25_cambios where c='importaciones';
  if x_camp ->> 'tipo' is distinct from 'historico-importado'
     or x_camp ->> 'municipioId' is distinct from 'real-mun-medina'
     or x_camp ->> 'anio' is distinct from '2025'
     or x_camp -> 'periodo' ->> 'inicio' is distinct from '2024-01-01'
     or x_camp -> 'periodo' ->> 'fin' is distinct from '2025-12-31'
     or x_import ->> 'campanaId' is distinct from id_camp
     or x_import ->> 'municipioId' is distinct from 'real-mun-medina'
     or x_import ->> 'tipo' is distinct from 'A-censo-historico'
     or x_import ->> 'estado' is distinct from 'confirmada'
     or x_import ->> 'filas' is distinct from '889'
     or x_import ->> 'huella' is distinct from a.sha256_archivo
     or x_import -> 'c1' ->> 'sha256' is distinct from a.sha256_archivo
     or x_import -> 'c1' ->> 'hoja' is distinct from 'Datos'
     or x_import -> 'c1' ->> 'anio' is distinct from '2025'
     or jsonb_typeof(x_import -> 'c1' -> 'columnas') is distinct from 'array'
     or jsonb_array_length(x_import -> 'c1' -> 'columnas') <> 27
     or x_import -> 'c1' -> 'decisiones' -> 'periodoTrabajo' ->> 'desde' is distinct from '2024-01-01'
     or x_import -> 'c1' -> 'decisiones' -> 'periodoTrabajo' ->> 'hasta' is distinct from '2025-12-31' then
    raise exception 'ULIT Censo: metadatos históricos, fechas o huella distintos de la autorización' using errcode='42501';
  end if;

  -- Cada número de fila 2..890 exactamente una vez y todas en la misma importación.
  if (select count(distinct (v ->> 'fila')::integer) from pg_temp._h25_cambios
      where c='registros' and (v ->> 'fila') ~ '^[0-9]{1,4}$') <> 889
     or exists (select 1 from pg_temp._h25_cambios
                where c='registros' and (
                 v ->> 'importacionId' is distinct from id_import
                 or coalesce(v ->> 'fila','') !~ '^[0-9]{1,4}$'
                 or (v ->> 'fila')::integer not between 2 and 890
                 or v ? 'exclusion'))
     or exists (select 1 from pg_temp._h25_cambios h
                where h.c='vinculos' and (
                  h.v -> 'origen' ->> 'tipo' is distinct from 'registro'
                  or not exists (select 1 from pg_temp._h25_cambios r
                                 where r.c='registros' and r.id=h.v -> 'origen' ->> 'id')))
     -- 889 vínculos no bastan: debe existir EXACTAMENTE UNO por registro.
     -- Evita 889 vínculos dirigidos todos a una misma fila dejando 888 sin trazabilidad.
     or exists (
       select 1
         from pg_temp._h25_cambios r
         left join (
           select v -> 'origen' ->> 'id' as registro_id, count(*) as n
           from pg_temp._h25_cambios
           where c='vinculos'
           group by v -> 'origen' ->> 'id'
         ) v on v.registro_id=r.id
        where r.c='registros' and coalesce(v.n,0) <> 1
     ) then
    raise exception 'ULIT Censo: faltan filas originales o hay vínculos/exclusiones incoherentes' using errcode='42501';
  end if;

  -- El único periodo durante el que escritura_habilitada=true permanece DENTRO
  -- de esta transacción SQL; Postgres no permite observar estados no confirmados.
  update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
  version_final := ulit_censo.aplicar_interno(
    m, p_espacio, p_version_esperada,
    'ÚNICA incorporación autorizada del histórico 2025 (889 filas)',
    (select coalesce(jsonb_agg(jsonb_build_object('c',c,'id',id,'v',v)), '[]'::jsonb) from pg_temp._h25_cambios)
  );
  if version_final <> 2 then
    raise exception 'ULIT Censo: versión final inesperada' using errcode='42501';
  end if;

  update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio and version=2;
  update ulit_censo.autorizacion_historico_2025
     set utilizada_en=now(), version_resultante=version_final
   where espacio_id=p_espacio and utilizada_en is null;
  delete from ulit_censo.lote_parte where lote=p_lote and espacio_id=p_espacio and usuario_id=auth.uid();
  return version_final;
end;
$$;
revoke all on function public.ulit_censo_importar_historico_2025(text,uuid,integer,bigint,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.ulit_censo_importar_historico_2025(text,uuid,integer,bigint,uuid)
  to authenticated;
commit;
