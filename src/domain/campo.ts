import type { BaseDatos } from './db';
import { ErrorDominio, kCob, kRev, nuevoId, siguienteOrden } from './db';
import { comprobarAlcance, comprobarAlcanceObjetivo, comprobarEditable, estaBloqueado, itinerariosDeLocal, type Alcance } from './bloqueo';
import { abarca, anioDe, compararFechas, direccionVigente, localesPrevios, ocupacionesDeLocal, revisionDe } from './consultas';
import { proponerCandidatos } from './conciliacion';
import type { Acera, Cobertura, EstadoCobertura, Id, LngLat, Observacion, Ocupacion, TipoObservacion } from './types';

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
  /** Itinerario desde el que se trabaja: la operación no puede salir de él. */
  alcance?: Alcance;
}

/** Comprueba alcance y bloqueo ANTES de modificar nada (sin cambios parciales). */
function comprobarLocal(db: BaseDatos, ctx: Contexto, localId: Id) {
  comprobarAlcance(db, ctx.alcance, [localId]);
  comprobarEditable(db, ctx.campanaId, { localId });
}

// ───────────── Cronología dentro de la campaña ─────────────

export const MOTIVO_CRONOLOGIA = 'Cronología incierta: asigna la fecha real del evento';

interface Ubicacion {
  incierta: boolean;
  /** Ocupación vigente justo antes del momento indicado. */
  previa?: Ocupacion;
  /** Primera ocupación de la campaña posterior al momento (si el evento se introduce tarde). */
  siguiente?: Ocupacion;
}

/**
 * Sitúa un momento (fecha real) entre las ocupaciones del local en la campaña. La cronología
 * la decide la fecha del evento, no el orden de introducción: un Excel en papel importado
 * después puede describir visitas anteriores a las de la aplicación. Si no hay fecha o no
 * permite decidir (mismo día sin hora) frente a algún cambio de la campaña, es «incierta».
 */
/**
 * ¿Interviene la ocupación en la campaña? Abarca la campaña o la cerró un evento de ella (un
 * negocio no visto antes en la campaña se cierra en la anterior, pero una visita en papel con
 * fecha previa puede demostrar que seguía allí).
 */
function enLineaTemporal(db: BaseDatos, o: Ocupacion, campanaId: Id): boolean {
  return abarca(db, o, campanaId) || (!!o.hastaObservacionId && db.observaciones[o.hastaObservacionId]?.campanaId === campanaId);
}

/** Una visita de la campaña demuestra que la ocupación seguía vigente en ella. */
function marcarVista(db: BaseDatos, oc: Ocupacion | undefined, campanaId: Id) {
  if (oc?.hastaCampanaId && anioDe(db, oc.hastaCampanaId) < anioDe(db, campanaId)) {
    db.ocupaciones = { ...db.ocupaciones, [oc.id]: { ...oc, hastaCampanaId: campanaId } };
  }
}

function ubicar(db: BaseDatos, localId: Id, campanaId: Id, fecha?: string): Ubicacion {
  const anio = anioDe(db, campanaId);
  const todas = ocupacionesDeLocal(db, localId);
  const origen = todas[0]; // el alta del local precede siempre a sus cambios
  let previa: Ocupacion | undefined;
  let siguiente: Ocupacion | undefined;
  for (const o of todas) {
    if (!enLineaTemporal(db, o, campanaId)) continue;
    if (anioDe(db, o.desdeCampanaId) < anio || o.id === origen.id) {
      if (!siguiente) previa = o;
      continue;
    }
    const c = compararFechas(fecha, o.desdeFecha);
    if (c === null) return { incierta: true };
    if (c < 0) siguiente ??= o;
    else if (!siguiente) previa = o;
  }
  return { incierta: false, previa, siguiente };
}

/** Ocupación en un momento de la campaña. Si es incierto, la del inicio de la campaña. */
export function ocupacionAlMomento(db: BaseDatos, localId: Id, campanaId: Id, fecha?: string): { oc?: Ocupacion; incierta: boolean } {
  const u = ubicar(db, localId, campanaId, fecha);
  if (!u.incierta) return { oc: u.previa, incierta: false };
  const anio = anioDe(db, campanaId);
  const todas = ocupacionesDeLocal(db, localId);
  const inicio = todas.filter((o) => enLineaTemporal(db, o, campanaId) && (anioDe(db, o.desdeCampanaId) < anio || o.id === todas[0].id)).pop();
  return { oc: inicio, incierta: true };
}

/**
 * Aplica un cambio de ocupación (vacío o nuevo negocio) en su lugar cronológico. NUNCA borra:
 * cierra la ocupación previa con la observación que la sustituye y, si el evento llega tarde
 * (hay un cambio posterior ya registrado), la nueva ocupación se cierra con ese cambio.
 * Devuelve false si la cronología es incierta (no se modifica ninguna ocupación).
 */
function cambiarOcupacion(db: BaseDatos, ctx: Contexto, localId: Id, observacionId: Id, negocioId: Id | null, metrosFachada?: number): boolean {
  const u = ubicar(db, localId, ctx.campanaId, ctx.fecha);
  if (u.incierta) return false;
  const camp = db.campanas[ctx.campanaId];
  if (u.previa) {
    const p = u.previa;
    const vista =
      p.desdeCampanaId === ctx.campanaId ||
      Object.values(db.observaciones).some((o) => o.localId === localId && o.campanaId === ctx.campanaId && o.datos.negocioId === p.negocioId && o.tipo !== 'posible-desaparicion' && !o.cronologia);
    db.ocupaciones = { ...db.ocupaciones, [p.id]: { ...p, hastaCampanaId: vista ? ctx.campanaId : camp.campanaReferenciaId ?? p.desdeCampanaId, hastaObservacionId: observacionId } };
  }
  const id = nuevoId('ocu');
  const nueva: Ocupacion = { id, localId, negocioId, metrosFachada, desdeCampanaId: ctx.campanaId, desdeObservacionId: observacionId, desdeFecha: ctx.fecha, orden: siguienteOrden(db) };
  if (u.siguiente) Object.assign(nueva, { hastaCampanaId: ctx.campanaId, hastaObservacionId: u.siguiente.desdeObservacionId });
  db.ocupaciones = { ...db.ocupaciones, [id]: nueva };
  return true;
}

function clonar(db: BaseDatos): BaseDatos {
  return { ...db };
}

function marcarRevisionCampo(db: BaseDatos, campanaId: Id, localId: Id, extra?: Partial<ReturnType<typeof revisionDe>>, incierta = false) {
  const r = revisionDe(db, campanaId, localId);
  const crono = incierta ? { pendienteComprobacion: true, motivoComprobacion: MOTIVO_CRONOLOGIA } : {};
  db.revisiones = { ...db.revisiones, [kRev(campanaId, localId)]: { ...r, campo: 'terminado', ...extra, ...crono } };
}

function anadirObs(db: BaseDatos, ctx: Contexto, o: Omit<Observacion, 'id' | 'campanaId' | 'fecha' | 'fuente' | 'investigadorId' | 'verificacion' | 'orden'>, id = nuevoId('obs')): Observacion {
  const obs: Observacion = {
    id,
    orden: siguienteOrden(db),
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
  comprobarLocal(db0, ctx, localId);
  const db = clonar(db0);
  const l = db.locales[localId];
  // Situación en la FECHA de la visita (puede haber cambios posteriores ya registrados).
  const { oc, incierta } = ocupacionAlMomento(db, localId, ctx.campanaId, ctx.fecha);
  const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
  if (!incierta) marcarVista(db, oc, ctx.campanaId);
  const d = direccionVigente(l);
  anadirObs(db, ctx, {
    localId, calleId: d.calleId, tipo: 'confirmado', ...(incierta ? { cronologia: 'incierta' as const } : {}),
    datos: { numero: d.numero, sufijo: d.sufijo, nombre: neg?.nombre, negocioId: neg?.id ?? null, vacio: !neg, metrosFachada: oc?.metrosFachada },
  });
  marcarRevisionCampo(db, ctx.campanaId, localId, undefined, incierta);
  return db;
}

/** Corrección de datos del mismo negocio (nombre, metros, número…). */
export function modificarLocal(
  db0: BaseDatos, ctx: Contexto, localId: Id,
  cambios: { nombre?: string; metrosFachada?: number; numero?: number | null; sufijo?: string; nota?: string },
): BaseDatos {
  comprobarLocal(db0, ctx, localId);
  const db = clonar(db0);
  const l = db.locales[localId];
  const d = direccionVigente(l);
  const { oc, incierta } = ocupacionAlMomento(db, localId, ctx.campanaId, ctx.fecha);
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
    localId, calleId: d.calleId, tipo: 'modificado', nota: cambios.nota, ...(incierta ? { cronologia: 'incierta' as const } : {}),
    datos: { numero: cambios.numero ?? d.numero, sufijo: cambios.sufijo ?? d.sufijo, nombre, negocioId: oc?.negocioId ?? null, vacio: !oc?.negocioId, metrosFachada: cambios.metrosFachada ?? oc?.metrosFachada },
  });
  marcarRevisionCampo(db, ctx.campanaId, localId, undefined, incierta);
  return db;
}

export function registrarVacio(db0: BaseDatos, ctx: Contexto, localId: Id, metrosFachada?: number, nota?: string): BaseDatos {
  comprobarLocal(db0, ctx, localId);
  const db = clonar(db0);
  const obsId = nuevoId('obs');
  const aplicado = cambiarOcupacion(db, ctx, localId, obsId, null, metrosFachada);
  const d = direccionVigente(db.locales[localId]);
  anadirObs(db, ctx, { localId, calleId: d.calleId, tipo: 'vacio', nota, ...(aplicado ? {} : { cronologia: 'incierta' as const }), datos: { numero: d.numero, sufijo: d.sufijo, negocioId: null, vacio: true, metrosFachada } }, obsId);
  marcarRevisionCampo(db, ctx.campanaId, localId, undefined, !aplicado);
  return db;
}

/** Nuevo negocio en un local existente. NO hereda perfiles digitales del anterior. */
export function registrarNuevoNegocio(db0: BaseDatos, ctx: Contexto, localId: Id, nombre: string, nota?: string): BaseDatos {
  comprobarLocal(db0, ctx, localId);
  const db = clonar(db0);
  const obsId = nuevoId('obs');
  const negId = nuevoId('neg');
  db.negocios = { ...db.negocios, [negId]: { id: negId, nombre, procedencia: 'manual' } };
  const aplicado = cambiarOcupacion(db, ctx, localId, obsId, negId);
  const d = direccionVigente(db.locales[localId]);
  anadirObs(db, ctx, { localId, calleId: d.calleId, tipo: 'nuevo-negocio', nota, ...(aplicado ? {} : { cronologia: 'incierta' as const }), datos: { numero: d.numero, sufijo: d.sufijo, nombre, negocioId: negId, vacio: false } }, obsId);
  // Solo si pasa a ser el ocupante vigente cambian los estados de revisión del registro.
  const vigente = aplicado && ocupacionAlMomento(db, localId, ctx.campanaId).oc?.negocioId === negId;
  marcarRevisionCampo(db, ctx.campanaId, localId, vigente ? { categorizacion: 'pendiente', digital: 'pendiente', franquicia: 'pendiente', franquiciaPor: undefined, franquiciaEn: undefined } : undefined, !aplicado);
  return db;
}

/** Posible desaparición física: NO es un cierre; queda para revisión humana. */
export function marcarPosibleDesaparicion(db0: BaseDatos, ctx: Contexto, localId: Id, nota?: string): BaseDatos {
  comprobarLocal(db0, ctx, localId);
  const db = clonar(db0);
  const l = db.locales[localId];
  db.locales = { ...db.locales, [localId]: { ...l, estado: 'posible-desaparicion' } };
  const d = direccionVigente(l);
  // La ocupación NO se cierra: una posible desaparición no es un cierre.
  anadirObs(db, ctx, { localId, calleId: d.calleId, tipo: 'posible-desaparicion', nota, datos: { numero: d.numero, sufijo: d.sufijo, vacio: true } });
  marcarRevisionCampo(db, ctx.campanaId, localId, { pendienteComprobacion: true });
  return db;
}

export function marcarDudoso(db0: BaseDatos, ctx: Contexto, localId: Id, nota: string, tipo: 'dudoso' | 'incidencia' = 'dudoso'): BaseDatos {
  comprobarLocal(db0, ctx, localId);
  const db = clonar(db0);
  const l = db.locales[localId];
  const d = direccionVigente(l);
  const { oc } = ocupacionAlMomento(db, localId, ctx.campanaId, ctx.fecha);
  anadirObs(db, ctx, {
    localId, calleId: d.calleId, tipo, nota,
    datos: { numero: d.numero, sufijo: d.sufijo, nombre: oc?.negocioId ? db.negocios[oc.negocioId]?.nombre : undefined, negocioId: oc?.negocioId ?? null, vacio: !oc?.negocioId },
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
  // Alcance y bloqueo por DIRECCIÓN (calle y acera según el número), no por calle completa.
  comprobarAlcanceObjetivo(db0, ctx.alcance, { calleId: n.calleId, numero: n.numero, coord: n.coord });
  comprobarEditable(db0, ctx.campanaId, { calleId: n.calleId, numero: n.numero, coord: n.coord });
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
  const obs = anadirObs(db, ctx, {
    localId, calleId: n.calleId, tipo: 'nuevo-local', nota: n.nota,
    datos: { numero: n.numero, sufijo: n.sufijo, nombre: n.nombre, negocioId, vacio: n.vacio, metrosFachada: n.metrosFachada },
  });
  const ocId = nuevoId('ocu');
  db.ocupaciones = { ...db.ocupaciones, [ocId]: { id: ocId, localId, negocioId, metrosFachada: n.metrosFachada, desdeCampanaId: ctx.campanaId, desdeObservacionId: obs.id, desdeFecha: ctx.fecha, orden: siguienteOrden(db) } };
  marcarRevisionCampo(db, ctx.campanaId, localId);
  // Candidatos: locales anteriores de la calle aún no observados en esta campaña, dentro del
  // itinerario de trabajo (si lo hay) y nunca de itinerarios cerrados o validados.
  const its = (id: Id) => itinerariosDeLocal(db, ctx.campanaId, id);
  const previos = localesPrevios(db, camp.campanaReferenciaId, n.calleId).filter(
    (l) =>
      l.id !== localId &&
      !Object.values(db.observaciones).some((o) => o.localId === l.id && o.campanaId === ctx.campanaId) &&
      (!ctx.alcance || its(l.id).some((it) => it.id === ctx.alcance!.itinerarioId)) &&
      !its(l.id).some((it) => estaBloqueado(db, it.id)),
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
  comprobarAlcanceObjetivo(db0, ctx.alcance, { calleId, acera: opciones.acera });
  comprobarEditable(db0, ctx.campanaId, { calleId, acera: opciones.acera });
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

/**
 * La oficina asigna la fecha real a un evento de cronología incierta (p. ej. una fila en
 * papel sin fecha) y el evento se coloca en su lugar: puede quedar como histórico intermedio
 * sin cambiar el ocupante vigente. Queda registrado quién y cuándo fijó la fecha.
 */
export function ubicarEnCronologia(db0: BaseDatos, observacionId: Id, fecha: string, porId: Id, alcance?: Alcance): BaseDatos {
  const o = db0.observaciones[observacionId];
  if (!o || o.cronologia !== 'incierta' || !o.localId) throw new ErrorDominio('regla', 'La observación no tiene cronología pendiente.');
  const localId = o.localId;
  const ctx: Contexto = { campanaId: o.campanaId, investigadorId: porId, fecha, alcance };
  comprobarLocal(db0, ctx, localId);
  const db = clonar(db0);
  let datos = o.datos;
  if (o.tipo === 'vacio' || o.tipo === 'nuevo-negocio') {
    if (!cambiarOcupacion(db, ctx, localId, o.id, o.datos.negocioId ?? null, o.datos.metrosFachada)) {
      throw new ErrorDominio('regla', 'Con esa fecha el evento sigue sin poder ordenarse: indica también la hora.');
    }
  } else {
    const m = ocupacionAlMomento(db0, localId, o.campanaId, fecha);
    if (m.incierta) throw new ErrorDominio('regla', 'Con esa fecha el evento sigue sin poder ordenarse: indica también la hora.');
    marcarVista(db, m.oc, o.campanaId);
    if (o.tipo === 'confirmado') {
      const neg = m.oc?.negocioId ? db.negocios[m.oc.negocioId] : undefined;
      datos = { ...o.datos, negocioId: neg?.id ?? null, nombre: neg?.nombre, vacio: !neg, metrosFachada: m.oc?.metrosFachada };
    }
  }
  db.observaciones = { ...db.observaciones, [o.id]: { ...o, fecha, datos, cronologia: undefined, fechaAsignada: { porId, registrado: new Date().toISOString() } } };
  const quedan = Object.values(db.observaciones).some((x) => x.localId === localId && x.campanaId === o.campanaId && x.cronologia === 'incierta');
  const r = revisionDe(db, o.campanaId, localId);
  if (!quedan && r.motivoComprobacion === MOTIVO_CRONOLOGIA) {
    db.revisiones = { ...db.revisiones, [kRev(o.campanaId, localId)]: { ...r, pendienteComprobacion: false, motivoComprobacion: undefined } };
  }
  return db;
}
