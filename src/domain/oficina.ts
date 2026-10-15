import type { BaseDatos } from './db';
import { kMet, kRev } from './db';
import {
  direccionVigente, observacionEn, ocupacionEn, revisionDe, type IndiceObservaciones, type IndiceOcupaciones,
} from './consultas';
import type { Confianza, Id, MetricaDigital, Negocio, Observacion, Revision } from './types';
import { rutaActividad } from './taxonomy';
import { normalizar } from './text';

export interface FilaOficina {
  localId: Id;
  calleId: Id;
  calle: string;
  numero: number | null;
  sufijo?: string;
  negocioId: Id | null;
  nombre: string;
  vacio: boolean;
  metros?: number;
  actividadId?: Id;
  actividad?: string;
  grupo?: string;
  cadena?: string;
  obs?: Observacion;
  rev: Revision;
  digital: 'verificada' | 'anterior' | 'sin-datos' | 'no-aplica';
  vinculo?: Confianza;
  itinerario?: string;
  errores: string[];
  duplicado: boolean;
  nuevoNegocio: boolean;
}

/** Filas de la bandeja para una campaña: locales observados o con revisión en ella. */
export function filasOficina(db: BaseDatos, campanaId: Id, ix: { obs: IndiceObservaciones; ocu: IndiceOcupaciones }): FilaOficina[] {
  const camp = db.campanas[campanaId];
  if (!camp) return [];
  const itPorCalle = new Map<Id, string>();
  for (const it of Object.values(db.itinerarios)) if (it.campanaId === campanaId) for (const t of it.tramos) itPorCalle.set(t.calleId, it.codigo);
  const vincPorLocal = new Map<Id, Confianza>();
  for (const v of Object.values(db.vinculos)) {
    if (v.origen.tipo !== 'observacion' || !v.localId) continue;
    const o = db.observaciones[v.origen.id];
    if (o?.campanaId === campanaId) vincPorLocal.set(v.localId, v.confianza);
  }
  const conMetricaPrevia = new Set<Id>();
  for (const m of Object.values(db.metricas)) if (m.campanaId !== campanaId) conMetricaPrevia.add(m.negocioId);
  const filas: FilaOficina[] = [];
  for (const l of Object.values(db.locales)) {
    if (l.municipioId !== camp.municipioId) continue;
    const obsL = ix.obs.get(l.id);
    const obs = observacionEn(obsL, campanaId);
    const tieneRev = !!db.revisiones[kRev(campanaId, l.id)];
    if (!obs && !tieneRev) continue;
    const d = direccionVigente(l);
    const oc = ocupacionEn(db, l.id, campanaId, ix.ocu);
    const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
    const ruta = rutaActividad(neg?.actividadId);
    const rev = revisionDe(db, campanaId, l.id);
    const m = neg ? db.metricas[kMet(neg.id, campanaId)] : undefined;
    const anterior = neg && !m ? conMetricaPrevia.has(neg.id) : false;
    const errores: string[] = [];
    if (neg && !neg.actividadId) errores.push('Sin actividad');
    if (!neg && !oc?.metrosFachada) errores.push('Vacío sin metros de fachada');
    if (d.numero === null) errores.push('Sin número');
    if (neg && !neg.nombre.trim()) errores.push('Sin nombre');
    filas.push({
      localId: l.id, calleId: d.calleId, calle: db.calles[d.calleId]?.nombre ?? '¿?', numero: d.numero, sufijo: d.sufijo,
      negocioId: neg?.id ?? null, nombre: neg?.nombre ?? 'Vacío', vacio: !neg, metros: oc?.metrosFachada,
      actividadId: neg?.actividadId, actividad: ruta[3]?.nombre, grupo: ruta[0]?.nombre, cadena: neg?.cadena,
      obs, rev, digital: !neg ? 'no-aplica' : m?.verificada ? 'verificada' : anterior || m ? 'anterior' : 'sin-datos',
      vinculo: vincPorLocal.get(l.id), itinerario: itPorCalle.get(d.calleId), errores, duplicado: false,
      nuevoNegocio: !!(obs && (obs.tipo === 'nuevo-negocio' || obs.tipo === 'nuevo-local')),
    });
  }
  // Posibles duplicados: misma dirección y nombre parecido dentro de la campaña
  const grupos = new Map<string, FilaOficina[]>();
  for (const f of filas) {
    const k = `${f.calleId}|${f.numero}|${f.sufijo ?? ''}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    for (const f of g) if (g.some((x) => x !== f && (x.vacio === f.vacio || normalizar(x.nombre).slice(0, 5) === normalizar(f.nombre).slice(0, 5)))) f.duplicado = true;
  }
  return filas.sort((a, b) => a.calle.localeCompare(b.calle, 'es') || (a.numero ?? 9999) - (b.numero ?? 9999) || (a.sufijo ?? '').localeCompare(b.sufijo ?? ''));
}

export function esDudosa(f: FilaOficina) {
  return !!f.rev.pendienteComprobacion || f.vinculo === 'dudosa' || f.vinculo === 'probable' || f.obs?.tipo === 'dudoso' || f.obs?.tipo === 'posible-desaparicion';
}

export function motivoNoAprobable(f: FilaOficina): string | null {
  if (f.rev.campo !== 'terminado') return 'trabajo de campo pendiente';
  if (!f.vacio && f.rev.categorizacion !== 'revisado') return 'categorización pendiente';
  if (!f.vacio && f.rev.digital !== 'revisado') return 'presencia digital pendiente';
  if (esDudosa(f)) return 'caso dudoso sin resolver';
  return null;
}

export function actualizarRevisiones(db: BaseDatos, campanaId: Id, localIds: Id[], cambios: Partial<Revision>): BaseDatos {
  const revs = { ...db.revisiones };
  for (const id of localIds) revs[kRev(campanaId, id)] = { ...revisionDe(db, campanaId, id), ...cambios };
  return { ...db, revisiones: revs };
}

export function asignarActividad(db: BaseDatos, campanaId: Id, filas: { localId: Id; negocioId: Id | null }[], actividadId: Id): BaseDatos {
  const negocios = { ...db.negocios };
  for (const f of filas) if (f.negocioId) negocios[f.negocioId] = { ...negocios[f.negocioId], actividadId };
  const d = { ...db, negocios };
  return actualizarRevisiones(d, campanaId, filas.filter((f) => f.negocioId).map((f) => f.localId), { categorizacion: 'revisado' });
}

export function editarNegocio(db: BaseDatos, negocioId: Id, cambios: Partial<Negocio>): BaseDatos {
  return { ...db, negocios: { ...db.negocios, [negocioId]: { ...db.negocios[negocioId], ...cambios } } };
}

/** Guarda la medición digital DEL NEGOCIO para la campaña. `verificar` la sella con fecha. */
export function guardarMetrica(db: BaseDatos, negocioId: Id, campanaId: Id, cambios: Partial<MetricaDigital>, verificar?: boolean): BaseDatos {
  const k = kMet(negocioId, campanaId);
  const actual: MetricaDigital = db.metricas[k] ?? { negocioId, campanaId, verificada: false };
  const nueva: MetricaDigital = { ...actual, ...cambios, negocioId, campanaId };
  if (verificar) {
    nueva.verificada = true;
    nueva.fechaComprobacion = new Date().toISOString();
  }
  return { ...db, metricas: { ...db.metricas, [k]: nueva } };
}

/** Copia valores de una campaña anterior como BORRADOR sin verificar (nunca como verificados). */
export function partirDeAnterior(db: BaseDatos, negocioId: Id, campanaId: Id, anterior: MetricaDigital): BaseDatos {
  const { campanaId: _c, fechaComprobacion: _f, verificada: _v, ...valores } = anterior;
  return guardarMetrica(db, negocioId, campanaId, { ...valores, verificada: false, fechaComprobacion: undefined });
}

export function aprobar(db: BaseDatos, campanaId: Id, filas: FilaOficina[]): { db: BaseDatos; aprobados: number; omitidos: { f: FilaOficina; motivo: string }[] } {
  const ok = filas.filter((f) => !motivoNoAprobable(f));
  const omitidos = filas.filter((f) => motivoNoAprobable(f)).map((f) => ({ f, motivo: motivoNoAprobable(f)! }));
  const d = actualizarRevisiones(db, campanaId, ok.map((f) => f.localId), { validacion: 'aprobada', motivoDevolucion: undefined });
  // Las observaciones de la campaña quedan verificadas al aprobar
  const obs = { ...d.observaciones };
  for (const f of ok) if (f.obs) obs[f.obs.id] = { ...f.obs, verificacion: 'verificada' };
  return { db: { ...d, observaciones: obs }, aprobados: ok.length, omitidos };
}

export function devolver(db: BaseDatos, campanaId: Id, localIds: Id[], motivo: string): BaseDatos {
  return actualizarRevisiones(db, campanaId, localIds, { validacion: 'devuelta', motivoDevolucion: motivo });
}
