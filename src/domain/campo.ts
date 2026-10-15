import type { BaseDatos } from './db';
import { kCob, kRev, nuevoId } from './db';
import { anioDe, direccionVigente, localesPrevios, ocupacionEn, revisionDe } from './consultas';
import { proponerCandidatos } from './conciliacion';
import type { Acera, Cobertura, EstadoCobertura, Id, LngLat, Observacion, TipoObservacion } from './types';

/**
 * Operaciones del trabajo de campo. Todas son funciones puras BaseDatos → BaseDatos,
 * lo que permite deshacer y, en el futuro, reproducirlas en un motor de sincronización.
 */

export interface Contexto {
  campanaId: Id;
  investigadorId: Id;
  /** Fecha real de la visita; omitida cuando no se conoce (p. ej. papel sin fecha). */
  fecha?: string;
  fuente?: Observacion['fuente'];
  sinConexion?: boolean;
}

function clonar(db: BaseDatos): BaseDatos {
  return { ...db };
}

function marcarRevisionCampo(db: BaseDatos, campanaId: Id, localId: Id, extra?: Partial<ReturnType<typeof revisionDe>>) {
  const r = revisionDe(db, campanaId, localId);
  db.revisiones = { ...db.revisiones, [kRev(campanaId, localId)]: { ...r, campo: 'terminado', ...extra } };
}

function anadirObs(db: BaseDatos, ctx: Contexto, o: Omit<Observacion, 'id' | 'campanaId' | 'fecha' | 'fuente' | 'investigadorId' | 'verificacion'>): Observacion {
  const obs: Observacion = {
    id: nuevoId('obs'),
    campanaId: ctx.campanaId,
    fecha: ctx.fecha,
    registrado: new Date().toISOString(),
    fuente: ctx.fuente ?? 'campo-app',
    investigadorId: ctx.investigadorId,
    verificacion: 'pendiente',
    sync: ctx.sinConexion ? 'local' : 'sincronizada',
    ...o,
  };
  db.observaciones = { ...db.observaciones, [obs.id]: obs };
  if (ctx.sinConexion) {
    db.colaSync = [...db.colaSync, { id: nuevoId('sync'), descripcion: descripcionObs(db, obs), observacionId: obs.id, creado: obs.registrado!, estado: 'en-cola' }];
  }
  ponerCalleEnCurso(db, ctx, o.calleId);
  return obs;
}

function descripcionObs(db: BaseDatos, o: Observacion) {
  const calle = db.calles[o.calleId]?.nombre ?? '';
  const quien = o.datos.vacio ? 'vacío' : o.datos.nombre ?? '';
  return `${TIPO_OBS_TXT[o.tipo]} · ${calle} ${o.datos.numero ?? 's/n'} · ${quien}`;
}

function ponerCalleEnCurso(db: BaseDatos, ctx: Contexto, calleId: Id) {
  const k = kCob(ctx.campanaId, calleId, 'ambas');
  const actual = db.coberturas[k];
  if (!actual || actual.estado === 'pendiente') {
    db.coberturas = { ...db.coberturas, [k]: { campanaId: ctx.campanaId, calleId, acera: 'ambas', estado: 'en-curso', porId: ctx.investigadorId, fecha: ctx.fecha } };
  }
}

export const TIPO_OBS_TXT: Record<TipoObservacion, string> = {
  confirmado: 'Sin cambios',
  modificado: 'Modificado',
  vacio: 'Vacío',
  'nuevo-negocio': 'Nuevo negocio',
  'nuevo-local': 'Local nuevo',
  'posible-desaparicion': 'Posible desaparición',
  dudoso: 'Dudoso',
  incidencia: 'Incidencia',
};

/** Confirmar sin cambios: no se pide nada que ya exista. */
export function confirmarSinCambios(db0: BaseDatos, ctx: Contexto, localId: Id): BaseDatos {
  const db = clonar(db0);
  const l = db.locales[localId];
  const camp = db.campanas[ctx.campanaId];
  const ref = camp.campanaReferenciaId ?? ctx.campanaId;
  const oc = ocupacionEn(db, localId, ref);
  const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
  const d = direccionVigente(l);
  anadirObs(db, ctx, {
    localId, calleId: d.calleId, tipo: 'confirmado',
    datos: { numero: d.numero, sufijo: d.sufijo, nombre: neg?.nombre, vacio: !neg, metrosFachada: oc?.metrosFachada },
  });
  marcarRevisionCampo(db, ctx.campanaId, localId);
  return db;
}

/** Corrección de datos del mismo negocio (nombre, metros, número…). */
export function modificarLocal(
  db0: BaseDatos, ctx: Contexto, localId: Id,
  cambios: { nombre?: string; metrosFachada?: number; numero?: number | null; sufijo?: string; nota?: string },
): BaseDatos {
  const db = clonar(db0);
  const l = db.locales[localId];
  const d = direccionVigente(l);
  const ref = db.campanas[ctx.campanaId].campanaReferenciaId ?? ctx.campanaId;
  const oc = ocupacionEn(db, localId, ref);
  if (cambios.nombre && oc?.negocioId) {
    db.negocios = { ...db.negocios, [oc.negocioId]: { ...db.negocios[oc.negocioId], nombre: cambios.nombre } };
  }
  if (cambios.metrosFachada !== undefined && oc) {
    db.ocupaciones = { ...db.ocupaciones, [oc.id]: { ...oc, metrosFachada: cambios.metrosFachada } };
  }
  if (cambios.numero !== undefined && (cambios.numero !== d.numero || (cambios.sufijo ?? '') !== (d.sufijo ?? ''))) {
    // Cambio de numeración: se conserva la dirección anterior.
    db.locales = { ...db.locales, [localId]: { ...l, direcciones: [...l.direcciones, { calleId: d.calleId, numero: cambios.numero, sufijo: cambios.sufijo, desdeCampanaId: ctx.campanaId }] } };
  }
  const nombre = cambios.nombre ?? (oc?.negocioId ? db.negocios[oc.negocioId]?.nombre : undefined);
  anadirObs(db, ctx, {
    localId, calleId: d.calleId, tipo: 'modificado', nota: cambios.nota,
    datos: { numero: cambios.numero ?? d.numero, sufijo: cambios.sufijo ?? d.sufijo, nombre, vacio: !oc?.negocioId, metrosFachada: cambios.metrosFachada ?? oc?.metrosFachada },
  });
  marcarRevisionCampo(db, ctx.campanaId, localId);
  return db;
}

/** Cierra la ocupación vigente al final de la campaña de referencia. */
function cerrarOcupacion(db: BaseDatos, ctx: Contexto, localId: Id) {
  const camp = db.campanas[ctx.campanaId];
  const ref = camp.campanaReferenciaId;
  const oc = ocupacionEn(db, localId, ctx.campanaId);
  if (!oc) return;
  if (oc.desdeCampanaId === ctx.campanaId) {
    // creada en esta misma campaña: se sustituye
    const { [oc.id]: _, ...resto } = db.ocupaciones;
    db.ocupaciones = resto;
  } else {
    db.ocupaciones = { ...db.ocupaciones, [oc.id]: { ...oc, hastaCampanaId: ref ?? oc.desdeCampanaId } };
  }
}

export function registrarVacio(db0: BaseDatos, ctx: Contexto, localId: Id, metrosFachada?: number, nota?: string): BaseDatos {
  const db = clonar(db0);
  cerrarOcupacion(db, ctx, localId);
  const id = nuevoId('ocu');
  db.ocupaciones = { ...db.ocupaciones, [id]: { id, localId, negocioId: null, metrosFachada, desdeCampanaId: ctx.campanaId } };
  const d = direccionVigente(db.locales[localId]);
  anadirObs(db, ctx, { localId, calleId: d.calleId, tipo: 'vacio', nota, datos: { numero: d.numero, sufijo: d.sufijo, vacio: true, metrosFachada } });
  marcarRevisionCampo(db, ctx.campanaId, localId);
  return db;
}

/** Nuevo negocio en un local existente. NO hereda perfiles digitales del anterior. */
export function registrarNuevoNegocio(db0: BaseDatos, ctx: Contexto, localId: Id, nombre: string, nota?: string): BaseDatos {
  const db = clonar(db0);
  cerrarOcupacion(db, ctx, localId);
  const negId = nuevoId('neg');
  db.negocios = { ...db.negocios, [negId]: { id: negId, nombre, procedencia: 'manual' } };
  const id = nuevoId('ocu');
  db.ocupaciones = { ...db.ocupaciones, [id]: { id, localId, negocioId: negId, desdeCampanaId: ctx.campanaId } };
  const d = direccionVigente(db.locales[localId]);
  anadirObs(db, ctx, { localId, calleId: d.calleId, tipo: 'nuevo-negocio', nota, datos: { numero: d.numero, sufijo: d.sufijo, nombre, vacio: false } });
  marcarRevisionCampo(db, ctx.campanaId, localId, { categorizacion: 'pendiente', digital: 'pendiente' });
  return db;
}

/** Posible desaparición física: NO es un cierre; queda para revisión humana. */
export function marcarPosibleDesaparicion(db0: BaseDatos, ctx: Contexto, localId: Id, nota?: string): BaseDatos {
  const db = clonar(db0);
  const l = db.locales[localId];
  db.locales = { ...db.locales, [localId]: { ...l, estado: 'posible-desaparicion' } };
  const d = direccionVigente(l);
  anadirObs(db, ctx, { localId, calleId: d.calleId, tipo: 'posible-desaparicion', nota, datos: { numero: d.numero, sufijo: d.sufijo, vacio: true } });
  marcarRevisionCampo(db, ctx.campanaId, localId, { pendienteComprobacion: true });
  return db;
}

export function marcarDudoso(db0: BaseDatos, ctx: Contexto, localId: Id, nota: string, tipo: 'dudoso' | 'incidencia' = 'dudoso'): BaseDatos {
  const db = clonar(db0);
  const l = db.locales[localId];
  const d = direccionVigente(l);
  const ref = db.campanas[ctx.campanaId].campanaReferenciaId ?? ctx.campanaId;
  const oc = ocupacionEn(db, localId, ref);
  anadirObs(db, ctx, {
    localId, calleId: d.calleId, tipo, nota,
    datos: { numero: d.numero, sufijo: d.sufijo, nombre: oc?.negocioId ? db.negocios[oc.negocioId]?.nombre : undefined, vacio: !oc?.negocioId },
  });
  marcarRevisionCampo(db, ctx.campanaId, localId, { pendienteComprobacion: true });
  return db;
}

export interface NuevoLocal {
  calleId: Id;
  numero: number | null;
  sufijo?: string;
  vacio: boolean;
  nombre?: string;
  metrosFachada?: number;
  nota?: string;
  coord?: LngLat;
}

/**
 * Alta de un local no presente en el listado anterior. Si hay locales previos
 * compatibles, se proponen como candidatos de conciliación (sin aplicarlos).
 */
export function registrarLocalNuevo(db0: BaseDatos, ctx: Contexto, n: NuevoLocal): { db: BaseDatos; localId: Id; candidatos: number } {
  const db = clonar(db0);
  const camp = db.campanas[ctx.campanaId];
  const localId = nuevoId('loc');
  db.locales = {
    ...db.locales,
    [localId]: { id: localId, municipioId: camp.municipioId, direcciones: [{ calleId: n.calleId, numero: n.numero, sufijo: n.sufijo, desdeCampanaId: ctx.campanaId }], coord: n.coord, estado: 'activo', procedencia: 'manual' },
  };
  let negocioId: Id | null = null;
  if (!n.vacio && n.nombre) {
    negocioId = nuevoId('neg');
    db.negocios = { ...db.negocios, [negocioId]: { id: negocioId, nombre: n.nombre, procedencia: 'manual' } };
  }
  const ocId = nuevoId('ocu');
  db.ocupaciones = { ...db.ocupaciones, [ocId]: { id: ocId, localId, negocioId, metrosFachada: n.metrosFachada, desdeCampanaId: ctx.campanaId } };
  const obs = anadirObs(db, ctx, {
    localId, calleId: n.calleId, tipo: 'nuevo-local', nota: n.nota,
    datos: { numero: n.numero, sufijo: n.sufijo, nombre: n.nombre, vacio: n.vacio, metrosFachada: n.metrosFachada },
  });
  marcarRevisionCampo(db, ctx.campanaId, localId);
  // Candidatos: locales anteriores de la calle aún no observados en esta campaña.
  const previos = localesPrevios(db, camp.campanaReferenciaId, n.calleId).filter(
    (l) => l.id !== localId && !Object.values(db.observaciones).some((o) => o.localId === l.id && o.campanaId === ctx.campanaId),
  );
  const candidatos = proponerCandidatos(db, { numero: n.numero, nombre: n.nombre, vacio: n.vacio }, previos, camp.campanaReferenciaId);
  if (candidatos.length) {
    const vid = nuevoId('vin');
    db.vinculos = {
      ...db.vinculos,
      [vid]: { id: vid, origen: { tipo: 'observacion', id: obs.id }, localId, confianza: 'dudosa', criterio: 'Alta en campo con locales anteriores compatibles: requiere revisión', candidatos },
    };
  }
  return { db, localId, candidatos: candidatos.length };
}

/** Sugerencia del siguiente número: misma acera (paridad), siguiente al último registrado. */
export function siguienteNumero(ultimo: number | null | undefined, paso: 1 | 2 = 2): number | null {
  if (ultimo === null || ultimo === undefined) return null;
  return ultimo + paso;
}

export type ResultadoCalle = Extract<EstadoCobertura, 'completada-con-locales' | 'completada-sin-locales' | 'parcial-incidencias'>;

/**
 * Finalizar calle. Exige declarar las aceras recorridas; nunca se deduce del nº de locales.
 * "Sin locales" solo es válido si no queda ningún local activo registrado en la calle.
 */
export function finalizarCalle(
  db0: BaseDatos, ctx: Contexto, calleId: Id,
  opciones: { acera?: Acera; par: boolean; impar: boolean; resultado: ResultadoCalle; nota?: string },
): BaseDatos {
  const validacion = validarFinalizacion(db0, ctx.campanaId, calleId, opciones);
  if (!validacion.ok) throw new Error(validacion.motivo);
  const db = clonar(db0);
  const acera = opciones.acera ?? 'ambas';
  const cob: Cobertura = {
    campanaId: ctx.campanaId, calleId, acera, estado: opciones.resultado, porId: ctx.investigadorId, fecha: ctx.fecha,
    aceraParRecorrida: opciones.par, aceraImparRecorrida: opciones.impar, nota: opciones.nota,
  };
  db.coberturas = { ...db.coberturas, [kCob(ctx.campanaId, calleId, acera)]: cob };
  return db;
}

export function validarFinalizacion(
  db: BaseDatos, campanaId: Id, calleId: Id, o: { acera?: Acera; par: boolean; impar: boolean; resultado: ResultadoCalle },
): { ok: true } | { ok: false; motivo: string } {
  const acera = o.acera ?? 'ambas';
  const necesitaPar = acera !== 'impar';
  const necesitaImpar = acera !== 'par';
  if (o.resultado !== 'parcial-incidencias' && ((necesitaPar && !o.par) || (necesitaImpar && !o.impar))) {
    return { ok: false, motivo: 'Para completar la calle hay que confirmar el recorrido de las aceras asignadas. Si no fue posible, márcala como parcial.' };
  }
  const resumen = resumenCalle(db, campanaId, calleId);
  if (o.resultado === 'completada-sin-locales' && resumen.activosEstaCampana > 0) {
    return { ok: false, motivo: `Hay ${resumen.activosEstaCampana} locales registrados en esta campaña: no puede cerrarse como “sin locales”.` };
  }
  if (o.resultado !== 'parcial-incidencias' && resumen.previosSinRevisar > 0) {
    return { ok: false, motivo: `Quedan ${resumen.previosSinRevisar} locales anteriores sin revisar. Revísalos o marca la calle como parcial.` };
  }
  return { ok: true };
}

export function resumenCalle(db: BaseDatos, campanaId: Id, calleId: Id) {
  const camp = db.campanas[campanaId];
  const previos = localesPrevios(db, camp.campanaReferenciaId, calleId);
  const obsCampana = Object.values(db.observaciones).filter((o) => o.campanaId === campanaId && o.calleId === calleId);
  const revisados = new Set(obsCampana.map((o) => o.localId));
  const previosSinRevisar = previos.filter((l) => !revisados.has(l.id)).length;
  const locIds = new Set(obsCampana.filter((o) => o.localId && o.tipo !== 'posible-desaparicion').map((o) => o.localId!));
  return { previos: previos.length, previosSinRevisar, activosEstaCampana: locIds.size, observaciones: obsCampana.length, nuevos: obsCampana.filter((o) => o.tipo === 'nuevo-local').length };
}

export function anioCampana(db: BaseDatos, id: Id) {
  return anioDe(db, id);
}
