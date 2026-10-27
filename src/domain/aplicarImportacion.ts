import type { BaseDatos } from './db';
import type { Alcance } from './bloqueo';
import { kNC, kRev, nuevoId, siguienteOrden } from './db';
import { confirmarSinCambios, registrarLocalNuevo, registrarNuevoNegocio, registrarVacio, type Contexto } from './campo';
import type { FilaDiff } from './importacion';
import { buscarActividadPorNombre } from './taxonomy';
import { puntoEnLinea, desplazarPerpendicular } from './geo';
import { huella } from '../data/rng';
import type { Campana, Id, Importacion, LngLat } from './types';

function coordAproximada(db: BaseDatos, calleId: Id, numero: number | null): LngLat | undefined {
  const c = db.calles[calleId];
  const seg = c?.segmentos.slice().sort((a, b) => b.longitudM - a.longitudM)[0];
  if (!seg) return undefined;
  const t = numero ? Math.min(0.95, (numero % 60) / 60 + 0.02) : 0.5;
  const { p, dir } = puntoEnLinea(seg.coords, t);
  return desplazarPerpendicular(p, dir, (numero ?? 1) % 2 ? 9 : -9);
}

/**
 * C/D · Aplica un Excel de itinerario (resultados de campo pasados a limpio) a la campaña.
 * Solo se aplican filas «nuevo», «modificado» y «sin cambios»; el resto se conserva sin tocar nada.
 */
export function aplicarResultadosPapel(
  db0: BaseDatos, campanaId: Id, filas: FilaDiff[], archivo: string, tipo: Importacion['tipo'], porId: Id, opciones: { alcance?: Alcance } = {},
): { db: BaseDatos; resumen: Record<string, number> } {
  let db = db0;
  const impId = nuevoId('imp');
  // Si una operación se rechaza (bloqueo o alcance) se lanza la excepción y no se aplica NADA:
  // todas las operaciones son puras y el resultado parcial se descarta.
  const base: Contexto = { campanaId, investigadorId: porId, fuente: 'papel', alcance: opciones.alcance };
  const resumen: Record<string, number> = {};
  const registros = { ...db.registros };
  for (const f of filas) {
    resumen[f.clase] = (resumen[f.clase] ?? 0) + 1;
    const regId = `reg-${impId}-${f.fila}`;
    registros[regId] = { id: regId, importacionId: impId, fila: f.fila, datos: f.bruto };
    if (!f.calleId) continue;
    // Fecha real de la visita si consta en el archivo; si no, queda sin fecha (no se inventa) y,
    // si hay otros cambios en la campaña, la cronología queda «incierta» para la oficina.
    const ctx: Contexto = { ...base, fecha: f.fecha };
    if (f.clase === 'sin-cambios' && f.localId) db = confirmarSinCambios(db, ctx, f.localId);
    else if (f.clase === 'modificado' && f.localId) db = f.vacio ? registrarVacio(db, ctx, f.localId, f.metros) : registrarNuevoNegocio(db, ctx, f.localId, f.nombre ?? '');
    else if (f.clase === 'ambiguo') db = registrarAmbiguo(db, ctx, f);
    else if (f.clase === 'nuevo') db = registrarLocalNuevo(db, ctx, { calleId: f.calleId, numero: f.numero, sufijo: f.sufijo, vacio: f.vacio, nombre: f.nombre, metrosFachada: f.metros, coord: coordAproximada(db, f.calleId, f.numero) }).db;
  }
  db = { ...db, registros: { ...registros, ...db.registros } };
  db.importaciones = {
    ...db.importaciones,
    [impId]: { id: impId, municipioId: db.campanas[campanaId].municipioId, campanaId, tipo, archivo, huella: huella(archivo + filas.length), fecha: new Date().toISOString(), filas: filas.length, estado: 'confirmada', procedencia: 'importado', resumen },
  };
  return { db, resumen };
}

/**
 * Fila que podría corresponder a varios locales de la misma dirección: se registra como alta
 * con un vínculo «dudoso» y sus candidatos, para que la oficina decida en Conciliación.
 * Nunca se elige automáticamente el primero.
 */
function registrarAmbiguo(db0: BaseDatos, ctx: Contexto, f: FilaDiff): BaseDatos {
  const r = registrarLocalNuevo(db0, ctx, { calleId: f.calleId!, numero: f.numero, sufijo: f.sufijo, vacio: f.vacio, nombre: f.nombre, metrosFachada: f.metros, coord: coordAproximada(db0, f.calleId!, f.numero) });
  const db = r.db;
  const obs = Object.values(db.observaciones).find((o) => o.localId === r.localId)!;
  const existente = Object.values(db.vinculos).find((v) => v.localId === r.localId);
  const id = existente?.id ?? nuevoId('vin');
  db.vinculos = {
    ...db.vinculos,
    [id]: {
      id, origen: { tipo: 'observacion', id: obs.id }, localId: r.localId, confianza: 'dudosa',
      criterio: 'Varios locales en la misma dirección: correspondencia ambigua, pendiente de conciliación',
      candidatos: (f.candidatos ?? []).map((localId) => ({ localId, puntuacion: 0.5, motivo: 'misma dirección' })),
    },
  };
  db.revisiones = { ...db.revisiones, [kRev(ctx.campanaId, r.localId)]: { ...db.revisiones[kRev(ctx.campanaId, r.localId)], pendienteComprobacion: true } };
  return db;
}

/**
 * A · Censo histórico completo: crea una campaña histórica con sus locales,
 * conservando cada fila como registro de origen. No inventa correspondencias con otras campañas.
 */
export function importarCensoHistorico(db0: BaseDatos, municipioId: Id, anio: number, nombre: string, filas: FilaDiff[], archivo: string): { db: BaseDatos; campanaId: Id } {
  const db: BaseDatos = { ...db0, locales: { ...db0.locales }, negocios: { ...db0.negocios }, ocupaciones: { ...db0.ocupaciones }, observaciones: { ...db0.observaciones }, registros: { ...db0.registros }, vinculos: { ...db0.vinculos }, revisiones: { ...db0.revisiones } };
  const impId = nuevoId('imp');
  const campanaId = nuevoId('camp');
  const ambito = new Set<Id>();
  const resumen: Record<string, number> = { 'locales creados': 0, 'filas sin calle reconocida': 0 };
  for (const f of filas) {
    const regId = `reg-${impId}-${f.fila}`;
    db.registros[regId] = { id: regId, importacionId: impId, fila: f.fila, datos: f.bruto };
    if (!f.calleId) {
      resumen['filas sin calle reconocida']++;
      db.vinculos[`vin-${regId}`] = { id: `vin-${regId}`, origen: { tipo: 'registro', id: regId }, localId: null, confianza: 'sin-vinculo', criterio: 'Calle no encontrada en el callejero: pendiente de relacionar' };
      continue;
    }
    ambito.add(f.calleId);
    const localId = `loc-${impId}-${f.fila}`;
    db.locales[localId] = { id: localId, municipioId, direcciones: [{ calleId: f.calleId, numero: f.numero, sufijo: f.sufijo }], coord: coordAproximada(db, f.calleId, f.numero), estado: 'activo', procedencia: 'importado' };
    let negocioId: Id | null = null;
    if (!f.vacio && f.nombre) {
      negocioId = `neg-${localId}`;
      db.negocios[negocioId] = { id: negocioId, nombre: f.nombre, procedencia: 'importado' };
      const act = f.actividad ? buscarActividadPorNombre(f.actividad)?.id : undefined;
      // La clasificación del archivo se conserva como «importada», sin darla por revisada.
      if (act) db.clasificaciones = { ...db.clasificaciones, [kNC(negocioId, campanaId)]: { negocioId, campanaId, actividadId: act, origen: 'importado', confirmada: false } };
    }
    const orden = siguienteOrden(db);
    db.observaciones[`obs-${regId}`] = { id: `obs-${regId}`, campanaId, localId, calleId: f.calleId, registrado: new Date().toISOString(), orden, fuente: 'importacion', tipo: 'confirmado', datos: { numero: f.numero, sufijo: f.sufijo, nombre: f.nombre, negocioId, vacio: f.vacio, metrosFachada: f.metros }, verificacion: 'verificada' };
    db.ocupaciones[`ocu-${localId}`] = { id: `ocu-${localId}`, localId, negocioId, metrosFachada: f.metros, desdeCampanaId: campanaId, desdeObservacionId: `obs-${regId}`, orden: siguienteOrden(db) };
    db.vinculos[`vin-${regId}`] = { id: `vin-${regId}`, origen: { tipo: 'registro', id: regId }, localId, confianza: 'confirmada', criterio: 'Local físico creado a partir de esta fila' };
    db.revisiones[kRev(campanaId, localId)] = { campanaId, localId, campo: 'terminado', categorizacion: 'pendiente', digital: 'pendiente', validacion: 'pendiente' };
    resumen['locales creados']++;
  }
  const camp: Campana = {
    id: campanaId, municipioId, anio, nombre, tipo: 'historico-importado', periodo: { inicio: `${anio}-01-01`, fin: `${anio}-12-31` },
    ambitoCalleIds: [...ambito], ampliacionCalleIds: [], estados: { planificacion: 'no-aplica', campo: 'terminado', revision: 'en-curso', validacion: 'pendiente' }, procedencia: 'importado',
  };
  db.campanas = { ...db.campanas, [campanaId]: camp };
  db.importaciones = { ...db.importaciones, [impId]: { id: impId, municipioId, campanaId, tipo: 'A-censo-historico', archivo, huella: huella(archivo + filas.length), fecha: new Date().toISOString(), filas: filas.length, estado: 'confirmada', procedencia: 'importado', resumen, nota: 'Archivo original conservado como registros de origen inmutables.' } };
  return { db, campanaId };
}
