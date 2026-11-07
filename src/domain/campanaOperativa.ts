import { ErrorDominio, type BaseDatos } from './db';
import { direccionVigente } from './consultas';
import { normalizar } from './text';
import { claseCampana } from './municipios';
import { estadoLocal, indiceObservaciones, type EstadoLocal } from './conciliacionPosterior';
import type { Id, Importacion, Itinerario, TramoPlan } from './types';

/**
 * G4 · CAMPAÑA OPERATIVA con varios itinerarios (IT1, IT2, IT3…). Cada itinerario aporta su Excel, que
 * se incorpora con el importador de siempre (C1a–C1d, G1–G3) dentro de la MISMA campaña: no se crea una
 * campaña por itinerario. El censo de la campaña es la consolidación de todos ellos, con su desglose.
 *
 * Nada se fusiona solo: los posibles duplicados y las contradicciones entre itinerarios se señalan y
 * quedan para la conciliación supervisada; varios establecimientos en un mismo portal son locales
 * distintos (C1c-1).
 */

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30) || 'x';
const COLORES = ['#1f6feb', '#d1242f', '#1a7f37', '#9a6700', '#8250df', '#bc4c00', '#0e7490', '#bf3989'];

export const itinerariosDe = (db: Pick<BaseDatos, 'itinerarios'>, campanaId: Id) =>
  Object.values(db.itinerarios).filter((i) => i.campanaId === campanaId).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

export function validarItinerario(db: BaseDatos, campanaId: Id, codigo: string): string[] {
  const c = db.campanas[campanaId];
  if (!c) return ['Elija la campaña.'];
  if (claseCampana(c) !== 'operativa') return ['Los itinerarios son de una campaña operativa.'];
  const cod = codigo.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(cod)) return ['Indique el código del itinerario (p. ej. IT1): letras, cifras o guiones, hasta 12.'];
  if (itinerariosDe(db, campanaId).some((i) => i.codigo.toUpperCase() === cod)) return [`Ya hay un itinerario ${cod} en «${c.nombre}».`];
  return [];
}

/** Alta de un itinerario en una campaña operativa (sin tramos: se definen sobre el mapa en una fase posterior). */
export function crearItinerario(db: BaseDatos, campanaId: Id, d: { codigo: string; nombre?: string }, o: { prefijo: string; porId: Id; ahora?: string }): { db: BaseDatos; itinerarioId: Id } {
  const e = validarItinerario(db, campanaId, d.codigo);
  if (e.length) throw new ErrorDominio('regla', e[0], e);
  if (!db.personas[o.porId]) throw new ErrorDominio('regla', 'El itinerario debe crearlo una persona registrada.');
  const codigo = d.codigo.trim().toUpperCase();
  const raiz = `${o.prefijo}-it-${slug(campanaId.replace(new RegExp(`^${o.prefijo}-camp-`), ''))}-${slug(codigo)}`;
  let id = raiz;
  for (let n = 2; db.itinerarios[id]; n++) id = `${raiz}-${n}`;
  const n = itinerariosDe(db, campanaId).length;
  const it: Itinerario = {
    id, campanaId, codigo, nombre: d.nombre?.trim() || `Itinerario ${codigo}`, color: COLORES[n % COLORES.length], origen: 'excel',
    tramos: [], asignadosIds: [], creado: o.ahora ?? new Date().toISOString(),
  };
  return { db: { ...db, itinerarios: { ...db.itinerarios, [id]: it } }, itinerarioId: id };
}

// ───────────── Censo consolidado ─────────────

export interface DesgloseItinerario {
  itinerario: Itinerario;
  archivos: { importacionId: Id; archivo: string; sha256: string; fecha: string; filas: number }[];
  registros: number;
  /** Locales físicos creados por los Excel de este itinerario. */
  localesNuevos: number;
  /** Registros con local físico (nuevo o existente decidido). */
  vinculados: number;
  /** Registros sin local: pendientes de conciliación (calle no reconocida, sin número, portal con otro local…). */
  pendientes: number;
  /** Observaciones (una fila puede no tener observación si su calle no se reconoció). */
  observaciones: number;
  /** Fechas reales de las observaciones (de la columna de fecha del Excel), si existen. */
  fechas: { desde: string; hasta: string } | null;
  sinFecha: number;
  calles: { calleId: Id; nombre: string; segmentos: string[] }[];
}

export interface CensoConsolidado {
  campanaId: Id;
  itinerarios: DesgloseItinerario[];
  /**
   * Totales. Se distinguen FILAS de los Excel, OBSERVACIONES y LOCALES FÍSICOS ÚNICOS. Ocupados, vacíos,
   * dudosos y «sin fecha» cuentan locales únicos según su estado (G5), nunca observaciones repetidas; un
   * local con observaciones contradictorias sin resolver no cuenta como ocupado ni como vacío.
   */
  total: {
    archivos: number; registros: number; observaciones: number; locales: number; vinculados: number; pendientes: number;
    ocupados: number; vacios: number; dudosos: number; sinFecha: number; calles: number;
  };
  /** Estado de cada local único de la campaña. */
  estados: EstadoLocal[];
  /** Calles con observaciones de más de un itinerario. */
  solapamientos: { calleId: Id; calle: string; itinerarios: string[] }[];
  /** Mismo portal y mismo nombre en itinerarios distintos: puede ser el mismo establecimiento contado dos veces. */
  posiblesDuplicados: { portal: string; nombre: string; observaciones: { itinerario: string; fila?: number; localId: Id | null }[]; conciliado: boolean }[];
  /**
   * Mismo portal: vacío según un itinerario y ocupado según otro. «resuelta» solo si todas sus observaciones
   * tienen local y ninguno de esos locales sigue con una contradicción sin decidir.
   */
  contradicciones: { portal: string; vacio: string[]; ocupado: string[]; resuelta: boolean }[];
  /** Portales con varios locales físicos distintos en la campaña (no se fusionan). */
  mismoPortal: { portal: string; locales: number }[];
}

/** Importaciones confirmadas de los itinerarios de una campaña operativa. */
export const importacionesDeCampana = (db: BaseDatos, campanaId: Id): Importacion[] =>
  Object.values(db.importaciones).filter((i) => i.campanaId === campanaId && i.estado === 'confirmada' && i.c1?.itinerario);

/** Censo consolidado de una campaña operativa: totales y desglose por itinerario, con sus cruces. */
export function censoConsolidado(db: BaseDatos, campanaId: Id): CensoConsolidado {
  const its = itinerariosDe(db, campanaId);
  const imps = importacionesDeCampana(db, campanaId);
  const registrosDe = new Map<Id, Id[]>();
  for (const r of Object.values(db.registros)) if (r.itinerarioId && imps.some((i) => i.id === r.importacionId)) registrosDe.set(r.itinerarioId, [...(registrosDe.get(r.itinerarioId) ?? []), r.id]);
  const vincPorRegistro = new Map(Object.values(db.vinculos).filter((v) => v.origen.tipo === 'registro').map((v) => [v.origen.id, v]));
  const obs = Object.values(db.observaciones).filter((o) => o.campanaId === campanaId && o.itinerarioId);
  const codigo = (id: Id) => db.itinerarios[id]?.codigo ?? id;
  const nombreCalle = (id: Id) => db.calles[id]?.nombre ?? id;
  const portalTxt = (calleId: Id, n: number | null, s?: string) => `${nombreCalle(calleId)}, ${n ?? 's/n'}${s ? ` ${s}` : ''}`;
  // Locales físicos ÚNICOS de la campaña y su estado (G5).
  const localesCampana = new Set(obs.map((o) => o.localId).filter((l): l is Id => !!l));
  const indice = indiceObservaciones(db, campanaId);
  const estados = [...localesCampana].sort().map((lid) => estadoLocal(db, campanaId, lid, indice));
  const estadoPor = new Map(estados.map((e) => [e.localId, e]));
  const contradictorioSinResolver = (lid: Id) => { const e = estadoPor.get(lid); return !!e && e.contradictorio && !e.resolucion; };

  const itinerarios: DesgloseItinerario[] = its.map((it) => {
    const misImps = imps.filter((i) => i.c1!.itinerario!.id === it.id);
    const regs = registrosDe.get(it.id) ?? [];
    const misObs = obs.filter((o) => o.itinerarioId === it.id);
    const fechas = misObs.map((o) => o.fecha).filter((f): f is string => !!f).sort();
    const calles = [...new Set(misObs.map((o) => o.calleId))].map((cid) => ({ calleId: cid, nombre: nombreCalle(cid), segmentos: (db.calles[cid]?.segmentos ?? []).map((s) => s.id) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const vinculados = regs.filter((r) => !!vincPorRegistro.get(r)?.localId).length;
    return {
      itinerario: it,
      archivos: misImps.map((i) => ({ importacionId: i.id, archivo: i.archivo, sha256: i.huella, fecha: i.fecha, filas: i.filas })),
      registros: regs.length,
      localesNuevos: misImps.reduce((a, i) => a + Object.keys(i.c1!.creadas.locales ?? {}).length, 0),
      vinculados, pendientes: regs.filter((r) => !db.registros[r].exclusion).length - vinculados,
      observaciones: misObs.length,
      fechas: fechas.length ? { desde: fechas[0], hasta: fechas[fechas.length - 1] } : null, sinFecha: misObs.filter((o) => !o.fecha).length,
      calles,
    };
  });

  // Solapamientos: calles observadas por más de un itinerario.
  const porCalle = new Map<Id, Set<string>>();
  for (const o of obs) porCalle.set(o.calleId, (porCalle.get(o.calleId) ?? new Set()).add(codigo(o.itinerarioId!)));
  const solapamientos = [...porCalle].filter(([, s]) => s.size > 1).map(([cid, s]) => ({ calleId: cid, calle: nombreCalle(cid), itinerarios: [...s].sort() }));

  // Posibles duplicados y contradicciones entre itinerarios (por portal numérico).
  const conNumero = obs.filter((o) => o.datos.numero !== null);
  const clavePortal = (o: (typeof obs)[number]) => `${o.calleId}|${o.datos.numero}|${(o.datos.sufijo ?? '').toUpperCase()}`;
  const grupos = new Map<string, typeof obs>();
  for (const o of conNumero) grupos.set(clavePortal(o), [...(grupos.get(clavePortal(o)) ?? []), o]);
  const posiblesDuplicados: CensoConsolidado['posiblesDuplicados'] = [];
  const contradicciones: CensoConsolidado['contradicciones'] = [];
  for (const g of grupos.values()) {
    const p = portalTxt(g[0].calleId, g[0].datos.numero, g[0].datos.sufijo);
    const porNombre = new Map<string, typeof obs>();
    for (const o of g) if (o.datos.nombre) porNombre.set(normalizar(o.datos.nombre), [...(porNombre.get(normalizar(o.datos.nombre)) ?? []), o]);
    for (const xs of porNombre.values()) {
      if (new Set(xs.map((x) => x.itinerarioId)).size < 2) continue;
      // Conciliado: una persona decidió que todas las observaciones son del MISMO local físico y ese local no
      // tiene una contradicción sin resolver.
      const conciliado = xs.every((x) => !!x.localId && x.localId === xs[0].localId) && !contradictorioSinResolver(xs[0].localId!);
      posiblesDuplicados.push({ portal: p, nombre: xs[0].datos.nombre!, observaciones: xs.map((x) => ({ itinerario: codigo(x.itinerarioId!), ...(x.registroId ? { fila: db.registros[x.registroId]?.fila } : {}), localId: x.localId })), conciliado });
    }
    const vacio = [...new Set(g.filter((o) => o.datos.vacio).map((o) => codigo(o.itinerarioId!)))];
    const ocupado = [...new Set(g.filter((o) => !o.datos.vacio).map((o) => codigo(o.itinerarioId!)))];
    if (vacio.length && ocupado.length && new Set([...vacio, ...ocupado]).size > 1) {
      contradicciones.push({ portal: p, vacio, ocupado, resuelta: g.every((o) => !!o.localId && !contradictorioSinResolver(o.localId)) });
    }
  }

  const porPortal = new Map<string, Set<Id>>();
  for (const lid of localesCampana) {
    const l = db.locales[lid];
    if (!l) continue;
    const d = direccionVigente(l);
    if (d.numero === null) continue;
    const k = portalTxt(d.calleId, d.numero, d.sufijo);
    porPortal.set(k, (porPortal.get(k) ?? new Set()).add(lid));
  }
  const mismoPortal = [...porPortal].filter(([, s]) => s.size > 1).map(([portal, s]) => ({ portal, locales: s.size }));

  const sum = (f: (d: DesgloseItinerario) => number) => itinerarios.reduce((a, d) => a + f(d), 0);
  return {
    campanaId, itinerarios,
    total: {
      archivos: sum((d) => d.archivos.length), registros: sum((d) => d.registros), observaciones: obs.length, locales: localesCampana.size, vinculados: sum((d) => d.vinculados),
      pendientes: sum((d) => d.pendientes), calles: porCalle.size,
      ocupados: estados.filter((e) => e.clase === 'confirmado' && e.valor === 'ocupado').length,
      vacios: estados.filter((e) => e.clase === 'confirmado' && e.valor === 'vacio').length,
      dudosos: estados.filter((e) => e.clase === 'dudoso').length,
      sinFecha: estados.filter((e) => e.clase === 'sin-fecha').length,
    },
    estados, solapamientos, posiblesDuplicados, contradicciones, mismoPortal,
  };
}

/**
 * G5 · Calles con observaciones de un itinerario. NO es cobertura: haber encontrado locales en una calle no
 * demuestra que se recorriera entera ni por las dos aceras. Se informa de los portales observados y de las
 * aceras en las que hay locales, siempre como «recorrido no confirmado».
 */
export interface CalleObservada {
  calleId: Id;
  nombre: string;
  /** Portales numéricos observados (ordenados). */
  numeros: number[];
  /** Observaciones sin número de portal. */
  sinNumero: number;
  /** Aceras con algún local observado (no significa que se recorrieran enteras). */
  acerasConLocales: ('par' | 'impar')[];
  /** Identificadores de segmentos de la calle (G3), como referencia para el futuro editor sobre mapa. */
  segmentos: Id[];
  recorrido: 'no-confirmado';
}

export function callesConObservaciones(db: BaseDatos, itinerarioId: Id): CalleObservada[] {
  const obs = Object.values(db.observaciones).filter((o) => o.itinerarioId === itinerarioId);
  const porCalle = new Map<Id, typeof obs>();
  for (const o of obs) porCalle.set(o.calleId, [...(porCalle.get(o.calleId) ?? []), o]);
  return [...porCalle].map(([calleId, xs]) => {
    const numeros = [...new Set(xs.map((o) => o.datos.numero).filter((n): n is number => n !== null))].sort((a, b) => a - b);
    const acerasConLocales = [...new Set(numeros.map((n) => (n % 2 === 0 ? 'par' as const : 'impar' as const)))].sort();
    return { calleId, nombre: db.calles[calleId]?.nombre ?? calleId, numeros, sinNumero: xs.filter((o) => o.datos.numero === null).length, acerasConLocales, segmentos: (db.calles[calleId]?.segmentos ?? []).map((s) => s.id), recorrido: 'no-confirmado' as const };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Tramos guardados en G4 con «Guardar calles como tramos»: calles completas, ambas aceras, deducidas solo de lo
 * observado. Se conservan tal cual (no se borran datos del usuario), pero se muestran como NO confirmados:
 * no son una planificación revisada ni prueban cobertura. Se reconocen porque el itinerario es de Excel y sus
 * tramos coinciden con las calles observadas, con todos sus segmentos, «ambas» aceras y sin etiqueta ni responsable.
 */
export function tramosDeducidosSinConfirmar(db: BaseDatos, itinerarioId: Id): TramoPlan[] {
  const it = db.itinerarios[itinerarioId];
  if (!it || it.origen !== 'excel' || !it.tramos.length) return [];
  const observadas = new Set(Object.values(db.observaciones).filter((o) => o.itinerarioId === itinerarioId).map((o) => o.calleId));
  const deducido = (t: TramoPlan) => t.acera === 'ambas' && !t.etiqueta && !t.responsableId && observadas.has(t.calleId)
    && JSON.stringify(t.segmentoIds ?? []) === JSON.stringify((db.calles[t.calleId]?.segmentos ?? []).map((s) => s.id));
  return it.tramos.every(deducido) ? it.tramos : [];
}
