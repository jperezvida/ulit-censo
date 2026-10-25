# G5 · Conciliación posterior a la importación y consolidado municipal fiable

**Objetivo:** después de incorporar los Excel de los itinerarios de una campaña, revisar las filas que quedaron sin local, decidir con trazabilidad y obtener un consolidado que cuente **locales físicos únicos**, sin duplicar por observaciones repetidas ni dar por resuelto lo contradictorio. Reutiliza el importador, la campaña operativa (G4), las ocupaciones y el callejero (G3); no hay editor sobre mapa.

## Dónde está (Espacios → Campañas → «Itinerarios y censo»)

Bajo el desglose por itinerario aparece **«Conciliación posterior»**:

1. **Filas sin local** de todos los itinerarios, con tres filtros: itinerario, calle y tipo (motivo del pendiente o incidencia de la fila, o «mantenida pendiente»).
2. Para cada fila:
   - **Vincular** a un local existente: el desplegable ofrece los locales del municipio **en la misma calle**, primero los del mismo portal. Si el local ya tiene ocupación en la campaña no se crea otra.
   - **Es un local distinto** → escribir por qué y **Crear local distinto**. Exige calle reconocida y número de portal. Dos negocios en un portal son dos locales: nunca se fusionan por compartir portal.
   - **Mantener pendiente:** queda constancia de la revisión.
3. **Decisiones tomadas:** quién, cuándo y por qué, con **Deshacer**.
4. **Estado de locales por revisar:** locales con observaciones contradictorias o sin fecha. **Confirmar vacío/ocupado** (apoyándose en una observación concreta de ese local), **Marcar dudoso** o **Retirar la decisión**.

## Reglas (`src/domain/conciliacionPosterior.ts`)

- **Trazabilidad:** cada decisión (`ConciliacionPosterior`) se guarda en el vínculo de la fila con acción, local, autor, fecha, motivo, campaña, itinerario, el estado **anterior** (vínculo y observación) y lo que **creó** (locales, ocupaciones). Solo concilian personas con rol de coordinación, administración o revisión.
- **Aislamiento:** la fila debe pertenecer a una incorporación confirmada de **esa** campaña; el local, al mismo municipio y a la misma calle.
- **Deshacer seguro:** se deshace la última decisión vigente de la fila y se restaura exactamente lo anterior. Se bloquea si algo depende de lo creado (otra fila u observación vinculada al local creado, otra ocupación). La decisión deshecha queda en el historial. Mientras haya decisiones vigentes, la **importación** de ese itinerario no se puede deshacer; al deshacerlas todas vuelve a poder deshacerse.
- **Estado de un local en la campaña** (`estadoLocal`), sin modificar ni borrar observaciones:
  - **Estado actual confirmado:** las observaciones coinciden y al menos una tiene fecha, o lo decidió una persona.
  - **Estado dudoso:** se contradicen y todas tienen fecha con una más reciente única → se muestra una **propuesta no aplicada**; o una persona lo marcó dudoso.
  - **Información sin fecha suficiente:** ninguna fecha, o contradicción cuyas fechas faltan o coinciden. No se deduce estado ni se inventan fechas.
  - La decisión (`ResolucionEstado`) se guarda en `campana.resolucionesEstado`; retirarla la conserva marcada como retirada.

## Cierre de riesgos de integridad

- **Dependencias al deshacer:**
  - `deshacerConciliacion` se bloquea, con explicación, si el local de la decisión tiene una decisión de estado vigente en cualquier campaña, o si el local creado lo usa otra fila, observación, ocupación, revisión de oficina o candidato.
  - `deshacerIncorporacion` se bloquea si hay una decisión de estado vigente sobre un local importado o sobre un local con observaciones de esa incorporación.
  - Las decisiones nunca se eliminan: hay que retirarlas antes, y la retirada se conserva.
- **Permisos:** deshacer una conciliación y retirar una decisión de estado exigen los mismos roles que tomarlas (coordinación, administración o revisión).
- **Auditoría:** al deshacer una incorporación, `c1.deshecha.conciliaciones` guarda una traza mínima de las conciliaciones de sus filas: fila, acción, autor, fecha y quién y cuándo la deshizo. No guarda motivos ni datos de la fila.

## Consolidado corregido (`censoConsolidado`)

- Distingue **filas** (registros de los Excel), **observaciones** y **locales físicos únicos**.
- **Ocupados / vacíos** cuentan locales únicos con estado confirmado; **dudosos** y **sin fecha** aparte. La suma de los cuatro es el número de locales únicos: una observación repetida del mismo local no suma dos veces.
- Un **posible duplicado** solo figura como conciliado si todas sus observaciones son del mismo local **y** ese local no tiene una contradicción sin resolver.
- Las **contradicciones** llevan `resuelta`: solo si todas las observaciones del portal tienen local y ninguno de esos locales sigue contradictorio sin decisión.

## Cobertura (corrige la ambigüedad de G4)

Encontrar locales en una calle **no** demuestra haberla recorrido entera ni por ambas aceras.
- Se retira «Guardar N calle(s) como tramos» y `guardarTramosObservados`.
- `callesConObservaciones` informa de portales observados, aceras con locales y segmentos de referencia, siempre como **«recorrido no confirmado»**. No crea tramos ni coberturas.
- Los tramos que ya se hubieran guardado con G4 se **conservan sin cambios** y se muestran como «deducidos de lo observado: no confirmados, no indican calle completa ni cobertura» (`tramosDeducidosSinConfirmar`).

## Pruebas

- **`src/domain/g5-conciliacion.test.ts`** (9 pruebas, datos SINTÉTICOS: IT1, IT2 e IT3 con la variante `libroIT3G5`):
  - panel con filtros y candidatos;
  - observaciones repetidas sin duplicar ocupados;
  - dos negocios en un portal con justificación obligatoria;
  - contradicción con fecha (propuesta, resolución y retirada);
  - contradicción sin fecha;
  - mantener pendiente;
  - deshacer seguro, con bloqueos, aislamiento y vuelta a poder deshacer la importación;
  - consolidado por locales únicos;
  - cobertura no confirmada y tramos G4 preservados.
- **`src/workspaces/espacios/itinerarios.test.tsx`:** desde la interfaz, vincular, filtrar, deshacer, y resolver un estado dudoso.
- **`src/domain/g4-itinerarios.test.ts`:** adaptado (contradicciones con `resuelta`; calles con observaciones en lugar de tramos).

## Pendiente

- Cambiar el local de una fila **ya vinculada en la importación** se hace deshaciendo la importación (no desde este panel).
- Una fila sin calle reconocida solo puede mantenerse pendiente: corregir su calle requiere la conciliación de calles del asistente y volver a importar.
- Editor de itinerarios sobre mapa y cobertura real por aceras: fases posteriores.
