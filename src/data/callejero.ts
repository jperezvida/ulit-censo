import type { Calle, LngLat, Segmento } from '../domain/types';
import { longitudLinea } from '../domain/geo';
import { claveCalle, tipoVia } from '../domain/text';
import { crearRng } from './rng';
import { detalleInstantanea, validarInstantanea } from './instantaneaOsm';

/**
 * Callejero de Medina del Campo.
 *
 * Orden de preferencia:
 *  1. Instantánea OSM incluida en el proyecto (public/data/medina-callejero.json), generada con
 *     `npm run callejero` y validada (`instantaneaOsm.ts`): reproducible, no depende de la red.
 *  2. Consulta puntual a Overpass API desde el navegador (una sola petición), solo si falta la instantánea.
 *  3. Callejero SIMULADO, claramente identificado como tal.
 *
 * Solo la cartografía es real: los establecimientos, números de portal y ubicaciones de la
 * demostración son ficticios. Datos OSM © colaboradores de OpenStreetMap, licencia ODbL.
 */

export const MEDINA = {
  id: 'mun-medina',
  centro: [-4.9142, 41.3108] as LngLat,
  // sur, oeste, norte, este (formato Overpass)
  bbox: [41.2965, -4.9385, 41.3255, -4.8955] as const,
};

export const TIPOS_VIA = 'primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|trunk|primary_link|secondary_link|tertiary_link';

export function consultaOverpass(bbox: readonly number[] = MEDINA.bbox): string {
  return `[out:json][timeout:25];way["highway"~"^(${TIPOS_VIA})$"]["name"](${bbox.join(',')});out geom;`;
}

interface OverpassWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** Agrupa las vías OSM por nombre: una calle = varios segmentos. */
export function callesDesdeOverpass(json: { elements?: OverpassWay[] }, municipioId: string): Calle[] {
  const grupos = new Map<string, { nombre: string; segmentos: Segmento[]; refs: string[] }>();
  for (const w of json.elements ?? []) {
    if (w.type !== 'way' || !w.tags?.name || !w.geometry || w.geometry.length < 2) continue;
    const nombre = w.tags.name.trim();
    const clave = claveCalle(nombre) + '|' + tipoVia(nombre);
    const coords = w.geometry.map((g) => [round(g.lon), round(g.lat)] as LngLat);
    const seg: Segmento = { id: `w${w.id}`, coords, longitudM: longitudLinea(coords) };
    const g = grupos.get(clave) ?? { nombre, segmentos: [], refs: [] };
    g.segmentos.push(seg);
    g.refs.push(`osm:way/${w.id}`);
    grupos.set(clave, g);
  }
  return [...grupos.entries()]
    .map(([clave, g]) => ({
      id: `c-${slugId(clave)}`,
      municipioId,
      nombre: g.nombre,
      tipoVia: tipoVia(g.nombre),
      segmentos: g.segmentos,
      longitudM: g.segmentos.reduce((a, s) => a + s.longitudM, 0),
      procedencia: 'osm' as const,
      refsFuente: g.refs,
    }))
    .filter((c) => c.longitudM > 15)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
function slugId(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ───────────────────────── Simulado ─────────────────────────

const RAICES_SIM = [
  'Abeto', 'Alcornoque', 'Alondra', 'Almendro', 'Arce', 'Avellano', 'Brújula', 'Cedro', 'Ciprés', 'Clepsidra', 'Compás',
  'Enebro', 'Escuadra', 'Fresno', 'Garza', 'Gnomon', 'Laurel', 'Madroño', 'Nogal', 'Olmo', 'Sextante', 'Tejo', 'Astrolabio',
  'Cuadrante', 'Nonio', 'Plomada', 'Teodolito', 'Vernier', 'Alidada', 'Meridiana',
];
const TIPOS_SIM = ['Calle del', 'Travesía del', 'Calle Nueva del', 'Plazuela del', 'Ronda del', 'Callejón del'];

/**
 * Callejero esquemático SIMULADO (no corresponde a Medina del Campo).
 * Malla irregular de calles cortas; cada calle se compone de varios segmentos
 * (uno por manzana), para ejercitar la selección de "calle completa".
 */
export function callejeroSimulado(municipioId: string, centro: LngLat): Calle[] {
  const rng = crearRng('callejero-simulado');
  const dLat = 0.00092; // ~100 m
  const dLng = 0.00125; // ~105 m
  const N = 16;
  const nodos: LngLat[][] = [];
  for (let i = 0; i < N; i++) {
    nodos.push([]);
    for (let j = 0; j < N; j++) {
      const lat = centro[1] + (i - N / 2) * dLat + (rng.next() - 0.5) * dLat * 0.3 + j * 0.00003;
      const lng = centro[0] + (j - N / 2) * dLng + (rng.next() - 0.5) * dLng * 0.3 - i * 0.00005;
      nodos[i].push([round(lng), round(lat)]);
    }
  }
  const calles: Calle[] = [];
  let n = 0;
  const crear = (puntos: LngLat[]) => {
    const nombre = `${TIPOS_SIM[Math.floor(n / RAICES_SIM.length) % TIPOS_SIM.length]} ${RAICES_SIM[n % RAICES_SIM.length]}`;
    const segmentos: Segmento[] = [];
    for (let k = 1; k < puntos.length; k++) {
      const coords = [puntos[k - 1], puntos[k]];
      segmentos.push({ id: `sim-${n}-${k}`, coords, longitudM: longitudLinea(coords) });
    }
    calles.push({
      id: `c-sim-${n}`, municipioId, nombre, tipoVia: tipoVia(nombre), segmentos,
      longitudM: segmentos.reduce((a, s) => a + s.longitudM, 0), procedencia: 'simulado', refsFuente: [],
    });
    n++;
  };
  const tramos = (linea: LngLat[]) => {
    let k = 0;
    while (k < linea.length - 1) {
      const largo = rng.int(3, 6);
      const fin = Math.min(linea.length - 1, k + largo);
      if (fin - k >= 2 || fin === linea.length - 1) crear(linea.slice(k, fin + 1));
      k = fin;
    }
  };
  for (let i = 1; i < N - 1; i += 1) tramos(nodos[i].slice(1, N - 1));
  for (let j = 1; j < N - 1; j += 2) tramos(nodos.map((r) => r[j]).slice(1, N - 1));
  return calles;
}

// ───────────────────────── Carga ─────────────────────────

export type FuenteCallejero = 'instantanea-osm' | 'overpass-navegador' | 'simulado';

/**
 * Lee y valida la instantánea OSM del proyecto, sin red externa. `motivo` solo se rellena si el archivo
 * existe pero no es válido (si no existe, no hay nada que avisar).
 */
export async function cargarInstantaneaMedina(): Promise<{ ok: true; calles: Calle[]; detalle: string } | { ok: false; motivo?: string }> {
  try {
    const r = await fetch('./data/medina-callejero.json', { cache: 'no-cache' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { ok: false };
    const v = validarInstantanea(await r.json(), MEDINA.id);
    return v.ok ? { ok: true, calles: v.calles, detalle: detalleInstantanea(v.fuente, v.calles.length) } : { ok: false, motivo: v.motivo };
  } catch {
    return { ok: false };
  }
}

export async function cargarCallejeroMedina(
  aviso: (paso: string) => void,
  opciones: { permitirRed?: boolean; timeoutMs?: number } = {},
): Promise<{ calles: Calle[]; fuente: FuenteCallejero; detalle: string }> {
  const { permitirRed = true, timeoutMs = 20000 } = opciones;
  try {
    aviso('Buscando instantánea del callejero OSM incluida en el proyecto…');
    const inst = await cargarInstantaneaMedina();
    if (inst.ok) return { calles: inst.calles, fuente: 'instantanea-osm', detalle: inst.detalle };
    if (inst.motivo) aviso(`Instantánea del callejero no válida: ${inst.motivo}`);
  } catch {
    /* sin instantánea */
  }
  if (permitirRed) {
    try {
      aviso('Descargando el callejero real de Medina del Campo (OpenStreetMap · Overpass API)…');
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(consultaOverpass()),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (r.ok) {
        const calles = callesDesdeOverpass(await r.json(), MEDINA.id);
        if (calles.length > 20) return { calles, fuente: 'overpass-navegador', detalle: `${calles.length} calles reales · OSM vía Overpass (${new Date().toLocaleDateString('es-ES')}, no reproducible) · © colaboradores de OpenStreetMap, ODbL 1.0` };
      }
    } catch {
      /* sin red o bloqueado */
    }
  }
  aviso('No se pudo obtener el callejero real: se usa un callejero SIMULADO.');
  const calles = callejeroSimulado(MEDINA.id, MEDINA.centro);
  return { calles, fuente: 'simulado', detalle: `${calles.length} calles SIMULADAS (geometría inventada)` };
}

/** Calles señaladas en el documento real «IT 2 MEDINA.pdf» para censar desde cero. */
export const CALLES_DESDE_CERO_IT2 = ['Los Mostenes', 'López Flores', 'San Francisco'];
