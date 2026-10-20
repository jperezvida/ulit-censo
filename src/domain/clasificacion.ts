import type { BaseDatos } from './db';
import { ErrorDominio, kNC, kRev } from './db';
import { anioDe, revisionDe } from './consultas';
import { prepararOperacionNegocio, type Alcance } from './bloqueo';
import { hijosDe, ID_CATALOGO_DEMO, rutaActividad, TAXONOMIA_POR_ID } from './taxonomy';
import { opcionesCatalogo, raiz, rutaTexto } from './buscador';
import { normalizar } from './text';
import type { ClasificacionCampana, Id } from './types';

/** Catálogo de clasificación de una campaña (ausente = demostración). */
export function catalogoDeCampana(db: BaseDatos, campanaId: Id): string {
  return db.campanas[campanaId]?.catalogoId ?? ID_CATALOGO_DEMO;
}

/**
 * Comprueba una selección frente al catálogo de la campaña. No se exigen siempre cuatro niveles:
 *  - actividad (último nivel): válida;
 *  - subgrupo SIN actividades (Servicios, Discotecas): válido, descripción opcional;
 *  - subgrupo CON actividades: solo con una breve descripción (no encaja en ninguna actividad);
 *  - grupo o grupo de comercio: no basta.
 */
export function validarSeleccion(catalogo: string, nodoId: Id, descripcion?: string): void {
  const nodo = TAXONOMIA_POR_ID[nodoId];
  if (!nodo) throw new ErrorDominio('regla', 'Elige una clasificación del catálogo.');
  if ((nodo.catalogo ?? ID_CATALOGO_DEMO) !== catalogo) {
    throw new ErrorDominio('regla', `«${nodo.nombre}» no pertenece al catálogo de esta campaña (${catalogo}).`);
  }
  if (nodo.nivel < 3) throw new ErrorDominio('regla', `«${nodo.nombre}» es un grupo: elige al menos el subgrupo.`);
  if (hijosDe(nodo.id).length && !descripcion?.trim()) {
    throw new ErrorDominio('regla', `«${nodo.nombre}» tiene actividades por debajo: elige una o añade una breve descripción al subgrupo.`);
  }
}

/**
 * Resuelve una combinación de niveles por nombre (p. ej. columnas de un Excel) y comprueba que
 * es COHERENTE con el catálogo: el subgrupo debe pertenecer al grupo indicado, etc.
 */
export function resolverNiveles(
  catalogo: string,
  n: { grupo?: string; grupoComercio?: string; subgrupo?: string; actividad?: string; descripcion?: string },
): { nodoId: Id; descripcion?: string } {
  const eq = (a?: string, b?: string) => !a || (!!b && (normalizar(a) === normalizar(b) || raiz(a) === raiz(b)));
  const candidatos = opcionesCatalogo(catalogo).filter((o) => o.tipo !== 'ejemplo').filter((o) => {
    const r = rutaActividad(o.nodoId);
    const niv = { grupo: r.find((x) => x.nivel === 1)?.nombre, gc: r.find((x) => x.nivel === 2)?.nombre, sub: r.find((x) => x.nivel === 3)?.nombre, act: r.find((x) => x.nivel === 4)?.nombre };
    if (n.actividad ? !niv.act || !eq(n.actividad, niv.act) : !!niv.act) return false;
    return eq(n.subgrupo, niv.sub) && eq(n.grupo, niv.grupo) && (!n.grupoComercio || eq(n.grupoComercio, niv.gc));
  });
  const texto = [n.grupo, n.grupoComercio, n.subgrupo, n.actividad].filter(Boolean).join(' › ');
  if (!candidatos.length) throw new ErrorDominio('regla', `Combinación inconsistente con el catálogo: ${texto}.`);
  if (candidatos.length > 1) throw new ErrorDominio('regla', `Combinación ambigua: ${candidatos.map((c) => c.ruta).join(' | ')}.`);
  validarSeleccion(catalogo, candidatos[0].nodoId, n.descripcion);
  return { nodoId: candidatos[0].nodoId, descripcion: n.descripcion?.trim() || undefined };
}

/**
 * Equivalente de un nodo de OTRO catálogo en el catálogo indicado: solo por nombre idéntico
 * (sin tildes, singular/plural) y si es ÚNICO. Nunca se inventa una correspondencia.
 */
export function equivalenteEn(catalogo: string, nodoId: Id): Id | undefined {
  const origen = TAXONOMIA_POR_ID[nodoId];
  if (!origen) return undefined;
  if ((origen.catalogo ?? ID_CATALOGO_DEMO) === catalogo) return nodoId;
  const r = raiz(origen.nombre);
  const cands = opcionesCatalogo(catalogo).filter((o) => o.tipo === 'actividad' && (normalizar(o.etiqueta) === normalizar(origen.nombre) || raiz(o.etiqueta) === r));
  return cands.length === 1 ? cands[0].nodoId : undefined;
}

/**
 * Clasificación de actividad POR CAMPAÑA. Corregir la clasificación de 2026 nunca
 * modifica la de 2025, y una categoría anterior solo se reutiliza como borrador.
 */

export function clasificacionEn(db: BaseDatos, negocioId: Id | null | undefined, campanaId: Id): ClasificacionCampana | undefined {
  return negocioId ? db.clasificaciones[kNC(negocioId, campanaId)] : undefined;
}

/** La clasificación más reciente del MISMO negocio en una campaña anterior (solo referencia). */
export function clasificacionAnterior(db: BaseDatos, negocioId: Id, campanaId: Id): ClasificacionCampana | undefined {
  const anio = anioDe(db, campanaId);
  let mejor: ClasificacionCampana | undefined;
  for (const c of Object.values(db.clasificaciones)) {
    if (c.negocioId !== negocioId || c.campanaId === campanaId) continue;
    const a = anioDe(db, c.campanaId);
    if (a < anio && (!mejor || a > anioDe(db, mejor.campanaId))) mejor = c;
  }
  return mejor;
}

/**
 * Clasificación decidida por una persona: confirma la categorización de los registros donde
 * el negocio es el ocupante VIGENTE (no la de quien le sustituyó en el mismo local).
 *
 * No se exige siempre el cuarto nivel: el procedimiento 2026 admite nodos sin actividades
 * (p. ej. Discotecas) y, en Servicios, el subgrupo con una breve descripción. Un nodo con
 * actividades por debajo solo se acepta acompañado de descripción. La validación completa
 * del catálogo depurado llega con el bloque de catálogo.
 */
export function clasificar(
  db: BaseDatos, negocioId: Id, campanaId: Id, actividadId: Id, porId: Id,
  opciones: { alcance?: Alcance; fecha?: string; descripcion?: string } = {},
): BaseDatos {
  const descripcion = opciones.descripcion?.trim() || undefined;
  const catalogo = catalogoDeCampana(db, campanaId);
  validarSeleccion(catalogo, actividadId, descripcion);
  const ids = prepararOperacionNegocio(db, negocioId, campanaId, opciones.alcance);
  const fecha = opciones.fecha ?? new Date().toISOString();
  const revisiones = { ...db.revisiones };
  for (const id of ids) revisiones[kRev(campanaId, id)] = { ...revisionDe(db, campanaId, id), categorizacion: 'revisado' };
  return {
    ...db,
    revisiones,
    clasificaciones: { ...db.clasificaciones, [kNC(negocioId, campanaId)]: { negocioId, campanaId, actividadId, descripcion, catalogoId: catalogo, origen: 'manual', confirmada: true, porId, fecha } },
  };
}

/** Copia la clasificación anterior del MISMO negocio como borrador (no confirma la categorización). */
export function partirDeClasificacionAnterior(db: BaseDatos, negocioId: Id, campanaId: Id, porId: Id, opciones: { alcance?: Alcance } = {}): BaseDatos {
  const ant = clasificacionAnterior(db, negocioId, campanaId);
  if (!ant) return db;
  if (clasificacionEn(db, negocioId, campanaId)) return db; // nunca pisa una clasificación de la campaña
  const catalogo = catalogoDeCampana(db, campanaId);
  // Si la campaña anterior usa otro catálogo, solo se propone un equivalente de nombre idéntico y único.
  const actividadId = equivalenteEn(catalogo, ant.actividadId);
  if (!actividadId) return db;
  prepararOperacionNegocio(db, negocioId, campanaId, opciones.alcance);
  const fecha = new Date().toISOString();
  const cambiaCatalogo = actividadId !== ant.actividadId;
  return {
    ...db,
    clasificaciones: {
      ...db.clasificaciones,
      [kNC(negocioId, campanaId)]: {
        negocioId, campanaId, actividadId, descripcion: cambiaCatalogo ? undefined : ant.descripcion, catalogoId: catalogo, origen: 'heredado', confirmada: false, porId, fecha,
        migracion: cambiaCatalogo ? { desdeActividadId: ant.actividadId, desdeCatalogo: TAXONOMIA_POR_ID[ant.actividadId]?.catalogo ?? ID_CATALOGO_DEMO, fecha, criterio: 'nombre idéntico en el catálogo de la campaña', estabaConfirmada: ant.confirmada } : undefined,
      },
    },
  };
}

export interface InformeMigracion {
  campanaId: Id;
  catalogo: string;
  revisadas: number;
  propuestas: { negocioId: Id; desde: string; hacia: string; estabaConfirmada: boolean }[];
  sinEquivalencia: { negocioId: Id; desde: string }[];
}

/**
 * Migración SEGURA de las clasificaciones de una campaña al catálogo que tiene asignado.
 *  - Solo afecta a esa campaña: el histórico de otras campañas no se toca.
 *  - Con equivalente de nombre idéntico y único: se convierte en PROPUESTA (origen «migrado», sin
 *    confirmar) con traza del valor anterior; la categorización vuelve a «pendiente». Nunca se
 *    reasigna en silencio una clasificación confirmada.
 *  - Sin equivalente: se deja como estaba (catálogo anterior) y Oficina la señala como incidencia.
 * Es idempotente: una segunda ejecución no cambia nada.
 */
export function migrarClasificacionesCampana(db0: BaseDatos, campanaId: Id): { db: BaseDatos; informe: InformeMigracion } {
  const catalogo = catalogoDeCampana(db0, campanaId);
  const informe: InformeMigracion = { campanaId, catalogo, revisadas: 0, propuestas: [], sinEquivalencia: [] };
  const clasificaciones = { ...db0.clasificaciones };
  const revisiones = { ...db0.revisiones };
  const fecha = new Date().toISOString();
  const localesPorNegocio = new Map<Id, Id[]>();
  for (const o of Object.values(db0.ocupaciones)) if (o.negocioId) localesPorNegocio.set(o.negocioId, [...(localesPorNegocio.get(o.negocioId) ?? []), o.localId]);
  for (const [k, c] of Object.entries(db0.clasificaciones)) {
    if (c.campanaId !== campanaId) continue;
    informe.revisadas++;
    const actual = TAXONOMIA_POR_ID[c.actividadId]?.catalogo ?? ID_CATALOGO_DEMO;
    if (actual === catalogo) continue;
    const nuevo = equivalenteEn(catalogo, c.actividadId);
    if (!nuevo) {
      informe.sinEquivalencia.push({ negocioId: c.negocioId, desde: rutaTexto(c.actividadId) });
      continue;
    }
    clasificaciones[k] = {
      ...c, actividadId: nuevo, catalogoId: catalogo, descripcion: undefined, origen: 'migrado', confirmada: false, fecha,
      migracion: { desdeActividadId: c.actividadId, desdeCatalogo: actual, fecha, criterio: 'nombre idéntico en el catálogo de la campaña', estabaConfirmada: c.confirmada },
    };
    informe.propuestas.push({ negocioId: c.negocioId, desde: rutaTexto(c.actividadId), hacia: rutaTexto(nuevo), estabaConfirmada: c.confirmada });
    for (const localId of localesPorNegocio.get(c.negocioId) ?? []) {
      const kr = kRev(campanaId, localId);
      if (revisiones[kr]) revisiones[kr] = { ...revisiones[kr], categorizacion: 'pendiente' };
    }
  }
  return { db: { ...db0, clasificaciones, revisiones }, informe };
}
