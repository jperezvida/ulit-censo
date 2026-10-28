import { createContext, useContext } from 'react';
import { useStore } from './store';
import type { BaseDatos } from '../domain/db';
import type { Id, Rol } from '../domain/types';

export type Aplicar = (fn: (db: BaseDatos) => BaseDatos, etiqueta: string, opciones?: { silencioso?: boolean; sinAvisoError?: boolean }) => boolean;

/**
 * Fuente de datos de Oficina. Sin proveedor, Oficina trabaja con la demostración (`useStore`), como
 * siempre. Con proveedor (espacio de ensayo), lee la base del espacio, fija la campaña y la persona, y
 * guarda por la vía del espacio (`useEspacios.modificar`): nada se copia ni se escribe en la demostración.
 */
export interface FuenteOficina {
  db: BaseDatos;
  campanaId: Id;
  personaId: Id;
  roles: Rol[];
  aplicar: Aplicar;
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
