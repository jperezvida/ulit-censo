# Callejero real de Medina del Campo en la demostración

> **Estado (23-10-2026):** el mecanismo está implementado y probado. Falta la **instantánea real**,
> `public/data/medina-callejero.json`: la política de red del entorno de trabajo de Claude bloquea
> Overpass, la API de OSM y Geofabrik (respuesta 403 del proxy). Se genera con `npm run callejero` desde
> una red con acceso, como Codespaces, y se sube a la rama. Al subirla, las pruebas condicionales de
> `src/data/callejeroOsm.test.ts` la validan automáticamente.

## Qué es real y qué es ficticio

| Real (OpenStreetMap, ODbL) | Ficticio (generado por la aplicación) |
|---|---|
| Nombre de cada calle | Establecimientos, negocios y sus cifras |
| Tipo de vía | Números de portal |
| Geometría (trazado) | Ubicaciones de los locales (simuladas sobre el trazado) |
| | Itinerarios, campañas, revisiones y datos digitales |

La interfaz lo dice en tres sitios:
- **Visualización › Por establecimientos:** banda «Calles reales de OpenStreetMap; los negocios, sus números de portal y sus ubicaciones son ficticios. No son direcciones comprobadas».
- **Ficha de cada local:** «nº ficticio» junto a la dirección.
- **Territorio:** sello «Locales, números de portal e itinerarios ficticios».

La atribución «Callejero © colaboradores de OpenStreetMap (ODbL)» aparece:
- en la nota del mapa;
- en el sello «Callejero real · © OSM (ODbL)»;
- en `public/data/ATRIBUCION-OSM.md`;
- en el bloque `__fuente` de la instantánea.

## Reproducibilidad

- `src/data/instantaneaOsm.ts` normaliza la respuesta de Overpass: solo vías con nombre y tipo admitido, una vez cada una, solo `name` y `highway`, coordenadas a 6 decimales y orden por id.
- Valida la instantánea: exige ODbL y atribución, al menos 80 vías y menos de un 2 % fuera de la zona de Medina.
- La aplicación carga la instantánea **sin red externa**. Overpass desde el navegador solo se usa si falta la instantánea; ese resultado se marca como «no reproducible».
- `npm run callejero` (`scripts/descargar-callejero.ts`):
  - prueba tres réplicas de Overpass;
  - con `--desde`, admite un JSON exportado a mano desde overpass-turbo;
  - con `--comprobar`, valida el archivo guardado;
  - informa de vías, calles, km, fecha de los datos OSM, SHA-256 y si están las calles del documento IT 2 (Los Mostenes, López Flores, San Francisco).
- Con el mismo callejero, la campaña 2025 de la demostración y sus ubicaciones se generan igual (semilla fija).

## Reparto de los locales ficticios sobre trazados reales

- La semilla (`generarDemo`) reparte los locales sobre la geometría de cada calle, como ya hacía.
- Las **ubicaciones simuladas** del cuadro de mando (`domain/posiciones.ts`) ahora **encadenan los tramos** de cada calle (`recorridoCalle`). En OSM una calle son varias vías en orden arbitrario y con sentidos distintos; al encadenarlas, la numeración avanza en un solo sentido y pares e impares quedan cada uno en su acera.
- **Mismo portal:** se conservan tantos locales independientes como se censaron, cada uno con su punto. Se comprueba portal a portal.

## Transición segura de las demostraciones guardadas (IndexedDB)

- La aplicación **nunca** sustituye una demostración guardada por su cuenta.
- Si la guardada usa el callejero simulado y el proyecto incluye una instantánea válida, aparece un aviso y, en el Guion, «Usar calles reales (OSM)».
- Antes de cualquier sustitución se escribe una **copia de seguridad** (`ulit-censo:demo-db:respaldo`) y se vuelve a leer para comprobarla. Si falla, no cambia nada. Esto vale para el paso al callejero real, «Restablecer demo» y la recuperación de la copia.
- «Recuperar la demostración anterior» **intercambia** la demostración actual y la copia: no se pierde ninguna.

## Fuera de alcance (sin cambios)

- El escenario **C1d** de incorporación sigue en su municipio ficticio aislado, con «VÍA FICTICIA nnn» y sin geometría.
- Las pruebas de importación histórica siguen usando el callejero simulado de forma explícita.
- No se incorpora ningún censo real.

## Pruebas

| Archivo | Qué comprueba |
|---|---|
| `src/data/callejeroOsm.test.ts` | Normalización estable; validación de licencia, atribución, cobertura y zona; carga desde la instantánea sin consultar Overpass; recurso al simulado si la instantánea no es válida; recorrido continuo con vías desordenadas e invertidas; locales en calles del callejero; mismo portal conservado; ubicaciones junto a su calle; indicadores; reproducibilidad. Además, dos pruebas **condicionales** sobre la instantánea real: se ejecutan cuando existe el archivo. |
| `src/store/transicion.test.ts` | No se sobrescribe al abrir; copia comprobada antes del cambio; intercambio al recuperar; sin cambios si falla la copia o la instantánea no es válida; «Restablecer demo» con copia. |
| `src/workspaces/visualizacion/visualizacion.test.tsx` | Atribución ODbL en el mapa, banda de calles reales con datos ficticios y «nº ficticio» en la ficha. |

Las pruebas usan una instantánea **sintética** con forma de OSM (`src/data/fixtureOsmSintetico.ts`, con calles «Vía sintética de prueba NN»). No son datos reales.
