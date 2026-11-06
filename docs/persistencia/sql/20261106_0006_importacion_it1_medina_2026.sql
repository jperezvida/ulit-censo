-- ULIT Censo · 0006 · IT1 Medina 2026, 105 filas. Aplicación completa.
-- No habilita la escritura general. No concede permisos hasta que una cuenta
-- administradora solicita la preparación con el SHA exacto del archivo validado.
-- La autorización es única y caduca; toda escritura se realiza atómicamente.
begin;

create table ulit_censo.autorizacion_it1_2026 (
 espacio_id text primary key references ulit_censo.espacio(id),
 usuario_id uuid not null references auth.users(id),
 version_esperada bigint not null check (version_esperada = 3),
 sha256_archivo text not null check (sha256_archivo = '7a6d4230a68370cc0bb0245ce68e8c56648be4d89e76531cc0edbd9ab341da61'),
 copia_id uuid not null references ulit_censo.copia(id),
 vigente_hasta timestamptz not null,
 creada_en timestamptz not null default now(),
 utilizada_en timestamptz,
 version_resultante bigint,
 constraint it1_una_vez check ((utilizada_en is null) = (version_resultante is null)),
 constraint it1_unico_espacio check (espacio_id = 'real-medina-del-campo-2026')
);
revoke all on table ulit_censo.autorizacion_it1_2026 from public, anon, authenticated, service_role;
alter table ulit_censo.autorizacion_it1_2026 enable row level security;

-- La misma guarda de subida de partes que protegía 2025 (v1) distingue ahora
-- únicamente el IT1 autorizado de 2026 (v3). Otros estados reales: RECHAZO.
create or replace function ulit_censo.validar_lote_historico_2025()
returns trigger
language plpgsql security definer set search_path = ''
as $guardia_unica_real$
declare
 a25 ulit_censo.autorizacion_historico_2025;
 a26 ulit_censo.autorizacion_it1_2026;
 e ulit_censo.espacio;
begin
 if new.espacio_id <> 'real-medina-del-campo-2026' then return new; end if;
 select * into e from ulit_censo.espacio where id=new.espacio_id;
 if e.tipo is distinct from 'real' or e.escritura_habilitada or e.preparacion_habilitada
    or new.usuario_id is distinct from auth.uid()
    or new.parte < 0 or new.parte >= 40
    or jsonb_array_length(new.cambios) > 2000
    or octet_length(new.cambios::text) > 2000000 then
   raise exception 'ULIT Censo: parte de lote real fuera de condiciones autorizadas' using errcode='42501';
 end if;
 if e.version=1 then
   select * into a25 from ulit_censo.autorizacion_historico_2025 where espacio_id=new.espacio_id;
   if not found or a25.usuario_id is distinct from auth.uid()
      or a25.utilizada_en is not null or a25.vigente_hasta <= now() then
     raise exception 'ULIT Censo: autorización del histórico 2025 requerida' using errcode='42501';
   end if;
 elsif e.version=3 then
   select * into a26 from ulit_censo.autorizacion_it1_2026 where espacio_id=new.espacio_id;
   if not found or a26.usuario_id is distinct from auth.uid()
      or a26.utilizada_en is not null or a26.vigente_hasta <= now() then
     raise exception 'ULIT Censo: autorización específica de IT1 2026 requerida' using errcode='42501';
   end if;
 else
   raise exception 'ULIT Censo: no se admiten lotes en este estado real' using errcode='42501';
 end if;
 return new;
end;
$guardia_unica_real$;

-- Preparación solicitada EXCLUSIVAMENTE por administración desde la aplicación
-- completa. Copia verificable v3 en la base y permiso efímero para ese SHA.
create function public.ulit_censo_preparar_it1_2026(p_espacio text, p_sha text, p_version bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $preparar_it1$
declare
 m ulit_censo.miembro;
 e ulit_censo.espacio;
 c ulit_censo.copia;
 v_contenido jsonb;
 v_texto text;
 v_copia uuid;
 v_camp constant text := 'real-camp-medina-2026-censo-medina-del-campo-2026';
begin
 if p_espacio is distinct from 'real-medina-del-campo-2026'
    or p_sha is distinct from '7a6d4230a68370cc0bb0245ce68e8c56648be4d89e76531cc0edbd9ab341da61'
    or p_version is distinct from 3 then
   raise exception 'ULIT Censo: origen o versión de IT1 no autorizados' using errcode='42501';
 end if;
 m := ulit_censo.exigir(p_espacio,array['administrador']);
 select * into e from ulit_censo.espacio where id=p_espacio for update;
 if e.version<>3 or e.tipo<>'real' or e.escritura_habilitada or e.preparacion_habilitada
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='registros')<>889
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='locales')<>696
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='campanas')<>2
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='importaciones')<>1
    or exists (select 1 from ulit_censo.entidad where espacio_id=p_espacio and coleccion='itinerarios')
    or not exists (select 1 from ulit_censo.entidad where espacio_id=p_espacio and coleccion='campanas' and id=v_camp
                   and valor->>'anio'='2026' and valor->>'tipo'='actualizacion') then
   raise exception 'ULIT Censo: el estado real no permite iniciar IT1' using errcode='42501';
 end if;
 if exists (select 1 from ulit_censo.autorizacion_it1_2026 where espacio_id=p_espacio) then
   raise exception 'ULIT Censo: IT1 ya dispone de autorización; no repetir la preparación' using errcode='42501';
 end if;
 -- Copia PRIVADA íntegra, comprobable y recuperable del estado exacto v3.
 v_contenido := jsonb_build_object('espacioId',p_espacio,'tipo','real','version',3,'entidades',ulit_censo.contenido(p_espacio));
 v_texto := v_contenido::text;
 insert into ulit_censo.copia (espacio_id,version,motivo,contenido,sha256,bytes,creada_por)
 values (p_espacio,3,'Automática PREVIA a IT1 2026 (105 filas) desde la aplicación completa',v_contenido,
         encode(sha256(convert_to(v_texto,'UTF8')),'hex'),octet_length(v_texto),auth.uid())
 returning id into v_copia;
 insert into ulit_censo.autorizacion_it1_2026
 (espacio_id,usuario_id,version_esperada,sha256_archivo,copia_id,vigente_hasta)
 values (p_espacio,auth.uid(),3,p_sha,v_copia,now()+interval '90 minutes');
 return jsonb_build_object('copia',v_copia,'version',3,'vence',now()+interval '90 minutes');
end;
$preparar_it1$;
revoke all on function public.ulit_censo_preparar_it1_2026(text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.ulit_censo_preparar_it1_2026(text,text,bigint) to authenticated;

create function public.ulit_censo_importar_it1_2026(
 p_espacio text,p_lote uuid,p_partes integer,p_version_esperada bigint,p_copia uuid
) returns bigint
language plpgsql security definer set search_path = ''
as $import_it1$
declare
 m ulit_censo.miembro;
 e ulit_censo.espacio;
 a ulit_censo.autorizacion_it1_2026;
 c ulit_censo.copia;
 v_n integer;
 v_partes integer;
 v_id_it text;
 v_id_imp text;
 v_it jsonb;
 v_imp jsonb;
 v_camp constant text := 'real-camp-medina-2026-censo-medina-del-campo-2026';
 v_suma bigint;
begin
 if p_espacio is distinct from 'real-medina-del-campo-2026' or p_version_esperada is distinct from 3
    or p_partes not between 1 and 40 or p_lote is null or p_copia is null then
   raise exception 'ULIT Censo: parámetros de IT1 no autorizados' using errcode='42501';
 end if;
 m := ulit_censo.exigir(p_espacio,array['administrador']);
 select * into e from ulit_censo.espacio where id=p_espacio for update;
 select * into a from ulit_censo.autorizacion_it1_2026 where espacio_id=p_espacio for update;
 if not found or a.usuario_id is distinct from auth.uid() or a.utilizada_en is not null
    or a.vigente_hasta<=now() or a.version_esperada<>3 or a.copia_id is distinct from p_copia
    or e.version<>3 or e.tipo<>'real' or e.escritura_habilitada or e.preparacion_habilitada then
   raise exception 'ULIT Censo: permiso IT1 consumido, caducado o estado incorrecto' using errcode='42501';
 end if;
 select * into c from ulit_censo.copia where id=p_copia and espacio_id=p_espacio;
 if not found or c.version<>3 or c.creada_por is distinct from auth.uid()
    or c.contenido->>'espacioId' is distinct from p_espacio
    or c.contenido->>'tipo' is distinct from 'real'
    or c.contenido->'entidades' is distinct from ulit_censo.contenido(p_espacio)
    or encode(sha256(convert_to(c.contenido::text,'UTF8')),'hex') is distinct from c.sha256 then
   raise exception 'ULIT Censo: copia previa de versión 3 incompleta o distinta del estado actual' using errcode='42501';
 end if;
 if (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='registros')<>889
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='locales')<>696
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='campanas')<>2
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='importaciones')<>1
    or exists (select 1 from ulit_censo.entidad where espacio_id=p_espacio and coleccion='itinerarios') then
   raise exception 'ULIT Censo: no coincide el estado inicial anterior a IT1' using errcode='42501';
 end if;
 select count(*) into v_partes from ulit_censo.lote_parte where lote=p_lote and espacio_id=p_espacio
    and usuario_id=auth.uid() and parte between 0 and p_partes-1;
 if v_partes<>p_partes
    or exists(select 1 from ulit_censo.lote_parte where lote=p_lote and
              (espacio_id<>p_espacio or usuario_id<>auth.uid() or parte >= p_partes)) then
   raise exception 'ULIT Censo: lote de IT1 incompleto o ajeno' using errcode='42501';
 end if;
 create temporary table _it1_cambios on commit drop as
 select x->>'c' as c, x->>'id' as id, nullif(x->'v','null'::jsonb) as v
 from ulit_censo.lote_parte p
 cross join lateral jsonb_array_elements(p.cambios) as t(x)
 where p.espacio_id=p_espacio and p.usuario_id=auth.uid() and p.lote=p_lote;
 select count(*) into v_n from pg_temp._it1_cambios;
 if v_n<212 or v_n>1500
    or (select count(*) from (select distinct c,id from pg_temp._it1_cambios) d)<>v_n
    or exists(select 1 from pg_temp._it1_cambios where v is null
       or jsonb_typeof(v)<>'object'
       or c not in ('_raiz','itinerarios','importaciones','registros','vinculos','locales',
                    'negocios','observaciones','ocupaciones','franquicias','digital','clasificaciones'))
    or exists(select 1 from pg_temp._it1_cambios x join ulit_censo.entidad y on
       y.espacio_id=p_espacio and y.coleccion=x.c and y.id=x.id where x.c<>'_raiz')
    or (select count(*) from pg_temp._it1_cambios where c='_raiz')<>1
    or exists(select 1 from pg_temp._it1_cambios x where x.c='_raiz' and
       (x.id<>'raiz' or
        (x.v - 'secuencia') is distinct from
          (select y.valor - 'secuencia' from ulit_censo.entidad y
           where y.espacio_id=p_espacio and y.coleccion='_raiz' and y.id='raiz') or
        coalesce(x.v->>'secuencia','') !~ '^[0-9]{1,12}
    or (select count(*) from pg_temp._it1_cambios where c='importaciones')<>1
    or (select count(*) from pg_temp._it1_cambios where c='registros')<>105
    or (select count(*) from pg_temp._it1_cambios where c='vinculos')<>105
    or (select count(*) from pg_temp._it1_cambios where c='locales')<>14
    or (select count(*) from pg_temp._it1_cambios where c='clasificaciones')<>0 then
   raise exception 'ULIT Censo: IT1 debe añadir 105 registros, 105 vínculos, 14 locales y ninguna entidad preexistente' using errcode='42501';
 end if;
 select id,v into v_id_it,v_it from pg_temp._it1_cambios where c='itinerarios';
 select id,v into v_id_imp,v_imp from pg_temp._it1_cambios where c='importaciones';
 if v_id_it not like 'real-it-%' or v_it->>'id' is distinct from v_id_it
    or v_it->>'campanaId' is distinct from v_camp or v_it->>'codigo' is distinct from 'IT1'
    or v_it->>'origen' is distinct from 'excel'
    or jsonb_array_length(coalesce(v_it->'tramos','[]'::jsonb))<>0
    or v_imp->>'id' is distinct from v_id_imp
    or v_imp->>'campanaId' is distinct from v_camp
    or v_imp->>'municipioId' is distinct from 'real-mun-medina'
    or v_imp->>'tipo' is distinct from 'C-excel-itinerario'
    or v_imp->>'estado' is distinct from 'confirmada'
    or v_imp->>'filas' is distinct from '105'
    or v_imp->>'huella' is distinct from a.sha256_archivo
    or v_imp->'c1'->>'sha256' is distinct from a.sha256_archivo
    or v_imp->'c1'->>'anio' is distinct from '2026'
    or v_imp->'c1'->'itinerario'->>'id' is distinct from v_id_it
    or v_imp->'c1'->'itinerario'->>'codigo' is distinct from 'IT1' then
   raise exception 'ULIT Censo: itinerario, campaña o metadatos SHA distintos de IT1 autorizado' using errcode='42501';
 end if;
 -- 105 filas originales; sin exclusión, cada una en ESTA importación y IT1.
 if (select count(distinct (v->>'fila')::integer) from pg_temp._it1_cambios
        where c='registros' and (v->>'fila') ~ '^[0-9]{1,4}$')<>105
    or exists(select 1 from pg_temp._it1_cambios
      where c='registros' and (v->>'importacionId' is distinct from v_id_imp
        or v->>'itinerarioId' is distinct from v_id_it
        or coalesce(v->>'fila','') !~ '^[0-9]{1,4}$'
        or (v->>'fila')::integer not between 2 and 106
        or v ? 'exclusion'))
    or exists(select 1 from pg_temp._it1_cambios x
       where x.c='vinculos' and (x.v->'origen'->>'tipo' is distinct from 'registro'
         or not exists(select 1 from pg_temp._it1_cambios r where r.c='registros'
                       and r.id=x.v->'origen'->>'id')))
    or exists(select 1 from pg_temp._it1_cambios r left join
        (select v->'origen'->>'id' as id,count(*) as n
         from pg_temp._it1_cambios where c='vinculos' group by 1) t on t.id=r.id
        where r.c='registros' and coalesce(t.n,0)<>1)
    or (select count(*) from pg_temp._it1_cambios where c='vinculos' and v->>'localId' is not null)<>14
    or exists(select 1 from pg_temp._it1_cambios x where x.c='vinculos' and x.v->>'localId' is not null
       and not exists(select 1 from pg_temp._it1_cambios y where y.c='locales' and y.id=x.v->>'localId')) then
   raise exception 'ULIT Censo: filas, vínculos o locales sin correspondencia segura para IT1' using errcode='42501';
 end if;
 if exists(select 1 from pg_temp._it1_cambios x where
        (x.c='locales' and (x.v->>'municipioId' is distinct from 'real-mun-medina'
          or x.v->>'procedencia' is distinct from 'importado'))
     or (x.c='observaciones' and (x.v->>'campanaId' is distinct from v_camp
          or x.v->>'itinerarioId' is distinct from v_id_it))
     or (x.c='ocupaciones' and (x.v->>'desdeCampanaId' is distinct from v_camp
          or x.v->>'hastaCampanaId' is distinct from v_camp))
     or (x.c in ('digital','franquicias','clasificaciones') and x.v->>'campanaId' is distinct from v_camp)) then
   raise exception 'ULIT Censo: entidades no pertenecientes exclusivamente a la campaña 2026' using errcode='42501';
 end if;
 -- La guarda general se abre SOLO dentro de esta transacción sin visibilidad externa.
 update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
 v_suma := ulit_censo.aplicar_interno(m,p_espacio,3,'IT1 Medina 2026: 105 filas reales autorizadas',(
   select jsonb_agg(jsonb_build_object('c',c,'id',id,'v',v))
   from pg_temp._it1_cambios
 ));
 if v_suma<>4 then raise exception 'ULIT Censo: versión final inesperada' using errcode='42501'; end if;
 update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio and version=4;
 if not found or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='registros')<>994
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='campanas')<>2
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='itinerarios')<>1
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='importaciones')<>2 then
   raise exception 'ULIT Censo: verificación final fallida; importación revertida' using errcode='42501';
 end if;
 update ulit_censo.autorizacion_it1_2026
   set utilizada_en=now(),version_resultante=4 where espacio_id=p_espacio and utilizada_en is null;
 delete from ulit_censo.lote_parte where espacio_id=p_espacio and lote=p_lote and usuario_id=auth.uid();
 return v_suma;
end;
$import_it1$;
revoke all on function public.ulit_censo_importar_it1_2026(text,uuid,integer,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ulit_censo_importar_it1_2026(text,uuid,integer,bigint,uuid) to authenticated;

commit;
 or
        (x.v->>'secuencia')::bigint <=
          (select (y.valor->>'secuencia')::bigint from ulit_censo.entidad y
           where y.espacio_id=p_espacio and y.coleccion='_raiz' and y.id='raiz')))
    or (select count(*) from pg_temp._it1_cambios where c='itinerarios')<>1
    or (select count(*) from pg_temp._it1_cambios where c='importaciones')<>1
    or (select count(*) from pg_temp._it1_cambios where c='registros')<>105
    or (select count(*) from pg_temp._it1_cambios where c='vinculos')<>105
    or (select count(*) from pg_temp._it1_cambios where c='locales')<>14
    or (select count(*) from pg_temp._it1_cambios where c='clasificaciones')<>0 then
   raise exception 'ULIT Censo: IT1 debe añadir 105 registros, 105 vínculos, 14 locales y ninguna entidad preexistente' using errcode='42501';
 end if;
 select id,v into v_id_it,v_it from pg_temp._it1_cambios where c='itinerarios';
 select id,v into v_id_imp,v_imp from pg_temp._it1_cambios where c='importaciones';
 if v_id_it not like 'real-it-%' or v_it->>'id' is distinct from v_id_it
    or v_it->>'campanaId' is distinct from v_camp or v_it->>'codigo' is distinct from 'IT1'
    or v_it->>'origen' is distinct from 'excel'
    or jsonb_array_length(coalesce(v_it->'tramos','[]'::jsonb))<>0
    or v_imp->>'id' is distinct from v_id_imp
    or v_imp->>'campanaId' is distinct from v_camp
    or v_imp->>'municipioId' is distinct from 'real-mun-medina'
    or v_imp->>'tipo' is distinct from 'C-excel-itinerario'
    or v_imp->>'estado' is distinct from 'confirmada'
    or v_imp->>'filas' is distinct from '105'
    or v_imp->>'huella' is distinct from a.sha256_archivo
    or v_imp->'c1'->>'sha256' is distinct from a.sha256_archivo
    or v_imp->'c1'->>'anio' is distinct from '2026'
    or v_imp->'c1'->'itinerario'->>'id' is distinct from v_id_it
    or v_imp->'c1'->'itinerario'->>'codigo' is distinct from 'IT1' then
   raise exception 'ULIT Censo: itinerario, campaña o metadatos SHA distintos de IT1 autorizado' using errcode='42501';
 end if;
 -- 105 filas originales; sin exclusión, cada una en ESTA importación y IT1.
 if (select count(distinct (v->>'fila')::integer) from pg_temp._it1_cambios
        where c='registros' and (v->>'fila') ~ '^[0-9]{1,4}$')<>105
    or exists(select 1 from pg_temp._it1_cambios
      where c='registros' and (v->>'importacionId' is distinct from v_id_imp
        or v->>'itinerarioId' is distinct from v_id_it
        or coalesce(v->>'fila','') !~ '^[0-9]{1,4}$'
        or (v->>'fila')::integer not between 2 and 106
        or v ? 'exclusion'))
    or exists(select 1 from pg_temp._it1_cambios x
       where x.c='vinculos' and (x.v->'origen'->>'tipo' is distinct from 'registro'
         or not exists(select 1 from pg_temp._it1_cambios r where r.c='registros'
                       and r.id=x.v->'origen'->>'id')))
    or exists(select 1 from pg_temp._it1_cambios r left join
        (select v->'origen'->>'id' as id,count(*) as n
         from pg_temp._it1_cambios where c='vinculos' group by 1) t on t.id=r.id
        where r.c='registros' and coalesce(t.n,0)<>1)
    or (select count(*) from pg_temp._it1_cambios where c='vinculos' and v->>'localId' is not null)<>14
    or exists(select 1 from pg_temp._it1_cambios x where x.c='vinculos' and x.v->>'localId' is not null
       and not exists(select 1 from pg_temp._it1_cambios y where y.c='locales' and y.id=x.v->>'localId')) then
   raise exception 'ULIT Censo: filas, vínculos o locales sin correspondencia segura para IT1' using errcode='42501';
 end if;
 if exists(select 1 from pg_temp._it1_cambios x where
        (x.c='locales' and (x.v->>'municipioId' is distinct from 'real-mun-medina'
          or x.v->>'procedencia' is distinct from 'importado'))
     or (x.c='observaciones' and (x.v->>'campanaId' is distinct from v_camp
          or x.v->>'itinerarioId' is distinct from v_id_it))
     or (x.c='ocupaciones' and (x.v->>'desdeCampanaId' is distinct from v_camp
          or x.v->>'hastaCampanaId' is distinct from v_camp))
     or (x.c in ('digital','franquicias','clasificaciones') and x.v->>'campanaId' is distinct from v_camp)) then
   raise exception 'ULIT Censo: entidades no pertenecientes exclusivamente a la campaña 2026' using errcode='42501';
 end if;
 -- La guarda general se abre SOLO dentro de esta transacción sin visibilidad externa.
 update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
 v_suma := ulit_censo.aplicar_interno(m,p_espacio,3,'IT1 Medina 2026: 105 filas reales autorizadas',(
   select jsonb_agg(jsonb_build_object('c',c,'id',id,'v',v))
   from pg_temp._it1_cambios
 ));
 if v_suma<>4 then raise exception 'ULIT Censo: versión final inesperada' using errcode='42501'; end if;
 update ulit_censo.espacio set escritura_habilitada=false where id=p_espacio and version=4;
 if not found or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='registros')<>994
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='campanas')<>2
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='itinerarios')<>1
    or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio and coleccion='importaciones')<>2 then
   raise exception 'ULIT Censo: verificación final fallida; importación revertida' using errcode='42501';
 end if;
 update ulit_censo.autorizacion_it1_2026
   set utilizada_en=now(),version_resultante=4 where espacio_id=p_espacio and utilizada_en is null;
 delete from ulit_censo.lote_parte where espacio_id=p_espacio and lote=p_lote and usuario_id=auth.uid();
 return v_suma;
end;
$import_it1$;
revoke all on function public.ulit_censo_importar_it1_2026(text,uuid,integer,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ulit_censo_importar_it1_2026(text,uuid,integer,bigint,uuid) to authenticated;

commit;
