import type { BaseDatos } from './db';
import { direccionVigente, itinerariosDeOrigen } from './consultas';
import { distanciaPuntoLinea } from './geo';
import type { Id, Itinerario, LngLat, LocalFisico, TramoPlan } from './types';

/**
 * Ámbito territorial EFECTIVO de un itinerario: calle, acera (paridad del número) y, cuando
 * el tramo se limita a algunos segmentos, el segmento en el que está el local.
 *
 * Una calle puede repartirse entre varios itinerarios (pares/impares o por segmentos): la
 * pertenencia de un local nunca se deduce solo de la calle.
 */

export interface Direccion {
  calleId: Id;
  numero: number | null | undefined;
  coord?: LngLat;
}

/** Segmento de la calle más cercano a una coordenada (undefined si no se puede saber). */
export function segmentoMasCercano(db: BaseDatos, calleId: Id, coord?: LngLat): Id | undefined {
  const calle = db.calles[calleId];
  if (!calle || !coord || !calle.segmentos.length) return undefined;
  if (calle.segmentos.length === 1) return calle.segmentos[0].id;
  let mejor: { id: Id; d: number } | undefined;
  for (const s of calle.segmentos) {
    const d = distanciaPuntoLinea(coord, s.coords);
    if (!mejor || d < mejor.d) mejor = { id: s.id, d };
  }
  return mejor?.id;
}

export function tramoCubreAcera(t: TramoPlan, numero: number | null | undefined): boolean {
  if (t.acera === 'ambas' || numero === null || numero === undefined) return true;
  return t.acera === (numero % 2 === 0 ? 'par' : 'impar');
}

/**
 * ¿El tramo cubre la dirección? Si el tramo se limita a segmentos y no se puede situar el
 * local (sin coordenadas), se considera cubierto: es preferible que un local figure en dos
 * itinerarios (y se marque como pertenencia ambigua) a que desaparezca del seguimiento.
 */
export function tramoCubre(db: BaseDatos, t: TramoPlan, d: Direccion): boolean {
  if (t.calleId !== d.calleId || !tramoCubreAcera(t, d.numero)) return false;
  if (!t.segmentoIds?.length) return true;
  const seg = segmentoMasCercano(db, d.calleId, d.coord);
  return seg === undefined || t.segmentoIds.includes(seg);
}

export function direccionDeLocal(l: LocalFisico): Direccion {
  const d = direccionVigente(l);
  return { calleId: d.calleId, numero: d.numero, coord: l.coord };
}

/** Itinerarios de una campaña cuyo ámbito efectivo cubre la dirección. */
export function itinerariosDeDireccionEfectiva(db: BaseDatos, campanaId: Id, d: Direccion, itinerarios?: Itinerario[]): Itinerario[] {
  const lista = itinerarios ?? Object.values(db.itinerarios).filter((it) => it.campanaId === campanaId);
  return lista.filter((it) => it.campanaId === campanaId && it.tramos.some((t) => tramoCubre(db, t, d)));
}

/**
 * Índice de pertenencia local → itinerarios para una campaña. Precalcula por calle los
 * tramos implicados para que el coste sea proporcional al número de locales.
 */
export function indicePertenencia(db: BaseDatos, campanaId: Id, locales: LocalFisico[]): Map<Id, Id[]> {
  const porCalle = new Map<Id, { it: Itinerario; t: TramoPlan }[]>();
  for (const it of Object.values(db.itinerarios)) {
    if (it.campanaId !== campanaId) continue;
    for (const t of it.tramos) porCalle.set(t.calleId, [...(porCalle.get(t.calleId) ?? []), { it, t }]);
  }
  const out = new Map<Id, Id[]>();
  for (const l of locales) {
    const d = direccionDeLocal(l);
    const cands = porCalle.get(d.calleId) ?? [];
    const ids: Id[] = [];
    for (const { it, t } of cands) if (!ids.includes(it.id) && tramoCubre(db, t, d)) ids.push(it.id);
    // G4: también pertenece al itinerario de cuyo Excel incorporado procede su fila (aunque no esté planificado).
    for (const id of itinerariosDeOrigen(db, campanaId, l.id)) if (!ids.includes(id)) ids.push(id);
    out.set(l.id, ids);
  }
  return out;
}
