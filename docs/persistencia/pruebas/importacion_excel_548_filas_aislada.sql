-- CARGA IT2-equivalente: 548 filas, 2.383 entidades y más de 2,66 MiB.
-- Contenido íntegramente sintético, sin archivos auténticos, en clúster desechable.
\echo '09 · Carga completa equivalente a IT2 en UNA transacción atómica'
create function pg_temp.plan_it3_carga() returns jsonb
language sql stable security definer set search_path = ''
as $large$
with elementos as (
  select jsonb_build_object('c','itinerarios','id','real-it-it3','v',
    jsonb_build_object('id','real-it-it3','campanaId',
      'real-camp-medina-2026-censo-medina-del-campo-2026',
      'codigo','IT3','origen','excel')) as item
  union all
  select jsonb_build_object('c','importaciones','id','imp-it3-carga','v',
    jsonb_build_object('id','imp-it3-carga','campanaId',
      'real-camp-medina-2026-censo-medina-del-campo-2026',
      'municipioId','real-mun-medina','tipo','C-excel-itinerario',
      'huella',repeat('c',64),'estado','confirmada','filas',548,
      'c1',jsonb_build_object('sha256',repeat('c',64),'anio',2026,
        'itinerario',jsonb_build_object('id','real-it-it3','codigo','IT3'))))
  union all
  select jsonb_build_object('c','registros','id','it3-r-'||n,'v',
    jsonb_build_object('id','it3-r-'||n,'importacionId','imp-it3-carga',
      'itinerarioId','real-it-it3','fila',n+1,'datos',
      jsonb_build_object('Dirección','Calle de ensayo','Num',(1000+n)::text,
        'Nombre del negocio','Comercio ficticio '||n,
        'Descripción',repeat('dato-de-prueba-',315)))) from generate_series(1,548) g(n)
  union all
  select jsonb_build_object('c','vinculos','id','it3-v-'||n,'v',
    jsonb_build_object('id','it3-v-'||n,
      'origen',jsonb_build_object('tipo','registro','id','it3-r-'||n),
      'confianza',case when n<=245 then 'probable' else 'sin-vinculo' end,
      'criterio','carga sintética',
      'localId',case when n<=245 then 'it3-l-'||n else null end))
    from generate_series(1,548) g(n)
  union all
  select jsonb_build_object('c','observaciones','id','it3-o-'||n,'v',
    jsonb_build_object('id','it3-o-'||n,
      'campanaId','real-camp-medina-2026-censo-medina-del-campo-2026',
      'itinerarioId','real-it-it3','registroId','it3-r-'||n,
      'localId',case when n<=245 then 'it3-l-'||n else null end,
      'calleId','calle-2','fuente','importacion','verificacion','pendiente',
      'tipo',case when n<=245 then 'confirmado' else 'vacio' end,
      'datos',jsonb_build_object('numero',(1000+n)::text,
        'vacio',n>245,
        'negocioId',case when n<=245 then 'it3-neg-'||n else null end)))
    from generate_series(1,548) g(n)
  union all
  select jsonb_build_object('c','locales','id','it3-l-'||n,'v',
    jsonb_build_object('id','it3-l-'||n,'municipioId','real-mun-medina',
      'procedencia','importado','estado','activo',
      'direcciones',jsonb_build_array(jsonb_build_object(
        'calleId','calle-2','numero',(1000+n)::text))))
    from generate_series(1,245) g(n)
  union all
  select jsonb_build_object('c','negocios','id','it3-neg-'||n,'v',
    jsonb_build_object('id','it3-neg-'||n,
      'nombre','Comercio ficticio '||n,'procedencia','importado'))
    from generate_series(1,245) g(n)
  union all
  select jsonb_build_object('c','ocupaciones','id','it3-ocu-'||n,'v',
    jsonb_build_object('id','it3-ocu-'||n,'localId','it3-l-'||n,
      'negocioId','it3-neg-'||n,
      'desdeCampanaId','real-camp-medina-2026-censo-medina-del-campo-2026',
      'desdeObservacionId','it3-o-'||n))
    from generate_series(1,245) g(n)
  union all
  select jsonb_build_object('c','digital',
    'id','it3-neg-'||n||'|real-camp-medina-2026-censo-medina-del-campo-2026',
    'v',jsonb_build_object('negocioId','it3-neg-'||n,
      'campanaId','real-camp-medina-2026-censo-medina-del-campo-2026',
      'estado','borrador','historial',jsonb_build_array(),
      'datos',jsonb_build_object('web',jsonb_build_object(
        'origen','importado','respuesta','si'))))
    from generate_series(1,2) g(n)
)
select jsonb_agg(item) from elementos;
$large$;
grant execute on function pg_temp.plan_it3_carga() to authenticated;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $medir$
declare plan jsonb; res jsonb; tiempo timestamptz; bytes bigint;
begin
 plan := pg_temp.plan_it3_carga();
 bytes := octet_length(plan::text);
 raise notice 'Carga sintética: % entidades, % filas, % bytes',
   jsonb_array_length(plan),548,bytes;
 assert jsonb_array_length(plan)=2383,'Debe reproducir 2.383 entidades';
 assert bytes>2790000,'Debe superar 2,66 MiB como el IT2 real';
 assert bytes<3800000,'Debe caber en el nuevo límite seguro';
 tiempo := clock_timestamp();
 res:=public.ulit_censo_importar_excel_2026(
   'real-medina-del-campo-2026',6,'IT3',repeat('c',64),false,plan);
 raise notice 'Importación sintética 548 filas completada en % ms',
   round(extract(epoch from (clock_timestamp()-tiempo))*1000);
 assert res->>'version'='7';
 assert res->>'filas'='548';
 assert res->>'itinerario'='IT3';
end $medir$;
reset role;
do $control$
begin
 assert (select count(*) from ulit_censo.entidad
   where espacio_id='real-medina-del-campo-2026'
     and coleccion='registros' and valor->>'importacionId'='imp-it3-carga')=548;
 assert (select count(*) from ulit_censo.entidad
   where espacio_id='real-medina-del-campo-2026'
     and coleccion='vinculos' and valor->'origen'->>'id' like 'it3-r-%')=548;
 assert (select count(*) from ulit_censo.entidad
   where espacio_id='real-medina-del-campo-2026'
     and coleccion='locales' and id like 'it3-l-%')=245;
 assert (select version from ulit_censo.espacio
   where id='real-medina-del-campo-2026')=7;
 assert not (select escritura_habilitada from ulit_censo.espacio
   where id='real-medina-del-campo-2026');
 assert (select count(*) from ulit_censo.copia
   where espacio_id='real-medina-del-campo-2026')=3;
 assert (select valor->'datos'->>'Nombre del negocio'
   from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
     and coleccion='registros' and id='hist-r-1')='Histórica intacta';
end $control$;
\echo 'ÉXITO · 548 filas, 2.383 entidades y 2,66+ MiB, una sola transacción, sin modificar 2025/IT1'
