-- ULIT Censo · 0011 · Margen acotado para el guardado atómico de Excel 2026
-- El rol authenticated sigue con su límite habitual de 8 segundos.
-- Solo la RPC supervisada de importación puede emplear hasta 45 segundos.
-- Sin cambios de permisos, esquema, tablas o datos; mantiene rollback por transacción.
alter function public.ulit_censo_importar_excel_2026(
  text,bigint,text,text,boolean,jsonb
) set statement_timeout to '45s';

comment on function public.ulit_censo_importar_excel_2026(text,bigint,text,text,boolean,jsonb)
is 'Importación Excel 2026: operación atómica supervisada y versionada, timeout exclusivo de 45 s; escritura general cerrada.';
