import { create } from 'zustand';
import type { DecisionesIncorporacion, PlanIncorporacion } from '../../domain/incorporacion';
import type { ResultadoInterpretacion } from '../../domain/xlsx/interpretacion';
import type { InformeEstructural } from '../../domain/xlsx/analisis';
import type { Id } from '../../domain/types';
import type { PerfilImportacion } from '../../domain/xlsx/perfilesImportacion';
import type { InformeAgregado } from '../../domain/xlsx/referencias';

/**
 * Estado del asistente de incorporación en un espacio aislado (C1e). Vive SOLO en memoria: los bytes
 * del archivo elegido se mantienen mientras dure la sesión (hacen falta para volver a interpretar si
 * cambian las decisiones) y se descartan al reiniciar o cerrar la pestaña. Nunca se guardan en el
 * navegador, en el repositorio ni en registros de diagnóstico.
 */
export type EtapaEspacio = 1 | 2 | 3 | 4 | 5 | 6;

/** G1 · Cómo leer el archivo: perfil (de referencia, guardado o creado ahora), hoja, cabecera y referencia. */
export interface LecturaArchivo {
  perfil: PerfilImportacion;
  hoja: string;
  filaCabecera: number;
  /** Indicadores de referencia que se comparan (solo con un perfil de un censo concreto). */
  referencia?: InformeAgregado;
}

export interface ArchivoElegido {
  nombre: string;
  tamano: number;
  sha256: string;
  sintetico: boolean;
  bytes: Uint8Array;
}

interface Estado {
  etapa: EtapaEspacio;
  archivo: ArchivoElegido | null;
  decisiones: DecisionesIncorporacion;
  lectura: LecturaArchivo | null;
  preparado: { resultado: ResultadoInterpretacion & { estructura?: InformeEstructural }; plan: PlanIncorporacion } | null;
  interpretadoCon: string;
  revisada: boolean;
  cargando: string | null;
  error: string | null;
  aplicado: { importacionId: Id; campanaId: Id; creadas: Record<string, number> } | null;
  set: (p: Partial<Omit<Estado, 'set' | 'reiniciar'>>) => void;
  reiniciar: () => void;
}

const INICIAL = { etapa: 1 as EtapaEspacio, archivo: null, decisiones: {}, lectura: null, preparado: null, interpretadoCon: '', revisada: false, cargando: null, error: null, aplicado: null };

export const useAsistenteEspacio = create<Estado>((set) => ({
  ...INICIAL,
  set: (p) => set(p),
  reiniciar: () => set({ ...INICIAL, decisiones: {} }),
}));

/**
 * G2 · Municipio y campaña elegidos en el espacio. El panel «Municipios y campañas» y el destino del
 * asistente comparten esta elección (solo en memoria; se reinicia al cambiar de espacio).
 */
interface Seleccion {
  /** G4 · «historico»: censo ya realizado; «operativo»: Excel de un itinerario de una campaña operativa. */
  modo: 'historico' | 'operativo';
  municipioId: Id | null;
  campanaId: Id | null;
  itinerarioId: Id | null;
  elegir: (p: { modo?: 'historico' | 'operativo'; municipioId?: Id | null; campanaId?: Id | null; itinerarioId?: Id | null }) => void;
  reiniciar: () => void;
}
export const useSeleccionEspacio = create<Seleccion>((set) => ({
  modo: 'historico',
  municipioId: null,
  campanaId: null,
  itinerarioId: null,
  elegir: (p) => set(p),
  reiniciar: () => set({ modo: 'historico', municipioId: null, campanaId: null, itinerarioId: null }),
}));
