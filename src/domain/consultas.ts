import type { BaseDatos } from './db';
import { kCC, kCob, kRev } from './db';
import type {
  Acera, Campana, EstadoCobertura, Id, Itinerario, LocalFisico, Negocio, Observacion, Ocupacion,
  Revision, SituacionPrevia,
} from './types';

// ───────────── Campañas ─────────────

export function campanasDe(db: BaseDatos, municipioId: Id): Campana[] {
  return Object.values(db.campanas).filter((c) => c.municipioId === municipioId).sort((a, b) => a.anio - b.anio);
}

export function itinerariosDe(db: BaseDatos, campanaId: Id): Itinerario[] {
  return Object.values(db.itinerarios)
    .filter((i) => i.campanaId === campanaId)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
}

/** Orden temporal de campañas del mismo municipio. */
export function anioDe(db: BaseDatos, campanaId?: Id): number {
  return campanaId ? db.campanas[campanaId]?.anio ?? 0 : 0;
}

// ───────────── Locales, ocupaciones y negocios ─────────────

export function direccionVigente(l: LocalFisico) {
  return l.direcciones[l.direcciones.length - 1];
}

/**
 * Compara dos fechas reales de evento. Devuelve null cuando NO se puede decidir: falta alguna
 * fecha, o ambas caen el mismo día y al menos una no tiene hora. El orden de introducción
 * nunca sustituye a la cronología: solo desempata eventos con la misma fecha y hora.
 */
export function compararFechas(a?: string, b?: string): number | null {
  if (!a || !b) return null;
  if (a.length > 10 && b.length > 10) return a < b ? -1 : a > b ? 1 : 0;
  const da = a.slice(0, 10);
  const dbb = b.slice(0, 10);
  return da < dbb ? -1 : da > dbb ? 1 : null;
}

/** Orden cronológico de ocupaciones: campaña de inicio, fecha real y, solo si empatan, orden de registro. */
export function compararOcupaciones(db: BaseDatos, a: Ocupacion, b: Ocupacion): number {
  const dy = anioDe(db, a.desdeCampanaId) - anioDe(db, b.desdeCampanaId);
  if (dy) return dy;
  const c = compararFechas(a.desdeFecha, b.desdeFecha);
  return c ? c : a.orden - b.orden;
}

/** ¿La ocupación abarca la campaña? */
export function abarca(db: BaseDatos, o: Ocupacion, campanaId: Id): boolean {
  const anio = anioDe(db, campanaId);
  return anioDe(db, o.desdeCampanaId) <= anio && (!o.hastaCampanaId || anio <= anioDe(db, o.hastaCampanaId));
}

/**
 * Ocupación vigente de un local en una campaña: de las que abarcan esa campaña, la
 * cronológicamente última (por fecha real del evento, no por orden de introducción).
 * Una campaña puede contener varias ocupaciones sucesivas; las anteriores siguen
 * existiendo y forman el histórico.
 */
export function ocupacionEn(db: BaseDatos, localId: Id, campanaId: Id, indice?: IndiceOcupaciones): Ocupacion | undefined {
  const lista = indice ? indice.get(localId) ?? [] : Object.values(db.ocupaciones).filter((o) => o.localId === localId);
  let mejor: Ocupacion | undefined;
  for (const o of lista) if (abarca(db, o, campanaId) && (!mejor || compararOcupaciones(db, o, mejor) > 0)) mejor = o;
  return mejor;
}

/** Todas las ocupaciones de un local en orden cronológico. */
export function ocupacionesDeLocal(db: BaseDatos, localId: Id): Ocupacion[] {
  return Object.values(db.ocupaciones).filter((o) => o.localId === localId).sort((a, b) => compararOcupaciones(db, a, b));
}

export type IndiceOcupaciones = Map<Id, Ocupacion[]>;
export function indiceOcupaciones(db: BaseDatos): IndiceOcupaciones {
  const m: IndiceOcupaciones = new Map();
  for (const o of Object.values(db.ocupaciones)) {
    const l = m.get(o.localId);
    if (l) l.push(o);
    else m.set(o.localId, [o]);
  }
  return m;
}

export type IndiceObservaciones = Map<Id, Observacion[]>; // localId → obs
export function indiceObservaciones(db: BaseDatos): IndiceObservaciones {
  const m: IndiceObservaciones = new Map();
  for (const o of Object.values(db.observaciones)) {
    if (!o.localId) continue;
    const l = m.get(o.localId);
    if (l) l.push(o);
    else m.set(o.localId, [o]);
  }
  for (const l of m.values()) l.sort((a, b) => compararObservaciones(db, a, b));
  return m;
}

export function observacionesDeLocal(db: BaseDatos, localId: Id): Observacion[] {
  return Object.values(db.observaciones).filter((o) => o.localId === localId).sort((a, b) => compararObservaciones(db, a, b));
}

/** Orden cronológico de observaciones: campaña, fecha real y, si no decide, orden de registro. */
export function compararObservaciones(db: BaseDatos, a: Observacion, b: Observacion): number {
  const dy = anioDe(db, a.campanaId) - anioDe(db, b.campanaId);
  if (dy) return dy;
  const c = compararFechas(a.fecha, b.fecha);
  return c ? c : (a.orden ?? 0) - (b.orden ?? 0);
}

/** Observación del local en una campaña concreta (la más reciente). */
export function observacionEn(obs: Observacion[] | undefined, campanaId: Id): Observacion | undefined {
  if (!obs) return undefined;
  for (let i = obs.length - 1; i >= 0; i--) if (obs[i].campanaId === campanaId) return obs[i];
  return undefined;
}

/** Locales de una calle que existían en la campaña de referencia (los "anteriores"). */
export function localesPrevios(db: BaseDatos, campanaRefId: Id | undefined, calleId: Id, idxObs?: IndiceObservaciones): LocalFisico[] {
  if (!campanaRefId) return [];
  const idx = idxObs ?? indiceObservaciones(db);
  return Object.values(db.locales)
    .filter((l) => direccionVigente(l).calleId === calleId && observacionEn(idx.get(l.id), campanaRefId))
    .sort(ordenLocal);
}

export function ordenLocal(a: LocalFisico, b: LocalFisico): number {
  const da = direccionVigente(a);
  const dbb = direccionVigente(b);
  return (da.numero ?? 9999) - (dbb.numero ?? 9999) || (da.sufijo ?? '').localeCompare(dbb.sufijo ?? '');
}

export function textoDireccion(db: BaseDatos, l: LocalFisico): string {
  const d = direccionVigente(l);
  return `${db.calles[d.calleId]?.nombre ?? '¿calle?'}, ${d.numero ?? 's/n'}${d.sufijo ? ' ' + d.sufijo : ''}`;
}

export function negocioEn(db: BaseDatos, localId: Id, campanaId: Id, idx?: IndiceOcupaciones): Negocio | null {
  const o = ocupacionEn(db, localId, campanaId, idx);
  return o?.negocioId ? db.negocios[o.negocioId] ?? null : null;
}

// ───────────── Cobertura ─────────────

export function coberturaCalle(db: BaseDatos, campanaId: Id, calleId: Id): { estado: EstadoCobertura; aceras: Partial<Record<Acera, EstadoCobertura>> } {
  const ambas = db.coberturas[kCob(campanaId, calleId, 'ambas')];
  if (ambas) return { estado: ambas.estado, aceras: { ambas: ambas.estado } };
  const par = db.coberturas[kCob(campanaId, calleId, 'par')]?.estado;
  const impar = db.coberturas[kCob(campanaId, calleId, 'impar')]?.estado;
  return { estado: combinarAceras(par, impar), aceras: { par, impar } };
}

export function combinarAceras(par?: EstadoCobertura, impar?: EstadoCobertura): EstadoCobertura {
  if (!par && !impar) return 'pendiente';
  const terminado = (e?: EstadoCobertura) => e === 'completada-con-locales' || e === 'completada-sin-locales';
  if (terminado(par) && terminado(impar)) {
    return par === 'completada-sin-locales' && impar === 'completada-sin-locales' ? 'completada-sin-locales' : 'completada-con-locales';
  }
  if (par === 'parcial-incidencias' || impar === 'parcial-incidencias') return 'parcial-incidencias';
  if ((par && par !== 'pendiente') || (impar && impar !== 'pendiente')) return 'en-curso';
  return 'pendiente';
}

export const ESTADO_COBERTURA_TXT: Record<EstadoCobertura, string> = {
  pendiente: 'Pendiente',
  'en-curso': 'En curso',
  'completada-con-locales': 'Completada con locales',
  'completada-sin-locales': 'Completada sin locales',
  'parcial-incidencias': 'Parcial / incidencias',
};

export function esCompletada(e: EstadoCobertura) {
  return e === 'completada-con-locales' || e === 'completada-sin-locales';
}

/** Situación histórica de una calle. Nunca deduce "sin locales" de la ausencia de filas. */
export function situacionPrevia(db: BaseDatos, campana: Campana, calleId: Id, idxObs?: IndiceObservaciones): SituacionPrevia {
  const manual = db.situacionesPrevias[kCC(campana.id, calleId)];
  if (manual) return manual;
  const ref = campana.campanaReferenciaId ? db.campanas[campana.campanaReferenciaId] : undefined;
  if (!ref) return 'no-censada';
  if (localesPrevios(db, ref.id, calleId, idxObs).length > 0) return 'con-registros';
  if (coberturaCalle(db, ref.id, calleId).estado === 'completada-sin-locales') return 'censada-sin-locales';
  // Un censo importado sin itinerarios no permite saber qué calles se recorrieron.
  if (ref.tipo === 'historico-importado') return 'sin-informacion';
  return ref.ambitoCalleIds.includes(calleId) ? 'censada-sin-locales' : 'no-censada';
}

export const SITUACION_TXT: Record<SituacionPrevia, string> = {
  'con-registros': 'Con registros anteriores',
  'no-censada': 'No censada anteriormente',
  'censada-sin-locales': 'Censada anteriormente sin locales',
  'sin-informacion': 'Sin información anterior',
  'pendiente-relacionar': 'Pendiente de relacionar con registros históricos',
};

// ───────────── Revisión ─────────────

export function revisionDe(db: BaseDatos, campanaId: Id, localId: Id): Revision {
  return (
    db.revisiones[kRev(campanaId, localId)] ?? {
      campanaId, localId, campo: 'pendiente', categorizacion: 'pendiente', digital: 'pendiente', validacion: 'pendiente',
    }
  );
}

/**
 * La aprobación general depende de los datos revisados: si uno cambia después de aprobar, la
 * aprobación vuelve a «pendiente» y queda constancia de quién, cuándo y por qué. Muta la copia
 * de `revisiones` que recibe.
 */
export function reabrirAprobaciones(revisiones: Record<string, Revision>, campanaId: Id, localIds: Id[], porId: Id, fecha: string, motivo: string): number {
  let n = 0;
  for (const id of localIds) {
    const k = kRev(campanaId, id);
    const r = revisiones[k];
    if (r?.validacion !== 'aprobada') continue;
    revisiones[k] = { ...r, validacion: 'pendiente', aprobacionReabierta: { porId, fecha, motivo } };
    n++;
  }
  return n;
}
