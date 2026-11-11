-- Ejecución únicamente sobre el PostgreSQL desechable de CI.
select pg_catalog.set_config('request.jwt.claim.sub',
  '00000000-0000-0000-0000-00000000000e',false);

do $prueba$
declare
  p jsonb;
  q jsonb;
  cantidad integer;
  p_cursor_col text;
  p_cursor_id text;
begin
  if pg_catalog.has_function_privilege('anon',
       'public.ulit_censo_leer_parte(text,bigint,text,text,integer)','EXECUTE')
    or pg_catalog.has_function_privilege('service_role',
       'public.ulit_censo_leer_parte(text,bigint,text,text,integer)','EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',
       'public.ulit_censo_leer_parte(text,bigint,text,text,integer)','EXECUTE') then
    raise exception 'Permisos de lectura paginada incorrectos';
  end if;
  p:=public.ulit_censo_leer_parte('real-medina-del-campo-2026',10,'','',2);
  if p->>'version' <> '10' or jsonb_array_length(p->'items') <> 2 then
    raise exception 'Página de inicio incorrecta';
  end if;
  p_cursor_col:=p->'items'->1->>'c';
  p_cursor_id:=p->'items'->1->>'id';
  q:=public.ulit_censo_leer_parte('real-medina-del-campo-2026',10,p_cursor_col,p_cursor_id,2);
  if jsonb_array_length(q->'items') <> 2 then
    raise exception 'Página siguiente incompleta o duplicada';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p->'items') a
    cross join jsonb_array_elements(q->'items') b
    where a->>'c'=b->>'c' and a->>'id'=b->>'id'
  ) then
    raise exception 'Una entidad se repitió entre páginas';
  end if;
  begin
    perform public.ulit_censo_leer_parte('real-medina-del-campo-2026',8,'','',2);
    raise exception 'No rechazó una versión anterior';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.ulit_censo_leer_parte('real-medina-del-campo-2026',10,'','',301);
    raise exception 'No rechazó un tamaño de página abusivo';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.ulit_censo_leer_parte('otro-espacio',10,'','',2);
    raise exception 'No rechazó otro espacio';
  exception when sqlstate '22023' then null;
  end;
  -- Un usuario autenticado pero NO miembro nunca puede leer los datos reales.
  perform pg_catalog.set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-00000000000d',false);
  begin
    perform public.ulit_censo_leer_parte('real-medina-del-campo-2026',10,'','',2);
    raise exception 'Miembro no autorizado ha leído el censo';
  exception when sqlstate '42501' then null;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub',
    '00000000-0000-0000-0000-00000000000e',false);

  if (select escritura_habilitada from ulit_censo.espacio
    where id='real-medina-del-campo-2026') then
    raise exception 'La lectura abrió escritura general';
  end if;
end $prueba$;

select '✓ SQL aislado: paginación con versión fija y sin privilegios de escritura' as validado;
