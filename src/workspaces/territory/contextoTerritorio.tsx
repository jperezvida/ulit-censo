import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { indiceObservaciones, indiceOcupaciones } from '../../domain/consultas';
import { useContexto, useIndices, useRol } from '../../store/contexto';
import { useStore } from '../../store/store';
import { useEspacios } from '../../store/espacios';
import { personaEspacio } from '../../domain/espacios';
import type { BaseDatos } from '../../domain/db';
import type { Id } from '../../domain/types';

type Contexto = {
  db: BaseDatos;
  municipio: BaseDatos['municipios'][string];
  campana: BaseDatos['campanas'][string] | undefined;
  referencia: BaseDatos['campanas'][string] | undefined;
  ix: { obs: ReturnType<typeof indiceObservaciones>; ocu: ReturnType<typeof indiceOcupaciones> };
  personaId: Id;
  demo: boolean;
  puedeEditar: boolean;
  puedePlanificarEnsayo: boolean;
  aplicar: (fn: (db: BaseDatos) => BaseDatos, etiqueta: string, opciones?: { silencioso?: boolean }) => boolean;
  avisar: (texto: string, tipo?: 'ok' | 'info' | 'error', deshacer?: boolean) => void;
  dbVigente: () => BaseDatos;
};

const Context = createContext<Contexto | null>(null);
export function useContextoTerritorio() {
  const c = useContext(Context);
  if (!c) throw new Error('El planificador no tiene un contexto de datos.');
  return c;
}

export function TerritorioDemo({ children }: { children: ReactNode }) {
  const { db, municipio, campana, referencia, prefs } = useContexto();
  const ix = useIndices();
  const { tiene } = useRol();
  const aplicar = useStore((s) => s.aplicar);
  const avisar = useStore((s) => s.avisar);
  return <Context.Provider value={{ db, municipio, campana, referencia, ix, personaId: prefs.personaId,
    demo: true, puedeEditar: tiene('coordinador') && campana?.tipo !== 'historico-importado', puedePlanificarEnsayo: false,
    aplicar, avisar, dbVigente: () => useStore.getState().db! }}>{children}</Context.Provider>;
}

export function TerritorioEnsayo({ campanaId, children }: { campanaId: Id; children: ReactNode }) {
  const db = useEspacios((s) => s.db!);
  const campana = db.campanas[campanaId];
  const municipio = campana && db.municipios[campana.municipioId];
  const referencia = campana?.campanaReferenciaId ? db.campanas[campana.campanaReferenciaId] : undefined;
  const ix = useMemo(() => ({ obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) }), [db]);
  const persona = personaEspacio(db);
  if (!campana || !municipio) return null;
  const noEditar = () => { throw new Error('La demostración no puede guardar cambios del ensayo.'); };
  return <Context.Provider value={{ db, campana, municipio, referencia, ix, personaId: persona?.id ?? '',
    demo: false, puedeEditar: false, puedePlanificarEnsayo: !!persona?.roles.some((r) => r === 'coordinador' || r === 'administrador'), aplicar: noEditar, avisar: () => undefined,
    dbVigente: () => useEspacios.getState().db! }}>{children}</Context.Provider>;
}
