-- Solo entorno PostgreSQL 17 descartable. Se ejecuta tras revision_general_2026.sql.
insert into ulit_censo.miembro(espacio_id,usuario_id,rol,persona_id)
values ('real-medina-del-campo-2026',
 '00000000-0000-0000-0000-00000000000c','administrador','coordinacion')
on conflict do nothing;
select pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000c',false);
-- Reiniciar la prueba de fachada, manteniendo el espacio sintético en v10,
-- para exigir una copia automática de ESA versión antes del primer cambio.
delete from ulit_censo.entidad where espacio_id='real-medina-del-campo-2026'
  and coleccion='correccionesRegistros';

do $test$
declare x jsonb;
begin
 if pg_catalog.has_function_privilege('anon',
   'public.ulit_censo_fachada_2026(text,text,bigint,text,text)','EXECUTE')
   or not pg_catalog.has_function_privilege('authenticated',
   'public.ulit_censo_fachada_2026(text,text,bigint,text,text)','EXECUTE') then
   raise exception 'Permiso de función fachada incorrecto';
 end if;
 x := public.ulit_censo_fachada_2026('real-medina-del-campo-2026','estado',0,'','');
 if x->>'habilitada' <> 'true' or x->>'alcance' <> 'fachada-vacios' then
   raise exception 'La capacidad restringida no está disponible';
 end if;
 if exists (select 1 from ulit_censo.copia
   where espacio_id='real-medina-del-campo-2026' and version=10) then
   raise exception 'La prueba debería iniciar sin copia de versión 10';
 end if;
 begin
   perform public.ulit_censo_fachada_2026('real-medina-del-campo-2026','guardar',10,'reg-sintetico-1','0');
   raise exception 'Se aceptó fachada de cero';
 exception when sqlstate '22023' then null;
 end;
 begin
   perform public.ulit_censo_fachada_2026('real-medina-del-campo-2026','guardar',9,'reg-sintetico-1','4,5');
   raise exception 'No rechazó versión obsoleta';
 exception when sqlstate 'PT409' then null;
 end;
 if exists (select 1 from ulit_censo.copia
   where espacio_id='real-medina-del-campo-2026' and version=10) then
   raise exception 'Una propuesta inválida ha creado un respaldo';
 end if;
 x:=public.ulit_censo_fachada_2026('real-medina-del-campo-2026','guardar',10,'reg-sintetico-1','4,5');
 if x->>'version' <> '11' then raise exception 'No incrementó la versión'; end if;
 if (select valor->'valores'->>'fachada' from ulit_censo.entidad
   where espacio_id='real-medina-del-campo-2026' and coleccion='correccionesRegistros'
     and id='reg-sintetico-1') <> '4,5' then
   raise exception 'No se guardó el valor efectivo de fachada';
 end if;
 if (select valor->'datos'->>'Long fachada' from ulit_censo.entidad
   where espacio_id='real-medina-del-campo-2026' and coleccion='registros'
     and id='reg-sintetico-1') <> '3.5' then
   raise exception 'Se cambió el Excel de origen';
 end if;
 if (select count(*) from ulit_censo.copia
   where espacio_id='real-medina-del-campo-2026' and version=10) <> 1 then
   raise exception 'No quedó una copia v10 recuperable';
 end if;
 if (select escritura_habilitada from ulit_censo.espacio
   where id='real-medina-del-campo-2026') then
   raise exception 'La escritura quedó abierta';
 end if;
 x:=public.ulit_censo_fachada_2026('real-medina-del-campo-2026','guardar',11,'reg-sintetico-1','6');
 if x->>'version' <> '12' then raise exception 'No guardó una segunda medición'; end if;
 if (select valor->'historial'->0->'valoresAnteriores'->>'fachada' from ulit_censo.entidad
   where espacio_id='real-medina-del-campo-2026' and coleccion='correccionesRegistros'
     and id='reg-sintetico-1') <> '4,5' then
   raise exception 'No conservó el historial previo de metros';
 end if;
 if (select count(*) from ulit_censo.copia
   where espacio_id='real-medina-del-campo-2026' and version=10) <> 1 then
   raise exception 'Se generó una copia adicional en cada guardado';
 end if;
 perform pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000d',false);
 begin
   perform public.ulit_censo_fachada_2026('real-medina-del-campo-2026','estado',0,'','');
   raise exception 'Accedió una cuenta sin membresía';
 exception when sqlstate '42501' then null;
 end;
end $test$;
select '✓ fachada: copia atómica, origen intacto, historial, roles y bloqueo' as comprobacion;
