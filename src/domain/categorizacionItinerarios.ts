import type { BaseDatos } from './db';
import type { RevisionCategoriaRegistro } from './types';
import { ID_CATALOGO_2026 } from './catalogo2026';
import { resolverNiveles } from './clasificacion';
import { auditarRevisionGeneral, datoRevisionGeneral, type FilaRevisionGeneral } from './revisionGeneral';

export const CAMPOS_CATEGORIA = ['grupoActividad', 'grupoComercio', 'subgrupo', 'actividad', 'descripcionActividad'] as const;
export type ValoresCategoria = Record<(typeof CAMPOS_CATEGORIA)[number], string>;

export interface FilaCategorizacion {
  id: string;
  origen: FilaRevisionGeneral;
  existente: ValoresCategoria;
  tieneCategoria: boolean;
  /** Ruta oficial sugerida desde las celdas previas; requiere clic del revisor. */
  equivalente?: { nodoId: string; descripcion?: string };
  problemaEquivalencia?: string;
  revision?: RevisionCategoriaRegistro;
  revisada: boolean;
}

export interface ResumenCategorizacion {
  filas: FilaCategorizacion[];
  registrosTotales: number;
  vacios: number;
  ocupados: number;
  conCategoria: number;
  sinCategoria: number;
  revisados: number;
  rechazados: number;
  pendientes: number;
  importacionCompleta: boolean;
}

export function valoresCategoriaOrigen(f: FilaRevisionGeneral): ValoresCategoria {
  return {
    grupoActividad: datoRevisionGeneral(f.registro, 'grupoActividad', f.correccion?.valores),
    grupoComercio: datoRevisionGeneral(f.registro, 'grupoComercio', f.correccion?.valores),
    subgrupo: datoRevisionGeneral(f.registro, 'subgrupo', f.correccion?.valores),
    actividad: datoRevisionGeneral(f.registro, 'actividad', f.correccion?.valores),
    descripcionActividad: datoRevisionGeneral(f.registro, 'descripcionActividad', f.correccion?.valores),
  };
}

/** Todos los registros OCUPADOS de la importación confirmada, incluso sin vínculo a un local físico.
 * No confundir filas ocupadas con locales únicos antes de la conciliación.
 */
export function obtenerCategorizacionItinerario(
  db: BaseDatos, campanaId: string, itinerarioId: string,
): ResumenCategorizacion {
  const campana = db.campanas[campanaId];
  if (!campana || campana.anio !== 2026 || db.itinerarios[itinerarioId]?.campanaId !== campanaId) {
    return { filas: [], registrosTotales: 0, vacios: 0, ocupados: 0,
      conCategoria: 0, sinCategoria: 0, revisados: 0, rechazados: 0, pendientes: 0,
      importacionCompleta: false };
  }
  const todas = auditarRevisionGeneral(db, campanaId).filas
    .filter((f) => f.registro.itinerarioId === itinerarioId);
  // La pertenencia real al itinerario se acredita por las filas, no por un
  // enlace a LocalFisico (91 filas de IT1 aún no están conciliadas).
  const ids = new Set(todas.map((f) => f.registro.importacionId));
  const esperadas = Object.values(db.importaciones).filter((i) =>
    ids.has(i.id) && i.campanaId === campanaId && i.estado === 'confirmada');
  const totalesOrigen = esperadas;
  const faltantes = totalesOrigen.length === 0 || totalesOrigen.some((i) =>
    todas.filter((f) => f.registro.importacionId === i.id).length !== i.filas);
  const ocupadas = todas.filter((f) => f.estado === 'ocupado');

  const filas: FilaCategorizacion[] = ocupadas.map((f) => {
    const existente = valoresCategoriaOrigen(f);
    const tieneCategoria = CAMPOS_CATEGORIA.some((campo) => existente[campo].trim() !== '');
    let equivalente: FilaCategorizacion['equivalente'];
    let problemaEquivalencia: string | undefined;
    if (tieneCategoria) {
      try {
        const coincidencia = resolverNiveles(ID_CATALOGO_2026, {
          grupo: existente.grupoActividad, grupoComercio: existente.grupoComercio,
          subgrupo: existente.subgrupo, actividad: existente.actividad,
          descripcion: existente.descripcionActividad,
        });
        equivalente = coincidencia;
      } catch {
        problemaEquivalencia = 'La clasificación anterior no coincide de forma inequívoca con el catálogo oficial 2026. Selecciona una categoría para corregirla.';
      }
    }
    const previo = db.revisionesCategoriaRegistros?.[f.id];
    const revision = previo?.campanaId === campanaId && previo.itinerarioId === itinerarioId
      && previo.nombreRevisado === f.nombre && f.estado === 'ocupado'
      && previo.catalogoId === ID_CATALOGO_2026 ? previo : undefined;
    const revisada = !!revision && revision.estado !== 'rechazada' && !!revision.nodoId;
    return { id: f.id, origen: f, existente, tieneCategoria, equivalente,
      problemaEquivalencia, revision, revisada };
  });
  return {
    filas, registrosTotales: todas.length,
    vacios: todas.filter((f) => f.estado === 'vacio').length,
    ocupados: filas.length,
    conCategoria: filas.filter((f) => f.tieneCategoria).length,
    sinCategoria: filas.filter((f) => !f.tieneCategoria).length,
    revisados: filas.filter((f) => f.revisada).length,
    rechazados: filas.filter((f) => f.revision?.estado === 'rechazada').length,
    pendientes: filas.filter((f) => !f.revisada).length,
    importacionCompleta: !faltantes && todas.length > 0,
  };
}

/** Solo las confirmaciones/reclasificaciones humanas sustituyen la clasificación del Excel de trabajo. */
export function categoriaEfectivaFila(
  db: BaseDatos, f: FilaRevisionGeneral,
): ValoresCategoria {
  const original = valoresCategoriaOrigen(f);
  const revision = db.revisionesCategoriaRegistros?.[f.id];
  return revision && revision.nombreRevisado === f.nombre && revision.estado !== 'rechazada'
    && revision.nodoId && revision.catalogoId === ID_CATALOGO_2026
    && revision.campanaId === db.importaciones[f.registro.importacionId]?.campanaId
    ? { ...original, ...revision.valores } : original;
}
