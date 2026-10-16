import type { BaseDatos } from './db';
import { ErrorDominio, kCC, nuevoId } from './db';
import { estadoOficina } from './bloqueo';
import { ordenarPorProximidad } from './planificacion';
import { longitudLinea } from './geo';
import type { Acera, Calle, Id, Itinerario, LngLat, SituacionPrevia, TramoPlan } from './types';

/** Operaciones de planificación (puras). Nunca tocan locales ni históricos. */

function conIt(db: BaseDatos, itId: Id, fn: (it: Itinerario) => Itinerario): BaseDatos {
  const it = db.itinerarios[itId];
  if (!it) return db;
  if (estadoOficina(db, itId) === 'validado') throw new ErrorDominio('bloqueado', `${it.codigo} está validado: reábrelo para cambiar su planificación.`);
  return { ...db, itinerarios: { ...db.itinerarios, [itId]: fn(it) } };
}

const renumerar = (ts: TramoPlan[]) => ts.map((t, i) => ({ ...t, orden: i + 1 }));

export function crearItinerario(db: BaseDatos, campanaId: Id, datos: { codigo: string; nombre: string; color: string; origen?: Itinerario['origen']; tramos?: TramoPlan[]; notas?: string }): { db: BaseDatos; id: Id } {
  const id = nuevoId('it');
  const it: Itinerario = {
    id, campanaId, codigo: datos.codigo, nombre: datos.nombre, color: datos.color, origen: datos.origen ?? 'app',
    tramos: datos.tramos ?? [], asignadosIds: [], creado: new Date().toISOString(), notas: datos.notas,
  };
  let d = { ...db, itinerarios: { ...db.itinerarios, [id]: it } };
  for (const t of it.tramos) d = asegurarEnAmbito(d, campanaId, t.calleId);
  return { db: d, id };
}

export function eliminarItinerario(db: BaseDatos, itId: Id): BaseDatos {
  if (estadoOficina(db, itId) === 'validado') throw new ErrorDominio('bloqueado', 'No se puede eliminar un itinerario validado.');
  const { [itId]: _, ...resto } = db.itinerarios;
  return { ...db, itinerarios: resto };
}

/** Añade la calle COMPLETA (todos sus segmentos, ambas aceras) o la quita si ya estaba. */
export function alternarCalle(db: BaseDatos, itId: Id, calleId: Id): { db: BaseDatos; anadida: boolean } {
  const it = db.itinerarios[itId];
  if (!it) return { db, anadida: false };
  if (it.tramos.some((t) => t.calleId === calleId)) {
    return { db: conIt(db, itId, (i) => ({ ...i, tramos: renumerar(i.tramos.filter((t) => t.calleId !== calleId)) })), anadida: false };
  }
  let d = conIt(db, itId, (i) => ({ ...i, tramos: [...i.tramos, { calleId, acera: 'ambas', orden: i.tramos.length + 1 }] }));
  d = asegurarEnAmbito(d, it.campanaId, calleId);
  return { db: d, anadida: true };
}

export function actualizarTramo(db: BaseDatos, itId: Id, calleId: Id, cambios: Partial<Pick<TramoPlan, 'acera' | 'segmentoIds' | 'responsableId' | 'etiqueta'>>): BaseDatos {
  return conIt(db, itId, (i) => ({ ...i, tramos: i.tramos.map((t) => (t.calleId === calleId ? { ...t, ...cambios } : t)) }));
}

/** División avanzada: alterna un segmento dentro del tramo de la calle. */
export function alternarSegmento(db: BaseDatos, itId: Id, calle: Calle, segId: Id): BaseDatos {
  return conIt(db, itId, (i) => ({
    ...i,
    tramos: i.tramos.map((t) => {
      if (t.calleId !== calle.id) return t;
      const actuales = t.segmentoIds?.length ? t.segmentoIds : calle.segmentos.map((s) => s.id);
      let nuevos = actuales.includes(segId) ? actuales.filter((s) => s !== segId) : [...actuales, segId];
      if (!nuevos.length) nuevos = actuales; // nunca dejar el tramo vacío
      const completa = nuevos.length === calle.segmentos.length;
      return { ...t, segmentoIds: completa ? undefined : nuevos };
    }),
  }));
}

export function moverTramo(db: BaseDatos, itId: Id, desde: number, hasta: number): BaseDatos {
  return conIt(db, itId, (i) => {
    const ts = [...i.tramos];
    const [x] = ts.splice(desde, 1);
    ts.splice(Math.max(0, Math.min(ts.length, hasta)), 0, x);
    return { ...i, tramos: renumerar(ts) };
  });
}

export function ordenarItinerario(db: BaseDatos, itId: Id): BaseDatos {
  return conIt(db, itId, (i) => ({ ...i, tramos: ordenarPorProximidad(i.tramos, db.calles) }));
}

export function editarItinerario(db: BaseDatos, itId: Id, cambios: Partial<Pick<Itinerario, 'nombre' | 'codigo' | 'color' | 'asignadosIds' | 'notas'>>): BaseDatos {
  return conIt(db, itId, (i) => ({ ...i, ...cambios }));
}

/** Incorpora una calle al ámbito de la campaña; si es nueva, cuenta como ampliación. */
export function asegurarEnAmbito(db: BaseDatos, campanaId: Id, calleId: Id): BaseDatos {
  const c = db.campanas[campanaId];
  if (!c || c.ambitoCalleIds.includes(calleId)) return db;
  const ref = c.campanaReferenciaId ? db.campanas[c.campanaReferenciaId] : undefined;
  const esAmpliacion = !ref || !ref.ambitoCalleIds.includes(calleId);
  return {
    ...db,
    campanas: {
      ...db.campanas,
      [campanaId]: { ...c, ambitoCalleIds: [...c.ambitoCalleIds, calleId], ampliacionCalleIds: esAmpliacion ? [...c.ampliacionCalleIds, calleId] : c.ampliacionCalleIds },
    },
  };
}

export function quitarDeAmbito(db: BaseDatos, campanaId: Id, calleId: Id): BaseDatos {
  const c = db.campanas[campanaId];
  if (!c) return db;
  return {
    ...db,
    campanas: { ...db.campanas, [campanaId]: { ...c, ambitoCalleIds: c.ambitoCalleIds.filter((x) => x !== calleId), ampliacionCalleIds: c.ampliacionCalleIds.filter((x) => x !== calleId) } },
  };
}

export function fijarSituacionPrevia(db: BaseDatos, campanaId: Id, calleId: Id, s: SituacionPrevia | null): BaseDatos {
  const k = kCC(campanaId, calleId);
  const m = { ...db.situacionesPrevias };
  if (s) m[k] = s;
  else delete m[k];
  return { ...db, situacionesPrevias: m };
}

/** Marca una calle (p. ej. sin registros previos) como revisada en planificación. */
export function marcarCalleRevisada(db: BaseDatos, campanaId: Id, calleId: Id, porId: Id, revisada: boolean, nota?: string): BaseDatos {
  const k = kCC(campanaId, calleId);
  const m = { ...db.callesRevisadasPlan };
  if (revisada) m[k] = { porId, fecha: new Date().toISOString(), nota };
  else delete m[k];
  return { ...db, callesRevisadasPlan: m };
}

/** Registra una calle que falta en el callejero (omisión), dibujada por la Cátedra. */
export function registrarOmision(db: BaseDatos, municipioId: Id, nombre: string, coords: LngLat[]): { db: BaseDatos; id: Id } {
  const id = nuevoId('c-manual');
  const seg = { id: `${id}-s1`, coords, longitudM: longitudLinea(coords) };
  const calle: Calle = { id, municipioId, nombre, tipoVia: 'Calle', segmentos: coords.length > 1 ? [seg] : [], longitudM: seg.longitudM, procedencia: 'manual', refsFuente: ['omisión registrada en ULIT Censo'] };
  return { db: { ...db, calles: { ...db.calles, [id]: calle } }, id };
}

export function siguienteCodigo(existentes: string[]): string {
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const l of letras) if (!existentes.includes(`IT-${l}`)) return `IT-${l}`;
  return `IT-${existentes.length + 1}`;
}

export const ACERA_TXT: Record<Acera, string> = { ambas: 'Ambas aceras', par: 'Solo pares', impar: 'Solo impares' };
