import type { BaseDatos } from './db';
import { ErrorDominio } from './db';
import { direccionVigente } from './consultas';
import type { EstadoOficinaItinerario, Id, Itinerario, TramoPlan } from './types';

/**
 * Estado de oficina, bloqueo y alcance de los itinerarios.
 *
 * - El bloqueo afecta solo al itinerario validado y a SU campaña: el mismo local puede
 *   revisarse en campañas posteriores.
 * - El alcance impide que una operación lanzada desde un itinerario modifique locales
 *   de calles que no le pertenecen.
 */

export function estadoOficina(db: BaseDatos, itinerarioId: Id): EstadoOficinaItinerario['estado'] {
  return db.oficinaItinerarios[itinerarioId]?.estado ?? 'en-revision';
}

/** ¿El tramo del itinerario cubre la acera en la que está este número? */
function tramoCubreNumero(t: TramoPlan, numero: number | null): boolean {
  if (t.acera === 'ambas' || numero === null) return true;
  return t.acera === (numero % 2 === 0 ? 'par' : 'impar');
}

/** Itinerarios de una campaña que incluyen la calle (y acera) de un local. */
export function itinerariosDeLocal(db: BaseDatos, campanaId: Id, localId: Id): Itinerario[] {
  const l = db.locales[localId];
  if (!l) return [];
  const d = direccionVigente(l);
  return Object.values(db.itinerarios).filter(
    (it) => it.campanaId === campanaId && it.tramos.some((t) => t.calleId === d.calleId && tramoCubreNumero(t, d.numero)),
  );
}

export function itinerariosDeCalle(db: BaseDatos, campanaId: Id, calleId: Id): Itinerario[] {
  return Object.values(db.itinerarios).filter((it) => it.campanaId === campanaId && it.tramos.some((t) => t.calleId === calleId));
}

/** Lanza ErrorDominio si el local (o la calle) pertenece a un itinerario validado de ESA campaña. */
export function comprobarEditable(db: BaseDatos, campanaId: Id, objetivo: { localId?: Id; calleId?: Id }): void {
  const its = objetivo.localId ? itinerariosDeLocal(db, campanaId, objetivo.localId) : objetivo.calleId ? itinerariosDeCalle(db, campanaId, objetivo.calleId) : [];
  const validado = its.find((it) => estadoOficina(db, it.id) === 'validado');
  if (validado) {
    throw new ErrorDominio('bloqueado', `${validado.codigo} está validado: reábrelo (con motivo) para modificar sus registros.`, [validado.id]);
  }
}

export interface Alcance {
  itinerarioId: Id;
}

/** Lanza ErrorDominio si algún local queda fuera del itinerario de trabajo. */
export function comprobarAlcance(db: BaseDatos, alcance: Alcance | undefined, localIds: Id[]): void {
  if (!alcance) return;
  const it = db.itinerarios[alcance.itinerarioId];
  if (!it) throw new ErrorDominio('fuera-de-alcance', 'Itinerario de trabajo inexistente.');
  const fuera = localIds.filter((id) => !itinerariosDeLocal(db, it.campanaId, id).some((x) => x.id === it.id));
  if (fuera.length) {
    throw new ErrorDominio('fuera-de-alcance', `${fuera.length} registro(s) no pertenecen a ${it.codigo}: no se modifican desde este itinerario.`, fuera);
  }
}

/** Cambia el estado de oficina. La comprobación previa de validación llega en el bloque C. */
export function validarItinerario(db: BaseDatos, itinerarioId: Id, porId: Id, fecha = new Date().toISOString()): BaseDatos {
  const it = db.itinerarios[itinerarioId];
  if (!it) throw new ErrorDominio('regla', 'Itinerario inexistente.');
  const actual = db.oficinaItinerarios[itinerarioId] ?? { itinerarioId, campanaId: it.campanaId, estado: 'en-revision' as const, historial: [] };
  if (actual.estado === 'validado') return db;
  return {
    ...db,
    oficinaItinerarios: { ...db.oficinaItinerarios, [itinerarioId]: { ...actual, estado: 'validado', historial: [...actual.historial, { accion: 'validar', porId, fecha }] } },
  };
}

export function reabrirItinerario(db: BaseDatos, itinerarioId: Id, porId: Id, motivo: string, fecha = new Date().toISOString()): BaseDatos {
  const actual = db.oficinaItinerarios[itinerarioId];
  if (!actual || actual.estado !== 'validado') throw new ErrorDominio('regla', 'Solo se puede reabrir un itinerario validado.');
  if (!motivo.trim()) throw new ErrorDominio('regla', 'Indica el motivo de la reapertura.');
  return {
    ...db,
    oficinaItinerarios: { ...db.oficinaItinerarios, [itinerarioId]: { ...actual, estado: 'reabierto', historial: [...actual.historial, { accion: 'reabrir', porId, fecha, motivo: motivo.trim() }] } },
  };
}

/** Locales cuya ocupación en la campaña corresponde a un negocio (para propagar estados). */
export function localesDeNegocioEnCampana(db: BaseDatos, negocioId: Id, campanaId: Id, anioDe: (c?: Id) => number): Id[] {
  const anio = anioDe(campanaId);
  return [
    ...new Set(
      Object.values(db.ocupaciones)
        .filter((o) => o.negocioId === negocioId && anioDe(o.desdeCampanaId) <= anio && (!o.hastaCampanaId || anio <= anioDe(o.hastaCampanaId)))
        .map((o) => o.localId),
    ),
  ];
}
