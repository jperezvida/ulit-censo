import { ErrorDominio, type BaseDatos } from './db';
import { direccionVigente, localesPrevios, ocupacionEn } from './consultas';
import { claseCampana } from './municipios';
import { confirmarSinCambios } from './campo';
import type { Id } from './types';

/**
 * Campo en el espacio de ensayo · primera escritura: confirmar «Sin cambios» un local del censo anterior.
 *
 * Reutiliza `confirmarSinCambios` (la misma operación de la demostración) y, ANTES, comprueba con los
 * datos vigentes que todo encaja. El resultado es una observación NUEVA de la campaña actual: la
 * observación del censo anterior no se toca. El alcance (acera y tramos del itinerario) y los bloqueos los
 * comprueba la propia operación (`comprobarAlcance`, `comprobarEditable`).
 *
 * Quién registra es una persona INVESTIGADORA asignada al itinerario, declarada en el dispositivo: no es
 * una autenticación. La coordinación no registra en su nombre.
 */
export interface PeticionSinCambios {
  campanaId: Id;
  itinerarioId: Id;
  calleId: Id;
  localId: Id;
  investigadorId: Id;
  fecha: string;
}

/** Personas investigadoras asignadas al itinerario (las únicas que pueden registrar desde Campo). */
export function investigadoresDe(db: BaseDatos, itinerarioId: Id) {
  const it = db.itinerarios[itinerarioId];
  return (it?.asignadosIds ?? []).map((id) => db.personas[id]).filter((p) => !!p && p.roles.includes('investigador'));
}

export function confirmarSinCambiosEnsayo(db: BaseDatos, p: PeticionSinCambios): BaseDatos {
  const c = db.campanas[p.campanaId];
  if (!c || claseCampana(c) !== 'operativa') throw new ErrorDominio('regla', 'La campaña ya no es una campaña operativa de este espacio.');
  const it = db.itinerarios[p.itinerarioId];
  if (!it || it.campanaId !== c.id) throw new ErrorDominio('regla', 'El itinerario no pertenece a esta campaña.');
  const calle = db.calles[p.calleId];
  if (!calle || calle.municipioId !== c.municipioId || !it.tramos.some((t) => t.calleId === calle.id)) throw new ErrorDominio('regla', 'La calle no está planificada en este itinerario.');
  const l = db.locales[p.localId];
  if (!l || l.municipioId !== c.municipioId || direccionVigente(l).calleId !== calle.id) throw new ErrorDominio('regla', 'El local no existe en esta calle.');
  if (!localesPrevios(db, c.campanaReferenciaId, calle.id).some((x) => x.id === l.id)) throw new ErrorDominio('regla', 'El local no figura en el censo anterior: «Sin cambios» no se aplica.');
  if (!investigadoresDe(db, it.id).some((x) => x.id === p.investigadorId)) throw new ErrorDominio('regla', 'La persona no es investigadora asignada a este itinerario.');
  if (Object.values(db.observaciones).some((o) => o.campanaId === c.id && o.localId === l.id)) throw new ErrorDominio('regla', 'Este local ya tiene un registro en la campaña.');
  // La ocupación vigente al final del censo anterior termina en esa campaña (así la deja el importador).
  // «Sin cambios» demuestra que sigue: se prolonga hasta la campaña actual (misma semántica que una
  // visita de la demostración), para que la observación copie su negocio. Nada se borra.
  const oc = ocupacionEn(db, l.id, c.campanaReferenciaId!);
  const base = oc && oc.hastaCampanaId === c.campanaReferenciaId ? { ...db, ocupaciones: { ...db.ocupaciones, [oc.id]: { ...oc, hastaCampanaId: c.id } } } : db;
  return confirmarSinCambios(base, { campanaId: c.id, investigadorId: p.investigadorId, fecha: p.fecha, fuente: 'campo-app', sinConexion: false, alcance: { itinerarioId: it.id } }, l.id);
}
