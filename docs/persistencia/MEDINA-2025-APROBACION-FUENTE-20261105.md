# Aprobación de fuente · Censo histórico de Medina del Campo 2025

**Decisión comunicada por la Cátedra:** 05/11/2026. La persona responsable confirmó explícitamente que se utilizará la copia identificada a continuación como **fuente oficial de la fotografía histórica 2025**.

## Archivo autorizado como fuente

- Nombre: `CENSO COMPLETO MEDINA 2025 - copia.xlsx`
- SHA-256: `9e367ca51cfecf56d93f124d166f708e374f6555a4cc36d3166afde2f1f7ba82`
- Hoja: `Datos` · 27 columnas · 889 filas de datos
- Periodo de trabajo de campo: 2024-01-01 a 2025-12-31
- Procedencia: copia local del Excel histórico original que custodia la Cátedra. El análisis se ejecutó en la memoria del navegador (C1e-B) sin grabar el Excel, sus filas o decisiones en el servidor.
- Vista previa: 889 registros de origen conservados, 0 exclusiones; 696 inicialmente vinculables y 193 sin vínculo inicial, conservados para conciliación; 0 bloqueos de integridad.

La fuente anterior del diagnóstico agregado `CENSO COMPLETO MEDINA 2025(1).xlsx` tenía huella SHA-256 `645179a850474ab92bc54c9ed4e6e2f300790f62081fb0ea02d3999e3c4cb67a`. **Las dos huellas son diferentes**. Sus agregados principales pueden coincidir, pero **no se afirma que ambos archivos sean idénticos celda a celda**. La Cátedra ha aprobado expresamente la copia revisada a pesar de esa diferencia; se conservan ambas referencias por trazabilidad.

## Alcance EXACTO de esta aprobación

**Sí**: identifica el Excel oficial que se deberá seleccionar y verificar por huella SHA-256 cuando se prepare la primera incorporación real a Medina del Campo.

**No**: no autoriza iniciar una carga, crear autorizaciones en `ulit_censo.autorizacion_historico_2025`, habilitar `CONFIRMACION_REAL_HABILITADA`, modificar campañas, levantar el bloqueo de escritura del servidor ni restaurar datos. Esos actos requieren controles y una **autorización operativa separada**.

La implementación de la interfaz debe mostrar el SHA de la copia como **aprobado**, sin eliminar el SHA de referencia anterior ni afirmar igualdad de contenido. Se rechaza que cualquiera de ambas versiones sea utilizada en el espacio de ensayo. Las comparaciones con el diagnóstico agregado son informativas y no sustituyen las verificaciones de importación.

## Puntos pendientes antes de incorporar

1. Verificar una copia externa fresca del estado real justo antes de la operación. Se ha ensayado la recuperación del **formato** JSON con 889 registros sintéticos en Supabase local, pero no se ha restaurado la copia auténtica de la Cátedra.
2. Reabrir la vista previa en el espacio REAL, comprobar los 889 registros y pendientes sin exclusiones y revisar la identificación de la cuenta Auth.
3. Autorizar expresamente **una única incorporación real**, con destinatario, cuenta, SHA, caducidad y procedimiento de reversión. El responsable no ha dado todavía ese consentimiento operativo.
4. Al incorporar, comprobar la huella esperada, el estado de la campaña 2025, los 889 registros, el cierre automático de la escritura y la integridad de los demás módulos.

**Protecciones actuales:** la migración 0005 está instalada desde 05/11/2026, pero la tabla de autorizaciones sigue vacía, el espacio real continúa cerrado, y la PR #13 permanece sin integrar en `main`.
