import { ErrorDominio } from './db';
import { validarSeleccion } from './clasificacion';
import { sugerirPorNombre } from './buscador';
import { TAXONOMIA_POR_ID, ID_CATALOGO_DEMO, nivelesDe } from './taxonomy';
import type { ClasificacionCampana } from './types';

/**
 * Avisos NO bloqueantes de clasificación sospechosa (B5). Son advertencias para una persona:
 * nunca cambian la actividad ni bloquean la aprobación, y una coincidencia de texto no es una
 * prueba. Casos:
 *  - categoría de otro catálogo;
 *  - combinación incoherente con el catálogo de la campaña;
 *  - establecimiento ocupado sin clasificar;
 *  - contradicción fuerte entre el nombre y la actividad (el nombre apunta a otra rama).
 */

const cacheSugerencias = new Map<string, ReturnType<typeof sugerirPorNombre>>();
function sugerencias(catalogo: string, nombre: string) {
  const k = `${catalogo}|${nombre}`;
  let s = cacheSugerencias.get(k);
  if (!s) {
    if (cacheSugerencias.size > 20000) cacheSugerencias.clear();
    s = sugerirPorNombre(catalogo, nombre);
    cacheSugerencias.set(k, s);
  }
  return s;
}

/** Rama de un nodo: grupo de comercio en Comercio; grupo de actividad en el resto. */
const rama = (id: string) => {
  const n = nivelesDe(id);
  return (n.grupoComercio ?? n.grupo)?.id;
};

export const AVISO_SIN_CLASIFICAR = 'Ocupado sin clasificar';

export function avisosClasificacion(catalogo: string, cla: ClasificacionCampana | undefined, nombre: string): string[] {
  if (!cla) return [AVISO_SIN_CLASIFICAR];
  const nodo = TAXONOMIA_POR_ID[cla.actividadId];
  if (!nodo || (nodo.catalogo ?? ID_CATALOGO_DEMO) !== catalogo) return ['Clasificación de otro catálogo: revisar'];
  try {
    validarSeleccion(catalogo, cla.actividadId, cla.descripcion);
  } catch (e) {
    return [`Combinación incoherente: ${e instanceof ErrorDominio ? e.message : String(e)}`];
  }
  const s = sugerencias(catalogo, nombre).sugerencias;
  if (s.length) {
    const sub = nivelesDe(cla.actividadId).subgrupo?.id;
    const r = rama(cla.actividadId);
    const encaja = s.some((x) => nivelesDe(x.nodoId).subgrupo?.id === sub || rama(x.nodoId) === r);
    if (!encaja) return [`El nombre sugiere «${s[0].etiqueta}» (${s[0].ruta}) y la actividad es «${nodo.nombre}»: revisar`];
  }
  return [];
}
