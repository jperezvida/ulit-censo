import type { BaseDatos } from './db';
import type { RevisionCategoriaRegistro } from './types';
import { auditarRevisionGeneral, datoRevisionGeneral, type FilaRevisionGeneral } from './revisionGeneral';
import { NODOS_2026, rutaActividad, TAXONOMIA_POR_ID } from './taxonomy';
import { validarSeleccion } from './clasificacion';
import { ID_CATALOGO_2026 } from './catalogo2026';

/** Los campos reales del Excel 2026; no incluir franquicia ni presencia digital. */
export const CLAVES_CATEGORIA = [
  'grupoActividad', 'grupoComercio', 'subgrupo', 'actividad', 'descripcionActividad',
] as const;
export type ClaveCategoria = (typeof CLAVES_CATEGORIA)[number];
export type ValoresCategoria = Record<ClaveCategoria, string>;

export interface FilaCategoriaIT1 {
  fila: FilaRevisionGeneral;
  existentes: ValoresCategoria;
  efectivos: ValoresCategoria;
  revision?: RevisionCategoriaRegistro;
  tienePropuesta: boolean;
  confirmada: boolean;
}

export function categoriasEfectivas(
  registro: FilaRevisionGeneral,
  revision?: RevisionCategoriaRegistro,
): ValoresCategoria {
  return Object.fromEntries(CLAVES_CATEGORIA.map((clave) => [clave,
    !!revision && Object.hasOwn(revision.valores, clave)
      ? revision.valores[clave]
      : datoRevisionGeneral(registro.registro, clave, registro.correccion?.valores),
  ])) as ValoresCategoria;
}

export function categoriaTexto(v: ValoresCategoria): string {
  return [v.grupoActividad, v.grupoComercio, v.subgrupo, v.actividad]
    .filter((x) => x.trim()).join(' › ') || 'Sin categorización';
}

/** Solo IT1 2026; incluye TODAS las filas ocupadas sin depender de vínculos físicos. */
export function prepararRevisionCategoriaIT1(db: BaseDatos, campanaId: string): FilaCategoriaIT1[] {
  if (db.campanas[campanaId]?.anio !== 2026) return [];
  return auditarRevisionGeneral(db, campanaId).filas
    .filter((f) => f.itinerario === 'IT1' && f.estado === 'ocupado')
    .map((fila) => {
      const revision = db.revisionesCategoriaRegistros?.[fila.id];
      const vigente = revision?.campanaId === campanaId ? revision : undefined;
      const existentes = categoriasEfectivas(fila);
      const efectivos = categoriasEfectivas(fila, vigente);
      const tienePropuesta = CLAVES_CATEGORIA.some((clave) => existentes[clave].trim().length > 0);
      const confirmada = !!vigente && vigente.estado !== 'rechazada'
        && CLAVES_CATEGORIA.every((clave) => vigente.valores[clave] === efectivos[clave]);
      return { fila, existentes, efectivos, revision: vigente, tienePropuesta, confirmada };
    });
}

/** Construye una clasificación nueva usando EXCLUSIVAMENTE la jerarquía oficial. */
export function categoriasDelCatalogo(nodoId: string, descripcion = ''): ValoresCategoria {
  const nodo = TAXONOMIA_POR_ID[nodoId];
  if (!nodo || nodo.catalogo !== ID_CATALOGO_2026) {
    throw new Error('Selecciona una actividad del catálogo oficial de 2026.');
  }
  validarSeleccion(ID_CATALOGO_2026, nodoId, descripcion);
  const ruta = rutaActividad(nodoId);
  const nivel = (n: number) => ruta.find((x) => x.nivel === n)?.nombre ?? '';
  return {
    grupoActividad: nivel(1), grupoComercio: nivel(2), subgrupo: nivel(3),
    actividad: nivel(4), descripcionActividad: descripcion.trim(),
  };
}

export const OPCIONES_CATEGORIAS_2026 = NODOS_2026
  .filter((n) => n.nivel >= 3)
  .map((n) => ({ id: n.id, etiqueta: rutaActividad(n.id).map((x) => x.nombre).join(' › '),
    requiereDescripcion: n.nivel === 3 && NODOS_2026.some((h) => h.padreId === n.id) }))
  .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
