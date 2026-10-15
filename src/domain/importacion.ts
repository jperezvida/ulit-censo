import type { BaseDatos } from './db';
import { claveCalle, normalizar, similitud } from './text';
import { direccionVigente, indiceOcupaciones, ocupacionEn } from './consultas';
import type { Calle, Id } from './types';

// ───────────────────────── CSV ─────────────────────────

/** Parser CSV tolerante (coma, punto y coma o tabulador; comillas dobles). */
export function parsearCSV(texto: string): { cabecera: string[]; filas: string[][]; separador: string } {
  const limpio = texto.replace(/^﻿/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] ?? '';
  const cuenta = (c: string) => primera.split(c).length;
  const separador = [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas: string[][] = [];
  let campo = '';
  let fila: string[] = [];
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === separador) {
      fila.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else campo += ch;
  }
  if (campo || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  const noVacias = filas.filter((f) => f.some((c) => c.trim()));
  return { cabecera: (noVacias[0] ?? []).map((c) => c.trim()), filas: noVacias.slice(1), separador };
}

/** Campos canónicos que el importador sabe interpretar. */
export const CAMPOS = {
  calle: ['calle', 'via', 'direccion', 'nombre de la calle', 'nombre via'],
  numero: ['numero', 'num', 'n', 'nº', 'no', 'portal'],
  nombre: ['nombre', 'nombre comercial', 'establecimiento', 'rotulo', 'negocio'],
  estado: ['estado', 'ocupacion', 'situacion', 'ocupado/vacio', 'vacio'],
  metros: ['metros', 'metros fachada', 'fachada', 'm fachada'],
  grupoActividad: ['grupo de actividad', 'grupo actividad'],
  grupoComercio: ['grupo de comercio', 'grupo comercio'],
  subgrupo: ['subgrupo de actividad', 'subgrupo', 'subgrupo actividad'],
  actividad: ['actividad', 'actividad comercial'],
  cadena: ['cadena', 'franquicia', 'cadena/franquicia'],
  web: ['web', 'pagina web', 'url'],
  instagram: ['instagram', 'ig'],
} as const;
export type CampoCanonico = keyof typeof CAMPOS;

export function mapearCabecera(cabecera: string[]): Partial<Record<CampoCanonico, number>> {
  const out: Partial<Record<CampoCanonico, number>> = {};
  const norm = cabecera.map((c) => normalizar(c));
  for (const [campo, sinonimos] of Object.entries(CAMPOS) as [CampoCanonico, readonly string[]][]) {
    const idx = norm.findIndex((c) => sinonimos.includes(c));
    if (idx >= 0) out[campo] = idx;
  }
  return out;
}

export interface FilaInterpretada {
  fila: number;
  calleTexto: string;
  calleId?: Id;
  numero: number | null;
  sufijo?: string;
  nombre?: string;
  vacio: boolean;
  metros?: number;
  actividad?: string;
  bruto: Record<string, string>;
}

export function interpretarFilas(cab: string[], filas: string[][], mapa: Partial<Record<CampoCanonico, number>>, calles: Calle[]): FilaInterpretada[] {
  const porClave = new Map(calles.map((c) => [claveCalle(c.nombre), c.id]));
  let ultimaCalle = '';
  return filas.map((f, i) => {
    const get = (k: CampoCanonico) => (mapa[k] !== undefined ? (f[mapa[k]!] ?? '').trim() : '');
    // Como en el Excel tradicional, la calle puede venir solo en la primera fila del bloque.
    const calleTexto = get('calle') || ultimaCalle;
    ultimaCalle = calleTexto;
    const numTxt = get('numero');
    const m = numTxt.match(/^(\d+)\s*(.*)$/);
    const estado = normalizar(get('estado'));
    const nombre = get('nombre') || undefined;
    const vacio = estado.startsWith('vac') || estado === 'v' || (!nombre && !!get('metros'));
    const metros = parseFloat(get('metros').replace(',', '.'));
    const bruto: Record<string, string> = {};
    cab.forEach((c, j) => (bruto[c] = f[j] ?? ''));
    return {
      fila: i + 2,
      calleTexto,
      calleId: porClave.get(claveCalle(calleTexto)),
      numero: m ? parseInt(m[1], 10) : null,
      sufijo: m?.[2] || undefined,
      nombre,
      vacio,
      metros: Number.isFinite(metros) ? metros : undefined,
      actividad: get('actividad') || undefined,
      bruto,
    };
  });
}

export type ClaseDiff = 'nuevo' | 'sin-cambios' | 'modificado' | 'fuera-ambito' | 'calle-desconocida' | 'posible-duplicado';

export interface FilaDiff extends FilaInterpretada {
  clase: ClaseDiff;
  localId?: Id;
  detalle: string;
}

/**
 * Previsualización de una importación frente a los datos existentes.
 * Con `limitarACalles` (Excel parcial de un itinerario) las filas de otras calles
 * no se aplican nunca: quedan como "fuera de ámbito".
 */
export function compararImportacion(
  db: BaseDatos, campanaId: Id, filas: FilaInterpretada[], limitarACalles?: Set<Id>,
): FilaDiff[] {
  const camp = db.campanas[campanaId];
  const ref = camp?.campanaReferenciaId ?? campanaId;
  const porCalle = new Map<Id, { id: Id; numero: number | null; sufijo?: string; nombre?: string }[]>();
  const ixOc = indiceOcupaciones(db);
  for (const l of Object.values(db.locales)) {
    if (camp && l.municipioId !== camp.municipioId) continue;
    const d = direccionVigente(l);
    const oc = ocupacionEn(db, l.id, ref, ixOc);
    if (!oc) continue;
    const arr = porCalle.get(d.calleId) ?? [];
    arr.push({ id: l.id, numero: d.numero, sufijo: d.sufijo, nombre: oc.negocioId ? db.negocios[oc.negocioId]?.nombre : undefined });
    porCalle.set(d.calleId, arr);
  }
  const vistos = new Map<string, number>();
  return filas.map((f) => {
    if (!f.calleId) return { ...f, clase: 'calle-desconocida', detalle: `“${f.calleTexto}” no se encuentra en el callejero: revisar o registrar omisión` };
    if (limitarACalles && !limitarACalles.has(f.calleId)) return { ...f, clase: 'fuera-ambito', detalle: 'Calle ajena al itinerario: no se modificará' };
    const clave = `${f.calleId}|${f.numero}|${f.sufijo ?? ''}|${normalizar(f.nombre ?? '')}`;
    if (vistos.has(clave)) return { ...f, clase: 'posible-duplicado', detalle: `Igual que la fila ${vistos.get(clave)}` };
    vistos.set(clave, f.fila);
    const existentes = (porCalle.get(f.calleId) ?? []).filter((e) => e.numero === f.numero && (e.sufijo ?? '') === (f.sufijo ?? ''));
    if (!existentes.length) return { ...f, clase: 'nuevo', detalle: 'No hay local anterior con esa dirección' };
    const igual = existentes.find((e) => (f.vacio && !e.nombre) || (e.nombre && f.nombre && similitud(e.nombre, f.nombre) > 0.85));
    if (igual) return { ...f, clase: 'sin-cambios', localId: igual.id, detalle: 'Coincide con el registro existente' };
    const e = existentes[0];
    return { ...f, clase: 'modificado', localId: e.id, detalle: `Antes: ${e.nombre ?? 'vacío'} → ahora: ${f.vacio ? 'vacío' : f.nombre}` };
  });
}

// ───────────────────────── KML ─────────────────────────

export interface TrazoKML {
  nombre: string;
  carpeta?: string;
  coords: [number, number][];
}

/** Lee LineString de un KML (Google My Maps). Los polígonos se leen por su contorno. */
export function parsearKML(xml: string): TrazoKML[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo KML no es XML válido');
  const out: TrazoKML[] = [];
  const placemarks = Array.from(doc.getElementsByTagName('Placemark'));
  for (const pm of placemarks) {
    const nombre = pm.getElementsByTagName('name')[0]?.textContent?.trim() ?? '(sin nombre)';
    const folder = pm.parentElement?.tagName === 'Folder' ? pm.parentElement.getElementsByTagName('name')[0]?.textContent?.trim() : undefined;
    for (const geom of [...Array.from(pm.getElementsByTagName('LineString')), ...Array.from(pm.getElementsByTagName('LinearRing'))]) {
      const txt = geom.getElementsByTagName('coordinates')[0]?.textContent ?? '';
      const coords = txt
        .trim()
        .split(/\s+/)
        .map((t) => t.split(',').map(Number))
        .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map((c) => [c[0], c[1]] as [number, number]);
      if (coords.length >= 2) out.push({ nombre, carpeta: folder, coords });
    }
  }
  return out;
}

export interface CoincidenciaKML {
  trazo: TrazoKML;
  calleIds: Id[];
  metodo: 'nombre' | 'geometria' | 'sin-coincidencia';
  detalle: string;
}

/**
 * Relaciona los trazos de My Maps con el callejero: primero por nombre,
 * después por proximidad geométrica (≥60 % de los puntos a menos de 20 m).
 * Lo que no casa se presenta como posible omisión del callejero.
 */
export function casarTrazosKML(trazos: TrazoKML[], calles: Calle[], distanciaPuntoLinea: (p: [number, number], l: [number, number][]) => number): CoincidenciaKML[] {
  const porClave = new Map(calles.map((c) => [claveCalle(c.nombre), c]));
  return trazos.map((t) => {
    const porNombre = porClave.get(claveCalle(t.nombre));
    if (porNombre) return { trazo: t, calleIds: [porNombre.id], metodo: 'nombre', detalle: `Nombre coincide con «${porNombre.nombre}»` };
    const muestras = densificar(t.coords, 12);
    const candidatas: { c: Calle; f: number }[] = [];
    for (const c of calles) {
      if (!c.segmentos.length) continue;
      let cerca = 0;
      for (const p of muestras) if (c.segmentos.some((s) => distanciaPuntoLinea(p, s.coords) < 20)) cerca++;
      const f = cerca / muestras.length;
      if (f >= 0.25) candidatas.push({ c, f });
    }
    candidatas.sort((a, b) => b.f - a.f);
    const total = candidatas.reduce((a, x) => a + x.f, 0);
    if (candidatas.length && total >= 0.6) {
      return { trazo: t, calleIds: candidatas.map((x) => x.c.id), metodo: 'geometria', detalle: `Trazado sobre ${candidatas.map((x) => `«${x.c.nombre}» (${Math.round(x.f * 100)} %)`).join(', ')}` };
    }
    return { trazo: t, calleIds: [], metodo: 'sin-coincidencia', detalle: 'Ni el nombre ni la geometría casan con el callejero: revisar o registrar como omisión' };
  });
}

function densificar(coords: [number, number][], n: number): [number, number][] {
  if (coords.length >= n) return coords;
  const out: [number, number][] = [];
  for (let i = 1; i < coords.length; i++) {
    const k = Math.ceil(n / (coords.length - 1));
    for (let j = 0; j < k; j++) {
      const f = j / k;
      out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f]);
    }
  }
  out.push(coords[coords.length - 1]);
  return out;
}
