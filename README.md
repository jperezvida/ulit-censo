# ULIT Censo · prototipo navegable (fase 1)

Prototipo de la aplicación de censos de establecimientos comerciales y de servicios de la
Cátedra de Innovación para el Comercio (Universidad de Valladolid), dentro del ecosistema ULIT.

> **Todo es de demostración.** Los locales, los negocios, las personas, los itinerarios, los
> resultados de campo y las métricas digitales son **ficticios** y se generan de forma reproducible.
> Solo la geometría y los nombres de las calles pueden ser reales (OpenStreetMap), y la interfaz lo
> indica en cada caso. No hay conexión con Supabase ni con ningún servicio productivo.

## Cómo verlo

Requisitos: Node 20.19 o superior.

```bash
npm install
npm run dev          # http://localhost:5173
```

También puedes compilarlo y servir la versión estática:

```bash
npm run build && npm run preview   # http://localhost:4173
```

- **Escritorio:** abre la dirección en el navegador. El botón **Guion** (barra superior) lista los
  12 escenarios de la especificación con enlaces directos.
- **Móvil:** abre `/#/campo` en un teléfono de la misma red (`npm run dev -- --host`). En
  escritorio la app de campo se muestra dentro de un marco de teléfono.
- **Restablecer:** en el Guion, «Restablecer demo» borra los cambios y regenera los datos.

Los datos se guardan en el navegador (IndexedDB). Cada navegador tiene su propia copia.

### Callejero de Medina del Campo

Al arrancar, la aplicación intenta, por este orden:

1. Leer la instantánea `public/data/medina-callejero.json`, si existe. Se genera con
   `npm run callejero` desde una red con acceso a `overpass-api.de`.
2. Pedir el callejero a Overpass API **desde tu navegador**: una única petición, que luego queda en caché.
3. Si nada de lo anterior funciona, usa un **callejero simulado** con geometría inventada. La
   interfaz lo señala con el sello «Callejero simulado · geometría inventada».

Datos © colaboradores de OpenStreetMap, licencia ODbL. Mapa base de OpenFreeMap / OpenMapTiles.
El mapa base solo sirve de fondo; para trabajar sin conexión, la versión definitiva necesitará un
proveedor o unas teselas propias con licencia adecuada (nunca descargas masivas de servidores públicos).

## Pruebas y comprobaciones

```bash
npm test             # Vitest: reglas de dominio + prueba de interfaz
npm run typecheck    # TypeScript estricto
npm run build        # compilación de producción
```

## Qué incluye

| Espacio | Funciones |
|---|---|
| **Campañas** | Municipios y campañas, con 4 estados independientes (planificación, campo, revisión y validación), ámbito, ampliación y equipo. Permite crear campañas. |
| **Territorio** | Planificador sobre el mapa:<br>· Selección de **calles completas**, aunque tengan varios segmentos.<br>· División avanzada por segmentos o aceras.<br>· Numeración y orden por arrastre u orden por proximidad.<br>· Calles sin locales anteriores y su situación previa.<br>· Solapes y calles sin asignar.<br>· Carga estimada.<br>· Importación KML/KMZ y registro de omisiones del callejero.<br>· Capas independientes de planificación, cobertura y actividad.<br>Incluye la pestaña de equipo, con el progreso por investigador y los conflictos de sincronización simulados. |
| **Campo (móvil)** | · Preparación de salida (simulada).<br>· Calle recordada y confirmación de una pulsación.<br>· Registro de cambios: vacío, nuevo negocio, posible desaparición, dudoso o incidencia.<br>· Alta rápida con número por acera y «Guardar y siguiente».<br>· «Finalizar calle» declarando las aceras recorridas.<br>· Modo sin conexión **simulado** y modo sol. |
| **Oficina** | · Bandeja virtualizada para miles de registros, con vistas guardadas, filtros y edición múltiple.<br>· Clasificación en 4 niveles.<br>· Presencia digital por negocio y campaña.<br>· Conciliación lado a lado, aprobación y devolución.<br>· Atajos de teclado: J, K, X, C, G, A, D. |
| **Datos** | · Importaciones con su procedencia y las filas originales conservadas.<br>· Asistente A–E con revisión previa obligatoria.<br>· Preparado para el CSV real de 2025. |
| **Análisis** | · Ámbito comparable frente a ampliación.<br>· Cambios confirmados frente a indeterminados.<br>· Grupos de actividad y digitalización verificada.<br>· Mapa de actividad.<br>· Exportación CSV por municipio, itinerario o calle. |
| **Hoja de campo** | Documento A4 imprimible con:<br>· Mapa numerado.<br>· Calles con casillas por acera.<br>· Locales anteriores con columnas para anotar.<br>· Filas para locales nuevos. |

## Limitaciones conocidas del prototipo

- **Sin backend ni sincronización real.** La cola sin conexión y los conflictos son una simulación.
  La descarga «para trabajar sin cobertura» no guarda nada de verdad para usarlo sin conexión.
- **Sin autenticación.** Los roles son un selector de demostración: el rol Coordinador es el que habilita la edición de itinerarios.
- **Clasificación de actividades provisional.** Respeta los 4 niveles, pero la terminología es inventada; se sustituirá por la del censo original.
- **Columnas del Excel provisionales.** El importador reconoce las columnas por nombre y permite reasignarlas. Falta validarlo con el CSV real.
- **Itinerarios de demostración.** IT-A a IT-D son inventados. **No** corresponden a los mapas reales de My Maps, y el «campo terminado» de IT-C no se atribuye a ningún itinerario real.
- **Valladolid es una demo de volumen**, con unos 5.000 locales ficticios y sin geometría. Sirve para probar Oficina y Análisis.
- **Posiciones aproximadas.** Las coordenadas de los locales son ficticias o se aproximan sobre la calle.
- **Pendiente para fases posteriores:** fotografías, geolocalización real, informes en PDF para ayuntamientos y exportación nativa a .xlsx.

Más detalle sobre el diseño y el modelo de datos en [`docs/PROTOTIPO.md`](docs/PROTOTIPO.md).
