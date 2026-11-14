-- PostgreSQL 17 aislado y sin red. Estado sintético al acabar 0014: versión 20.
-- Regresión: IT5 · fila 26 ya ocupada (LV=0) con fachada heredada.
select pg_catalog.set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-00000000000c',false);

insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version) values
('real-medina-del-campo-2026','registros','reg-sintetico-it5-26',
 '{"id":"reg-sintetico-it5-26","importacionId":"imp-sintetica",
 "itinerarioId":"it-sintetico","fila":26,
 "datos":{"Local Vacío":"0","Nombre del negocio":"Salón del Reino de los Testigos de Jehová",
 "Long fachada":"8","Actividad":"Sala de reuniones","Instagram":"1",
 "Dirección":"Calle Duque de Ahumada","Num":"9"}}'::jsonb,20);

do $prueba$
declare
  v jsonb;
  v_original jsonb;
  v_copias bigint;
  v_version bigint;
  v_guardado jsonb;
begin
  v_version := (select version from ulit_censo.espacio where id='real-medina-del-campo-2026');
  if v_version<>20 then raise exception 'Fixture sintético no está en versión 20'; end if;
  v_original := (select valor from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
      and id='reg-sintetico-it5-26');
  v_copias := (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026');

  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','limpiar-fachada',20,'reg-sintetico-it5-26','8');
    raise exception 'Permitió conservar metros en una limpieza';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','limpiar-fachada',19,'reg-sintetico-it5-26','');
    raise exception 'No bloqueó versión obsoleta';
  exception when sqlstate 'PT409' then null;
  end;

  v := public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','limpiar-fachada',20,'reg-sintetico-it5-26','');
  v_guardado := v->'correccion';
  if v->>'version'<>'21' or v->>'accion'<>'limpiar-fachada'
    or v_guardado->'valores'->>'fachada' is distinct from ''
    or v_guardado->>'registroId'<>'reg-sintetico-it5-26' then
    raise exception 'No confirmó la retirada de fachada';
  end if;

  -- El indicador efectivo continúa en ocupado; nombre y actividad provienen
  -- del original intacto (único overlay permitido = fachada vacía).
  if v_guardado->'valores' <> '{"fachada":""}'::jsonb then
    raise exception 'Se modificaron más campos que la fachada: %',v_guardado->'valores';
  end if;
  if (select valor from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
      and id='reg-sintetico-it5-26') is distinct from v_original then
    raise exception 'Se reescribió el Excel de origen';
  end if;
  if (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026')<>v_copias then
    raise exception 'Se ha generado una copia completa innecesaria';
  end if;
  if (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026') then
    raise exception 'Quedó abierta la escritura general';
  end if;
  if (select valor->'datos'->>'Nombre del negocio' from ulit_censo.entidad
    where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
      and id='reg-sintetico-it5-26') <> 'Salón del Reino de los Testigos de Jehová' then
    raise exception 'Se perdió el nombre del establecimiento';
  end if;

  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','limpiar-fachada',21,'reg-sintetico-it5-26','');
    raise exception 'Aceptó corrección redundante';
  exception when sqlstate '22023' then null;
  end;

  -- Los locales vacíos no son objetivo de esta acción.
  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','limpiar-fachada',21,'reg-sintetico-3','');
    raise exception 'Se borró fachada de local vacío';
  exception when sqlstate '42501' then null;
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-00000000000d',false);
  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','limpiar-fachada',21,'reg-sintetico-it5-26','');
    raise exception 'Una cuenta externa pudo guardar';
  exception when sqlstate '42501' then null;
  end;
end $prueba$;

select 'OK: ocupado conserva estado, nombre, clasificación y original; elimina solo fachada' as prueba;
