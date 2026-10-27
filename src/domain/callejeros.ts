import { ErrorDominio, type BaseDatos } from './db';
import { sha256Texto } from './sha256';
import { claveCalle, normalizar, similitud, tipoVia } from './text';
import { geometriaDentro, leerGeometriaManual, type LecturaCallejero, type ViaEntrante } from './fuentesCallejero';
import { REFERENCIAS_INICIALES, REFERENCIAS_SUPERADAS } from '../data/referenciasDenominacion';
import type { AliasCalle, Calle, CambioCalle, CargaCallejero, FormaVia, Id, Municipio, ReferenciaDenominacion, Segmento } from './types';

/**
 * G3 · CALLEJEROS MUNICIPALES como datos.
 *
 * - CARGAS desde fuentes verificables (OSM con límite administrativo, callejero oficial). Una carga se
 *   PLANIFICA (vista previa) y después se aplica. Nunca borra: las vías que ya no vienen se conservan; las
 *   que coinciden conservan su IDENTIFICADOR (y con él locales, observaciones e itinerarios) y sus
 *   segmentos conservan los suyos. Un cambio de nombre en la fuente NO renombra: se señala para revisarlo.
 * - ALTAS MANUALES supervisadas: nombre, tipo, fuente documental, persona y fecha; geometría opcional
 *   (nunca inventada). Quedan como PROPUESTA y no se usan hasta que alguien las valida. Se pueden
 *   corregir o rechazar, siempre con traza (`historial`).
 * - DENOMINACIONES: alias, nombres históricos y alternativos de cada vía, y referencias del municipio
 *   («Plaza Mayor» → «Plaza Mayor de la Hispanidad»). Solo orientan la conciliación: nada se vincula solo.
 */

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'x';

/** ¿Se usa esta vía en la conciliación y en la incorporación? Las altas manuales, solo una vez validadas. */
export const calleVigente = (c: Calle) => !c.alta || c.alta.estado === 'validada';
export const callesDe = (db: Pick<BaseDatos, 'calles'>, municipioId: Id) => Object.values(db.calles).filter((c) => c.municipioId === municipioId);
export const callesVigentes = (db: Pick<BaseDatos, 'calles'>, municipioId: Id) => callesDe(db, municipioId).filter(calleVigente);

/** Forma de una vía según sus segmentos. */
export function formaDe(segmentos: Segmento[]): FormaVia {
  if (!segmentos.length) return 'sin-geometria';
  const tipos = new Set(segmentos.map((s) => s.tipo ?? 'linea'));
  return tipos.size > 1 ? 'mixta' : ([...tipos][0] as FormaVia);
}
export const FORMA_TXT: Record<FormaVia, string> = { linea: 'Línea (tramos)', area: 'Área (plaza o espacio)', punto: 'Punto', mixta: 'Tramos y áreas', 'sin-geometria': 'Sin geometría' };

/** Prefijo del municipio en los identificadores de sus vías. */
function raizId(db: BaseDatos, municipioId: Id, prefijo: string): string {
  const pilotos = callesDe(db, municipioId);
  // Medina del Campo (municipio piloto) conserva el esquema de identificadores de su instantánea.
  if (municipioId === `${prefijo}-mun-medina` && pilotos.length) return `${prefijo}-c`;
  return `${prefijo}-c-${municipioId.startsWith(`${prefijo}-mun-`) ? municipioId.slice(`${prefijo}-mun-`.length) : slug(municipioId)}`;
}

// ───────────── Cargas ─────────────

export interface MetaCarga {
  archivo: string;
  /** Texto exacto del archivo: su SHA-256 identifica la carga. */
  contenido: string;
  fuente: string;
  fechaDatos?: string;
  version?: string;
  licencia?: string;
}

export type AccionVia = 'nueva' | 'actualizada' | 'sin-cambios' | 'conflicto';

export interface ViaPlan {
  nombre: string;
  accion: AccionVia;
  calleId?: Id;
  forma: FormaVia;
  segmentos: number;
  /** Segmentos de la carga anterior que ya no vienen y se conservan por estar en uso. */
  conservados?: number;
  motivo?: string;
}

export interface PlanCarga {
  municipioId: Id;
  tipo: 'osm' | 'oficial';
  sha256: string;
  vias: ViaPlan[];
  /** Vías del callejero actual que no vienen en esta carga: se conservan sin cambios. */
  ausentes: { calleId: Id; nombre: string }[];
  resumen: Record<'nuevas' | 'actualizadas' | 'sin-cambios' | 'conflictos' | 'ausentes' | 'agrupadas' | 'descartadas' | 'plazas' | 'sin-geometria', number>;
  avisos: string[];
  /** Ya se aplicó una carga con el mismo archivo. */
  repetida: boolean;
}

/** Segmentos en uso por itinerarios (tramos con segmentos elegidos): no se retiran nunca. */
function segmentosEnUso(db: BaseDatos): Set<string> {
  const s = new Set<string>();
  for (const it of Object.values(db.itinerarios)) for (const t of it.tramos) for (const id of t.segmentoIds ?? []) s.add(`${t.calleId}|${id}`);
  return s;
}

const deEstaFuente = (seg: Segmento, tipo: 'osm' | 'oficial') => (tipo === 'osm' ? (seg.fuente ?? `osm:${seg.id}`).startsWith('osm:') : !!seg.fuente && !seg.fuente.startsWith('osm:') && seg.fuente !== 'manual');

function emparejar(db: BaseDatos, municipioId: Id, v: ViaEntrante, usadas: Set<Id>): { calle?: Calle; conflicto?: string } {
  const propias = callesDe(db, municipioId).filter((c) => c.alta?.estado !== 'rechazada');
  const clave = claveCalle(v.nombre);
  const porRef = propias.filter((c) => c.refsFuente.some((r) => v.refs.includes(r)) || (!!v.codigo && c.codigoVia === v.codigo));
  const porNombre = propias.filter((c) => claveCalle(c.nombre) === clave);
  const candidatas = [...new Set([...porRef, ...porNombre])];
  if (candidatas.length > 1) return { conflicto: `Coincide con varias vías del callejero (${candidatas.map((c) => `«${c.nombre}»`).join(', ')}): no se elige ninguna.` };
  const c = candidatas[0];
  if (!c) return {};
  if (claveCalle(c.nombre) !== clave) return { conflicto: `La fuente llama «${v.nombre}» a la vía que el callejero tiene como «${c.nombre}». No se renombra sola: revísela (puede registrar el nombre como alias o corregir la vía).` };
  if (usadas.has(c.id)) return { conflicto: `Otra vía de la misma carga coincide ya con «${c.nombre}».` };
  return { calle: c };
}

/** Vista previa de una carga sobre el callejero actual del municipio (no cambia nada). */
export function planificarCarga(db: BaseDatos, municipioId: Id, lectura: Extract<LecturaCallejero, { ok: true }>, meta: Pick<MetaCarga, 'contenido'>): PlanCarga {
  if (!db.municipios[municipioId]) throw new ErrorDominio('regla', 'Elija el municipio del callejero.');
  const sha256 = sha256Texto(meta.contenido);
  const enUso = segmentosEnUso(db);
  const usadas = new Set<Id>();
  const vias: ViaPlan[] = lectura.vias.map((v) => {
    const forma = formaDe(v.segmentos);
    const { calle, conflicto } = emparejar(db, municipioId, v, usadas);
    if (conflicto) return { nombre: v.nombre, accion: 'conflicto', forma, segmentos: v.segmentos.length, motivo: conflicto };
    if (!calle) return { nombre: v.nombre, accion: 'nueva', forma, segmentos: v.segmentos.length };
    usadas.add(calle.id);
    const nuevos = fusionarSegmentos(calle, v, lectura.tipo, enUso);
    const igual = JSON.stringify(nuevos.segmentos) === JSON.stringify(calle.segmentos) && v.refs.every((r) => calle.refsFuente.includes(r)) && (!v.codigo || calle.codigoVia === v.codigo);
    return { nombre: calle.nombre, accion: igual ? 'sin-cambios' : 'actualizada', calleId: calle.id, forma: formaDe(nuevos.segmentos), segmentos: nuevos.segmentos.length, ...(nuevos.conservados ? { conservados: nuevos.conservados } : {}) };
  });
  const ausentes = callesDe(db, municipioId).filter((c) => calleVigente(c) && !usadas.has(c.id) && !vias.some((v) => v.calleId === c.id)).map((c) => ({ calleId: c.id, nombre: c.nombre }));
  const cuenta = (a: AccionVia) => vias.filter((v) => v.accion === a).length;
  const d = lectura.descartes;
  const repetida = (db.municipios[municipioId].callejero?.cargas ?? []).some((c) => c.sha256 === sha256);
  return {
    municipioId, tipo: lectura.tipo, sha256, vias, ausentes,
    resumen: {
      nuevas: cuenta('nueva'), actualizadas: cuenta('actualizada'), 'sin-cambios': cuenta('sin-cambios'), conflictos: cuenta('conflicto'), ausentes: ausentes.length,
      agrupadas: lectura.agrupados, descartadas: d.sinNombre + d.fueraDelLimite + d.tipoNoAdmitido + d.otroMunicipio + d.geometriaInvalida,
      plazas: vias.filter((v) => v.forma === 'area' || v.forma === 'punto' || /^plaza\b/.test(normalizar(v.nombre))).length,
      'sin-geometria': vias.filter((v) => v.forma === 'sin-geometria').length,
    },
    avisos: [
      ...lectura.avisos,
      ...(repetida ? ['Este mismo archivo ya se cargó: aplicarlo de nuevo no cambia nada.'] : []),
      ...(d.fueraDelLimite ? [`${d.fueraDelLimite} elemento(s) fuera del límite del municipio: no se incorporan.`] : []),
      ...(d.otroMunicipio ? [`${d.otroMunicipio} fila(s) de otro municipio: no se incorporan.`] : []),
      ...(d.sinNombre ? [`${d.sinNombre} elemento(s) sin nombre: no se incorporan.`] : []),
      ...(d.geometriaInvalida ? [`${d.geometriaInvalida} elemento(s) con geometría no válida: no se incorporan.`] : []),
      ...(ausentes.length ? [`${ausentes.length} vía(s) del callejero actual no vienen en esta carga: se conservan sin cambios (no se borra nada).`] : []),
    ],
    repetida,
  };
}

/** Segmentos tras la carga: los de esta fuente se sustituyen; los demás (y los que están en uso) se conservan. */
function fusionarSegmentos(calle: Calle, v: ViaEntrante, tipo: 'osm' | 'oficial', enUso: Set<string>): { segmentos: Segmento[]; conservados: number } {
  const entrantes = new Map(v.segmentos.map((s) => [s.id, s]));
  let conservados = 0;
  const previos = calle.segmentos.filter((s) => {
    if (entrantes.has(s.id)) return false;
    if (!deEstaFuente(s, tipo)) return true;
    if (enUso.has(`${calle.id}|${s.id}`)) { conservados++; return true; }
    return false;
  });
  // Los segmentos que ya existían mantienen su posición; los nuevos van detrás.
  const orden = calle.segmentos.map((s) => s.id);
  const nuevos = [...previos, ...v.segmentos].sort((a, b) => {
    const ia = orden.indexOf(a.id);
    const ib = orden.indexOf(b.id);
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
  });
  return { segmentos: nuevos, conservados };
}

/** Aplica una carga (tras revisar su vista previa). Devuelve una base nueva; `db` no cambia. */
export function aplicarCarga(
  db: BaseDatos, municipioId: Id, lectura: Extract<LecturaCallejero, { ok: true }>, meta: MetaCarga, o: { prefijo: string; porId: Id; ahora?: string },
): { db: BaseDatos; carga: CargaCallejero; plan: PlanCarga } {
  if (!db.personas[o.porId]) throw new ErrorDominio('regla', 'La carga debe hacerla una persona registrada.');
  if (meta.fuente.trim().length < 3) throw new ErrorDominio('regla', 'Indique la fuente del callejero (organismo, servicio o dirección web).');
  const plan = planificarCarga(db, municipioId, lectura, meta);
  if (plan.repetida) throw new ErrorDominio('regla', 'Este mismo archivo ya se cargó en el callejero del municipio.');
  const ahora = o.ahora ?? new Date().toISOString();
  const mun = db.municipios[municipioId];
  const carga: CargaCallejero = {
    id: `carga-${municipioId}-${(mun.callejero?.cargas?.length ?? 0) + 1}`, tipo: lectura.tipo, fuente: meta.fuente.trim(), archivo: meta.archivo, sha256: plan.sha256,
    ...(meta.fechaDatos || lectura.fechaDatos ? { fechaDatos: meta.fechaDatos || lectura.fechaDatos } : {}),
    ...(meta.version?.trim() ? { version: meta.version.trim() } : {}), ...(meta.licencia?.trim() ? { licencia: meta.licencia.trim() } : {}),
    porId: o.porId, fecha: ahora, resumen: plan.resumen,
  };
  const calles = { ...db.calles };
  const enUso = segmentosEnUso(db);
  const raiz = raizId(db, municipioId, o.prefijo);
  const traza = (detalle: string): CambioCalle => ({ fecha: ahora, porId: o.porId, accion: 'carga', detalle });
  lectura.vias.forEach((v, i) => {
    const p = plan.vias[i];
    if (p.accion === 'conflicto' || p.accion === 'sin-cambios') return;
    if (p.accion === 'actualizada') {
      const c = calles[p.calleId!];
      const { segmentos } = fusionarSegmentos(c, v, lectura.tipo, enUso);
      calles[c.id] = {
        ...c, segmentos, longitudM: segmentos.reduce((a, s) => a + s.longitudM, 0), forma: formaDe(segmentos),
        refsFuente: [...new Set([...c.refsFuente, ...v.refs])], ...(v.codigo && !c.codigoVia ? { codigoVia: v.codigo } : {}),
        cargas: [...(c.cargas ?? []), carga.id], historial: [...(c.historial ?? []), traza(`Actualizada por la carga «${carga.fuente}» (${segmentos.length} segmento(s)).`)],
      };
      return;
    }
    let id = `${raiz}-${slug(claveCalle(v.nombre))}`;
    for (let n = 2; calles[id]; n++) id = `${raiz}-${slug(claveCalle(v.nombre))}-${n}`;
    calles[id] = {
      id, municipioId, nombre: v.nombre, tipoVia: tipoVia(v.nombre), segmentos: v.segmentos, longitudM: v.segmentos.reduce((a, s) => a + s.longitudM, 0),
      procedencia: lectura.tipo === 'osm' ? 'osm' : 'importado', refsFuente: v.refs, forma: formaDe(v.segmentos), ...(v.codigo ? { codigoVia: v.codigo } : {}),
      cargas: [carga.id], historial: [traza(`Incorporada por la carga «${carga.fuente}».`)],
    };
  });
  const cj = mun.callejero ?? { estado: 'sin-callejero' as const };
  const municipio: Municipio = {
    ...mun,
    ...(lectura.tipo === 'osm' ? { fuenteCallejero: 'osm' as const } : {}),
    callejero: {
      ...cj, estado: 'disponible', fuente: lectura.tipo, actualizado: ahora,
      detalle: `${carga.fuente}${carga.fechaDatos ? ` (datos a ${carga.fechaDatos.slice(0, 10)})` : ''}${carga.version ? ` · versión ${carga.version}` : ''}`,
      cargas: [...(cj.cargas ?? []), carga],
      ...(lectura.limite ? { limite: lectura.limite } : {}),
    },
  };
  return { db: { ...db, calles, municipios: { ...db.municipios, [municipioId]: municipio } }, carga, plan };
}

// ───────────── Altas manuales supervisadas ─────────────

export const TIPOS_VIA_ALTA = ['Calle', 'Plaza', 'Avenida', 'Paseo', 'Travesía', 'Ronda', 'Camino', 'Carretera', 'Glorieta', 'Pasaje', 'Callejón', 'Parque', 'Urbanización', 'Otro'];

export interface DatosAltaCalle {
  municipioId: Id;
  nombre: string;
  tipoVia: string;
  fuenteDocumental: string;
  /** Geometría opcional: GeoJSON o pares «latitud, longitud». Vacío = sin geometría. */
  geometria?: string;
  nota?: string;
}

/** Nombre completo de un alta: «Plaza» + «Mayor de la Hispanidad» (si el nombre ya empieza por el tipo, no se repite). */
export const nombreDeAlta = (d: Pick<DatosAltaCalle, 'nombre' | 'tipoVia'>) => {
  const n = d.nombre.trim().replace(/\s+/g, ' ');
  return !d.tipoVia || d.tipoVia === 'Otro' || normalizar(n).startsWith(`${normalizar(d.tipoVia)} `) ? n : `${d.tipoVia} ${n}`;
};

/** Vías del municipio cuyo nombre o alias coincide (misma clave) con `nombre`. */
function coincidencias(db: BaseDatos, municipioId: Id, nombre: string, excepto?: Id): Calle[] {
  const k = claveCalle(nombre);
  return callesDe(db, municipioId).filter((c) => c.id !== excepto && c.alta?.estado !== 'rechazada'
    && (claveCalle(c.nombre) === k || (c.alias ?? []).some((a) => !a.retirado && claveCalle(a.nombre) === k)));
}

/**
 * Pertenencia de una geometría manual al municipio, comprobada contra su PERÍMETRO administrativo
 * (todas las partes del municipio y sus huecos). Si el municipio no tiene perímetro cargado, la
 * pertenencia NO está verificada (el rectángulo envolvente no basta: incluye puntos de fuera).
 */
export function pertenenciaGeometria(m: Municipio, coords: [number, number][]): { estado: 'verificada' | 'no-verificada' | 'fuera'; motivo: string } {
  const pol = m.callejero?.limite?.poligono;
  if (!pol?.exteriores.length) return { estado: 'no-verificada', motivo: `Pertenencia territorial NO verificada: ${m.nombre} no tiene cargado su límite administrativo con geometría (se obtiene al cargar su callejero de OpenStreetMap).` };
  const r = geometriaDentro(coords, pol);
  if (r.verticesFuera) return { estado: 'fuera', motivo: `La geometría cae fuera del límite municipal de ${m.nombre} (${r.verticesFuera} de ${coords.length} punto(s) fuera del perímetro).` };
  if (r.cruza) return { estado: 'fuera', motivo: `La geometría sale del límite municipal de ${m.nombre}: algún tramo cruza el perímetro.` };
  return { estado: 'verificada', motivo: `Dentro del límite municipal de ${m.nombre} (${m.callejero!.limite!.fuente}).` };
}

export function validarAltaCalle(db: BaseDatos, d: DatosAltaCalle): { errores: string[]; parecidas: string[]; avisos: string[] } {
  const errores: string[] = [];
  const avisos: string[] = [];
  const m = db.municipios[d.municipioId];
  if (!m) return { errores: ['Elija el municipio.'], parecidas: [], avisos };
  const nombre = nombreDeAlta(d);
  if (d.nombre.trim().length < 2) errores.push('Indique el nombre de la vía.');
  if (!d.tipoVia) errores.push('Indique el tipo de vía.');
  if (d.fuenteDocumental.trim().length < 3) errores.push('Indique la fuente documental (p. ej. «Nomenclátor municipal, acuerdo de pleno de 12-03-1992» o «placa en la vía, foto del 24-10-2026»).');
  const ya = coincidencias(db, d.municipioId, nombre);
  if (ya.length) errores.push(`Ya existe en el callejero de ${m.nombre}: «${ya[0].nombre}»${ya[0].alta?.estado === 'propuesta' ? ' (propuesta pendiente de validar)' : ''}.`);
  const g = leerGeometriaManual(d.geometria ?? '');
  if (!g.ok) errores.push(g.motivo);
  else if (g.segmento) {
    const p = pertenenciaGeometria(m, g.segmento.coords);
    if (p.estado === 'fuera') errores.push(p.motivo);
    else if (p.estado === 'no-verificada') avisos.push(p.motivo);
  }
  const parecidas = d.nombre.trim().length >= 3
    ? callesDe(db, d.municipioId).filter((c) => !ya.includes(c) && similitud(nombre, c.nombre) >= 0.8).map((c) => c.nombre).slice(0, 5)
    : [];
  return { errores, parecidas, avisos };
}

/** Alta manual: queda como PROPUESTA (no se usa hasta validarla). */
export function altaCalle(db: BaseDatos, d: DatosAltaCalle, o: { prefijo: string; porId: Id; ahora?: string }): { db: BaseDatos; calleId: Id } {
  const v = validarAltaCalle(db, d);
  if (v.errores.length) throw new ErrorDominio('regla', v.errores[0], v.errores);
  if (!db.personas[o.porId]) throw new ErrorDominio('regla', 'El alta debe hacerla una persona registrada.');
  const ahora = o.ahora ?? new Date().toISOString();
  const nombre = nombreDeAlta(d);
  const g = leerGeometriaManual(d.geometria ?? '');
  const segmentos = g.ok && g.segmento ? [{ ...g.segmento }] : [];
  const raiz = `${raizId(db, d.municipioId, o.prefijo)}-m`;
  let id = `${raiz}-${slug(claveCalle(nombre))}`;
  for (let n = 2; db.calles[id]; n++) id = `${raiz}-${slug(claveCalle(nombre))}-${n}`;
  const c: Calle = {
    id, municipioId: d.municipioId, nombre, tipoVia: d.tipoVia === 'Otro' ? tipoVia(nombre) : d.tipoVia, segmentos: segmentos.map((s) => ({ ...s, id: `${id}-g1` })),
    longitudM: segmentos.reduce((a, s) => a + s.longitudM, 0), procedencia: 'manual', refsFuente: [], forma: formaDe(segmentos),
    alta: {
      estado: 'propuesta', fuenteDocumental: d.fuenteDocumental.trim(), porId: o.porId, fecha: ahora, ...(d.nota?.trim() ? { nota: d.nota.trim() } : {}),
      ...(segmentos.length ? { pertenencia: v.avisos.length ? 'no-verificada' as const : 'verificada' as const } : {}),
    },
    historial: [{ fecha: ahora, porId: o.porId, accion: 'alta', detalle: `Alta manual propuesta. Fuente: ${d.fuenteDocumental.trim()}.${segmentos.length ? '' : ' Sin geometría.'}` }],
  };
  return { db: { ...db, calles: { ...db.calles, [id]: c } }, calleId: id };
}

const puedeSupervisar = (db: BaseDatos, porId: Id) => {
  const p = db.personas[porId];
  return !!p && (p.roles.includes('coordinador') || p.roles.includes('administrador'));
};

function cambiarCalle(db: BaseDatos, calleId: Id, f: (c: Calle) => Calle): BaseDatos {
  const c = db.calles[calleId];
  if (!c) throw new ErrorDominio('regla', 'La vía no existe.');
  return { ...db, calles: { ...db.calles, [calleId]: f(c) } };
}

/** Validación (supervisión) de un alta manual: a partir de aquí la vía se usa en la conciliación. */
export function validarCalle(db: BaseDatos, calleId: Id, o: { porId: Id; ahora?: string; nota?: string }): BaseDatos {
  const c = db.calles[calleId];
  if (!c?.alta) throw new ErrorDominio('regla', 'Solo se validan las altas manuales.');
  if (c.alta.estado !== 'propuesta') throw new ErrorDominio('regla', `Esta alta ya está ${c.alta.estado}.`);
  if (!puedeSupervisar(db, o.porId)) throw new ErrorDominio('regla', 'Valida una persona con el rol de coordinación o administración.');
  const otra = coincidencias(db, c.municipioId, c.nombre, c.id).filter(calleVigente);
  if (otra.length) throw new ErrorDominio('regla', `No se valida: «${otra[0].nombre}» ya figura en el callejero.`);
  const ahora = o.ahora ?? new Date().toISOString();
  return cambiarCalle(db, calleId, (x) => ({
    ...x, alta: { ...x.alta!, estado: 'validada', validacion: { porId: o.porId, fecha: ahora, ...(o.nota?.trim() ? { nota: o.nota.trim() } : {}) } },
    historial: [...(x.historial ?? []), { fecha: ahora, porId: o.porId, accion: 'validacion', detalle: `Alta validada${o.nota?.trim() ? `: ${o.nota.trim()}` : ''}.` }],
  }));
}

/** ¿Algo usa ya esta vía? (locales, observaciones, itinerarios, campañas). */
export function usosDeCalle(db: BaseDatos, calleId: Id): number {
  return Object.values(db.locales).filter((l) => l.direcciones.some((d) => d.calleId === calleId)).length
    + Object.values(db.observaciones).filter((o) => o.calleId === calleId).length
    + Object.values(db.itinerarios).filter((i) => i.tramos.some((t) => t.calleId === calleId)).length
    + Object.values(db.campanas).filter((c) => c.ambitoCalleIds.includes(calleId)).length;
}

/** Rechazo de un alta manual (se conserva con su traza; no se usa). Solo si nada la usa. */
export function rechazarCalle(db: BaseDatos, calleId: Id, o: { porId: Id; ahora?: string; motivo: string }): BaseDatos {
  const c = db.calles[calleId];
  if (!c?.alta) throw new ErrorDominio('regla', 'Solo se rechazan las altas manuales.');
  if (c.alta.estado === 'rechazada') throw new ErrorDominio('regla', 'Ya está rechazada.');
  if (!puedeSupervisar(db, o.porId)) throw new ErrorDominio('regla', 'Rechaza una persona con el rol de coordinación o administración.');
  if (!o.motivo.trim()) throw new ErrorDominio('regla', 'Indique el motivo del rechazo.');
  if (usosDeCalle(db, calleId)) throw new ErrorDominio('bloqueado', 'La vía ya se usa (locales, observaciones o itinerarios): corríjala en lugar de rechazarla.');
  const ahora = o.ahora ?? new Date().toISOString();
  return cambiarCalle(db, calleId, (x) => ({
    ...x, alta: { ...x.alta!, estado: 'rechazada', validacion: { porId: o.porId, fecha: ahora, nota: o.motivo.trim() } },
    historial: [...(x.historial ?? []), { fecha: ahora, porId: o.porId, accion: 'rechazo', detalle: `Alta rechazada: ${o.motivo.trim()}.` }],
  }));
}

/** Corrección de una vía añadida a mano (nombre, tipo, fuente o geometría). El identificador no cambia. */
export function corregirCalle(db: BaseDatos, calleId: Id, cambios: Partial<Pick<DatosAltaCalle, 'nombre' | 'tipoVia' | 'fuenteDocumental' | 'geometria'>>, o: { porId: Id; ahora?: string; motivo?: string }): BaseDatos {
  const c = db.calles[calleId];
  if (!c) throw new ErrorDominio('regla', 'La vía no existe.');
  if (!c.alta) throw new ErrorDominio('regla', 'Las vías de una fuente (OSM u oficial) no se corrigen a mano: registre un alias o actualice la carga.');
  if (!db.personas[o.porId]) throw new ErrorDominio('regla', 'La corrección debe hacerla una persona registrada.');
  const ahora = o.ahora ?? new Date().toISOString();
  const tipoNuevo = cambios.tipoVia ?? c.tipoVia;
  const nombre = cambios.nombre !== undefined ? nombreDeAlta({ nombre: cambios.nombre, tipoVia: tipoNuevo }) : c.nombre;
  if (cambios.nombre !== undefined && coincidencias(db, c.municipioId, nombre, c.id).length) throw new ErrorDominio('regla', `Ya existe «${nombre}» en el callejero.`);
  let segmentos = c.segmentos;
  let pertenencia: 'verificada' | 'no-verificada' | undefined;
  if (cambios.geometria !== undefined) {
    const g = leerGeometriaManual(cambios.geometria);
    if (!g.ok) throw new ErrorDominio('regla', g.motivo);
    if (g.segmento) {
      const p = pertenenciaGeometria(db.municipios[c.municipioId], g.segmento.coords);
      if (p.estado === 'fuera') throw new ErrorDominio('regla', p.motivo);
      pertenencia = p.estado;
    }
    segmentos = g.segmento ? [{ ...g.segmento, id: `${c.id}-g${(c.historial ?? []).length + 1}` }] : [];
  }
  const antes: Record<string, unknown> = {};
  if (nombre !== c.nombre) antes.nombre = c.nombre;
  if (tipoNuevo !== c.tipoVia) antes.tipoVia = c.tipoVia;
  if (cambios.fuenteDocumental !== undefined && cambios.fuenteDocumental.trim() !== c.alta.fuenteDocumental) antes.fuenteDocumental = c.alta.fuenteDocumental;
  if (cambios.geometria !== undefined) antes.segmentos = c.segmentos;
  if (!Object.keys(antes).length) throw new ErrorDominio('regla', 'No hay cambios que registrar.');
  return cambiarCalle(db, calleId, (x) => ({
    ...x, nombre, tipoVia: tipoNuevo, segmentos, longitudM: segmentos.reduce((a, s) => a + s.longitudM, 0), forma: formaDe(segmentos),
    alta: {
      ...x.alta!, ...(cambios.fuenteDocumental?.trim() ? { fuenteDocumental: cambios.fuenteDocumental.trim() } : {}),
      ...(cambios.geometria !== undefined ? { pertenencia } : {}),
    },
    historial: [...(x.historial ?? []), { fecha: ahora, porId: o.porId, accion: 'correccion', detalle: `Corregido: ${Object.keys(antes).join(', ')}${o.motivo?.trim() ? `. ${o.motivo.trim()}` : ''}.`, antes }],
  }));
}

// ───────────── Alias y nombres históricos ─────────────

export const TIPO_ALIAS_TXT: Record<AliasCalle['tipo'], string> = { historico: 'Nombre histórico', alternativo: 'Denominación alternativa', alias: 'Alias' };

export function anadirAlias(db: BaseDatos, calleId: Id, a: Pick<AliasCalle, 'nombre' | 'tipo' | 'fuente' | 'desde' | 'hasta' | 'nota'>, o: { porId: Id; ahora?: string }): BaseDatos {
  const c = db.calles[calleId];
  if (!c) throw new ErrorDominio('regla', 'La vía no existe.');
  if (!db.personas[o.porId]) throw new ErrorDominio('regla', 'El alias debe registrarlo una persona.');
  const nombre = a.nombre.trim().replace(/\s+/g, ' ');
  if (nombre.length < 2) throw new ErrorDominio('regla', 'Indique la denominación.');
  if (a.fuente.trim().length < 3) throw new ErrorDominio('regla', 'Indique la fuente de la denominación.');
  if (claveCalle(nombre) === claveCalle(c.nombre)) throw new ErrorDominio('regla', 'Es el nombre actual de la vía.');
  const otra = coincidencias(db, c.municipioId, nombre).find((x) => x.id !== c.id);
  if (otra) throw new ErrorDominio('regla', `«${nombre}» ya identifica a «${otra.nombre}»: registrarlo aquí haría ambigua la conciliación.`);
  if ((c.alias ?? []).some((x) => !x.retirado && claveCalle(x.nombre) === claveCalle(nombre))) throw new ErrorDominio('regla', 'Ese alias ya está registrado.');
  const ahora = o.ahora ?? new Date().toISOString();
  const alias: AliasCalle = { nombre, tipo: a.tipo, fuente: a.fuente.trim(), porId: o.porId, fecha: ahora, ...(a.desde ? { desde: a.desde } : {}), ...(a.hasta ? { hasta: a.hasta } : {}), ...(a.nota?.trim() ? { nota: a.nota.trim() } : {}) };
  return cambiarCalle(db, calleId, (x) => ({
    ...x, alias: [...(x.alias ?? []), alias],
    historial: [...(x.historial ?? []), { fecha: ahora, porId: o.porId, accion: 'alias', detalle: `${TIPO_ALIAS_TXT[a.tipo]} «${nombre}» (fuente: ${alias.fuente}).` }],
  }));
}

export function retirarAlias(db: BaseDatos, calleId: Id, nombre: string, o: { porId: Id; ahora?: string; motivo?: string }): BaseDatos {
  const c = db.calles[calleId];
  const i = (c?.alias ?? []).findIndex((x) => !x.retirado && x.nombre === nombre);
  if (!c || i < 0) throw new ErrorDominio('regla', 'Ese alias no está registrado.');
  const ahora = o.ahora ?? new Date().toISOString();
  return cambiarCalle(db, calleId, (x) => ({
    ...x, alias: x.alias!.map((a, k) => (k === i ? { ...a, retirado: { porId: o.porId, fecha: ahora, ...(o.motivo?.trim() ? { motivo: o.motivo.trim() } : {}) } } : a)),
    historial: [...(x.historial ?? []), { fecha: ahora, porId: o.porId, accion: 'alias-retirado', detalle: `Alias «${nombre}» retirado${o.motivo?.trim() ? `: ${o.motivo.trim()}` : ''}.` }],
  }));
}

// ───────────── Referencias de denominación del municipio ─────────────

/**
 * Referencias vigentes de un municipio. Si el municipio todavía no tiene la lista guardada (bases
 * anteriores a G3), las de partida del municipio (`REFERENCIAS_INICIALES`, datos con su fuente).
 */
export function referenciasDe(db: Pick<BaseDatos, 'municipios'>, municipioId: Id): ReferenciaDenominacion[] {
  const m = db.municipios[municipioId];
  const lista = (m?.callejero?.referencias ?? referenciasIniciales(municipioId)).map(redaccionActual);
  return lista.filter((r) => !r.retirada);
}
export const referenciasIniciales = (municipioId: Id): ReferenciaDenominacion[] => REFERENCIAS_INICIALES[municipioId.replace(/^(ensayo|real)-/, '')] ?? [];

/**
 * Una copia guardada de una referencia de partida con la redacción ANTERIOR (que la presentaba como
 * indicación de la Cátedra) se muestra con la redacción corregida. El dato guardado no se reescribe.
 */
function redaccionActual(r: ReferenciaDenominacion): ReferenciaDenominacion {
  const sup = REFERENCIAS_SUPERADAS.find((x) => x.denominacion === r.denominacion && x.fuente === r.fuente && x.nota === r.nota);
  const actual = sup && REFERENCIAS_INICIALES[sup.actual]?.find((x) => x.denominacion === r.denominacion);
  return actual ? { ...r, nota: actual.nota, fuente: actual.fuente, respaldo: actual.respaldo } : r;
}

function conReferencias(db: BaseDatos, municipioId: Id, f: (r: ReferenciaDenominacion[]) => ReferenciaDenominacion[]): BaseDatos {
  const m = db.municipios[municipioId];
  if (!m) throw new ErrorDominio('regla', 'El municipio no existe.');
  const actuales = (m.callejero?.referencias ?? referenciasIniciales(municipioId)).map(redaccionActual);
  return { ...db, municipios: { ...db.municipios, [municipioId]: { ...m, callejero: { ...(m.callejero ?? { estado: 'sin-callejero' }), referencias: f(actuales) } } } };
}

export function anadirReferencia(db: BaseDatos, municipioId: Id, r: Pick<ReferenciaDenominacion, 'denominacion' | 'oficial' | 'nota' | 'fuente' | 'respaldo'>, o: { porId: Id; ahora?: string }): BaseDatos {
  if (!db.personas[o.porId]) throw new ErrorDominio('regla', 'La referencia debe registrarla una persona.');
  const den = r.denominacion.trim();
  const of = r.oficial.trim();
  if (den.length < 2 || of.length < 2) throw new ErrorDominio('regla', 'Indique la denominación y el nombre oficial.');
  if (r.fuente.trim().length < 3) throw new ErrorDominio('regla', 'Indique la fuente de la referencia.');
  if (claveCalle(den) === claveCalle(of)) throw new ErrorDominio('regla', 'La denominación y el nombre oficial son el mismo.');
  if (referenciasDe(db, municipioId).some((x) => normalizar(x.denominacion) === normalizar(den))) throw new ErrorDominio('regla', `Ya hay una referencia para «${den}».`);
  const fecha = o.ahora ?? new Date().toISOString();
  return conReferencias(db, municipioId, (l) => [...l, { denominacion: den, oficial: of, nota: r.nota.trim(), fuente: r.fuente.trim(), respaldo: r.respaldo ?? 'pendiente', porId: o.porId, fecha }]);
}

export function retirarReferencia(db: BaseDatos, municipioId: Id, denominacion: string, o: { porId: Id; ahora?: string }): BaseDatos {
  if (!referenciasDe(db, municipioId).some((x) => x.denominacion === denominacion)) throw new ErrorDominio('regla', 'Esa referencia no está registrada.');
  const fecha = o.ahora ?? new Date().toISOString();
  return conReferencias(db, municipioId, (l) => l.map((x) => (x.denominacion === denominacion && !x.retirada ? { ...x, retirada: { porId: o.porId, fecha } } : x)));
}

// ───────────── Resumen ─────────────

export function resumenCallejero(db: BaseDatos, municipioId: Id) {
  const cs = callesDe(db, municipioId);
  const vig = cs.filter(calleVigente);
  const forma = (c: Calle) => c.forma ?? formaDe(c.segmentos);
  return {
    vias: vig.length,
    lineas: vig.filter((c) => forma(c) === 'linea').length,
    plazas: vig.filter((c) => forma(c) === 'area' || forma(c) === 'punto' || /^plaza\b/.test(normalizar(c.nombre))).length,
    sinGeometria: vig.filter((c) => forma(c) === 'sin-geometria').length,
    propuestas: cs.filter((c) => c.alta?.estado === 'propuesta').length,
    rechazadas: cs.filter((c) => c.alta?.estado === 'rechazada').length,
    manuales: vig.filter((c) => !!c.alta).length,
    alias: vig.reduce((a, c) => a + (c.alias ?? []).filter((x) => !x.retirado).length, 0),
    segmentos: vig.reduce((a, c) => a + c.segmentos.length, 0),
  };
}

/** Huella del contenido de una vía (para comprobar en pruebas que no ha cambiado). */
export const huellaCalle = (c: Calle) => sha256Texto(JSON.stringify(c));
