import type { BaseDatos } from './db';
import { auditarRevisionGeneral, datoRevisionGeneral, type FilaRevisionGeneral } from './revisionGeneral';
import { PERFIL_ITINERARIO_28 } from './xlsx/perfilesImportacion';

/** Cinco columnas originales de clasificación: no mezclar con franquicias ni digital. */
export const CLAVES_CATEGORIZACION = [
  'grupoActividad', 'grupoComercio', 'subgrupo', 'actividad', 'descripcionActividad',
] as const;

export type ValoresCategorizacion = Record<(typeof CLAVES_CATEGORIZACION)[number], string>;
export type EstadoCategorizacion = 'pendiente' | 'aceptada' | 'rechazada';
export interface FilaCategorizacion extends FilaRevisionGeneral {
  valoresCategoria: ValoresCategorizacion;
  tieneCategoria: boolean;
  decision: EstadoCategorizacion;
}
export interface RevisionCategorizacionIt1 {
  registrosOrigen: number;
  ocupados: FilaCategorizacion[];
  vacios: number;
  desconocidos: number;
  existentes: number;
  sinCategoria: number;
  aceptadas: number;
  rechazadas: number;
  pendientes: number;
  filasOrigen: number[];
  faltantes: number[];
  duplicadas: number[];
}

/** Los valores son EFECTIVOS: importación y correcciones supervisadas, nunca se edita el origen. */
export function valoresClasificacionDe(fila: FilaRevisionGeneral): ValoresCategorizacion {
  return Object.fromEntries(CLAVES_CATEGORIZACION.map((clave) =>
    [clave, datoRevisionGeneral(fila.registro, clave, fila.correccion?.valores)])) as ValoresCategorizacion;
}

export function estadoClasificacionDe(fila: FilaRevisionGeneral): EstadoCategorizacion {
  const r = fila.correccion?.revisionClasificacion;
  if (!r) return 'pendiente';
  const valores = valoresClasificacionDe(fila);
  // Un estado viejo jamás acredita que se hayan revisado categorías cambiadas.
  if (!CLAVES_CATEGORIZACION.every((clave) => r.valores?.[clave] === valores[clave])) return 'pendiente';
  return r.estado === 'aceptada' || r.estado === 'rechazada' ? r.estado : 'pendiente';
}

/**
 * Alcance de IT1: todos los registros confirmados 2026, INCLUIDOS los vacíos.
 * Para categorizar se ofrecen únicamente ocupados, pero se verifica el total
 * y no se presume que varias filas del Excel sean locales físicos únicos.
 */
export function revisionCategorizacionIt1(db: BaseDatos, campanaId: string): RevisionCategorizacionIt1 {
  if (db.campanas[campanaId]?.anio !== 2026) {
    return { registrosOrigen: 0, ocupados: [], vacios: 0, desconocidos: 0,
      existentes: 0, sinCategoria: 0, aceptadas: 0, rechazadas: 0, pendientes: 0,
      filasOrigen: [], faltantes: [], duplicadas: [] };
  }
  const todas = auditarRevisionGeneral(db, campanaId).filas
    .filter((fila) => fila.itinerario === 'IT1');
  const numeros = todas.map((fila) => fila.registro.fila);
  const duplicadas = numeros.filter((fila, i) => numeros.indexOf(fila) !== i);
  const faltantes: number[] = [];
  if (numeros.length) for (let n = Math.min(...numeros); n <= Math.max(...numeros); n++) {
    if (!numeros.includes(n)) faltantes.push(n);
  }
  const ocupados = todas.filter((f) => f.estado === 'ocupado')
    .map((f): FilaCategorizacion => {
      const valoresCategoria = valoresClasificacionDe(f);
      return { ...f, valoresCategoria,
        tieneCategoria: CLAVES_CATEGORIZACION.some((clave) => !!valoresCategoria[clave].trim()),
        decision: estadoClasificacionDe(f),
      };
    });
  return {
    registrosOrigen: todas.length, ocupados,
    vacios: todas.filter((f) => f.estado === 'vacio').length,
    desconocidos: todas.filter((f) => f.estado === 'desconocido').length,
    existentes: ocupados.filter((f) => f.tieneCategoria).length,
    sinCategoria: ocupados.filter((f) => !f.tieneCategoria).length,
    aceptadas: ocupados.filter((f) => f.decision === 'aceptada').length,
    rechazadas: ocupados.filter((f) => f.decision === 'rechazada').length,
    pendientes: ocupados.filter((f) => f.decision !== 'aceptada').length,
    filasOrigen: numeros, faltantes, duplicadas,
  };
}

/** Las cabeceras de Excel conservan sus valores literales históricos. */
export const CABECERAS_CATEGORIZACION = CLAVES_CATEGORIZACION.map((clave) =>
  PERFIL_ITINERARIO_28.columnas.find((col) => col.clave === clave)!.cabecera);
