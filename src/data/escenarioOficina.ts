import { baseVacia, kCob, kNC, kRev, type BaseDatos } from '../domain/db';
import { registrarVacio } from '../domain/campo';
import { longitudLinea } from '../domain/geo';
import { ACTIVIDADES_HOJA } from '../domain/taxonomy';
import { ID_CATALOGO_2026 } from '../domain/catalogo2026';
import type { Calle, Campana, Id, Itinerario, LngLat, TramoPlan } from '../domain/types';

/**
 * Escenario SINTÉTICO de Oficina para pruebas y demostración. Todo es inventado: municipio,
 * calles, negocios y personas ficticios; ningún dato procede de un censo real.
 *
 * Construye directamente (sin pasar por las operaciones de campo) para poder generar miles de
 * registros en pocos milisegundos.
 */

export const MUN_SINT = 'mun-sintetico';
export const C25_SINT = 'camp-sint-2025';
export const C26_SINT = 'camp-sint-2026';

export interface OpcionesEscenario {
  calles: number;
  localesPorCalle: number;
  /** Fracción de locales de cada itinerario ya visitados en 2026 (0..1) por índice de itinerario. */
  visitados?: (indiceItinerario: number) => number;
  /** Calles por itinerario en la parte «masiva». */
  callesPorItinerario?: number;
}

export interface Escenario {
  db: BaseDatos;
  /** Calle repartida: pares en IT-1 e impares en IT-2. */
  calleRepartida: Id;
  /** Calle repartida por segmentos: primer segmento en IT-1, segundo en IT-2. */
  calleSegmentos: Id;
  /** Calle sin locales, recorrida y cerrada como «completada sin locales» en IT-2. */
  calleSinLocales: Id;
  itinerarios: Id[];
}

function calleRecta(id: Id, nombre: string, origen: LngLat, longitudGrados = 0.004): Calle {
  const medio: LngLat = [origen[0] + longitudGrados / 2, origen[1]];
  const fin: LngLat = [origen[0] + longitudGrados, origen[1]];
  const s1 = { id: `${id}-s1`, coords: [origen, medio], longitudM: longitudLinea([origen, medio]) };
  const s2 = { id: `${id}-s2`, coords: [medio, fin], longitudM: longitudLinea([medio, fin]) };
  return { id, municipioId: MUN_SINT, nombre, tipoVia: 'Calle', segmentos: [s1, s2], longitudM: s1.longitudM + s2.longitudM, procedencia: 'simulado', refsFuente: ['escenario sintético'] };
}

const NOMBRES = ['Bar', 'Panadería', 'Farmacia', 'Peluquería', 'Ferretería', 'Librería', 'Frutería', 'Óptica', 'Floristería', 'Zapatería'];
const APELLIDOS = ['Alfa', 'Beta', 'Gamma', 'Delta', 'Épsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu'];

/** Añade una calle con locales de 2025 (todos con observación en la campaña de referencia). */
function poblarCalle(db: BaseDatos, calle: Calle, n: number, semilla: number) {
  db.calles[calle.id] = calle;
  const [a, b] = [calle.segmentos[0].coords[0], calle.segmentos[1].coords[1]];
  for (let i = 1; i <= n; i++) {
    const numero = i;
    const t = (Math.ceil(i / 2) - 0.3) / Math.ceil(n / 2); // nunca justo en el punto medio
    const coord: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (i % 2 ? 0.00008 : -0.00008)];
    const localId = `loc-${calle.id}-${i}`;
    db.locales[localId] = { id: localId, municipioId: MUN_SINT, direcciones: [{ calleId: calle.id, numero }], coord, estado: 'activo', procedencia: 'simulado' };
    const vacio = (i + semilla) % 7 === 0;
    let negocioId: Id | null = null;
    if (!vacio) {
      negocioId = `neg-${calle.id}-${i}`;
      const nombre = `${NOMBRES[(i + semilla) % NOMBRES.length]} ${APELLIDOS[(i * 7 + semilla) % APELLIDOS.length]} ${calle.nombre.split(' ').pop()}-${i}`;
      db.negocios[negocioId] = { id: negocioId, nombre, procedencia: 'simulado', cadena: (i + semilla) % 11 === 0 ? 'Cadena Ficticia' : undefined };
      const act = ACTIVIDADES_HOJA[(i * 13 + semilla) % ACTIVIDADES_HOJA.length];
      db.clasificaciones[kNC(negocioId, C25_SINT)] = { negocioId, campanaId: C25_SINT, actividadId: act.id, origen: 'importado', confirmada: true };
    }
    const obsId = `obs25-${localId}`;
    db.secuencia++;
    db.observaciones[obsId] = {
      id: obsId, campanaId: C25_SINT, localId, calleId: calle.id, fuente: 'importacion', tipo: 'confirmado', orden: db.secuencia,
      datos: { numero, negocioId, nombre: negocioId ? db.negocios[negocioId].nombre : undefined, vacio, metrosFachada: vacio ? 5 : undefined }, verificacion: 'verificada',
    };
    db.secuencia++;
    db.ocupaciones[`ocu-${localId}`] = { id: `ocu-${localId}`, localId, negocioId, desdeCampanaId: C25_SINT, desdeObservacionId: obsId, metrosFachada: vacio ? 5 : undefined, orden: db.secuencia };
  }
}

/** Observa en 2026 un local sin cambios (como lo haría la app de campo, sin pasar por ella). */
function visitar(db: BaseDatos, localId: Id, fecha: string) {
  const l = db.locales[localId];
  const d = l.direcciones[l.direcciones.length - 1];
  const oc = db.ocupaciones[`ocu-${localId}`];
  const obsId = `obs26-${localId}`;
  db.secuencia++;
  db.observaciones[obsId] = {
    id: obsId, campanaId: C26_SINT, localId, calleId: d.calleId, fuente: 'campo-app', investigadorId: 'p-ana', fecha, registrado: fecha, tipo: 'confirmado', orden: db.secuencia,
    datos: { numero: d.numero, negocioId: oc.negocioId, nombre: oc.negocioId ? db.negocios[oc.negocioId].nombre : undefined, vacio: !oc.negocioId, metrosFachada: oc.metrosFachada },
    verificacion: 'pendiente',
  };
  db.ocupaciones[oc.id] = { ...oc, hastaCampanaId: undefined };
  db.revisiones[kRev(C26_SINT, localId)] = { campanaId: C26_SINT, localId, campo: 'terminado', categorizacion: 'pendiente', digital: 'pendiente', validacion: 'pendiente' };
}

function campana(id: Id, anio: number, calles: Id[], ref?: Id): Campana {
  return {
    id, municipioId: MUN_SINT, anio, nombre: `Censo sintético ${anio}`, tipo: ref ? 'actualizacion' : 'historico-importado', periodo: { inicio: `${anio}-09-01` },
    ambitoCalleIds: calles, ampliacionCalleIds: [], campanaReferenciaId: ref,
    estados: { planificacion: 'terminado', campo: ref ? 'en-curso' : 'terminado', revision: ref ? 'en-curso' : 'terminado', validacion: ref ? 'pendiente' : 'terminado' },
    procedencia: 'simulado',
  };
}

function itinerario(id: Id, codigo: string, tramos: TramoPlan[], color: string): Itinerario {
  return { id, campanaId: C26_SINT, codigo, nombre: `Itinerario ${codigo}`, color, origen: 'app', tramos, asignadosIds: ['p-ana'], creado: '2026-09-01T08:00:00', escenarioDemo: 'oficina-sintetica' };
}

function cerrarCobertura(db: BaseDatos, calleId: Id, acera: 'ambas' | 'par' | 'impar', estado: 'completada-con-locales' | 'completada-sin-locales') {
  db.coberturas[kCob(C26_SINT, calleId, acera)] = { campanaId: C26_SINT, calleId, acera, estado, porId: 'p-ana', fecha: '2026-09-20', aceraParRecorrida: acera !== 'impar', aceraImparRecorrida: acera !== 'par' };
}

/**
 * Escenario con:
 *  - IT-1: campo TERMINADO y oficina pendiente (pares de la calle repartida, primer segmento de
 *    la calle por segmentos y una calle completa).
 *  - IT-2: campo a medias (impares de la calle repartida, segundo segmento y una calle sin locales
 *    ya cerrada como «completada sin locales»).
 *  - Itinerarios adicionales para la parte masiva (cientos o miles de registros).
 */
export function escenarioOficina(op: OpcionesEscenario): Escenario {
  const db = baseVacia();
  db.meta.escenario = 'oficina-sintetica';
  db.municipios[MUN_SINT] = { id: MUN_SINT, nombre: 'Villaficticia', provincia: 'Ficticia', centro: [-4.9, 41.3], fuenteCallejero: 'simulado', nota: 'Municipio inventado para pruebas' };
  for (const [id, nombre, ini] of [['p-ana', 'Ana Ficticia', 'AF'], ['p-marta', 'Marta Ficticia', 'MF'], ['p-elena', 'Elena Ficticia', 'EF']] as const) {
    db.personas[id] = { id, nombre, iniciales: ini, roles: ['investigador', 'revisor', 'coordinador'], color: '#456' };
  }
  const calles: Calle[] = [];
  const nCalles = Math.max(4, op.calles);
  for (let c = 0; c < nCalles; c++) {
    const nombre = c === 0 ? 'Calle Ficticia Repartida' : c === 1 ? 'Calle Ficticia por Segmentos' : c === 2 ? 'Calle Ficticia Sin Locales' : `Calle Ficticia ${c}`;
    calles.push(calleRecta(`c-sint-${c}`, nombre, [-4.92 + (c % 20) * 0.001, 41.29 + Math.floor(c / 20) * 0.001]));
  }
  calles.forEach((c, i) => {
    if (i === 2) db.calles[c.id] = c; // calle sin locales
    else poblarCalle(db, c, op.localesPorCalle, i);
  });
  const ids = calles.map((c) => c.id);
  db.campanas[C25_SINT] = campana(C25_SINT, 2025, ids);
  db.campanas[C26_SINT] = { ...campana(C26_SINT, 2026, ids, C25_SINT), catalogoId: ID_CATALOGO_2026 };

  const [rep, seg, sinLoc, completa] = ids;
  const its: Itinerario[] = [
    itinerario('it-sint-1', 'IT-1', [
      { calleId: rep, acera: 'par', orden: 1 },
      { calleId: seg, acera: 'ambas', segmentoIds: [`${seg}-s1`], orden: 2 },
      { calleId: completa, acera: 'ambas', orden: 3 },
    ], '#2f6fde'),
    itinerario('it-sint-2', 'IT-2', [
      { calleId: rep, acera: 'impar', orden: 1 },
      { calleId: seg, acera: 'ambas', segmentoIds: [`${seg}-s2`], orden: 2 },
      { calleId: sinLoc, acera: 'ambas', orden: 3 },
    ], '#d9822b'),
  ];
  const resto = ids.slice(4);
  const porIt = op.callesPorItinerario ?? 10;
  for (let i = 0; i * porIt < resto.length; i++) {
    const tramos = resto.slice(i * porIt, (i + 1) * porIt).map((calleId, k) => ({ calleId, acera: 'ambas' as const, orden: k + 1 }));
    its.push(itinerario(`it-sint-${i + 3}`, `IT-${i + 3}`, tramos, '#5a9'));
  }
  for (const it of its) db.itinerarios[it.id] = it;

  // IT-1: campo terminado (todos sus locales visitados y sus calles cerradas)
  const enIt = (it: Itinerario) =>
    Object.values(db.locales).filter((l) => {
      const d = l.direcciones[0];
      return it.tramos.some((t) => {
        if (t.calleId !== d.calleId) return false;
        if (t.acera !== 'ambas' && (d.numero! % 2 === 0 ? 'par' : 'impar') !== t.acera) return false;
        if (!t.segmentoIds) return true;
        const mitad = l.coord![0] < db.calles[t.calleId].segmentos[0].coords[1][0];
        return t.segmentoIds.includes(mitad ? `${t.calleId}-s1` : `${t.calleId}-s2`);
      });
    });
  enIt(its[0]).forEach((l, k) => visitar(db, l.id, `2026-09-${String(10 + (k % 10)).padStart(2, '0')}T10:00:00`));
  for (const t of its[0].tramos) cerrarCobertura(db, t.calleId, t.acera, 'completada-con-locales');
  // IT-2: la calle sin locales recorrida y cerrada; el resto a medias
  cerrarCobertura(db, sinLoc, 'ambas', 'completada-sin-locales');
  enIt(its[1]).forEach((l, k) => {
    if (k % 2 === 0) visitar(db, l.id, `2026-09-${String(10 + (k % 10)).padStart(2, '0')}T11:00:00`);
  });
  // Masivo: fracción configurable
  its.slice(2).forEach((it, i) => {
    const f = op.visitados?.(i + 2) ?? 1;
    const ls = enIt(it);
    ls.forEach((l, k) => {
      if (k < ls.length * f) visitar(db, l.id, '2026-09-15T09:00:00');
    });
  });
  return { db, calleRepartida: rep, calleSegmentos: seg, calleSinLocales: sinLoc, itinerarios: its.map((i) => i.id) };
}

/**
 * Casos para probar a mano: en un local de IT-1, una sustitución fechada y después una hoja
 * en papel SIN fecha que queda con cronología incierta (aparece en «Incidencias»).
 */
export function conCasosDemostracion(esc: Escenario): Escenario {
  const it1 = esc.db.itinerarios[esc.itinerarios[0]];
  const local = Object.values(esc.db.locales).find((l) => l.direcciones[0].calleId === it1.tramos[2].calleId && esc.db.revisiones[kRev(C26_SINT, l.id)]);
  if (!local) return esc;
  let db = registrarVacio(esc.db, { campanaId: C26_SINT, investigadorId: 'p-ana', fecha: '2026-10-05T10:00:00' }, local.id, 4, 'Cerrado en octubre');
  db = registrarVacio(db, { campanaId: C26_SINT, investigadorId: 'p-ana', fuente: 'papel' }, local.id, 6, 'Hoja en papel sin fecha');
  db.meta.localCronologiaIncierta = local.id;
  return { ...esc, db };
}
