import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { campanasDe, indiceObservaciones, indiceOcupaciones } from '../domain/consultas';
import { useStore } from './store';
import type { Rol } from '../domain/types';

/** Contexto activo (municipio + campaña) con índices memorizados sobre la base. */
export function useContexto() {
  const db = useStore((s) => s.db!);
  const prefs = useStore((s) => s.prefs);
  const municipio = db.municipios[prefs.municipioId] ?? Object.values(db.municipios)[0];
  const campanas = useMemo(() => campanasDe(db, municipio.id), [db, municipio.id]);
  const campana = (db.campanas[prefs.campanaId]?.municipioId === municipio.id ? db.campanas[prefs.campanaId] : undefined) ?? campanas[campanas.length - 1];
  const referencia = campana?.campanaReferenciaId ? db.campanas[campana.campanaReferenciaId] : undefined;
  return { db, prefs, municipio, campanas, campana, referencia };
}

export function useIndices() {
  const db = useStore((s) => s.db!);
  return useMemo(() => ({ obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) }), [db]);
}

export function useRol() {
  const roles = useStore((s) => s.prefs.roles);
  return {
    roles,
    tiene: (r: Rol) => roles.includes(r) || roles.includes('administrador'),
  };
}

/** Abre la ficha de un local en el panel lateral, desde cualquier espacio. */
export function useFichaLocal() {
  const [params, setParams] = useSearchParams();
  return {
    abierto: params.get('local'),
    abrir: (id: string) => {
      const p = new URLSearchParams(params);
      p.set('local', id);
      setParams(p);
    },
    cerrar: () => {
      const p = new URLSearchParams(params);
      p.delete('local');
      setParams(p);
    },
  };
}
