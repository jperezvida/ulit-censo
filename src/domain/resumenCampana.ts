import { kRev, type BaseDatos } from './db';
import { direccionVigente } from './consultas';
import { claseCampana, contenidoCampana } from './municipios';
import { itinerariosDe } from './campanaOperativa';
import { estadoOficina } from './bloqueo';
import { estadoLocal, indiceObservaciones, pendientesCampana, type EstadoLocal } from './conciliacionPosterior';
import type { Id } from './types';

/**
 * UX1 · Indicadores de una campaña para la pantalla de inicio. Todo se calcula de los datos guardados
 * (importaciones confirmadas, observaciones, decisiones): no se inventa ninguna cifra ni ningún estado.
 * Vale para campañas operativas e históricas.
 */
export interface ResumenCampana {
  clase: 'operativa' | 'historica';
  itinerarios: number;
  /** Itinerarios sin ningún Excel incorporado. */
  itinerariosSinExcel: number;
  archivos: number;
  filas: number;
  /** Locales físicos únicos con alguna observación en la campaña. */
  locales: number;
  ocupados: number;
  vacios: number;
  dudosos: number;
  sinFecha: number;
  /** Filas sin local (pendientes de conciliar). */
  filasPendientes: number;
  /** Locales con observaciones contradictorias y sin decisión. */
  contradicciones: number;
  /** Lo que necesita intervención: filas pendientes + contradicciones sin decidir. */
  incidencias: number;
  estados: EstadoLocal[];
}

export function resumenCampana(db: BaseDatos, campanaId: Id): ResumenCampana {
  const c = db.campanas[campanaId];
  const cont = contenidoCampana(db, campanaId);
  const its = itinerariosDe(db, campanaId);
  const conExcel = new Set(cont.importaciones.map((i) => i.c1?.itinerario?.id).filter(Boolean));
  const indice = indiceObservaciones(db, campanaId);
  const estados = [...indice.keys()].sort().map((id) => estadoLocal(db, campanaId, id, indice));
  const filasPendientes = pendientesCampana(db, campanaId).length;
  const contradicciones = estados.filter((e) => e.contradictorio && !e.resolucion).length;
  return {
    clase: claseCampana(c),
    itinerarios: its.length,
    itinerariosSinExcel: its.filter((i) => !conExcel.has(i.id)).length,
    archivos: cont.importaciones.length,
    filas: cont.registros,
    locales: estados.length,
    ocupados: estados.filter((e) => e.clase === 'confirmado' && e.valor === 'ocupado').length,
    vacios: estados.filter((e) => e.clase === 'confirmado' && e.valor === 'vacio').length,
    dudosos: estados.filter((e) => e.clase === 'dudoso').length,
    sinFecha: estados.filter((e) => e.clase === 'sin-fecha').length,
    filasPendientes,
    contradicciones,
    incidencias: filasPendientes + contradicciones,
    estados,
  };
}

export interface FilaLocal {
  localId: Id;
  calle: string;
  numero: string;
  nombre: string;
  estado: EstadoLocal;
}

/** Locales de la campaña con su dirección, el último nombre observado y su estado. */
export function localesCampana(db: BaseDatos, estados: EstadoLocal[]): FilaLocal[] {
  return estados.map((e) => {
    const l = db.locales[e.localId];
    const d = l ? direccionVigente(l) : null;
    const ultimo = [...e.observaciones].reverse().find((o) => o.datos.nombre);
    return {
      localId: e.localId,
      calle: d ? db.calles[d.calleId]?.nombre ?? d.calleId : '—',
      numero: d ? `${d.numero ?? 's/n'}${d.sufijo ? ` ${d.sufijo}` : ''}` : '',
      nombre: ultimo?.datos.nombre ?? '',
      estado: e,
    };
  }).sort((a, b) => a.calle.localeCompare(b.calle, 'es') || a.numero.localeCompare(b.numero, 'es', { numeric: true }));
}

/**
 * Estados de un itinerario, por separado y sin deducir uno de otro:
 *  - Campo: recepción de su Excel (registros importados). No afirma que se hayan recorrido todas las calles.
 *  - Oficina: filas sin conciliar y locales con revisión de oficina hecha por una persona (nunca automática).
 *    Un local ocupado (o sin estado claro) necesita categorización y presencia digital revisadas; uno vacío,
 *    solo la categorización (confirmar el vacío): no se le exige presencia digital. Oficina no termina
 *    mientras quede alguna fila del itinerario sin conciliar.
 *  - Validación: estado de oficina del itinerario (solo «validado» la da por terminada).
 */
export function estadosItinerario(db: BaseDatos, itinerarioId: Id) {
  const it = db.itinerarios[itinerarioId];
  const campanaId = it?.campanaId ?? '';
  const registros = Object.values(db.registros).filter((r) => r.itinerarioId === itinerarioId && db.importaciones[r.importacionId]?.estado === 'confirmada').length;
  const sinConciliar = registros && db.campanas[campanaId] ? pendientesCampana(db, campanaId, { itinerarioId }).length : 0;
  const locales = [...new Set(Object.values(db.observaciones).filter((o) => o.itinerarioId === itinerarioId && o.campanaId === campanaId && o.localId).map((o) => o.localId!))];
  const indice = indiceObservaciones(db, campanaId);
  const revisados = locales.filter((l) => {
    const r = db.revisiones[kRev(campanaId, l)];
    const vacio = estadoLocal(db, campanaId, l, indice).valor === 'vacio';
    return r?.categorizacion === 'revisado' && (vacio || r.digital === 'revisado');
  }).length;
  const v = estadoOficina(db, itinerarioId);
  return {
    registros, sinConciliar, locales: locales.length, revisados,
    campo: registros ? { hecho: true, texto: `Campo: Excel incorporado (${registros} registros)` } : { hecho: false, texto: 'Campo: sin Excel' },
    oficina: {
      hecho: registros > 0 && sinConciliar === 0 && locales.length > 0 && revisados === locales.length,
      texto: `Oficina: ${sinConciliar} sin conciliar · ${revisados}/${locales.length} locales revisados`,
    },
    validacion: { hecho: v === 'validado', texto: v === 'validado' ? 'Validación: validado' : 'Validación: pendiente' },
  };
}
