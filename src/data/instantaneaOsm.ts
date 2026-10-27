import type { Calle } from '../domain/types';
import { callesDesdeOverpass, MEDINA, TIPOS_VIA } from './callejero';

/**
 * Instantánea del callejero REAL de Medina del Campo (OpenStreetMap), incluida en el proyecto en
 * `public/data/medina-callejero.json` para que la demostración sea reproducible sin depender de Overpass.
 *
 * Solo contiene la cartografía (nombre, tipo de vía y geometría de cada vía). Los establecimientos, sus
 * números de portal y sus ubicaciones de la demostración son FICTICIOS y se generan aparte.
 *
 * Licencia: datos © colaboradores de OpenStreetMap, Open Database License (ODbL) 1.0. La instantánea es
 * una base de datos derivada y conserva esa licencia y su atribución (`__fuente`).
 */

export const ATRIBUCION_OSM = '© colaboradores de OpenStreetMap';
export const LICENCIA_OSM = 'ODbL 1.0';
export const URL_LICENCIA_OSM = 'https://www.openstreetmap.org/copyright';

export interface ViaOsm {
  type: 'way';
  id: number;
  tags: { name: string; highway: string };
  geometry: { lat: number; lon: number }[];
}

export interface FuenteInstantanea {
  origen: string;
  licencia: string;
  atribucion: string;
  urlLicencia: string;
  /** Fecha de la descarga (ISO). */
  fecha: string;
  /** Fecha de los datos OSM según el servidor (`osm3s.timestamp_osm_base`), si consta. */
  fechaDatosOsm?: string;
  servidor?: string;
  consulta: string;
  bbox: readonly number[];
  /** SHA-256 de las vías normalizadas: identifica la instantánea y permite comprobar que no ha cambiado. */
  sha256?: string;
  vias: number;
}

export interface InstantaneaOsm {
  __fuente: FuenteInstantanea;
  elements: ViaOsm[];
}

let tipos: Set<string> | undefined;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Normaliza una respuesta de Overpass (o un JSON exportado de overpass-turbo): solo vías con nombre y
 * tipo admitido, una vez cada una, solo las etiquetas `name` y `highway`, coordenadas a 6 decimales y orden por id. El
 * resultado es estable: la misma respuesta produce siempre el mismo archivo.
 */
export function normalizarOverpass(json: { elements?: unknown[] }): ViaOsm[] {
  const vias: ViaOsm[] = [];
  const vistos = new Set<number>();
  for (const e of json.elements ?? []) {
    const w = e as { type?: string; id?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };
    const nombre = w.tags?.name?.trim();
    const highway = w.tags?.highway;
    if (w.type !== 'way' || typeof w.id !== 'number' || !nombre || !highway || !(tipos ??= new Set(TIPOS_VIA.split('|'))).has(highway)) continue;
    const geometry = (w.geometry ?? []).filter((g) => Number.isFinite(g?.lat) && Number.isFinite(g?.lon)).map((g) => ({ lat: r6(g.lat), lon: r6(g.lon) }));
    if (geometry.length < 2 || vistos.has(w.id)) continue;
    vistos.add(w.id);
    vias.push({ type: 'way', id: w.id, tags: { name: nombre, highway }, geometry });
  }
  return vias.sort((a, b) => a.id - b.id);
}

export type ResultadoValidacion =
  | { ok: true; calles: Calle[]; fuente: FuenteInstantanea; resumen: { vias: number; calles: number; longitudKm: number; fueraDeZona: number } }
  | { ok: false; motivo: string };

/** Vías mínimas para considerar que la instantánea cubre el municipio (Medina tiene varios cientos). */
export const MIN_VIAS = 80;

/**
 * Comprueba que una instantánea es utilizable: atribución y licencia ODbL presentes, suficientes vías, todas
 * con nombre y geometría, y dentro de la zona de Medina del Campo (con un margen de ~1 km).
 */
export function validarInstantanea(json: unknown, municipioId = MEDINA.id, bbox: readonly number[] = MEDINA.bbox): ResultadoValidacion {
  const j = json as Partial<InstantaneaOsm> | null;
  const f = j?.__fuente;
  if (!f) return { ok: false, motivo: 'Falta el bloque de procedencia (__fuente) con la atribución y la licencia.' };
  if (!/odbl/i.test(f.licencia ?? '')) return { ok: false, motivo: 'La instantánea no declara la licencia ODbL.' };
  if (!/openstreetmap/i.test(f.atribucion ?? '')) return { ok: false, motivo: 'La instantánea no incluye la atribución a OpenStreetMap.' };
  const vias = normalizarOverpass({ elements: j?.elements ?? [] });
  if (vias.length !== (j?.elements ?? []).length) return { ok: false, motivo: 'La instantánea contiene elementos sin normalizar (sin nombre, tipo no admitido o sin geometría).' };
  if (vias.length < MIN_VIAS) return { ok: false, motivo: `Solo ${vias.length} vías: la instantánea no cubre el municipio (mínimo ${MIN_VIAS}).` };
  const [s, o, n, e] = bbox;
  const m = 0.01;
  let fuera = 0;
  for (const v of vias) {
    const c = v.geometry[Math.floor(v.geometry.length / 2)];
    if (c.lat < s - m || c.lat > n + m || c.lon < o - m || c.lon > e + m) fuera++;
  }
  if (fuera > vias.length * 0.02) return { ok: false, motivo: `${fuera} vías quedan fuera de la zona de Medina del Campo: la instantánea no corresponde a este municipio.` };
  const calles = callesDesdeOverpass({ elements: vias }, municipioId);
  if (calles.length < 20) return { ok: false, motivo: `Solo ${calles.length} calles con nombre tras agrupar las vías.` };
  return {
    ok: true,
    calles,
    fuente: f as FuenteInstantanea,
    resumen: { vias: vias.length, calles: calles.length, longitudKm: Math.round(calles.reduce((a, c) => a + c.longitudM, 0) / 100) / 10, fueraDeZona: fuera },
  };
}

/** Texto de procedencia para la interfaz (sin depender del idioma del servidor). */
export function detalleInstantanea(f: FuenteInstantanea, calles: number): string {
  const fecha = (f.fechaDatosOsm ?? f.fecha).slice(0, 10);
  return `${calles} calles reales · instantánea OSM del proyecto (datos a ${fecha}) · ${ATRIBUCION_OSM}, ${LICENCIA_OSM}`;
}
