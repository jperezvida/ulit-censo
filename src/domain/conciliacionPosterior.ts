import { ErrorDominio, siguienteOrden, type BaseDatos } from './db';
import { direccionVigente } from './consultas';
import { claseCampana } from './municipios';
import type { ConciliacionPosterior, Id, LocalFisico, Observacion, Ocupacion, ResolucionEstado, VinculoHistorico } from './types';

/**
 * G5 · CONCILIACIÓN POSTERIOR a la importación y estado fiable de los locales de una campaña.
 *
 * - Las filas que la importación dejó sin local (calle no reconocida, «S/N», portal con otro local,
 *   posibles duplicados…) se revisan después, con filtros. Para cada una, una persona decide: vincularla a
 *   un local existente, crear un local DISTINTO (con justificación) o mantenerla pendiente. Cada decisión
 *   guarda autor, fecha, lo que había antes y lo que creó, y se puede deshacer. Nunca se fusionan locales
 *   por compartir portal.
 * - El estado de un local en una campaña se deduce de SUS observaciones: «confirmado» (coinciden y hay
 *   alguna con fecha, o lo decidió una persona), «dudoso» (se contradicen y las fechas permitirían
 *   proponer un orden) o «sin fecha suficiente» (no hay fechas que permitan ordenarlas). Las
 *   contradicciones se resuelven con una decisión sobre la campaña: ninguna observación se borra ni se
 *   cambia y no se inventan fechas.
 * - Todo queda aislado por campaña (y por itinerario en las filas).
 */

const hoy = () => new Date().toISOString();
const motivoDe = (v?: VinculoHistorico) => v?.criterio.match(/\(([a-z-]+)\)/)?.[1];

export const MOTIVO_PENDIENTE_TXT: Record<string, string> = {
  'local-existente-en-direccion': 'Ya hay un local en ese portal',
  'calle-sin-correspondencia': 'Calle no reconocida en el callejero',
  'calle-ambigua': 'Calle ambigua',
  'numero-desconocido': 'Sin número de portal',
  'sin-numero': 'Portal «S/N»',
  'direccion-sin-separar': 'Dirección completa sin separar',
  'estado-local-desconocido': 'No se sabe si el local está vacío',
  'mantener-pendiente': 'Mantenida pendiente por decisión',
};

function asegurarCampana(db: BaseDatos, campanaId: Id) {
  const c = db.campanas[campanaId];
  if (!c) throw new ErrorDominio('regla', 'La campaña no existe.');
  return c;
}

/** Importaciones confirmadas de una campaña (histórica u operativa). */
const importacionesDe = (db: BaseDatos, campanaId: Id) => Object.values(db.importaciones).filter((i) => i.campanaId === campanaId && i.estado === 'confirmada' && i.c1);

// ───────────── Pendientes ─────────────

export interface Pendiente {
  registroId: Id;
  vinculoId: Id;
  itinerarioId?: Id;
  itinerario?: string;
  importacionId: Id;
  archivo: string;
  fila: number;
  /** Dirección tal como venía en el Excel. */
  direccion: string;
  nombre?: string;
  motivo: string;
  incidencias: string[];
  observacionId?: Id;
  calleId?: Id;
  numero: number | null;
  sufijo?: string;
  vacio?: boolean;
  /** Actividad tal como figura en el Excel (sin corregir). */
  actividad?: string;
  /**
   * Locales del mismo municipio en la misma calle, ordenados de más a menos parecidos (portal, nombre y
   * estado frente al censo de referencia), con los motivos de la propuesta. Son PROPUESTAS: nada se aplica.
   */
  candidatos: Candidato[];
  /** Claridad de la mejor propuesta (para revisar primero los casos claros). */
  claridad: Claridad;
  /** Se puede crear un local distinto: hay calle reconocida, número y estado conocido. */
  puedeCrearLocal: boolean;
  /** Última decisión «mantener pendiente», si la hay. */
  decision?: ConciliacionPosterior;
}

export interface FiltrosPendientes {
  itinerarioId?: Id;
  calleId?: Id;
  /** Motivo del pendiente o tipo de incidencia de la fila. */
  tipo?: string;
}

const texto = (c?: { t: string; v?: unknown }) => (!c || c.t === 'vacio' ? '' : String(c.v));

/** Filas de una campaña que siguen sin local, con su contexto y sus candidatos. */
export function pendientesCampana(db: BaseDatos, campanaId: Id, f: FiltrosPendientes = {}): Pendiente[] {
  asegurarCampana(db, campanaId);
  const obsPorRegistro = new Map(Object.values(db.observaciones).filter((o) => o.campanaId === campanaId && o.registroId).map((o) => [o.registroId!, o]));
  // Observaciones históricas sin registroId (C1c): se buscan por la nota «(fila N)» de su importación.
  const res: Pendiente[] = [];
  for (const imp of importacionesDe(db, campanaId)) {
    for (const r of Object.values(db.registros)) {
      if (r.importacionId !== imp.id || r.exclusion) continue;
      const v = db.vinculos[`vin-${r.id}`];
      if (!v || v.localId) continue;
      const obs = obsPorRegistro.get(r.id);
      const ultima = v.conciliaciones?.filter((c) => !c.deshecha).at(-1);
      const motivo = motivoDe(v) ?? 'sin-vinculo';
      const p: Pendiente = {
        registroId: r.id, vinculoId: v.id, ...(r.itinerarioId ? { itinerarioId: r.itinerarioId, itinerario: db.itinerarios[r.itinerarioId]?.codigo } : {}),
        importacionId: imp.id, archivo: imp.archivo, fila: r.fila,
        direccion: `${texto(r.original?.direccion ?? r.original?.direccionCompleta)}${r.original?.numero ? `, ${texto(r.original.numero)}` : ''}`.trim(),
        ...(obs?.datos.nombre || r.original?.nombre ? { nombre: obs?.datos.nombre ?? texto(r.original?.nombre) } : {}),
        motivo, incidencias: r.interpretacion?.incidencias ?? [],
        ...(obs ? { observacionId: obs.id, calleId: obs.calleId, vacio: obs.datos.vacio } : {}),
        numero: obs?.datos.numero ?? null, ...(obs?.datos.sufijo ? { sufijo: obs.datos.sufijo } : {}),
        ...(actividadDe(r) && !obs?.datos.vacio ? { actividad: actividadDe(r) } : {}),
        candidatos: [], claridad: 'sin-correspondencia-segura',
        puedeCrearLocal: !!obs && obs.datos.numero !== null,
        ...(ultima?.accion === 'mantener-pendiente' ? { decision: ultima } : {}),
      };
      if (obs) { p.candidatos = candidatosEnCalle(db, campanaId, obs); p.claridad = claridadDe(p.candidatos); }
      res.push(p);
    }
  }
  return res
    .filter((p) => (!f.itinerarioId || p.itinerarioId === f.itinerarioId) && (!f.calleId || p.calleId === f.calleId) && (!f.tipo || p.motivo === f.tipo || p.incidencias.includes(f.tipo) || (f.tipo === 'mantener-pendiente' && !!p.decision)))
    .sort((a, b) => (a.itinerario ?? '').localeCompare(b.itinerario ?? '', 'es', { numeric: true }) || a.fila - b.fila);
}

// ───────────── Conciliación asistida (propuestas, nunca automáticas) ─────────────

/** Cómo coincide el nombre de la fila con el del censo de referencia. */
export type CoincidenciaNombre = 'igual' | 'parecido' | 'distinto' | 'sin-dato';
/** Nivel de una propuesta: primero el portal, después el nombre. */
export type NivelCandidato = 'portal-y-nombre' | 'portal' | 'calle';
export type Claridad = 'clara' | 'mismo-portal' | 'sin-correspondencia-segura';
export const CLARIDAD_TXT: Record<Claridad, string> = {
  clara: 'Propuesta clara',
  'mismo-portal': 'Mismo portal, revisar',
  'sin-correspondencia-segura': 'Sin correspondencia segura',
};

/** Lo que figuraba en el censo de referencia para un local (tal como se observó; no se recalcula). */
export interface DatosReferencia {
  campanaId: Id;
  campana: string;
  nombre?: string;
  vacio: boolean;
  actividad?: string;
  fecha?: string;
}

export interface Candidato {
  localId: Id;
  portal: string;
  mismoPortal: boolean;
  nivel: NivelCandidato;
  nombre: CoincidenciaNombre;
  /** Por qué se propone y qué NO demuestra la coincidencia. */
  motivos: string[];
  referencia?: DatosReferencia;
  /** Otra fila de esta campaña ya está vinculada a este local. */
  yaVinculado: boolean;
}

const normalizar = (t?: string) => (t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
/** Igualdad tras normalizar mayúsculas, tildes y signos; «parecido» si comparten al menos la mitad de las palabras. */
export function compararNombres(a?: string, b?: string): CoincidenciaNombre {
  const x = normalizar(a), y = normalizar(b);
  if (!x || !y) return 'sin-dato';
  if (x === y) return 'igual';
  const px = new Set(x.split(' ').filter((w) => w.length >= 3)), py = new Set(y.split(' ').filter((w) => w.length >= 3));
  const comunes = [...px].filter((w) => py.has(w)).length;
  const todas = new Set([...px, ...py]).size;
  return todas && comunes / todas >= 0.5 ? 'parecido' : 'distinto';
}

const actividadDe = (r?: { original?: Record<string, { t: string; v?: unknown }> }) =>
  texto(r?.original?.actividad) || texto(r?.original?.subgrupo) || texto(r?.original?.grupoActividad) || undefined;

/** Datos del local en el censo de referencia: su última observación allí y la actividad de su fila de origen. */
function datosReferencia(db: BaseDatos, refId: Id | undefined, localId: Id): DatosReferencia | undefined {
  const ref = refId ? db.campanas[refId] : undefined;
  if (!ref) return undefined;
  const o = Object.values(db.observaciones).filter((x) => x.campanaId === ref.id && x.localId === localId).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).at(-1);
  if (!o) return undefined;
  const reg = o.registroId ? db.registros[o.registroId]
    : Object.values(db.vinculos).filter((v) => v.localId === localId).map((v) => db.registros[v.origen.id]).find((r) => r && db.importaciones[r.importacionId]?.campanaId === ref.id);
  const actividad = o.datos.vacio ? undefined : actividadDe(reg);
  return { campanaId: ref.id, campana: ref.nombre, ...(o.datos.nombre ? { nombre: o.datos.nombre } : {}), vacio: o.datos.vacio, ...(actividad ? { actividad } : {}), ...(o.fecha ? { fecha: o.fecha.slice(0, 10) } : {}) };
}

/**
 * Locales candidatos para una fila pendiente: los del mismo municipio y la misma calle (la vinculación
 * exige la misma calle). Se ordenan por portal (número y sufijo) y, dentro del portal, por el parecido del
 * nombre con el del censo de referencia. Cada candidato explica por qué se propone y qué no prueba.
 */
function candidatosEnCalle(db: BaseDatos, campanaId: Id, o: Observacion): Candidato[] {
  const camp = db.campanas[campanaId];
  const calle = db.calles[o.calleId]?.nombre ?? o.calleId;
  const enPortal = Object.values(db.locales).filter((l) => l.municipioId === camp.municipioId && direccionVigente(l).calleId === o.calleId);
  const mismo = (l: LocalFisico) => { const d = direccionVigente(l); return o.datos.numero !== null && d.numero === o.datos.numero && (d.sufijo ?? '').toUpperCase() === (o.datos.sufijo ?? '').toUpperCase(); };
  const nPortal = enPortal.filter(mismo).length;
  const vinculados = new Set(Object.values(db.observaciones).filter((x) => x.campanaId === campanaId && x.localId && x.id !== o.id).map((x) => x.localId!));
  const peso = { igual: 3, parecido: 2, 'sin-dato': 1, distinto: 0 } as const;
  return enPortal.map((l): Candidato => {
    const d = direccionVigente(l);
    const mismoPortal = mismo(l);
    const referencia = datosReferencia(db, camp.campanaReferenciaId, l.id);
    const nombre = o.datos.vacio || referencia?.vacio ? 'sin-dato' : compararNombres(o.datos.nombre, referencia?.nombre);
    const yaVinculado = vinculados.has(l.id);
    const motivos: string[] = [];
    if (mismoPortal) motivos.push(`Mismo portal (calle, número${o.datos.sufijo ? ' y sufijo' : ''}).`);
    else motivos.push(o.datos.numero === null ? 'Misma calle; la fila no tiene número de portal.' : 'Misma calle, otro portal.');
    if (mismoPortal && nPortal > 1) motivos.push(`En este portal hay ${nPortal} locales: puede ser cualquiera de ellos o uno distinto.`);
    if (!referencia) motivos.push('Sin datos en el censo de referencia para comparar.');
    else if (referencia.vacio && !o.datos.vacio) motivos.push(`En ${referencia.campana} figuraba vacío; ahora aparece ocupado.`);
    else if (!referencia.vacio && o.datos.vacio) motivos.push(`En ${referencia.campana} figuraba ocupado; ahora aparece vacío.`);
    else if (referencia.vacio && o.datos.vacio) motivos.push(`También figuraba vacío en ${referencia.campana}.`);
    else if (nombre === 'igual') motivos.push(`Mismo nombre que en ${referencia.campana}.`);
    else if (nombre === 'parecido') motivos.push(`Nombre parecido al de ${referencia.campana}.`);
    else if (nombre === 'distinto') motivos.push(`Nombre distinto al de ${referencia.campana}: no confirma un cambio de negocio.`);
    if (yaVinculado) motivos.push('Otra fila de esta campaña ya está vinculada a este local.');
    const nivel: NivelCandidato = mismoPortal ? (nombre === 'igual' || nombre === 'parecido' || (referencia?.vacio && o.datos.vacio) ? 'portal-y-nombre' : 'portal') : 'calle';
    return { localId: l.id, portal: `${calle}, ${d.numero ?? 's/n'}${d.sufijo ? ` ${d.sufijo}` : ''}`, mismoPortal, nivel, nombre, motivos, ...(referencia ? { referencia } : {}), yaVinculado };
  }).sort((a, b) => Number(b.mismoPortal) - Number(a.mismoPortal) || Number(a.yaVinculado) - Number(b.yaVinculado)
    || peso[b.nombre] - peso[a.nombre] || a.portal.localeCompare(b.portal, 'es', { numeric: true }));
}

/** Clara: un único candidato del mismo portal con nombre (o vacío) coincidente y sin otra fila vinculada. */
function claridadDe(cs: Candidato[]): Claridad {
  const fuertes = cs.filter((c) => c.nivel === 'portal-y-nombre' && !c.yaVinculado);
  if (fuertes.length === 1) return 'clara';
  return cs.some((c) => c.mismoPortal) ? 'mismo-portal' : 'sin-correspondencia-segura';
}

/** Orden de revisión: primero las propuestas claras, después el mismo portal y al final lo dudoso. Estable. */
export const ORDEN_CLARIDAD: Record<Claridad, number> = { clara: 0, 'mismo-portal': 1, 'sin-correspondencia-segura': 2 };
export const ordenarPorClaridad = (ps: Pendiente[]) => ps.map((p, i) => [p, i] as const).sort((a, b) => ORDEN_CLARIDAD[a[0].claridad] - ORDEN_CLARIDAD[b[0].claridad] || a[1] - b[1]).map(([p]) => p);

// ───────────── Decisiones (reversibles) ─────────────

export interface FirmaDecision {
  porId: Id;
  ahora?: string;
  motivo?: string;
}

function contexto(db: BaseDatos, campanaId: Id, registroId: Id) {
  const camp = asegurarCampana(db, campanaId);
  const r = db.registros[registroId];
  if (!r) throw new ErrorDominio('regla', 'La fila no existe.');
  const imp = db.importaciones[r.importacionId];
  // Aislamiento: la fila debe ser de una incorporación confirmada de ESTA campaña.
  if (!imp || imp.campanaId !== campanaId || imp.estado !== 'confirmada') throw new ErrorDominio('regla', 'La fila no pertenece a esta campaña.');
  const v = db.vinculos[`vin-${registroId}`];
  if (!v) throw new ErrorDominio('regla', 'La fila no tiene vínculo de origen.');
  const obs = Object.values(db.observaciones).find((o) => o.registroId === registroId && o.campanaId === campanaId);
  return { camp, r, v, obs };
}

const puedeConciliar = (db: BaseDatos, porId: Id) => {
  const p = db.personas[porId];
  return !!p && (p.roles.includes('coordinador') || p.roles.includes('administrador') || p.roles.includes('revisor'));
};

/** Ocupación de la campaña para el local, si el local aún no tiene una en ESTA campaña. */
function ocupacionSiFalta(db: BaseDatos, campanaId: Id, localId: Id, obs: Observacion | undefined, id: Id): Ocupacion | null {
  if (!obs) return null;
  if (Object.values(db.ocupaciones).some((o) => o.localId === localId && (o.desdeCampanaId === campanaId || o.hastaCampanaId === campanaId))) return null;
  return {
    id, localId, negocioId: obs.datos.vacio ? null : obs.datos.negocioId ?? null, ...(obs.datos.metrosFachada !== undefined ? { metrosFachada: obs.datos.metrosFachada } : {}),
    desdeCampanaId: campanaId, hastaCampanaId: campanaId, desdeObservacionId: obs.id, ...(obs.fecha ? { desdeFecha: obs.fecha } : {}), orden: siguienteOrden(db),
  };
}

function registrar(db: BaseDatos, v: VinculoHistorico, obs: Observacion | undefined, c: ConciliacionPosterior, localId: Id | null): BaseDatos {
  const vinculos = { ...db.vinculos, [v.id]: { ...v, localId, confianza: localId ? 'confirmada' as const : v.confianza, revisadoPorId: c.porId, conciliaciones: [...(v.conciliaciones ?? []), c] } };
  const observaciones = obs && localId !== undefined ? { ...db.observaciones, [obs.id]: { ...obs, localId } } : db.observaciones;
  return { ...db, vinculos, observaciones };
}

/** Vincula una fila pendiente a un local EXISTENTE del mismo municipio y la misma calle. */
export function vincularALocal(db0: BaseDatos, campanaId: Id, registroId: Id, localId: Id, f: FirmaDecision): BaseDatos {
  const { camp, r, v, obs } = contexto(db0, campanaId, registroId);
  if (!puedeConciliar(db0, f.porId)) throw new ErrorDominio('regla', 'Concilia una persona de coordinación, administración o revisión.');
  if (v.localId) throw new ErrorDominio('regla', 'La fila ya tiene un local.');
  const l = db0.locales[localId];
  if (!l || l.municipioId !== camp.municipioId) throw new ErrorDominio('regla', 'El local no existe en el municipio de la campaña.');
  if (obs && direccionVigente(l).calleId !== obs.calleId) throw new ErrorDominio('regla', 'El local está en otra calle: no se vincula (revise la calle de la fila).');
  const ahora = f.ahora ?? hoy();
  const db: BaseDatos = { ...db0, ocupaciones: { ...db0.ocupaciones } };
  const ocu = ocupacionSiFalta(db, campanaId, localId, obs, `ocu-g5-${registroId}`);
  if (ocu) db.ocupaciones[ocu.id] = ocu;
  const c: ConciliacionPosterior = {
    accion: 'vincular', localId, porId: f.porId, fecha: ahora, ...(f.motivo?.trim() ? { motivo: f.motivo.trim() } : {}), campanaId, ...(r.itinerarioId ? { itinerarioId: r.itinerarioId } : {}),
    antes: { localId: v.localId, confianza: v.confianza, ...(v.revisadoPorId ? { revisadoPorId: v.revisadoPorId } : {}), ...(obs ? { observacionLocalId: obs.localId } : {}) },
    creadas: { locales: [], ocupaciones: ocu ? [ocu.id] : [] },
  };
  return registrar(db, v, obs, c, localId);
}

/** Crea un local DISTINTO para la fila (mismo portal o no): exige justificación, calle reconocida y número. */
export function crearLocalDistinto(db0: BaseDatos, campanaId: Id, registroId: Id, f: FirmaDecision): BaseDatos {
  const { camp, r, v, obs } = contexto(db0, campanaId, registroId);
  if (!puedeConciliar(db0, f.porId)) throw new ErrorDominio('regla', 'Concilia una persona de coordinación, administración o revisión.');
  if (v.localId) throw new ErrorDominio('regla', 'La fila ya tiene un local.');
  if (!f.motivo?.trim()) throw new ErrorDominio('regla', 'Indique por qué es un local distinto (p. ej. «otro establecimiento en el mismo portal, comprobado en campo»).');
  if (!obs || obs.datos.numero === null) throw new ErrorDominio('regla', 'Sin calle reconocida y número de portal no se crea un local: la fila sigue pendiente.');
  const ahora = f.ahora ?? hoy();
  const localId = `loc-g5-${registroId}`;
  if (db0.locales[localId]) throw new ErrorDominio('regla', 'Ya se creó un local para esta fila.');
  const local: LocalFisico = {
    id: localId, municipioId: camp.municipioId, estado: 'activo', procedencia: 'importado',
    direcciones: [{ calleId: obs.calleId, numero: obs.datos.numero, ...(obs.datos.sufijo ? { sufijo: obs.datos.sufijo } : {}), desdeCampanaId: campanaId }],
  };
  const db: BaseDatos = { ...db0, locales: { ...db0.locales, [localId]: local }, ocupaciones: { ...db0.ocupaciones } };
  const ocu = ocupacionSiFalta(db, campanaId, localId, obs, `ocu-g5-${registroId}`);
  if (ocu) db.ocupaciones[ocu.id] = ocu;
  const c: ConciliacionPosterior = {
    accion: 'local-nuevo', localId, porId: f.porId, fecha: ahora, motivo: f.motivo.trim(), campanaId, ...(r.itinerarioId ? { itinerarioId: r.itinerarioId } : {}),
    antes: { localId: v.localId, confianza: v.confianza, ...(v.revisadoPorId ? { revisadoPorId: v.revisadoPorId } : {}), observacionLocalId: obs.localId },
    creadas: { locales: [localId], ocupaciones: ocu ? [ocu.id] : [] },
  };
  return registrar(db, v, obs, c, localId);
}

/** Deja constancia de que la fila se ha revisado y sigue pendiente (no cambia nada más). */
export function mantenerPendiente(db0: BaseDatos, campanaId: Id, registroId: Id, f: FirmaDecision): BaseDatos {
  const { r, v } = contexto(db0, campanaId, registroId);
  if (!puedeConciliar(db0, f.porId)) throw new ErrorDominio('regla', 'Concilia una persona de coordinación, administración o revisión.');
  if (v.localId) throw new ErrorDominio('regla', 'La fila ya tiene un local.');
  const c: ConciliacionPosterior = {
    accion: 'mantener-pendiente', porId: f.porId, fecha: f.ahora ?? hoy(), ...(f.motivo?.trim() ? { motivo: f.motivo.trim() } : {}), campanaId, ...(r.itinerarioId ? { itinerarioId: r.itinerarioId } : {}),
    antes: { localId: null, confianza: v.confianza }, creadas: { locales: [], ocupaciones: [] },
  };
  return { ...db0, vinculos: { ...db0.vinculos, [v.id]: { ...v, conciliaciones: [...(v.conciliaciones ?? []), c] } } };
}

/** Decisiones de conciliación posterior de una campaña (vigentes y deshechas). */
export function decisionesCampana(db: BaseDatos, campanaId: Id): { vinculoId: Id; registroId: Id; decision: ConciliacionPosterior; indice: number }[] {
  return Object.values(db.vinculos).flatMap((v) => (v.conciliaciones ?? []).map((decision, indice) => ({ vinculoId: v.id, registroId: v.origen.id, decision, indice })))
    .filter((x) => x.decision.campanaId === campanaId)
    .sort((a, b) => b.decision.fecha.localeCompare(a.decision.fecha));
}

/**
 * Deshace la ÚLTIMA decisión vigente de una fila: restaura el vínculo y la observación y retira lo que
 * creó. Se bloquea si algo posterior usa lo creado (otra fila vinculada a ese local, otra ocupación…).
 */
export function deshacerConciliacion(db0: BaseDatos, campanaId: Id, registroId: Id, f: FirmaDecision): BaseDatos {
  const { v, obs } = contexto(db0, campanaId, registroId);
  if (!puedeConciliar(db0, f.porId)) throw new ErrorDominio('regla', 'Deshace una persona de coordinación, administración o revisión.');
  const lista = v.conciliaciones ?? [];
  const i = lista.map((c) => !c.deshecha).lastIndexOf(true);
  if (i < 0) throw new ErrorDominio('regla', 'No hay ninguna decisión que deshacer en esta fila.');
  const c = lista[i];
  const conflictos: string[] = [];
  if (c.accion !== 'mantener-pendiente') {
    if (v.localId !== c.localId) conflictos.push('El vínculo de la fila ha cambiado después de la decisión.');
    if (obs && obs.localId !== c.localId) conflictos.push('La observación de la fila ha cambiado después de la decisión.');
    // Una decisión de estado vigente sobre el local (en cualquier campaña) se apoya en sus observaciones: se retira antes.
    for (const camp of Object.values(db0.campanas)) {
      if ((camp.resolucionesEstado ?? []).some((r) => r.localId === c.localId && !r.retirada)) conflictos.push(`El local tiene una decisión de estado vigente en «${camp.nombre}»: retírela antes de deshacer.`);
    }
    for (const lid of c.creadas.locales) {
      if (Object.values(db0.vinculos).some((x) => x.id !== v.id && x.localId === lid)) conflictos.push('Otra fila está vinculada al local creado.');
      if (Object.values(db0.observaciones).some((o) => o.id !== obs?.id && o.localId === lid)) conflictos.push('Otra observación usa el local creado.');
      if (Object.values(db0.ocupaciones).some((o) => o.localId === lid && !c.creadas.ocupaciones.includes(o.id))) conflictos.push('Otra ocupación usa el local creado.');
      if (Object.values(db0.revisiones).some((r) => r.localId === lid)) conflictos.push('Una revisión de oficina usa el local creado.');
      if (Object.values(db0.vinculos).some((x) => (x.candidatos ?? []).some((k) => k.localId === lid))) conflictos.push('Otra fila tiene el local creado como candidato.');
    }
  }
  if (conflictos.length) throw new ErrorDominio('bloqueado', `No se puede deshacer: ${conflictos[0]}`, conflictos);
  const db: BaseDatos = { ...db0, locales: { ...db0.locales }, ocupaciones: { ...db0.ocupaciones } };
  for (const id of c.creadas.ocupaciones) delete db.ocupaciones[id];
  for (const id of c.creadas.locales) delete db.locales[id];
  const ahora = f.ahora ?? hoy();
  const conciliaciones = lista.map((x, k) => (k === i ? { ...x, deshecha: { porId: f.porId, fecha: ahora } } : x));
  db.vinculos = { ...db0.vinculos, [v.id]: { ...v, localId: c.antes.localId, confianza: c.antes.confianza, ...(c.antes.revisadoPorId ? { revisadoPorId: c.antes.revisadoPorId } : { revisadoPorId: undefined }), conciliaciones } };
  if (obs && c.accion !== 'mantener-pendiente') db.observaciones = { ...db0.observaciones, [obs.id]: { ...obs, localId: c.antes.observacionLocalId ?? null } };
  return db;
}

// ───────────── Estado de un local en una campaña ─────────────

export type ClaseEstado = 'confirmado' | 'dudoso' | 'sin-fecha';
export const CLASE_ESTADO_TXT: Record<ClaseEstado, string> = {
  confirmado: 'Estado actual confirmado',
  dudoso: 'Estado dudoso',
  'sin-fecha': 'Información sin fecha suficiente',
};

export interface EstadoLocal {
  localId: Id;
  clase: ClaseEstado;
  /** Valor del estado: solo si está confirmado (o es el único observado, aunque sin fecha). */
  valor?: 'vacio' | 'ocupado';
  contradictorio: boolean;
  observaciones: Observacion[];
  /** Propuesta (no aplicada) cuando las fechas permiten ordenar las observaciones contradictorias. */
  propuesta?: { valor: 'vacio' | 'ocupado'; observacionId: Id; motivo: string };
  resolucion?: ResolucionEstado;
  motivo: string;
}

const valorDe = (o: Observacion) => (o.datos.vacio ? 'vacio' as const : 'ocupado' as const);

export const resolucionVigente = (db: BaseDatos, campanaId: Id, localId: Id) =>
  (db.campanas[campanaId]?.resolucionesEstado ?? []).filter((r) => r.localId === localId && !r.retirada).at(-1);

/** Estado de un local en una campaña, deducido de sus observaciones y de la resolución supervisada. */
export function estadoLocal(db: BaseDatos, campanaId: Id, localId: Id, indice?: Map<Id, Observacion[]>): EstadoLocal {
  const obs = [...(indice ? indice.get(localId) ?? [] : Object.values(db.observaciones).filter((o) => o.campanaId === campanaId && o.localId === localId))]
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '') || (a.orden ?? 0) - (b.orden ?? 0));
  const valores = new Set(obs.map(valorDe));
  const contradictorio = valores.size > 1;
  const res = resolucionVigente(db, campanaId, localId);
  const base = { localId, contradictorio, observaciones: obs, ...(res ? { resolucion: res } : {}) };
  if (res) {
    return res.estado === 'dudoso'
      ? { ...base, clase: 'dudoso', motivo: 'Marcado como dudoso por una persona.' }
      : { ...base, clase: 'confirmado', valor: res.estado, motivo: `Decidido por ${db.personas[res.porId]?.nombre ?? res.porId} el ${res.fecha.slice(0, 10)}${res.motivo ? `: ${res.motivo}` : ''}.` };
  }
  if (!obs.length) return { ...base, clase: 'sin-fecha', motivo: 'Sin observaciones en esta campaña.' };
  if (!contradictorio) {
    const valor = valorDe(obs[0]);
    return obs.some((o) => o.fecha)
      ? { ...base, clase: 'confirmado', valor, motivo: `${obs.length} observación(es) coincidentes.` }
      : { ...base, clase: 'sin-fecha', valor, motivo: 'Las observaciones coinciden, pero ninguna tiene fecha.' };
  }
  // Contradicción: solo se propone (nunca se aplica) si TODAS tienen fecha y la más reciente es única.
  const conFecha = obs.filter((o) => o.fecha);
  const ultima = conFecha.at(-1);
  if (conFecha.length === obs.length && ultima && conFecha.filter((o) => o.fecha === ultima.fecha).length === 1) {
    return { ...base, clase: 'dudoso', propuesta: { valor: valorDe(ultima), observacionId: ultima.id, motivo: `La observación más reciente (${ultima.fecha}) dice «${valorDe(ultima) === 'vacio' ? 'vacío' : 'ocupado'}».` }, motivo: 'Las observaciones se contradicen: hace falta una decisión.' };
  }
  return { ...base, clase: 'sin-fecha', motivo: 'Las observaciones se contradicen y sus fechas no permiten ordenarlas (faltan o coinciden): no se deduce ningún estado.' };
}

/**
 * Resuelve el estado de un local en la campaña: confirmar «vacío» u «ocupado» según una observación
 * concreta de ese local (la evidencia), o dejarlo como dudoso. No cambia ninguna observación.
 */
export function resolverEstado(db: BaseDatos, campanaId: Id, localId: Id, r: { estado: ResolucionEstado['estado']; observacionId?: Id }, f: FirmaDecision): BaseDatos {
  const camp = asegurarCampana(db, campanaId);
  if (!puedeConciliar(db, f.porId)) throw new ErrorDominio('regla', 'Resuelve una persona de coordinación, administración o revisión.');
  const e = estadoLocal(db, campanaId, localId);
  if (!e.observaciones.length) throw new ErrorDominio('regla', 'El local no tiene observaciones en esta campaña.');
  if (r.estado !== 'dudoso') {
    const o = e.observaciones.find((x) => x.id === r.observacionId);
    if (!o) throw new ErrorDominio('regla', 'Indique la observación de este local en la que se apoya la decisión.');
    if (valorDe(o) !== r.estado) throw new ErrorDominio('regla', 'La observación elegida no dice ese estado.');
  }
  const res: ResolucionEstado = { localId, estado: r.estado, ...(r.observacionId ? { observacionId: r.observacionId } : {}), porId: f.porId, fecha: f.ahora ?? hoy(), ...(f.motivo?.trim() ? { motivo: f.motivo.trim() } : {}) };
  return { ...db, campanas: { ...db.campanas, [campanaId]: { ...camp, resolucionesEstado: [...(camp.resolucionesEstado ?? []), res] } } };
}

/** Retira la resolución vigente (se conserva marcada como retirada): el estado vuelve a deducirse de las observaciones. */
export function retirarResolucion(db: BaseDatos, campanaId: Id, localId: Id, f: FirmaDecision): BaseDatos {
  const camp = asegurarCampana(db, campanaId);
  if (!puedeConciliar(db, f.porId)) throw new ErrorDominio('regla', 'Retira una persona de coordinación, administración o revisión.');
  const lista = camp.resolucionesEstado ?? [];
  const i = lista.map((x) => x.localId === localId && !x.retirada).lastIndexOf(true);
  if (i < 0) throw new ErrorDominio('regla', 'Ese local no tiene ninguna resolución vigente.');
  const resolucionesEstado = lista.map((x, k) => (k === i ? { ...x, retirada: { porId: f.porId, fecha: f.ahora ?? hoy() } } : x));
  return { ...db, campanas: { ...db.campanas, [campanaId]: { ...camp, resolucionesEstado } } };
}

/** Observaciones de la campaña agrupadas por local (para calcular muchos estados sin recorrerlas cada vez). */
export function indiceObservaciones(db: BaseDatos, campanaId: Id): Map<Id, Observacion[]> {
  const m = new Map<Id, Observacion[]>();
  for (const o of Object.values(db.observaciones)) if (o.campanaId === campanaId && o.localId) m.set(o.localId, [...(m.get(o.localId) ?? []), o]);
  return m;
}

/** Locales de la campaña con estado no confirmado (para revisarlos). */
export function localesPorRevisar(db: BaseDatos, campanaId: Id): EstadoLocal[] {
  const indice = indiceObservaciones(db, campanaId);
  return [...indice.keys()].sort().map((id) => estadoLocal(db, campanaId, id, indice)).filter((e) => e.clase !== 'confirmado' || e.contradictorio);
}

export const esCampanaOperativa = (db: BaseDatos, campanaId: Id) => !!db.campanas[campanaId] && claseCampana(db.campanas[campanaId]) === 'operativa';
