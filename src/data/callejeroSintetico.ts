import { MARCA_FICTICIO } from './xlsxSinteticoC1e';

/**
 * G3 · Callejeros SINTÉTICOS de municipios ficticios para las pruebas (y la demostración en el espacio
 * de ensayo). Las coordenadas están en mitad del océano Atlántico (~10° N, 30° O): no corresponden a
 * ningún lugar real. Imitan la exportación de Overpass (OSM) y un callejero oficial (CSV y GeoJSON).
 */

type P = [number, number]; // [lat, lon]
const g = (ps: P[]) => ps.map(([lat, lon]) => ({ lat, lon }));

/** Límite administrativo (relación de nivel 8) partido en dos tramos, como en OSM. */
function limite(id: number, nombre: string, ine: string, [s, o, n, e]: [number, number, number, number]) {
  return {
    type: 'relation', id, tags: { boundary: 'administrative', admin_level: '8', name: nombre, 'ine:municipio': ine },
    members: [
      { type: 'way', ref: id * 10 + 1, role: 'outer', geometry: g([[s, o], [s, e], [n, e]]) },
      { type: 'way', ref: id * 10 + 2, role: 'outer', geometry: g([[s, o], [n, o], [n, e]]) },
    ],
  };
}

const way = (id: number, tags: Record<string, string>, ps: P[]) => ({ type: 'way', id, tags, geometry: g(ps) });

/** Villa Sintética de Arriba (INE ficticio 99001). `version` 2 simula una actualización de la fuente. */
export function osmVillaSintetica(version: 1 | 2 = 1) {
  const V = 10.0;
  const L = -30.0;
  const v1 = [
    limite(9001, 'Villa Sintética de Arriba', '99001', [V, L, V + 0.02, L + 0.02]),
    way(1001, { highway: 'residential', name: 'Calle del Olmo' }, [[V + 0.002, L + 0.002], [V + 0.002, L + 0.006]]),
    way(1002, { highway: 'residential', name: 'Calle del Olmo' }, [[V + 0.002, L + 0.006], [V + 0.002, L + 0.009]]),
    way(1003, { highway: 'tertiary', name: 'Calle Real' }, [[V + 0.004, L + 0.002], [V + 0.012, L + 0.002]]),
    // Plaza dibujada como superficie (vía cerrada con place=square)
    way(1004, { place: 'square', name: 'Plaza de la Fuente' }, [[V + 0.005, L + 0.005], [V + 0.005, L + 0.006], [V + 0.006, L + 0.006], [V + 0.006, L + 0.005], [V + 0.005, L + 0.005]]),
    // Plaza como multipolígono (relación)
    {
      type: 'relation', id: 2001, tags: { type: 'multipolygon', place: 'square', name: 'Plaza del Mercado' },
      members: [{ type: 'way', ref: 20011, role: 'outer', geometry: g([[V + 0.008, L + 0.008], [V + 0.008, L + 0.009], [V + 0.009, L + 0.009], [V + 0.009, L + 0.008], [V + 0.008, L + 0.008]]) }],
    },
    // Plaza marcada solo con un punto
    { type: 'node', id: 3001, lat: V + 0.01, lon: L + 0.01, tags: { place: 'square', name: 'Plaza Chica' } },
    way(1005, { highway: 'pedestrian', name: 'Calle Peatonal Mayor' }, [[V + 0.007, L + 0.003], [V + 0.007, L + 0.007]]),
    // Calle peatonal dibujada como área
    way(1006, { highway: 'pedestrian', area: 'yes', name: 'Paseo del Río' }, [[V + 0.013, L + 0.003], [V + 0.013, L + 0.008], [V + 0.0135, L + 0.008], [V + 0.0135, L + 0.003], [V + 0.013, L + 0.003]]),
    // Descartes: sin nombre, fuera del límite y tipo no admitido
    way(1007, { highway: 'residential' }, [[V + 0.015, L + 0.002], [V + 0.015, L + 0.004]]),
    way(1008, { highway: 'residential', name: 'Calle Lejana' }, [[V + 0.05, L + 0.05], [V + 0.05, L + 0.06]]),
    way(1009, { highway: 'footway', name: 'Senda del Prado' }, [[V + 0.016, L + 0.002], [V + 0.016, L + 0.004]]),
  ];
  if (version === 1) return { version: 0.6, generator: 'Overpass API (SINTÉTICO)', osm3s: { timestamp_osm_base: '2026-09-30T00:00:00Z' }, __sintetico: MARCA_FICTICIO, elements: v1 };
  const sin = (ids: number[]) => v1.filter((e) => !ids.includes(e.id));
  const v2 = [
    ...sin([1001, 1002, 3001, 1005]),
    // Calle del Olmo: el tramo 1001 cambia de trazado, el 1002 desaparece y aparece el 1010
    way(1001, { highway: 'residential', name: 'Calle del Olmo' }, [[V + 0.002, L + 0.002], [V + 0.0021, L + 0.0065]]),
    way(1010, { highway: 'residential', name: 'Calle del Olmo' }, [[V + 0.0021, L + 0.0065], [V + 0.002, L + 0.011]]),
    // Calle nueva
    way(1011, { highway: 'residential', name: 'Calle Nueva' }, [[V + 0.017, L + 0.002], [V + 0.017, L + 0.008]]),
    // La fuente cambia el nombre de la vía 1005: no se renombra solo
    way(1005, { highway: 'pedestrian', name: 'Calle Peatonal del Rey' }, [[V + 0.007, L + 0.003], [V + 0.007, L + 0.007]]),
    // «Plaza Chica» (nodo 3001) ya no viene: se conserva
  ];
  return { version: 0.6, generator: 'Overpass API (SINTÉTICO)', osm3s: { timestamp_osm_base: '2026-10-20T00:00:00Z' }, __sintetico: MARCA_FICTICIO, elements: v2 };
}

/** Otro municipio ficticio (INE 99002): su exportación no debe aceptarse para Villa Sintética. */
export function osmPuebloSintetico() {
  const V = 10.1;
  const L = -30.1;
  return {
    osm3s: { timestamp_osm_base: '2026-09-30T00:00:00Z' }, __sintetico: MARCA_FICTICIO,
    elements: [
      limite(9002, 'Pueblo Sintético del Río', '99002', [V, L, V + 0.02, L + 0.02]),
      way(4001, { highway: 'residential', name: 'Calle del Olmo' }, [[V + 0.002, L + 0.002], [V + 0.002, L + 0.006]]),
      way(4002, { highway: 'residential', name: 'Calle Mayor' }, [[V + 0.004, L + 0.002], [V + 0.004, L + 0.006]]),
    ],
  };
}

/** Callejero OFICIAL (CSV, sin geometría) del Pueblo Sintético del Río, con una fila repetida, una de otro municipio y una sin nombre. */
export const CSV_PUEBLO_SINTETICO = [
  'CODIGO;TIPO;NOMBRE;MUNICIPIO',
  '001;CL;Mayor;99002',
  '002;PZ;de España;99002',
  '003;CL;Mayor;99002',
  '004;AV;del Río;99001',
  '005;CL;;99002',
  '006;PS;del Molino;99002',
].join('\n');

/** Callejero OFICIAL (GeoJSON) de la Aldea Sintética: línea, plaza (polígono), punto y una vía sin geometría. */
export function geojsonAldeaSintetica() {
  const V = 10.2;
  const L = -30.2;
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { codigo: 'A1', tipo: 'Calle', nombre: 'de la Iglesia' }, geometry: { type: 'LineString', coordinates: [[L + 0.001, V + 0.001], [L + 0.004, V + 0.001]] } },
      { type: 'Feature', properties: { codigo: 'A2', tipo: 'PZ', nombre: 'Mayor' }, geometry: { type: 'Polygon', coordinates: [[[L + 0.002, V + 0.002], [L + 0.003, V + 0.002], [L + 0.003, V + 0.003], [L + 0.002, V + 0.002]]] } },
      { type: 'Feature', properties: { codigo: 'A3', tipo: 'PZ', nombre: 'del Pozo' }, geometry: { type: 'Point', coordinates: [L + 0.005, V + 0.005] } },
      { type: 'Feature', properties: { codigo: 'A4', tipo: 'Travesía', nombre: 'de las Eras' }, geometry: null },
    ],
  };
}

/**
 * Municipio ficticio con un límite CÓNCAVO (en forma de U), una segunda parte separada (exclave) y un
 * hueco interior (enclave de otro municipio). Sirve para comprobar que la pertenencia se verifica con el
 * PERÍMETRO y no con el rectángulo envolvente.
 *
 *   lat ↑  ┌──┐  ┌──┐        ┌─┐  ← exclave (0,05–0,06)
 *          │  │  │  │        └─┘
 *          │  └──┘  │  ← la «muesca» (lat 0,01–0,03; lon 0,01–0,02) está FUERA del municipio
 *          │   ▫    │  ← hueco interior (enclave)
 *          └────────┘ → lon
 */
export const U = { V: 10.3, L: -30.3 };
export function osmMunicipioConcavo() {
  const { V, L } = U;
  const anillo = (ps: P[]) => g(ps.map(([a, b]) => [V + a, L + b] as P));
  return {
    osm3s: { timestamp_osm_base: '2026-09-30T00:00:00Z' }, __sintetico: MARCA_FICTICIO,
    elements: [
      {
        type: 'relation', id: 9003, tags: { boundary: 'administrative', admin_level: '8', name: 'Valle Sintético en U', 'ine:municipio': '99003' },
        members: [
          { type: 'way', ref: 90031, role: 'outer', geometry: anillo([[0, 0], [0, 0.03], [0.03, 0.03], [0.03, 0.02], [0.01, 0.02], [0.01, 0.01], [0.03, 0.01], [0.03, 0], [0, 0]]) },
          { type: 'way', ref: 90032, role: 'outer', geometry: anillo([[0.05, 0.05], [0.05, 0.06], [0.06, 0.06], [0.06, 0.05], [0.05, 0.05]]) },
          { type: 'way', ref: 90033, role: 'inner', geometry: anillo([[0.002, 0.012], [0.002, 0.016], [0.006, 0.016], [0.006, 0.012], [0.002, 0.012]]) },
        ],
      },
      way(5001, { highway: 'residential', name: 'Calle del Brazo Oeste' }, [[V + 0.005, L + 0.002], [V + 0.02, L + 0.002]]),
    ],
  };
}
/** Punto «latitud, longitud» relativo al municipio en U, en el formato del alta manual. */
export const puntoU = (dlat: number, dlon: number) => `${(U.V + dlat).toFixed(6)}, ${(U.L + dlon).toFixed(6)}`;
