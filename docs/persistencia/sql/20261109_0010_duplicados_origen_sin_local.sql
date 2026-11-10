-- ULIT Censo · 0010 · Duplicados de origen sin local
-- PR #22. Sustituye únicamente el cuerpo de RPC 0009.
-- Los duplicados con local vinculado siguen rechazados; los registros
-- sin local se conservan íntegros y sin deduplicación automática.
-- No inserta ni modifica datos de censo ni habilita escritura general.
begin;
create or replace function public.ulit_censo_importar_excel_2026(
  p_espacio text, p_version_esperada bigint, p_codigo text,
  p_sha text, p_parte_adicional boolean, p_cambios jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $fn$
declare
 m ulit_censo.miembro; e ulit_censo.espacio;
 v_camp constant text := 'real-camp-medina-2026-censo-medina-del-campo-2026';
 v_it text; v_it_json jsonb; v_imp text; v_imp_json jsonb;
 v_antes jsonb; v_copia uuid; v_version bigint;
 v_root jsonb; v_root_old jsonb;
 v_importaciones_previas integer;
 v_registros integer; v_vinculos integer; v_locales integer;
 v_cambios integer; v_col text; v_nombres text; v_no_validos integer;
begin
 if p_espacio is distinct from 'real-medina-del-campo-2026'
  or p_codigo is null or p_codigo !~ '^IT[1-9][0-9]{0,2}$'
  or p_sha is null or p_sha !~ '^[a-f0-9]{64}$'
  or p_parte_adicional is null
  or p_version_esperada is null or p_version_esperada<4
  or jsonb_typeof(p_cambios) is distinct from 'array'
  or octet_length(p_cambios::text)>3800000 then
   raise exception 'ULIT Censo: parámetros de Excel 2026 no válidos'
     using errcode='22023';
 end if;
 v_cambios := jsonb_array_length(p_cambios);
 if v_cambios<3 or v_cambios>3000 then
   raise exception 'ULIT Censo: el Excel excede los límites de esta operación segura'
     using errcode='22023';
 end if;
 m := ulit_censo.exigir(p_espacio,array['administrador','coordinador']);
 select * into e from ulit_censo.espacio where id=p_espacio for update;
 if not found or e.tipo is distinct from 'real'
  or e.escritura_habilitada or e.preparacion_habilitada then
   raise exception 'ULIT Censo: el espacio debe estar cerrado antes de incorporar'
     using errcode='42501';
 end if;
 if e.version<>p_version_esperada then
   raise exception 'ULIT Censo: el servidor cambió desde el análisis'
     using errcode='PT409';
 end if;
 if not exists (select 1 from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='campanas' and id=v_camp
      and valor->>'tipo'='actualizacion' and valor->>'anio'='2026') then
   raise exception 'ULIT Censo: falta la campaña real 2026'
     using errcode='42501';
 end if;

 -- El lote es exclusivamente de INSERT, salvo el aumento de secuencia
 -- que forma parte del modelo normalizado. NUNCA incluye cambios a 2025.
 create temporary table _it_excel_c on commit drop as
   select x->>'c' as c, x->>'id' as id, x->'v' as v
   from jsonb_array_elements(p_cambios) as t(x);
 if (select count(*) from (select distinct c,id from pg_temp._it_excel_c) t)<>v_cambios
   or exists (select 1 from pg_temp._it_excel_c x where
      coalesce(x.id,'')='' or length(x.id)>400
      or x.c not in ('_raiz','itinerarios','importaciones','registros','vinculos',
        'locales','negocios','observaciones','ocupaciones','digital','franquicias','clasificaciones')
      or jsonb_typeof(x.v) is distinct from 'object'
      or (x.c<>'_raiz' and coalesce(x.v->>'id','')<>x.id and
          x.c in ('itinerarios','importaciones','registros','vinculos',
                  'locales','negocios','observaciones','ocupaciones')))
   or exists (select 1 from pg_temp._it_excel_c x join ulit_censo.entidad actual
        on actual.espacio_id=p_espacio and actual.coleccion=x.c
        and actual.id=x.id where x.c<>'_raiz') then
   raise exception 'ULIT Censo: la operación contiene duplicados, borrados o entidades preexistentes'
     using errcode='42501';
 end if;
 if (select count(*) from pg_temp._it_excel_c where c='_raiz' and id='raiz')
        is distinct from (select count(*) from pg_temp._it_excel_c where c='_raiz')
    or (select count(*) from pg_temp._it_excel_c where c='_raiz')>1 then
   raise exception 'ULIT Censo: modificación no válida de la raíz'
     using errcode='42501';
 end if;
 select v into v_root from pg_temp._it_excel_c where c='_raiz';
 select valor into v_root_old from ulit_censo.entidad
  where espacio_id=p_espacio and coleccion='_raiz' and id='raiz';
 if v_root_old is null or
    (v_root is not null and (
      (v_root - 'secuencia') is distinct from (v_root_old - 'secuencia')
      or coalesce(v_root->>'secuencia','') !~ '^[0-9]{1,12}$'
      or (v_root->>'secuencia')::bigint <= coalesce((v_root_old->>'secuencia')::bigint,0))) then
    raise exception 'ULIT Censo: la raíz contiene cambios ajenos a la secuencia'
      using errcode='42501';
 end if;

 -- IT nuevo: UNA entidad nueva. IT existente: NINGUNA, sin alterarlo.
 if (select count(*) from pg_temp._it_excel_c where c='itinerarios')>1
  or (select count(*) from pg_temp._it_excel_c where c='importaciones')<>1 then
   raise exception 'ULIT Censo: se acepta un Excel por operación e itinerario'
     using errcode='42501';
 end if;
 select id,v into v_it,v_it_json from pg_temp._it_excel_c where c='itinerarios';
 if v_it is null then
   select id,valor into v_it,v_it_json from ulit_censo.entidad
    where espacio_id=p_espacio and coleccion='itinerarios'
      and valor->>'campanaId'=v_camp and valor->>'codigo'=p_codigo;
   if not found then
     raise exception 'ULIT Censo: itinerario inexistente' using errcode='42501';
   end if;
 else
   if p_parte_adicional or v_it_json->>'campanaId' is distinct from v_camp
     or v_it_json->>'codigo' is distinct from p_codigo
     or v_it_json->>'origen' is distinct from 'excel'
     or v_it not like 'real-it-%' then
     raise exception 'ULIT Censo: itinerario nuevo no válido' using errcode='42501';
   end if;
   if exists(select 1 from ulit_censo.entidad where espacio_id=p_espacio
      and coleccion='itinerarios' and valor->>'campanaId'=v_camp
      and valor->>'codigo'=p_codigo) then
     raise exception 'ULIT Censo: código de itinerario ya utilizado'
       using errcode='42501';
   end if;
 end if;
 select count(*) into v_importaciones_previas
  from ulit_censo.entidad imp
  where imp.espacio_id=p_espacio and imp.coleccion='importaciones'
    and imp.valor->>'campanaId'=v_camp and imp.valor->>'estado'='confirmada'
    and imp.valor->'c1'->'itinerario'->>'id'=v_it;
 if (v_importaciones_previas>0) is distinct from p_parte_adicional then
   raise exception 'ULIT Censo: indique correctamente si se trata de una parte adicional'
     using errcode='42501';
 end if;
 select id,v into v_imp,v_imp_json from pg_temp._it_excel_c where c='importaciones';
 select count(*) into v_registros from pg_temp._it_excel_c where c='registros';
 select count(*) into v_vinculos from pg_temp._it_excel_c where c='vinculos';
 select count(*) into v_locales from pg_temp._it_excel_c where c='locales';
 if v_registros<1 or v_registros>700 or v_vinculos<>v_registros
   or v_imp_json->>'id' is distinct from v_imp
   or v_imp_json->>'tipo' is distinct from 'C-excel-itinerario'
   or v_imp_json->>'campanaId' is distinct from v_camp
   or v_imp_json->>'municipioId' is distinct from 'real-mun-medina'
   or v_imp_json->>'estado' is distinct from 'confirmada'
   or v_imp_json->>'huella' is distinct from p_sha
   or v_imp_json->'c1'->>'sha256' is distinct from p_sha
   or v_imp_json->'c1'->>'anio' is distinct from '2026'
   or v_imp_json->'c1'->'itinerario'->>'id' is distinct from v_it
   or v_imp_json->'c1'->'itinerario'->>'codigo' is distinct from p_codigo
   or v_imp_json->>'filas' is distinct from v_registros::text
   or exists(select 1 from ulit_censo.entidad
     where espacio_id=p_espacio and coleccion='importaciones'
       and valor->>'campanaId'=v_camp and valor->>'huella'=p_sha) then
   raise exception 'ULIT Censo: origen del Excel, huella o número de filas incompatible'
     using errcode='42501';
 end if;
 -- No inventar correspondencias: TODO vínculo nuevo apunta a un local
 -- creado en la misma importación, o queda pendiente sin local.
 if exists(select 1 from pg_temp._it_excel_c r where r.c='registros'
     and (r.v->>'id' is distinct from r.id
       or r.v->>'itinerarioId' is distinct from v_it
       or r.v->>'importacionId' is distinct from v_imp
       or jsonb_typeof(r.v->'datos') is distinct from 'object'
       or coalesce(r.v->>'fila','') !~ '^[0-9]{1,4}$'
       or (r.v->>'fila')::int not between 2 and 5000))
   or (select count(distinct (v->>'fila')::int) from pg_temp._it_excel_c where c='registros')<>v_registros
   or exists(select 1 from pg_temp._it_excel_c vin where vin.c='vinculos' and
     (vin.v->'origen'->>'tipo' is distinct from 'registro'
      or not exists(select 1 from pg_temp._it_excel_c reg
          where reg.c='registros' and reg.id=vin.v->'origen'->>'id')
      or (vin.v->>'localId' is not null
          and not exists(select 1 from pg_temp._it_excel_c l
            where l.c='locales' and l.id=vin.v->>'localId'))))
   or exists(select 1 from pg_temp._it_excel_c reg
     where reg.c='registros' and
       (select count(*) from pg_temp._it_excel_c vin
        where vin.c='vinculos' and vin.v->'origen'->>'id'=reg.id)<>1) then
   raise exception 'ULIT Censo: registros o vínculos no verificables'
      using errcode='42501';
 end if;

 -- Las nuevas entidades nunca quedan asociadas a 2025. Integridad mínima
 -- de callejero, locales, observaciones y ocupaciones; sin cierre histórico.
 if exists(select 1 from pg_temp._it_excel_c x where
   (x.c='locales' and (
      x.v->>'municipioId' is distinct from 'real-mun-medina'
      or x.v->>'procedencia' is distinct from 'importado'
      or jsonb_typeof(x.v->'direcciones') is distinct from 'array'
      or jsonb_array_length(x.v->'direcciones')<1
      or exists(select 1 from jsonb_array_elements(x.v->'direcciones') d
        where not exists(select 1 from ulit_censo.entidad calle
          where calle.espacio_id=p_espacio and calle.coleccion='calles'
          and calle.id=d->>'calleId' and calle.valor->>'municipioId'='real-mun-medina'))))
   or (x.c='observaciones' and (
      x.v->>'campanaId' is distinct from v_camp
      or x.v->>'itinerarioId' is distinct from v_it
      or not exists(select 1 from pg_temp._it_excel_c reg
        where reg.c='registros' and reg.id=x.v->>'registroId')
      or not exists(select 1 from ulit_censo.entidad calle
        where calle.espacio_id=p_espacio and calle.coleccion='calles'
          and calle.id=x.v->>'calleId' and calle.valor->>'municipioId'='real-mun-medina')
      or (x.v->>'localId' is not null and not exists(
        select 1 from pg_temp._it_excel_c l where l.c='locales'
          and l.id=x.v->>'localId'))))
   or (x.c='ocupaciones' and (
      x.v->>'desdeCampanaId' is distinct from v_camp
      or (x.v->>'hastaCampanaId' is not null and x.v->>'hastaCampanaId' is distinct from v_camp)
      or not exists(select 1 from pg_temp._it_excel_c l where l.c='locales'
        and l.id=x.v->>'localId')
      or not exists(select 1 from pg_temp._it_excel_c o
        where o.c='observaciones' and o.id=x.v->>'desdeObservacionId')
      or (x.v->>'negocioId' is not null and not exists(
        select 1 from pg_temp._it_excel_c n where n.c='negocios' and n.id=x.v->>'negocioId'))))
   or (x.c in ('digital','franquicias','clasificaciones') and (
      x.v->>'campanaId' is distinct from v_camp
      or not exists(select 1 from pg_temp._it_excel_c n where n.c='negocios'
        and n.id=x.v->>'negocioId')))) then
   raise exception 'ULIT Censo: hay relaciones no verificables o ajenas a 2026'
     using errcode='42501';
 end if;
 -- Coherencia de vínculo / observación / negocio / ocupación.
 if exists (
   select 1 from pg_temp._it_excel_c obs
   left join pg_temp._it_excel_c vin on vin.c='vinculos'
     and vin.v->'origen'->>'id'=obs.v->>'registroId'
   where obs.c='observaciones' and (
     vin.id is null
     or obs.v->>'localId' is distinct from vin.v->>'localId'
     or jsonb_typeof(obs.v->'datos') is distinct from 'object'
     or (obs.v->'datos'->>'negocioId' is not null
       and not exists (select 1 from pg_temp._it_excel_c n
           where n.c='negocios' and n.id=obs.v->'datos'->>'negocioId')
       and not exists (select 1 from ulit_censo.entidad n
           where n.espacio_id=p_espacio and n.coleccion='negocios'
             and n.id=obs.v->'datos'->>'negocioId'))
   )
 ) or exists (
   select 1 from pg_temp._it_excel_c ocu
   left join pg_temp._it_excel_c obs on obs.c='observaciones'
     and obs.id=ocu.v->>'desdeObservacionId'
   where ocu.c='ocupaciones' and (
     obs.id is null
     or ocu.v->>'localId' is distinct from obs.v->>'localId'
     or ocu.v->>'negocioId' is distinct from obs.v->'datos'->>'negocioId'
     or obs.v->'datos'->>'vacio' not in ('true','false')
     or (obs.v->'datos'->>'vacio'='true' and ocu.v->>'negocioId' is not null)
     or (obs.v->'datos'->>'vacio'='false' and ocu.v->>'negocioId' is null)
   )
 ) or exists (
   select 1 from pg_temp._it_excel_c l where l.c='locales'
   and not exists (select 1 from pg_temp._it_excel_c vin
       where vin.c='vinculos' and vin.v->>'localId'=l.id)
 ) or exists (
   select 1 from pg_temp._it_excel_c vin
   where vin.c='vinculos' and vin.v->>'localId' is not null
     and not exists (select 1 from pg_temp._it_excel_c obs
       where obs.c='observaciones' and obs.v->>'registroId'=vin.v->'origen'->>'id'
       and obs.v->>'localId'=vin.v->>'localId')
 ) or exists (
   select 1 from pg_temp._it_excel_c ocu where ocu.c='ocupaciones'
   group by ocu.v->>'localId' having count(*)>1
 ) then
   raise exception 'ULIT Censo: incoherencia entre vínculo, observación, ocupación y negocio'
     using errcode='42501';
 end if;
 -- Fuente autorizada, no decisiones, revisiones ni verificación fabricadas.
 -- Esta RPC solo IMPORTA borradores: cualquier supervisión se realiza después en Oficina/G5.
 select count(*) into v_no_validos from pg_temp._it_excel_c x where
   (x.c='registros' and (x.v ? 'exclusion'
     or x.v->'interpretacion'->'clasificacion'->>'confirmada'='true'))
   or (x.c='vinculos' and (
     (x.v - array['id','origen','localId','confianza','criterio','candidatos']) <> '{}'::jsonb
     or x.v->>'confianza' not in ('probable','dudosa','sin-vinculo')
     or x.v->>'confianza' is null
     or (x.v->>'localId' is not null and x.v->>'confianza'<>'probable')
     or (x.v->>'localId' is null and x.v->>'confianza'='probable')))
   or (x.c='observaciones' and (
     (x.v - array['id','campanaId','localId','calleId','fecha','registrado',
       'fuente','tipo','itinerarioId','registroId','datos','orden','nota','verificacion']) <> '{}'::jsonb
     or x.v->>'verificacion' is distinct from 'pendiente'
     or x.v->>'fuente' is distinct from 'importacion'
     or x.v->>'tipo' not in ('confirmado','vacio')
     or ((x.v->'datos') - array['numero','sufijo','nombre','negocioId','vacio','metrosFachada']) <> '{}'::jsonb
     or jsonb_typeof(x.v->'datos'->'vacio') is distinct from 'boolean'))
   or (x.c='digital' and (
     (x.v - array['negocioId','campanaId','datos','estado','historial']) <> '{}'::jsonb
     or x.v->>'estado' is distinct from 'borrador'
     or x.v->'historial' is distinct from '[]'::jsonb
     or jsonb_typeof(x.v->'datos') is distinct from 'object'
     or exists(select 1 from jsonb_each(x.v->'datos') d(k,dato)
        where jsonb_typeof(d.dato) is distinct from 'object'
           or d.dato->>'origen' is distinct from 'importado'
           or d.dato ? 'porId'
           or (d.dato - array['respuesta','valor','origen','fecha']) <> '{}'::jsonb)))
   or (x.c='clasificaciones' and (
     (x.v - array['negocioId','campanaId','actividadId','descripcion','catalogoId','origen','confirmada','fecha']) <> '{}'::jsonb
     or x.v->>'origen' is distinct from 'importado'
     or x.v->'confirmada' is distinct from 'false'::jsonb
     or coalesce(x.v->>'actividadId','')=''))
   or (x.c='franquicias' and (
     (x.v - array['negocioId','campanaId','respuesta','origen','fecha','historial']) <> '{}'::jsonb
     or x.v->>'origen' is distinct from 'importado'
     or x.v->>'respuesta' not in ('si','no','sin-info','pendiente')
     or jsonb_typeof(x.v->'historial') is distinct from 'array'
     or exists(select 1 from jsonb_array_elements(x.v->'historial') d(item)
        where d.item->>'origen' is distinct from 'importado'
          or d.item ? 'porId'
          or (d.item - array['respuesta','origen','fecha']) <> '{}'::jsonb)))
   or (x.c='negocios' and (
     (x.v - array['id','nombre','procedencia']) <> '{}'::jsonb
     or x.v->>'procedencia' is distinct from 'importado'))
   or (x.c='locales' and (
     (x.v - array['id','municipioId','direcciones','estado','procedencia']) <> '{}'::jsonb
     or x.v->>'estado' is distinct from 'activo'))
   or (x.c='importaciones' and (
     (x.v->'c1' ? 'decisiones' and x.v->'c1'->'decisiones' <> '{}'::jsonb)
     or (x.v->'c1' ? 'porId' and
         x.v->'c1'->>'porId' is distinct from m.persona_id)));
 if v_no_validos>0 then
   raise exception 'ULIT Censo: el Excel intenta incorporar decisiones o datos ya verificados'
     using errcode='42501';
 end if;

 -- La identidad del negocio y campaña va también en la clave, no solo en valor.
 if exists (select 1 from pg_temp._it_excel_c x
   where x.c in ('digital','franquicias','clasificaciones')
    and (x.id is distinct from x.v->>'negocioId'||'|'||v_camp
      or x.v->>'campanaId' is distinct from v_camp
      or not exists(select 1 from pg_temp._it_excel_c negocio
          where negocio.c='negocios' and negocio.id=x.v->>'negocioId')))
 then
   raise exception 'ULIT Censo: identidad de actividad, franquicia o digital no coincide con el negocio importado'
     using errcode='42501';
 end if;

 -- Una observación como máximo por registro de origen. Sin dobles estados.
 if exists (select 1 from pg_temp._it_excel_c o where o.c='observaciones'
    group by o.v->>'registroId' having count(*)>1) then
   raise exception 'ULIT Censo: varias observaciones de la misma fila'
     using errcode='42501';
 end if;
 -- El domicilio observado debe coincidir con el local, si hay uno asignado.
 if exists (select 1 from pg_temp._it_excel_c o
   join pg_temp._it_excel_c local on local.c='locales'
       and local.id=o.v->>'localId'
   where o.c='observaciones'
     and not exists(select 1 from jsonb_array_elements(local.v->'direcciones') d(item)
       where d.item->>'calleId'=o.v->>'calleId'
         and d.item->>'numero' is not distinct from o.v->'datos'->>'numero'
         and upper(btrim(coalesce(d.item->>'sufijo','')))=
             upper(btrim(coalesce(o.v->'datos'->>'sufijo',''))))
 ) then
   raise exception 'ULIT Censo: local y dirección observada son distintos'
     using errcode='42501';
 end if;

 -- Reutilizar el mismo contenido (aunque cambie SHA, nombre o fila)
 -- NO convierte un Excel corregido en una parte adicional.
 if exists (select 1 from pg_temp._it_excel_c r
    join ulit_censo.entidad anterior on
      anterior.espacio_id=p_espacio and anterior.coleccion='registros'
      and anterior.valor->>'itinerarioId'=v_it
    join ulit_censo.entidad imp on imp.espacio_id=p_espacio
      and imp.coleccion='importaciones'
      and imp.id=anterior.valor->>'importacionId'
      and imp.valor->>'estado'='confirmada'
    where r.c='registros'
    and (select coalesce(jsonb_object_agg(lower(btrim(d.key)),
            lower(btrim(regexp_replace(coalesce(d.value,''),'[[:space:]]+',' ','g')))),
            '{}'::jsonb)
          from jsonb_each_text(r.v->'datos') as d)
       = (select coalesce(jsonb_object_agg(lower(btrim(d.key)),
            lower(btrim(regexp_replace(coalesce(d.value,''),'[[:space:]]+',' ','g')))),
            '{}'::jsonb)
          from jsonb_each_text(anterior.valor->'datos') as d))
    or exists(select 1 from pg_temp._it_excel_c a
      join pg_temp._it_excel_c b on a.c='registros' and b.c='registros'
        and a.id<b.id
      where a.v->'datos'=b.v->'datos'
        -- Dos filas idénticas sin local son dos registros de fuente
        -- potencialmente indistinguibles; no se identifican como un
        -- único local físico ni se descartan. Se concilian en Oficina.
        -- Sigue bloqueada la duplicidad si cualquiera tiene local propuesto.
        and (exists(select 1 from pg_temp._it_excel_c va
           where va.c='vinculos' and va.v->'origen'->>'id'=a.id
             and va.v->>'localId' is not null)
          or exists(select 1 from pg_temp._it_excel_c vb
           where vb.c='vinculos' and vb.v->'origen'->>'id'=b.id
             and vb.v->>'localId' is not null)))
 then
   raise exception 'ULIT Censo: fila duplicada en este itinerario; no se incorporó la parte'
     using errcode='42501';
 end if;
 -- No duplicar portales: para estas altas automáticas, cualquier portal
 -- ya conocido se resuelve por conciliación supervisada, nunca por creación.
 if exists(select 1 from pg_temp._it_excel_c l where l.c='locales'
   and exists (select 1 from jsonb_array_elements(l.v->'direcciones') d
     where exists(select 1 from ulit_censo.entidad anterior
      where anterior.espacio_id=p_espacio and anterior.coleccion='locales'
      and exists(select 1 from jsonb_array_elements(anterior.valor->'direcciones') ad
       where ad->>'calleId'=d->>'calleId'
        and ad->>'numero' is not distinct from d->>'numero'
        and upper(btrim(coalesce(ad->>'sufijo','')))=upper(btrim(coalesce(d->>'sufijo',''))))))
   or exists (select 1 from pg_temp._it_excel_c l2 where l2.c='locales'
     and l2.id<>l.id
     and exists(select 1 from jsonb_array_elements(l.v->'direcciones') d
       where exists(select 1 from jsonb_array_elements(l2.v->'direcciones') ad
         where ad->>'calleId'=d->>'calleId'
           and ad->>'numero' is not distinct from d->>'numero'
           and upper(btrim(coalesce(ad->>'sufijo',''))) =
               upper(btrim(coalesce(d->>'sufijo',''))))))) then
   raise exception 'ULIT Censo: alta automática en un portal ya conocido; revisar en conciliación'
     using errcode='42501';
 end if;
 -- Copia íntegra previa y escritura específica en una única transacción.
 v_antes := jsonb_build_object('espacioId',p_espacio,'tipo','real','version',e.version,
   'entidades',ulit_censo.contenido(p_espacio));
 insert into ulit_censo.copia(espacio_id,version,motivo,contenido,sha256,bytes,creada_por)
 values(p_espacio,e.version,left('Automática previa a Excel '||p_codigo||' (SHA '||left(p_sha,12)||')',300),
   v_antes,encode(pg_catalog.sha256(pg_catalog.convert_to(v_antes::text,'UTF8')),'hex'),
   octet_length(v_antes::text),auth.uid()) returning id into v_copia;
 update ulit_censo.espacio set escritura_habilitada=true where id=p_espacio;
 v_version := ulit_censo.aplicar_interno(m,p_espacio,p_version_esperada,
   'Excel de campo '||p_codigo||' (archivo revisado)',p_cambios);
 if v_version <> p_version_esperada+1 then
   raise exception 'ULIT Censo: versión inesperada; se ha revertido la importación'
     using errcode='42501';
 end if;
 update ulit_censo.espacio set escritura_habilitada=false
   where id=p_espacio and version=v_version;
 if not found or not exists(select 1 from ulit_censo.copia where id=v_copia and version=p_version_esperada)
  or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio
       and coleccion='registros' and valor->>'importacionId'=v_imp)<>v_registros
  or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio
       and coleccion='vinculos' and valor->'origen'->>'id' in
          (select id from pg_temp._it_excel_c where c='registros'))<>v_vinculos
  or (select count(*) from ulit_censo.entidad where espacio_id=p_espacio
       and coleccion='locales' and id in
          (select id from pg_temp._it_excel_c where c='locales'))<>v_locales then
   raise exception 'ULIT Censo: verificación final fallida; transacción revertida'
     using errcode='42501';
 end if;
 return jsonb_build_object('version',v_version,'filas',v_registros,
   'itinerario',p_codigo,'importacionId',v_imp,'copia',v_copia);
end $fn$;

commit;
