# G4 · Itinerarios de una campaña operativa y censo consolidado

**Objetivo:** incorporar varios Excel de itinerarios (IT1, IT2, IT3…) en **una única campaña operativa** municipal y obtener el censo consolidado. No se crea una campaña por itinerario. Medina 2025 sigue siendo solo un caso histórico de prueba.

## Cómo se usa (Espacios)

1. **Crear la campaña.** En «Campañas», crea una campaña **operativa** (p. ej. «Censo 2026»).
2. **Añadir los itinerarios.** Pulsa «Itinerarios y censo» y añade los itinerarios (`IT1`, `IT2`…). También se pueden crear desde el destino del asistente.
3. **Incorporar cada Excel.** «Incorporar su Excel» abre el asistente con el destino **«Itinerario de una campaña operativa»** y el itinerario ya elegido. Después siguen los pasos de siempre: columnas (G1; el formato de 28 columnas se reconoce solo), diagnóstico, decisiones, vista previa y confirmación.
4. **Revisar el consolidado.** El panel muestra:
   - el **censo consolidado**: itinerarios, archivos, registros, locales ocupados y vacíos, pendientes y calles;
   - el **desglose por itinerario**: archivo y SHA-256, registros, filas con local, pendientes, fechas reales y filas sin fecha;
   - los **cruces entre itinerarios**.

## Qué se reutiliza y qué cambia

**Lo mismo que antes:** el importador de siempre (C1a–C1d), las columnas (G1), el destino (G2) y el callejero con sus identificadores (G3). `DestinoIncorporacion` añade `itinerarioId`.

**Con una campaña operativa como destino** (`plan.modo = 'operativo'`):
- **La campaña** no se crea ni se modifica.
- **La importación** es de tipo `C-excel-itinerario`, y su traza guarda el itinerario.
- **Los registros** guardan `itinerarioId`.
- **Las observaciones** guardan `itinerarioId`, `registroId` y la **fecha real** del Excel; si no hay fecha, no se inventa.
- **Archivos repetidos:**
  - el mismo archivo (SHA-256) en cualquier itinerario de la campaña se bloquea;
  - otro archivo para un itinerario que ya tiene uno también se bloquea: hay que deshacer antes el anterior.
- **Filas del propio Excel:** si su columna «itinerario» indica otro itinerario, se avisa.
- **Cruces con otros itinerarios** (`plan.cruces`):
  - posible duplicado: misma calle, número y nombre;
  - contradicción: mismo portal, vacío en uno y ocupado en otro.

  Se señalan en la vista previa.
- **Nada se fusiona solo:**
  - una fila en un portal que ya tiene un local de otro itinerario, o del histórico, queda **ambigua** («ya existe un local en esa dirección») para la **conciliación supervisada**;
  - en Decisiones se puede vincular al local existente; entonces no se crea una segunda ocupación en la campaña;
  - varios establecimientos en un mismo portal son locales distintos (C1c-1).
- **Deshacer un itinerario:**
  - no se bloquea porque haya otros itinerarios en la campaña;
  - sí se bloquea si otro itinerario tiene observaciones apoyadas en sus locales: las observaciones de otros itinerarios se preservan.
- **El histórico** (otras campañas) no se modifica.

## Censo consolidado (`src/domain/campanaOperativa.ts`)

- **`censoConsolidado(db, campañaId)`:** totales y desglose por itinerario, solapamientos (calles observadas por varios itinerarios), posibles duplicados (y si ya están conciliados), contradicciones y portales con varios locales.
- ~~`tramosObservados` / `guardarTramosObservados`~~ **(retirado en G5).** Guardar las calles observadas como tramos completos («ambas» aceras, todos los segmentos) confundía locales encontrados con calle recorrida. G5 lo sustituye por `callesConObservaciones` (informativo, «recorrido no confirmado») y muestra como **no confirmados** los tramos que ya se hubieran guardado así, sin modificarlos. Ver `G5-CONCILIACION-POSTERIOR.md`.

## Pruebas

- **`src/domain/g4-itinerarios.test.ts`** (10 pruebas). Usa tres Excel sintéticos (`src/data/xlsxItinerarios.ts`) de un municipio ficticio con el callejero sintético de G3. Comprueba:
  - incorporación en la misma campaña sin modificarla, con trazabilidad;
  - códigos de itinerario;
  - cruces (posible duplicado y contradicción) pendientes;
  - archivos repetidos;
  - consolidado con desglose, solapamientos, duplicados, contradicciones y mismo portal;
  - calle desconocida, «S/N» y fila de otro itinerario;
  - conciliación supervisada del duplicado;
  - deshacer sin tocar otros itinerarios;
  - histórico intacto;
  - tramos con los segmentos de G3.
- **`src/workspaces/espacios/itinerarios.test.tsx`:** IT1 e IT2 incorporados desde la interfaz, con el desglose y los cruces.

## Pendiente

- **Conciliación de duplicados:** resuelto en G5 (conciliación posterior a nivel de campaña).
- **Itinerarios:** no se pueden renombrar ni borrar.
- **Interpretación:** se hace en modo «histórico». Los campos territoriales obligatorios no se exigen; se conservan vacíos.
- **Editor de itinerarios sobre mapa:** fase posterior.
