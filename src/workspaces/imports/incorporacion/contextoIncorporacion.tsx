import { createContext, useContext, useMemo } from 'react';
import { useStore } from '../../../store/store';
import { destinoEscenario, puedeDecidir } from '../../../domain/incorporacionDemo';
import type { BaseDatos } from '../../../domain/db';
import type { DestinoIncorporacion } from '../../../domain/incorporacion';
import type { Id } from '../../../domain/types';
import { useAsistente } from './estadoAsistente';

/**
 * Contexto de una incorporación: base, persona que decide y destino. Lo usan los componentes del
 * asistente (decisiones, trazas) para funcionar igual en la demostración (C1d) y en los espacios
 * aislados de C1e, sin duplicar el importador. Sin proveedor, toma la demostración.
 */
export interface CtxIncorporacion {
  db: BaseDatos;
  personaId: Id;
  autorizado: boolean;
  destino: DestinoIncorporacion;
}

export const ContextoIncorporacion = createContext<CtxIncorporacion | null>(null);

export function useCtxIncorporacion(): CtxIncorporacion {
  const propio = useContext(ContextoIncorporacion);
  const db = useStore((s) => s.db);
  const prefs = useStore((s) => s.prefs);
  const st = useAsistente();
  const destino = useMemo(() => (propio ? propio.destino : destinoEscenario(st.escenarioId, st.anio, st.nombre)), [propio, st.escenarioId, st.anio, st.nombre]);
  if (propio) return propio;
  return { db: db!, personaId: prefs.personaId, autorizado: puedeDecidir(prefs.roles), destino };
}
