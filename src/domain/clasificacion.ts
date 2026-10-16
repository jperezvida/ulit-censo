import type { BaseDatos } from './db';
import { ErrorDominio, kNC, kRev } from './db';
import { anioDe, revisionDe } from './consultas';
import { prepararOperacionNegocio, type Alcance } from './bloqueo';
import { hijosDe, TAXONOMIA_POR_ID } from './taxonomy';
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

/**
 * Clasificación decidida por una persona: confirma la categorización de los registros donde
 * el negocio es el ocupante VIGENTE (no la de quien le sustituyó en el mismo local).
 *
 * No se exige siempre el cuarto nivel: el procedimiento 2026 admite nodos sin actividades
 * (p. ej. Discotecas) y, en Servicios, el subgrupo con una breve descripción. Un nodo con
 * actividades por debajo solo se acepta acompañado de descripción. La validación completa
 * del catálogo depurado llega con el bloque de catálogo.
 */
export function clasificar(
  db: BaseDatos, negocioId: Id, campanaId: Id, actividadId: Id, porId: Id,
  opciones: { alcance?: Alcance; fecha?: string; descripcion?: string } = {},
): BaseDatos {
  const nodo = TAXONOMIA_POR_ID[actividadId];
  const descripcion = opciones.descripcion?.trim() || undefined;
  if (!nodo) throw new ErrorDominio('regla', 'Elige un nodo del catálogo de actividades.');
  if (hijosDe(nodo.id).length && (!descripcion || nodo.nivel < 3)) {
    throw new ErrorDominio('regla', `«${nodo.nombre}» tiene actividades por debajo: elige una o añade una breve descripción al subgrupo.`);
  }
  const ids = prepararOperacionNegocio(db, negocioId, campanaId, opciones.alcance);
  const fecha = opciones.fecha ?? new Date().toISOString();
  const revisiones = { ...db.revisiones };
  for (const id of ids) revisiones[kRev(campanaId, id)] = { ...revisionDe(db, campanaId, id), categorizacion: 'revisado' };
  return {
    ...db,
    revisiones,
    clasificaciones: { ...db.clasificaciones, [kNC(negocioId, campanaId)]: { negocioId, campanaId, actividadId, descripcion, origen: 'manual', confirmada: true, porId, fecha } },
  };
}

/** Copia la clasificación anterior del MISMO negocio como borrador (no confirma la categorización). */
export function partirDeClasificacionAnterior(db: BaseDatos, negocioId: Id, campanaId: Id, porId: Id, opciones: { alcance?: Alcance } = {}): BaseDatos {
  const ant = clasificacionAnterior(db, negocioId, campanaId);
  if (!ant) return db;
  if (clasificacionEn(db, negocioId, campanaId)) return db; // nunca pisa una clasificación de la campaña
  prepararOperacionNegocio(db, negocioId, campanaId, opciones.alcance);
  return {
    ...db,
    clasificaciones: {
      ...db.clasificaciones,
      [kNC(negocioId, campanaId)]: { negocioId, campanaId, actividadId: ant.actividadId, descripcion: ant.descripcion, origen: 'heredado', confirmada: false, porId, fecha: new Date().toISOString() },
    },
  };
}
