import { baseVacia, kCob, kNC, kRev, siguienteOrden, type BaseDatos } from '../domain/db';
import { ACTIVIDADES_HOJA, buscarActividadPorNombre, rutaActividad } from '../domain/taxonomy';
import { asignarCatalogos } from '../domain/migraciones';
import { centroide, desplazarPerpendicular, distanciaM, puntoEnLinea } from '../domain/geo';
import { claveCalle } from '../domain/text';
import { ordenarPorProximidad } from '../domain/planificacion';
import {
  confirmarSinCambios, finalizarCalle, marcarDudoso, marcarPosibleDesaparicion, modificarLocal, registrarLocalNuevo,
  registrarNuevoNegocio, registrarVacio, type Contexto,
} from '../domain/campo';
import { localesPrevios } from '../domain/consultas';
import type {
  Calle, Campana, Id, Itinerario, LngLat, LocalFisico, DatoDigital, RevisionDigital, Negocio, Observacion, Ocupacion, Persona, TramoPlan,
} from '../domain/types';
import { CALLES_DESDE_CERO_IT2, MEDINA, type FuenteCallejero } from './callejero';
import { CADENAS_FICTICIAS, nombreNegocio, nombresCallesFicticias } from './nombres';
import { crearRng, huella, type Rng } from './rng';

/**
 * Generador de la base de demostración. TODO lo que produce es FICTICIO salvo,
 * en su caso, la geometría y los nombres de las calles cuando proceden de OSM.
 */

export const PERSONAS: Persona[] = [
  { id: 'p-elena', nombre: 'Elena Ruiz', iniciales: 'ER', roles: ['administrador', 'coordinador'], color: '#021E4A' },
  { id: 'p-ana', nombre: 'Ana Prieto', iniciales: 'AP', roles: ['investigador'], color: '#0EA5A4' },
  { id: 'p-diego', nombre: 'Diego Martín', iniciales: 'DM', roles: ['investigador'], color: '#E8590C' },
  { id: 'p-lucia', nombre: 'Lucía Gómez', iniciales: 'LG', roles: ['investigador'], color: '#8B5CF6' },
  { id: 'p-pablo', nombre: 'Pablo Sanz', iniciales: 'PS', roles: ['investigador', 'revisor'], color: '#D6336C' },
  { id: 'p-marta', nombre: 'Marta Vidal', iniciales: 'MV', roles: ['revisor'], color: '#2F9E44' },
];

export const COLORES_IT = ['#0065FE', '#E8590C', '#7C3AED', '#0CA678', '#D6336C', '#F59F00', '#1098AD', '#5C7CFA'];

function actividadAleatoria(rng: Rng) {
  const r = rng.next();
  const grupo = r < 0.5 ? 'a1-comercio' : r < 0.8 ? 'a1-servicios' : 'a1-hosteleria';
  const hojas = ACTIVIDADES_HOJA.filter((h) => rutaActividad(h.id)[0].id === grupo);
  return rng.pick(hojas);
}

/** Revisión digital VERIFICADA ficticia de un negocio en una campaña ya cerrada. */
function metrica(rng: Rng, negocioId: Id, campanaId: Id, fecha: string, nivel: number): RevisionDigital {
  const tieneIg = rng.chance(0.35 + nivel * 0.1);
  const tieneGbp = rng.chance(0.55 + nivel * 0.1);
  const r = (b: boolean): DatoDigital => ({ respuesta: b ? 'si' : 'no', origen: 'importado', fecha });
  const num = (v: number): DatoDigital => ({ respuesta: 'si', valor: v, origen: 'importado', fecha });
  const na: DatoDigital = { respuesta: 'na', origen: 'importado', fecha };
  const numResenas = rng.int(2, 240);
  return {
    negocioId, campanaId, estado: 'verificada', verificadaEn: fecha, historial: [{ accion: 'verificar', fecha }],
    datos: {
      web: r(rng.chance(0.25 + nivel * 0.07)),
      ventaOnline: r(rng.chance(0.08 + nivel * 0.04)),
      googleBusiness: r(tieneGbp),
      valoracion: tieneGbp ? num(Math.round((3.4 + rng.next() * 1.5) * 10) / 10) : na,
      numResenas: tieneGbp ? num(numResenas) : na,
      respondeResenas: tieneGbp ? r(rng.chance(0.3)) : na,
      instagram: r(tieneIg),
      seguidoresInstagram: tieneIg ? num(rng.int(40, 4200)) : na,
      ...(() => {
        const fb = rng.chance(0.3);
        const tw = rng.chance(0.08);
        return {
          facebook: r(fb), seguidoresFacebook: fb ? num(rng.int(30, 3000)) : na,
          twitter: r(tw), seguidoresTwitter: tw ? num(rng.int(10, 900)) : na,
        };
      })(),
    },
  };
}

// ───────────────────────── Medina del Campo ─────────────────────────

interface SemillaMedina {
  calles: Calle[];
  fuente: FuenteCallejero;
  detalleFuente: string;
}

export function generarDemo(medina: SemillaMedina): BaseDatos {
  let db = baseVacia();
  db.personas = Object.fromEntries(PERSONAS.map((p) => [p.id, p]));
  db = generarMedina(db, medina);
  db = generarValladolid(db);
  // Las campañas de 2026 usan el catálogo oficial de clasificación (el 2025 sigue siendo ficticio).
  return asignarCatalogos(db).db;
}

function generarMedina(db0: BaseDatos, { calles, fuente, detalleFuente }: SemillaMedina): BaseDatos {
  let db = db0;
  const rng = crearRng('medina-demo-v3');
  const munId = MEDINA.id;
  db.municipios[munId] = {
    id: munId, nombre: 'Medina del Campo', provincia: 'Valladolid', centro: MEDINA.centro,
    fuenteCallejero: fuente === 'simulado' ? 'simulado' : 'osm',
    nota: 'Caso piloto. Locales, negocios, itinerarios y resultados de campo: FICTICIOS.',
  };
  db.meta.fuenteCallejero = fuente;
  db.meta.detalleCallejero = detalleFuente;
  for (const c of calles) db.calles[c.id] = c;

  const centro = MEDINA.centro;
  const centroCalle = (c: Calle) => centroide(c.segmentos.flatMap((s) => s.coords));
  const distC = (c: Calle) => distanciaM(centro, centroCalle(c));
  const desdeCero = new Set(CALLES_DESDE_CERO_IT2.map(claveCalle));
  const esDesdeCero = (c: Calle) => desdeCero.has(claveCalle(c.nombre));

  // ── Campaña 2025 (censo histórico importado) ──
  const c25: Campana = {
    id: 'camp-medina-2025', municipioId: munId, anio: 2025, nombre: 'Censo 2025', tipo: 'historico-importado',
    encargo: 'Ayuntamiento de Medina del Campo', periodo: { inicio: '2025-03-01', fin: '2025-11-30' },
    ambitoCalleIds: [], ampliacionCalleIds: [],
    estados: { planificacion: 'no-aplica', campo: 'terminado', revision: 'terminado', validacion: 'terminado' },
    procedencia: 'simulado',
  };

  // Calles con locales en 2025 (más probable cuanto más céntricas)
  const conLocales = calles.filter((c) => {
    if (esDesdeCero(c)) return false;
    const d = distC(c);
    const p = d < 350 ? 0.95 : d < 700 ? 0.72 : d < 1100 ? 0.4 : 0.1;
    return rng.chance(p);
  });
  const brutos = conLocales.map((c) => {
    const d = distC(c);
    const dens = 0.6 + 6.5 * Math.exp(-d / 420);
    return Math.max(1, Math.round((c.longitudM / 100) * dens * (0.6 + rng.next() * 0.7)));
  });
  const total = brutos.reduce((a, b) => a + b, 0);
  const escala = Math.min(1, 820 / total);

  const imp25 = 'imp-medina-2025';
  const archivo = 'censo_medina_2025.xlsx';
  let filaN = 1;

  conLocales.forEach((calle, ci) => {
    const n = Math.max(1, Math.round(brutos[ci] * escala));
    c25.ambitoCalleIds.push(calle.id);
    const ubic = ubicaciones(rng, calle, n);
    for (const u of ubic) {
      filaN++;
      const localId = `loc-med-${calle.id.slice(2, 14)}-${filaN}`;
      const vacio = rng.chance(0.2);
      const act = vacio ? undefined : actividadAleatoria(rng);
      const local: LocalFisico = {
        id: localId, municipioId: munId, direcciones: [{ calleId: calle.id, numero: u.numero, sufijo: u.sufijo }],
        coord: u.coord, estado: 'activo', procedencia: 'simulado',
      };
      db.locales[localId] = local;
      let negocio: Negocio | undefined;
      if (act) {
        negocio = {
          id: `neg-${localId}`, nombre: nombreNegocio(rng, act.nombre),
          cadena: rng.chance(0.07) ? rng.pick(CADENAS_FICTICIAS) : undefined, procedencia: 'simulado',
        };
        db.negocios[negocio.id] = negocio;
        db.clasificaciones[kNC(negocio.id, c25.id)] = { negocioId: negocio.id, campanaId: c25.id, actividadId: act.id, origen: 'importado', confirmada: true };
        if (rng.chance(0.62)) db.digital[kNC(negocio.id, c25.id)] = metrica(rng, negocio.id, c25.id, '2025-10-15', 0);
      }
      const metros = vacio ? rng.int(3, 14) : undefined;
      const regId = `reg-${imp25}-${filaN}`;
      const oc: Ocupacion = { id: `ocu-${localId}-25`, localId, negocioId: negocio?.id ?? null, metrosFachada: metros, desdeCampanaId: c25.id, desdeObservacionId: `obs-${regId}`, orden: siguienteOrden(db) };
      db.ocupaciones[oc.id] = oc;
      const ruta = rutaActividad(act?.id);
      const m = negocio ? db.digital[kNC(negocio.id, c25.id)] : undefined;
      const b01 = (v?: DatoDigital) => (v?.respuesta === 'si' ? '1' : v?.respuesta === 'no' ? '0' : '');
      db.registros[regId] = {
        id: regId, importacionId: imp25, fila: filaN,
        datos: {
          Calle: calle.nombre, 'Número': `${u.numero}${u.sufijo ? ' ' + u.sufijo : ''}`, Nombre: negocio?.nombre ?? '',
          Estado: vacio ? 'Vacío' : 'Ocupado', 'Metros fachada': metros ? String(metros) : '',
          'Grupo de actividad': ruta[0]?.nombre ?? '', 'Grupo de comercio': ruta[1]?.nombre ?? '',
          'Subgrupo de actividad': ruta[2]?.nombre ?? '', Actividad: ruta[3]?.nombre ?? '', Cadena: negocio?.cadena ?? '',
          web: b01(m?.datos.web), Instagram: b01(m?.datos.instagram), 'Seguidores IG': m?.datos.seguidoresInstagram?.valor !== undefined ? String(m.datos.seguidoresInstagram.valor) : '',
          'Reseñas Google': m?.datos.numResenas?.valor !== undefined ? String(m.datos.numResenas.valor) : '', 'Valoración': m?.datos.valoracion?.valor !== undefined ? String(m.datos.valoracion.valor) : '',
        },
      };
      const obs: Observacion = {
        id: `obs-${regId}`, campanaId: c25.id, localId, calleId: calle.id, registrado: '2026-02-10T10:00:00', orden: siguienteOrden(db), fuente: 'importacion', tipo: 'confirmado',
        datos: { numero: u.numero, sufijo: u.sufijo, nombre: negocio?.nombre, negocioId: negocio?.id ?? null, vacio, metrosFachada: metros }, verificacion: 'verificada',
      };
      db.observaciones[obs.id] = obs;
      db.vinculos[`vin-${regId}`] = {
        id: `vin-${regId}`, origen: { tipo: 'registro', id: regId }, localId, confianza: 'confirmada',
        criterio: 'Local físico creado a partir de esta fila en la importación inicial',
      };
      db.revisiones[kRev(c25.id, localId)] = { campanaId: c25.id, localId, campo: 'terminado', categorizacion: 'revisado', digital: 'revisado', validacion: 'aprobada' };
    }
  });

  // Filas del Excel que no casan con el callejero: quedan pendientes de relacionar, sin inventar nada.
  const calleErr = ['C/ Sto Domingo de Silos', 'Pza. Mayor (soportales)', 'Trav. del Almirante'];
  calleErr.forEach((t, i) => {
    filaN++;
    const regId = `reg-${imp25}-${filaN}`;
    db.registros[regId] = { id: regId, importacionId: imp25, fila: filaN, datos: { Calle: t, 'Número': String(3 + i * 4), Nombre: `Comercio ficticio ${i + 1}`, Estado: 'Ocupado' } };
    db.vinculos[`vin-${regId}`] = { id: `vin-${regId}`, origen: { tipo: 'registro', id: regId }, localId: null, confianza: 'sin-vinculo', criterio: 'Calle no encontrada en el callejero: pendiente de relacionar' };
  });

  db.importaciones[imp25] = {
    id: imp25, municipioId: munId, campanaId: c25.id, tipo: 'A-censo-historico', archivo, huella: huella(archivo + filaN),
    fecha: '2026-02-10', filas: filaN - 1, estado: 'confirmada', procedencia: 'simulado',
    resumen: { 'locales creados': filaN - 1 - calleErr.length, 'calles con registros': conLocales.length, 'filas sin calle reconocida': calleErr.length },
    nota: 'Representa la importación del Excel original de 2025 (que se conserva intacto). Contenido de la demo: FICTICIO.',
  };
  db.campanas[c25.id] = c25;

  // ── Campaña 2026 (actualización + ampliación) ──
  const sinRegistros = calles.filter((c) => !c25.ambitoCalleIds.includes(c.id));
  const ampliacion = [
    ...sinRegistros.filter(esDesdeCero),
    ...sinRegistros.filter((c) => !esDesdeCero(c)).sort((a, b) => distC(a) - distC(b)).slice(0, 12),
  ];
  const c26: Campana = {
    id: 'camp-medina-2026', municipioId: munId, anio: 2026, nombre: 'Censo 2026', tipo: 'mixto',
    encargo: 'Ayuntamiento de Medina del Campo', periodo: { inicio: '2026-06-01' },
    ambitoCalleIds: [...c25.ambitoCalleIds, ...ampliacion.map((c) => c.id)], ampliacionCalleIds: ampliacion.map((c) => c.id),
    campanaReferenciaId: c25.id, itinerariosPrevistos: 7,
    estados: { planificacion: 'en-curso', campo: 'en-curso', revision: 'pendiente', validacion: 'pendiente' },
    procedencia: 'simulado',
  };
  db.campanas[c26.id] = c26;

  // Sectores angulares equilibrados por carga → 7 itinerarios previstos; se dibujan 4.
  const ambito = c26.ambitoCalleIds.map((id) => db.calles[id]);
  const peso = (c: Calle) => localesPrevios(db, c25.id, c.id).length + c.longitudM / 120;
  const ang = (c: Calle) => {
    const p = centroCalle(c);
    return Math.atan2(p[1] - centro[1], p[0] - centro[0]);
  };
  const ordenadas = [...ambito].sort((a, b) => ang(a) - ang(b));
  const total26 = ordenadas.reduce((a, c) => a + peso(c), 0);
  const sectores: Calle[][] = [[]];
  let acum = 0;
  for (const c of ordenadas) {
    if (acum > (total26 / 7) * sectores.length && sectores.length < 7) sectores.push([]);
    sectores[sectores.length - 1].push(c);
    acum += peso(c);
  }
  const codigos = ['IT-A', 'IT-B', 'IT-C', 'IT-D'];
  const its: Itinerario[] = codigos.map((codigo, i) => {
    const sector = [...(sectores[i] ?? [])].sort((a, b) => distC(a) - distC(b));
    let tramos: TramoPlan[] = sector.map((c, k) => ({
      calleId: c.id, acera: 'ambas', orden: k + 1,
      etiqueta: c26.ampliacionCalleIds.includes(c.id) ? 'Censar desde cero' : undefined,
    }));
    tramos = ordenarPorProximidad(tramos, db.calles);
    return {
      id: `it-medina-26-${codigo.toLowerCase()}`, campanaId: c26.id, codigo, nombre: `Itinerario ${codigo.slice(3)} (demo)`,
      color: COLORES_IT[i], origen: 'app', tramos, asignadosIds: [], creado: '2026-05-20',
      escenarioDemo: 'Identificador y trazado de DEMOSTRACIÓN: no corresponde a ninguno de los itinerarios reales de My Maps.',
    };
  });
  // Garantiza que IT-A incluya alguna calle sin registros anteriores (escenarios 3 y 8)
  const itA = its[0];
  if (!itA.tramos.some((t) => c26.ampliacionCalleIds.includes(t.calleId))) {
    const libre = ampliacion.find((c) => !its.some((it) => it.tramos.some((t) => t.calleId === c.id)));
    if (libre) itA.tramos.push({ calleId: libre.id, acera: 'ambas', orden: itA.tramos.length + 1, etiqueta: 'Censar desde cero' });
  }
  its[0].asignadosIds = ['p-ana', 'p-diego'];
  its[1].asignadosIds = ['p-lucia'];
  its[2].asignadosIds = ['p-lucia', 'p-pablo'];
  its[3].asignadosIds = ['p-ana'];
  // Responsables por calle en IT-A (colaboración dentro del itinerario)
  const mitad = Math.ceil(itA.tramos.length / 2);
  itA.tramos = itA.tramos.map((t, k) => ({ ...t, responsableId: k < mitad ? 'p-ana' : 'p-diego' }));
  // Situación en IT-A: las calles sin registros, al final del tramo de Ana para la demo móvil
  for (const it of its) db.itinerarios[it.id] = it;
  db.meta.itCampoTerminado = its[2].id;
  db.meta.itEnCurso = its[0].id;

  // ── Resultados de campo SIMULADOS en IT-C (campo terminado, oficina pendiente) ──
  db = simularCampoCompleto(db, rng, its[2], c26, ['p-lucia', 'p-pablo']);
  // ── Progreso parcial SIMULADO en IT-A (dos investigadores) ──
  db = simularCampoParcial(db, rng, db.itinerarios[itA.id], c26);
  return db;
}

/** Distribuye n locales a lo largo de una calle, con numeración par/impar realista. */
function ubicaciones(rng: Rng, calle: Calle, n: number): { numero: number; sufijo?: string; coord?: LngLat }[] {
  const segs = calle.segmentos;
  const total = calle.longitudM || 1;
  const puntos: { s: number; t: number; lado: 'par' | 'impar' }[] = [];
  for (let i = 0; i < n; i++) {
    let r = rng.next() * total;
    let s = 0;
    while (s < segs.length - 1 && r > segs[s].longitudM) r -= segs[s++].longitudM;
    puntos.push({ s, t: segs[s] ? r / (segs[s].longitudM || 1) : 0, lado: rng.chance(0.5) ? 'par' : 'impar' });
  }
  puntos.sort((a, b) => a.s - b.s || a.t - b.t);
  const sig = { par: 0, impar: -1 };
  return puntos.map((p, i) => {
    const anterior = i > 0 && puntos[i - 1].lado === p.lado;
    const repetir = anterior && rng.chance(0.03);
    if (!repetir) sig[p.lado] += 2 * rng.int(1, 3);
    const numero = sig[p.lado];
    let coord: LngLat | undefined;
    const seg = segs[p.s];
    if (seg) {
      const { p: q, dir } = puntoEnLinea(seg.coords, p.t);
      coord = desplazarPerpendicular(q, dir, p.lado === 'par' ? -9 : 9);
      coord = [Math.round(coord[0] * 1e6) / 1e6, Math.round(coord[1] * 1e6) / 1e6];
    }
    return { numero, sufijo: repetir ? (rng.chance(0.5) ? 'B' : undefined) : undefined, coord };
  });
}

function fechaDemo(dia: number, hora: number): string {
  return `2026-09-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:${String((dia * 7 + hora * 13) % 60).padStart(2, '0')}:00`;
}

function simularCalle(db0: BaseDatos, rng: Rng, ctx: Contexto, calleId: Id, opciones: { dudosoForzado?: boolean; historicoForzado?: boolean } = {}): BaseDatos {
  let db = db0;
  const camp = db.campanas[ctx.campanaId];
  const previos = localesPrevios(db, camp.campanaReferenciaId, calleId);
  // Escenario de conciliación dudosa: alta en campo con el mismo número que un local anterior.
  if (opciones.dudosoForzado && previos.length > 2) {
    const victima = previos[Math.floor(previos.length / 2)];
    const d = victima.direcciones[victima.direcciones.length - 1];
    const act = actividadAleatoria(rng);
    db = registrarLocalNuevo(db, ctx, { calleId, numero: d.numero, sufijo: 'B', vacio: false, nombre: nombreNegocio(rng, act.nombre), coord: victima.coord }).db;
    db = marcarPosibleDesaparicion(db, ctx, victima.id, 'No se localiza el rótulo anterior; hay un negocio nuevo en el mismo portal');
  }
  for (const l of previos) {
    if (Object.values(db.observaciones).some((o) => o.localId === l.id && o.campanaId === ctx.campanaId)) continue;
    const oc = Object.values(db.ocupaciones).find((o) => o.localId === l.id && !o.hastaCampanaId);
    const r = rng.next();
    if (opciones.historicoForzado && !oc?.negocioId) {
      db = registrarNuevoNegocio(db, ctx, l.id, nombreNegocio(rng, 'Peluquería'));
      db.meta = { ...db.meta, localHistoricoMedina: l.id };
      opciones.historicoForzado = false;
    } else if (r < 0.72) db = confirmarSinCambios(db, ctx, l.id);
    else if (r < 0.8 && oc?.negocioId) db = modificarLocal(db, ctx, l.id, { nombre: db.negocios[oc.negocioId].nombre + ' II', nota: 'Rótulo actualizado' });
    else if (r < 0.87) db = registrarVacio(db, ctx, l.id, rng.int(3, 12));
    else if (r < 0.93) db = registrarNuevoNegocio(db, ctx, l.id, nombreNegocio(rng, actividadAleatoria(rng).nombre));
    else if (r < 0.96) db = marcarPosibleDesaparicion(db, ctx, l.id, 'Fachada tapiada; posible unión con el local contiguo');
    else db = marcarDudoso(db, ctx, l.id, 'Persiana bajada en las dos visitas; no se puede confirmar actividad');
  }
  // Locales nuevos
  const nNuevos = previos.length ? (rng.chance(0.45) ? rng.int(1, 2) : 0) : rng.chance(0.55) ? rng.int(1, 3) : 0;
  let ultimo = previos.length ? Math.max(...previos.map((l) => l.direcciones[l.direcciones.length - 1].numero ?? 0)) : rng.int(1, 6);
  const calle = db.calles[calleId];
  for (let k = 0; k < nNuevos; k++) {
    ultimo += 2;
    const vacio = rng.chance(0.25);
    const act = actividadAleatoria(rng);
    const { p, dir } = puntoEnLinea(calle.segmentos[k % calle.segmentos.length]?.coords ?? [[0, 0]], rng.next());
    db = registrarLocalNuevo(db, ctx, {
      calleId, numero: ultimo, vacio, nombre: vacio ? undefined : nombreNegocio(rng, act.nombre),
      metrosFachada: vacio ? rng.int(3, 10) : undefined, coord: desplazarPerpendicular(p, dir, ultimo % 2 ? 9 : -9),
    }).db;
  }
  return db;
}

function simularCampoCompleto(db0: BaseDatos, rng: Rng, it: Itinerario, camp: Campana, investigadores: Id[]): BaseDatos {
  let db = db0;
  let historico = true;
  it.tramos.forEach((t, k) => {
    const inv = investigadores[k % investigadores.length];
    const ctx: Contexto = { campanaId: camp.id, investigadorId: inv, fecha: fechaDemo(8 + Math.floor((k * 10) / it.tramos.length), 9 + (k % 5)) };
    const tieneVacio = localesPrevios(db, camp.campanaReferenciaId, t.calleId).some((l) => !Object.values(db.ocupaciones).find((o) => o.localId === l.id && !o.hastaCampanaId)?.negocioId);
    db = simularCalle(db, rng, ctx, t.calleId, { dudosoForzado: k === 1 || k === 4, historicoForzado: historico && tieneVacio });
    if (historico && tieneVacio && db.meta.localHistoricoMedina) historico = false;
    const parcial = k === Math.min(3, it.tramos.length - 1);
    const conLocales = Object.values(db.observaciones).some((o) => o.campanaId === camp.id && o.calleId === t.calleId && o.tipo !== 'posible-desaparicion');
    db = finalizarCalle(db, ctx, t.calleId, {
      par: true, impar: !parcial, resultado: parcial ? 'parcial-incidencias' : conLocales ? 'completada-con-locales' : 'completada-sin-locales',
      nota: parcial ? 'Obras en la acera impar: sin acceso a tres portales' : undefined,
    });
  });
  // Las observaciones de campo quedan "verificadas" en cuanto a campo; la oficina sigue pendiente.
  return db;
}

function simularCampoParcial(db0: BaseDatos, rng: Rng, it: Itinerario, camp: Campana): BaseDatos {
  let db = db0;
  const ana = it.tramos.filter((t) => t.responsableId === 'p-ana');
  const diego = it.tramos.filter((t) => t.responsableId === 'p-diego');
  // Ana: 3 calles con registros previos terminadas. Las de ampliación quedan para la demo móvil.
  const anaHechas = ana.filter((t) => !camp.ampliacionCalleIds.includes(t.calleId)).slice(0, 3);
  anaHechas.forEach((t, k) => {
    const ctx: Contexto = { campanaId: camp.id, investigadorId: 'p-ana', fecha: fechaDemo(22 + k, 10) };
    db = simularCalle(db, rng, ctx, t.calleId);
    db = finalizarCalle(db, ctx, t.calleId, { par: true, impar: true, resultado: 'completada-con-locales' });
  });
  // Diego: 2 terminadas y 1 en curso (con su trabajo aún sin sincronizar)
  diego.slice(0, 3).forEach((t, k) => {
    const ctx: Contexto = { campanaId: camp.id, investigadorId: 'p-diego', fecha: fechaDemo(23 + k, 11), sinConexion: k === 2 };
    if (k < 2) {
      db = simularCalle(db, rng, ctx, t.calleId);
      const conLocales = Object.values(db.observaciones).some((o) => o.campanaId === camp.id && o.calleId === t.calleId);
      db = finalizarCalle(db, ctx, t.calleId, { par: true, impar: true, resultado: conLocales ? 'completada-con-locales' : 'completada-sin-locales' });
    } else {
      const previos = localesPrevios(db, camp.campanaReferenciaId, t.calleId).slice(0, 3);
      for (const l of previos) db = confirmarSinCambios(db, ctx, l.id);
      if (previos[0]) {
        db.colaSync = [
          ...db.colaSync,
          {
            id: 'sync-conflicto-demo', descripcion: `Conflicto · ${db.calles[t.calleId].nombre} ${previos[0].direcciones[0].numero}`,
            creado: fechaDemo(25, 12), estado: 'conflicto',
            conflicto: { con: 'Ana Prieto (también sin conexión)', detalle: 'Ana registró el local como «Vacío»; Diego lo confirmó «Sin cambios». Requiere decisión.' },
          },
        ];
      }
    }
  });
  db.meta = { ...db.meta, investigadorMovil: 'p-ana' };
  return db;
}

// ───────────────────────── Valladolid (demo de volumen) ─────────────────────────

function generarValladolid(db: BaseDatos): BaseDatos {
  const rng = crearRng('valladolid-volumen-v3');
  const munId = 'mun-valladolid';
  db.municipios[munId] = {
    id: munId, nombre: 'Valladolid', provincia: 'Valladolid', centro: [-4.7245, 41.6523], fuenteCallejero: 'sin-geometria',
    nota: 'Municipio de DEMOSTRACIÓN DE VOLUMEN: calles, locales y campañas ficticios, sin geometría.',
  };
  const nombres = nombresCallesFicticias(130);
  const calles: Calle[] = nombres.map((nombre, i) => ({
    id: `c-vll-${i}`, municipioId: munId, nombre, tipoVia: nombre.split(' ')[0], segmentos: [],
    longitudM: rng.int(150, 900), procedencia: 'simulado', refsFuente: [],
  }));
  for (const c of calles) db.calles[c.id] = c;
  const tramosAmbito = [calles.slice(0, 60), calles.slice(0, 90), calles.slice(0, 130)];
  const anios = [2023, 2024, 2025];
  const camps: Campana[] = anios.map((anio, i) => ({
    id: `camp-vll-${anio}`, municipioId: munId, anio, nombre: `Censo ${anio}`, tipo: i === 0 ? 'nuevo' : 'mixto',
    encargo: 'Encargo ficticio', periodo: { inicio: `${anio}-04-01`, fin: `${anio}-12-15` },
    ambitoCalleIds: tramosAmbito[i].map((c) => c.id),
    ampliacionCalleIds: i === 0 ? [] : tramosAmbito[i].slice(tramosAmbito[i - 1].length).map((c) => c.id),
    campanaReferenciaId: i === 0 ? undefined : `camp-vll-${anios[i - 1]}`,
    estados: { planificacion: 'terminado', campo: 'terminado', revision: 'terminado', validacion: 'terminado' },
    procedencia: 'simulado',
  }));
  for (const c of camps) db.campanas[c.id] = c;

  let nl = 0;
  const nuevoLocal = (calle: Calle, numero: number, campIdx: number): LocalFisico => {
    const id = `loc-vll-${nl++}`;
    const l: LocalFisico = { id, municipioId: munId, direcciones: [{ calleId: calle.id, numero }], estado: 'activo', procedencia: 'simulado' };
    db.locales[id] = l;
    void campIdx;
    return l;
  };
  const nuevoNegocio = (actNombre?: string): Negocio => {
    const act = actNombre ? buscarActividadPorNombre(actNombre)! : actividadAleatoria(rng);
    const n: Negocio = { id: `neg-vll-${nl}-${rng.int(0, 1e6)}`, nombre: nombreNegocio(rng, act.nombre), procedencia: 'simulado', cadena: rng.chance(0.08) ? rng.pick(CADENAS_FICTICIAS) : undefined };
    db.negocios[n.id] = n;
    actividadDe.set(n.id, act.id);
    return n;
  };
  const estadoLocal = new Map<Id, { negocioId: Id | null; ocId: Id; metros?: number }>();
  const actividadDe = new Map<Id, Id>();
  const obs = (camp: Campana, l: LocalFisico, tipo: Observacion['tipo'], negocioId: Id | null, metros?: number) => {
    const d = l.direcciones[0];
    const o: Observacion = {
      id: `obs-vll-${l.id}-${camp.anio}`, campanaId: camp.id, localId: l.id, calleId: d.calleId, fecha: `${camp.anio}-10-01`, orden: siguienteOrden(db),
      fuente: camp.anio === 2023 ? 'papel' : 'campo-app', tipo, verificacion: 'verificada',
      datos: { numero: d.numero, nombre: negocioId ? db.negocios[negocioId].nombre : undefined, negocioId, vacio: !negocioId, metrosFachada: metros },
    };
    db.observaciones[o.id] = o;
    if (negocioId) db.clasificaciones[kNC(negocioId, camp.id)] = { negocioId, campanaId: camp.id, actividadId: actividadDe.get(negocioId)!, origen: 'manual', confirmada: true };
    db.revisiones[kRev(camp.id, l.id)] = { campanaId: camp.id, localId: l.id, campo: 'terminado', categorizacion: 'revisado', digital: 'revisado', validacion: 'aprobada' };
    if (negocioId && rng.chance(0.5 + (camp.anio - 2023) * 0.1)) {
      db.digital[kNC(negocioId, camp.id)] = metrica(rng, negocioId, camp.id, `${camp.anio}-10-20`, camp.anio - 2023);
    }
  };
  const abrirOcupacion = (l: LocalFisico, negocioId: Id | null, camp: Campana, metros?: number) => {
    const id = `ocu-${l.id}-${camp.anio}`;
    db.ocupaciones[id] = { id, localId: l.id, negocioId, metrosFachada: metros, desdeCampanaId: camp.id, orden: siguienteOrden(db) };
    estadoLocal.set(l.id, { negocioId, ocId: id, metros });
  };
  const cerrar = (l: LocalFisico, hasta: Campana) => {
    const e = estadoLocal.get(l.id);
    if (e) db.ocupaciones[e.ocId] = { ...db.ocupaciones[e.ocId], hastaCampanaId: hasta.id };
  };

  // Local con historia completa: zapatería 2023 → vacío 2024 → peluquería 2025
  let historico: LocalFisico | undefined;

  camps.forEach((camp, ci) => {
    const prev = ci > 0 ? camps[ci - 1] : undefined;
    for (const calle of tramosAmbito[ci]) {
      const esNueva = !prev || !prev.ambitoCalleIds.includes(calle.id);
      if (esNueva) {
        const n = Math.round((calle.longitudM / 100) * (5 + rng.next() * 4));
        let num = 0;
        for (let k = 0; k < n; k++) {
          num += rng.int(1, 2);
          const l = nuevoLocal(calle, num, ci);
          const vacio = rng.chance(0.17);
          const neg = vacio ? null : nuevoNegocio(!historico && ci === 0 ? 'Zapatería' : undefined);
          if (!historico && ci === 0 && neg) historico = l;
          const metros = vacio ? rng.int(3, 14) : undefined;
          abrirOcupacion(l, neg?.id ?? null, camp, metros);
          obs(camp, l, 'confirmado', neg?.id ?? null, metros);
        }
        continue;
      }
      // Actualización de una calle ya censada
      const locales = Object.values(db.locales).filter((l) => l.direcciones[0].calleId === calle.id && estadoLocal.has(l.id) && l.estado === 'activo');
      for (const l of locales) {
        const e = estadoLocal.get(l.id)!;
        const r = rng.next();
        if (l === historico) {
          cerrar(l, prev!);
          if (ci === 1) {
            abrirOcupacion(l, null, camp, 7);
            obs(camp, l, 'vacio', null, 7);
          } else {
            const n = nuevoNegocio('Peluquería');
            abrirOcupacion(l, n.id, camp);
            obs(camp, l, 'nuevo-negocio', n.id);
          }
          continue;
        }
        if (r < 0.012) continue; // no observado: queda indeterminado (nunca se interpreta como cierre)
        if (e.negocioId === null) {
          if (r < 0.26) {
            cerrar(l, prev!);
            const n = nuevoNegocio();
            abrirOcupacion(l, n.id, camp);
            obs(camp, l, 'nuevo-negocio', n.id);
          } else obs(camp, l, 'confirmado', null, e.metros);
        } else if (r < 0.07) {
          cerrar(l, prev!);
          const m = rng.int(3, 12);
          abrirOcupacion(l, null, camp, m);
          obs(camp, l, 'vacio', null, m);
        } else if (r < 0.12) {
          cerrar(l, prev!);
          const n = nuevoNegocio();
          abrirOcupacion(l, n.id, camp);
          obs(camp, l, 'nuevo-negocio', n.id);
        } else obs(camp, l, 'confirmado', e.negocioId);
      }
      // Altas en calles ya censadas: algunas confirmadas, otras dudosas
      const nAltas = rng.chance(0.5) ? rng.int(1, 2) : 0;
      for (let k = 0; k < nAltas; k++) {
        const maxN = Math.max(0, ...locales.map((l) => l.direcciones[0].numero ?? 0));
        const l = nuevoLocal(calle, maxN + 2 + k * 2, ci);
        const n = nuevoNegocio();
        abrirOcupacion(l, n.id, camp);
        obs(camp, l, 'nuevo-local', n.id);
        const dudosa = rng.chance(0.3);
        const cand = locales[locales.length - 1];
        db.vinculos[`vin-vll-${l.id}`] = {
          id: `vin-vll-${l.id}`, origen: { tipo: 'observacion', id: `obs-vll-${l.id}-${camp.anio}` }, localId: l.id,
          confianza: dudosa ? 'sin-vinculo' : 'confirmada',
          criterio: dudosa ? 'Posible continuidad con el último local de la calle: sin evidencia suficiente, queda indeterminado' : 'Revisado: local nuevo distinto de los anteriores',
          candidatos: dudosa && cand ? [{ localId: cand.id, puntuacion: 0.5, motivo: 'número contiguo' }] : undefined,
        };
      }
    }
  });
  for (const c of camps) {
    db.importaciones[`imp-vll-${c.anio}`] = {
      id: `imp-vll-${c.anio}`, municipioId: munId, campanaId: c.id, tipo: 'A-censo-historico', archivo: `censo_valladolid_${c.anio}.xlsx`,
      huella: huella(`vll${c.anio}`), fecha: `${c.anio}-12-20`, filas: Object.values(db.observaciones).filter((o) => o.campanaId === c.id).length,
      estado: 'confirmada', procedencia: 'simulado', resumen: {}, nota: 'Demo de volumen: las filas originales no se incluyen en el prototipo.',
    };
  }
  if (historico) db.meta.localHistoricoValladolid = historico.id;
  // cobertura: todas completadas
  for (const c of camps) for (const id of c.ambitoCalleIds) {
    db.coberturas[kCob(c.id, id, 'ambas')] = { campanaId: c.id, calleId: id, acera: 'ambas', estado: 'completada-con-locales', fecha: `${c.anio}-10-30` };
  }
  return db;
}
