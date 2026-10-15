import type { BaseDatos } from './db';
import { kMet } from './db';
import { direccionVigente, indiceObservaciones, indiceOcupaciones, observacionEn, ocupacionEn } from './consultas';
import { grupoActividad } from './taxonomy';
import type { Campana, Id } from './types';

/** Calles con observaciones en una campaña (para censos importados sin ámbito declarado). */
export function ambitoEfectivo(c: Campana): Set<Id> {
  return new Set(c.ambitoCalleIds);
}

export interface ResumenCampana {
  locales: number;
  ocupados: number;
  vacios: number;
  porGrupo: Record<string, number>;
  digital: { verificados: number; sinVerificar: number; conWeb: number; conInstagram: number; conGoogle: number };
}

export function resumenCampana(db: BaseDatos, campanaId: Id, calles?: Set<Id>): ResumenCampana {
  const ixO = indiceObservaciones(db);
  const ixOc = indiceOcupaciones(db);
  const r: ResumenCampana = { locales: 0, ocupados: 0, vacios: 0, porGrupo: {}, digital: { verificados: 0, sinVerificar: 0, conWeb: 0, conInstagram: 0, conGoogle: 0 } };
  for (const l of Object.values(db.locales)) {
    const o = observacionEn(ixO.get(l.id), campanaId);
    if (!o || o.tipo === 'posible-desaparicion') continue;
    if (calles && !calles.has(o.calleId)) continue;
    r.locales++;
    const oc = ocupacionEn(db, l.id, campanaId, ixOc);
    if (!oc?.negocioId) {
      r.vacios++;
      continue;
    }
    r.ocupados++;
    const neg = db.negocios[oc.negocioId];
    const g = grupoActividad(neg?.actividadId)?.nombre ?? 'Sin clasificar';
    r.porGrupo[g] = (r.porGrupo[g] ?? 0) + 1;
    const m = db.metricas[kMet(oc.negocioId, campanaId)];
    if (m?.verificada) {
      r.digital.verificados++;
      if (m.web) r.digital.conWeb++;
      if (m.instagram) r.digital.conInstagram++;
      if (m.googleBusiness) r.digital.conGoogle++;
    } else r.digital.sinVerificar++;
  }
  return r;
}

export interface Comparacion {
  comparables: Id[];
  ampliacion: Id[];
  anterior: ResumenCampana; // sobre ámbito comparable
  posteriorComparable: ResumenCampana;
  posteriorAmpliacion: ResumenCampana;
  aperturas: number;
  cierres: number;
  cambiosActividad: number;
  sinCambios: number;
  indeterminados: { noObservados: number; altasSinCorrespondencia: number; posiblesDesapariciones: number };
}

/**
 * Compara dos campañas distinguiendo evolución real (ámbito comparable) de
 * incorporaciones por ampliación territorial. Aperturas/cierres solo con
 * correspondencia confirmada; lo demás queda como indeterminado.
 */
export function compararCampanas(db: BaseDatos, anteriorId: Id, posteriorId: Id): Comparacion {
  const A = db.campanas[anteriorId];
  const B = db.campanas[posteriorId];
  const ambA = ambitoEfectivo(A);
  const ambB = ambitoEfectivo(B);
  const comparables = [...ambB].filter((id) => ambA.has(id));
  const ampliacion = [...ambB].filter((id) => !ambA.has(id));
  const setComp = new Set(comparables);
  const ixO = indiceObservaciones(db);
  const ixOc = indiceOcupaciones(db);

  let aperturas = 0, cierres = 0, cambiosActividad = 0, sinCambios = 0, noObservados = 0, altasSinCorr = 0, posDesap = 0;
  const altasConfirmadas = new Set(
    Object.values(db.vinculos).filter((v) => v.confianza === 'confirmada' && v.origen.tipo === 'observacion').map((v) => v.localId),
  );
  const altasDudosas = new Set(
    Object.values(db.vinculos).filter((v) => v.confianza !== 'confirmada' && v.origen.tipo === 'observacion').map((v) => v.localId),
  );

  for (const l of Object.values(db.locales)) {
    const calleId = direccionVigente(l).calleId;
    if (!setComp.has(calleId)) continue;
    const obs = ixO.get(l.id);
    const oA = observacionEn(obs, anteriorId);
    const oB = observacionEn(obs, posteriorId);
    if (oA && !oB) {
      noObservados++;
      continue;
    }
    if (!oB) continue;
    if (oB.tipo === 'posible-desaparicion') {
      posDesap++;
      continue;
    }
    if (!oA) {
      // Alta en la campaña posterior dentro del ámbito comparable
      if (altasDudosas.has(l.id) || !altasConfirmadas.has(l.id)) altasSinCorr++;
      else if (ocupacionEn(db, l.id, posteriorId, ixOc)?.negocioId) aperturas++;
      continue;
    }
    const nA = ocupacionEn(db, l.id, anteriorId, ixOc)?.negocioId ?? null;
    const nB = ocupacionEn(db, l.id, posteriorId, ixOc)?.negocioId ?? null;
    if (!nA && nB) aperturas++;
    else if (nA && !nB) cierres++;
    else if (nA && nB && nA !== nB) cambiosActividad++;
    else sinCambios++;
  }

  return {
    comparables,
    ampliacion,
    anterior: resumenCampana(db, anteriorId, setComp),
    posteriorComparable: resumenCampana(db, posteriorId, setComp),
    posteriorAmpliacion: resumenCampana(db, posteriorId, new Set(ampliacion)),
    aperturas, cierres, cambiosActividad, sinCambios,
    indeterminados: { noObservados, altasSinCorrespondencia: altasSinCorr, posiblesDesapariciones: posDesap },
  };
}
