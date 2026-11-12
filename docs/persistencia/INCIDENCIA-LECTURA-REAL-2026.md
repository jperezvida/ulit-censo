# Incidencia de acceso · lectura completa del censo 2026

**Fecha:** 11/11/2026 · **Espacio:** `real-medina-del-campo-2026`

## Causa respaldada por registros de Supabase
- El inicio de sesión devolvió **200** (correcto).
- La antigua RPC `public.ulit_censo_leer`, que construye toda la base como una
  sola respuesta JSON, devolvió errores **500** y **520** durante el acceso, uno
  de ellos tras unos 71 segundos de espera.
- El código anterior no imponía un límite de tiempo al acceso ni permitía
  salir de «Verificando sesión y datos auténticos…» mientras la petición
  permaneciera pendiente.
- La construcción SQL interna del documento completo tardó unos 7 segundos
  en una prueba de solo lectura; la construcción de la primera página de 250
  entidades tardó unos 25 milisegundos en otra prueba, sin incluir la red ni
  el procesamiento en el navegador. Estas medidas no acreditan por sí solas
  el tiempo final de inicio de sesión.

## Corrección
- `public.ulit_censo_leer_parte`: función de **solo lectura**, páginas de
  250 entidades ordenadas por `coleccion,id`, cursor y versión esperada.
- Comprueba membresía con `ulit_censo.exigir`, limita el espacio a Medina
  real y la versión, y solo concede `EXECUTE` a `authenticated`; `anon` y
  `service_role` no disponen de permiso.
- La aplicación comprueba la versión en cada página y **no presenta datos
  parciales** si la lectura falla o cambia la versión. Las llamadas se envían
  por GET para admitir los reintentos seguros ya incluidos en Supabase JS.
- La sesión tiene un límite de comprobación de 12 segundos, el acceso por
  contraseña uno de 15 segundos y la lectura completa uno de 32 segundos.
  Un fallo se muestra con opción de reintento, sin cargar la demostración.
- Conserva una compatibilidad temporal con la RPC antigua si la función
  nueva no está todavía disponible en una instalación distinta.

## Verificaciones
- Migración 0011 ensayada en PostgreSQL 17 aislado, con tests positivos y
  negativos (cuenta no miembro, función anónima, límites de página y versión).
- Se instaló **únicamente 0011**, función de lectura, en el servidor del
  espacio existente. NO se aplicó 0010 ni se habilitaron correcciones.
- Después de la instalación, el espacio seguía en versión **8**, con
  1.706 registros históricos+2026, 0 correcciones, escritura/preparación
  desactivadas y ninguna copia v8 creada.
- La comprobación visual autenticada del resultado final queda pendiente
  de abrir la nueva vista previa de Vercel.

## Control de salida
No fusionar PR #23 ni desplegar a producción por este diagnóstico. La
validación del acceso en la vista previa y de las demás funciones de Oficina
sigue siendo necesaria antes de publicar.
