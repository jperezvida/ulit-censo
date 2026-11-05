# ULIT Censo — preparación del primer espacio REAL de Medina del Campo

**Estado: preparación de código, sin activación de datos reales.** El ensayo `ensayo-catedra-2026` ha sido usado desde una preview protegida y ha persistido correctamente municipio y campaña tras cerrar y reabrir sesión. La PR #12 sigue en borrador.

## Decisiones ya fijadas

- **2025 es la fotografía histórica:** se importa desde una **copia del Excel completo original**, sin editar ni sobrescribir ese fichero. Se incorpora como **campaña histórica 2025** con su propia trazabilidad.
- **2026 es una campaña operativa distinta:** cada Excel parcial de itinerario se incorpora a su itinerario de 2026. Altas, bajas y cambios no tienen correspondencia uno a uno garantizada con 2025: las coincidencias se verifican en la conciliación G5, nunca se suponen por el número de fila.
- Las revisiones de **Campo, Oficina (categorización, redes, reseñas) y validación** se registran como estados separados. El histórico 2025 no debe alterarse al actualizar 2026.
- **2026: una persona operativa** durante el arranque; 2027 se abordará la colaboración multiusuario con política separada de permisos.
- **No cargar archivos auténticos en el espacio `ensayo-*`**, ni convertirlo en real, ni reutilizar su estado con datos ficticios.

## Aislamiento y bloqueos — vigentes

1. La web de prueba usa una URL de Vercel con autenticación y clave **pública** de Supabase. Los espacios remotos requieren además sesión Auth y pertenencia a `ulit_censo.miembro`. No permitir datos reales en una preview hasta verificar su versión, acceso privado, CSP y almacenamiento.
2. **NO EXISTE AÚN un espacio `real-*` autorizado en producción.** Un futuro espacio remoto real se crearía expresamente con `escritura_habilitada=false` y una única membresía de la cuenta habitual, tras aprobación. No activar escritura al darlo de alta.
3. El SQL `ulit_censo.aplicar_interno` y las rutas de restauración rechazan las modificaciones cuando `tipo='real'` y `escritura_habilitada=false`. El cliente añade comprobación previa y aviso visible. **Solo una operación administrativa autorizada** podría cambiar ese estado; no hay botón de activación en la web.
4. La confirmación de incorporación auténtica permanece **deshabilitada en código** (`CONFIRMACION_REAL_HABILITADA=false`). No cambiarla hasta validar el flujo de respaldo, vista previa y conciliación de los ficheros auténticos.
5. La pantalla «Analizar el Excel real SIN GUARDAR» mantiene su pin de rama revisada (`RAMA_REVISADA`) y comprobaciones de protección/CSP/huellas. La nueva preview de persistencia **no está autorizada** para analizar archivos reales mientras su rama no supere una revisión independiente de esas garantías.
6. El equipo tiene un respaldo recuperable de PostgreSQL/Storage anterior al ensayo, pero **solo una copia local**: riesgo residual conocido. Antes de cargar datos auténticos, verificar/exportar un nuevo respaldo del estado de Censo, conservarlo fuera del repositorio y completar el plan de custodia según los medios disponibles. No bloquear tareas de preparación de código por ausencia de un disco externo.

## Orden de incorporación — solo tras autorización de escritura

| Paso | Destino | Operación y controles | Qué conservar |
|---|---|---|---|
| 1 | `real-medina-2026` (ID pendiente de aprobación) | Crear espacio **solo lectura**, pertenencia individual y verificar que toda escritura devuelve `42501`; 0 entidades | Huella de Base/Go y estado inicial Censo |
| 2 | Municipio Medina del Campo | Inicializar únicamente después de aprobar el desbloqueo técnico; comprobar nombre, INE, callejero, calles sin conciliar | Registro de quién y cuándo |
| 3 | Campaña histórica 2025 | Preparar desde **copia** del Excel completo original, seleccionar perfil y columnas, obtener diagnóstico y vista previa completa sin guardar | Archivo original inalterado, SHA-256, decisiones, recuentos y advertencias |
| 4 | Censo 2025 | Tras aprobación de diagnóstico, respaldo comprobado y habilitación explícita, incorporar con operación versionada, generar copia y cotejar recuentos; **no modificar la fotografía 2025 después** | Copia externa de Censo y trazabilidad de la importación |
| 5 | Campaña operativa 2026 | Crear campaña de actualización referenciada a 2025 (no copiar sus filas como si fueran 2026) | Vínculo entre campañas |
| 6 | Itinerarios 2026 | Crear los itinerarios existentes y asociar cada Excel **parcial** de campo al itinerario correcto, incluidas partes y calles añadidas | Fuentes parciales originales y hash de cada Excel |
| 7 | Conciliación y Oficina | Revisar altas/bajas/cambios; resolver «sin conciliar» y duplicados; completar categorización, RRSS y reseñas; validar | Historial Campo/Oficina/Validación y decisiones por fila |

## Aceptación antes de cambiar el modo real

- [x] Persistencia del ensayo desde web y reapertura comprobadas.
- [x] Permisos aislados del esquema y escritura restringida a Auth y membresía.
- [x] Protección de escritura real comprobada en SQL local; prueba adicional E2E del cliente en PR #12.
- [ ] Revisar/aprobar la versión de web específica de datos auténticos; **no utilizar la preview sintética como destino real**.
- [ ] Crear el espacio `real-*` **bloqueado** solo mediante una operación autorizada; comprobar 0 datos y un único miembro.
- [ ] Validar con los archivos originales **en el equipo de la Cátedra**, sin subirlos a GitHub ni incluir su contenido en logs.
- [ ] Confirmar respaldo recuperable de Censo, revisión visual de muestra y conciliación con las fuentes.
- [ ] Obtener autorización separada para habilitar escrituras de datos reales y cambiar el bloqueo del importador.
- [ ] Cotejar huella de ULIT Base/Go con el **mismo actor**, antes y después de cada cambio de esquema de Censo, sin tocar tablas de otras apps.

## Qué NO hacer

- No importar los itinerarios 2026 como un nuevo censo histórico.
- No asumir correspondencia fila a fila entre el censo 2025 y los Excel de campo 2026.
- No utilizar el Excel 2025 original como hoja de actualización editable.
- No usar datos ficticios para «rellenar» huecos del censo real.
- No desbloquear solo desde JavaScript: la barrera administrativa en Supabase debe seguir siendo decisiva.
- No fusionar PR #12, asignar dominios de producción, crear espacios reales ni habilitar escritura sin permiso específico.
