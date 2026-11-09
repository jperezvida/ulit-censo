# ULIT Censo · Recuperación ante una conciliación IT1 fallida

**Estado:** procedimiento documental para aprobación previa. No activa escrituras ni restaura producción.

## Alcance y controles

- Espacio objetivo: `real-medina-del-campo-2026`. El histórico 2025 es inmutable y se conserva como fotografía independiente.
- La nueva RPC de IT1 graba operaciones auditadas, controla versión y, antes de la **primera** decisión sobre la versión 4, crea una copia íntegra en `ulit_censo.copia` dentro de la misma transacción.
- La migración propuesta 0008 impide tanto `UPDATE` (ya prohibido) como `DELETE` de las copias; `operacion` y `entidad_historial` también son de solo añadir.
- **La función existente `ulit_censo_restaurar_copia` está bloqueada en el espacio real** mientras `escritura_habilitada=false`. No se debe intentar forzarla desde el navegador ni habilitar la escritura general como atajo.
- Una copia dentro de Supabase no sustituye al respaldo externo. La disponibilidad y la política de retención de copias del proveedor deben verificarse por separado.

## Antes de autorizar la primera conciliación real

1. Detener los cambios concurrentes y verificar que producción sigue cerrada, que el histórico y las 105 filas IT1 coinciden con la huella esperada y que la nueva RPC se ha validado contra Auth/PostgREST local. Registrar versión y fecha.
2. Descargar un **respaldo íntegro externo**, cifrado y restringido al personal autorizado. Usar el mecanismo existente de exportación autorizado para administración/coordinación; nunca guardar su contenido en GitHub, CI ni comentarios de PR.
3. Calcular el SHA-256 del archivo descargado y **compararlo con una copia recuperada** en un entorno aislado, verificando recuentos, relaciones, estructura y consultas de lectura. La huella de la serialización de JSON puede diferir de la de los bytes del archivo; comprobar cada formato con su algoritmo correspondiente.
4. Conservar al menos dos copias independientes, registrar quién las custodia, la versión del espacio y las instrucciones de acceso seguro.
5. Definir el plan de recuperación con responsable autorizado, ventana de mantenimiento, umbral de abortar y un procedimiento *ensayado* en una base aislada. **No activar las escrituras reales si el ensayo de restauración no se ha completado.**

## En caso de incidencia real

1. **No repetir** la operación si el servidor no devolvió confirmación. Primero comprobar versión y auditoría; las peticiones no son idempotentes.
2. Bloquear la continuación de la campaña y preservar logs, auditoría, respaldos internos y externos.
3. Determinar el alcance: si la decisión afectó solo al vínculo y no existen dependencias posteriores, usar la operación específica `deshacer` con permisos y motivo. Si hay dependencias, no intentar borrarlas automáticamente.
4. Si requiere recuperación masiva, ejecutar el procedimiento aprobado desde un entorno aislado y con personal administrador. Hacer primero copia **del estado actual**, verificar SHA y comprobar que no se van a destruir importaciones posteriores.
5. Recuperar los datos únicamente tras autorización expresa y ensayo en un clon; verificar campañas, registros, vínculos, locales, negocios y observaciones de ambas campañas y comparar con el estado esperado. Cerrar las escrituras y conservar un informe.

## Bloqueos deliberados

- No hay botón de restauración general en la aplicación real, ni una RPC especial en 0008 para ejecutar una restauración masiva.
- **Hasta que exista y se pruebe un procedimiento de restauración autorizado de producción, 0008 debe mantenerse sin aplicar**, aunque las pruebas de conciliación estén verdes.
