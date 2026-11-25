import type { BaseDatos } from './db';
import type { RevisionFranquiciaRegistro } from './types';
import { auditarRevisionGeneral, datoRevisionGeneral, type FilaRevisionGeneral } from './revisionGeneral';

/** Datos vigentes de un registro ocupado del Excel 2026, aunque todavía no tenga local físico. */
export interface FilaFranquiciaIT1 {
  fila: FilaRevisionGeneral;
  /** Valor original del Excel, tras correcciones de fase 1: 1, 0, o vacío/inválido. */
  excel: string;
  propuesta: 'si' | 'no' | null;
  revision?: RevisionFranquiciaRegistro;
  /** Decisión final CONFIRMADA por el servidor: nunca se deduce de una cola local. */
  confirmada: boolean;
  paso: 1 | 2;
}

export const interpretarFranquiciaExcel = (valor: string): 'si' | 'no' | null => {
  if (valor.trim() === '1') return 'si';
  if (valor.trim() === '0') return 'no';
  return null;
};

/** Las casillas sin dato (o con valores ajenos a 0/1) NO significan «No». */
export function prepararFranquiciasIT1(db: BaseDatos, campanaId: string): FilaFranquiciaIT1[] {
  if (db.campanas[campanaId]?.anio !== 2026) return [];
  return auditarRevisionGeneral(db, campanaId).filas
    .filter((f) => f.itinerario === 'IT1' && f.estado === 'ocupado')
    .map((fila) => {
      const excel = datoRevisionGeneral(fila.registro, 'franquicia', fila.correccion?.valores).trim();
      const propuesta = interpretarFranquiciaExcel(excel);
      const r = db.revisionesFranquiciaRegistros?.[fila.id];
      const revision = r?.campanaId === campanaId && r.registroId === fila.id ? r : undefined;
      const confirmada = !!revision && (revision.estado === 'corregida'
        || (revision.estado === 'aceptada' && propuesta !== null && revision.respuesta === propuesta));
      const paso = (!propuesta || revision?.estado === 'rechazada' || revision?.estado === 'corregida') ? 2 : 1;
      return { fila, excel, propuesta, revision, confirmada, paso };
    });
}

export interface DecisionFranquiciaIT1 {
  ids: string[];
  accion: 'aceptar' | 'rechazar' | 'resolver' | 'aceptar-todas';
  respuesta?: 'si' | 'no';
}

/** El filtro se deriva de las decisiones del servidor y de la cola local, sin modificar fuentes. */
export function pendientesFranquiciaIT1(filas: FilaFranquiciaIT1[], cola: readonly DecisionFranquiciaIT1[]) {
  const ultimas = new Map(cola.flatMap((d) => d.ids.map((id) => [id, d] as const)));
  return filas.map((f) => {
    const enCola = ultimas.get(f.fila.id);
    const paso: 1 | 2 = enCola
      ? enCola.accion === 'rechazar' || enCola.accion === 'resolver' ? 2 : f.paso
      : f.paso;
    const confirmada = f.confirmada && !enCola;
    const pendiente = enCola ? enCola.accion === 'rechazar' : !confirmada;
    return { ...f, enCola, paso, confirmada, pendiente };
  });
}
