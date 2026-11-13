-- Únicamente PostgreSQL 17 desechable. Tras revisión general y fachada sintéticas:
-- espacio v12, registro-sintetico-1 vacío=1 con nombre "Anterior", fachada corregida=6.
select pg_catalog.set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-00000000000c',false);

do $test$
declare
  v jsonb;
  v_copias bigint;
  v_registro jsonb;
begin
  if pg_catalog.has_function_privilege('anon',
      'public.ulit_censo_revision_fase1_2026(text,text,bigint,text,text)','EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated',
      'public.ulit_censo_revision_fase1_2026(text,text,bigint,text,text)','EXECUTE')
     or pg_catalog.has_function_privilege('authenticated',
      'public.ulit_censo_fachada_2026(text,text,bigint,text,text)','EXECUTE') then
    raise exception 'Permisos incorrectos o RPC antigua accesible';
  end if;
  v := public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','estado',0,'','');
  if v->>'alcance'<>'fachada-y-ocupacion' or v->>'habilitada'<>'true' then
    raise exception 'Falta autorización de nuevo alcance';
  end if;
  if (select version from ulit_censo.espacio where id='real-medina-del-campo-2026')<>12 then
    raise exception 'Fixture sintético inesperado';
  end if;
  v_copias := (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026');

  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','ocupar',12,'reg-sintetico-1','5');
    raise exception 'No rechazó metros durante transición a ocupado';
  exception when sqlstate '22023' then null;
  end;

  -- Revisión explícita: el negocio ha ocupado el local, no tiene fachada vacante.
  v := public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','ocupar',12,'reg-sintetico-1','');
  if v->>'version'<>'13' or v->>'registroId'<>'reg-sintetico-1'
     or v->'correccion'->'valores'->>'vacio'<>'0'
     or v->'correccion'->'valores'->>'fachada'<>''
     or v->'correccion'->>'porId'<>'coordinacion' then
    raise exception 'No devolvió corrección de ocupación verificable';
  end if;
  if (select valor->'datos'->>'Nombre del negocio' from ulit_censo.entidad
      where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
        and id='reg-sintetico-1') <> 'Anterior' then
    raise exception 'Se modificó el Excel importado';
  end if;
  if (select valor->'datos'->>'Local Vacío' from ulit_censo.entidad
      where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
        and id='reg-sintetico-1') <> '1' then
    raise exception 'Se modificó el estado original importado';
  end if;
  if (select valor->'historial'->0->'valoresAnteriores'->>'fachada'
      from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
      and coleccion='correccionesRegistros' and id='reg-sintetico-1')<>'6' then
    raise exception 'No quedó la medición anterior en el historial';
  end if;
  if (select count(*) from ulit_censo.copia where espacio_id='real-medina-del-campo-2026')<>v_copias then
    raise exception 'Cada guardado no debe regenerar la copia completa';
  end if;
  if (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026') then
    raise exception 'La escritura general quedó activada';
  end if;
  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','guardar',13,'reg-sintetico-1','3,5');
    raise exception 'Se aceptó fachada de un local ya ocupado';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','ocupar',12,'reg-sintetico-1','');
    raise exception 'No detectó versión antigua';
  exception when sqlstate 'PT409' then null;
  end;
end $test$;

-- No debe marcarse ocupado sin nombre de negocio existente.
insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version) values
('real-medina-del-campo-2026','registros','reg-sintetico-2',
 '{"id":"reg-sintetico-2","importacionId":"imp-sintetica","itinerarioId":"it-sintetico","fila":3,"datos":{"Local Vacío":"1","Nombre del negocio":"","Long fachada":""}}',13);

do $test$
declare v jsonb;
begin
  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','ocupar',13,'reg-sintetico-2','');
    raise exception 'Se marcó ocupado sin negocio';
  exception when sqlstate '22023' then null;
  end;
  -- Nueva medición sin copia completa ni recarga, devuelve entidad completa.
  v:=public.ulit_censo_revision_fase1_2026(
    'real-medina-del-campo-2026','guardar',13,'reg-sintetico-2','4,5');
  if v->>'version'<>'14' or v->'correccion'->'valores'->>'fachada'<>'4,5' then
    raise exception 'No devolvió los metros para actualizar la interfaz directamente';
  end if;
  perform pg_catalog.set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-00000000000d',false);
  begin
    perform public.ulit_censo_revision_fase1_2026(
      'real-medina-del-campo-2026','estado',0,'','');
    raise exception 'Miembro externo ha consultado permisos';
  exception when sqlstate '42501' then null;
  end;
  if (select escritura_habilitada from ulit_censo.espacio where id='real-medina-del-campo-2026') then
    raise exception 'El espacio quedó en modo escritura';
  end if;
end $test$;
select 'OK: cambios ocupado y fachada, historial y copia, roles, version, origen inmutable' as verificado;
