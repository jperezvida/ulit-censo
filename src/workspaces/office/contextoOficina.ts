import { createContext, useContext, useMemo } from 'react';
import { useContexto, useIndices } from '../../store/contexto';
import { useStore, type ModoOficina } from '../../store/store';
import { filasOficina, resumenItinerarios, type FilaOficina } from '../../domain/oficina';
import { estaBloqueado, type Alcance } from '../../domain/bloqueo';
import type { Campana, Id, Itinerario } from '../../domain/types';

/**
 * Contexto de trabajo de Oficina: campaña, itinerario (o vista municipal) y alcance.
 * Todas las operaciones lanzadas desde un itinerario llevan su alcance, de modo que el
 * dominio rechaza cualquier cambio fuera de él.
 */
export interface CtxOficina {
  campana: Campana;
  itinerario?: Itinerario;
  alcance?: Alcance;
  bloqueado: boolean;
  personaId: Id;
}

export const OficinaContext = createContext<CtxOficina | null>(null);

export function useCtxOficina(): CtxOficina | null {
  return useContext(OficinaContext);
}

/** Filas de la campaña activa (todas, o solo las del itinerario). Memorizadas sobre la base. */
export function useFilas(itinerarioId?: Id): FilaOficina[] {
  const { db, campana } = useContexto();
  const ix = useIndices();
  return useMemo(() => (campana ? filasOficina(db, campana.id, ix, { itinerarioId }) : []), [db, campana, ix, itinerarioId]);
}

export function useResumenes() {
  const { db, campana } = useContexto();
  const filas = useFilas();
  return useMemo(() => (campana ? resumenItinerarios(db, campana.id, filas) : []), [db, campana, filas]);
}

export function useModoOficina(): [ModoOficina, (m: ModoOficina) => void] {
  const personaId = useStore((s) => s.prefs.personaId);
  const modo = useStore((s) => s.prefs.oficina?.[s.prefs.personaId]?.modo ?? 'tareas');
  const set = useStore((s) => s.setPrefsOficina);
  return [modo, (m) => set(personaId, { modo: m })];
}

export function useBloqueado(itinerarioId?: Id): boolean {
  const db = useStore((s) => s.db!);
  return itinerarioId ? estaBloqueado(db, itinerarioId) : false;
}
