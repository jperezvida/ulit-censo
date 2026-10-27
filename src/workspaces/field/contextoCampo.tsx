import { createContext, useContext, useState, type ReactNode } from 'react';
import { useStore } from '../../store/store';
import { useEspacios } from '../../store/espacios';
import { personaEspacio } from '../../domain/espacios';
import type { BaseDatos } from '../../domain/db';
import type { Id } from '../../domain/types';

/**
 * Datos de Campo: los de la demostración (useStore) o los del espacio de ensayo (useEspacios), nunca
 * mezclados. Las pantallas de Campo leen SOLO de aquí. En el ensayo, Campo es de solo lectura: no hay
 * escritura ni sincronización (la de la demostración es una simulación).
 */
export interface CtxCampo {
  db: BaseDatos;
  demo: boolean;
  soloLectura: boolean;
  personaId: Id;
  sinConexion: boolean;
  modoSol: boolean;
  setPrefs: (p: { sinConexion?: boolean; modoSol?: boolean; campoPersonaId?: Id }) => void;
  /** Escritura (solo demostración). */
  aplicar?: ReturnType<typeof useStore.getState>['aplicar'];
  avisar?: ReturnType<typeof useStore.getState>['avisar'];
  /** Ruta de un itinerario o de una de sus calles. */
  ruta: (itId: Id, calleId?: Id) => string;
  /** Inicio de Campo (lista de itinerarios en la demostración; el espacio de ensayo en el ensayo). */
  salida: string;
  /** En el ensayo, el único itinerario abierto (no se navega a otros). */
  itinerarioFijo?: Id;
}

const Ctx = createContext<CtxCampo | null>(null);
export function useCampo(): CtxCampo {
  const c = useContext(Ctx);
  if (!c) throw new Error('Campo no tiene un contexto de datos.');
  return c;
}

export function CampoDemo({ children }: { children: ReactNode }) {
  const db = useStore((s) => s.db!);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const aplicar = useStore((s) => s.aplicar);
  const avisar = useStore((s) => s.avisar);
  return (
    <Ctx.Provider value={{
      db, demo: true, soloLectura: false, personaId: prefs.campoPersonaId, sinConexion: prefs.sinConexion, modoSol: prefs.modoSol,
      setPrefs, aplicar, avisar, ruta: (it, calle) => `/campo/it/${it}${calle ? `/calle/${calle}` : ''}`, salida: '/campo',
    }}>{children}</Ctx.Provider>
  );
}

export function CampoEnsayo({ campanaId, itinerarioId, children }: { campanaId: Id; itinerarioId: Id; children: ReactNode }) {
  const db = useEspacios((s) => s.db!);
  const [modoSol, setModoSol] = useState(false);
  const base = `/espacios/ensayo/campo/${campanaId}/${itinerarioId}`;
  return (
    <Ctx.Provider value={{
      db, demo: false, soloLectura: true, personaId: personaEspacio(db)?.id ?? '', sinConexion: false, modoSol,
      setPrefs: (p) => { if (p.modoSol !== undefined) setModoSol(p.modoSol); },
      ruta: (it, calle) => (it === itinerarioId ? `${base}${calle ? `/calle/${calle}` : ''}` : '/espacios/ensayo'),
      salida: '/espacios/ensayo', itinerarioFijo: itinerarioId,
    }}>{children}</Ctx.Provider>
  );
}
