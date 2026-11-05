# Recuperación verificada de ULIT Censo — 2026-11-04

**Alcance:** copia externa del proyecto Supabase compartido `censo-comercios` antes de aplicar ULIT Censo. El proyecto contiene también ULIT Base y ULIT Go. No utilizar una restauración integral del proyecto para revertir un cambio de Censo.

## Evidencia obtenida

- El volcado RAW de PostgreSQL `censo-comercios-20261104T163414Z.dump` supera SHA-256.
- Restauración en contenedor `supabase/postgres:17.6.1.043`, sin conexión de red, en base `ulit_verificacion` creada desde `template0`. Roles faltantes creados temporalmente como `NOLOGIN`, parámetro `cron.database_name` ajustado y `pg_restore --no-owner --single-transaction --exit-on-error` sin errores.
- Inventario de **114/114 tablas**, datos **0 diferencias**. **1.318/1.318** entradas de objetos con **0 diferencias lógicas tras normalizar** las llamadas `auth.uid()`/`uid()` y excluir del cotejo estructural las ACL implícitas.
- Las diferencias completas de ACL se explicaron como sustitución de propietario `postgres` por `supabase_admin` en **261 objetos**; no se detectaron concesiones diferentes a otros roles en ese inventario.
- `pg_restore --schema-only`: **79 instrucciones ENABLE RLS y 0 FORCE**, coincidentes con producción.
- Storage respaldado fuera de Supabase: **3 buckets, 20 archivos**, integridad SHA-256 de las copias locales comprobada (11 objetos sin MD5 contrastable con origen).
- El rol temporal con `BYPASSRLS` usado para el respaldo fue eliminado el 4/11/2026 tras autorización, con verificación de ausencia.

**Esta evidencia NO es una recuperación operativa íntegra.** No se ha ensayado el arranque de Supabase Auth, PostgREST, Storage, SMTP o Edge Functions tras un desastre, ni se han exportado mediante este procedimiento los secretos JWT, credenciales o configuración de proveedores externos. `pg_dump` no incluye los roles globales y sus contraseñas; `--no-owner` no conserva los propietarios originales. El inventario 9102 no constituye un test de permisos efectivos de servicio.

## Repetir la verificación SQL en Windows / PowerShell 7

El único archivo de respaldo reside **fuera del repositorio**, en el equipo de la Cátedra. No copiar ni subir respaldos ni secretos a GitHub o Vercel.

```powershell
$dump = "$env:USERPROFILE\ULIT-Censo-Resguardos\ulit-censo-respaldo-20261104T163414Z\censo-comercios-20261104T163414Z.dump"
& ".\docs\persistencia\sql\20261104_9201_prueba_restauracion.ps1" -Dump $dump
```

El script verifica SHA-256, prepara el contenedor Docker aislado, restaura, compara el inventario y limpia el contenedor. Necesita Docker Desktop, PowerShell 7 y el `20261104_9102_inventario_datos.sql` de esta rama; **no solicita ni utiliza credenciales de producción**. Un respaldo nuevo podrá tener otro número de tablas y debe interpretarse según su propio inventario.

## Advertencia sobre el script Unix anterior

`20261104_9201_prueba_restauracion.sh` utiliza Supabase CLI 2.58.5 y un Auth local antiguo, con incompatibilidad comprobada con el esquema Auth de este proyecto (`auth.custom_oauth_providers`). Además, se detectaron incompatibilidades en Windows Git Bash (`/var/tmp`, `python3`, conversiones de rutas Docker). **No usar ese script como evidencia de restauración íntegra de este respaldo.** Revisar `9210_respaldo_completo.sh` antes de reutilizar su cadena automatizada: depende de 9201.

## Antes de implantar ULIT Censo

1. Actualizar el runbook de recuperación operativa de servicios y configuración externa de Auth/Storage/Edge Functions, sin almacenar secretos en GitHub.
2. Preparar una cuenta ya existente de Auth para un espacio exclusivamente sintético `ensayo-*`; no crear todavía el espacio `real-*`.
3. Verificar mediante el mismo ejecutor (rol `postgres`) las huellas `9101` antes/después de instalar SQL 0001/0002 y, si procede, después de retirar 9000.
4. Ejecutar las pruebas locales/E2E de seguridad, importación, Campo, Oficina y copias y revisar los resultados de CI.
5. No aplicar SQL a producción ni fusionar la PR hasta aprobación expresa del responsable.
