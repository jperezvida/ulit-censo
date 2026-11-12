import type { BaseDatos } from './db';
import { auditarRevisionGeneral, datoRevisionGeneral, type FilaRevisionGeneral } from './revisionGeneral';
import { PERFIL_ITINERARIO_28 } from './xlsx/perfilesImportacion';

/**
 * Salida de TRABAJO de los Excel 2026: una fila de salida por fila de importación confirmada.
 * NO representa locales únicos ni sustituye el censo consolidado tras conciliación.
 * El histórico, las celdas originales y las entidades vigentes no se reescriben.
 */
export const COLUMNAS_REVISION_GENERAL_2026 = [
  ...PERFIL_ITINERARIO_28.columnas.map((col) => col.cabecera),
  'ULIT · Registro origen',
  'ULIT · Archivo de origen',
  'ULIT · Fila del Excel',
  'ULIT · Itinerario',
  'ULIT · Estado de revisión',
  'ULIT · Incidencias pendientes',
  'ULIT · Campos corregidos',
  'ULIT · Valores originales corregidos',
  'ULIT · Fecha corrección',
  'ULIT · Responsable corrección',
  'ULIT · Motivo corrección',
] as const;

export interface ExportacionRevisionGeneral {
  columnas: readonly string[];
  filas: Record<string, string>[];
  resumen: {
    filas: number;
    vacios: number;
    ocupados: number;
    desconocidos: number;
    conIncidencias: number;
    conCorreccion: number;
    incidencias: number;
  };
}

function filaDeTrabajo(f: FilaRevisionGeneral): Record<string, string> {
  const valores = f.correccion?.valores;
  const salida: Record<string, string> = {};
  const antes: Record<string, string> = {};
  const cambiados: string[] = [];
  for (const col of PERFIL_ITINERARIO_28.columnas) {
    const original = datoRevisionGeneral(f.registro, col.clave);
    const corregido = datoRevisionGeneral(f.registro, col.clave, valores);
    salida[col.cabecera] = corregido;
    if (corregido !== original) {
      cambiados.push(col.cabecera);
      antes[col.cabecera] = original;
    }
  }
  salida['ULIT · Registro origen'] = f.id;
  salida['ULIT · Archivo de origen'] = f.archivo;
  salida['ULIT · Fila del Excel'] = String(f.registro.fila);
  salida['ULIT · Itinerario'] = f.itinerario;
  salida['ULIT · Estado de revisión'] =
    f.incidencias.length ? 'Con incidencias' : f.correccion ? 'Corregido; sin avisos automáticos' : 'Sin avisos automáticos';
  salida['ULIT · Incidencias pendientes'] = f.incidencias.map((i) => i.titulo).join(' | ');
  salida['ULIT · Campos corregidos'] = cambiados.join(' | ');
  salida['ULIT · Valores originales corregidos'] = cambiados.length ? JSON.stringify(antes) : '';
  salida['ULIT · Fecha corrección'] = f.correccion?.fecha ?? '';
  salida['ULIT · Responsable corrección'] = f.correccion?.porId ?? '';
  salida['ULIT · Motivo corrección'] = f.correccion?.motivo ?? '';
  return salida;
}

export function exportarRevisionGeneral(
  db: BaseDatos,
  campanaId: string,
  itinerarioId?: string,
): ExportacionRevisionGeneral {
  // Guardar el perímetro: la función no admite exportar otro año como si fuera 2026.
  if (db.campanas[campanaId]?.anio !== 2026) {
    return { columnas: COLUMNAS_REVISION_GENERAL_2026, filas: [],
      resumen: { filas: 0, vacios: 0, ocupados: 0, desconocidos: 0,
        conIncidencias: 0, conCorreccion: 0, incidencias: 0 } };
  }
  const auditadas = auditarRevisionGeneral(db, campanaId).filas
    .filter((f) => !itinerarioId || f.registro.itinerarioId === itinerarioId);
  return {
    columnas: COLUMNAS_REVISION_GENERAL_2026,
    filas: auditadas.map(filaDeTrabajo),
    resumen: {
      filas: auditadas.length,
      vacios: auditadas.filter((f) => f.estado === 'vacio').length,
      ocupados: auditadas.filter((f) => f.estado === 'ocupado').length,
      desconocidos: auditadas.filter((f) => f.estado === 'desconocido').length,
      conIncidencias: auditadas.filter((f) => f.incidencias.length > 0).length,
      conCorreccion: auditadas.filter((f) => !!f.correccion).length,
      incidencias: auditadas.reduce((n, f) => n + f.incidencias.length, 0),
    },
  };
}

/**
 * CSV seguro para Excel: evita ejecutar fórmulas contenidas en campos importados
 * o en motivos de revisión. Añadir comilla simple solo a valores que comienzan
 * por caracteres de fórmula, tras espacios/control; los números normales se preservan.
 */
export function csvRevisionGeneral(exportacion: ExportacionRevisionGeneral): string {
  const campo = (valor: string): string => {
    const texto = /^[\s\u0000-\u001f]*[=+@\-\t\r\n]/.test(valor) ? `'${valor}` : valor;
    return `"${texto.replace(/"/g, '""')}"`;
  };
  return '\ufeff' + [
    exportacion.columnas.map(campo).join(';'),
    ...exportacion.filas.map((f) => exportacion.columnas.map((c) => campo(f[c] ?? '')).join(';')),
  ].join('\r\n');
}
