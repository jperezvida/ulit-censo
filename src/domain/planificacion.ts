import type { BaseDatos } from './db';
import { coberturaCalle, esCompletada, indiceObservaciones, localesPrevios, type IndiceObservaciones } from './consultas';
import type { Acera, Calle, Campana, EstadoCobertura, Id, Itinerario, TramoPlan } from './types';
import { distanciaM, centroide } from './geo';

/** ¿Dos asignaciones de la misma calle se pisan? (acera y segmentos) */
export function seSolapan(a: TramoPlan, b: TramoPlan): boolean {
  if (a.calleId !== b.calleId) return false;
  const aceraSolapa = a.acera === 'ambas' || b.acera === 'ambas' || a.acera === b.acera;
  if (!aceraSolapa) return false;
  const sa = a.segmentoIds?.length ? a.segmentoIds : null;
  const sb = b.segmentoIds?.length ? b.segmentoIds : null;
  if (!sa || !sb) return true;
  return sa.some((s) => sb.includes(s));
}

export interface Solape {
  calleId: Id;
  itinerarios: [Id, Id];
  detalle: string;
}

/** Detecta asignaciones duplicadas entre itinerarios de una campaña (y dentro de uno). */
export function detectarSolapes(itinerarios: Itinerario[]): Solape[] {
  const out: Solape[] = [];
  const todos = itinerarios.flatMap((it) => it.tramos.map((t) => ({ it, t })));
  for (let i = 0; i < todos.length; i++) {
    for (let j = i + 1; j < todos.length; j++) {
      const x = todos[i];
      const y = todos[j];
      if (x.t.calleId !== y.t.calleId) continue;
      if (seSolapan(x.t, y.t)) {
        out.push({
          calleId: x.t.calleId,
          itinerarios: [x.it.id, y.it.id],
          detalle: x.it.id === y.it.id ? `Repetida dentro de ${x.it.codigo}` : `${x.it.codigo} y ${y.it.codigo} (${txtAcera(x.t.acera)} / ${txtAcera(y.t.acera)})`,
        });
      }
    }
  }
  return out;
}

export function txtAcera(a: Acera) {
  return a === 'ambas' ? 'ambas aceras' : a === 'par' ? 'acera par' : 'acera impar';
}

/** Grado de asignación de cada calle del ámbito: completa, parcial o sin asignar. */
export function asignacionDelAmbito(campana: Campana, itinerarios: Itinerario[], calles: Record<Id, Calle>) {
  const porCalle = new Map<Id, TramoPlan[]>();
  for (const it of itinerarios) for (const t of it.tramos) porCalle.set(t.calleId, [...(porCalle.get(t.calleId) ?? []), t]);
  const sinAsignar: Id[] = [];
  const parcial: Id[] = [];
  const completa: Id[] = [];
  for (const id of campana.ambitoCalleIds) {
    const ts = porCalle.get(id);
    if (!ts?.length) {
      sinAsignar.push(id);
      continue;
    }
    if (estaCubierta(ts, calles[id])) completa.push(id);
    else parcial.push(id);
  }
  // Calles asignadas fuera del ámbito declarado (posible ampliación no registrada)
  const fueraAmbito = [...porCalle.keys()].filter((id) => !campana.ambitoCalleIds.includes(id));
  return { sinAsignar, parcial, completa, fueraAmbito, porCalle };
}

/** Una calle está cubierta si cada segmento tiene ambas aceras asignadas. */
export function estaCubierta(tramos: TramoPlan[], calle?: Calle): boolean {
  const segs = calle?.segmentos.map((s) => s.id) ?? ['*'];
  return segs.every((sid) => {
    const aplica = tramos.filter((t) => !t.segmentoIds?.length || t.segmentoIds.includes(sid));
    return aplica.some((t) => t.acera === 'ambas') || (aplica.some((t) => t.acera === 'par') && aplica.some((t) => t.acera === 'impar'));
  });
}

/** Longitud planificada de un tramo (sumando sus segmentos). */
export function longitudTramo(t: TramoPlan, calle?: Calle): number {
  if (!calle) return 0;
  if (!t.segmentoIds?.length) return calle.longitudM;
  return calle.segmentos.filter((s) => t.segmentoIds!.includes(s.id)).reduce((a, s) => a + s.longitudM, 0);
}

export interface Carga {
  longitudM: number;
  /** metros a recorrer contando aceras */
  recorridoM: number;
  localesPrevios: number;
  callesSinPrevios: number;
  horas: number;
}

/**
 * Estimación ORIENTATIVA de carga de campo:
 * recorrido a 2,5 km/h efectivos + 1,5 min por local anterior a revisar
 * + 4 min por cada 100 m de calle sin registros previos (censo desde cero).
 */
export function estimarCarga(db: BaseDatos, campana: Campana, tramos: TramoPlan[], idx?: IndiceObservaciones): Carga {
  const ix = idx ?? indiceObservaciones(db);
  let longitudM = 0;
  let recorridoM = 0;
  let locales = 0;
  let sinPrevios = 0;
  let minutosNuevos = 0;
  for (const t of tramos) {
    const c = db.calles[t.calleId];
    const l = longitudTramo(t, c);
    longitudM += l;
    recorridoM += t.acera === 'ambas' ? l * 2 : l;
    const n = localesPrevios(db, campana.campanaReferenciaId, t.calleId, ix).length;
    const factor = t.segmentoIds?.length && c ? l / (c.longitudM || 1) : 1;
    const nAjustado = Math.round(n * factor * (t.acera === 'ambas' ? 1 : 0.5));
    locales += nAjustado;
    if (n === 0) {
      sinPrevios += 1;
      minutosNuevos += (l / 100) * 4;
    }
  }
  const horas = recorridoM / 2500 + (locales * 1.5) / 60 + minutosNuevos / 60;
  return { longitudM, recorridoM, localesPrevios: locales, callesSinPrevios: sinPrevios, horas };
}

export interface ProgresoItinerario {
  total: number;
  porEstado: Record<EstadoCobertura, number>;
  completadas: number;
  pct: number;
  campoTerminado: boolean;
}

export function progresoItinerario(db: BaseDatos, it: Itinerario): ProgresoItinerario {
  const porEstado: Record<EstadoCobertura, number> = {
    pendiente: 0, 'en-curso': 0, 'completada-con-locales': 0, 'completada-sin-locales': 0, 'parcial-incidencias': 0,
  };
  for (const t of it.tramos) porEstado[estadoTramo(db, it.campanaId, t)]++;
  const total = it.tramos.length;
  const completadas = porEstado['completada-con-locales'] + porEstado['completada-sin-locales'];
  const cerradas = completadas + porEstado['parcial-incidencias'];
  return { total, porEstado, completadas, pct: total ? completadas / total : 0, campoTerminado: total > 0 && cerradas === total };
}

/** Estado de un tramo concreto (respeta la acera asignada). */
export function estadoTramo(db: BaseDatos, campanaId: Id, t: TramoPlan): EstadoCobertura {
  const cob = coberturaCalle(db, campanaId, t.calleId);
  if (t.acera === 'ambas') return cob.estado;
  return cob.aceras[t.acera] ?? cob.aceras.ambas ?? 'pendiente';
}

/** Orden sugerido: recorrido por vecino más cercano partiendo de la primera calle. */
export function ordenarPorProximidad(tramos: TramoPlan[], calles: Record<Id, Calle>): TramoPlan[] {
  if (tramos.length < 3) return tramos.map((t, i) => ({ ...t, orden: i + 1 }));
  const cen = (t: TramoPlan) => centroide(calles[t.calleId]?.segmentos.flatMap((s) => s.coords) ?? [[0, 0]]);
  const pendientes = [...tramos];
  const out: TramoPlan[] = [pendientes.shift()!];
  while (pendientes.length) {
    const ult = cen(out[out.length - 1]);
    let mejor = 0;
    let dm = Infinity;
    pendientes.forEach((t, i) => {
      const d = distanciaM(ult, cen(t));
      if (d < dm) {
        dm = d;
        mejor = i;
      }
    });
    out.push(pendientes.splice(mejor, 1)[0]);
  }
  return out.map((t, i) => ({ ...t, orden: i + 1 }));
}

export function esCalleTerminada(db: BaseDatos, campanaId: Id, calleId: Id) {
  return esCompletada(coberturaCalle(db, campanaId, calleId).estado);
}
