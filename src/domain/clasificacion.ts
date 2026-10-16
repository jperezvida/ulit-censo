import type { BaseDatos } from './db';
import { ErrorDominio, kNC, kRev } from './db';
import { anioDe, revisionDe } from './consultas';
import { comprobarAlcance, comprobarEditable, localesDeNegocioEnCampana, type Alcance } from './bloqueo';
import { TAXONOMIA_POR_ID } from './taxonomy';
import type { ClasificacionCampana, Id } from './types';

/**
 * Clasificación de actividad POR CAMPAÑA. Corregir la clasificación de 2026 nunca
 * modifica la de 2025, y una categoría anterior solo se reutiliza como borrador.
 */

export function clasificacionEn(db: BaseDatos, negocioId: Id | null | undefined, campanaId: Id): ClasificacionCampana | undefined {
  return negocioId ? db.clasificaciones[kNC(negocioId, campanaId)] : undefined;
}

/** La clasificación más reciente del MISMO negocio en una campaña anterior (solo referencia). */
export function clasificacionAnterior(db: BaseDatos, negocioId: Id, campanaId: Id): ClasificacionCampana | undefined {
  const anio = anioDe(db, campanaId);
  let mejor: ClasificacionCampana | undefined;
  for (const c of Object.values(db.clasificaciones)) {
    if (c.negocioId !== negocioId || c.campanaId === campanaId) continue;
    const a = anioDe(db, c.campanaId);
    if (a < anio && (!mejor || a > anioDe(db, mejor.campanaId))) mejor = c;
  }
  return mejor;
}

function locales(db: BaseDatos, negocioId: Id, campanaId: Id) {
  return localesDeNegocioEnCampana(db, negocioId, campanaId, (c) => anioDe(db, c));
}

/** Clasificación decidida por una persona: confirma la categorización de esos registros. */
export function clasificar(
  db: BaseDatos, negocioId: Id, campanaId: Id, actividadId: Id, porId: Id,
  opciones: { alcance?: Alcance; fecha?: string } = {},
): BaseDatos {
  const nodo = TAXONOMIA_POR_ID[actividadId];
  if (!nodo || nodo.nivel !== 4) throw new ErrorDominio('regla', 'Elige una actividad del catálogo (cuarto nivel).');
  const ids = locales(db, negocioId, campanaId);
  comprobarAlcance(db, opciones.alcance, ids);
  for (const id of ids) comprobarEditable(db, campanaId, { localId: id });
  const fecha = opciones.fecha ?? new Date().toISOString();
  const revisiones = { ...db.revisiones };
  for (const id of ids) revisiones[kRev(campanaId, id)] = { ...revisionDe(db, campanaId, id), categorizacion: 'revisado' };
  return {
    ...db,
    revisiones,
    clasificaciones: { ...db.clasificaciones, [kNC(negocioId, campanaId)]: { negocioId, campanaId, actividadId, origen: 'manual', confirmada: true, porId, fecha } },
  };
}

/** Copia la clasificación anterior del MISMO negocio como borrador (no confirma la categorización). */
export function partirDeClasificacionAnterior(db: BaseDatos, negocioId: Id, campanaId: Id, porId: Id, opciones: { alcance?: Alcance } = {}): BaseDatos {
  const ant = clasificacionAnterior(db, negocioId, campanaId);
  if (!ant) return db;
  if (clasificacionEn(db, negocioId, campanaId)) return db; // nunca pisa una clasificación de la campaña
  const ids = locales(db, negocioId, campanaId);
  comprobarAlcance(db, opciones.alcance, ids);
  for (const id of ids) comprobarEditable(db, campanaId, { localId: id });
  return {
    ...db,
    clasificaciones: {
      ...db.clasificaciones,
      [kNC(negocioId, campanaId)]: { negocioId, campanaId, actividadId: ant.actividadId, origen: 'heredado', confirmada: false, porId, fecha: new Date().toISOString() },
    },
  };
}
