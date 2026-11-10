-- ULIT Censo · 0012 · Margen específico para copias y lectura del censo creciente.
-- Resuelve los timeout de 8 s tras IT4: mantiene intactas autorizaciones, hash,
-- control de versiones, esquema de datos, RLS y escritura general cerrada.
-- No se aplica a todo el rol authenticated; solo a las tres RPC identificadas.
alter function public.ulit_censo_crear_copia(text,text)
  set statement_timeout to '45s';
alter function public.ulit_censo_descargar_copia(text,uuid)
  set statement_timeout to '45s';
alter function public.ulit_censo_leer(text)
  set statement_timeout to '45s';
