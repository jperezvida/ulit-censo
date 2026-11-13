import { createContext, useContext } from 'react';
import { useStore } from './store';
import type { BaseDatos } from '../domain/db';
import type { Id, Rol } from '../domain/types';
import type { CambioRevisionGeneralReal } from './revisionGeneralReal';

export type Aplicar = (fn: (db: BaseDatos) => BaseDatos, etiqueta: string, opciones?: { silencioso?: boolean; sinAvisoError?: boolean }) => boolean;

/**
 * Fuente compartida de la interfaz completa. Sin proveedor, la aplicación trabaja con la demostración (`useStore`), como
 * siempre. Con proveedor (espacio de ensayo), lee la base del espacio, fija la campaña y la persona, y
 * guarda por la vía del espacio (`useEspacios.modificar`): nada se copia ni se escribe en la demostración.
 */
export interface FuenteOficina {
  db: BaseDatos;
  campanaId: Id;
  personaId: Id;
  roles: Rol[];
  aplicar: Aplicar;
  /** En la interfaz completa, una fuente real es de consulta hasta autorizar escrituras específicas. */
  soloLectura?: boolean;
  elegirCampana?: (campanaId: Id) => void;
  /** Recarga verificada desde Supabase después de una operación real restringida. */
  recargarReal?: () => Promise<void>;
  /** Aplica en memoria solo la corrección ya confirmada por Supabase, sin recargar el censo. */
  aplicarCorreccionReal?: (cambio: CambioRevisionGeneralReal) => void;
  versionReal?: number;
}

export const FuenteOficinaContext = createContext<FuenteOficina | null>(null);
export const useFuenteOficina = () => useContext(FuenteOficinaContext);

/** Operación de escritura de Oficina sobre la fuente activa. */
export function useAplicar(): Aplicar {
  const f = useFuenteOficina();
  const demo = useStore((s) => s.aplicar);
  return f?.aplicar ?? demo;
}

/** Base de datos de la fuente activa. */
export function useDbOficina(): BaseDatos {
  const f = useFuenteOficina();
  const demo = useStore((s) => s.db);
  return f?.db ?? demo!;
}
