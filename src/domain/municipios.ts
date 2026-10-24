import { ErrorDominio, type BaseDatos } from './db';
import { claveCalle } from './text';
import { callesVigentes } from './callejeros';
import type { Campana, ConfigTerritorialMunicipio, Id, Municipio, TipoCampana } from './types';
import type { ReglaTerritorial } from './territorio';

/**
 * G2 · MUNICIPIOS y CAMPAÑAS como datos.
 *
 * - Un municipio se da de alta con su identificación (nombre, provincia, código INE si se conoce) y su
 *   configuración territorial (Distrito, Zona, CP y aceras). Todo se guarda en la base del espacio:
 *   ningún municipio nuevo exige cambiar el código.
 * - Un municipio dado de alta NO tiene callejero: nunca se inventa uno. Mientras no lo tenga, la
 *   conciliación territorial de lo que se incorpore queda pendiente (los registros se conservan sin
 *   vínculo). G3 gestionará los callejeros y sus fuentes.
 * - Cada municipio puede tener varias campañas, históricas u operativas, de años distintos o del mismo
 *   año (con nombres distintos). Una campaña histórica se crea vacía y espera su incorporación.
 * - Separación: cada entidad pertenece a UN municipio y solo puede relacionarse con entidades del mismo
 *   (`verificarSeparacionMunicipios`), lo que se comprueba antes de cada escritura del espacio.
 */

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'x';
const norm = (s: string) => claveCalle(s.trim());

// ───────────── Configuración territorial ─────────────

export const USOS_TERRITORIALES: Record<ReglaTerritorial['uso'], string> = {
  'no-se-usa': 'No se usa en este municipio',
  fijo: 'Un único valor para todo el municipio',
  'por-direccion': 'Depende de la dirección',
  'tabla-verificada': 'Según una tabla territorial verificada',
};

/** Configuración de partida de un municipio nuevo: nada se completa automáticamente. */
export const TERRITORIO_INICIAL: ConfigTerritorialMunicipio = {
  version: 1,
  distrito: { uso: 'no-se-usa', obligatorio: false },
  zona: { uso: 'no-se-usa', obligatorio: false },
  cp: { uso: 'por-direccion', obligatorio: false },
  aceras: 'ambas',
};

function validarTerritorio(t: ConfigTerritorialMunicipio): string[] {
  const e: string[] = [];
  for (const [campo, r] of [['Distrito', t.distrito], ['Zona', t.zona], ['CP', t.cp]] as const) {
    if (!USOS_TERRITORIALES[r.uso]) e.push(`${campo}: uso no válido.`);
    if (r.uso === 'fijo' && !r.valorFijo?.trim()) e.push(`${campo}: indique el valor único.`);
    if (r.uso === 'no-se-usa' && r.obligatorio) e.push(`${campo}: un campo que no se usa no puede ser obligatorio.`);
  }
  if (t.cp.uso === 'fijo' && t.cp.valorFijo && !/^\d{5}$/.test(t.cp.valorFijo.trim())) e.push('CP: el valor único debe tener 5 cifras.');
  return e;
}

// ───────────── Municipios ─────────────

export interface DatosMunicipio {
  nombre: string;
  provincia: string;
  ine?: string;
  territorio: ConfigTerritorialMunicipio;
}

export interface OpcionesAlta {
  /** Prefijo del espacio (ensayo/real): los identificadores del municipio y de sus campañas lo llevan. */
  prefijo: string;
  porId: Id;
  ahora?: string;
}

/** Problemas de los datos de un municipio nuevo (vacío = se puede dar de alta). */
export function validarMunicipio(db: BaseDatos, d: DatosMunicipio): string[] {
  const e: string[] = [];
  if (d.nombre.trim().length < 2) e.push('Indique el nombre del municipio.');
  if (d.provincia.trim().length < 2) e.push('Indique la provincia.');
  const ine = d.ine?.trim();
  if (ine && !/^\d{5}$/.test(ine)) e.push('El código INE tiene 5 cifras (p. ej. 47186). Déjelo vacío si no lo conoce.');
  for (const m of Object.values(db.municipios)) {
    if (norm(m.nombre) === norm(d.nombre) && norm(m.provincia) === norm(d.provincia)) e.push(`Ya existe el municipio «${m.nombre}» (${m.provincia}) en este espacio.`);
    else if (ine && m.ine === ine) e.push(`El código INE ${ine} ya es de «${m.nombre}».`);
  }
  return [...e, ...validarTerritorio(d.territorio)];
}

/** Da de alta un municipio SIN callejero (no se inventa ninguno). Devuelve una base nueva; `db` no cambia. */
export function altaMunicipio(db: BaseDatos, d: DatosMunicipio, o: OpcionesAlta): { db: BaseDatos; municipioId: Id } {
  const errores = validarMunicipio(db, d);
  if (errores.length) throw new ErrorDominio('regla', errores[0], errores);
  if (!db.personas[o.porId]) throw new ErrorDominio('regla', 'El alta debe hacerla una persona registrada.');
  const ine = d.ine?.trim() || undefined;
  const raiz = `${o.prefijo}-mun-${slug(d.nombre)}${ine ? `-${ine}` : ''}`;
  let id = raiz;
  for (let n = 2; db.municipios[id]; n++) id = `${raiz}-${n}`;
  const m: Municipio = {
    id, nombre: d.nombre.trim(), provincia: d.provincia.trim(), ...(ine ? { ine } : {}),
    fuenteCallejero: 'sin-geometria',
    territorio: { ...d.territorio, version: 1, ...(d.territorio.cp.valorFijo ? { cp: { ...d.territorio.cp, valorFijo: d.territorio.cp.valorFijo.trim() } } : {}) },
    callejero: { estado: 'sin-callejero' },
    alta: { porId: o.porId, fecha: o.ahora ?? new Date().toISOString() },
  };
  return { db: { ...db, municipios: { ...db.municipios, [id]: m } }, municipioId: id };
}

export interface ResumenCallejero {
  disponible: boolean;
  calles: number;
  texto: string;
}

/** Estado del callejero de un municipio, para mostrarlo y para decidir si se puede conciliar. */
export function callejeroDe(db: BaseDatos, municipioId: Id): ResumenCallejero {
  const m = db.municipios[municipioId];
  // G3: solo las vías vigentes (un alta manual cuenta una vez validada).
  const calles = callesVigentes(db, municipioId).length;
  if (!calles) return { disponible: false, calles: 0, texto: 'Sin callejero todavía: la conciliación territorial quedará pendiente (los registros se conservan sin vínculo con calles ni locales).' };
  const detalle = m?.callejero?.detalle ?? db.meta?.detalleCallejero;
  return { disponible: true, calles, texto: detalle ?? `${calles.toLocaleString('es-ES')} calles` };
}

// ───────────── Campañas ─────────────

export type ClaseCampana = 'historica' | 'operativa';
export const claseCampana = (c: Campana): ClaseCampana => (c.tipo === 'historico-importado' ? 'historica' : 'operativa');
export const CLASE_CAMPANA_TXT: Record<ClaseCampana, { nombre: string; ayuda: string }> = {
  historica: { nombre: 'Histórica', ayuda: 'Un censo ya realizado que se incorpora desde un Excel.' },
  operativa: { nombre: 'Operativa', ayuda: 'Un censo nuevo que se planifica y se trabaja en campo.' },
};
export type TipoOperativa = Exclude<TipoCampana, 'historico-importado'>;
export const TIPO_OPERATIVA_TXT: Record<TipoOperativa, string> = { nuevo: 'Censo nuevo', actualizacion: 'Actualización', mixto: 'Actualización y ampliación' };

export interface DatosCampana {
  municipioId: Id;
  anio: number;
  nombre: string;
  clase: ClaseCampana;
  tipoOperativa?: TipoOperativa;
  inicio?: string;
  fin?: string;
}

/** Problemas de los datos de una campaña nueva. `anioActual` decide qué años pueden ser históricos. */
export function validarCampana(db: BaseDatos, d: DatosCampana, anioActual = new Date().getFullYear()): string[] {
  const e: string[] = [];
  const m = db.municipios[d.municipioId];
  if (!m) return ['Elija el municipio.'];
  if (!Number.isInteger(d.anio) || d.anio < 1950 || d.anio > anioActual + 5) e.push(`Indique un año entre 1950 y ${anioActual + 5}.`);
  if (d.nombre.trim().length < 3) e.push('Indique el nombre de la campaña (al menos 3 caracteres).');
  const mismas = Object.values(db.campanas).filter((c) => c.municipioId === d.municipioId && c.anio === d.anio);
  if (mismas.some((c) => norm(c.nombre) === norm(d.nombre))) e.push(`Ya hay una campaña «${d.nombre.trim()}» de ${d.anio} en ${m.nombre}: use otro nombre.`);
  if (d.clase === 'historica') {
    if (d.anio >= anioActual) e.push(`Una campaña histórica es de un año anterior a ${anioActual}.`);
    if (mismas.some((c) => claseCampana(c) === 'operativa')) e.push(`${d.anio} tiene una campaña operativa en ${m.nombre}: no se incorporan históricos sobre una campaña en curso.`);
  }
  if (d.inicio && d.fin && d.fin < d.inicio) e.push('El final del periodo es anterior a su inicio.');
  return e;
}

/** Crea una campaña (vacía). Devuelve una base nueva; `db` no cambia. */
export function crearCampana(db: BaseDatos, d: DatosCampana, o: OpcionesAlta & { anioActual?: number }): { db: BaseDatos; campanaId: Id } {
  const errores = validarCampana(db, d, o.anioActual);
  if (errores.length) throw new ErrorDominio('regla', errores[0], errores);
  if (!db.personas[o.porId]) throw new ErrorDominio('regla', 'La campaña debe crearla una persona registrada.');
  const m = db.municipios[d.municipioId];
  const munSlug = m.id.startsWith(`${o.prefijo}-mun-`) ? m.id.slice(`${o.prefijo}-mun-`.length) : slug(m.nombre);
  const raiz = `${o.prefijo}-camp-${munSlug}-${d.anio}-${slug(d.nombre)}`;
  let id = raiz;
  for (let n = 2; db.campanas[id]; n++) id = `${raiz}-${n}`;
  const historica = d.clase === 'historica';
  const c: Campana = {
    id, municipioId: m.id, anio: d.anio, nombre: d.nombre.trim(),
    tipo: historica ? 'historico-importado' : d.tipoOperativa ?? 'actualizacion',
    periodo: { inicio: d.inicio || `${d.anio}-01-01`, ...(d.fin || historica ? { fin: d.fin || `${d.anio}-12-31` } : {}) },
    ambitoCalleIds: [], ampliacionCalleIds: [],
    estados: historica
      ? { planificacion: 'no-aplica', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' }
      : { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
    procedencia: 'manual',
    creada: { porId: o.porId, fecha: o.ahora ?? new Date().toISOString() },
  };
  return { db: { ...db, campanas: { ...db.campanas, [id]: c } }, campanaId: id };
}

/** Lo que contiene una campaña (para mostrarlo y para saber si puede recibir una incorporación). */
export function contenidoCampana(db: BaseDatos, campanaId: Id) {
  const importaciones = Object.values(db.importaciones).filter((i) => i.campanaId === campanaId && i.estado === 'confirmada');
  const imps = new Set(importaciones.map((i) => i.id));
  const registros = Object.values(db.registros).filter((r) => imps.has(r.importacionId)).length;
  const observaciones = Object.values(db.observaciones).filter((o) => o.campanaId === campanaId).length;
  const itinerarios = Object.values(db.itinerarios).filter((i) => i.campanaId === campanaId).length;
  return { importaciones, registros, observaciones, itinerarios, vacia: !importaciones.length && !observaciones && !itinerarios };
}

/**
 * ¿Puede esta campaña recibir la incorporación de un censo? Solo una campaña HISTÓRICA del mismo
 * municipio y año, todavía vacía. Devuelve el motivo si no puede (null = sí).
 */
export function motivoNoDestino(db: BaseDatos, campanaId: Id, municipioId: Id, anio: number): string | null {
  const c = db.campanas[campanaId];
  if (!c) return `La campaña «${campanaId}» no existe.`;
  if (c.municipioId !== municipioId) return `La campaña «${c.nombre}» es de otro municipio: no se mezclan datos de municipios distintos.`;
  if (claseCampana(c) !== 'historica') return `«${c.nombre}» es una campaña operativa: un censo ya realizado se incorpora en una campaña histórica.`;
  if (c.anio !== anio) return `La campaña «${c.nombre}» es de ${c.anio}, no de ${anio}.`;
  const cont = contenidoCampana(db, campanaId);
  if (!cont.vacia) return `La campaña «${c.nombre}» ya tiene datos (${cont.importaciones.length} incorporación(es)): cree otra campaña para este archivo.`;
  return null;
}

// ───────────── Separación entre municipios ─────────────

/**
 * Comprueba que ninguna entidad relaciona datos de municipios distintos (y que todo municipio
 * referenciado existe). Devuelve los problemas encontrados (vacío = separación correcta).
 */
export function verificarSeparacionMunicipios(db: BaseDatos): string[] {
  const e: string[] = [];
  const munDe = {
    calle: (id: Id) => db.calles[id]?.municipioId,
    campana: (id: Id) => db.campanas[id]?.municipioId,
    local: (id: Id) => db.locales[id]?.municipioId,
  };
  const existe = (que: string, id: Id, m?: Id) => { if (m !== undefined && !db.municipios[m]) e.push(`${que} «${id}»: municipio inexistente («${m}»).`); };
  for (const c of Object.values(db.calles)) existe('Calle', c.id, c.municipioId);
  for (const c of Object.values(db.campanas)) existe('Campaña', c.id, c.municipioId);
  for (const l of Object.values(db.locales)) {
    existe('Local', l.id, l.municipioId);
    for (const d of l.direcciones) {
      const mc = munDe.calle(d.calleId);
      if (mc && mc !== l.municipioId) e.push(`Local «${l.id}» (${l.municipioId}) con una dirección en una calle de otro municipio («${d.calleId}», ${mc}).`);
      const mk = d.desdeCampanaId ? munDe.campana(d.desdeCampanaId) : undefined;
      if (mk && mk !== l.municipioId) e.push(`Local «${l.id}» con una dirección de una campaña de otro municipio («${d.desdeCampanaId}»).`);
    }
  }
  for (const o of Object.values(db.observaciones)) {
    const mk = munDe.campana(o.campanaId);
    const mc = munDe.calle(o.calleId);
    const ml = o.localId ? munDe.local(o.localId) : undefined;
    if (mk && mc && mk !== mc) e.push(`Observación «${o.id}»: campaña y calle de municipios distintos.`);
    if (mk && ml && mk !== ml) e.push(`Observación «${o.id}»: campaña y local de municipios distintos.`);
  }
  for (const o of Object.values(db.ocupaciones)) {
    const ml = munDe.local(o.localId);
    for (const k of [o.desdeCampanaId, o.hastaCampanaId]) {
      const mk = k ? munDe.campana(k) : undefined;
      if (ml && mk && ml !== mk) e.push(`Ocupación «${o.id}»: local y campaña de municipios distintos.`);
    }
  }
  for (const i of Object.values(db.importaciones)) {
    existe('Importación', i.id, i.municipioId);
    const mk = i.campanaId ? munDe.campana(i.campanaId) : undefined;
    if (mk && mk !== i.municipioId) e.push(`Importación «${i.id}» en una campaña de otro municipio («${i.campanaId}»).`);
  }
  for (const v of Object.values(db.vinculos)) {
    if (v.origen.tipo !== 'registro') continue;
    const r = db.registros[v.origen.id];
    const mi = r ? db.importaciones[r.importacionId]?.municipioId : undefined;
    for (const lid of [v.localId, ...(v.candidatos ?? []).map((c) => c.localId)]) {
      const ml = lid ? munDe.local(lid) : undefined;
      if (mi && ml && mi !== ml) e.push(`Vínculo «${v.id}»: registro de un municipio y local de otro («${lid}»).`);
    }
  }
  for (const it of Object.values(db.itinerarios)) {
    const mk = munDe.campana(it.campanaId);
    for (const t of it.tramos) {
      const mc = munDe.calle(t.calleId);
      if (mk && mc && mk !== mc) e.push(`Itinerario «${it.codigo}»: calle de otro municipio («${t.calleId}»).`);
    }
  }
  for (const c of Object.values(db.campanas)) {
    for (const k of [...c.ambitoCalleIds, ...c.ampliacionCalleIds]) {
      const mc = munDe.calle(k);
      if (mc && mc !== c.municipioId) e.push(`Campaña «${c.id}»: calle de otro municipio en su ámbito («${k}»).`);
    }
    const mr = c.campanaReferenciaId ? munDe.campana(c.campanaReferenciaId) : undefined;
    if (mr && mr !== c.municipioId) e.push(`Campaña «${c.id}»: su campaña de referencia es de otro municipio.`);
  }
  return e;
}
