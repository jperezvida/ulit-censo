# G2 · Municipios, campañas y espacios

**Objetivo:** gestionar varios municipios y varios censos por municipio sin cambiar el código para cada proyecto nuevo.

**Dónde está:** pantalla **Espacios** (`/espacios/ensayo` y, solo en el equipo propio, `/espacios/real`). La demostración (datos ficticios) no cambia.

## Qué se puede hacer

1. **Elegir un municipio o dar de alta uno nuevo** (tarjeta «Municipios»).
   - Datos: nombre, provincia y código INE (opcional, 5 cifras).
   - Reglas territoriales: cómo se usan el código postal, el Distrito y la Zona. Cada uno puede ser «no se usa», «un único valor» (solo el CP), «depende de la dirección» o «según una tabla verificada».
   - Se rechazan los duplicados: mismo nombre y provincia, o mismo código INE.
2. **Crear campañas** (tarjeta «Campañas de …»).
   - **Históricas:** un censo ya hecho que se incorpora desde un Excel. Solo de años anteriores al actual, y nunca en un año que ya tiene una campaña operativa.
   - **Operativas:** un censo nuevo que se planifica y se trabaja en campo (censo nuevo, actualización, o actualización y ampliación).
   - Puede haber **varias campañas del mismo año** con nombres distintos (p. ej., «Censo 2024 · centro» y «Censo 2024 · polígono»).
3. **Incorporar un Excel** en el asistente. El primer paso, **«Destino y archivo»**, pide el municipio y la campaña histórica **antes** de elegir el archivo. Después siguen los pasos de siempre: Columnas (G1), Diagnóstico, Decisiones, Vista previa y Resultado.
   - Solo se ofrecen campañas **históricas vacías** de ese municipio. Una campaña que ya tiene datos aparece deshabilitada.
   - Si no hay ninguna, se crea desde el mismo paso, con «Crear una campaña histórica».

## Modelo (datos, no código)

| Dato | Dónde se guarda | Antes de G2 |
|---|---|---|
| Identificación del municipio (`nombre`, `provincia`, `ine`, `alta`) | `Municipio`, en la base del espacio | Solo Medina, en el código |
| Configuración territorial (`Municipio.territorio`) | `Municipio`, en la base del espacio | Constantes `CONFIG_TERRITORIAL` |
| Estado del callejero (`Municipio.callejero`) | `Municipio`, en la base del espacio | No existía |
| Campañas (`Campana`, con `creada`) | Base del espacio | Solo las creaba la incorporación |

- **Configuración territorial:** `configTerritorialDe(db, municipioId)` usa la del municipio. Las constantes de `territorio.ts` solo se usan como referencia: en la demostración y en las bases creadas antes de G2, que no tienen el dato.
- **Identificadores:** `<espacio>-mun-<nombre>[-<INE>]` y `<espacio>-camp-<municipio>-<año>-<nombre>`. Siempre llevan el prefijo del espacio.
- **Incorporación en una campaña existente:**
  - **Se acepta** si es histórica, del mismo municipio y año, y está vacía (`motivoNoDestino`).
  - **La campaña se completa** (periodo y estados) sin perder su identificación ni quién la creó.
  - **La traza** guarda la campaña tal como estaba (`campanaPrevia`).
  - **Deshacer** la deja exactamente igual que antes, vacía y lista de nuevo.
- **El mismo archivo en otra campaña del mismo año:** se permite, con otro identificador de importación, y se avisa en «Pendientes y advertencias».
- **Sin cambio de versión de datos:** los campos nuevos son opcionales y las bases y respaldos anteriores se abren igual.

## Separación entre municipios, campañas y espacios

- **Cada entidad pertenece a un municipio.** `verificarSeparacionMunicipios` comprueba que ninguna mezcla municipios:
  - un local, con una calle o una campaña;
  - una observación, con su campaña, su calle o su local;
  - una ocupación, con su local o su campaña;
  - una importación, con su campaña;
  - un vínculo, entre registro y local;
  - un itinerario o el ámbito de una campaña, con sus calles;
  - una campaña, con su campaña de referencia.
- **Se comprueba antes de cada escritura del espacio,** junto con las verificaciones de siempre: prefijos, nada de la demostración y nada simulado. Si falla, no se guarda nada.
- **La incorporación solo busca calles y locales del municipio de destino.** Prueba: el mismo Excel, con nombres de calles reales de Medina, crea locales en Medina y **ninguno** en un municipio sin callejero. Nunca se asocia con las calles de Medina.
- **Espacios:** la demostración, el ensayo y los datos reales siguen totalmente separados, cada uno con su propia base, su prefijo y sus reglas.
- **El espacio real:**
  - sigue sin poder guardarse en la vista previa web;
  - la confirmación sigue bloqueada (`CONFIRMACION_REAL_HABILITADA = false`).

## Callejeros (preparación de G3)

- **Sin callejero de partida:** un municipio dado de alta empieza **sin callejero**, con `callejero.estado = 'sin-callejero'`. **Nunca se crea un callejero ficticio.**
- **Se avisa claramente** en la tarjeta del municipio, en sus campañas, en el destino del asistente y en el diagnóstico.
- **Qué pasa al incorporar:**
  - los registros se conservan todos;
  - la conciliación territorial queda pendiente (motivo «Calle sin correspondencia»);
  - no se crea ningún local.
- **Medina del Campo:** conserva su callejero real (instantánea OSM). En los espacios nuevos queda registrado como `{ estado: 'disponible', fuente: 'osm-instantanea', detalle }`.
- **G3** usará `Municipio.callejero` (`fuente`, `version`, `actualizado`) y `callejeroDe()` para gestionar las fuentes y las cargas. Esa parte **no** está implementada.

## Medina del Campo y la campaña operativa 2026

- **Medina sigue siendo el municipio piloto de cada espacio.** No se modifica:
  - ni su identificador, ni sus calles, ni sus datos;
  - las bases existentes no se migran ni se reescriben.

  Lo comprueban las pruebas: el municipio queda idéntico tras dar de alta otros y crear campañas.
- **La campaña operativa 2026** está en la demostración (`camp-medina-2026`). G2 no la toca, ni a nada de la demostración.
- **Las incorporaciones históricas** siguen bloqueándose en un año con una campaña operativa y en el año en curso.
- **El análisis del Excel real sin guardar (C1e-B):**
  - usa una campaña histórica 2025 de Medina creada **solo en memoria**;
  - no se guarda nada.

## Persistencia: qué se guarda dónde

> **Nada de lo que hace G2 se comparte con otras personas de la Cátedra.** Todo se guarda en el navegador de quien lo hace.

| Información | Almacenamiento | ¿Compartida? |
|---|---|---|
| Municipios, configuración territorial, campañas e incorporaciones del **ensayo** | IndexedDB `ulit-censo-ensayo` de este navegador | **No.** Solo este navegador, perfil y dirección web |
| Lo mismo en el espacio de **datos reales** (solo en el equipo propio) | IndexedDB `ulit-censo-real` | **No** |
| Perfiles de importación (G1) | IndexedDB `ulit-censo-perfiles` (solo la estructura de columnas, ningún dato) | **No.** Se pueden usar en **cualquier municipio** del mismo navegador |
| Demostración | IndexedDB `keyval-store` | **No** |
| Respaldo del espacio (incluye municipios y campañas) | Archivo JSON que la persona descarga | Solo si la persona lo entrega a otra |

- **En pantalla:** la tarjeta «Municipios» dice dónde se guarda: «Se guardan en la base … de **este navegador**. No se comparten con otras personas de la Cátedra ni se envían a ningún servidor».
- **Pasar la configuración a otra persona:** hoy la única forma es el **respaldo** del espacio, que debe restaurarse en su navegador. Eso sustituye su espacio completo. No hay ninguna sincronización.
- **Una configuración compartida por la Cátedra** (una sola lista de municipios y campañas para todo el equipo) exige un almacenamiento institucional en un servidor, con autenticación y permisos. **No se ha implementado ni habilitado**: necesita una autorización específica, y elegir dónde se aloja y quién lo administra.

## Limitaciones

- **Configuración local:** municipios y campañas son de un navegador. Otro equipo u otra URL de la vista previa no los ve.
- **Sin edición ni borrado:** en G2 no se puede editar ni dar de baja un municipio o una campaña. Así nada cambia una vez usado como destino. Se resolverá con trazabilidad en una fase posterior.
- **Sin coordenadas:** los municipios nuevos no tienen centro. No se inventa; los mapas de los espacios no los usan.
- **Sin trabajo de campo en los espacios:** las campañas operativas se pueden crear, pero en los espacios no hay todavía planificación ni campo para ellas. Eso sigue en la demostración.
- **Sin callejero, sin conciliación:** sin callejero no hay conciliación territorial. Llegará con G3.

## Pruebas

- **`src/domain/g2-municipios.test.ts`** (13 pruebas, municipios y censos sintéticos). Comprueba:
  - el alta sin callejero, la validación y los duplicados;
  - la configuración territorial como dato y su uso al interpretar, con la referencia para las bases antiguas;
  - que Medina no cambia;
  - las campañas de varios años y del mismo año, y los nombres repetidos rechazados;
  - que una histórica no se crea en un año con operativa;
  - la incorporación en la campaña elegida y que deshacer la deja como estaba;
  - el rechazo de campañas operativas, de otro año o de otro municipio;
  - el mismo archivo en dos campañas del mismo año;
  - la separación: las mismas calles no se asocian entre municipios, y se detectan las asociaciones manipuladas;
  - el respaldo con varios municipios;
  - el perfil de G1 reutilizado en otro municipio.
- **`src/workspaces/espacios/municipios.test.tsx`** (interfaz), recorrido completo:
  1. el alta, con un INE inválido rechazado y el CP fijo;
  2. dos históricas de 2023 y una operativa de 2027, con un nombre repetido rechazado;
  3. el destino antes del archivo, el Excel del caso A, las columnas y el diagnóstico sin callejero;
  4. la vista previa, el respaldo y la incorporación: 40 registros y ningún local;
  5. al volver a abrir, todo sigue ahí.
- **Pruebas de antes:** las de los espacios y del paso «Columnas» se han adaptado para crear la campaña de destino. Todas las demás siguen igual.
- **Revisión visual** (Playwright, versión compilada) a 1440, 768 y 390 px:
  - ninguna pantalla desborda en horizontal ni da errores de JavaScript;
  - en móvil, la tabla de campañas se muestra como fichas.
