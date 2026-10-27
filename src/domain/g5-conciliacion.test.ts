// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { osmVillaSintetica } from '../data/callejeroSintetico';
import { archivoIT3G5, archivoItinerario, libroIT3G5, libroItinerario } from '../data/xlsxItinerarios';
import { crearBaseEspacio, PREFIJO, verificarEspacio } from './espacios';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from './municipios';
import { aplicarCarga } from './callejeros';
import { leerOsmMunicipio } from './fuentesCallejero';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion, deshacerIncorporacion } from './incorporacion';
import { callesConObservaciones, censoConsolidado, crearItinerario, tramosDeducidosSinConfirmar } from './campanaOperativa';
import {
  crearLocalDistinto, decisionesCampana, deshacerConciliacion, estadoLocal, localesPorRevisar, mantenerPendiente, pendientesCampana,
  resolverEstado, retirarResolucion, vincularALocal,
} from './conciliacionPosterior';
import type { BaseDatos } from './db';

/**
 * G5 · Conciliación POSTERIOR a la importación y consolidado fiable, con datos SINTÉTICOS: tres
 * itinerarios, dos negocios en un portal, observaciones repetidas, una contradicción sin fecha,
 * decisiones supervisadas con autor y fecha, y deshacer seguro.
 */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

const P = PREFIJO.ensayo;
const AHORA = '2026-10-25T10:00:00.000Z';
const VILLA = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
type It = 'IT1' | 'IT2' | 'IT3';

/** IT1, IT2 e IT3 (variante G5) incorporados sin decisiones en la campaña operativa «Censo 2026». */
async function escenario() {
  let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Persona de Prueba', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'g5', ahora: AHORA, incluirMedina: false });
  const o = { prefijo: P, porId: db.meta.espacioCreadoPorId!, ahora: AHORA, anioActual: 2026 };
  const m = altaMunicipio(db, { ...VILLA, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, o);
  db = m.db;
  const json = osmVillaSintetica(1);
  const l = leerOsmMunicipio(json, VILLA);
  if (!l.ok) throw new Error(l.motivo);
  db = aplicarCarga(db, m.municipioId, l, { archivo: 'villa.json', contenido: JSON.stringify(json), fuente: 'OpenStreetMap (Overpass API)' }, o).db;
  const c = crearCampana(db, { municipioId: m.municipioId, anio: 2026, nombre: 'Censo 2026', clase: 'operativa', tipoOperativa: 'nuevo' }, o);
  db = c.db;
  const its = {} as Record<It, string>;
  const imps = {} as Record<It, string>;
  for (const k of ['IT1', 'IT2', 'IT3'] as It[]) {
    const r = crearItinerario(db, c.campanaId, { codigo: k }, o);
    db = r.db;
    its[k] = r.itinerarioId;
  }
  for (const k of ['IT1', 'IT2', 'IT3'] as It[]) {
    const [bytes, archivo] = k === 'IT3' ? [await libroIT3G5(), archivoIT3G5] : [await libroItinerario(k), archivoItinerario(k)];
    const destino = { municipioId: m.municipioId, anio: 2026, campanaId: c.campanaId, itinerarioId: its[k] };
    const { resultado, plan } = await prepararIncorporacion(db, bytes, archivo, destino, {});
    expect(plan.aplicable, plan.bloqueos.map((b) => b.mensaje).join(' ')).toBe(true);
    const r = aplicarIncorporacion(db, resultado, destino, {}, plan, { porId: o.porId, ahora: AHORA });
    db = r.db;
    imps[k] = r.importacionId;
  }
  const local = (calle: string, num: number, nombre?: string) => {
    const ob = Object.values(db.observaciones).find((x) => db.calles[x.calleId]?.nombre === calle && x.datos.numero === num && x.localId && (nombre === undefined || x.datos.nombre === nombre));
    return ob!.localId!;
  };
  return { db, campanaId: c.campanaId, munId: m.municipioId, its, imps, porId: o.porId, local };
}
type E = Awaited<ReturnType<typeof escenario>>;
const pend = (e: E, db: BaseDatos, it: It, texto: RegExp) => pendientesCampana(db, e.campanaId, { itinerarioId: e.its[it] }).find((p) => texto.test(`${p.direccion} ${p.nombre ?? ''}`))!;
const firma = (e: E, motivo?: string) => ({ porId: e.porId, ahora: AHORA, ...(motivo ? { motivo } : {}) });

describe('G5 · Conciliación posterior y consolidado fiable', () => {
  it('panel de pendientes de toda la campaña, con filtros por itinerario, calle y tipo de incidencia', async () => {
    const e = await escenario();
    const todos = pendientesCampana(e.db, e.campanaId);
    expect(todos.map((p) => [p.itinerario, p.motivo])).toEqual([
      ['IT2', 'local-existente-en-direccion'], ['IT2', 'local-existente-en-direccion'],
      ['IT3', 'calle-sin-correspondencia'], ['IT3', 'sin-numero'], ['IT3', 'local-existente-en-direccion'], ['IT3', 'local-existente-en-direccion'],
    ]);
    expect(pendientesCampana(e.db, e.campanaId, { itinerarioId: e.its.IT2 })).toHaveLength(2);
    const olmo = Object.values(e.db.calles).find((c) => c.nombre === 'Calle del Olmo')!.id;
    expect(pendientesCampana(e.db, e.campanaId, { calleId: olmo }).map((p) => [p.itinerario, p.nombre])).toEqual([['IT2', 'FERRETERÍA SINTÉTICA'], ['IT2', 'CAFETERÍA SINTÉTICA'], ['IT3', 'CAFETERÍA SINTÉTICA']]);
    expect(pendientesCampana(e.db, e.campanaId, { tipo: 'calle-sin-correspondencia' }).map((p) => p.direccion)).toEqual([expect.stringMatching(/Calle Inexistente/)]);
    // Candidatos: locales de la misma calle, primero los del mismo portal; la calle desconocida no tiene ni permite crear local
    const ferr = pend(e, e.db, 'IT2', /FERRETERÍA/);
    expect(ferr.candidatos[0]).toEqual({ localId: e.local('Calle del Olmo', 7), portal: 'Calle del Olmo, 7', mismoPortal: true });
    expect(ferr.candidatos.filter((c) => c.mismoPortal)).toHaveLength(1);
    const inexistente = pend(e, e.db, 'IT3', /Inexistente/);
    expect([inexistente.candidatos, inexistente.puedeCrearLocal]).toEqual([[], false]);
  });

  it('observaciones repetidas: vincular el duplicado al mismo local no duplica ocupados ni crea otra ocupación', async () => {
    const e = await escenario();
    const antes = censoConsolidado(e.db, e.campanaId);
    const ferreteria = e.local('Calle del Olmo', 7);
    const ocupaciones = Object.keys(e.db.ocupaciones).length;
    const db = vincularALocal(e.db, e.campanaId, pend(e, e.db, 'IT2', /FERRETERÍA/).registroId, ferreteria, firma(e));
    expect(Object.keys(db.ocupaciones)).toHaveLength(ocupaciones);
    const v = Object.values(db.vinculos).find((x) => x.localId === ferreteria && x.conciliaciones)!;
    expect(v).toMatchObject({ confianza: 'confirmada', revisadoPorId: e.porId, conciliaciones: [{ accion: 'vincular', localId: ferreteria, porId: e.porId, fecha: AHORA, campanaId: e.campanaId, itinerarioId: e.its.IT2, antes: { localId: null } }] });
    const c = censoConsolidado(db, e.campanaId);
    // Una fila más con local, una observación más del MISMO local: los locales y los ocupados no cambian
    expect([c.total.registros, c.total.observaciones, c.total.locales, c.total.ocupados]).toEqual([antes.total.registros, antes.total.observaciones, antes.total.locales, antes.total.ocupados]);
    expect(c.total.vinculados).toBe(antes.total.vinculados + 1);
    expect(estadoLocal(db, e.campanaId, ferreteria)).toMatchObject({ clase: 'confirmado', valor: 'ocupado', contradictorio: false });
    expect(c.posiblesDuplicados.find((d) => d.nombre === 'FERRETERÍA SINTÉTICA')?.conciliado).toBe(true);
    expect(c.posiblesDuplicados.find((d) => d.nombre === 'CAFETERÍA SINTÉTICA')?.conciliado).toBe(false);
  });

  it('dos negocios en un portal: crear un local distinto exige justificación y nunca fusiona por compartir portal', async () => {
    const e = await escenario();
    const caf = pend(e, e.db, 'IT2', /CAFETERÍA/);
    expect(caf.candidatos.find((x) => x.mismoPortal)?.localId).toBe(e.local('Calle del Olmo', 5));
    expect(() => crearLocalDistinto(e.db, e.campanaId, caf.registroId, firma(e))).toThrow(/por qué es un local distinto/);
    const db = crearLocalDistinto(e.db, e.campanaId, caf.registroId, firma(e, 'Otro establecimiento en el mismo portal, comprobado en campo'));
    const nuevo = `loc-g5-${caf.registroId}`;
    expect(db.locales[nuevo]).toMatchObject({ municipioId: e.munId, direcciones: [{ calleId: caf.calleId, numero: 5 }] });
    expect(Object.values(db.ocupaciones).filter((o) => o.localId === nuevo)).toEqual([expect.objectContaining({ desdeCampanaId: e.campanaId, desdeFecha: '2026-04-07' })]);
    const c = censoConsolidado(db, e.campanaId);
    expect(c.mismoPortal).toEqual(expect.arrayContaining([{ portal: 'Calle del Olmo, 5', locales: 2 }, { portal: 'Calle del Olmo, 3', locales: 2 }]));
    // El local vacío de IT1 sigue vacío y la cafetería es otro local: ya no hay un mismo local contradictorio
    expect(estadoLocal(db, e.campanaId, e.local('Calle del Olmo', 5))).toMatchObject({ clase: 'confirmado', valor: 'vacio' });
    // Una fila de otra calle no se puede vincular a un local de Calle del Olmo
    expect(() => vincularALocal(db, e.campanaId, pend(e, db, 'IT3', /Peatonal/).registroId, nuevo, firma(e))).toThrow(/otra calle/);
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
  });

  it('contradicción CON fecha: dudosa con propuesta (no aplicada); la decisión supervisada la resuelve y se puede retirar', async () => {
    const e = await escenario();
    const vacio = e.local('Calle del Olmo', 5);
    const db1 = vincularALocal(e.db, e.campanaId, pend(e, e.db, 'IT2', /CAFETERÍA/).registroId, vacio, firma(e, 'Mismo local: el negocio abrió después'));
    const est = estadoLocal(db1, e.campanaId, vacio);
    expect(est).toMatchObject({ clase: 'dudoso', contradictorio: true, propuesta: { valor: 'ocupado' } });
    expect(est.valor).toBeUndefined();
    const c1 = censoConsolidado(db1, e.campanaId);
    expect(c1.contradicciones.find((x) => x.portal === 'Calle del Olmo, 5')?.resuelta).toBe(false);
    // No cuenta como ocupado ni como vacío mientras sea dudoso
    expect(c1.total.dudosos).toBe(1);
    expect(c1.total.vacios + c1.total.ocupados + c1.total.dudosos + c1.total.sinFecha).toBe(c1.total.locales);
    // Resolver: con una observación de ese local que diga ese estado
    expect(() => resolverEstado(db1, e.campanaId, vacio, { estado: 'vacio', observacionId: est.propuesta!.observacionId }, firma(e))).toThrow(/no dice ese estado/);
    const obsAntes = structuredClone(db1.observaciones);
    const db2 = resolverEstado(db1, e.campanaId, vacio, { estado: 'ocupado', observacionId: est.propuesta!.observacionId }, firma(e, 'Comprobado en la visita de abril'));
    expect(db2.observaciones).toEqual(obsAntes); // ninguna observación cambia
    expect(estadoLocal(db2, e.campanaId, vacio)).toMatchObject({ clase: 'confirmado', valor: 'ocupado', contradictorio: true, resolucion: { porId: e.porId, fecha: AHORA } });
    // El portal sigue con la fila de IT3 sin conciliar: la contradicción del portal no se da por resuelta todavía
    expect(censoConsolidado(db2, e.campanaId).contradicciones.find((x) => x.portal === 'Calle del Olmo, 5')?.resuelta).toBe(false);
    const db2b = vincularALocal(db2, e.campanaId, pend(e, db2, 'IT3', /CAFETERÍA/).registroId, vacio, firma(e));
    expect(censoConsolidado(db2b, e.campanaId).contradicciones.find((x) => x.portal === 'Calle del Olmo, 5')?.resuelta).toBe(true);
    const db3 = retirarResolucion(db2, e.campanaId, vacio, firma(e));
    expect(estadoLocal(db3, e.campanaId, vacio).clase).toBe('dudoso');
    expect(db3.campanas[e.campanaId].resolucionesEstado).toEqual([expect.objectContaining({ estado: 'ocupado', retirada: { porId: e.porId, fecha: AHORA } })]);
  });

  it('contradicción SIN fecha: «información sin fecha suficiente», sin propuesta y sin inventar fechas', async () => {
    const e = await escenario();
    const libreria = e.local('Calle Peatonal Mayor', 2);
    expect(estadoLocal(e.db, e.campanaId, libreria)).toMatchObject({ clase: 'sin-fecha', valor: 'ocupado', contradictorio: false });
    const db = vincularALocal(e.db, e.campanaId, pend(e, e.db, 'IT3', /Peatonal/).registroId, libreria, firma(e));
    const est = estadoLocal(db, e.campanaId, libreria);
    expect(est).toMatchObject({ clase: 'sin-fecha', contradictorio: true });
    expect(est.propuesta).toBeUndefined();
    expect(est.valor).toBeUndefined();
    expect(est.observaciones.every((o) => o.fecha === undefined)).toBe(true);
    expect(localesPorRevisar(db, e.campanaId).map((x) => x.localId)).toContain(libreria);
    // Marcar como dudoso (decisión) sin elegir estado
    const d = resolverEstado(db, e.campanaId, libreria, { estado: 'dudoso' }, firma(e));
    expect(estadoLocal(d, e.campanaId, libreria).clase).toBe('dudoso');
  });

  it('mantener pendiente queda registrado con autor y fecha; la calle desconocida no permite crear local', async () => {
    const e = await escenario();
    const p = pend(e, e.db, 'IT3', /Inexistente/);
    expect(() => crearLocalDistinto(e.db, e.campanaId, p.registroId, firma(e, 'x'))).toThrow(/Sin calle reconocida/);
    const db = mantenerPendiente(e.db, e.campanaId, p.registroId, firma(e, 'Preguntar al Ayuntamiento el nombre de la calle'));
    expect(pend(e, db, 'IT3', /Inexistente/)).toMatchObject({ motivo: 'calle-sin-correspondencia', decision: { accion: 'mantener-pendiente', porId: e.porId, fecha: AHORA, motivo: 'Preguntar al Ayuntamiento el nombre de la calle' } });
    expect(pendientesCampana(db, e.campanaId, { tipo: 'mantener-pendiente' }).map((x) => x.registroId)).toEqual([p.registroId]);
    expect(pendientesCampana(db, e.campanaId, { tipo: 'calle-sin-correspondencia' }).map((x) => x.registroId)).toEqual([p.registroId]);
    expect(decisionesCampana(db, e.campanaId)).toHaveLength(1);
  });

  it('deshacer seguro: restaura exactamente, se bloquea si algo depende de lo creado y devuelve la posibilidad de deshacer la importación', async () => {
    const e = await escenario();
    const caf2 = pend(e, e.db, 'IT2', /CAFETERÍA/);
    const caf3 = pend(e, e.db, 'IT3', /CAFETERÍA/);
    const db1 = crearLocalDistinto(e.db, e.campanaId, caf2.registroId, firma(e, 'Otro establecimiento en el mismo portal'));
    const nuevo = `loc-g5-${caf2.registroId}`;
    // Observación repetida en el TERCER itinerario: se vincula al local creado
    const db2 = vincularALocal(db1, e.campanaId, caf3.registroId, nuevo, firma(e));
    expect(estadoLocal(db2, e.campanaId, nuevo)).toMatchObject({ clase: 'confirmado', valor: 'ocupado', observaciones: [expect.anything(), expect.anything()] });
    // La importación de IT2 no se puede deshacer mientras haya conciliaciones vigentes sobre sus filas
    expect(() => deshacerIncorporacion(db2, e.imps.IT2, e.porId, AHORA)).toThrow(/cambio\(s\) posterior\(es\)/);
    // No se deshace la creación del local mientras otra fila (IT3) esté vinculada a él
    expect(() => deshacerConciliacion(db2, e.campanaId, caf2.registroId, firma(e))).toThrow(/Otra fila está vinculada/);
    // Aislamiento: no se actúa sobre la fila desde otra campaña
    const otra = crearCampana(db2, { municipioId: e.munId, anio: 2025, nombre: 'Censo 2025', clase: 'historica' }, { prefijo: P, porId: e.porId, anioActual: 2026 });
    expect(() => deshacerConciliacion(otra.db, otra.campanaId, caf3.registroId, firma(e))).toThrow(/no pertenece a esta campaña/);
    // Deshacer en orden inverso deja la base exactamente como tras la importación
    const db3 = deshacerConciliacion(db2, e.campanaId, caf3.registroId, firma(e));
    const db4 = deshacerConciliacion(db3, e.campanaId, caf2.registroId, firma(e));
    expect(db4.locales).toEqual(e.db.locales);
    expect(db4.ocupaciones).toEqual(e.db.ocupaciones);
    expect(db4.observaciones).toEqual(e.db.observaciones);
    // Las decisiones deshechas quedan en el historial, con quién y cuándo
    expect(decisionesCampana(db4, e.campanaId).map((d) => [d.decision.accion, !!d.decision.deshecha])).toEqual([['local-nuevo', true], ['vincular', true]]);
    expect(pendientesCampana(db4, e.campanaId)).toHaveLength(6);
    // …y la importación vuelve a poder deshacerse
    const sinIt3 = deshacerIncorporacion(db4, e.imps.IT3, e.porId, AHORA);
    const sinIt2 = deshacerIncorporacion(sinIt3, e.imps.IT2, e.porId, AHORA);
    expect(censoConsolidado(sinIt2, e.campanaId).total).toMatchObject({ archivos: 1, registros: 6 });
    expect(verificarEspacio(sinIt2, 'ensayo')).toEqual([]);
  });

  it('consolidado: distingue filas, observaciones y locales únicos y cuenta cada local una sola vez', async () => {
    const e = await escenario();
    const c = censoConsolidado(e.db, e.campanaId);
    // 6 + 5 + 6 filas; observaciones solo donde la calle es conocida; 11 locales físicos únicos
    expect(c.total).toMatchObject({ registros: 17, locales: 11 });
    expect(c.total.observaciones).toBe(Object.values(e.db.observaciones).length);
    expect(c.total.observaciones).toBeGreaterThan(c.total.locales);
    expect(c.total.vacios + c.total.ocupados + c.total.dudosos + c.total.sinFecha).toBe(c.total.locales);
    // La librería sin fecha no se cuenta como ocupada confirmada
    expect(c.estados.find((x) => x.localId === e.local('Calle Peatonal Mayor', 2))?.clase).toBe('sin-fecha');
    expect(c.total.sinFecha).toBe(1);
  });

  it('cobertura: las calles con observaciones no son tramos ni cobertura; los tramos guardados en G4 se marcan como no confirmados sin cambiarlos', async () => {
    const e = await escenario();
    const calles = callesConObservaciones(e.db, e.its.IT1);
    expect(calles.every((x) => x.recorrido === 'no-confirmado')).toBe(true);
    expect(calles.find((x) => x.nombre === 'Calle Real')).toMatchObject({ numeros: [2], acerasConLocales: ['par'] });
    // Simula un itinerario con tramos guardados por G4 («Guardar N calle(s) como tramos»)
    const g4 = calles.map((x, i) => ({ calleId: x.calleId, segmentoIds: x.segmentos, acera: 'ambas' as const, orden: i + 1 }));
    const db = { ...e.db, itinerarios: { ...e.db.itinerarios, [e.its.IT1]: { ...e.db.itinerarios[e.its.IT1], tramos: g4 } } };
    expect(tramosDeducidosSinConfirmar(db, e.its.IT1)).toEqual(g4);
    expect(db.itinerarios[e.its.IT1].tramos).toEqual(g4); // se conservan
    // Una planificación revisada (con etiqueta o responsable) no se marca así
    const plan = { ...db, itinerarios: { ...db.itinerarios, [e.its.IT1]: { ...db.itinerarios[e.its.IT1], tramos: [{ ...g4[0], etiqueta: 'censar desde cero' }] } } };
    expect(tramosDeducidosSinConfirmar(plan, e.its.IT1)).toEqual([]);
  });

  it('integridad · sin permiso no se deshace una conciliación ni se retira una decisión de estado', async () => {
    const e = await escenario();
    const sinPermiso = { ...e.db, personas: { ...e.db.personas, 'p-campo': { id: 'p-campo', nombre: 'Investigación de Campo', iniciales: 'IC', roles: ['investigador' as const], color: '#888' } } };
    const caf = pend(e, sinPermiso, 'IT2', /CAFETERÍA/);
    const vacio = e.local('Calle del Olmo', 5);
    const db1 = vincularALocal(sinPermiso, e.campanaId, caf.registroId, vacio, firma(e));
    const obs = estadoLocal(db1, e.campanaId, vacio).propuesta!.observacionId;
    const db2 = resolverEstado(db1, e.campanaId, vacio, { estado: 'ocupado', observacionId: obs }, firma(e));
    const ajeno = { porId: 'p-campo', ahora: AHORA };
    expect(() => vincularALocal(db1, e.campanaId, pend(e, db1, 'IT2', /FERRETERÍA/).registroId, e.local('Calle del Olmo', 7), ajeno)).toThrow(/coordinación, administración o revisión/);
    expect(() => deshacerConciliacion(db2, e.campanaId, caf.registroId, ajeno)).toThrow(/Deshace una persona de coordinación/);
    expect(() => retirarResolucion(db2, e.campanaId, vacio, ajeno)).toThrow(/Retira una persona de coordinación/);
    expect(() => resolverEstado(db1, e.campanaId, vacio, { estado: 'dudoso' }, ajeno)).toThrow(/coordinación/);
    expect(() => deshacerConciliacion(db2, e.campanaId, caf.registroId, { porId: 'p-inexistente', ahora: AHORA })).toThrow(/coordinación/);
  });

  it('integridad · una decisión de estado vigente bloquea deshacer la conciliación y la importación, con explicación y sin borrarla', async () => {
    const e = await escenario();
    // Local creado por conciliación y con una decisión de estado vigente
    const caf = pend(e, e.db, 'IT2', /CAFETERÍA/);
    const db1 = crearLocalDistinto(e.db, e.campanaId, caf.registroId, firma(e, 'Otro establecimiento en el mismo portal'));
    const nuevo = `loc-g5-${caf.registroId}`;
    const ob = estadoLocal(db1, e.campanaId, nuevo).observaciones[0].id;
    const db2 = resolverEstado(db1, e.campanaId, nuevo, { estado: 'ocupado', observacionId: ob }, firma(e));
    expect(() => deshacerConciliacion(db2, e.campanaId, caf.registroId, firma(e))).toThrow(/decisión de estado vigente.*retírela antes/);
    // Vincular a un local existente y decidir su estado: tampoco se deshace la vinculación sin retirar antes
    const vacio = e.local('Calle del Olmo', 5);
    const caf3 = pend(e, db2, 'IT3', /CAFETERÍA/);
    const db3 = vincularALocal(db2, e.campanaId, caf3.registroId, vacio, firma(e));
    const db4 = resolverEstado(db3, e.campanaId, vacio, { estado: 'ocupado', observacionId: estadoLocal(db3, e.campanaId, vacio).propuesta!.observacionId }, firma(e));
    expect(() => deshacerConciliacion(db4, e.campanaId, caf3.registroId, firma(e))).toThrow(/decisión de estado vigente/);
    // Deshacer la importación de IT1 (de la que es el local vacío) se bloquea por la decisión vigente
    let err: unknown;
    try { deshacerIncorporacion(db4, e.imps.IT1, e.porId, AHORA); } catch (x) { err = x; }
    expect((err as { detalles?: string[] }).detalles?.join(' ')).toMatch(/Decisión de estado vigente sobre el local «.*» en «Censo 2026»: retírela antes de deshacer/);
    // Ninguna decisión se ha eliminado
    expect(db4.campanas[e.campanaId].resolucionesEstado).toHaveLength(2);
    // Retirada la decisión, la conciliación ya se puede deshacer (y la decisión retirada se conserva)
    const db5 = deshacerConciliacion(retirarResolucion(db4, e.campanaId, vacio, firma(e)), e.campanaId, caf3.registroId, firma(e));
    expect(db5.campanas[e.campanaId].resolucionesEstado?.map((r) => !!r.retirada)).toEqual([false, true]);
  });

  it('integridad · una decisión de estado apoyada en observaciones de una importación bloquea deshacerla', async () => {
    const e = await escenario();
    // La librería (local de IT2) recibe por conciliación la observación sin fecha de IT3 y se decide su estado
    const libreria = e.local('Calle Peatonal Mayor', 2);
    const p3 = pend(e, e.db, 'IT3', /Peatonal/);
    const db1 = vincularALocal(e.db, e.campanaId, p3.registroId, libreria, firma(e));
    const db2 = resolverEstado(db1, e.campanaId, libreria, { estado: 'dudoso' }, firma(e));
    expect(() => deshacerIncorporacion(db2, e.imps.IT2, e.porId, AHORA)).toThrow(/cambio\(s\) posterior\(es\)/);
    // Retirar y deshacer la conciliación → IT3 y luego IT2 se pueden deshacer
    const db3 = deshacerConciliacion(retirarResolucion(db2, e.campanaId, libreria, firma(e)), e.campanaId, p3.registroId, firma(e));
    const db4 = deshacerIncorporacion(deshacerIncorporacion(db3, e.imps.IT3, e.porId, AHORA), e.imps.IT2, e.porId, AHORA);
    expect(db4.locales[libreria]).toBeUndefined();
    expect(db4.campanas[e.campanaId].resolucionesEstado).toEqual([expect.objectContaining({ localId: libreria, retirada: expect.anything() })]);
    expect(verificarEspacio(db4, 'ensayo')).toEqual([]);
  });

  it('auditoría · al deshacer una importación queda una traza mínima de sus conciliaciones deshechas', async () => {
    const e = await escenario();
    const p = pend(e, e.db, 'IT3', /Inexistente/);
    const caf = pend(e, e.db, 'IT3', /CAFETERÍA/);
    let db = mantenerPendiente(e.db, e.campanaId, p.registroId, firma(e, 'Texto libre que no debe copiarse'));
    db = crearLocalDistinto(db, e.campanaId, caf.registroId, { porId: e.porId, ahora: '2026-10-25T11:00:00.000Z', motivo: 'Otro local' });
    db = deshacerConciliacion(db, e.campanaId, caf.registroId, { porId: e.porId, ahora: '2026-10-25T12:00:00.000Z' });
    db = deshacerConciliacion(db, e.campanaId, p.registroId, { porId: e.porId, ahora: '2026-10-25T13:00:00.000Z' });
    const d = deshacerIncorporacion(db, e.imps.IT3, e.porId, '2026-10-25T14:00:00.000Z');
    const traza = d.importaciones[e.imps.IT3].c1!.deshecha!;
    expect(traza).toMatchObject({ porId: e.porId, fecha: '2026-10-25T14:00:00.000Z' });
    expect(traza.conciliaciones).toEqual([
      { fila: p.fila, accion: 'mantener-pendiente', porId: e.porId, fecha: AHORA, deshecha: { porId: e.porId, fecha: '2026-10-25T13:00:00.000Z' } },
      { fila: caf.fila, accion: 'local-nuevo', porId: e.porId, fecha: '2026-10-25T11:00:00.000Z', deshecha: { porId: e.porId, fecha: '2026-10-25T12:00:00.000Z' } },
    ]);
    // Sin motivos ni datos de la fila; los vínculos y el local se retiran igualmente
    expect(JSON.stringify(traza)).not.toMatch(/Texto libre|Otro local|CAFETERÍA/);
    expect(d.vinculos[caf.vinculoId]).toBeUndefined();
    // Una importación sin conciliaciones no añade la lista
    expect(deshacerIncorporacion(e.db, e.imps.IT3, e.porId, AHORA).importaciones[e.imps.IT3].c1!.deshecha!.conciliaciones).toBeUndefined();
  });
});
