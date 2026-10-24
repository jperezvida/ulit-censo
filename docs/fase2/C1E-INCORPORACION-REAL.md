# C1e · Incorporación segura del censo real de Medina del Campo 2025

> **Estado (23-10-2026):**
> - **C1e-A está implementado y probado solo con archivos sintéticos.**
> - **C1e-B está preparado:** la pantalla del espacio de datos reales llega hasta la vista previa y la **confirmación está bloqueada** (`CONFIRMACION_REAL_HABILITADA = false` en `src/store/espacios.ts`).
> - **No se ha incorporado ningún dato real.** El archivo auténtico no está en el repositorio ni lo ha procesado Claude.

## 1. Dos espacios completamente independientes (tres, con el ensayo)

| Espacio | Para qué | Almacenamiento (IndexedDB del navegador) | Identificadores |
|---|---|---|---|
| **Demostración** | Lo de siempre: campañas, locales y negocios ficticios, incluido el histórico ficticio 2025 | `keyval-store` (clave `ulit-censo:demo-db`), sin cambios | `mun-medina`, `camp-medina-2025`… |
| **Ensayo** | Probar el procedimiento real completo con archivos **sintéticos** | Base propia `ulit-censo-ensayo` | prefijo `ensayo-` (`ensayo-mun-medina`, `camp-hist-ensayo-mun-medina-2025-…`) |
| **Datos reales** | El censo auténtico de 2025 (y más adelante 2026) | Base propia `ulit-censo-real` | prefijo `real-` (`real-mun-medina`, `camp-hist-real-mun-medina-2025-…`) |

- **Pantalla propia:** `#/espacios`, con cabecera y banda de color propias (rojo para los datos reales, violeta para el ensayo). Se llega desde el botón «Datos reales» de la cabecera de la demostración. No comparte estado con la demostración: es otro almacén (`src/store/espacios.ts`).
- **Marca de espacio en cada base:** tipo, identificador aleatorio, fecha y persona responsable. `verificarEspacio` la comprueba al abrir, antes de cada escritura y al restaurar. Exige:
  - un único municipio del espacio;
  - calles y personas con el prefijo del espacio;
  - nada `simulado`;
  - ningún local con coordenadas sin verificar.
- **La demostración se protege en el otro sentido:** se niega a abrir, guardar o recuperar una base marcada como ensayo o real.
- **Sin colisiones:** los identificadores de C1c derivan del municipio, así que campañas, registros, locales, negocios, observaciones y vínculos no pueden coincidir con los de la demostración. Lo comprueba una prueba que cruza todas las colecciones.
- **Nada se sustituye automáticamente:**
  - crear un espacio exige que no exista;
  - restaurar guarda antes una copia interna (`respaldo-interno`);
  - la demostración no se toca.

## 2. Un solo importador, en el navegador

El archivo se elige con un selector local (`<input type="file">`) y se lee y procesa **en el navegador**: no hay servidor. Se reutiliza exactamente:

| Paso | Pieza |
|---|---|
| Lectura segura (límites ZIP, hojas, perfil 27) | C1a · `lector.ts`, `analisis.ts` |
| Capa original e interpretación | C1b · `interpretacion.ts` |
| Plan, aplicación atómica, integridad, deshacer, reimportación | C1c · `incorporacion.ts` |
| Decisiones trazadas (reglas, diccionario, exclusiones, correspondencias, equivalencias) | C1d · componente `Decisiones` (ahora con `ContextoIncorporacion`) |

**Novedad en C1c: la decisión trazada `periodoTrabajo`.** El censo 2025 tiene 355 fechas de 2024. Con esta decisión, aplicada por defecto con la autorización de la solicitud C1e, esas fechas originales se conservan como fecha de observación sin marcarlas «fuera de campaña». Sin ella quedarían pendientes y sin usar. El periodo no puede pasar del 31-12-2025.

**Bytes del archivo:**
- solo en memoria durante la sesión;
- se descartan al cerrar el asistente o la pestaña;
- no se guardan en IndexedDB, en el repositorio ni en registros de diagnóstico.

En la base se guarda lo mismo que en C1c: cada fila con sus celdas originales, la huella SHA-256, el perfil, la persona, la fecha y las decisiones.

### Asistente (cinco etapas)
1. **Archivo:**
   - nombre, tamaño y SHA-256 calculado en el navegador;
   - comparación con la huella del diagnóstico agregado (`645179a8…cb67a`);
   - marca de archivo generado por la aplicación;
   - decisión de periodo.
2. **Diagnóstico:**
   - 26 indicadores calculados sobre los valores **originales** y comparados con el informe agregado;
   - hojas (`Datos` se usa; `Tablas Dinámicas` y `Hoja1`, no);
   - conciliación de calles:
     - coincidencia literal;
     - coincidencia exacta tras normalizar;
     - pendientes de conciliar;
     - ambiguas;
   - señales (número ausente, fecha no válida, estado desconocido, clasificación incompleta…) y la revisión por grupos de C1d.
3. **Decisiones** (C1d).
4. **Vista previa:**
   - identificación (persona, fecha, fichero, SHA-256, perfil, destino, periodo y decisiones);
   - registros **preparados / vinculados / pendientes / excluidos / bloqueados**, con los pendientes por motivo y los portales compartidos;
   - entidades que se crearían;
   - pendientes y advertencias;
   - requisitos y casilla «He revisado la vista previa».
5. **Resultado:** recuento, aviso de hacer un respaldo nuevo y «Deshacer».

## 3. Reglas del censo 2025 que se garantizan

- **Todas las filas se conservan**, con sus valores originales, sin corregir ni eliminar ninguno. La fila sin estado, las fechas no válidas, los números ausentes, las fachadas sin medir y las clasificaciones incompletas se **señalan**, pero no se eliminan.
- **Mismo portal = locales independientes:** cada fila con calle y número reconocidos crea su propio local. Un ejemplo con el archivo sintético en el espacio real: 353 locales en 148 portales compartidos.
- **Sin correspondencia territorial:** se conserva el registro y su vínculo queda «sin vínculo» con el motivo. No se inventan calles ni números.
- **Histórico, no 2026:**
  - la campaña nueva es `historico-importado`, con revisión y validación pendientes;
  - observaciones `pendiente`;
  - franquicia y presencia digital con origen `importado` (digital en `borrador`);
  - clasificaciones como texto literal, sin equivalencias automáticas.
- **«Long fachada»** se trata como longitud en **metros lineales**.
- **Sin geolocalización inventada:** los locales reales no tienen coordenadas. El mapa por establecimientos no los dibuja (no son ficticios, así que no se simula su posición) y el mapa por calles muestra su calle. La posición queda pendiente.
- **2026 es independiente.** Una prueba verifica que incorporar 2025 no cambia la campaña 2026, su itinerario 1 ni sus revisiones, y que no se crean franquicias, datos digitales ni clasificaciones en 2026. Además, no se puede incorporar nada como 2026. En el espacio real no se ha creado aún ninguna campaña 2026 ni se importan sus datos de campo.

## 4. Seguridad, respaldo y almacenamiento

**Dónde quedan los datos:**
- en IndexedDB **de ese navegador, de ese perfil y de esa dirección web**: en Codespaces, la URL del puerto reenviado;
- otro navegador, equipo o URL no los ve;
- borrar los datos del sitio los elimina;
- el navegador puede borrarlos si le falta espacio, salvo que se haya concedido el almacenamiento **persistente** (botón «Pedir almacenamiento persistente»).

**IndexedDB no es un almacenamiento institucional.** Por eso:

1. **Respaldo externo recuperable:** «Descargar respaldo» genera `ULIT-Censo-DATOS-REALES-respaldo-<fecha>.json`. Es un sobre con el tipo e identificador del espacio, la versión de datos, un resumen y la **huella SHA-256 del contenido**, seguido de la base completa. Contiene registros celda a celda, nombres de negocio, etc.: **trátelo como dato confidencial**.
2. **Comprobación del respaldo:** «Comprobar un respaldo» vuelve a leer el archivo descargado y verifica el formato, el espacio, la huella y la separación. Si coincide con el estado actual, queda registrado como «respaldo comprobado del estado actual».
3. **Restauración completa:** «Restaurar desde un respaldo» solo admite respaldos del **mismo tipo y del mismo espacio**. Antes guarda una copia interna y escribe con verificación. Se rechazan los respaldos dañados (huella), los de otro tipo y los de otro espacio.
4. **Requisitos para incorporar** (se muestran en pantalla y el almacén los vuelve a comprobar):
   - espacio verificado;
   - persona de coordinación;
   - plan aplicable;
   - perfil del censo 2025;
   - archivo admitido: el real rechaza los generados por la aplicación y el ensayo rechaza el auténtico;
   - vista previa revisada;
   - **respaldo comprobado del estado actual**;
   - espacio disponible (`navigator.storage.estimate`);
   - en el espacio real, además, la confirmación habilitada, que está **bloqueada en C1e-B**.
5. **Escritura verificada:**
   - antes de escribir se comprueba que nadie, por ejemplo otra pestaña, haya cambiado el espacio desde que se abrió;
   - después se vuelve a leer y se compara la huella;
   - si no coincide, se restablece el estado anterior y se informa.
6. **Sin duplicados:** la reimportación del mismo archivo queda bloqueada (C1c) y no se admiten dos operaciones a la vez.
7. **Supabase:** no se conecta. Una base de datos productiva requiere autorización.

## 4 bis. Vista previa web y análisis sin guardar

Ya no hace falta Codespaces. La dirección fija de Vercel ([`PREVIEW-VERCEL.md`](PREVIEW-VERCEL.md)) incluye **«Analizar el Excel real SIN GUARDAR»**:
- verifica en el navegador la protección, la ausencia de transmisión a terceros y la versión;
- analiza el XLSX solo en memoria, hasta la vista previa.

En la web, el espacio de datos reales **guardado** está desactivado.

## 5. Probarlo en Codespaces (alternativa)

```bash
git fetch origin && git checkout claude/fase2-oficina-itinerarios && git pull
npm ci
npm test                 # 398 pruebas (34 ficheros), incluidas C1e
npm run sintetico-c1e    # genera sinteticos/CENSO_MEDINA_2025_SINTETICO_C1E.xlsx (no se sube a git)
npm run dev              # abrir el puerto 5173 en el navegador
```

### C1e-A · Ensayo con el archivo sintético
1. En la aplicación, pulse «Datos reales» en la cabecera (o vaya a `#/espacios`) y elija **Espacio de ensayo**.
2. Cree el espacio con su nombre.
3. **Respaldo:** «1. Descargar respaldo» y, a continuación, «2. Comprobar un respaldo» con el archivo descargado. Debe aparecer «coincide con el estado actual».
4. **Archivo:** seleccione `sinteticos/CENSO_MEDINA_2025_SINTETICO_C1E.xlsx`. También se puede descargar desde la tarjeta «Estado».
5. **Analizar:** los 26 indicadores deben coincidir con el informe agregado; las calles, 10 literales + 60 normalizadas + 23 pendientes.
6. «Siguiente» hasta **Vista previa**: 889 preparados, 0 bloqueados. Marque «He revisado la vista previa» e **Incorpore**.
7. **Comprobar:**
   - el resultado;
   - el aviso de hacer un respaldo nuevo;
   - «Deshacer la incorporación» (deja el espacio como estaba);
   - «Restaurar desde un respaldo».
8. Vuelva a la demostración: debe seguir igual.

### C1e-B · Vista previa del archivo auténtico (sin confirmar)
1. Vaya a `#/espacios` → **Espacio de datos reales** y créelo con su nombre.
2. Descargue y compruebe un respaldo, y pida el almacenamiento persistente.
3. Seleccione su `CENSO COMPLETO MEDINA 2025(1).xlsx` **desde su equipo**. Se procesa en el navegador; no se sube a ningún sitio.
4. Compruebe que el SHA-256 «Coincide con la huella del archivo auténtico».
5. **Analizar** y revise:
   - los indicadores frente al informe;
   - las denominaciones de calle pendientes de conciliar;
   - las señales;
   - la revisión por grupos;
   - en la **vista previa**: preparados, vinculados, pendientes y bloqueados, entidades, pendientes y advertencias.
6. **Deténgase ahí.** El botón «Incorporar al espacio» está deshabilitado y la pantalla muestra «C1e-B · Detenido aquí». Compartan las cifras de la vista previa (sin datos comerciales) para revisarlas juntos.

## 6. Pendiente (requiere autorización)

- **Habilitar la confirmación real** (`CONFIRMACION_REAL_HABILITADA`), tras revisar la vista previa del archivo auténtico.
- **Conciliar las denominaciones de calle pendientes**, por ejemplo con alias aprobados como decisión trazada. Hoy esas filas quedan «sin vínculo», con su registro.
- **Campaña 2026 en el espacio real:** itinerarios y tareas pendientes, sin copiar nada de 2025.
- **Mostrar el cuadro de mando sobre el espacio real.** Hoy los datos del espacio se ven en su propia pantalla; el dominio del cuadro ya es compatible y se ha probado.
- **Almacenamiento institucional duradero** (Supabase u otro) y, mientras tanto, procedimiento de custodia de los respaldos.

## 7. Pruebas

| Archivo | Qué comprueba |
|---|---|
| `src/domain/c1e.test.ts` (8) | El sintético reproduce los 26 indicadores del informe y lleva su marca; hojas auxiliares no importadas; vista previa (recuentos, calles 10/60/23, sin número, mismo portal); periodo (sin decisión, 355 fechas pendientes; con ella, fechas originales conservadas); incorporación con originales, histórico sin verificar, sin coordenadas ni posiciones simuladas; reimportación bloqueada; deshacer exacto; 2026 intacto y sin poder importarse; ningún identificador compartido entre demostración, ensayo y real; respaldo íntegro y rechazos; sin espacio con callejero simulado |
| `src/store/espacios.test.ts` (6) | Base IndexedDB propia, sin sobrescribir y sin tocar la demostración; incorporar exige un respaldo comprobado (y otro después); espacio real: rechaza sintéticos y está bloqueado incluso si la interfaz fallase; detección de otra pestaña; restauración con copia interna y rechazos; la demostración no abre una base de espacio |
| `src/workspaces/espacios/espacios.test.tsx` (2) | Flujo completo de interfaz en el ensayo (archivo → diagnóstico → vista previa → respaldo → incorporación); en el espacio real, rechazo del sintético y confirmación bloqueada |
| `src/data/callejeroOsm.test.ts` | Instantánea real de OSM válida y atribuida; de las calles de IT 2, «López Flores» coincide y «San Francisco» (en OSM, «Callejón de San Francisco») y «Los Mostenes» quedan pendientes de conciliar |
