# Plan de recuperación operativa — 4 de noviembre de 2026

**Ámbito:** Supabase `censo-comercios`, compartido entre **ULIT Base**, **ULIT Go** y, tras autorización, **ULIT Censo**. Este documento es un **procedimiento de preparación**, no un certificado de recuperación integral ya ejecutada.

**Riesgo principal:** el respaldo de PostgreSQL y los 20 ficheros de Storage están conservados y los datos se han restaurado en Docker; faltan configuraciones externas y comprobar la recuperación de los servicios. Véase `INVENTARIO-EXTERNO-20261104.md`.

## Reglas no negociables

1. **Nunca restaurar íntegramente el dump sobre el Supabase compartido** para corregir un error de ULIT Censo: sobrescribiría datos posteriores de ULIT Base/Go. La reversión de Censo se limita a los objetos `ulit_censo` y `public.ulit_censo_*`, previa copia/exportación de sus datos si existieran y aprobación del responsable. El script `20261104_9000_ulit_censo_retirada.sql` es destructivo para los datos de Censo y no debe ejecutarse automáticamente.
2. En un desastre total utilizar un destino **nuevo y aislado**, compatible con la misma versión de los servicios; validar antes de sustituir DNS, URLs o clientes. La restauración SQL en el contenedor PostgreSQL aislado **no** prueba el servicio Supabase completo.
3. **No guardar en GitHub, un comentario, un log o un chat** secretos JWT, `service_role`, contraseñas, connection strings, SMTP, TURN, tokens o material de `vault`. Los parámetros sensibles se registran en un gestor de secretos aprobado, separado del repositorio. Aquí solo se indica «custodiado/verificado», nunca el valor.
4. No crear ramas/proyectos Supabase de pago, fusionar PR ni aplicar SQL al compartido sin autorización explícita. Las pruebas del ensayo deben usar datos **sintéticos**.

## Qué ya está probado

- [x] SHA-256 de la copia PostgreSQL y restauración en PostgreSQL Docker aislado, incluyendo 114 tablas y equivalencia del inventario lógico normalizado.
- [x] Inventario de 79 tablas con RLS habilitado y 0 FORCE en el dump.
- [x] Copia local de los 20 archivos de Storage con SHA-256, sin afirmar igualdad criptográfica frente a origen en los 11 sin MD5.
- [x] Rol temporal con `BYPASSRLS` eliminado tras el respaldo.
- [x] 39/39 fuentes de Edge Functions localizadas en `jperezvida/censo-locales` en la revisión fijada por el inventario.
- [x] Flujo de ULIT Censo validado con Auth+PostgREST en Supabase local, datos sintéticos y CI principal en verde (PR #12).

## Qué debe quedar custodiado fuera del repositorio

| Elemento | Qué comprobar y registrar sin el valor | Estado |
|---|---|---|
| Copia PostgreSQL y `storage-20261104T174858Z` | **Segunda copia cifrada** en ubicación físicamente distinta; confirmar acceso y SHA-256 | **Pendiente de comprobar** |
| Auth | Site URL, redirects permitidos, proveedores habilitados, confirmación de correo, plantillas, SMTP, hooks, expiración JWT, política de contraseñas y registro | **Pendiente; no visible completo por estas herramientas** |
| Claves y clientes | Mapa de aplicaciones (Base, Go, Censo y terceros) y origen seguro de credenciales/API keys; plan para actualizar URLs/claves en recuperación | **Pendiente** |
| Edge Functions | 39 nombres, versiones exactas desplegadas, código asociado, configuración `verify_jwt`, nombres de variables externas requeridas y ubicación cifrada de sus valores | **Código localizable; paridad de versión y secretos pendientes** |
| Vault | Identificar para cada uno de los 2 registros el responsable, finalidad y método seguro de recuperación de claves | **Pendiente** |
| `pg_cron` | 3 programaciones; registrar su dependencia de credenciales, sin publicar comandos que puedan incluir tokens | **Horarios inventariados; recuperación sin duplicados pendiente** |
| Storage | Bucket ID, visibilidad, límites, MIME y políticas; además comprobar recuperación real de 20 objetos | **Metadatos inventariados, restauración funcional pendiente** |
| Servicios externos | SMTP, TURN/ayuda remota, dispositivos, notificaciones push, proveedores conectados y sus cambios de endpoint | **Pendiente** |
| Exposición de API | Verificar en dashboard schemas expuestos, CORS, rate limiting, parámetros de Auth y endpoints de funciones | **Pendiente** |
| Roles globales | Exportar/describir con herramientas oficiales y restaurar roles/privilegios apropiados en destino aislado, sin copiar hashes de contraseña a repositorio | **Pendiente de prueba integral** |

## Orden de una recuperación del **proyecto entero** en un destino nuevo

1. **Declarar incidente y congelar el tráfico de escritura** hacia el origen afectado; inventariar hora del respaldo y posible pérdida de cambios posteriores. No activar tareas programadas ni notificaciones salientes en el destino durante pruebas.
2. Preparar una instancia **separada** de Supabase de versión de servicios compatible. Capturar identidad del destino y verificar que no apunta a producción. No reutilizar tokens/secretos en una máquina no custodiada.
3. Aplicar la guía oficial de **restauración de proyecto Supabase** (roles, esquema y datos) adecuada a la versión, con filtros de tablas internas si procede, y contrastar el dump existente. El `20261104_9201_prueba_restauracion.ps1` solo acredita PostgreSQL. El viejo `9201_prueba_restauracion.sh` y el orquestador `9210` **no se consideran certificados** por su dependencia de Auth local desfasado.
4. Verificar recuentos/huellas y permisos mediante **el mismo rol** y sin reemplazar en caliente bases de Base/Go.
5. Configurar **Auth** desde una copia segura de parámetros: proveedores, redirect URLs, correo, hooks, políticas, secretos de firma; probar login con **cuenta de prueba aislada** y asumir que sesiones antiguas pueden requerir nuevo login.
6. Reconstruir **Storage**: buckets y RLS según metadatos; restaurar los **bytes de los archivos** por la API correspondiente y verificar recuento, tamaño, SHA-256 de cada fichero restaurado y acceso público/privado con cuentas sintéticas. Verificar caducidad/cambio de enlaces firmados.
7. Recuperar **39 Edge Functions** desde el commit fijado de `censo-locales`; recuperar sus **variables de entorno de un gestor seguro**, configurar `verify_jwt` según inventario y revisar autenticación interna; probar cada función crítica (recordatorios, oportunidades, flota, actualizaciones, acceso remoto, notificaciones).
8. Comprobar **Vault** (2 entradas) y sus claves de cifrado/descifrado, sin asumir portabilidad solo por haber restaurado tablas.
9. Revisar **cron** con sus 3 tareas inicialmente desactivadas en el destino hasta comprobar que **no funcionan en paralelo** con el origen; reactivar solo tras pruebas y autorización.
10. Ejecutar smoke tests de **ULIT Base** y **ULIT Go** y, si ya existe, **ULIT Censo** con datos sintéticos, incluyendo acceso/denegación, escritura y lectura, RLS, Storage privado y público, Edge Functions críticas y programaciones. Solo entonces evaluar cambio de endpoints y puesta en servicio.

Fuentes oficiales: [Supabase — Backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [Restore from Platform](https://supabase.com/docs/guides/self-hosting/restore-from-platform), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).

## Autorización separada para **ULIT Censo en ensayo**

**No equivale a recuperar todo el proyecto.** Tras cerrar la custodia de copias/configuración y obtener aprobación:

- Registrar huella determinista `9101` del origen con rol `postgres` y resguardar su resultado fuera de GitHub si contiene información operativa.
- Aplicar **solo** `0001_ulit_censo_esquema.sql` y `0002_ulit_censo_operaciones.sql` con control de errores, en el proyecto compartido, tras aprobación expresa. Asegurar que ninguna migración renombra, borra o reescribe los esquemas de Base/Go.
- Comparar inmediatamente huella `9101` usando **el mismo rol, consulta y parámetros**; ante diferencia, detenerse e investigar antes de permitir uso.
- Crear únicamente `ensayo-*` con cuenta existente en Auth y datos sintéticos usando la plantilla 0003 corregida. No crear `real-*`, importar el censo auténtico ni habilitar escritura real.
- Probar entrada web con usuario autorizado, cierre y reapertura, guardado y recuperación, copia e historial, conflicto de concurrencia y denegaciones RLS. Registrar versión de despliegue; no desplegar automáticamente desde la PR.
- No ejecutar `9000` salvo fallo que justifique retirada, copia verificada de cualquier dato de Censo y aprobación explícita.

## Dos niveles distintos de preparación

**A. Instalación limitada de ULIT Censo para ENSAYO sintético (primer hito).**

La recuperación operativa integral de las 39 funciones de Base/Go no es necesaria como condición previa absoluta para instalar **únicamente objetos nuevos** de Censo, siempre que se documente el riesgo residual y se cumplan estas garantías mínimas:

- [x] SQL de Censo probado en Supabase local y PostgreSQL aislado, sin tocar esquemas existentes.
- [x] Copia PostgreSQL verificable y 20 archivos Storage conservados; posibilidad demostrada de recuperar las tablas de Base/Go.
- [x] Código fuente de las 39 Edge Functions localizable y revisión fijada.
- [ ] **Confirmar segunda copia cifrada** de los respaldos, independiente del ordenador de origen.
- [ ] **Capturar la configuración mínima de Auth y aplicaciones necesarias para ensayar**, en una ubicación segura y sin publicar valores, o reconocer expresamente el riesgo restante.
- [ ] Baseline inmediatamente anterior: huella `9101`, estado de Auth, buckets y funciones; plan de retirada limitado a Censo.
- [ ] **Autorización explícita** para aplicar `0001`/`0002` en el proyecto compartido; no hay autorización implícita por haber validado la PR.

Tras estos puntos, se puede valorar un **ensayo acotado de escritura sintética** en `ensayo-*`. No se debe usar el censo auténtico ni habilitar todavía `real-*`.

**B. Recuperación integral del ecosistema y uso real de ULIT Censo (segundo hito, separado).**

- [ ] Configuración y secretos completos custodiados fuera de GitHub (Auth, API, Edge, Vault, SMTP, TURN, push).
- [ ] Paridad de versiones verificable de las 39 Edge Functions y dependencias externas.
- [ ] Recuperación funcional de Auth/Storage/Edge Functions/cron en entorno independiente, con archivos y usuarios sintéticos.
- [ ] Procedimiento de DNS/URLs y reautenticación, pruebas de Base/Go y reconciliación de permisos.
- [ ] Autorización específica para datos reales, importación del censo 2025 e itinerarios 2026.

**Estado actual:** el primer nivel está técnicamente avanzado, pero **NO autorizado para cambiar producción**; el segundo nivel conserva tareas pendientes que no deben ocultarse ni convertir el piloto en una restauración completa desproporcionada.
