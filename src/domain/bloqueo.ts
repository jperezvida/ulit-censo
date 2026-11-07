import type { BaseDatos } from './db';
import { ErrorDominio } from './db';
import { abarca, indiceOcupaciones, itinerariosDeOrigen, ocupacionEn, type IndiceOcupaciones } from './consultas';
import { direccionDeLocal, itinerariosDeDireccionEfectiva } from './ambito';
import type { Acera, EstadoOficinaItinerario, Id, Itinerario, LngLat, Ocupacion, TramoPlan } from './types';

/**
 * Estado de oficina, bloqueo y alcance de los itinerarios.
 *
 * - El bloqueo afecta solo al itinerario cerrado o validado y a SU campaña: el mismo local
 *   puede revisarse en campañas posteriores.
 * - El alcance impide que una operación lanzada desde un itinerario modifique registros
 *   que no le pertenecen. Las comprobaciones se hacen ANTES de modificar nada, de modo que
 *   una operación rechazada no deja cambios parciales.
 */

export function estadoOficina(db: BaseDatos, itinerarioId: Id): EstadoOficinaItinerario['estado'] {
  return db.oficinaItinerarios[itinerarioId]?.estado ?? 'en-revision';
}

/** Cerrado provisionalmente o validado: sus registros de esa campaña no se editan. */
export function estaBloqueado(db: BaseDatos, itinerarioId: Id): boolean {
  const e = estadoOficina(db, itinerarioId);
  return e === 'revision-cerrada' || e === 'validado';
}

export const ESTADO_OFICINA_TXT: Record<EstadoOficinaItinerario['estado'], string> = {
  'en-revision': 'En revisión',
  'revision-cerrada': 'Revisión cerrada (provisional, no apta para exportación municipal)',
  validado: 'Validado',
  reabierto: 'Reabierto',
};

function tramoCubreAcera(t: TramoPlan, acera: Acera | undefined): boolean {
  return !acera || acera === 'ambas' || t.acera === 'ambas' || t.acera === acera;
}

/** Itinerarios de una campaña que cubren una dirección (calle, acera según el número y segmento). */
export function itinerariosDeDireccion(db: BaseDatos, campanaId: Id, calleId: Id, numero: number | null | undefined, coord?: LngLat): Itinerario[] {
  return itinerariosDeDireccionEfectiva(db, campanaId, { calleId, numero, coord });
}

// ───────────── Índices de lote (operaciones masivas) ─────────────

/**
 * Durante una operación masiva (acciones sobre miles de registros) se comprueban muchas veces
 * los mismos locales, negocios e itinerarios. `enLote` precalcula esos índices UNA vez y solo se
 * usan mientras los objetos de origen sean los mismos (por identidad): las operaciones masivas
 * no cambian locales, ocupaciones ni itinerarios. Las reglas no cambian; solo el coste.
 */
interface IndicesLote {
  ocupaciones: BaseDatos['ocupaciones'];
  itinerarios: BaseDatos['itinerarios'];
  locales: BaseDatos['locales'];
  porNegocio: Map<Id, Ocupacion[]>;
  indiceOcu: IndiceOcupaciones;
  itLocal: Map<string, Itinerario[]>;
}
let lote: IndicesLote | null = null;

export function enLote<T>(db: BaseDatos, fn: () => T): T {
  const previo = lote;
  const porNegocio = new Map<Id, Ocupacion[]>();
  for (const o of Object.values(db.ocupaciones)) if (o.negocioId) porNegocio.set(o.negocioId, [...(porNegocio.get(o.negocioId) ?? []), o]);
  lote = { ocupaciones: db.ocupaciones, itinerarios: db.itinerarios, locales: db.locales, porNegocio, indiceOcu: indiceOcupaciones(db), itLocal: new Map() };
  try {
    return fn();
  } finally {
    lote = previo;
  }
}
const loteValido = (db: BaseDatos) => !!lote && lote.ocupaciones === db.ocupaciones && lote.itinerarios === db.itinerarios && lote.locales === db.locales;

/** Itinerarios de una campaña cuyo ámbito efectivo incluye el local. */
export function itinerariosDeLocal(db: BaseDatos, campanaId: Id, localId: Id): Itinerario[] {
  const l = db.locales[localId];
  if (!l) return [];
  // G4: itinerarios de cuyo Excel incorporado procede una fila del local, además del ámbito planificado.
  const origen = itinerariosDeOrigen(db, campanaId, localId);
  if (origen.length) {
    const geo = itinerariosDeDireccionEfectiva(db, campanaId, direccionDeLocal(l));
    return [...geo, ...origen.filter((id) => !geo.some((x) => x.id === id)).map((id) => db.itinerarios[id]).filter((x): x is Itinerario => !!x)];
  }
  if (loteValido(db)) {
    const k = `${campanaId}|${localId}`;
    let r = lote!.itLocal.get(k);
    if (!r) lote!.itLocal.set(k, (r = itinerariosDeDireccionEfectiva(db, campanaId, direccionDeLocal(l))));
    return r;
  }
  return itinerariosDeDireccionEfectiva(db, campanaId, direccionDeLocal(l));
}

export function itinerariosDeCalle(db: BaseDatos, campanaId: Id, calleId: Id, acera?: Acera): Itinerario[] {
  return Object.values(db.itinerarios).filter((it) => it.campanaId === campanaId && it.tramos.some((t) => t.calleId === calleId && tramoCubreAcera(t, acera)));
}

export type Objetivo = { localId: Id } | { calleId: Id; numero?: number | null; acera?: Acera; coord?: LngLat };

function itinerariosDeObjetivo(db: BaseDatos, campanaId: Id, o: Objetivo): Itinerario[] {
  if ('localId' in o) return itinerariosDeLocal(db, campanaId, o.localId);
  if (o.numero !== undefined) return itinerariosDeDireccion(db, campanaId, o.calleId, o.numero, o.coord);
  return itinerariosDeCalle(db, campanaId, o.calleId, o.acera);
}

/** Lanza ErrorDominio si el objetivo pertenece a un itinerario cerrado o validado de ESA campaña. */
export function comprobarEditable(db: BaseDatos, campanaId: Id, objetivo: Objetivo): void {
  const bloqueado = itinerariosDeObjetivo(db, campanaId, objetivo).find((it) => estaBloqueado(db, it.id));
  if (bloqueado) {
    const como = estadoOficina(db, bloqueado.id) === 'validado' ? 'está validado' : 'tiene la revisión cerrada';
    throw new ErrorDominio('bloqueado', `${bloqueado.codigo} ${como}: reábrelo (con motivo) para modificar sus registros.`, [bloqueado.id]);
  }
}

export interface Alcance {
  itinerarioId: Id;
}

function itinerarioDeAlcance(db: BaseDatos, alcance: Alcance): Itinerario {
  const it = db.itinerarios[alcance.itinerarioId];
  if (!it) throw new ErrorDominio('fuera-de-alcance', 'Itinerario de trabajo inexistente.');
  return it;
}

/** Lanza ErrorDominio si algún local queda fuera del itinerario de trabajo. */
export function comprobarAlcance(db: BaseDatos, alcance: Alcance | undefined, localIds: Id[]): void {
  if (!alcance) return;
  const it = itinerarioDeAlcance(db, alcance);
  const fuera = localIds.filter((id) => !itinerariosDeLocal(db, it.campanaId, id).some((x) => x.id === it.id));
  if (fuera.length) {
    throw new ErrorDominio('fuera-de-alcance', `${fuera.length} registro(s) no pertenecen a ${it.codigo}: no se modifican desde este itinerario.`, fuera);
  }
}

/** Lo mismo para una dirección o una calle (altas de locales, cierre de calle). */
export function comprobarAlcanceObjetivo(db: BaseDatos, alcance: Alcance | undefined, objetivo: Objetivo): void {
  if (!alcance) return;
  const it = itinerarioDeAlcance(db, alcance);
  if (!itinerariosDeObjetivo(db, it.campanaId, objetivo).some((x) => x.id === it.id)) {
    throw new ErrorDominio('fuera-de-alcance', `La dirección no pertenece a ${it.codigo}: no se modifica desde este itinerario.`);
  }
}

/**
 * Locales asociados a un negocio en una campaña.
 *  - `todos`: cualquier ocupación del negocio que abarque la campaña, incluidas las ya
 *    sustituidas (sirve para bloqueo y alcance: tocar el negocio afecta a esos registros).
 *  - `vigentes`: locales donde el negocio es el ocupante VIGENTE al final de la campaña
 *    (los únicos cuyos estados de revisión se actualizan).
 * Así, revisar Bar Delia después de que Perfumería Sol ocupe su local no altera la
 * revisión de Perfumería Sol.
 */
export function localesDeNegocio(db: BaseDatos, negocioId: Id, campanaId: Id): { todos: Id[]; vigentes: Id[] } {
  const enL = loteValido(db);
  const ocs = enL ? lote!.porNegocio.get(negocioId) ?? [] : Object.values(db.ocupaciones).filter((o) => o.negocioId === negocioId);
  const todos = [...new Set(ocs.filter((o) => abarca(db, o, campanaId)).map((o) => o.localId))];
  const vigentes = todos.filter((l) => ocupacionEn(db, l, campanaId, enL ? lote!.indiceOcu : undefined)?.negocioId === negocioId);
  return { todos, vigentes };
}

/**
 * Comprueba existencia, alcance y bloqueo de una operación sobre un negocio en una campaña
 * y devuelve los locales cuyos estados de revisión deben actualizarse (solo los vigentes).
 * Si el negocio estuvo en varios locales, TODOS deben estar dentro del alcance.
 */
export function prepararOperacionNegocio(db: BaseDatos, negocioId: Id, campanaId: Id, alcance?: Alcance): Id[] {
  const { todos, vigentes } = localesDeNegocio(db, negocioId, campanaId);
  if (!todos.length) throw new ErrorDominio('regla', 'El negocio no consta en esta campaña: no se puede revisar en ella.');
  comprobarAlcance(db, alcance, todos);
  for (const id of todos) comprobarEditable(db, campanaId, { localId: id });
  return vigentes;
}

function conEstado(db: BaseDatos, itinerarioId: Id, estado: EstadoOficinaItinerario['estado'], entrada: EstadoOficinaItinerario['historial'][number]): BaseDatos {
  const it = db.itinerarios[itinerarioId];
  const actual = db.oficinaItinerarios[itinerarioId] ?? { itinerarioId, campanaId: it.campanaId, estado: 'en-revision' as const, historial: [] };
  return { ...db, oficinaItinerarios: { ...db.oficinaItinerarios, [itinerarioId]: { ...actual, estado, historial: [...actual.historial, entrada] } } };
}

/**
 * Cierre PROVISIONAL de la revisión del itinerario. Registra quién hace la revisión final y
 * cuándo (puede ser la misma persona que categorizó: no se exige separación de funciones) y
 * bloquea la edición en esa campaña. NO es la validación definitiva ni habilita la
 * exportación municipal: eso exige los controles del bloque C.
 */
export function cerrarRevisionItinerario(db: BaseDatos, itinerarioId: Id, porId: Id, fecha = new Date().toISOString()): BaseDatos {
  if (!db.itinerarios[itinerarioId]) throw new ErrorDominio('regla', 'Itinerario inexistente.');
  if (estaBloqueado(db, itinerarioId)) return db;
  return conEstado(db, itinerarioId, 'revision-cerrada', { accion: 'cerrar-revision', porId, fecha });
}

/** Resultado de los controles previos a la validación definitiva. */
export interface ControlesValidacion {
  /** false mientras los controles del bloque C no estén implementados. */
  disponibles: boolean;
  pendientes: string[];
}

/** Controles previos a la validación definitiva. Hasta el bloque C, siempre «no disponibles». */
export function controlesValidacion(_db: BaseDatos, _itinerarioId: Id): ControlesValidacion {
  return {
    disponibles: false,
    pendientes: [
      'Controles de completitud y coherencia del itinerario (bloque C2) sin implementar',
      'Contrato de estructura del perfil municipal 2026 pendiente de confirmar por informática (bloque C3)',
    ],
  };
}

/**
 * Validación DEFINITIVA (apta para consolidación municipal). Exige superar todos los
 * controles; mientras estén pendientes de implementar, se rechaza siempre.
 */
export function validarItinerario(db: BaseDatos, itinerarioId: Id, porId: Id, fecha = new Date().toISOString()): BaseDatos {
  if (!db.itinerarios[itinerarioId]) throw new ErrorDominio('regla', 'Itinerario inexistente.');
  if (estadoOficina(db, itinerarioId) === 'validado') return db;
  const c = controlesValidacion(db, itinerarioId);
  if (!c.disponibles || c.pendientes.length) {
    throw new ErrorDominio('verificacion-incompleta', 'La validación definitiva no está disponible: quedan controles pendientes. Puedes cerrar la revisión de forma provisional.', c.pendientes);
  }
  return conEstado(db, itinerarioId, 'validado', { accion: 'validar', porId, fecha });
}

export function reabrirItinerario(db: BaseDatos, itinerarioId: Id, porId: Id, motivo: string, fecha = new Date().toISOString()): BaseDatos {
  if (!estaBloqueado(db, itinerarioId)) throw new ErrorDominio('regla', 'Solo se puede reabrir un itinerario cerrado o validado.');
  if (!motivo.trim()) throw new ErrorDominio('regla', 'Indica el motivo de la reapertura.');
  return conEstado(db, itinerarioId, 'reabierto', { accion: 'reabrir', porId, fecha, motivo: motivo.trim() });
}
