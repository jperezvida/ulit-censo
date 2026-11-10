# Censo Medina del Campo 2026 · Fase 1 · verificación de coherencia

**Estado:** diagnóstico independiente de solo lectura. Consultado el 10/11/2026 sobre el
espacio real `real-medina-del-campo-2026`, versión 8, escritura general bloqueada.

## Cobertura comprobada

| Excel incorporado | Filas | Con incidencias |
|---|---:|---:|
| IT1 | 105 | 10 |
| IT2 | 548 | 22 |
| IT3 | 90 | 2 |
| IT4 | 43 | 4 |
| IT5 | 31 | 1 |
| **TOTAL** | **817** | **39** |

- 249 filas indican local vacío (`Local Vacío = 1`).
- 568 filas indican local ocupado (`Local Vacío = 0`).
- 0 filas con estado ausente o inválido.
- 817 filas originales de 2026 están conservadas, con `original` presente; 0 exclusiones.
- 0 diferencias entre el original tipado y la representación textual para `vacio`, `nombre` y `fachada`.
- El censo histórico 2025 (889 filas) NO se incluye en las 817 filas auditadas.

## Motivos encontrados (una fila puede tener varios)

| Regla de revisión | Avisos |
|---|---:|
| Vacío con nombre de negocio | 4 |
| Vacío sin fachada positiva y válida | 27 |
| Vacío con clasificación de actividad rellenada | 10 |
| Vacío marcado como franquicia | 1 |
| Vacío con datos digitales positivos | 10 |
| Ocupado con fachada consignada | 1 |
| Ocupado sin nombre | 0 |

**53 avisos, agrupados en 39 filas.** Una misma fila puede concentrar varias
contradicciones. La diferencia frente a la referencia anterior de 35 debe revisarse
con las 39 fichas; no reducir avisos para forzar un número anterior sin evidencia.

## Integridad y correcciones

El motor examina exclusivamente registros de importaciones confirmadas de la campaña 2026.
No identifica un mismo número de portal como duplicidad. La revisión muestra el Excel
original por separado de la vista corregida; toda corrección se guarda como
`correccionesRegistros` y queda auditada en `operacion` y `entidad_historial`.

**La RPC propuesta aún no está instalada ni autorizada.** La migración introduce además
una autorización administrativa desactivada por defecto: crear el respaldo por sí solo
NO desbloquea la escritura. El espacio real está
en versión 8. Las copias conservadas comprobadas abarcan versiones 1–7: no
existe todavía copia íntegra de la versión 8. La primera corrección debe quedar
bloqueada hasta crear y verificar esa copia. La migración 0010 permanece en la
PR de revisión, sin aplicar.

## Próximas comprobaciones antes de habilitar escritura

1. Revisar exhaustivamente seguridad y validez SQL de la migración 0010,
   especialmente privilegios, transacciones, copia previa y pruebas negativas.
2. Ensayar en PostgreSQL/Supabase local aislado con datos sintéticos: rol
   no autorizado, otro espacio/campaña, campo fuera de lista, edición de origen,
   PT409, guardado y recarga, reversión y auditoría.
3. Validar una copia/restauración de la versión 8 e identificar la autorización
   específica antes de desplegar o activar escrituras reales.
4. Integrar expresamente los valores efectivos corregidos en la exportación y el
   análisis final del censo, sin alterar las fuentes históricas. Hasta entonces,
   «sin avisos» NO equivale a censo definitivo ni debe permitirse cerrar la Fase 5.
5. Verificar visualmente la bandeja en escritorio y móvil, contra los
   totales de esta ficha.
