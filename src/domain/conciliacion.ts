import type { BaseDatos } from './db';
import { nuevoId } from './db';
import { direccionVigente, ocupacionEn } from './consultas';
import { similitud } from './text';
import type { Confianza, Id, LocalFisico, VinculoHistorico } from './types';

export interface Candidato {
  localId: Id;
  puntuacion: number;
  motivo: string;
}

/**
 * Propone locales anteriores que podrían corresponder a un registro nuevo.
 * Solo PROPONE: nunca crea un vínculo confirmado. Puntuación 0..1.
 */
export function proponerCandidatos(
  db: BaseDatos,
  registro: { numero: number | null; nombre?: string; vacio: boolean },
  previos: LocalFisico[],
  campanaRefId?: Id,
): Candidato[] {
  const out: Candidato[] = [];
  for (const l of previos) {
    const d = direccionVigente(l);
    const motivos: string[] = [];
    let p = 0;
    if (registro.numero !== null && d.numero !== null) {
      const dif = Math.abs(registro.numero - d.numero);
      if (dif === 0) {
        p += 0.5;
        motivos.push('mismo número');
      } else if (dif <= 2 && dif % 2 === 0) {
        p += 0.2;
        motivos.push('número contiguo en la misma acera');
      } else continue;
    } else continue;
    const oc = campanaRefId ? ocupacionEn(db, l.id, campanaRefId) : undefined;
    const nombreAnt = oc?.negocioId ? db.negocios[oc.negocioId]?.nombre : undefined;
    if (registro.nombre && nombreAnt) {
      const s = similitud(registro.nombre, nombreAnt);
      if (s > 0.75) {
        p += 0.4;
        motivos.push('nombre muy parecido');
      } else if (s > 0.45) {
        p += 0.2;
        motivos.push('nombre parecido');
      } else motivos.push('nombre distinto (¿cambio de negocio?)');
    } else if (!nombreAnt && registro.vacio) {
      p += 0.2;
      motivos.push('ambos vacíos');
    }
    out.push({ localId: l.id, puntuacion: Math.min(1, p), motivo: motivos.join(' · ') });
  }
  return out.sort((a, b) => b.puntuacion - a.puntuacion).slice(0, 3);
}

/** Clasificación prudente de una puntuación. Nunca devuelve "confirmada": eso es humano. */
export function confianzaSugerida(p: number): Exclude<Confianza, 'confirmada'> {
  if (p >= 0.85) return 'probable';
  if (p >= 0.4) return 'dudosa';
  return 'sin-vinculo';
}

export type DecisionConciliacion =
  | { tipo: 'mismo-local'; localAnteriorId: Id } // el registro nuevo es el mismo espacio físico que el anterior
  | { tipo: 'distintos' } // son locales distintos: se mantiene el alta
  | { tipo: 'indeterminado' }; // sin evidencia suficiente: queda abierto

/**
 * Aplica una decisión humana sobre un vínculo dudoso.
 * "mismo-local" fusiona el local creado en campo con el local físico anterior,
 * de modo que el histórico queda en un único espacio.
 */
export function resolverVinculo(db0: BaseDatos, vinculoId: Id, decision: DecisionConciliacion, revisorId: Id): BaseDatos {
  const db: BaseDatos = { ...db0 };
  const v = db.vinculos[vinculoId];
  if (!v) return db0;
  if (decision.tipo === 'indeterminado') {
    db.vinculos = { ...db.vinculos, [vinculoId]: { ...v, confianza: 'sin-vinculo', criterio: 'Revisado: evidencia insuficiente, queda indeterminado', revisadoPorId: revisorId } };
    return db;
  }
  if (decision.tipo === 'distintos') {
    db.vinculos = { ...db.vinculos, [vinculoId]: { ...v, confianza: 'confirmada', criterio: 'Revisado: local distinto de los anteriores (alta confirmada)', revisadoPorId: revisorId, candidatos: [] } };
    return db;
  }
  const nuevoLocalId = v.localId;
  const anteriorId = decision.localAnteriorId;
  if (!nuevoLocalId || !db.locales[anteriorId]) return db0;
  // Reasignar observaciones y ocupaciones del local creado en campo al local anterior.
  const obs = { ...db.observaciones };
  for (const o of Object.values(obs)) if (o.localId === nuevoLocalId) obs[o.id] = { ...o, localId: anteriorId };
  db.observaciones = obs;
  const ocs = { ...db.ocupaciones };
  const ocNueva = Object.values(ocs).find((o) => o.localId === nuevoLocalId);
  if (ocNueva) {
    const campActual = ocNueva.desdeCampanaId;
    const ref = db.campanas[campActual]?.campanaReferenciaId;
    for (const o of Object.values(ocs)) {
      if (o.localId === anteriorId && !o.hastaCampanaId) {
        const mismoNegocio = ocNueva.negocioId && o.negocioId && similitud(db.negocios[o.negocioId]?.nombre ?? '', db.negocios[ocNueva.negocioId]?.nombre ?? '') > 0.75;
        if (mismoNegocio) {
          // Mismo negocio: se conserva la ocupación anterior (y sus perfiles digitales).
          delete ocs[ocNueva.id];
        } else {
          ocs[o.id] = { ...o, hastaCampanaId: ref ?? o.desdeCampanaId };
        }
      }
    }
    if (ocs[ocNueva.id]) ocs[ocNueva.id] = { ...ocNueva, localId: anteriorId };
  }
  db.ocupaciones = ocs;
  const { [nuevoLocalId]: _eliminado, ...locales } = db.locales;
  db.locales = { ...locales, [anteriorId]: { ...db.locales[anteriorId], estado: 'activo' } };
  // Revisiones: mover la del local de campo al anterior.
  const revs = { ...db.revisiones };
  for (const [k, r] of Object.entries(revs)) {
    if (r.localId === nuevoLocalId) {
      delete revs[k];
      revs[`${r.campanaId}|${anteriorId}`] = { ...r, localId: anteriorId };
    }
  }
  db.revisiones = revs;
  db.vinculos = { ...db.vinculos, [vinculoId]: { ...v, localId: anteriorId, confianza: 'confirmada', criterio: 'Revisado: mismo espacio físico que el local anterior', revisadoPorId: revisorId, candidatos: [] } };
  return db;
}

export function vinculosPendientes(db: BaseDatos, campanaId?: Id): VinculoHistorico[] {
  return Object.values(db.vinculos).filter((v) => {
    if (v.confianza !== 'dudosa' && v.confianza !== 'probable') return false;
    if (!campanaId) return true;
    const o = v.origen.tipo === 'observacion' ? db.observaciones[v.origen.id] : undefined;
    return o?.campanaId === campanaId;
  });
}

export function nuevoVinculo(v: Omit<VinculoHistorico, 'id'>): VinculoHistorico {
  return { id: nuevoId('vin'), ...v };
}
