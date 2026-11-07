# G3 · Callejeros municipales

**Objetivo:** crear y mantener desde la interfaz el callejero de cualquier municipio, sin modificar el código.

**Dónde está:** pantalla **Espacios** → tarjeta **«Callejero de …»** del municipio elegido (entre «Municipios» y «Campañas»).

**Principios que se respetan:**
- **Medina 2025 es un caso de prueba del importador, no la base obligatoria.** Un espacio puede crearse **sin** Medina del Campo (casilla «Incluir Medina del Campo»).
- **Los itinerarios reales de 2026** serán de la campaña operativa de su municipio. G3 no crea campañas: solo deja el callejero preparado para seleccionar calles y tramos (ver «Preparación para itinerarios sobre mapa»).

## 1. Carga desde fuentes verificables

ULIT **no se conecta a ningún servicio externo**: la política de seguridad del sitio solo permite conectar con el propio sitio. La persona aporta el **archivo** que exporta la fuente, y ULIT lo comprueba antes de usarlo.

| Fuente | Cómo se obtiene | Qué se comprueba |
|---|---|---|
| **OpenStreetMap** | ULIT muestra la consulta de Overpass para **ese** municipio. Se ejecuta en overpass-turbo.eu y se exporta como «datos sin procesar». | Que el archivo trae el **límite administrativo** (nivel 8) con su geometría.<br>Que es el municipio elegido: código INE (`ine:municipio`) o, si no lo hay, el nombre.<br>Que no hay municipios homónimos.<br>Que **cada vía cae dentro** del límite. |
| **Callejero oficial** | Archivo de la administración en **CSV** (`;`, `,` o tabulador) o **GeoJSON**. Columnas: nombre, y opcionalmente tipo (CL, PZ, AV…), código y municipio. | Que las filas de **otro municipio** (por INE o nombre) se descartan.<br>Que se descartan también las filas sin nombre y las geometrías no válidas. |

- **Consulta de OSM:** usa la etiqueta INE si se conoce: `rel["boundary"="administrative"]["admin_level"="8"]["ine:municipio"="…"]`. Pide calles, vías peatonales y **plazas**: `place=square` como vía, como multipolígono o como punto.
- **Vista previa antes de cambiar nada:**
  - vías nuevas, actualizadas, sin cambios y **por revisar**;
  - plazas y espacios, y vías agrupadas por tener el mismo nombre;
  - elementos descartados, con el motivo.
- **Cada carga queda registrada** en `Municipio.callejero.cargas` con:
  - fuente, archivo y **SHA-256**;
  - **fecha de los datos**, **versión** y licencia;
  - persona, fecha y resumen.

  El límite verificado (envolvente, relación de OSM e INE) queda en `callejero.limite`. El mismo archivo no se aplica dos veces.

### Actualizar sin perder nada

- **Nada se borra.** Las vías que ya no vienen en la carga se conservan («ausentes»).
- **Las vías que coinciden conservan su identificador.** Coinciden por el mismo elemento de la fuente (vía de OSM o código oficial) o por el mismo nombre normalizado. Así siguen intactos sus vínculos: locales, observaciones, itinerarios y decisiones.
- **Los segmentos conservan su identificador** (`w123`, `r456`, `n789`). Se sustituyen solo los de la misma fuente, y uno **en uso** por un itinerario se conserva aunque la fuente lo retire.
- **Un cambio de nombre en la fuente no renombra la vía.** La vía queda «por revisar»: se puede registrar el nombre nuevo como alias.
- **Duplicados:**
  - dos tramos o filas con el mismo nombre forman **una** vía;
  - una vía que ya existe no se crea otra vez al cargar otra fuente; por ejemplo, el CSV oficial le añade su código y OSM su geometría;
  - si varias vías encajan con una de la fuente, no se elige ninguna: queda «por revisar».

## 2. Calles, plazas y otros espacios

Cada segmento tiene un **tipo**:
- `linea`: tramo;
- `area`: plaza, o calle peatonal dibujada como superficie;
- `punto`: plaza marcada con un nodo.

La vía guarda su **forma**: línea, área, punto, mixta o **sin geometría**.

**Sin geometría no significa que no exista.** Un callejero oficial sin coordenadas, o un alta manual sin trazado, da vías válidas que se usan igual en la conciliación.

## 3. Completar el callejero a mano (altas supervisadas)

«Añadir calle o plaza» pide:
- **tipo de vía**, **nombre** y, de forma implícita, el **municipio**;
- **fuente documental** (obligatoria);
- **geometría opcional**: pares «latitud, longitud» o un GeoJSON. Debe caer dentro del límite si se conoce. **Nunca se inventa**: si se deja vacía, la vía queda sin geometría;
- una nota.

**Pertenencia de la geometría al municipio:** se comprueba con el **perímetro administrativo auténtico** (todas sus partes y sus huecos), que se guarda al cargar el callejero de OSM (`callejero.limite.poligono`), no con el rectángulo envolvente.
- **Se rechaza** una geometría con algún vértice fuera del perímetro, o con algún tramo que lo cruce: una línea con los extremos dentro puede atravesar una entrante del límite.
- **Si el municipio no tiene perímetro cargado,** la geometría se admite, pero se avisa expresamente de que la **pertenencia territorial NO está verificada**. Queda registrado en el alta (`pertenencia: 'no-verificada'`) y se muestra en la ficha.
- **Las geometrías ya aceptadas no se modifican.** Cargar después el límite no las cambia; en la ficha figuran como «no comprobada con el perímetro».

**Supervisión:**
1. **Propuesta:** el alta queda como **propuesta**, con quién y cuándo. **No se usa** en la conciliación ni en la incorporación.
2. **Validación:** una persona de coordinación la **valida** desde la ficha de la vía. Queda constancia de quién, cuándo y con qué nota, y desde ese momento cuenta.
3. **Rechazo:** con motivo, y solo si nada la usa. Se conserva con su traza.
4. **Corrección:** del nombre, la fuente o la geometría. Queda en el `historial` con los **valores anteriores**, y el identificador no cambia. Las vías de una fuente (OSM u oficial) no se corrigen a mano: se usan alias o una carga nueva.
5. **Duplicados:** no se admite un alta con el nombre, o un alias, de otra vía del municipio. Si hay nombres parecidos, se avisa.

## 4. Denominaciones y equivalencias (datos, no código)

- **Alias de cada vía:** nombre histórico, denominación alternativa o alias. Cada uno lleva fuente, vigencia opcional, persona y fecha. Se pueden **retirar**, y la retirada se conserva.
  - No se admite un alias que sea el nombre de otra vía, porque haría ambigua la conciliación.
- **Referencias del municipio**, p. ej. «Plaza Mayor» → «Plaza Mayor de la Hispanidad»: denominación, vía oficial, nota, fuente y fecha. Se añaden y se retiran desde «Referencias».
- **Plaza Mayor de la Hispanidad:** **ya no está en el código**.
  - Es un dato del callejero de Medina. **No es un acuerdo institucional documentado**: es una referencia **aportada durante la revisión del censo 2025**, marcada «pendiente de respaldo documental o de validación formal» (`respaldo: 'pendiente'`).
  - Los espacios nuevos la guardan al crearse.
  - Las bases anteriores a G3 la leen de `src/data/referenciasDenominacion.ts`, que son datos de partida, hasta que se edite la lista.
  - Una copia guardada con la redacción anterior («Indicado por la Cátedra…») **se muestra corregida sin reescribir el dato guardado**. Solo se guarda la redacción corregida si la persona edita después la lista de referencias.
  - Toda referencia muestra su respaldo («pendiente de respaldo documental» o «con respaldo documental»). Cuando una referencia pendiente propone una vía, la propuesta lo dice.
- **La conciliación sigue siendo supervisada:**
  - un alias o una referencia **solo proponen**, con fuente «Alias o nombre histórico registrado en el callejero» o «Referencia de denominación registrada»;
  - **nada se vincula solo**.
- **Justificación de las decisiones:** al confirmar una propuesta, la decisión guarda sola su **justificación** con su procedencia (`DecisionCalle.justificacion`): la explicación de la propuesta, la referencia o la elección manual. No hay que escribirla, y la nota sigue siendo opcional.

## 5. Preparación para itinerarios sobre mapa (no implementado)

- **Identificación:** cada vía conserva sus **segmentos con identificador estable**, su **tipo** y su **elemento de origen** (`fuente`).
- **Conservación:** las actualizaciones no cambian esos identificadores, y no retiran los segmentos que usa un itinerario.
- **Uso futuro:** el editor podrá seleccionar calles y tramos con clics por (`calleId`, `segmentoId`), que es lo que ya guarda `TramoPlan.segmentoIds`. **No se ha implementado el editor.**

## Separación entre municipios y datos existentes

- **Cada vía pertenece a un municipio.**
  - Los identificadores llevan el prefijo del espacio y del municipio, p. ej. `ensayo-c-villa-sintetica-de-arriba-99001-calle-del-olmo`.
  - La comprobación de separación de G2 se sigue aplicando antes de cada guardado.
- **Las mismas calles en dos municipios** son dos vías distintas, y el archivo de un municipio se rechaza para otro.
- **Medina del Campo:** cargar o completar el callejero de otro municipio no modifica sus vías. Sus identificadores, `<espacio>-c-…`, se conservan.
- **Datos que no cambian:** la demostración, su campaña operativa 2026 y las bases existentes. **No se migra nada.**
- **Datos reales:**
  - no se incorporan;
  - el espacio real sigue sin poder guardarse en la vista previa;
  - la confirmación sigue bloqueada.

## Descripción del callejero de cada municipio

El texto «Callejero: …» de cada municipio describe **solo su propio callejero**:
- **Por carga:** «7 vías de OpenStreetMap (Overpass API) (datos a 2026-09-30)».
- **Solo altas manuales:** «1 vía · alta manual».
- **Medina:** su instantánea, más las altas manuales si las hay.

La descripción general del espacio (la instantánea OSM de Medina) solo se usa para Medina en las bases anteriores a G2. Antes del cierre de G3 aparecía por error en los municipios nuevos.

## Persistencia

Igual que en G2: el callejero se guarda en la base del espacio de **este navegador**. No se comparte con otras personas ni se envía a ningún servidor. Para llevarlo a otro equipo sirve el respaldo del espacio.

## Limitaciones

- **La descarga de OSM** la hace la persona, en overpass-turbo. ULIT no consulta Overpass desde el navegador, por seguridad.
- **Formatos oficiales:** CSV y GeoJSON. No XLSX, ni el formato fijo del callejero del censo electoral (INE).
- **Supervisión:** el espacio tiene una sola persona responsable, así que propone y valida la misma persona, en dos pasos registrados. Una supervisión por otra persona exige usuarios compartidos, que no existen (ver G2).
- **Mapa:** los callejeros nuevos no se muestran todavía sobre un mapa (llegará con el editor de itinerarios).

## Pruebas

- **Cierre de G3** (10 pruebas más en `g3-callejeros.test.ts` y una de interfaz en `callejero.test.tsx`). Comprueban:
  - que cada municipio muestra su propia descripción («1 vía · alta manual»), también en bases anteriores, en el destino del asistente y con Medina al lado;
  - el perímetro con un límite **cóncavo** (en U), una parte separada y un hueco: un punto dentro del rectángulo pero fuera del municipio se rechaza, igual que el hueco y una línea que cruza la entrante; los brazos y la parte separada se aceptan;
  - que sin perímetro la pertenencia queda «no verificada», y que las geometrías aceptadas no cambian;
  - la procedencia de la referencia de la Plaza Mayor, y la copia antigua mostrada corregida sin reescribir datos.
- **`src/domain/g3-callejeros.test.ts`** (16 pruebas, municipios y callejeros sintéticos con coordenadas en el Atlántico, que no son un lugar real). Comprueba:
  - **Lectura de OSM:** calles, peatonales y plazas como área, multipolígono y punto; descartes sin nombre, fuera del límite o de tipo no admitido.
  - **Rechazos:** otro municipio, sin límite, límites homónimos y límite sin geometría. Además, la consulta por INE.
  - **Callejeros oficiales:**
    - CSV: tipos abreviados, filas repetidas, otro municipio y sin geometría;
    - GeoJSON: línea, polígono, punto y sin geometría.
  - **Geometría manual:** se lee tal cual o se deja vacía, nunca se inventa.
  - **Carga inicial:** procedencia, cargas, límite y archivo repetido.
  - **Actualización:**
    - se conservan identificadores, locales vinculados y el segmento usado por un itinerario;
    - el renombrado queda por revisar;
    - las vías ausentes se conservan.
  - **Duplicados entre fuentes:** el CSV oficial más OSM dan una sola vía.
  - **Plaza Mayor de la Hispanidad sin geometría:** propuesta, no usada hasta validarla, y luego propuesta por la referencia.
  - **Altas con geometría:** dentro o fuera del límite, corrección auditada y rechazo con motivo.
  - **Referencias como datos:** bases antiguas, añadir y retirar.
  - **Nombre histórico:** se propone con su fuente pero no vincula solo; un alias ambiguo se rechaza; se puede retirar.
  - **Separación:** las mismas calles en dos municipios, y Medina intacta.
  - **Espacio sin Medina,** y que el plan de una carga no cambia la base.
- **`src/workspaces/espacios/callejero.test.tsx`** (interfaz): espacio sin Medina; alta del municipio con INE; carga OSM con vista previa y aplicación; alta de «Plaza del Pozo» sin geometría y su validación desde la ficha.
- **Pruebas anteriores:** siguen pasando. Solo cambia el texto del aviso de la Plaza Mayor: «no figura en el callejero actual del municipio».
- **Revisión visual** (Playwright, versión compilada) a 1440 y 390 px: sin desbordes ni errores de JavaScript en todo el recorrido de la demostración.
