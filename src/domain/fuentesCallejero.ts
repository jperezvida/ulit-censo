import { longitudLinea } from './geo';
import { claveCalle, normalizar } from './text';
import type { LngLat, Segmento } from './types';

/**
 * G3 · Lectura de callejeros desde FUENTES VERIFICABLES. Nada se descarga desde el navegador (la política
 * de seguridad del sitio solo permite conectar con el propio sitio): la persona aporta el ARCHIVO que
 * exporta la fuente y aquí se comprueba antes de usarlo.
 *
 * - OpenStreetMap: el resultado de la consulta de `consultaOverpassMunicipio` (overpass-turbo → Exportar
 *   → datos sin procesar). Debe incluir el LÍMITE ADMINISTRATIVO del municipio (relación de nivel 8) con
 *   su geometría: se comprueba que es el municipio elegido (código INE o nombre) y que cada vía cae dentro.
 * - Callejero oficial: CSV (separado por «;», «,» o tabulador) o GeoJSON con el nombre de la vía y,
 *   opcionalmente, su tipo, su código y el municipio (si viene, debe coincidir).
 *
 * Calles, plazas y otros espacios: una vía puede ser una línea (tramo), un ÁREA (plaza, calle peatonal
 * dibujada como superficie) o un PUNTO (plaza marcada con un nodo). Y puede no tener geometría: eso no
 * significa que no exista.
 */

export interface ViaEntrante {
  nombre: string;
  codigo?: string;
  segmentos: Segmento[];
  refs: string[];
}

export interface Descartes {
  sinNombre: number;
  fueraDelLimite: number;
  tipoNoAdmitido: number;
  otroMunicipio: number;
  geometriaInvalida: number;
}

export type LecturaCallejero =
  | {
    ok: true;
    tipo: 'osm' | 'oficial';
    vias: ViaEntrante[];
    /** Filas o elementos de la fuente agrupados en una vía ya leída (mismo nombre). */
    agrupados: number;
    descartes: Descartes;
    avisos: string[];
    fechaDatos?: string;
    limite?: { bbox: [number, number, number, number]; fuente: string; ine?: string; nombre?: string; poligono: Limite };
  }
  | { ok: false; motivo: string };

export interface MunicipioFuente {
  nombre: string;
  ine?: string;
}

const descartesVacios = (): Descartes => ({ sinNombre: 0, fueraDelLimite: 0, tipoNoAdmitido: 0, otroMunicipio: 0, geometriaInvalida: 0 });
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const valido = (p: LngLat) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Vías de OSM que forman el callejero: calles, peatonales y plazas (con nombre). */
export const HIGHWAY_CALLEJERO = ['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian', 'trunk', 'primary_link', 'secondary_link', 'tertiary_link', 'service', 'road'];

/**
 * Consulta de Overpass para obtener el callejero de UN municipio, dentro de su límite administrativo
 * (nivel 8). Con código INE (etiqueta `ine:municipio` de OSM en España) es inequívoca; solo con el
 * nombre puede haber municipios homónimos (el archivo se rechaza si trae más de un límite).
 */
export function consultaOverpassMunicipio(m: MunicipioFuente): string {
  const filtro = m.ine ? `["ine:municipio"="${m.ine}"]` : `["name"="${m.nombre.replace(/"/g, '')}"]`;
  return [
    '[out:json][timeout:90];',
    `rel["boundary"="administrative"]["admin_level"="8"]${filtro}->.limite;`,
    '.limite out geom;',
    '.limite map_to_area->.zona;',
    '(',
    `  way["highway"~"^(${HIGHWAY_CALLEJERO.join('|')})$"]["name"](area.zona);`,
    '  way["place"="square"]["name"](area.zona);',
    '  rel["place"="square"]["name"](area.zona);',
    '  node["place"="square"]["name"](area.zona);',
    ');',
    'out geom;',
  ].join('\n');
}

// ───────────── Geometría del límite ─────────────

type Anillo = LngLat[];

/** Une los tramos (miembros) de un límite en anillos cerrados. */
export function anillosDesdeMiembros(tramos: LngLat[][]): Anillo[] {
  const pend = tramos.filter((t) => t.length >= 2).map((t) => [...t]);
  const anillos: Anillo[] = [];
  const igual = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  while (pend.length) {
    let actual = pend.shift()!;
    for (let cambio = true; cambio && !igual(actual[0], actual[actual.length - 1]);) {
      cambio = false;
      for (let i = 0; i < pend.length; i++) {
        const t = pend[i];
        const fin = actual[actual.length - 1];
        if (igual(t[0], fin)) actual = [...actual, ...t.slice(1)];
        else if (igual(t[t.length - 1], fin)) actual = [...actual, ...[...t].reverse().slice(1)];
        else continue;
        pend.splice(i, 1);
        cambio = true;
        break;
      }
    }
    if (actual.length >= 4 && igual(actual[0], actual[actual.length - 1])) anillos.push(actual);
  }
  return anillos;
}

function dentroAnillo(p: LngLat, a: Anillo): boolean {
  let dentro = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const [xi, yi] = a[i];
    const [xj, yj] = a[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

export interface Limite {
  exteriores: Anillo[];
  interiores: Anillo[];
}
export const dentroDelLimite = (p: LngLat, l: Limite) => l.exteriores.some((a) => dentroAnillo(p, a)) && !l.interiores.some((a) => dentroAnillo(p, a));

/** ¿Se cortan los segmentos a–b y c–d? (incluye tocarse). */
function cortan(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o = (p: LngLat, q: LngLat, r: LngLat) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const en = (p: LngLat, q: LngLat, r: LngLat) => Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
  const [o1, o2, o3, o4] = [o(a, b, c), o(a, b, d), o(c, d, a), o(c, d, b)];
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && en(a, c, b)) || (o2 === 0 && en(a, d, b)) || (o3 === 0 && en(c, a, d)) || (o4 === 0 && en(c, b, d));
}

/**
 * ¿Está una geometría (punto, línea o contorno) completamente dentro del límite? Todos sus vértices dentro
 * Y ningún tramo cruza el perímetro (una línea con los extremos dentro puede atravesar una entrante).
 */
export function geometriaDentro(coords: LngLat[], l: Limite): { dentro: boolean; verticesFuera: number; cruza: boolean } {
  const verticesFuera = coords.filter((p) => !dentroDelLimite(p, l)).length;
  const anillos = [...l.exteriores, ...l.interiores];
  let cruza = false;
  for (let i = 0; i + 1 < coords.length && !cruza; i++) {
    for (const a of anillos) {
      for (let k = 0; k + 1 < a.length; k++) if (cortan(coords[i], coords[i + 1], a[k], a[k + 1])) { cruza = true; break; }
      if (cruza) break;
    }
  }
  return { dentro: !verticesFuera && !cruza, verticesFuera, cruza };
}
const bboxDe = (ps: LngLat[]): [number, number, number, number] => [
  Math.min(...ps.map((p) => p[1])), Math.min(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])),
];

// ───────────── OpenStreetMap ─────────────

interface ElementoOsm {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
  members?: { type?: string; ref?: number; role?: string; geometry?: { lat: number; lon: number }[] }[];
}

const coordsDe = (g?: { lat: number; lon: number }[]): LngLat[] => (g ?? []).map((x) => [r6(x.lon), r6(x.lat)] as LngLat).filter(valido);
const cerrada = (c: LngLat[]) => c.length >= 4 && c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1];
const segmento = (id: string, coords: LngLat[], tipo: Segmento['tipo'], fuente: string): Segmento => ({ id, coords, longitudM: tipo === 'punto' ? 0 : Math.round(longitudLinea(coords)), tipo, fuente });

/** Agrupa los elementos leídos por nombre (una vía = varios segmentos). */
function agrupar(items: { nombre: string; codigo?: string; seg?: Segmento; ref: string }[]): { vias: ViaEntrante[]; agrupados: number } {
  const m = new Map<string, ViaEntrante>();
  let agrupados = 0;
  for (const it of items) {
    const k = claveCalle(it.nombre);
    const v = m.get(k);
    if (v) {
      agrupados++;
      if (it.seg && !v.segmentos.some((s) => s.id === it.seg!.id)) v.segmentos.push(it.seg);
      if (!v.refs.includes(it.ref)) v.refs.push(it.ref);
      if (!v.codigo && it.codigo) v.codigo = it.codigo;
    } else m.set(k, { nombre: it.nombre, ...(it.codigo ? { codigo: it.codigo } : {}), segmentos: it.seg ? [it.seg] : [], refs: [it.ref] });
  }
  return { vias: [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), agrupados };
}

/** Lee la exportación de Overpass del callejero de un municipio y la comprueba contra su límite administrativo. */
export function leerOsmMunicipio(json: unknown, m: MunicipioFuente): LecturaCallejero {
  const j = json as { elements?: ElementoOsm[]; osm3s?: { timestamp_osm_base?: string }; __fuente?: { fechaDatosOsm?: string } } | null;
  if (!j || !Array.isArray(j.elements)) return { ok: false, motivo: 'El archivo no es una exportación de OpenStreetMap (Overpass): falta la lista «elements».' };
  const limites = j.elements.filter((e) => e.type === 'relation' && e.tags?.boundary === 'administrative' && e.tags?.admin_level === '8');
  if (!limites.length) return { ok: false, motivo: 'El archivo no incluye el límite administrativo del municipio (relación de nivel 8). Use la consulta que propone ULIT: así se comprueba que todas las vías son de este municipio.' };
  if (limites.length > 1) return { ok: false, motivo: `El archivo incluye ${limites.length} límites municipales (¿municipios con el mismo nombre?). Use la consulta con el código INE.` };
  const lim = limites[0];
  const ineOsm = lim.tags?.['ine:municipio'];
  const avisos: string[] = [];
  if (m.ine && ineOsm && ineOsm !== m.ine) return { ok: false, motivo: `El límite del archivo es del municipio con código INE ${ineOsm} («${lim.tags?.name ?? '¿?'}»), no del ${m.ine} («${m.nombre}»).` };
  if (normalizar(lim.tags?.name ?? '') !== normalizar(m.nombre)) {
    if (!m.ine || ineOsm !== m.ine) return { ok: false, motivo: `El límite del archivo es de «${lim.tags?.name ?? '¿?'}», no de «${m.nombre}».` };
    avisos.push(`El límite se llama «${lim.tags?.name}» en OSM; coincide el código INE ${m.ine}.`);
  }
  if (m.ine && !ineOsm) avisos.push('El límite de OSM no tiene la etiqueta «ine:municipio»: se ha comprobado solo por el nombre.');
  const anillo = (rol: string) => anillosDesdeMiembros((lim.members ?? []).filter((x) => x.type === 'way' && (x.role || 'outer') === rol).map((x) => coordsDe(x.geometry)));
  const limite: Limite = { exteriores: anillo('outer'), interiores: anillo('inner') };
  if (!limite.exteriores.length) return { ok: false, motivo: 'El límite administrativo del archivo no tiene geometría completa (anillo cerrado): no se puede comprobar qué vías son del municipio.' };
  const descartes = descartesVacios();
  const items: { nombre: string; seg?: Segmento; ref: string }[] = [];
  const admite = (s: Segmento) => {
    if (s.coords.some((p) => dentroDelLimite(p, limite))) return true;
    descartes.fueraDelLimite++;
    return false;
  };
  for (const e of j.elements) {
    if (e === lim || typeof e.id !== 'number') continue;
    const nombre = e.tags?.name?.trim();
    const plaza = e.tags?.place === 'square';
    const hw = e.tags?.highway;
    if (e.type === 'way') {
      if (!plaza && (!hw || !HIGHWAY_CALLEJERO.includes(hw))) { descartes.tipoNoAdmitido++; continue; }
      if (!nombre) { descartes.sinNombre++; continue; }
      const c = coordsDe(e.geometry);
      if (c.length < 2) { descartes.geometriaInvalida++; continue; }
      const area = cerrada(c) && (plaza || e.tags?.area === 'yes');
      const s = segmento(`w${e.id}`, c, area ? 'area' : 'linea', `osm:way/${e.id}`);
      if (admite(s)) items.push({ nombre, seg: s, ref: `osm:way/${e.id}` });
    } else if (e.type === 'relation') {
      if (!plaza) { descartes.tipoNoAdmitido++; continue; }
      if (!nombre) { descartes.sinNombre++; continue; }
      const anillos = anillosDesdeMiembros((e.members ?? []).filter((x) => x.type === 'way' && (x.role || 'outer') === 'outer').map((x) => coordsDe(x.geometry)));
      if (!anillos.length) { descartes.geometriaInvalida++; continue; }
      anillos.forEach((a, i) => {
        const s = segmento(`r${e.id}${anillos.length > 1 ? `-${i + 1}` : ''}`, a, 'area', `osm:relation/${e.id}`);
        if (admite(s)) items.push({ nombre, seg: s, ref: `osm:relation/${e.id}` });
      });
    } else if (e.type === 'node') {
      if (!plaza) { descartes.tipoNoAdmitido++; continue; }
      if (!nombre) { descartes.sinNombre++; continue; }
      const p: LngLat = [r6(e.lon ?? NaN), r6(e.lat ?? NaN)];
      if (!valido(p)) { descartes.geometriaInvalida++; continue; }
      const s = segmento(`n${e.id}`, [p], 'punto', `osm:node/${e.id}`);
      if (admite(s)) items.push({ nombre, seg: s, ref: `osm:node/${e.id}` });
    }
  }
  if (!items.length) return { ok: false, motivo: 'El archivo no contiene ninguna vía con nombre dentro del límite del municipio.' };
  const { vias, agrupados } = agrupar(items);
  const todos = limite.exteriores.flat();
  return {
    ok: true, tipo: 'osm', vias, agrupados, descartes, avisos,
    fechaDatos: j.osm3s?.timestamp_osm_base ?? j.__fuente?.fechaDatosOsm,
    limite: { bbox: bboxDe(todos), fuente: `osm:relation/${lim.id}`, ...(ineOsm ? { ine: ineOsm } : {}), ...(lim.tags?.name ? { nombre: lim.tags.name } : {}), poligono: limite },
  };
}

// ───────────── Callejero oficial (CSV o GeoJSON) ─────────────

/** Abreviaturas de tipo de vía habituales en los callejeros oficiales. */
const TIPOS_OFICIALES: Record<string, string> = {
  cl: 'Calle', c: 'Calle', calle: 'Calle', pz: 'Plaza', pl: 'Plaza', plza: 'Plaza', plaza: 'Plaza', av: 'Avenida', avda: 'Avenida', avenida: 'Avenida',
  ps: 'Paseo', pso: 'Paseo', paseo: 'Paseo', tr: 'Travesía', trva: 'Travesía', travesia: 'Travesía', rd: 'Ronda', rda: 'Ronda', ronda: 'Ronda',
  cm: 'Camino', cno: 'Camino', camino: 'Camino', cr: 'Carretera', ctra: 'Carretera', carretera: 'Carretera', gl: 'Glorieta', glorieta: 'Glorieta',
  pj: 'Pasaje', psje: 'Pasaje', pasaje: 'Pasaje', cj: 'Callejón', callejon: 'Callejón', pq: 'Parque', parque: 'Parque', ur: 'Urbanización', urb: 'Urbanización', urbanizacion: 'Urbanización',
};
const COLUMNAS = {
  nombre: ['nombre', 'nombre via', 'nombre de la via', 'nombre de via', 'denominacion', 'via', 'calle', 'name', 'nomvia'],
  tipo: ['tipo', 'tipo via', 'tipo de via', 'tipovia', 'tvia'],
  codigo: ['codigo', 'codigo via', 'cod via', 'cvia', 'id via', 'codvia'],
  municipio: ['municipio', 'ine', 'codigo ine', 'cod municipio', 'cmun', 'cod ine'],
};

/** Nombre completo «Tipo Nombre» (si el nombre ya empieza por su tipo, no se repite). */
export function nombreCompleto(nombre: string, tipo?: string): string {
  const n = nombre.trim().replace(/\s+/g, ' ');
  const t = tipo?.trim() ? TIPOS_OFICIALES[normalizar(tipo).replace(/\s/g, '')] ?? tipo.trim() : '';
  if (!t || normalizar(n).startsWith(`${normalizar(t)} `)) return n;
  return `${t} ${n}`;
}

const coincideMunicipio = (valor: string, m: MunicipioFuente) => {
  const v = valor.trim();
  if (!v) return true;
  if (/^\d{4,5}$/.test(v)) return !m.ine || v.padStart(5, '0') === m.ine || (v.length === 3 && m.ine.endsWith(v));
  return normalizar(v) === normalizar(m.nombre);
};

function separarCsv(linea: string, sep: string): string[] {
  const res: string[] = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') {
      if (comillas && linea[i + 1] === '"') { actual += '"'; i++; } else comillas = !comillas;
    } else if (ch === sep && !comillas) { res.push(actual); actual = ''; } else actual += ch;
  }
  res.push(actual);
  return res.map((x) => x.trim());
}

/** Lee un callejero oficial en CSV (cabecera en la primera línea). */
export function leerCallejeroCsv(texto: string, m: MunicipioFuente): LecturaCallejero {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2) return { ok: false, motivo: 'El CSV no tiene filas de datos.' };
  const sep = [';', '\t', ','].map((s) => [s, separarCsv(lineas[0], s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const cab = separarCsv(lineas[0], sep).map((h) => normalizar(h).replace(/[_-]/g, ' '));
  const col = (k: keyof typeof COLUMNAS) => cab.findIndex((h) => COLUMNAS[k].includes(h));
  const iNombre = col('nombre');
  if (iNombre < 0) return { ok: false, motivo: `No se encuentra la columna del nombre de la vía (se admiten: ${COLUMNAS.nombre.join(', ')}).` };
  const [iTipo, iCodigo, iMun] = [col('tipo'), col('codigo'), col('municipio')];
  const descartes = descartesVacios();
  const items: { nombre: string; codigo?: string; ref: string }[] = [];
  lineas.slice(1).forEach((l, i) => {
    const f = separarCsv(l, sep);
    if (iMun >= 0 && !coincideMunicipio(f[iMun] ?? '', m)) { descartes.otroMunicipio++; return; }
    const nombre = (f[iNombre] ?? '').trim();
    if (!nombre) { descartes.sinNombre++; return; }
    const codigo = iCodigo >= 0 ? f[iCodigo]?.trim() || undefined : undefined;
    items.push({ nombre: nombreCompleto(nombre, iTipo >= 0 ? f[iTipo] : undefined), ...(codigo ? { codigo } : {}), ref: codigo ? `oficial:${codigo}` : `oficial:fila-${i + 2}` });
  });
  if (!items.length) return { ok: false, motivo: 'Ninguna fila del CSV tiene una vía de este municipio.' };
  const { vias, agrupados } = agrupar(items);
  const avisos = [
    ...(iMun < 0 ? ['El archivo no tiene columna de municipio: compruebe que es el callejero de este municipio.'] : []),
    'El callejero oficial en CSV no trae geometría: las vías se incorporan «sin geometría» (existen aunque no estén dibujadas).',
  ];
  return { ok: true, tipo: 'oficial', vias, agrupados, descartes, avisos };
}

interface Feature { type?: string; properties?: Record<string, unknown> | null; geometry?: { type?: string; coordinates?: unknown } | null }

/** Lee un callejero oficial en GeoJSON (líneas, áreas y puntos; también rasgos sin geometría). */
export function leerCallejeroGeoJson(json: unknown, m: MunicipioFuente): LecturaCallejero {
  const fc = json as { type?: string; features?: Feature[] } | null;
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) return { ok: false, motivo: 'El archivo no es un GeoJSON «FeatureCollection».' };
  const prop = (p: Record<string, unknown>, claves: string[]) => {
    const k = Object.keys(p).find((x) => claves.includes(normalizar(x).replace(/[_-]/g, ' ')));
    return k !== undefined && p[k] !== null && p[k] !== undefined ? String(p[k]) : undefined;
  };
  const descartes = descartesVacios();
  const items: { nombre: string; codigo?: string; seg?: Segmento; ref: string }[] = [];
  fc.features.forEach((f, i) => {
    const p = f.properties ?? {};
    const mun = prop(p, COLUMNAS.municipio);
    if (mun && !coincideMunicipio(mun, m)) { descartes.otroMunicipio++; return; }
    const base = prop(p, COLUMNAS.nombre)?.trim();
    if (!base) { descartes.sinNombre++; return; }
    const nombre = nombreCompleto(base, prop(p, COLUMNAS.tipo));
    const codigo = prop(p, COLUMNAS.codigo)?.trim() || undefined;
    const ref = codigo ? `oficial:${codigo}` : `geojson:${i}`;
    const g = f.geometry;
    const lista = (x: unknown): LngLat[] => (Array.isArray(x) ? x.map((c) => [r6(Number((c as number[])[0])), r6(Number((c as number[])[1]))] as LngLat) : []);
    const segs: Segmento[] = [];
    let mala = false;
    const add = (coords: LngLat[], tipo: Segmento['tipo'], n: number) => {
      if (!coords.length || !coords.every(valido) || (tipo !== 'punto' && coords.length < 2)) { mala = true; return; }
      segs.push(segmento(`g${i}${n ? `-${n}` : ''}`, coords, tipo, ref));
    };
    if (g?.type === 'LineString') add(lista(g.coordinates), 'linea', 0);
    else if (g?.type === 'MultiLineString') (g.coordinates as unknown[]).forEach((x, k) => add(lista(x), 'linea', k + 1));
    else if (g?.type === 'Polygon') add(lista((g.coordinates as unknown[])[0]), 'area', 0);
    else if (g?.type === 'MultiPolygon') (g.coordinates as unknown[][]).forEach((x, k) => add(lista(x[0]), 'area', k + 1));
    else if (g?.type === 'Point') add([lista([g.coordinates])[0]], 'punto', 0);
    else if (g) mala = true;
    if (mala) { descartes.geometriaInvalida++; return; }
    if (!segs.length) items.push({ nombre, ...(codigo ? { codigo } : {}), ref });
    else segs.forEach((s) => items.push({ nombre, ...(codigo ? { codigo } : {}), seg: s, ref }));
  });
  if (!items.length) return { ok: false, motivo: 'Ningún rasgo del GeoJSON tiene una vía de este municipio.' };
  const { vias, agrupados } = agrupar(items);
  return { ok: true, tipo: 'oficial', vias, agrupados, descartes, avisos: [] };
}

/** Elige el lector según el contenido del archivo. */
export function leerFuenteCallejero(texto: string, archivo: string, tipo: 'osm' | 'oficial', m: MunicipioFuente): LecturaCallejero {
  if (tipo === 'oficial' && /\.(csv|txt|tsv)$/i.test(archivo)) return leerCallejeroCsv(texto, m);
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: tipo === 'osm' ? 'El archivo no es JSON: exporte el resultado de la consulta como «datos sin procesar» (raw data).' : 'El archivo no es CSV ni GeoJSON.' };
  }
  return tipo === 'osm' ? leerOsmMunicipio(json, m) : leerCallejeroGeoJson(json, m);
}

/**
 * Geometría OPCIONAL de una vía añadida a mano: un GeoJSON (Point, LineString o Polygon) o pares
 * «latitud, longitud» (uno por línea). Nunca se inventa: vacío = sin geometría.
 */
export function leerGeometriaManual(texto: string): { ok: true; segmento?: Segmento } | { ok: false; motivo: string } {
  const t = texto.trim();
  if (!t) return { ok: true };
  if (t.startsWith('{')) {
    try {
      const g = JSON.parse(t) as { type?: string; coordinates?: unknown; geometry?: { type?: string; coordinates?: unknown } };
      const geo = g.geometry ?? g;
      const lista = (x: unknown): LngLat[] => (Array.isArray(x) ? x.map((c) => [r6(Number((c as number[])[0])), r6(Number((c as number[])[1]))] as LngLat) : []);
      let coords: LngLat[] = [];
      let tipo: Segmento['tipo'];
      if (geo.type === 'Point') { coords = [lista([geo.coordinates])[0]]; tipo = 'punto'; }
      else if (geo.type === 'LineString') { coords = lista(geo.coordinates); tipo = 'linea'; }
      else if (geo.type === 'Polygon') { coords = lista((geo.coordinates as unknown[])?.[0]); tipo = 'area'; }
      else return { ok: false, motivo: 'Geometría no admitida: use Point, LineString o Polygon.' };
      if (!coords.length || !coords.every(valido) || (tipo !== 'punto' && coords.length < 2)) return { ok: false, motivo: 'Coordenadas no válidas.' };
      return { ok: true, segmento: segmento('m1', coords, tipo, 'manual') };
    } catch {
      return { ok: false, motivo: 'El GeoJSON de la geometría no es válido.' };
    }
  }
  const pares = t.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[,;\s]+/).filter(Boolean).map(Number));
  if (pares.some((p) => p.length !== 2 || p.some((x) => !Number.isFinite(x)))) return { ok: false, motivo: 'Escriba un par «latitud, longitud» por línea (p. ej. 41.3108, -4.9142) o pegue un GeoJSON.' };
  const coords = pares.map(([lat, lon]) => [r6(lon), r6(lat)] as LngLat);
  if (!coords.every(valido)) return { ok: false, motivo: 'Coordenadas fuera de rango.' };
  return { ok: true, segmento: segmento('m1', coords, coords.length === 1 ? 'punto' : 'linea', 'manual') };
}
