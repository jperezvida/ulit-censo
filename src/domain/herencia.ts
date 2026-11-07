import type { BaseDatos } from './db';
import { anioDe, indiceObservaciones, indiceOcupaciones, observacionesDeLocal, observacionEn, ocupacionEn, type IndiceObservaciones, type IndiceOcupaciones } from './consultas';
import { comprobarAlcance, comprobarEditable, enLote, type Alcance } from './bloqueo';
import { catalogoDeCampana, clasificacionEn, equivalenteEn, heredarClasificacionEnCopia } from './clasificacion';
import { datosDigitalesInvalidos, heredarDigitalEnCopia, revisionDigitalEn } from './digital';
import { franquiciaEn, heredarFranquiciaEnCopia } from './franquicias';
import type { ClasificacionCampana, FranquiciaCampana, RevisionDigital } from './types';
import { rutaTexto } from './buscador';
import { RESPUESTA_TXT } from './respuesta';
import type { Id } from './types';

/**
 * «Partir de la campaña anterior» (B5) para uno o varios establecimientos. Reutiliza las
 * funciones de herencia de cada dato (clasificación, franquicia y presencia digital) y añade la
 * garantía común: solo se hereda cuando consta que es el MISMO negocio, no el mismo local ni un
 * nombre parecido.
 *
 *  - Lo heredado queda como borrador con origen y campaña; no cuenta como comprobado ni verificado.
 *  - No se sobrescribe nada ya registrado en la campaña; la campaña anterior no se modifica.
 *  - Los datos históricos inválidos o ambiguos se señalan y no se copian.
 *  - Es atómico: si algún registro está bloqueado o fuera del alcance, no se aplica nada.
 */

export type ParteHerencia = 'clasificacion' | 'franquicia' | 'digital';
export const PARTES_HERENCIA: ParteHerencia[] = ['clasificacion', 'franquicia', 'digital'];
const NOMBRE_PARTE: Record<ParteHerencia, string> = { clasificacion: 'clasificación', franquicia: 'franquicia', digital: 'presencia digital' };

/** Índices de una campaña para decidir y aplicar la herencia sin recorrer la base en cada registro. */
export interface IndicesHerencia {
  obs: IndiceObservaciones;
  ocu: IndiceOcupaciones;
  /** Locales con una conciliación pendiente (dudosa o probable) en la campaña. */
  conciliacion: Set<Id>;
  /** Último dato ANTERIOR de cada negocio (misma regla que `clasificacionAnterior`, etc.). */
  cla: Map<Id, ClasificacionCampana>;
  fr: Map<Id, FranquiciaCampana>;
  dig: Map<Id, RevisionDigital>;
}

export function indicesHerencia(db: BaseDatos, campanaId: Id): IndicesHerencia {
  const anio = anioDe(db, campanaId);
  const ultimo = <T extends { negocioId: Id; campanaId: Id }>(lista: T[]) => {
    const m = new Map<Id, T>();
    for (const x of lista) {
      if (x.campanaId === campanaId) continue;
      const a = anioDe(db, x.campanaId);
      const prev = m.get(x.negocioId);
      if (a < anio && (!prev || a > anioDe(db, prev.campanaId))) m.set(x.negocioId, x);
    }
    return m;
  };
  const conciliacion = new Set<Id>();
  for (const v of Object.values(db.vinculos)) {
    if (v.localId && v.origen.tipo === 'observacion' && (v.confianza === 'dudosa' || v.confianza === 'probable') && db.observaciones[v.origen.id]?.campanaId === campanaId) conciliacion.add(v.localId);
  }
  return {
    obs: indiceObservaciones(db), ocu: indiceOcupaciones(db), conciliacion,
    cla: ultimo(Object.values(db.clasificaciones)), fr: ultimo(Object.values(db.franquicias ?? {})), dig: ultimo(Object.values(db.digital)),
  };
}

/**
 * ¿Consta que el ocupante del local en esta campaña es el mismo negocio que tiene datos en una
 * campaña anterior? Devuelve el motivo por el que NO se puede heredar, o null.
 */
export function motivoNoHeredable(db: BaseDatos, campanaId: Id, localId: Id, ix: IndicesHerencia = indicesHerencia(db, campanaId)): string | null {
  const oc = ocupacionEn(db, localId, campanaId, ix.ocu);
  if (!oc?.negocioId) return 'Local vacío: no hay negocio al que copiar datos';
  const negocioId = oc.negocioId;
  const obsL = ix.obs.get(localId) ?? observacionesDeLocal(db, localId);
  const obs = observacionEn(obsL, campanaId);
  if (!obs) return 'Sin observación de campo en esta campaña: no consta que siga el mismo negocio';
  if (obs.tipo === 'nuevo-negocio' || obs.tipo === 'nuevo-local') {
    const ref = db.campanas[campanaId]?.campanaReferenciaId;
    const antes = ref ? ocupacionEn(db, localId, ref, ix.ocu) : undefined;
    const otro = antes?.negocioId && antes.negocioId !== negocioId ? db.negocios[antes.negocioId]?.nombre : undefined;
    return otro ? `Negocio nuevo: en ${anioDe(db, ref)} el local lo ocupaba otro negocio (${otro}); sus datos no se heredan` : 'Negocio nuevo en esta campaña: no hay datos anteriores suyos';
  }
  if (obs.tipo !== 'confirmado' && obs.tipo !== 'modificado') return 'Caso dudoso en campo: confirma antes que es el mismo negocio';
  if (obs.datos.negocioId !== negocioId) return 'La observación de campo no identifica a este negocio';
  if (obsL.some((o) => o.campanaId === campanaId && o.cronologia === 'incierta')) return 'Cronología incierta: asigna antes la fecha de los eventos';
  if (ix.conciliacion.has(localId)) return 'Conciliación pendiente: no consta que sea el mismo negocio';
  if (!ix.cla.has(negocioId) && !ix.fr.has(negocioId) && !ix.dig.has(negocioId)) return 'Sin datos de este negocio en campañas anteriores';
  return null;
}

export interface InformeHerencia {
  /** Registros con algo copiado, y qué partes. */
  aplicadas: { localId: Id; negocioId: Id; partes: ParteHerencia[] }[];
  /** Registros que no pueden heredar (no consta el mismo negocio, vacíos…). */
  excluidas: { localId: Id; motivo: string }[];
  /** Datos históricos inválidos o ambiguos que NO se han copiado. */
  senaladas: { localId: Id; detalle: string }[];
  /** Partes no copiadas porque ya hay datos en esta campaña (no se sobrescriben). */
  conservadas: { localId: Id; parte: ParteHerencia }[];
}

export function partirDe2025(
  db0: BaseDatos, campanaId: Id, localIds: Id[], porId: Id,
  opciones: { alcance?: Alcance; partes?: ParteHerencia[] } = {},
): { db: BaseDatos; informe: InformeHerencia } {
  return enLote(db0, () => heredar(db0, campanaId, localIds, porId, opciones));
}

function heredar(db0: BaseDatos, campanaId: Id, localIds: Id[], porId: Id, opciones: { alcance?: Alcance; partes?: ParteHerencia[] }): { db: BaseDatos; informe: InformeHerencia } {
  const partes = opciones.partes ?? PARTES_HERENCIA;
  // Atomicidad: bloqueo y alcance se comprueban para TODOS antes de modificar nada.
  comprobarAlcance(db0, opciones.alcance, localIds);
  for (const id of localIds) comprobarEditable(db0, campanaId, { localId: id });
  const informe: InformeHerencia = { aplicadas: [], excluidas: [], senaladas: [], conservadas: [] };
  const ix = indicesHerencia(db0, campanaId);
  const catalogo = catalogoDeCampana(db0, campanaId);
  const vistos = new Set<Id>();
  // Una sola copia de trabajo para todo el lote: si algo falla, se descarta entera.
  const w: BaseDatos = { ...db0, clasificaciones: { ...db0.clasificaciones }, franquicias: { ...db0.franquicias }, digital: { ...db0.digital }, revisiones: { ...db0.revisiones } };
  let cambio = false;
  const op = { alcance: opciones.alcance };
  for (const localId of localIds) {
    const motivo = motivoNoHeredable(db0, campanaId, localId, ix);
    if (motivo) {
      informe.excluidas.push({ localId, motivo });
      continue;
    }
    const negocioId = ocupacionEn(db0, localId, campanaId, ix.ocu)!.negocioId!;
    if (vistos.has(negocioId)) continue; // un negocio en varios locales se hereda una vez
    vistos.add(negocioId);
    const hechas: ParteHerencia[] = [];
    if (partes.includes('clasificacion')) {
      const ant = ix.cla.get(negocioId);
      if (ant && clasificacionEn(w, negocioId, campanaId)) informe.conservadas.push({ localId, parte: 'clasificacion' });
      else if (ant && !equivalenteEn(catalogo, ant.actividadId)) informe.senaladas.push({ localId, detalle: `Clasificación ${anioDe(db0, ant.campanaId)} «${rutaTexto(ant.actividadId)}» sin equivalente único en el catálogo de la campaña: clasificar a mano` });
      else if (ant && heredarClasificacionEnCopia(w, negocioId, campanaId, porId, op, ant)) hechas.push('clasificacion');
    }
    if (partes.includes('franquicia')) {
      const ant = ix.fr.get(negocioId);
      const actual = franquiciaEn(w, negocioId, campanaId);
      if (ant && actual && actual.respuesta !== 'pendiente') informe.conservadas.push({ localId, parte: 'franquicia' });
      else if (ant && ant.respuesta !== 'si' && ant.respuesta !== 'no') informe.senaladas.push({ localId, detalle: `Franquicia ${anioDe(db0, ant.campanaId)} = «${RESPUESTA_TXT[ant.respuesta]}»: no es un Sí/No, no se copia` });
      else if (ant && heredarFranquiciaEnCopia(w, negocioId, campanaId, porId, op, ant)) hechas.push('franquicia');
    }
    if (partes.includes('digital')) {
      const ant = ix.dig.get(negocioId);
      if (ant) {
        for (const x of datosDigitalesInvalidos(ant)) informe.senaladas.push({ localId, detalle: `Digital ${anioDe(db0, ant.campanaId)} no copiado · ${x.motivo}` });
        if (revisionDigitalEn(w, negocioId, campanaId)?.estado === 'verificada') informe.conservadas.push({ localId, parte: 'digital' });
        else if (heredarDigitalEnCopia(w, negocioId, campanaId, porId, op, ant)) hechas.push('digital');
        else if (revisionDigitalEn(w, negocioId, campanaId)) informe.conservadas.push({ localId, parte: 'digital' });
      }
    }
    if (hechas.length) {
      informe.aplicadas.push({ localId, negocioId, partes: hechas });
      cambio = true;
    }
  }
  return { db: cambio ? w : db0, informe };
}

/** Texto breve de lo que hará o ha hecho la herencia. */
export function resumenHerencia(i: InformeHerencia): string {
  const n = i.aplicadas.length;
  const porParte = PARTES_HERENCIA.map((p) => [p, i.aplicadas.filter((a) => a.partes.includes(p)).length] as const).filter(([, k]) => k);
  return `${n} registro(s) con datos para copiar como borrador${porParte.length ? ` (${porParte.map(([p, k]) => `${NOMBRE_PARTE[p]}: ${k}`).join(', ')})` : ''}`
    + `${i.excluidas.length ? ` · ${i.excluidas.length} excluido(s)` : ''}${i.senaladas.length ? ` · ${i.senaladas.length} dato(s) histórico(s) señalado(s)` : ''}`;
}
