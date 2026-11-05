# ULIT Censo · Recuperación selectiva de Medina 2025

**Estado 05/11/2026:** diseño y ensayo local con datos sintéticos. **NO** autoriza importación, cambios de permisos ni restauración en producción. El proyecto compartido Supabase `censo-comercios` también aloja ULIT Base y ULIT Go: **no se revierte íntegramente el proyecto** para corregir una importación de Censo.

## Evidencia de ensayo recuperable

La prueba `src/store/supabaseLocal.e2e.test.ts` titulada «recuperación selectiva» comprueba en un Supabase **LOCAL y desechable**:

1. Inicializa el espacio de tipo real exclusivamente con Medina y 254 calles de la instantánea OSM incluida en el repositorio. Comprueba que el permiso limitado se cierra automáticamente (versión 1).
2. Crea una copia interna **con la escritura real bloqueada**. Consulta y exporta su metadato SHA-256 y su estado.
3. En local, abre administrativamente el espacio de prueba, valida otra copia contra la versión y contenido íntegros, y rechaza otra copia cuando el estado del cliente diverge.
4. Incorpora 889 registros **sintéticos**, usando la ruta del dominio `aplicarIncorporacion` y el almacén remoto por partes, que aplica una sola transacción.
5. Rechaza una restauración con versión obsoleta (PT409), sin alterar el servidor.
6. Restaura la copia anterior mediante `ulit_censo_restaurar_copia`; el servidor crea otra copia automática antes de restaurar. Recupera exactamente los datos anteriores: mismo SHA-256 canónico, cero registros y cero campañas, nueva versión de espacio.
7. Comprueba que **otro espacio de trabajo** sigue con su versión y contenido inalterados.
8. Cierra administrativamente la escritura del espacio de prueba y constata que Auth no puede seguir escribiendo (42501).

La E2E solo puede comenzar si ambas conexiones, API y PostgreSQL, tienen destino `localhost` o `127.0.0.1`. En ejecución local se verifica asimismo que las migraciones no alteraron la huella inicial de ULIT Base.

**Alcance del resultado:** confirma recuperación lógica de un espacio Censo desde copia interna y aislamiento entre espacios, no un ensayo de desastre integral del proveedor (Auth, Storage, Edge, correo, secretos). Tampoco comprueba todavía la recuperación de la copia JSON externa en un servicio Supabase restituido desde cero.

## Qué conserva la base de datos

- `ulit_censo.copia`: instantánea íntegra, versión y huella SHA-256 **del espacio escogido**. La copia se puede crear aun cuando `escritura_habilitada=false`, pero solo mediante RPC con membresía y rol adecuados.
- `ulit_censo.operacion` y `ulit_censo.entidad_historial`: versión, actor y diferencia de cada cambio. No se sobrescriben ni se borran para ejecutar la restauración.
- `public.ulit_censo_restaurar_copia`: exige rol administrador, misma identidad de espacio, SHA válido y versión vigente; crea otra copia, aplica la restauración transaccional e incrementa versión. Exige escritura habilitada temporalmente también para restaurar.
- El respaldo JSON **externo** que descarga la Cátedra constituye una custodia independiente, distinta de `ulit_censo.copia`. No subir ninguna copia auténtica a GitHub, Vercel ni a informes de CI.

## Procedimiento antes de una importación real autorizada

1. Verificar por consultas **de solo lectura** que `real-medina-del-campo-2026` contiene exclusivamente raíz, persona, municipio y 254 calles, versión 1, y que no existen campañas/importaciones/registros.
2. Conservar fuera del repositorio el archivo externo ya descargado y comprobado; contrastar su integridad y fecha, y preparar una segunda copia externa custodiada en otro lugar.
3. Resolver documentalmente que la copia del Excel 2025 (SHA `9e367ca51cfecf56d93f124d166f708e374f6555a4cc36d3166afde2f1f7ba82`) es la fuente aprobada, puesto que difiere de la huella del archivo anterior de referencia. **Los agregados iguales no acreditan la identidad de todas las celdas.**
4. Mantener `CONFIRMACION_REAL_HABILITADA=false` y `escritura_habilitada=false` hasta que se revise una activación de alcance restringido. **No usar un desbloqueo general sin cierre automático de una sola operación.**
5. Tras autorización explícita y solo para la operación acordada: el importador debe crear una copia interna con `asegurarRecuperacionAntesDeImportar`, volver a leer su contenido, comprobar SHA, versión y equivalencia del estado completo antes de transmitir las modificaciones.
6. Ejecutar exclusivamente el plan autorizado de 2025 (889 registros, 0 exclusiones, periodo 2024–2025), de forma transaccional. Conciliar las 193 filas pendientes después, sin inventar direcciones ni fusionar establecimientos del mismo portal.
7. Bloquear de nuevo la escritura al terminar y comparar en lectura la campaña histórica, 889 registros de origen, 2026 sin alteraciones, versión y huella de ULIT Base/Go. Descargar y verificar una copia **posterior** del estado importado.

## Si hay un problema en la incorporación

- Si el servidor rechaza una operación atómica antes del commit, comprobar la versión y los recuentos **sin restaurar por inercia**: no debería haber ningún cambio.
- Si la operación se confirmó pero hay un error verificable, **no iniciar 2026**: detener el uso del espacio, revalidar la copia interna, versión y actor; guardar evidencia del resultado anómalo.
- La restauración requiere autorización administrativa **específica**, pues Supabase debe permitir escritura temporalmente; recuperar solo el espacio Censo afectado mediante su RPC, nunca hacer un rollback de todo el proyecto compartido.
- Tras restaurar, verificar que el espacio coincide con el estado inicial, que las operaciones/cambios siguen trazados, que ULIT Base/Go y otros espacios no se han alterado y que la escritura vuelve a estar cerrada.
- Si existe ya trabajo posterior que dependa del histórico 2025, **no restaurar automáticamente**: evaluar las dependencias para no eliminar campañas o vínculos válidos.

## Consultas de verificación SIN ESCRITURA

```sql
select id, tipo, version, escritura_habilitada, preparacion_habilitada
from ulit_censo.espacio
where id = 'real-medina-del-campo-2026';

select coleccion, count(*) as filas
from ulit_censo.entidad
where espacio_id = 'real-medina-del-campo-2026'
group by coleccion
order by coleccion;

select version, motivo, sha256, bytes, creada_en
from ulit_censo.copia
where espacio_id = 'real-medina-del-campo-2026'
order by creada_en desc;
```

**Pendiente antes de la activación:** diseñar/probar **un permiso de servidor de alcance limitado y cierre automático**, en lugar de dejar abierta la capacidad general de modificar el espacio con `escritura_habilitada=true`. La nueva copia automática de la aplicación es una defensa importante, **no** sustituye ese control del servidor ni la aprobación del responsable.
