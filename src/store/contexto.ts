import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { campanasDe, indiceObservaciones, indiceOcupaciones } from '../domain/consultas';
import { useStore } from './store';
import { useFuenteOficina } from './fuenteOficina';
import type { Rol } from '../domain/types';

/** Contexto activo (municipio + campaña) con índices memorizados sobre la base. */
export function useContexto() {
  const fuente = useFuenteOficina();
  const dbDemo = useStore((s) => s.db);
  const prefsDemo = useStore((s) => s.prefs);
  const db = fuente?.db ?? dbDemo!;
  // Con una fuente de espacio, la campaña y la persona las fija la fuente (las preferencias de la demostración no se tocan).
  const prefs = useMemo(() => (fuente ? { ...prefsDemo, campanaId: fuente.campanaId, municipioId: fuente.db.campanas[fuente.campanaId]?.municipioId ?? '', personaId: fuente.personaId, roles: fuente.roles } : prefsDemo), [fuente, prefsDemo]);
  const municipio = db.municipios[prefs.municipioId] ?? Object.values(db.municipios)[0];
  const campanas = useMemo(() => campanasDe(db, municipio.id), [db, municipio.id]);
  const campana = (db.campanas[prefs.campanaId]?.municipioId === municipio.id ? db.campanas[prefs.campanaId] : undefined) ?? campanas[campanas.length - 1];
  const referencia = campana?.campanaReferenciaId ? db.campanas[campana.campanaReferenciaId] : undefined;
  return { db, prefs, municipio, campanas, campana, referencia };
}

export function useIndices() {
  const fuente = useFuenteOficina();
  const dbDemo = useStore((s) => s.db);
  const db = fuente?.db ?? dbDemo!;
  return useMemo(() => ({ obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) }), [db]);
}

export function useRol() {
  const fuente = useFuenteOficina();
  const rolesDemo = useStore((s) => s.prefs.roles);
  const roles = fuente?.roles ?? rolesDemo;
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
