import type { BaseDatos } from './db';
import { ErrorDominio, kNC, kRev } from './db';
import { anioDe, reabrirAprobaciones, revisionDe } from './consultas';
import { prepararOperacionNegocio, type Alcance } from './bloqueo';
import type { FranquiciaCampana, Id, Respuesta, Revisado, Revision } from './types';

/**
 * Franquicias (B5). Tres datos distintos:
 *  - Franquicia: Sí / No comprobado en la campaña (`db.franquicias`, por negocio y campaña).
 *  - Nombre de cadena: dato descriptivo del negocio (`Negocio.cadena`). No implica franquicia,
 *    y su ausencia no significa «No».
 *  - Revisión de franquicias: pendiente / revisado (`Revision.franquicia`), con quién y cuándo.
 *
 * Reglas:
 *  - Solo un Sí o No registrado por una persona deja la revisión «revisado». «Sin información»
 *    queda registrado pero la revisión sigue pendiente; «no aplicable» no se admite.
 *  - Lo copiado de otra campaña entra como borrador («heredado») y nunca como revisado.
 *  - Cambiar la respuesta conserva el historial y devuelve a pendiente la aprobación general.
 */

export function revisionFranquicia(r: Pick<Revision, 'franquicia'> | undefined): Revisado {
  return r?.franquicia ?? 'pendiente';
}

export function franquiciaEn(db: BaseDatos, negocioId: Id | null | undefined, campanaId: Id): FranquiciaCampana | undefined {
  return negocioId ? db.franquicias?.[kNC(negocioId, campanaId)] : undefined;
}

/** La franquicia más reciente del MISMO negocio en una campaña anterior (solo referencia). */
export function franquiciaAnterior(db: BaseDatos, negocioId: Id, campanaId: Id): FranquiciaCampana | undefined {
  const anio = anioDe(db, campanaId);
  let mejor: FranquiciaCampana | undefined;
  for (const f of Object.values(db.franquicias ?? {})) {
    if (f.negocioId !== negocioId || f.campanaId === campanaId) continue;
    const a = anioDe(db, f.campanaId);
    if (a < anio && (!mejor || a > anioDe(db, mejor.campanaId))) mejor = f;
  }
  return mejor;
}

const comprobada = (f?: Pick<FranquiciaCampana, 'respuesta' | 'origen'>) => !!f && f.origen === 'manual' && (f.respuesta === 'si' || f.respuesta === 'no');

/** Copias de trabajo que una operación (o un lote de operaciones) modifica en su sitio. */
interface Trabajo {
  revisiones: BaseDatos['revisiones'];
  franquicias: BaseDatos['franquicias'];
}

/** Núcleo de `registrarFranquicia`: modifica las copias de trabajo. Devuelve si hubo cambio. */
function aplicarFranquicia(db0: BaseDatos, w: Trabajo, negocioId: Id, campanaId: Id, respuesta: Respuesta, porId: Id, opciones: { alcance?: Alcance; fecha?: string }): boolean {
  if (respuesta === 'na') throw new ErrorDominio('regla', 'Franquicia no admite «no aplicable»: registra Sí, No o sin información.');
  const vista: BaseDatos = { ...db0, revisiones: w.revisiones, franquicias: w.franquicias };
  const ids = prepararOperacionNegocio(vista, negocioId, campanaId, opciones.alcance);
  const k = kNC(negocioId, campanaId);
  const actual = w.franquicias[k];
  // Repetir la misma respuesta manual no es un cambio (sí lo es confirmar un dato heredado).
  if (actual && actual.respuesta === respuesta && actual.origen === 'manual') return false;
  if (!actual && respuesta === 'pendiente') return false;
  const fecha = opciones.fecha ?? new Date().toISOString();
  const nuevo: FranquiciaCampana = {
    negocioId, campanaId, respuesta, origen: 'manual', porId, fecha,
    historial: [...(actual?.historial ?? []), { respuesta, origen: 'manual', porId, fecha }],
  };
  const revisada = comprobada(nuevo);
  for (const id of ids) {
    const r = revisionDe(vista, campanaId, id);
    w.revisiones[kRev(campanaId, id)] = revisada ? { ...r, franquicia: 'revisado', franquiciaPor: porId, franquiciaEn: fecha } : { ...r, franquicia: 'pendiente', franquiciaPor: undefined, franquiciaEn: undefined };
  }
  // Cambiar un dato que ya estaba revisado invalida la aprobación general que dependía de él.
  if (comprobada(actual)) reabrirAprobaciones(w.revisiones, campanaId, ids, porId, fecha, 'Cambio en franquicia');
  w.franquicias[k] = nuevo;
  return true;
}

/** Registra la respuesta de franquicia de un negocio en una campaña (1/0, ¿? o pendiente). */
export function registrarFranquicia(
  db0: BaseDatos, negocioId: Id, campanaId: Id, respuesta: Respuesta, porId: Id,
  opciones: { alcance?: Alcance; fecha?: string } = {},
): BaseDatos {
  return registrarFranquiciaLote(db0, [negocioId], campanaId, respuesta, porId, opciones);
}

/** La misma operación sobre varios negocios con una sola copia de trabajo (acciones masivas). */
export function registrarFranquiciaLote(
  db0: BaseDatos, negocioIds: Id[], campanaId: Id, respuesta: Respuesta, porId: Id,
  opciones: { alcance?: Alcance; fecha?: string } = {},
): BaseDatos {
  const w: Trabajo = { revisiones: { ...db0.revisiones }, franquicias: { ...db0.franquicias } };
  let cambio = false;
  for (const n of negocioIds) cambio = aplicarFranquicia(db0, w, n, campanaId, respuesta, porId, opciones) || cambio;
  return cambio ? { ...db0, ...w } : db0;
}

/**
 * Copia la franquicia anterior del MISMO negocio como borrador («heredado»): no cuenta como
 * revisada. Nunca pisa una respuesta de esta campaña. Solo se copia un Sí o un No; cualquier
 * otro valor histórico se deja sin copiar (lo señala `partirDe2025`).
 */
export function partirDeFranquiciaAnterior(db0: BaseDatos, negocioId: Id, campanaId: Id, porId: Id, opciones: { alcance?: Alcance } = {}): BaseDatos {
  const w: BaseDatos = { ...db0, franquicias: { ...db0.franquicias } };
  return heredarFranquiciaEnCopia(w, negocioId, campanaId, porId, opciones) ? w : db0;
}

/** Núcleo de `partirDeFranquiciaAnterior`: escribe en `w.franquicias` (copia de quien llama). */
export function heredarFranquiciaEnCopia(
  w: BaseDatos, negocioId: Id, campanaId: Id, porId: Id, opciones: { alcance?: Alcance } = {},
  ant: FranquiciaCampana | undefined = franquiciaAnterior(w, negocioId, campanaId),
): boolean {
  if (!ant || (ant.respuesta !== 'si' && ant.respuesta !== 'no')) return false;
  const k = kNC(negocioId, campanaId);
  if (w.franquicias[k] && w.franquicias[k].respuesta !== 'pendiente') return false;
  prepararOperacionNegocio(w, negocioId, campanaId, opciones.alcance);
  const fecha = new Date().toISOString();
  w.franquicias[k] = {
    negocioId, campanaId, respuesta: ant.respuesta, origen: 'heredado', porId, fecha, desdeCampanaId: ant.campanaId,
    historial: [...(w.franquicias[k]?.historial ?? []), { respuesta: ant.respuesta, origen: 'heredado', porId, fecha, desdeCampanaId: ant.campanaId }],
  };
  return true;
}
