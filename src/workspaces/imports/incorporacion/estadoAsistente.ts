import { create } from 'zustand';
import type { DecisionesIncorporacion, PlanIncorporacion } from '../../../domain/incorporacion';
import type { ResultadoInterpretacion } from '../../../domain/xlsx/interpretacion';
import type { ColeccionIncorporada, Id } from '../../../domain/types';

/**
 * Estado del asistente de incorporación (C1d). Vive en memoria mientras dure la sesión: se puede
 * volver a etapas anteriores o cambiar de pantalla sin perder las decisiones. No se guarda en el
 * navegador ni contiene bytes de archivos.
 */
export type Etapa = 1 | 2 | 3 | 4 | 5;

export interface Aplicado {
  importacionId: Id;
  campanaId: Id;
  creadas: Record<ColeccionIncorporada, number>;
  guardado: boolean;
  errorGuardado?: string;
  pendientes: { ambiguas: number; sinVinculo: number; incidencias: number };
}

interface EstadoAsistente {
  etapa: Etapa;
  escenarioId: string;
  anio: number;
  nombre: string;
  decisiones: DecisionesIncorporacion;
  preparado: { resultado: ResultadoInterpretacion; plan: PlanIncorporacion } | null;
  /** Firma de las decisiones con que se interpretó (si cambian reglas o diccionario, hay que reinterpretar). */
  interpretadoCon: string;
  cargando: string | null;
  error: string | null;
  aplicado: Aplicado | null;
  set: (p: Partial<Omit<EstadoAsistente, 'set' | 'reiniciar'>>) => void;
  reiniciar: () => void;
}

const INICIAL = {
  etapa: 1 as Etapa,
  escenarioId: 'medina-2025-ficticio',
  anio: 2025,
  nombre: '',
  decisiones: {} as DecisionesIncorporacion,
  preparado: null,
  interpretadoCon: '',
  cargando: null,
  error: null,
  aplicado: null,
};

export const useAsistente = create<EstadoAsistente>((set) => ({
  ...INICIAL,
  set: (p) => set(p),
  reiniciar: () => set({ ...INICIAL, decisiones: {} }),
}));

/** Parte de las decisiones que cambia la INTERPRETACIÓN de C1b (reglas y diccionario). */
export const firmaInterpretacion = (d: DecisionesIncorporacion) =>
  JSON.stringify([(d.reglasAutorizadas ?? []).map((x) => x.regla).sort(), (d.diccionarioAprobado ?? []).map((x) => x.texto.toLowerCase()).sort()]);

export const hoy = () => new Date().toISOString().slice(0, 10);
