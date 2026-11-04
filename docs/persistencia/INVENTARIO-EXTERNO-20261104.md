# Inventario externo de recuperación — 4 de noviembre de 2026

> Inventario de metadatos **leído sin modificar producción**. No contiene contraseñas, secretos, identificadores de usuarios, JWT, comandos de cron ni archivos de Storage. El inventario es una fotografía: los recuentos pueden cambiar.

## Identificación

- Proyecto: `censo-comercios` (ref `ldegybookaubncnayhep`), Supabase administrado, región `eu-west-3`, PostgreSQL **17.6**.
- Proyecto compartido entre ULIT Base y ULIT Go; ULIT Censo todavía sin migraciones aplicadas (**0** esquemas `ulit_censo` y **0** RPC `public.ulit_censo_*`).
- Historial de migraciones aplicado: **45 entradas**, incluida la retirada del rol de respaldo temporal.
- Extensiones instaladas: `pg_cron` 1.6.4, `pg_net` 0.20.3, `pg_stat_statements` 1.11, `pgcrypto` 1.3, `plpgsql` 1.0, `supabase_vault` 0.3.1, `uuid-ossp` 1.1.

## PostgreSQL y respaldo ya verificados

- Respaldo: `censo-comercios-20261104T163414Z.dump`, **fuera de GitHub**, en `C:\Users\catedra\ULIT-Censo-Resguardos\ulit-censo-respaldo-20261104T163414Z\`.
- Prueba en PostgreSQL Docker sin red, `template0`, versión mayor 17, `pg_restore --no-owner --single-transaction --exit-on-error`: 114 tablas, cero diferencias en los datos inventariados; 1.318 objetos lógicos iguales tras la normalización documentada.
- 79 instrucciones `ENABLE ROW LEVEL SECURITY` y 0 `FORCE`, coincidentes con origen.
- Las ACL diferentes se explicaron por restauración con propietario `supabase_admin` en lugar de `postgres`; **no se ha validado equivalencia funcional de roles globales ni de servicios**.
- Rol temporal privilegiado `ulit_censo_respaldo_temporal`: **retirado y ausencia verificada**.
- Ver `RECUPERACION-VERIFICADA-20261104.md` para los límites probados y el script PowerShell 7.

## Auth

| Indicador observado | Valor |
|---|---:|
| Usuarios | 5 |
| Identidades | 5 |
| Identidades de tipo `email` | 5 |
| Sesiones registradas en origen | 29 |
| Factores MFA registrados | 0 |

**No verificable desde las herramientas actuales:** URL del sitio, lista de redirecciones, estado de confirmación/captchas, limitaciones de registro, plantillas de correo, SMTP, hooks, política de contraseñas, caducidad JWT y claves de firma. Que las identidades usadas sean `email` **no acredita** que otros proveedores no estén configurados. Las sesiones existentes no se consideran recuperables sin una prueba funcional: prever nuevo inicio de sesión.

## Storage

| Bucket | Público | Objetos | Límite por archivo | MIME configurados |
|---|---|---:|---:|---:|
| `oportunidades-documentos` | No | 5 | 18 MiB | 12 |
| `ulit-go-releases` | Sí | 15 | 250 MiB | 2 |
| `ulit-go-screenshots` | No | 0 | 1 MiB | 2 |

Cuatro políticas RLS en `storage.objects`: `oportunidades_archivos_select`, `oportunidades_archivos_insert`, `oportunidades_archivos_delete` y `Public read ULIT Go release APKs`. El dump incluye metadatos de los buckets y políticas; **los bytes de los archivos son otra copia distinta**. Los 20 archivos fueron descargados, tienen SHA-256 local verificado y están fuera del repositorio; **11 no disponían de MD5 de origen para una comprobación criptográfica origen/destino**. Aún no se ha hecho una subida de restauración y prueba de acceso en un Storage separado.

## Edge Functions

- **39** funciones desplegadas en estado `ACTIVE`.
- **39/39** carpetas fuente existentes en `jperezvida/censo-locales`, sin ninguna ausencia de nombres.
- Revisión **fijada** para recuperar el código: [`91131528336af1fedccf0275e8f73b2826f31a97`](https://github.com/jperezvida/censo-locales/commit/91131528336af1fedccf0275e8f73b2826f31a97); las fuentes residen en [`supabase/functions/`](https://github.com/jperezvida/censo-locales/tree/91131528336af1fedccf0275e8f73b2826f31a97/supabase/functions).
- Configuración de validación JWT en el gateway: **20 con `verify_jwt=true` y 19 con `verify_jwt=false`**. Esto no determina por sí solo si cada función verifica credenciales mediante otros mecanismos. Para desplegar, reproducir el ajuste exacto y revisar autorización funcional.
- **No se ha cotejado el código fuente de ese commit con el bundle exacto desplegado por cada función.** La coincidencia de nombres no acredita equivalencia binaria.
- **No se han exportado** las variables de entorno, claves de terceros ni secretos de Edge Functions.

### Correspondencia de funciones desplegadas y fuentes de GitHub

| Función desplegada | Fuente en la revisión indicada |
|---|---|
| `analizar-oportunidad` | `supabase/functions/analizar-oportunidad/` |
| `base-push-dispatch` | `supabase/functions/base-push-dispatch/` |
| `base-push-subscription` | `supabase/functions/base-push-subscription/` |
| `buscar-oportunidades` | `supabase/functions/buscar-oportunidades/` |
| `device-app-update-check` | `supabase/functions/device-app-update-check/` |
| `device-command-ack` | `supabase/functions/device-command-ack/` |
| `device-commands-poll` | `supabase/functions/device-commands-poll/` |
| `device-config-ack` | `supabase/functions/device-config-ack/` |
| `device-heartbeat` | `supabase/functions/device-heartbeat/` |
| `device-pairing-ack` | `supabase/functions/device-pairing-ack/` |
| `device-pairing-claim` | `supabase/functions/device-pairing-claim/` |
| `device-pairing-complete` | `supabase/functions/device-pairing-complete/` |
| `device-pairing-start` | `supabase/functions/device-pairing-start/` |
| `device-pairing-status` | `supabase/functions/device-pairing-status/` |
| `device-remote-assistance` | `supabase/functions/device-remote-assistance/` |
| `device-screen-capture-upload` | `supabase/functions/device-screen-capture-upload/` |
| `recordatorios-catedra` | `supabase/functions/recordatorios-catedra/` |
| `resumen-dedicacion` | `supabase/functions/resumen-dedicacion/` |
| `resumen-oportunidades` | `supabase/functions/resumen-oportunidades/` |
| `ulit-go-app-release-create` | `supabase/functions/ulit-go-app-release-create/` |
| `ulit-go-app-release-get` | `supabase/functions/ulit-go-app-release-get/` |
| `ulit-go-app-release-policy-update` | `supabase/functions/ulit-go-app-release-policy-update/` |
| `ulit-go-app-release-publish` | `supabase/functions/ulit-go-app-release-publish/` |
| `ulit-go-app-releases-list` | `supabase/functions/ulit-go-app-releases-list/` |
| `ulit-go-businesses-list` | `supabase/functions/ulit-go-businesses-list/` |
| `ulit-go-device-assignment-update` | `supabase/functions/ulit-go-device-assignment-update/` |
| `ulit-go-device-command-create` | `supabase/functions/ulit-go-device-command-create/` |
| `ulit-go-device-commands-list` | `supabase/functions/ulit-go-device-commands-list/` |
| `ulit-go-device-config-get` | `supabase/functions/ulit-go-device-config-get/` |
| `ulit-go-device-config-update` | `supabase/functions/ulit-go-device-config-update/` |
| `ulit-go-devices-list` | `supabase/functions/ulit-go-devices-list/` |
| `ulit-go-enrollment-management` | `supabase/functions/ulit-go-enrollment-management/` |
| `ulit-go-fleet-management` | `supabase/functions/ulit-go-fleet-management/` |
| `ulit-go-remote-assistance-diagnostics` | `supabase/functions/ulit-go-remote-assistance-diagnostics/` |
| `ulit-go-remote-assistance-signal` | `supabase/functions/ulit-go-remote-assistance-signal/` |
| `ulit-go-remote-assistance-start` | `supabase/functions/ulit-go-remote-assistance-start/` |
| `ulit-go-turn-rotate` | `supabase/functions/ulit-go-turn-rotate/` |
| `ulit-go-turn-test` | `supabase/functions/ulit-go-turn-test/` |
| `ulit-go-turn-usage` | `supabase/functions/ulit-go-turn-usage/` |

## Programación y secretos

| Tarea `pg_cron` | Expresión programada | Activa |
|---|---|---|
| `base-catedra-recordatorios-hora` | `0 * * * *` | Sí |
| `ulit-go-turn-rotation` | `0 */24 * * *` | Sí |
| `ulit-go-fleet-scheduler-v1` | `*/5 * * * *` | Sí |

No se han leído, guardado ni publicado los campos `cron.job.command` porque podrían contener credenciales o datos operativos sensibles. Antes de restaurar otro entorno, comprobar que no se ejecuten por duplicado con producción.

`vault.secrets`: **2 registros cifrados**. No se han consultado sus nombres ni contenido. No está demostrado que una copia lógica portable permita utilizarlos sin restaurar correctamente el mecanismo de claves y entorno.

## Conclusión de esta fotografía

**Acreditado:** presencia de las tablas/cuentas/metadatos, 39/39 fuentes localizables en GitHub y programación inventariada sin secretos.

**Pendiente:** copia cifrada de configuración externa, comprobación de versión desplegada de Edge Functions, recuperación funcional de Auth, Storage, funciones, Vault, cron y roles. Consultar `PLAN-RECUPERACION-OPERATIVA-20261104.md` antes de proponer una recuperación integral.
