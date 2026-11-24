import type { BaseDatos } from './db';
import type { RevisionCategoriaRegistro } from './types';
import { auditarRevisionGeneral, datoRevisionGeneral, type FilaRevisionGeneral } from './revisionGeneral';
import { NODOS_2026, rutaActividad, TAXONOMIA_POR_ID } from './taxonomy';
import { resolverNiveles, validarSeleccion } from './clasificacion';
import { ID_CATALOGO_2026 } from './catalogo2026';
import { normalizar } from './text';

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

/** Decisión aún no confirmada por el servidor (forma mínima de la cola de guardado). */
export interface DecisionPendienteCategoria {
  registroId: string;
  accion: 'aceptar' | 'rechazar' | 'corregir';
  valores: ValoresCategoria;
}

/**
 * Fila repartida entre los dos pasos de trabajo:
 * - Paso 1 (validar): tiene categoría del Excel y no se ha rechazado ni corregido.
 * - Paso 2 (categorizar): no tiene categoría original, o se rechazó la del Excel.
 * `pendiente` indica que falta una decisión humana; lo que está en la cola NO está guardado
 * (eso lo dice solo `confirmada`, que procede exclusivamente del servidor).
 */
export interface FilaPasoCategoria extends FilaCategoriaIT1 {
  paso: 1 | 2;
  pendiente: boolean;
  /** Última decisión de la cola para el registro (por guardar). */
  enCola?: DecisionPendienteCategoria;
  /** Valores que verá la persona: los de la cola si está corrigiendo, si no los efectivos. */
  visibles: ValoresCategoria;
}

export function repartirPasosCategoria(
  filas: FilaCategoriaIT1[],
  cola: readonly DecisionPendienteCategoria[],
): FilaPasoCategoria[] {
  const ultima = new Map(cola.map((d) => [d.registroId, d]));
  return filas.map((f) => {
    const enCola = ultima.get(f.fila.id);
    const estado = f.revision?.estado;
    const paso: 1 | 2 = !f.tienePropuesta || estado === 'corregida'
      || (enCola ? enCola.accion !== 'aceptar' : estado === 'rechazada') ? 2 : 1;
    // Una decisión en cola cuenta como "decidida" (no se vuelve a pedir), pero no como guardada.
    const decidida = enCola ? enCola.accion !== 'rechazar' : f.confirmada;
    return { ...f, paso, pendiente: !decidida, enCola,
      visibles: enCola?.accion === 'corregir' ? enCola.valores : f.efectivos };
  });
}

/** Clave del catálogo 2026 equivalente a unos valores, si son coherentes y únicos. */
export function claveCategoria2026(v: ValoresCategoria): string | undefined {
  try {
    return resolverNiveles(ID_CATALOGO_2026, {
      grupo: v.grupoActividad || undefined, grupoComercio: v.grupoComercio || undefined,
      subgrupo: v.subgrupo || undefined, actividad: v.actividad || undefined,
      descripcion: v.descripcionActividad || undefined,
    }).nodoId;
  } catch {
    return undefined;
  }
}

/**
 * Categorías más frecuentes del itinerario, SOLO a partir de decisiones confirmadas por el
 * servidor (aceptadas o corregidas). Las clasificaciones originales pendientes de revisar y las
 * rechazadas no cuentan: lo no validado no debe reforzarse como propuesta.
 */
export function categoriasFrecuentes(filas: FilaCategoriaIT1[], limite = 5): string[] {
  const usos = new Map<string, number>();
  for (const f of filas) {
    const estado = f.revision?.estado;
    if (!f.confirmada || (estado !== 'aceptada' && estado !== 'corregida')) continue;
    const clave = claveCategoria2026(f.efectivos);
    if (clave) usos.set(clave, (usos.get(clave) ?? 0) + 1);
  }
  return [...usos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limite).map(([clave]) => clave);
}

const nivel = (x: string) => normalizar(x ?? '').trim();
/** Misma categoría (grupo, grupo de comercio, subgrupo y actividad), sin mirar la descripción. */
export function mismaCategoria(a: ValoresCategoria, b: ValoresCategoria): boolean {
  return (['grupoActividad', 'grupoComercio', 'subgrupo', 'actividad'] as const)
    .every((k) => nivel(a[k]) === nivel(b[k]));
}

/**
 * ¿La opción del catálogo (nodo + descripción) equivale a la categoría indicada?
 * Se usa para no volver a proponer como marcada una categoría ya rechazada.
 */
export function opcionEquivaleA(nodoId: string, v: ValoresCategoria): boolean {
  const nodo = TAXONOMIA_POR_ID[nodoId];
  if (!nodo || nodo.catalogo !== ID_CATALOGO_2026) return false;
  const ruta = rutaActividad(nodoId);
  const n = (x: number) => ruta.find((r) => r.nivel === x)?.nombre ?? '';
  return mismaCategoria({ grupoActividad: n(1), grupoComercio: n(2), subgrupo: n(3),
    actividad: n(4), descripcionActividad: '' }, v);
}
