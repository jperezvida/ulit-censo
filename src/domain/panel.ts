import type { BaseDatos } from './db';
import { kNC } from './db';
import { filasOficina } from './oficina';
import { indiceObservaciones, indiceOcupaciones } from './consultas';
import { normalizar } from './text';
import { VARIANTES_NOMBRE } from './catalogo2026';
import { rutaActividad } from './taxonomy';
import type { Campana, Id, LngLat, Municipio, Procedencia, Respuesta, TipoAmbito, VariableDigital } from './types';

/**
 * C1d-B · Datos del DASHBOARD. Todo se calcula sobre el modelo de ULIT Censo: ninguna cifra se
 * introduce a mano ni se inventa.
 *
 * Unidad de análisis: el ESTABLECIMIENTO OBSERVADO en una campaña. Puede tener local físico
 * identificado (filas de Oficina) o no (registros históricos con la correspondencia pendiente).
 * Registros censales, locales físicos, negocios, vacíos y correspondencias pendientes se cuentan
 * por separado: no son cantidades equivalentes.
 *
 * Las fuentes se mantienen separadas: clasificación 2026 confirmada, propuesta sin confirmar o
 * texto histórico; franquicia y digital con su origen (manual, heredado, importado) y estado.
 */

export const SECTORES = ['Comercio', 'Servicios', 'Hostelería y Restauración'] as const;
export type Sector = (typeof SECTORES)[number];
export type FuenteClasificacion = 'confirmada' | 'propuesta' | 'historica' | 'sin-clasificar';

export const UMBRAL_CALLE = 5;
export const MIN_CELDA = 3;
export const MIN_GRUPO = 10;

export interface UnidadPanel {
  clave: string;
  localId: Id | null;
  calleId: Id;
  calle: string;
  numero: number | null;
  sufijo?: string;
  /** Nombre del negocio (solo ocupados con negocio registrado). Nunca se inventa. */
  nombre?: string;
  /** Código postal SOLO si consta en el origen (registro importado). Nunca se deduce. */
  cp?: string;
  vacio: boolean;
  negocioId: Id | null;
  sector?: Sector;
  /** Primer y segundo nivel bajo el sector (grupo de comercio o subgrupo; actividad o subgrupo). */
  nivel2?: string;
  nivel3?: string;
  fuenteClasificacion: FuenteClasificacion;
  /** Respuesta de franquicia (solo ocupados). «pendiente» si no consta. */
  franquicia?: Respuesta;
  franquiciaOrigen?: 'manual' | 'heredado' | 'importado';
  digital: Partial<Record<VariableDigital, { respuesta: Respuesta; valor?: number }>>;
  digitalEstado: 'verificada' | 'borrador' | 'sin-datos' | 'no-aplica';
  metros?: number;
  fecha?: string;
  sinLocal: boolean;
  /** Procedencia del local (o del negocio si no hay local): simulado, importado, manual u OSM. */
  procedencia?: Procedencia;
  /**
   * Posición del establecimiento SOLO si el local tiene coordenadas verificadas (`coordVerificada`).
   * Las coordenadas interpoladas o simuladas nunca se usan para dibujar puntos.
   */
  coord?: LngLat;
}

export interface DatosCampana {
  campana: Campana;
  municipio: Municipio;
  unidades: UnidadPanel[];
  historica: boolean;
  /** Filas originales importadas (RegistroOrigen) de la campaña, excluidas las que una persona excluyó. */
  registrosCensales: number;
  /**
   * Registros censales (no excluidos) sin ningún establecimiento observado asociado: ni su local
   * (por la correspondencia registro–local) está entre los observados, ni hay una observación suya
   * sin local. Se calcula registro a registro, no restando: las observaciones manuales de la misma
   * campaña no tienen registro de origen y no deben descontarse.
   */
  registrosSinEstablecimiento: number;
  /** Registros censales (no excluidos) con al menos una incidencia de interpretación, y total de incidencias. */
  registrosConIncidencias: number;
  incidencias: number;
  /** Registros excluidos por una persona (se conservan, pero no cuentan). */
  registrosExcluidos: number;
  /** Locales de la campaña de referencia aún sin visitar (no cuentan como observados). */
  pendientesVisita: number;
  correspondencias: { confirmada: number; probable: number; dudosa: number; sinVinculo: number };
  callesAmbito: number;
  callesConRegistros: number;
}

const grupoCanonico = (t?: string): Sector | undefined => {
  if (!t) return undefined;
  const n = normalizar(t);
  for (const s of SECTORES) if (normalizar(s) === n || (VARIANTES_NOMBRE[s] ?? []).some((v) => normalizar(v) === n)) return s;
  if (n === 'hosteleria') return 'Hostelería y Restauración';
  return undefined;
};

/** Texto válido de una celda original del registro (literal, para la clasificación histórica). */
function textoOriginal(c?: { t: string; v?: unknown }): string | undefined {
  if (!c || c.t === 'vacio') return undefined;
  const s = String(c.v ?? '').trim();
  return s || undefined;
}

function cpOriginal(c?: { t: string; v?: unknown }): string | undefined {
  if (!c) return undefined;
  const s = c.t === 'numero' && Number.isInteger(c.v) ? String(c.v) : c.t === 'texto' ? String(c.v).trim() : '';
  return /^\d{5}$/.test(s) ? s : undefined;
}

export function ambitos(db: BaseDatos): (Municipio & { tipo: TipoAmbito; campanas: Campana[] })[] {
  return Object.values(db.municipios)
    .map((m) => ({ ...m, tipo: m.ambito ?? 'municipio', campanas: Object.values(db.campanas).filter((c) => c.municipioId === m.id).sort((a, b) => b.anio - a.anio || a.nombre.localeCompare(b.nombre)) }))
    .filter((m) => m.campanas.length)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export const TIPO_AMBITO_TXT: Record<TipoAmbito, string> = { municipio: 'Municipio', barrio: 'Barrio', 'eje-comercial': 'Eje comercial', 'zona-estudio': 'Zona de estudio', mercado: 'Mercado municipal' };

/** Unidades de la campaña, con todas sus fuentes separadas. */
export function datosCampana(db: BaseDatos, campanaId: Id): DatosCampana {
  const campana = db.campanas[campanaId];
  const municipio = db.municipios[campana.municipioId];
  const ix = { obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) };
  const filas = filasOficina(db, campanaId, ix);
  const imps = new Set(Object.values(db.importaciones).filter((i) => i.campanaId === campanaId && i.estado === 'confirmada').map((i) => i.id));
  const registros = Object.values(db.registros).filter((r) => imps.has(r.importacionId));
  const regPorId = new Map(registros.map((r) => [r.id, r]));
  // Local → registro de origen (correspondencia registro–local de esta campaña).
  const regPorLocal = new Map<Id, (typeof registros)[number]>();
  const corr = { confirmada: 0, probable: 0, dudosa: 0, sinVinculo: 0 };
  for (const v of Object.values(db.vinculos)) {
    if (v.origen.tipo !== 'registro') continue;
    const r = regPorId.get(v.origen.id);
    if (!r) continue;
    if (v.localId) regPorLocal.set(v.localId, r);
    if (v.confianza === 'confirmada') corr.confirmada++;
    else if (v.confianza === 'probable') corr.probable++;
    else if (v.confianza === 'dudosa') corr.dudosa++;
    else corr.sinVinculo++;
  }
  const historica = campana.tipo === 'historico-importado';

  const unidad = (base: { clave: string; localId: Id | null; calleId: Id; calle: string; numero: number | null; sufijo?: string; vacio: boolean; negocioId: Id | null; metros?: number; fecha?: string; sinLocal: boolean }, reg?: (typeof registros)[number]): UnidadPanel => {
    const neg = base.negocioId;
    const cla = neg ? db.clasificaciones[kNC(neg, campanaId)] : undefined;
    let sector: Sector | undefined;
    let nivel2: string | undefined;
    let nivel3: string | undefined;
    let fuenteClasificacion: FuenteClasificacion = 'sin-clasificar';
    if (cla) {
      const ruta = rutaNombres(cla.actividadId);
      sector = grupoCanonico(ruta[0]);
      nivel2 = ruta[1];
      nivel3 = ruta[2] ?? cla.descripcion;
      fuenteClasificacion = cla.confirmada ? 'confirmada' : 'propuesta';
    } else if (reg?.original && !base.vacio) {
      // Texto histórico (2025), literal: se lee el grupo, no se convierte al catálogo 2026.
      sector = grupoCanonico(textoOriginal(reg.original.grupoActividad));
      if (sector) {
        nivel2 = sector === 'Comercio' ? textoOriginal(reg.original.grupoComercio) : textoOriginal(reg.original.subgrupo);
        nivel3 = sector === 'Comercio' ? textoOriginal(reg.original.subgrupo) : textoOriginal(reg.original.actividad);
        fuenteClasificacion = 'historica';
      }
    }
    const fr = neg ? db.franquicias[kNC(neg, campanaId)] : undefined;
    const dig = neg ? db.digital[kNC(neg, campanaId)] : undefined;
    return {
      ...base, cp: cpOriginal(reg?.original?.cp), nombre: (!base.vacio && neg && db.negocios[neg]?.nombre?.trim()) || undefined,
      procedencia: (base.localId ? db.locales[base.localId]?.procedencia : undefined) ?? (neg ? db.negocios[neg]?.procedencia : undefined) ?? (reg ? 'importado' : undefined),
      coord: base.localId && db.locales[base.localId]?.coordVerificada ? db.locales[base.localId]?.coord : undefined, sector, nivel2, nivel3, fuenteClasificacion,
      franquicia: base.vacio ? undefined : fr?.respuesta ?? 'pendiente', franquiciaOrigen: fr?.origen,
      digital: dig ? Object.fromEntries(Object.entries(dig.datos).map(([k, d]) => [k, { respuesta: d!.respuesta, valor: d!.valor }])) : {},
      digitalEstado: base.vacio ? 'no-aplica' : dig ? dig.estado : 'sin-datos',
    };
  };

  const unidades: UnidadPanel[] = [];
  for (const f of filas) {
    if (f.situacion !== 'registrado') continue;
    unidades.push(unidad({ clave: f.localId, localId: f.localId, calleId: f.calleId, calle: f.calle, numero: f.numero, sufijo: f.sufijo, vacio: f.vacio, negocioId: f.negocioId, metros: f.metros, fecha: f.obs?.fecha, sinLocal: false }, regPorLocal.get(f.localId)));
  }
  // Observaciones de la campaña SIN local identificado (correspondencia pendiente).
  for (const o of Object.values(db.observaciones)) {
    if (o.campanaId !== campanaId || o.localId) continue;
    // C1c crea observación y registro con el mismo sufijo («obs-<importación>-<fila>» / «reg-…»).
    const reg = regPorId.get(o.id.replace(/^obs-/, 'reg-'));
    unidades.push(unidad({ clave: o.id, localId: null, calleId: o.calleId, calle: db.calles[o.calleId]?.nombre ?? '¿?', numero: o.datos.numero, sufijo: o.datos.sufijo, vacio: o.datos.vacio, negocioId: o.datos.negocioId ?? null, metros: o.datos.metrosFachada, fecha: o.fecha, sinLocal: true }, reg));
  }
  // Registros con establecimiento observado: por su local o por su observación sin local.
  const localesObservados = new Set(unidades.map((u) => u.localId).filter((l): l is Id => !!l));
  const conEstablecimiento = new Set<Id>();
  for (const v of Object.values(db.vinculos)) {
    if (v.origen.tipo === 'registro' && regPorId.has(v.origen.id) && v.localId && localesObservados.has(v.localId)) conEstablecimiento.add(v.origen.id);
  }
  for (const u of unidades) {
    const reg = u.sinLocal ? regPorId.get(u.clave.replace(/^obs-/, 'reg-')) : undefined;
    if (reg) conEstablecimiento.add(reg.id);
  }
  const conRegistros = new Set(unidades.map((u) => u.calleId));
  return {
    campana, municipio, unidades, historica,
    registrosCensales: registros.filter((r) => !r.exclusion).length,
    registrosSinEstablecimiento: registros.filter((r) => !r.exclusion && !conEstablecimiento.has(r.id)).length,
    registrosConIncidencias: registros.filter((r) => !r.exclusion && r.interpretacion?.incidencias.length).length,
    incidencias: registros.reduce((a, r) => a + (r.exclusion ? 0 : r.interpretacion?.incidencias.length ?? 0), 0),
    registrosExcluidos: registros.filter((r) => r.exclusion).length,
    pendientesVisita: filas.filter((f) => f.situacion === 'pendiente-visita').length,
    correspondencias: corr,
    callesAmbito: new Set([...campana.ambitoCalleIds, ...conRegistros]).size,
    callesConRegistros: conRegistros.size,
  };
}

const rutaCache = new Map<Id, string[]>();
function rutaNombres(nodoId: Id): string[] {
  let r = rutaCache.get(nodoId);
  if (!r) rutaCache.set(nodoId, (r = rutaActividad(nodoId).map((n) => n.nombre)));
  return r;
}

// ───────────── Filtros globales ─────────────

export interface FiltrosPanel {
  cp?: string; // '__sin__' = sin CP en el origen
  sector?: Sector;
  franquicia?: 'si' | 'no' | 'pendiente';
  calleId?: Id;
}

export function filtrar(us: UnidadPanel[], f: FiltrosPanel): UnidadPanel[] {
  return us.filter((u) =>
    (!f.cp || (f.cp === '__sin__' ? !u.cp : u.cp === f.cp))
    && (!f.sector || u.sector === f.sector)
    && (!f.franquicia || (u.franquicia !== undefined && (f.franquicia === 'pendiente' ? u.franquicia !== 'si' && u.franquicia !== 'no' : u.franquicia === f.franquicia)))
    && (!f.calleId || u.calleId === f.calleId),
  );
}

// ───────────── Agregaciones ─────────────

export interface Parte { clave: string; etiqueta: string; n: number }
export interface Proporcion { n: number; den: number }
export const pct = (p: Proporcion) => (p.den ? p.n / p.den : null);

export function resumen(us: UnidadPanel[]) {
  const ocupados = us.filter((u) => !u.vacio);
  const vacios = us.filter((u) => u.vacio);
  const fechas = us.map((u) => u.fecha).filter(Boolean).sort() as string[];
  return {
    establecimientos: us.length,
    locales: new Set(us.filter((u) => u.localId).map((u) => u.localId)).size,
    negocios: new Set(ocupados.filter((u) => u.negocioId).map((u) => u.negocioId)).size,
    ocupados: ocupados.length,
    vacios: vacios.length,
    sinLocal: us.filter((u) => u.sinLocal).length,
    ocupacion: { n: ocupados.length, den: us.length } as Proporcion,
    franquicias: { n: ocupados.filter((u) => u.franquicia === 'si').length, den: ocupados.filter((u) => u.franquicia === 'si' || u.franquicia === 'no').length } as Proporcion,
    franquiciasPendientes: ocupados.filter((u) => u.franquicia !== 'si' && u.franquicia !== 'no').length,
    fechas: fechas.length ? { desde: fechas[0].slice(0, 10), hasta: fechas[fechas.length - 1].slice(0, 10), n: fechas.length } : undefined,
  };
}

export function distribucion(us: UnidadPanel[], clave: (u: UnidadPanel) => string | undefined, sinValor = 'Sin dato'): Parte[] {
  const m = new Map<string, number>();
  for (const u of us) {
    const k = clave(u) ?? sinValor;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([k, n]) => ({ clave: k, etiqueta: k, n })).sort((a, b) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, 'es'));
}

export interface FilaCalle { calleId: Id; calle: string; locales: number; ocupados: number; vacios: number; ocupacion: number; vacancia: number }

/**
 * Calles por ocupados (o por vacíos). Solo entran calles con al menos `umbral` establecimientos
 * observados: con menos, un porcentaje no es fiable. Devuelve también cuántas quedan fuera.
 */
export function topCalles(us: UnidadPanel[], criterio: 'ocupados' | 'vacios', umbral = UMBRAL_CALLE, limite = 10) {
  const m = new Map<Id, FilaCalle>();
  for (const u of us) {
    const f = m.get(u.calleId) ?? { calleId: u.calleId, calle: u.calle, locales: 0, ocupados: 0, vacios: 0, ocupacion: 0, vacancia: 0 };
    f.locales++;
    if (u.vacio) f.vacios++;
    else f.ocupados++;
    m.set(u.calleId, f);
  }
  const todas = [...m.values()].map((f) => ({ ...f, ocupacion: f.ocupados / f.locales, vacancia: f.vacios / f.locales }));
  const aptas = todas.filter((f) => f.locales >= umbral);
  const orden = criterio === 'ocupados' ? (a: FilaCalle, b: FilaCalle) => b.ocupados - a.ocupados || b.ocupacion - a.ocupacion : (a: FilaCalle, b: FilaCalle) => b.vacios - a.vacios || b.vacancia - a.vacancia;
  return { filas: aptas.sort(orden).slice(0, limite), consideradas: aptas.length, total: todas.length, umbral };
}

export const VARIABLES_PRESENCIA: { v: VariableDigital; t: string }[] = [
  { v: 'web', t: 'Página web' }, { v: 'googleBusiness', t: 'Google Business' }, { v: 'ventaOnline', t: 'Venta online' },
  { v: 'instagram', t: 'Instagram' }, { v: 'facebook', t: 'Facebook' }, { v: 'twitter', t: 'Twitter / X' },
];
export const RESPUESTAS: { r: Respuesta; t: string }[] = [
  { r: 'si', t: 'Sí' }, { r: 'no', t: 'No' }, { r: 'sin-info', t: 'Sin información' }, { r: 'na', t: 'No aplicable' }, { r: 'pendiente', t: 'Pendiente' },
];

/** Respuestas de una variable entre los establecimientos OCUPADOS (denominador: todos los ocupados). */
export function respuestas(us: UnidadPanel[], v: VariableDigital): Record<Respuesta, number> & { den: number } {
  const r = { si: 0, no: 0, 'sin-info': 0, na: 0, pendiente: 0, den: 0 };
  for (const u of us) {
    if (u.vacio) continue;
    r.den++;
    r[u.digital[v]?.respuesta ?? 'pendiente']++;
  }
  return r;
}

/** Adopción: Sí entre las respuestas Sí/No (excluye pendiente, sin información y no aplicable). */
export function adopcion(us: UnidadPanel[], v: VariableDigital): Proporcion {
  const r = respuestas(us, v);
  return { n: r.si, den: r.si + r.no };
}

/** Mapa de calor calle × variable: % de Sí entre Sí/No, solo con al menos `minN` respuestas. */
export function matrizCalor(us: UnidadPanel[], variables: VariableDigital[] = VARIABLES_PRESENCIA.map((x) => x.v), minN = MIN_CELDA, limite = 20) {
  const calles = new Map<Id, { calle: string; us: UnidadPanel[] }>();
  for (const u of us) if (!u.vacio) calles.set(u.calleId, { calle: u.calle, us: [...(calles.get(u.calleId)?.us ?? []), u] });
  return [...calles.entries()]
    .map(([calleId, c]) => ({ calleId, calle: c.calle, n: c.us.length, celdas: variables.map((v) => { const p = adopcion(c.us, v); return p.den >= minN ? { ...p, valor: p.n / p.den } : { ...p, valor: null }; }) }))
    .filter((f) => f.celdas.some((c) => c.valor !== null))
    .sort((a, b) => b.n - a.n)
    .slice(0, limite);
}

export const cuantil = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};

export function estadisticos(xs: number[]) {
  if (!xs.length) return null;
  return { n: xs.length, media: xs.reduce((a, b) => a + b, 0) / xs.length, mediana: cuantil(xs, 0.5)!, p25: cuantil(xs, 0.25)!, p75: cuantil(xs, 0.75)!, min: Math.min(...xs), max: Math.max(...xs) };
}

export function histograma(xs: number[], cortes: number[], etiquetas?: string[]): Parte[] {
  return cortes.slice(0, -1).map((c, i) => ({ clave: String(i), etiqueta: etiquetas?.[i] ?? `${c}–${cortes[i + 1]}`, n: xs.filter((x) => x >= c && (i === cortes.length - 2 ? x <= cortes[i + 1] : x < cortes[i + 1])).length }));
}

/** Valores numéricos de una variable (solo con respuesta Sí y valor registrado). */
export const valores = (us: UnidadPanel[], v: VariableDigital) => us.filter((u) => !u.vacio && u.digital[v]?.respuesta === 'si' && typeof u.digital[v]?.valor === 'number').map((u) => u.digital[v]!.valor!);

/**
 * Índice de presencia digital (0–6): número de canales con Sí entre web, Google, venta online,
 * Instagram, Facebook y Twitter / X. Solo se calcula si los seis tienen respuesta Sí o No.
 */
export function indicePresencia(u: UnidadPanel): number | null {
  if (u.vacio) return null;
  let n = 0;
  for (const { v } of VARIABLES_PRESENCIA) {
    const r = u.digital[v]?.respuesta;
    if (r !== 'si' && r !== 'no') return null;
    if (r === 'si') n++;
  }
  return n;
}

/** Comparación de un indicador por grupos; un grupo con menos de `min` casos se marca como insuficiente. */
export function compararGrupos(us: UnidadPanel[], grupo: (u: UnidadPanel) => string | undefined, valor: (u: UnidadPanel) => number | null, min = MIN_GRUPO) {
  const m = new Map<string, number[]>();
  for (const u of us) {
    const g = grupo(u);
    const v = valor(u);
    if (!g || v === null) continue;
    m.set(g, [...(m.get(g) ?? []), v]);
  }
  return [...m].map(([g, xs]) => ({ grupo: g, n: xs.length, media: xs.length >= min ? xs.reduce((a, b) => a + b, 0) / xs.length : null, suficiente: xs.length >= min })).sort((a, b) => b.n - a.n);
}

// ───────────── Rankings, concentración y cruces (rediseño del dashboard) ─────────────

export type CriterioCalle = 'ocupados' | 'vacios' | Sector;
export const SIN_CLASIFICAR = 'Sin clasificar';

export interface FilaRanking {
  calleId: Id;
  calle: string;
  /** Establecimientos observados en la calle (con los filtros aplicados). */
  observados: number;
  ocupados: number;
  vacios: number;
  /** Valor del criterio: ocupados, vacíos o establecimientos del sector. */
  n: number;
  /** Proporción del criterio sobre los observados de la calle; null si la calle no alcanza el umbral. */
  prop: number | null;
  /** Composición de los observados de la calle: cada sector, sin clasificar y vacíos. */
  composicion: Record<Sector | typeof SIN_CLASIFICAR | 'Vacíos', number>;
}

/**
 * Ranking de calles por un criterio. Ocupados y vacíos: solo calles con al menos `umbral`
 * observados (con menos, un porcentaje no es fiable). Sectores: recuento absoluto de todas las
 * calles con presencia; su proporción solo se da si la calle alcanza el umbral.
 */
export function rankingCalles(us: UnidadPanel[], criterio: CriterioCalle, umbral = UMBRAL_CALLE, limite = 10) {
  const m = new Map<Id, FilaRanking>();
  for (const u of us) {
    const f = m.get(u.calleId) ?? {
      calleId: u.calleId, calle: u.calle, observados: 0, ocupados: 0, vacios: 0, n: 0, prop: null,
      composicion: { Comercio: 0, Servicios: 0, 'Hostelería y Restauración': 0, [SIN_CLASIFICAR]: 0, 'Vacíos': 0 },
    };
    f.observados++;
    if (u.vacio) {
      f.vacios++;
      f.composicion['Vacíos']++;
    } else {
      f.ocupados++;
      f.composicion[u.sector ?? SIN_CLASIFICAR]++;
    }
    m.set(u.calleId, f);
  }
  const valor = (f: FilaRanking) => (criterio === 'ocupados' ? f.ocupados : criterio === 'vacios' ? f.vacios : f.composicion[criterio]);
  const porSector = criterio !== 'ocupados' && criterio !== 'vacios';
  const todas = [...m.values()].map((f) => ({ ...f, n: valor(f), prop: f.observados >= umbral ? valor(f) / f.observados : null }));
  const aptas = porSector ? todas.filter((f) => f.n > 0) : todas.filter((f) => f.observados >= umbral);
  aptas.sort((a, b) => b.n - a.n || (b.prop ?? 0) - (a.prop ?? 0) || a.calle.localeCompare(b.calle, 'es'));
  return { filas: aptas.slice(0, limite), consideradas: aptas.length, total: todas.length, umbral, porSector };
}

/** Concentración: qué parte del total reúnen las `k` primeras partes, y cuántas partes hay con valor. */
export function concentracion(partes: Parte[], k = 5) {
  const total = partes.reduce((a, p) => a + p.n, 0);
  const orden = [...partes].sort((a, b) => b.n - a.n);
  const top = orden.slice(0, k).reduce((a, p) => a + p.n, 0);
  return { k: Math.min(k, orden.filter((p) => p.n > 0).length), top, total, prop: total ? top / total : null, conValor: orden.filter((p) => p.n > 0).length };
}

/**
 * Perfil por grupo (sector, franquicia, CP…) entre los OCUPADOS: tamaño, franquicia y adopción de
 * cada canal, siempre como proporción con su denominador (Sí entre Sí/No).
 */
export function perfilGrupos(us: UnidadPanel[], grupo: (u: UnidadPanel) => string | undefined, variables: VariableDigital[] = VARIABLES_PRESENCIA.map((x) => x.v)) {
  const m = new Map<string, UnidadPanel[]>();
  for (const u of us) {
    if (u.vacio) continue;
    const g = grupo(u);
    if (!g) continue;
    m.set(g, [...(m.get(g) ?? []), u]);
  }
  return [...m].map(([g, xs]) => ({
    grupo: g,
    n: xs.length,
    franquicia: { n: xs.filter((u) => u.franquicia === 'si').length, den: xs.filter((u) => u.franquicia === 'si' || u.franquicia === 'no').length } as Proporcion,
    adopcion: Object.fromEntries(variables.map((v) => [v, adopcion(xs, v)])) as Record<VariableDigital, Proporcion>,
  })).sort((a, b) => b.n - a.n || a.grupo.localeCompare(b.grupo, 'es'));
}

/** Calles (con al menos `umbral` observados) agrupadas por su tasa de vacío. */
export function bandasVacancia(us: UnidadPanel[], umbral = UMBRAL_CALLE) {
  const r = rankingCalles(us, 'vacios', umbral, Infinity);
  const tasas = r.filas.map((f) => f.vacios / f.observados);
  const bandas = [
    { clave: '0', etiqueta: 'Sin vacíos', desde: 0, hasta: 0 },
    { clave: '1', etiqueta: 'Hasta 20 %', desde: 0, hasta: 0.2 },
    { clave: '2', etiqueta: '20–40 %', desde: 0.2, hasta: 0.4 },
    { clave: '3', etiqueta: '40–60 %', desde: 0.4, hasta: 0.6 },
    { clave: '4', etiqueta: 'Más del 60 %', desde: 0.6, hasta: 1 },
  ];
  return {
    partes: bandas.map((b, i) => ({ clave: b.clave, etiqueta: b.etiqueta, n: tasas.filter((t) => (i === 0 ? t === 0 : t > b.desde && t <= b.hasta)).length })),
    consideradas: r.consideradas, total: r.total, conVacios: tasas.filter((t) => t > 0).length,
  };
}

// ───────────── Origen real de los datos (avisos) ─────────────

/**
 * Origen real de los datos de una campaña, para redactar los avisos: el TIPO de campaña (histórico
 * importado o campaña) es distinto del ORIGEN de sus clasificaciones, franquicias y revisiones
 * digitales. Un histórico puede tener clasificaciones confirmadas en el modelo; y en una demostración,
 * «confirmada» o «verificada» son estados ficticios, no comprobaciones reales de 2026.
 */
export function origenDatos(d: DatosCampana) {
  const ocup = d.unidades.filter((u) => !u.vacio);
  const clasificacion = { confirmada: 0, propuesta: 0, historica: 0, 'sin-clasificar': 0 } as Record<FuenteClasificacion, number>;
  const franquicia = { manual: 0, heredado: 0, importado: 0, ninguno: 0 };
  const digital = { verificada: 0, borrador: 0, 'sin-datos': 0 };
  for (const u of ocup) {
    clasificacion[u.fuenteClasificacion]++;
    franquicia[u.franquiciaOrigen ?? 'ninguno']++;
    if (u.digitalEstado !== 'no-aplica') digital[u.digitalEstado]++;
  }
  return {
    historica: d.historica,
    anio: d.campana.anio,
    /** Datos de demostración: escenario ficticio o locales/negocios simulados. */
    demostracion: !!d.municipio.escenarioDemo || d.unidades.some((u) => u.procedencia === 'simulado'),
    ocupados: ocup.length,
    clasificacion,
    franquicia,
    digital,
  };
}
export type OrigenDatos = ReturnType<typeof origenDatos>;


// ───────────── Escalas del mapa ─────────────

/**
 * Cortes por cuantiles para una escala secuencial ajustada a los datos: con valores concentrados
 * (p. ej., ocupación del 70 al 100 %) una escala fija 0–100 % pinta todo igual. Devuelve los límites
 * superiores de cada clase (sin duplicados), de menor a mayor; como mucho `k` clases.
 */
export function cortesCuantiles(valores: number[], k = 5): number[] {
  const xs = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return [];
  const cortes: number[] = [];
  for (let i = 1; i <= k; i++) {
    const v = cuantil(xs, i / k)!;
    if (!cortes.length || v > cortes[cortes.length - 1] + 1e-9) cortes.push(v);
  }
  return cortes;
}

/** Clase (0…n-1) de un valor según los cortes de `cortesCuantiles`. */
export const claseDe = (v: number, cortes: number[]) => {
  const i = cortes.findIndex((c) => v <= c + 1e-9);
  return i === -1 ? cortes.length - 1 : i;
};
