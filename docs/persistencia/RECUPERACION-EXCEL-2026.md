# Copias y recuperación al importar Excel 2026

**Estado:** documento previo a habilitación de producción, no autoriza restauraciones.

- El respaldo **externo** se descarga antes de solicitar la importación. Debe conservarse cifrado y fuera de Supabase, por una persona autorizada, y ensayarse en un clon antes de activar el servidor.
- La **copia automática** de `ulit_censo.copia` queda dentro de la misma transacción que la importación y se registra con SHA-256, versión y autor. Son dos garantías complementarias, no dos versiones de la campaña.
- Las copias de `ulit_censo.copia` son **de solo añadir**: no se permite su borrado por el usuario, aplicación ni rutina de limpieza. Cualquier futura política de expurgo requiere evaluación de obligaciones de conservación, autorización y un procedimiento nuevo auditado por separado. No habilitar borrado como alternativa para liberar cuota.
- Antes de permitir un uso recurrente, administración debe comprobar capacidad y crecimiento del almacenamiento, definir responsables, frecuencia de ensayo, cifrado, retención de las copias externas y alerta por capacidad.
- La restauración de producción sigue deliberadamente BLOQUEADA. El ensayo actual de JSON sintético en otro espacio prueba el procedimiento técnico de recuperación, **no** sustituye un ensayo autorizado de los 994 registros reales en un entorno aislado.
- Ante error de red o verificación posterior, no reintentar automáticamente: consultar versión y auditoría del servidor antes de cualquier nueva escritura.
- Para IT5 o cualquier Excel con partes, el sistema rechazará filas con contenido original normalizado idéntico a otras ya importadas en el mismo itinerario, aunque cambien el nombre o el SHA del archivo. Un solapamiento real exige revisión humana fuera de esta RPC; no se omite ni se duplica automáticamente.
