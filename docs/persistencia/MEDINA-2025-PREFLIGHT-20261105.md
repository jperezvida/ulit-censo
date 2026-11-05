# Medina del Campo · preflight de importación del histórico 2025 (05/11/2026)

**Estado:** solo preparación de código. **Ningún dato real incorporado, ninguna escritura habilitada, ninguna autorización operativa concedida.** Esta rama parte de la PR borrador #12 y solo se propone fusionarla a esa rama tras CI y revisión; no a `main`.

## Evidencia de la revisión humana (en navegador protegido, sin guardar)

- Excel copia local: huella SHA-256 `9e367ca51cfecf56d93f124d166f708e374f6555a4cc36d3166afde2f1f7ba82`.
- Huella de antigua referencia: `645179a850474ab92bc54c9ed4e6e2f300790f62081fb0ea02d3999e3c4cb67a`. **Difieren.** La coincidencia de agregados **no prueba** igualdad de todas las celdas. **La Cátedra aprobó expresamente la copia el 05/11/2026** como fuente histórica; se custodian ambas huellas por trazabilidad. Véase `MEDINA-2025-APROBACION-FUENTE-20261105.md`.
- `Datos`: 889 filas, 27 columnas; 608 ocupados, 280 vacíos y 1 sin estado. 242 comercio, 277 servicios, 90 hostelería; fechas 2024/2025: 355/533, una anomalía.
- Plan: 889 registros; 696 con local inicial, 193 sin local, 0 exclusiones y 0 bloqueos. De los pendientes: 177 por calle no conciliada, 10 S/N, 5 número desconocido y 1 estado desconocido.
- 21 denominaciones sin correspondencia, 177 filas. No vincular automáticamente por semejanza: Plaza Mayor, Farolas/Ángel Molina y Ronda de Gracia requieren cautela especial.
- Clasificación 2025 conservada literalmente, sin asignación automática al catálogo 2026. 2026 es campaña operativa distinta.
- La marca de revisión de la vista previa **solo vivió en memoria**; la autorización futura requiere revisar de nuevo el plan del espacio REAL.

## Preflight nuevo, sin autorización

`src/domain/comprobarCandidatoMedina2025.ts` añade un contrato de seguridad *cliente* para la primera importación real:

1. Solo el espacio `real-medina-del-campo-2026` y municipio `real-mun-medina`.
2. Solo censo histórico 2025, nunca itinerario/operativo 2026.
3. Solo la huella exacta del ejemplar revisado (sin sustituir la huella histórica anterior).
4. 889 filas íntegramente conservadas, sin exclusiones, plan sin bloqueos, periodo 2024-01-01 a 2025-12-31.
5. Al confirmar, se comprueba otra vez que la interpretación tiene 889 filas y 27 columnas.
6. Las correspondencias territoriales pueden mejorar tras una revisión supervisada; los recuentos 696/193 son evidencia inicial, **no** condición rígida que impida corregir calles.

Se comprueba en `requisitosIncorporacion` y *otra vez* en `incorporar`; **no se confía** en que el botón esté desactivado ni en los requisitos aportados por el navegador. Las pruebas son totalmente sintéticas.

**Limitaciones:** el preflight es código de cliente y no constituye autorización de seguridad por sí mismo; sigue siendo necesaria la barrera del servidor. Los agregados y la huella no garantizan la legitimidad ni la calidad de todas las celdas.

## Barreras que permanecen cerradas

- `CONFIRMACION_REAL_HABILITADA = false`; no se cambia en este trabajo.
- `ulit_censo.espacio.escritura_habilitada = false` (se confirma por consulta de solo lectura antes de actuar).
- Espacio real del servidor exige Auth, membresía, rol y versión de datos. La actualización del servidor se sigue denegando si está bloqueado.
- No se usa el modo `soloMemoria` para guardar; jamás importar el Excel auténtico a `ensayo-*`.
- No modificar la app Base/Go ni sus esquemas.
- No subir el Excel original, la copia, respaldo JSON/SQL ni credenciales a GitHub, Vercel o CI.

## Hitos antes de solicitar aprobación para escribir

- [ ] CI del nuevo contrato y pruebas sintéticas en verde, sin datos reales en GitHub.
- [ ] Revisión independiente del código desplegado, incluido bloqueo de red/SSO/CSP.
- [ ] Definir y ensayar la **restauración selectiva de ULIT Censo** tras una importación fallida, sin revertir ULIT Base/Go.
- [ ] Respaldo nuevo y recuperable del estado real, verificado *inmediatamente antes* de la operación. El JSON externo comprobado por el usuario acredita integridad del espacio, no recuperación operativa integral de Supabase.
- [x] Aprobar documentalmente la copia del Excel con SHA diferente (05/11/2026; **no** incluye autorización de importación).
- [ ] Confirmar ensayo E2E de la operación con archivo sintético y controles de doble envío / concurrencia / reversión.
- [ ] **Autorización explícita e independiente** del responsable para cambiar el código de bloqueo y habilitar escritura **solo en el espacio real elegido**.
- [ ] Tras la operación autorizada: cotejo read-only de 889 registros, estado de 2025/2026 y huella de Base/Go, exportar y comprobar un nuevo respaldo y volver a bloquear la escritura.

No ejecutar ni proponer un `UPDATE escritura_habilitada = true` sin estos pasos y autorización expresa.
