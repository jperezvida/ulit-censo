# Medina del Campo — Preparación de una única incorporación real del histórico 2025

**Fecha de preparación:** 05/11/2026. **ESTADO: OPERACIÓN NO AUTORIZADA.** Este documento no concede permisos, no importa registros, no desbloquea la interfaz ni modifica datos de producción.

## Identidad y alcance, ya establecidos

- Proyecto Supabase compartido: `censo-comercios`. **No** revertir ni modificar globalmente ULIT Base o ULIT Go.
- Espacio exclusivo ULIT Censo: `real-medina-del-campo-2026`. Municipio `real-mun-medina`.
- Estado anterior a la importación, comprobado por consulta de solo lectura: `version=1`, `escritura_habilitada=false`, `preparacion_habilitada=false`, 254 calles, 0 campañas, 0 registros, 0 importaciones, 0 copias internas, 0 autorizaciones.
- Membresía comprobada: una cuenta Auth administradora del espacio (no divulgar ID/email en GitHub).
- Fuente **aprobada documentalmente**: `CENSO COMPLETO MEDINA 2025 - copia.xlsx`, SHA-256 `9e367ca51cfecf56d93f124d166f708e374f6555a4cc36d3166afde2f1f7ba82`, hoja `Datos`, 27 columnas y 889 filas, periodo de campo 2024-01-01 a 2025-12-31.
- La huella anterior `645179a850474ab92bc54c9ed4e6e2f300790f62081fb0ea02d3999e3c4cb67a` se conserva únicamente como referencia histórica; no es el archivo aprobado.
- Plan de vista previa: conservar los 889 registros, inicialmente 696 vinculables y 193 pendientes, sin exclusiones, sin clasificación 2026 forzada, sin coordenadas inventadas.

## Puerta de recuperación previa: aún pendiente para el archivo auténtico

1. La persona administradora entra al **espacio real** en una **Preview privada** previamente validada, nunca en la demostración ni en el análisis `sin guardar`.
2. En la tarjeta **Respaldo externo**, pulsa `1. Descargar respaldo`. Guardar ese JSON fuera del navegador y, preferiblemente, en dos ubicaciones independientes bajo custodia institucional.
3. Sin cerrar la sesión, pulsa `2. Comprobar un respaldo` y selecciona el mismo JSON descargado. Debe verse exactamente **«Respaldo comprobado del estado actual»**. La aplicación valida la integridad SHA-256, el tipo y el contenido respecto al espacio cargado.
4. Comprobar que el JSON corresponde a `real-medina-del-campo-2026` y a la versión inicial sin campañas/registros. **No** enviar el JSON ni el Excel a GitHub, Vercel, CI o un repositorio.
5. Una prueba E2E ya ha reconstruido 889 registros **sintéticos** a partir de JSON externo en un Supabase local limpio; esto valida el formato y la recuperación lógica, pero **no** sustituye la custodia y revisión del respaldo real.
6. No pulsar **«Restaurar desde un respaldo»**: es una operación destructiva que requiere una autorización independiente. No confundir descargar/comprobar con restaurar.
7. Antes de cualquier carga aprobada se comprobará de nuevo el estado remoto y se creará y verificará **otra copia interna**, automáticamente en la RPC de preflight, con SHA y versión exactos. Si falla, no se importa.

## Puerta de autorización operativa (aún cerrada)

**La aprobación de la fuente no equivale a autorizar la incorporación.** Después de verificar respaldo y cuenta, solicitar autorización expresa del responsable para **una única incorporación real**, identificando espacio, SHA, archivo, cuenta administradora y ventana de ejecución corta.

Solo después de ese consentimiento, un operador DBA autorizado podrá crear temporalmente **una** entrada administrativa en `ulit_censo.autorizacion_historico_2025` que contenga el `usuario_id` real, `version_esperada=1`, SHA aprobado, `vigente_hasta` acotado y motivo. **No** incluir IDs de Auth ni SQL de concesión ya ejecutable en esta PR. No alterar `escritura_habilitada` a mano.

La aplicación continuará con `CONFIRMACION_REAL_HABILITADA=false` hasta un cambio de código específico, auditado y autorizado; no activarlo durante la preparación. El servidor 0005 deniega la escritura sin autorización. El responsable deberá volver a revisar el plan real completo antes de confirmar.

## Cierre y verificación del día de incorporación

- La RPC transaccional debe dejar `version=2`, `escritura_habilitada=false`, autorización **consumida** y ninguna parte temporal del lote.
- Cotejar `registros=889`, campaña histórica 2025 única, importación única, 889 vínculos registro-origen, sin pérdidas de filas; conservar sin vincular los 193 pendientes si no se han conciliado explícitamente.
- Confirmar que no existe una campaña operativa 2026 modificada ni datos simulados; comparar estado previo y posterior de otros espacios y módulos.
- Exportar y comprobar respaldo externo del estado **posterior** al commit.
- Si una RPC devuelve error después de enviar datos, **no reintentar ni restaurar automáticamente**: consultar la versión y los registros primero; puede haber resultado ambiguo por red.

## SQL de comprobación exclusivamente de lectura

```sql
select e.id,e.version,e.escritura_habilitada,e.preparacion_habilitada,
 (select count(*) from ulit_censo.entidad x where x.espacio_id=e.id and x.coleccion='calles') as calles,
 (select count(*) from ulit_censo.entidad x where x.espacio_id=e.id and x.coleccion='campanas') as campanas,
 (select count(*) from ulit_censo.entidad x where x.espacio_id=e.id and x.coleccion='registros') as registros,
 (select count(*) from ulit_censo.entidad x where x.espacio_id=e.id and x.coleccion='importaciones') as importaciones,
 (select count(*) from ulit_censo.copia c where c.espacio_id=e.id) as copias_internas,
 (select count(*) from ulit_censo.autorizacion_historico_2025 a where a.espacio_id=e.id) as autorizaciones,
 (select count(*) from ulit_censo.lote_parte l where l.espacio_id=e.id) as lotes
from ulit_censo.espacio e
where e.id='real-medina-del-campo-2026';
```

**Completado**: SQL 0005 instalada y verificada, fuente aprobada, ensayos sintéticos de recuperación, control de importación única. **Pendiente**: nueva copia externa descargada y comprobada por la cuenta administradora; revisión de vista previa real; autorización operativa independiente; cambio del bloqueo de interfaz bajo control; verificaciones posteriores.
