# ULIT Censo · Auditoría de seguridad previa a 0005 (05/11/2026)

**Ámbito**: PR #13, rama `codex/preflight-medina-2025-controlado`. Esta nota no concede permisos ni autoriza instalar 0005 en el Supabase compartido. Todos los ensayos de escritura se realizan contra PostgreSQL/Supabase **locales y desechables**.

## Hallazgos y correcciones aplicadas en la PR

1. **[ALTA] Integridad de correspondencias**. La RPC antigua exigía 889 registros y 889 vínculos, pero no comprobaba que cada registro tuviera exactamente un vínculo. Dos vínculos podían apuntar al mismo registro dejando otro huérfano sin incumplir los recuentos. Se ha añadido comprobación uno a uno mediante SQL y E2E negativo.
2. **[ALTA] Datos en el staging sin autorización**. `ulit_censo_lote_subir` permitía subir partes privadas al espacio real aun con `escritura_habilitada=false`, porque antes no exigía un permiso especial de incorporación. La migración 0005 incorpora un trigger en `ulit_censo.lote_parte`: para Medina real exige usuario Auth autorizado, autorización vigente y no consumida, espacio cerrado versión 1, y límites por parte. No afecta a otros espacios.
3. **[MEDIA] Lotes rechazados persistentes**. Una RPC fallida después de subir partes puede dejar datos en `lote_parte`. Se añade `ulit_censo_descartar_lote_2025`, ejecutable solo por el propio usuario miembro con coordinación o administración; el cliente intenta descartarlos al fallar (sin ocultar errores). Otro coordinador no puede eliminar esos datos ajenos. Si hay caída total de red o de sesión, la limpieza automática del cliente no está garantizada: comprobar y purgar administrativamente las partes residuales antes/después de la intervención autorizada.
4. **[MEDIA] Autorización temporal**. El E2E comprueba que una autorización caducada, ausente, de otra cuenta o previamente utilizada no se consume ni permite importar; tampoco permite depositar lotes reales.
5. **[MEDIA] Privilegios expuestos**. `autorizacion_historico_2025` se mantiene en esquema privado, sin permisos para roles API, con RLS; el SQL de pruebas verifica los `REVOKE` de RPC sensible para `anon` y `service_role`, y que instalar 0005 no crea una autorización.
6. **[MEDIA] Resultado ambiguo**. El cliente no afirma que la importación no se haya efectuado si fallan la confirmación o la lectura posterior. Exige comprobar versión y registros en servidor antes de reintentar o restaurar.

## Barreras que han de mantenerse

- El Excel auténtico, copias JSON y credenciales **no se suben a GitHub, Vercel ni a CI**; las pruebas usan 889 filas **sintéticas**.
- `CONFIRMACION_REAL_HABILITADA=false` continúa en el código; `escritura_habilitada=false` y `preparacion_habilitada=false` en el espacio real.
- La tabla `ulit_censo.autorizacion_historico_2025` debe quedar vacía después de instalar la migración, hasta un acto de autorización **diferente**.
- La RPC solo acepta `real-medina-del-campo-2026`, versión inicial 1, una campaña histórica 2025, una importación 889 filas, 889 vínculos, sin exclusiones ni clasificaciones aprobadas por defecto; comprueba una copia interna íntegra de v1.
- La autorización es para **un usuario Auth**, caduca y se consume en la misma transacción del guardado. Las escrituras generales quedan bloqueadas después del commit; no habilitar `escritura_habilitada=true` por separado.
- No mezclar trabajos de 2026 ni restauraciones de ULIT Base/Go.

## Límites de la garantía y bloqueos de lanzamiento

1. **Fuente 2025 aprobada por la Cátedra (05/11/2026), sin autorizar importación**: `9e367ca51cfecf56d93f124d166f708e374f6555a4cc36d3166afde2f1f7ba82`. Difiere de la antigua referencia `645179a850474ab92bc54c9ed4e6e2f300790f62081fb0ea02d3999e3c4cb67a`; los agregados no acreditan igualdad celda a celda. Acta de decisión: `MEDINA-2025-APROBACION-FUENTE-20261105.md`.
2. **El servidor no recibe los bytes del Excel.** El SHA-256 guardado por la RPC es el declarado en los metadatos de la importación, que el servidor contrasta con el aprobado administrativamente. Esto **no es una verificación criptográfica independiente** de la identidad del fichero. El análisis y la lectura del archivo se hacen en el navegador revisado.
3. El JSON externo que el usuario descargó y verificó el 05/11/2026 acredita integridad de la copia del espacio, pero **no** es una prueba de restauración integral del proyecto compartido ni de la restauración del respaldo JSON en una base completamente reconstruida.
4. La migración 0005 fue instalada el 05/11/2026 y verificada con **cero autorizaciones** y escritura cerrada. Antes de la importación: revisión final de las funciones `SECURITY DEFINER`, contraseñas/sesiones, permisos y aislamiento; volver a comprobar las tres baterías CI (tipado, SQL aislado y E2E local).
5. Antes de una importación real: copia reciente independiente, autorización de la versión del Excel, comprobación de identidad de cuenta y sesión, aprobación por escrito de la operación única y procedimiento de reversión **selectivo** probado. La migración por sí sola no concede permiso.
6. Después de la carga autorizada: cotejar **889 registros**, campaña 2025, integridad, 2026 sin modificaciones, escritura cerrada, autorización consumida y `lote_parte` sin restos de esa operación; exportar una nueva copia comprobada.
7. La restauración real requiere una autorización adicional, no automática, y debe preservar registros de operaciones y la información de otros espacios.

**Estado**: preparado para revisión de código y pruebas, no para una importación en producción sin esos hitos.
