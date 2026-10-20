import type { BaseDatos } from './db';
import { kNC, kRev } from './db';
import {
  anioDe, direccionVigente, itinerariosDe, observacionEn, ocupacionEn, revisionDe, type IndiceObservaciones, type IndiceOcupaciones,
} from './consultas';
import { comprobarAlcance, comprobarEditable, estadoOficina, estaBloqueado, prepararOperacionNegocio, type Alcance } from './bloqueo';
import { indicePertenencia } from './ambito';
import { clasificar } from './clasificacion';
import { problemasDigitales, type EstadoDigital } from './digital';
import { estadoTramo, progresoItinerario } from './planificacion';
import type { ClasificacionCampana, Confianza, EstadoOficinaItinerario, Id, Itinerario, LocalFisico, Negocio, Observacion, Revision } from './types';
import { rutaActividad, TAXONOMIA_POR_ID } from './taxonomy';
import { normalizar } from './text';

export interface FilaOficina {
  localId: Id;
  calleId: Id;
  calle: string;
  numero: number | null;
  sufijo?: string;
  negocioId: Id | null;
  nombre: string;
  vacio: boolean;
  metros?: number;
  actividadId?: Id;
  actividad?: string;
  grupo?: string;
  /** Descripción breve de la clasificación de ESTA campaña. */
  descripcion?: string;
  /** Origen de la clasificación de ESTA campaña (o ausente si no hay). */
  clasificacion?: Pick<ClasificacionCampana, 'origen' | 'confirmada'>;
  cadena?: string;
  obs?: Observacion;
  rev: Revision;
  digital: EstadoDigital | 'no-aplica';
  vinculo?: Confianza;
  /**
   * registrado: observado (o con revisión) en la campaña.
   * pendiente-visita: local de la campaña de referencia aún no observado. Se muestra con los
   * datos de referencia para que no desaparezca del seguimiento.
   */
  situacion: 'registrado' | 'pendiente-visita';
  /** Itinerarios cuyo ámbito efectivo (calle, acera y segmento) incluye el local. */
  itinerarioIds: Id[];
  /** Códigos de esos itinerarios, para mostrar. */
  itinerario?: string;
  /** Algún itinerario del local tiene la revisión cerrada o está validado. */
  bloqueado: boolean;
  errores: string[];
  /** Incidencias y contradicciones que requieren decisión de oficina. */
  incidencias: string[];
  /** Observaciones de la campaña con cronología incierta (requieren fecha). */
  cronologiaIncierta: Id[];
  duplicado: boolean;
  nuevoNegocio: boolean;
}

export interface OpcionesFilas {
  /** Solo los registros cuyo ámbito efectivo pertenece a este itinerario. */
  itinerarioId?: Id;
}

/**
 * Registros de Oficina para una campaña: los observados (o con revisión) en ella y los locales
 * de la campaña de referencia que todavía no se han visitado. La pertenencia a itinerarios se
 * calcula con el ámbito efectivo del local (calle, acera según el número y segmento).
 */
export function filasOficina(db: BaseDatos, campanaId: Id, ix: { obs: IndiceObservaciones; ocu: IndiceOcupaciones }, opciones: OpcionesFilas = {}): FilaOficina[] {
  const camp = db.campanas[campanaId];
  if (!camp) return [];
  const ref = camp.campanaReferenciaId;
  const ambito = new Set(camp.ambitoCalleIds);
  const its = Object.values(db.itinerarios).filter((it) => it.campanaId === campanaId);
  for (const it of its) for (const t of it.tramos) ambito.add(t.calleId);
  const codigo = new Map(its.map((it) => [it.id, it.codigo]));
  const bloqueados = new Set(its.filter((it) => estaBloqueado(db, it.id)).map((it) => it.id));
  const vincPorLocal = new Map<Id, Confianza>();
  for (const v of Object.values(db.vinculos)) {
    if (v.origen.tipo !== 'observacion' || !v.localId) continue;
    const o = db.observaciones[v.origen.id];
    if (o?.campanaId === campanaId) vincPorLocal.set(v.localId, v.confianza);
  }
  const anio = anioDe(db, campanaId);
  const conDigitalPrevio = new Set<Id>();
  for (const r of Object.values(db.digital)) if (anioDe(db, r.campanaId) < anio) conDigitalPrevio.add(r.negocioId);

  // Universo: registrados en la campaña + referencia pendiente de visita (dentro del ámbito).
  const candidatos: { l: LocalFisico; obsL?: Observacion[]; obs?: Observacion; situacion: FilaOficina['situacion'] }[] = [];
  for (const l of Object.values(db.locales)) {
    if (l.municipioId !== camp.municipioId) continue;
    const obsL = ix.obs.get(l.id);
    const obs = observacionEn(obsL, campanaId);
    const tieneRev = !!db.revisiones[kRev(campanaId, l.id)];
    if (obs || tieneRev) candidatos.push({ l, obsL, obs, situacion: 'registrado' });
    else if (ref && ambito.has(direccionVigente(l).calleId) && observacionEn(obsL, ref)) candidatos.push({ l, obsL, situacion: 'pendiente-visita' });
  }
  const pertenencia = indicePertenencia(db, campanaId, candidatos.map((c) => c.l));

  const filas: FilaOficina[] = [];
  for (const { l, obsL, obs, situacion } of candidatos) {
    const itinerarioIds = pertenencia.get(l.id) ?? [];
    if (opciones.itinerarioId && !itinerarioIds.includes(opciones.itinerarioId)) continue;
    const d = direccionVigente(l);
    const oc = ocupacionEn(db, l.id, campanaId, ix.ocu);
    const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
    const cla = neg ? db.clasificaciones[kNC(neg.id, campanaId)] : undefined;
    const ruta = rutaActividad(cla?.actividadId);
    const rev = revisionDe(db, campanaId, l.id);
    const dig = neg ? db.digital[kNC(neg.id, campanaId)] : undefined;
    const estadoDig: EstadoDigital = dig ? dig.estado : neg && conDigitalPrevio.has(neg.id) ? 'solo-historico' : 'sin-datos';
    const errores: string[] = [];
    const incidencias: string[] = [];
    if (situacion === 'registrado') {
      if (!neg && !oc?.metrosFachada) errores.push('Vacío sin metros de fachada');
      if (neg && !neg.nombre.trim()) errores.push('Sin nombre');
    }
    if (d.numero === null) errores.push('Sin número');
    const cronologiaIncierta = (obsL ?? []).filter((o) => o.campanaId === campanaId && o.cronologia === 'incierta').map((o) => o.id);
    if (cronologiaIncierta.length) incidencias.push('Cronología incierta');
    if (rev.pendienteComprobacion && !cronologiaIncierta.length) incidencias.push(rev.motivoComprobacion ?? 'Pendiente de comprobación');
    const vinculo = vincPorLocal.get(l.id);
    if (vinculo === 'dudosa' || vinculo === 'probable') incidencias.push('Conciliación pendiente');
    if (obs?.tipo === 'dudoso') incidencias.push('Marcado como dudoso en campo');
    if (obs?.tipo === 'posible-desaparicion') incidencias.push('Posible desaparición');
    if (dig) for (const p of problemasDigitales(dig)) if (p.tipo === 'contradiccion') incidencias.push(`Contradicción digital: ${p.mensaje}`);
    if (itinerarioIds.length > 1) incidencias.push('Pertenece a varios itinerarios');
    if (cla && (TAXONOMIA_POR_ID[cla.actividadId]?.catalogo ?? 'demo') !== (camp.catalogoId ?? 'demo')) incidencias.push('Clasificación de otro catálogo: revisar');
    if (cla?.origen === 'migrado' && !cla.confirmada) incidencias.push('Clasificación migrada: confirmar');
    filas.push({
      localId: l.id, calleId: d.calleId, calle: db.calles[d.calleId]?.nombre ?? '¿?', numero: d.numero, sufijo: d.sufijo,
      negocioId: neg?.id ?? null, nombre: neg?.nombre ?? 'Vacío', vacio: !neg, metros: oc?.metrosFachada,
      actividadId: cla?.actividadId, actividad: ruta.at(-1)?.nombre, grupo: ruta[0]?.nombre, descripcion: cla?.descripcion, cadena: neg?.cadena,
      clasificacion: cla ? { origen: cla.origen, confirmada: cla.confirmada } : undefined,
      obs, rev, digital: !neg ? 'no-aplica' : estadoDig,
      vinculo, situacion, itinerarioIds,
      itinerario: itinerarioIds.map((i) => codigo.get(i)).join(' · ') || undefined,
      bloqueado: itinerarioIds.some((i) => bloqueados.has(i)),
      errores, incidencias, cronologiaIncierta, duplicado: false,
      nuevoNegocio: !!(obs && (obs.tipo === 'nuevo-negocio' || obs.tipo === 'nuevo-local')),
    });
  }
  // Posibles duplicados: misma dirección y nombre parecido dentro de la campaña
  const grupos = new Map<string, FilaOficina[]>();
  for (const f of filas) {
    if (f.situacion !== 'registrado') continue;
    const k = `${f.calleId}|${f.numero}|${f.sufijo ?? ''}`;
    grupos.set(k, [...(grupos.get(k) ?? []), f]);
  }
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    for (const f of g) {
      if (g.some((x) => x !== f && (x.vacio === f.vacio || normalizar(x.nombre).slice(0, 5) === normalizar(f.nombre).slice(0, 5)))) {
        f.duplicado = true;
        f.incidencias.push('Posible duplicado');
      }
    }
  }
  return filas.sort(compararFilas);
}

/** Orden por calle y numeración (con sufijo). */
export function compararFilas(a: FilaOficina, b: FilaOficina): number {
  return a.calle.localeCompare(b.calle, 'es') || (a.numero ?? 9999) - (b.numero ?? 9999) || (a.sufijo ?? '').localeCompare(b.sufijo ?? '');
}

// ───────────── Progreso por itinerario ─────────────

export interface Contador {
  hechos: number;
  pendientes: number;
}

export interface ResumenItinerario {
  itinerarioId: Id | null; // null = registros fuera de cualquier itinerario
  codigo: string;
  nombre: string;
  estado: EstadoOficinaItinerario['estado'];
  /** Último cierre o validación: quién y cuándo. */
  cierre?: { accion: string; porId: Id; fecha: string; motivo?: string };
  calles: { total: number; completadas: number; sinLocales: number; enCurso: number; pendientes: number; parciales: number };
  campo: Contador; // locales registrados frente a pendientes de visita
  categorizacion: Contador; // ocupados registrados
  digital: Contador; // ocupados registrados
  incidencias: number;
  errores: number;
  cronologiaIncierta: number;
  total: number;
}

const cuenta = (filas: FilaOficina[], ok: (f: FilaOficina) => boolean): Contador => {
  let hechos = 0;
  for (const f of filas) if (ok(f)) hechos++;
  return { hechos, pendientes: filas.length - hechos };
};

export function resumenDeFilas(filas: FilaOficina[]) {
  const registrados = filas.filter((f) => f.situacion === 'registrado');
  const ocupados = registrados.filter((f) => !f.vacio);
  return {
    total: filas.length,
    campo: { hechos: registrados.length, pendientes: filas.length - registrados.length },
    categorizacion: cuenta(ocupados, (f) => f.rev.categorizacion === 'revisado'),
    digital: cuenta(ocupados, (f) => f.rev.digital === 'revisado'),
    incidencias: filas.filter((f) => f.incidencias.length).length,
    errores: filas.filter((f) => f.errores.length).length,
    cronologiaIncierta: filas.filter((f) => f.cronologiaIncierta.length).length,
  };
}

/** Progreso independiente de cada itinerario de la campaña (y de lo que queda fuera de ellos). */
export function resumenItinerarios(db: BaseDatos, campanaId: Id, filas: FilaOficina[]): ResumenItinerario[] {
  const out: ResumenItinerario[] = [];
  for (const it of itinerariosDe(db, campanaId)) {
    const propias = filas.filter((f) => f.itinerarioIds.includes(it.id));
    const p = progresoItinerario(db, it);
    const est = db.oficinaItinerarios[it.id];
    const cierre = [...(est?.historial ?? [])].reverse().find((h) => h.accion === 'cerrar-revision' || h.accion === 'validar' || h.accion === 'reabrir');
    out.push({
      itinerarioId: it.id, codigo: it.codigo, nombre: it.nombre, estado: estadoOficina(db, it.id), cierre,
      calles: {
        total: p.total, completadas: p.completadas, sinLocales: p.porEstado['completada-sin-locales'], enCurso: p.porEstado['en-curso'],
        pendientes: p.porEstado.pendiente, parciales: p.porEstado['parcial-incidencias'],
      },
      ...resumenDeFilas(propias),
    });
  }
  const fuera = filas.filter((f) => !f.itinerarioIds.length);
  if (fuera.length) {
    out.push({
      itinerarioId: null, codigo: '—', nombre: 'Sin itinerario asignado', estado: 'en-revision',
      calles: { total: 0, completadas: 0, sinLocales: 0, enCurso: 0, pendientes: 0, parciales: 0 },
      ...resumenDeFilas(fuera),
    });
  }
  return out;
}

/** Calles (tramos) de un itinerario con su cobertura: una calle sin locales conserva su estado. */
export function callesDeItinerario(db: BaseDatos, it: Itinerario, filas: FilaOficina[]) {
  return it.tramos.map((t) => {
    const propias = filas.filter((f) => f.calleId === t.calleId && f.itinerarioIds.includes(it.id));
    return {
      tramo: t,
      calle: db.calles[t.calleId]?.nombre ?? '¿?',
      estado: estadoTramo(db, it.campanaId, t),
      registrados: propias.filter((f) => f.situacion === 'registrado').length,
      pendientesVisita: propias.filter((f) => f.situacion === 'pendiente-visita').length,
    };
  });
}

export function esDudosa(f: FilaOficina) {
  return f.cronologiaIncierta.length > 0 || !!f.rev.pendienteComprobacion || f.vinculo === 'dudosa' || f.vinculo === 'probable' || f.obs?.tipo === 'dudoso' || f.obs?.tipo === 'posible-desaparicion';
}

export function motivoNoAprobable(f: FilaOficina): string | null {
  if (f.situacion === 'pendiente-visita') return 'local pendiente de visitar';
  if (f.rev.campo !== 'terminado') return 'trabajo de campo pendiente';
  if (!f.vacio && f.rev.categorizacion !== 'revisado') return 'categorización pendiente';
  if (!f.vacio && f.rev.digital !== 'revisado') return 'presencia digital pendiente';
  if (esDudosa(f)) return 'caso dudoso sin resolver';
  return null;
}

/** Cambios de revisión sobre registros de una campaña (respeta bloqueo y alcance). */
export function actualizarRevisiones(db: BaseDatos, campanaId: Id, localIds: Id[], cambios: Partial<Revision>, alcance?: Alcance): BaseDatos {
  comprobarAlcance(db, alcance, localIds);
  for (const id of localIds) comprobarEditable(db, campanaId, { localId: id });
  const revs = { ...db.revisiones };
  for (const id of localIds) revs[kRev(campanaId, id)] = { ...revisionDe(db, campanaId, id), ...cambios };
  return { ...db, revisiones: revs };
}

/** Clasificación de varios registros a la vez: cada negocio queda clasificado en ESTA campaña. */
export function asignarActividad(db: BaseDatos, campanaId: Id, filas: { localId: Id; negocioId: Id | null }[], actividadId: Id, porId: Id, alcance?: Alcance): BaseDatos {
  comprobarAlcance(db, alcance, filas.map((f) => f.localId));
  let d = db;
  for (const negocioId of new Set(filas.map((f) => f.negocioId).filter((x): x is Id => !!x))) d = clasificar(d, negocioId, campanaId, actividadId, porId, { alcance });
  return d;
}

/**
 * Corrección de datos del negocio (nombre comercial, cadena, descripción). El negocio es el
 * mismo en todas las campañas; el histórico conserva lo observado en cada observación.
 */
export function editarNegocio(db: BaseDatos, campanaId: Id, negocioId: Id, cambios: Partial<Pick<Negocio, 'nombre' | 'cadena' | 'descripcion'>>, alcance?: Alcance): BaseDatos {
  prepararOperacionNegocio(db, negocioId, campanaId, alcance);
  return { ...db, negocios: { ...db.negocios, [negocioId]: { ...db.negocios[negocioId], ...cambios } } };
}

export function aprobar(db: BaseDatos, campanaId: Id, filas: FilaOficina[], alcance?: Alcance): { db: BaseDatos; aprobados: number; omitidos: { f: FilaOficina; motivo: string }[] } {
  const ok = filas.filter((f) => !motivoNoAprobable(f));
  const omitidos = filas.filter((f) => motivoNoAprobable(f)).map((f) => ({ f, motivo: motivoNoAprobable(f)! }));
  const d = actualizarRevisiones(db, campanaId, ok.map((f) => f.localId), { validacion: 'aprobada', motivoDevolucion: undefined }, alcance);
  // Las observaciones de la campaña quedan verificadas al aprobar
  const obs = { ...d.observaciones };
  for (const f of ok) if (f.obs) obs[f.obs.id] = { ...f.obs, verificacion: 'verificada' };
  return { db: { ...d, observaciones: obs }, aprobados: ok.length, omitidos };
}

export function devolver(db: BaseDatos, campanaId: Id, localIds: Id[], motivo: string, alcance?: Alcance): BaseDatos {
  return actualizarRevisiones(db, campanaId, localIds, { validacion: 'devuelta', motivoDevolucion: motivo }, alcance);
}
