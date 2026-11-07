import { ErrorDominio } from './db';
import { TAXONOMIA, TAXONOMIA_POR_ID, hijosDe, rutaActividad } from './taxonomy';
import { normalizar } from './text';
import type { Id, NodoActividad } from './types';

/**
 * Buscador de clasificaciones de un catálogo.
 *
 * - Ignora mayúsculas, tildes y singular/plural («estanco» ↔ «Estancos», «hoteles» ↔ «Hotel»).
 * - Busca en el nombre, en las palabras clave AUTORIZADAS (texto del documento y excepciones ICM)
 *   y en los ejemplos de Servicios. No usa las clasificaciones de campañas anteriores.
 * - Ordena por relevancia; lo reciente y lo frecuente solo desempata, nunca adelanta a una
 *   coincidencia mejor (frecuencia ≠ corrección).
 * - Si un mismo nombre corresponde a varias clasificaciones, lo marca como ambiguo y NO elige.
 */

export type TipoOpcion = 'actividad' | 'subgrupo' | 'ejemplo';

export interface OpcionClasificacion {
  /** Identificador estable de la opción (nodo + descripción). */
  clave: string;
  /** Nodo que se guarda: actividad o subgrupo. */
  nodoId: Id;
  /** Descripción que se guarda con el subgrupo (ejemplos de Servicios, excepciones ICM). */
  descripcion?: string;
  tipo: TipoOpcion;
  /** Texto principal de la sugerencia. */
  etiqueta: string;
  /** Ruta completa: «Comercio › Alimentación › Carnes › Carnicería». */
  ruta: string;
  /** Subgrupo con actividades elegido sin actividad: hay que escribir una breve descripción. */
  requiereDescripcion: boolean;
}

export interface Resultado extends OpcionClasificacion {
  puntos: number;
  /** Por qué aparece (p. ej. «palabra clave: bisutería»). */
  motivo?: string;
}

const SEP = ' › ';

/** Raíz sencilla para singular/plural en español. */
export function raiz(palabra: string): string {
  const w = normalizar(palabra);
  if (w.length > 4 && /[^aeiou]es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}
const palabras = (t: string) => normalizar(t).split(/[\s\-/&]+/).filter(Boolean);
const raices = (t: string) => palabras(t).map(raiz);

export function rutaTexto(id: Id, descripcion?: string): string {
  const r = rutaActividad(id).map((n) => n.nombre).join(SEP);
  return descripcion ? `${r} · ${descripcion}` : r;
}

const INDICES = new Map<string, OpcionClasificacion[]>();

/** Todas las opciones seleccionables de un catálogo (actividades, subgrupos y ejemplos). */
export function opcionesCatalogo(catalogo: string): OpcionClasificacion[] {
  const cache = INDICES.get(catalogo);
  if (cache) return cache;
  const out: OpcionClasificacion[] = [];
  for (const n of TAXONOMIA) {
    if (n.catalogo !== catalogo) continue;
    if (n.nivel === 4) out.push({ clave: n.id, nodoId: n.id, tipo: 'actividad', etiqueta: n.nombre, ruta: rutaTexto(n.id), requiereDescripcion: false });
    if (n.nivel === 3) {
      const conActividades = hijosDe(n.id).length > 0;
      out.push({ clave: n.id, nodoId: n.id, tipo: 'subgrupo', etiqueta: n.nombre, ruta: rutaTexto(n.id), requiereDescripcion: conActividades });
      for (const e of n.ejemplos ?? []) {
        out.push({ clave: `${n.id}#${e}`, nodoId: n.id, descripcion: e, tipo: 'ejemplo', etiqueta: e, ruta: rutaTexto(n.id, e), requiereDescripcion: false });
      }
    }
  }
  INDICES.set(catalogo, out);
  return out;
}

function nodo(o: OpcionClasificacion): NodoActividad {
  return TAXONOMIA_POR_ID[o.nodoId];
}

/** Puntuación de un texto frente a la consulta (0 = no coincide). */
function puntuarTexto(q: string, qRaices: string[], texto: string): number {
  const t = normalizar(texto);
  if (!t) return 0;
  if (t === q) return 100;
  const tRaices = raices(texto);
  if (tRaices.join(' ') === qRaices.join(' ')) return 96;
  if (t.startsWith(q)) return 86;
  // Todas las palabras de la consulta son prefijo de alguna palabra del texto
  const tPal = palabras(texto);
  if (qRaices.every((qr, i) => tPal.some((w) => w.startsWith(palabras(q)[i] ?? qr) || raiz(w).startsWith(qr)))) return 74;
  if (t.includes(q)) return 52;
  return 0;
}

export interface OpcionesBusqueda {
  /** Claves de opciones usadas recientemente (más reciente primero). */
  recientes?: string[];
  /** Usos por clave de opción. */
  usos?: Record<string, number>;
  limite?: number;
}

/** Busca en el catálogo. Consulta vacía: devuelve las recientes (marcadas como tales). */
export function buscarClasificacion(catalogo: string, consulta: string, op: OpcionesBusqueda = {}): { resultados: Resultado[]; ambiguo: boolean } {
  const limite = op.limite ?? 12;
  const todas = opcionesCatalogo(catalogo);
  const q = normalizar(consulta);
  if (!q) {
    const rec = (op.recientes ?? []).map((k) => todas.find((o) => o.clave === k)).filter((x): x is OpcionClasificacion => !!x);
    return { resultados: rec.slice(0, limite).map((o) => ({ ...o, puntos: 0, motivo: 'usada recientemente' })), ambiguo: false };
  }
  const qRaices = raices(consulta);
  const res: Resultado[] = [];
  for (const o of todas) {
    let puntos = puntuarTexto(q, qRaices, o.etiqueta);
    let motivo: string | undefined;
    if (o.tipo === 'actividad' || o.tipo === 'subgrupo') {
      for (const c of nodo(o).claves ?? []) {
        if (o.tipo === 'subgrupo' && (nodo(o).ejemplos ?? []).includes(c)) continue; // los ejemplos van como opción propia
        const p = Math.round(puntuarTexto(q, qRaices, c) * 0.72);
        if (p > puntos) {
          puntos = p;
          motivo = `palabra clave: ${c}`;
        }
      }
    }
    // Coincidencia con el subgrupo o grupo superior: muestra sus actividades
    if (!puntos && o.tipo === 'actividad') {
      const padre = TAXONOMIA_POR_ID[nodo(o).padreId!];
      const p = Math.round(puntuarTexto(q, qRaices, padre.nombre) * 0.45);
      if (p) {
        puntos = p;
        motivo = `del subgrupo ${padre.nombre}`;
      }
    }
    if (!puntos) continue;
    if (o.tipo === 'subgrupo' && o.requiereDescripcion) puntos -= 18; // preferir una actividad concreta
    if (o.tipo === 'ejemplo') puntos -= 1;
    // Desempate por uso (≤ 3 puntos: nunca adelanta a una coincidencia claramente mejor)
    const ri = (op.recientes ?? []).indexOf(o.clave);
    const extra = Math.min(3, (ri >= 0 ? 2 : 0) + Math.min(1, (op.usos?.[o.clave] ?? 0) / 10));
    res.push({ ...o, puntos: puntos + extra, motivo });
  }
  res.sort((a, b) => b.puntos - a.puntos || a.ruta.localeCompare(b.ruta, 'es'));
  const top = res[0];
  const ambiguo = !!top && res.filter((r) => r.puntos >= top.puntos - 3 && normalizar(r.etiqueta) === normalizar(top.etiqueta)).length > 1;
  return { resultados: res.slice(0, limite), ambiguo };
}

/** Clave de opción → opción (para recientes y para confirmar una elección). */
export function opcionPorClave(catalogo: string, clave: string): OpcionClasificacion | undefined {
  return opcionesCatalogo(catalogo).find((o) => o.clave === clave);
}

/**
 * Texto ÚNICO de una clasificación para copiar y pegar: el nombre si no hay otro igual en el
 * catálogo; si no, la ruta completa. Con descripción: «… · descripción».
 */
export function textoClasificacion(id: Id | undefined, descripcion?: string): string {
  if (!id) return '';
  const n = TAXONOMIA_POR_ID[id];
  if (!n) return '';
  const iguales = opcionesCatalogo(n.catalogo ?? 'demo').filter((o) => o.tipo !== 'ejemplo' && normalizar(o.etiqueta) === normalizar(n.nombre));
  const base = iguales.length > 1 ? rutaTexto(id) : n.nombre;
  return descripcion ? `${base} · ${descripcion}` : base;
}

/**
 * Interpreta un texto tecleado o pegado: nombre único, ruta completa («A › B › C») y, opcionalmente,
 * « · descripción». Lanza ErrorDominio si no existe o es ambiguo (nunca elige al azar).
 */
export function resolverTexto(catalogo: string, texto: string): { nodoId: Id; descripcion?: string } {
  const t = texto.trim();
  if (!t) throw new ErrorDominio('regla', 'Indica una actividad.');
  let base = t;
  let descripcion: string | undefined;
  const i = t.lastIndexOf(' · ');
  if (i > 0) {
    base = t.slice(0, i).trim();
    descripcion = t.slice(i + 3).trim() || undefined;
  }
  const todas = opcionesCatalogo(catalogo).filter((o) => o.tipo !== 'ejemplo');
  let candidatas: OpcionClasificacion[];
  if (base.includes('›') || base.includes('>')) {
    const partes = base.split(/›|>/).map((x) => normalizar(x)).filter(Boolean);
    candidatas = todas.filter((o) => {
      const r = rutaActividad(o.nodoId).map((n) => normalizar(n.nombre));
      return r.length >= partes.length && partes.every((p, k) => r[r.length - partes.length + k] === p);
    });
  } else {
    const nb = normalizar(base);
    const rb = raices(base).join(' ');
    candidatas = todas.filter((o) => normalizar(o.etiqueta) === nb);
    if (!candidatas.length) candidatas = todas.filter((o) => raices(o.etiqueta).join(' ') === rb);
  }
  // Un subgrupo y su única actividad homónima («Estancos › Estancos»): se prefiere la actividad.
  if (candidatas.length > 1) {
    const acts = candidatas.filter((o) => o.tipo === 'actividad');
    const subs = candidatas.filter((o) => o.tipo === 'subgrupo');
    if (acts.length === 1 && subs.every((s) => TAXONOMIA_POR_ID[acts[0].nodoId].padreId === s.nodoId)) candidatas = acts;
  }
  if (!candidatas.length) throw new ErrorDominio('regla', `«${base}» no está en el catálogo de clasificación.`);
  if (candidatas.length > 1) {
    throw new ErrorDominio('regla', `«${base}» es ambiguo: ${candidatas.map((o) => o.ruta).join(' | ')}. Indica la ruta completa.`, candidatas.map((o) => o.ruta));
  }
  return { nodoId: candidatas[0].nodoId, descripcion };
}

// ───────────── Sugerencias según el nombre del establecimiento ─────────────

/** Términos demasiado genéricos para sugerir una clasificación a partir del nombre. */
const GENERICOS = new Set(
  ['otros', 'otro', 'trabajo', 'tradicional', 'internacional', 'oficina', 'proveedor', 'reparaciones', 'reparacion', 'club', 'radio', 'tv', 'revista', 'agua', 'gas',
    'electricidad', 'combustible', 'pistas', 'pista', 'ropa', 'calzado', 'telefonos', 'vecinales', 'politicas', 'discapacidad', 'estadios', 'regalos', 'bebidas', 'musica', 'segunda', 'mano',
    'productos', 'servicios', 'centro', 'centros', 'tienda', 'tiendas', 'casa', 'general', 'material', 'articulos'].map(raiz),
);
/** Subgrupos cuyos ejemplos no se usan para sugerir por nombre (palabras de uso común). */
const SIN_SUGERENCIA_EJEMPLOS = new Set(['Reparaciones', 'Telefonía', 'Instalaciones y suministros', 'Asociaciones', 'Comunicaciones', 'Limpiezas']);

export interface Sugerencia extends OpcionClasificacion {
  motivo: string;
}

/**
 * Propuestas a partir del nombre comercial: solo cuando una palabra (o expresión) del nombre
 * coincide COMPLETA con el nombre, una palabra clave autorizada o un ejemplo del catálogo.
 * «Parafarmacia» no coincide con «Farmacias»: no se equiparan términos no definidos.
 * Son propuestas: nunca se aplican sin una elección explícita.
 */
export function sugerirPorNombre(catalogo: string, nombre: string): { sugerencias: Sugerencia[]; ambiguo: boolean } {
  const tokens = raices(nombre).filter((t) => t.length > 1 && !/^\d+$/.test(t));
  if (!tokens.length) return { sugerencias: [], ambiguo: false };
  const out = new Map<string, Sugerencia>();
  /** `corto`: se admiten términos breves («Bar», «Pub») solo si son el nombre de una actividad. */
  const contiene = (frase: string, corto = false) => {
    const f = raices(frase);
    if (!f.length || (f.length === 1 && ((!corto && f[0].length < 4) || f[0].length < 3 || GENERICOS.has(f[0])))) return false;
    for (let i = 0; i + f.length <= tokens.length; i++) if (f.every((x, k) => tokens[i + k] === x)) return true;
    return false;
  };
  for (const o of opcionesCatalogo(catalogo)) {
    const n = nodo(o);
    if (o.tipo === 'subgrupo' && o.requiereDescripcion) continue;
    if (o.tipo === 'ejemplo' && SIN_SUGERENCIA_EJEMPLOS.has(n.nombre)) continue;
    const terminos = o.tipo === 'ejemplo' ? [o.etiqueta] : [o.etiqueta, ...(n.claves ?? []).filter((c) => !(n.ejemplos ?? []).includes(c))];
    const t = terminos.find((x, i) => contiene(x, i === 0 && o.tipo === 'actividad'));
    if (t) out.set(o.clave, { ...o, motivo: `«${t}» en el nombre` });
  }
  // Si coinciden un subgrupo y una actividad o un ejemplo suyo, basta con lo más concreto.
  for (const s of [...out.values()]) {
    if (s.tipo !== 'subgrupo') continue;
    const masConcreto = [...out.values()].some((a) => (a.tipo === 'actividad' && TAXONOMIA_POR_ID[a.nodoId].padreId === s.nodoId) || (a.tipo === 'ejemplo' && a.nodoId === s.nodoId));
    if (masConcreto) out.delete(s.clave);
  }
  const sugerencias = [...out.values()].sort((a, b) => a.ruta.localeCompare(b.ruta, 'es'));
  return { sugerencias, ambiguo: sugerencias.length > 1 };
}
