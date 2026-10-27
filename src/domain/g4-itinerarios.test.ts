// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { osmVillaSintetica } from '../data/callejeroSintetico';
import { archivoItinerario, libroItinerario } from '../data/xlsxItinerarios';
import { crearBaseEspacio, PREFIJO, verificarEspacio } from './espacios';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from './municipios';
import { aplicarCarga, huellaCalle } from './callejeros';
import { leerOsmMunicipio } from './fuentesCallejero';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion, deshacerIncorporacion, type DecisionesIncorporacion } from './incorporacion';
import { callesConObservaciones, censoConsolidado, crearItinerario, validarItinerario } from './campanaOperativa';
import type { BaseDatos } from './db';

/**
 * G4 · Varios Excel de itinerarios (IT1, IT2, IT3) en UNA campaña operativa municipal, con datos
 * SINTÉTICOS: trazabilidad por archivo, fila, itinerario y fecha; consolidación con desglose; archivos
 * repetidos, solapamientos, posibles duplicados y contradicciones sin fusionar nada; conciliación
 * supervisada; histórico y observaciones de otros itinerarios intactos.
 */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

const P = PREFIJO.ensayo;
const AHORA = '2026-10-25T10:00:00.000Z';
const VILLA = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
type It = 'IT1' | 'IT2' | 'IT3';

function escenario() {
  let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Persona de Prueba', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'g4', ahora: AHORA, incluirMedina: false });
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
  for (const k of ['IT1', 'IT2', 'IT3'] as It[]) {
    const r = crearItinerario(db, c.campanaId, { codigo: k }, o);
    db = r.db;
    its[k] = r.itinerarioId;
  }
  return { db, munId: m.municipioId, campanaId: c.campanaId, its, porId: o.porId };
}

async function preparar(db: BaseDatos, e: { munId: string; campanaId: string }, itinerarioId: string, bytes: Uint8Array, archivo: string, decisiones: DecisionesIncorporacion = {}) {
  const destino = { municipioId: e.munId, anio: 2026, campanaId: e.campanaId, itinerarioId };
  const { resultado, plan } = await prepararIncorporacion(db, bytes, archivo, destino, decisiones);
  return { resultado, plan, destino, aplicar: (porId: string) => aplicarIncorporacion(db, resultado, destino, decisiones, plan, { porId, ahora: AHORA }) };
}
const fila = (plan: { filas: { fila: number }[] }, i: number) => plan.filas[i].fila;

/** Incorpora IT1, IT2 e IT3 en orden (sin decisiones). */
async function tresItinerarios() {
  const e = escenario();
  let db = e.db;
  const imps = {} as Record<It, string>;
  for (const k of ['IT1', 'IT2', 'IT3'] as It[]) {
    const p = await preparar(db, e, e.its[k], await libroItinerario(k), archivoItinerario(k));
    expect(p.plan.aplicable, `${k}: ${p.plan.bloqueos.map((b) => b.mensaje).join(' ')}`).toBe(true);
    const r = p.aplicar(e.porId);
    db = r.db;
    imps[k] = r.importacionId;
  }
  return { ...e, db, imps };
}

describe('G4 · Itinerarios de una campaña operativa', () => {
  it('cada Excel se incorpora en SU itinerario, sin crear ni modificar la campaña, con trazabilidad completa', async () => {
    const e = escenario();
    const campana = structuredClone(e.db.campanas[e.campanaId]);
    const p = await preparar(e.db, e, e.its.IT1, await libroItinerario('IT1'), archivoItinerario('IT1'));
    expect(p.plan).toMatchObject({ aplicable: true, modo: 'operativo', destino: { campanaId: e.campanaId, nueva: false, itinerario: { id: e.its.IT1, codigo: 'IT1' } }, nuevas: { campanas: 0, locales: 6 } });
    // Dos establecimientos en el mismo portal: dos locales distintos
    expect(p.plan.mismoPortal).toEqual({ portales: 1, locales: 2 });
    const r = p.aplicar(e.porId);
    expect(r.campanaId).toBe(e.campanaId);
    expect(r.db.campanas[e.campanaId]).toEqual(campana);
    expect(Object.keys(r.db.campanas)).toHaveLength(1);
    const imp = r.db.importaciones[r.importacionId];
    expect(imp).toMatchObject({ tipo: 'C-excel-itinerario', campanaId: e.campanaId, archivo: archivoItinerario('IT1'), c1: { itinerario: { id: e.its.IT1, codigo: 'IT1' }, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    const regs = Object.values(r.db.registros);
    expect(regs.every((x) => x.itinerarioId === e.its.IT1 && x.importacionId === r.importacionId)).toBe(true);
    const obs = Object.values(r.db.observaciones);
    expect(obs.every((o) => o.itinerarioId === e.its.IT1 && o.registroId && r.db.registros[o.registroId].fila > 1)).toBe(true);
    expect(obs.find((o) => o.datos.nombre === 'BAR SINTÉTICO EL OLMO')?.fecha).toBe('2026-03-02');
    expect(verificarEspacio(r.db, 'ensayo')).toEqual([]);
  });

  it('códigos de itinerario únicos por campaña y solo en campañas operativas', () => {
    const e = escenario();
    expect(validarItinerario(e.db, e.campanaId, 'it1')[0]).toMatch(/Ya hay un itinerario IT1/);
    expect(validarItinerario(e.db, e.campanaId, 'IT 4')[0]).toMatch(/código del itinerario/);
    const h = crearCampana(e.db, { municipioId: e.munId, anio: 2024, nombre: 'Censo 2024', clase: 'historica' }, { prefijo: P, porId: e.porId, anioActual: 2026 });
    expect(validarItinerario(h.db, h.campanaId, 'IT1')[0]).toMatch(/campaña operativa/);
  });

  it('cruces con otros itinerarios: posible duplicado y contradicción se señalan y quedan pendientes (sin fusionar)', async () => {
    const e = escenario();
    const it1 = (await preparar(e.db, e, e.its.IT1, await libroItinerario('IT1'), archivoItinerario('IT1'))).aplicar(e.porId);
    const p2 = await preparar(it1.db, e, e.its.IT2, await libroItinerario('IT2'), archivoItinerario('IT2'));
    expect(p2.plan.aplicable).toBe(true);
    expect(p2.plan.cruces).toEqual([
      { fila: fila(p2.plan, 2), tipo: 'posible-duplicado', itinerario: 'IT1', detalle: '«FERRETERÍA SINTÉTICA» en el mismo portal que en IT1' },
      { fila: fila(p2.plan, 3), tipo: 'contradiccion', itinerario: 'IT1', detalle: 'ocupado aquí y vacío en IT1' },
    ]);
    // Los portales con locales de IT1 quedan para decisión supervisada: no se crea otro local ni se fusiona
    expect([2, 3].map((i) => [p2.plan.filas[i].correspondencia, p2.plan.filas[i].motivo, p2.plan.filas[i].localNuevo])).toEqual([
      ['ambigua', 'local-existente-en-direccion', false], ['ambigua', 'local-existente-en-direccion', false],
    ]);
    expect(p2.plan.pendientes.join(' ')).toMatch(/1 fila\(s\) coinciden.*posibles duplicados.*1 fila\(s\) contradicen a otro itinerario/);
  });

  it('archivos repetidos: el mismo Excel en otro itinerario y otro archivo para un itinerario ya incorporado se bloquean', async () => {
    const e = escenario();
    const it1 = (await preparar(e.db, e, e.its.IT1, await libroItinerario('IT1'), archivoItinerario('IT1'))).aplicar(e.porId);
    const mismo = await preparar(it1.db, e, e.its.IT3, await libroItinerario('IT1'), 'copia.xlsx');
    expect(mismo.plan.aplicable).toBe(false);
    expect(mismo.plan.bloqueos[0]).toMatchObject({ codigo: 'reimportacion-identica', mensaje: expect.stringMatching(/ya se incorporó.*itinerario IT1/) });
    const otro = await preparar(it1.db, e, e.its.IT1, await libroItinerario('IT1', 2), archivoItinerario('IT1', 2));
    expect(otro.plan.aplicable).toBe(false);
    expect(otro.plan.bloqueos.map((b) => b.mensaje).join(' ')).toMatch(/El itinerario IT1 ya tiene otro archivo incorporado.*deshaga antes/);
    // Sin itinerario no se incorpora en una campaña operativa
    const { plan } = await prepararIncorporacion(it1.db, await libroItinerario('IT2'), 'x.xlsx', { municipioId: e.munId, anio: 2026, campanaId: e.campanaId });
    expect(plan.bloqueos.map((b) => b.mensaje).join(' ')).toMatch(/Elija el itinerario/);
  });

  it('censo consolidado: totales, desglose por itinerario, solapamientos, duplicados, contradicciones y mismo portal', async () => {
    const { db, campanaId } = await tresItinerarios();
    const c = censoConsolidado(db, campanaId);
    expect(c.itinerarios.map((d) => [d.itinerario.codigo, d.archivos.length, d.registros, d.localesNuevos, d.vinculados, d.pendientes])).toEqual([
      ['IT1', 1, 6, 6, 6, 0],
      ['IT2', 1, 5, 3, 3, 2],
      ['IT3', 1, 4, 2, 2, 2],
    ]);
    expect(c.total).toMatchObject({ archivos: 3, registros: 15, locales: 11, vinculados: 11, pendientes: 4 });
    // Fechas reales por itinerario (y filas sin fecha, sin inventarla)
    expect(c.itinerarios[0].fechas).toEqual({ desde: '2026-03-02', hasta: '2026-03-04' });
    expect(c.itinerarios[1].sinFecha).toBe(1);
    expect(c.solapamientos.map((s) => [s.calle, s.itinerarios])).toEqual(expect.arrayContaining([['Calle del Olmo', ['IT1', 'IT2']], ['Calle Real', ['IT1', 'IT2']]]));
    expect(c.posiblesDuplicados).toEqual([expect.objectContaining({ portal: 'Calle del Olmo, 7', nombre: 'FERRETERÍA SINTÉTICA', conciliado: false })]);
    expect(c.contradicciones).toEqual([{ portal: 'Calle del Olmo, 5', vacio: ['IT1'], ocupado: ['IT2'], resuelta: false }]);
    expect(c.mismoPortal).toEqual([{ portal: 'Calle del Olmo, 3', locales: 2 }]);
    expect(Object.keys(db.campanas)).toHaveLength(1);
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
  });

  it('IT3: calle desconocida, «S/N» y una fila que dice ser de otro itinerario quedan señaladas', async () => {
    const e = escenario();
    const p = await preparar(e.db, e, e.its.IT3, await libroItinerario('IT3'), archivoItinerario('IT3'));
    expect(p.plan.filas.map((f) => f.motivo ?? f.correspondencia)).toEqual(['inequivoca', 'calle-sin-correspondencia', 'sin-numero', 'inequivoca']);
    expect(p.plan.pendientes.join(' ')).toMatch(/1 fila\(s\) indican en su columna «itinerario» un itinerario distinto de IT3/);
  });

  it('conciliación supervisada: el posible duplicado se vincula al local de IT1 por decisión, sin crear otro', async () => {
    const e = escenario();
    const it1 = (await preparar(e.db, e, e.its.IT1, await libroItinerario('IT1'), archivoItinerario('IT1'))).aplicar(e.porId);
    const ferreteria = Object.values(it1.db.observaciones).find((o) => o.datos.nombre === 'FERRETERÍA SINTÉTICA')!.localId!;
    const p0 = await preparar(it1.db, e, e.its.IT2, await libroItinerario('IT2'), archivoItinerario('IT2'));
    const dec: DecisionesIncorporacion = { correspondencias: [{ fila: fila(p0.plan, 2), accion: 'local-existente', localId: ferreteria, porId: e.porId, fecha: '2026-10-25' }] };
    const p = await preparar(it1.db, e, e.its.IT2, await libroItinerario('IT2'), archivoItinerario('IT2'), dec);
    expect(p.plan.filas[2]).toMatchObject({ correspondencia: 'decidida', localId: ferreteria, localNuevo: false });
    const db = p.aplicar(e.porId).db;
    const c = censoConsolidado(db, e.campanaId);
    expect(c.posiblesDuplicados).toEqual([expect.objectContaining({ nombre: 'FERRETERÍA SINTÉTICA', conciliado: true })]);
    // Las observaciones de IT1 no cambian
    expect(Object.values(db.observaciones).filter((o) => o.itinerarioId === e.its.IT1)).toEqual(Object.values(it1.db.observaciones));
  });

  it('deshacer un itinerario no toca los demás; no se deshace uno del que dependen observaciones de otro', async () => {
    const e = escenario();
    const it1 = (await preparar(e.db, e, e.its.IT1, await libroItinerario('IT1'), archivoItinerario('IT1'))).aplicar(e.porId);
    const ferreteria = Object.values(it1.db.observaciones).find((o) => o.datos.nombre === 'FERRETERÍA SINTÉTICA')!.localId!;
    const p0 = await preparar(it1.db, e, e.its.IT2, await libroItinerario('IT2'), archivoItinerario('IT2'));
    const dec: DecisionesIncorporacion = { correspondencias: [{ fila: fila(p0.plan, 2), accion: 'local-existente', localId: ferreteria, porId: e.porId, fecha: '2026-10-25' }] };
    const it2 = (await preparar(it1.db, e, e.its.IT2, await libroItinerario('IT2'), archivoItinerario('IT2'), dec)).aplicar(e.porId);
    // IT1 no se puede deshacer: IT2 tiene una observación sobre un local de IT1
    expect(() => deshacerIncorporacion(it2.db, it1.importacionId, e.porId, AHORA)).toThrow(/cambio\(s\) posterior\(es\)/);
    // IT2 sí, y deja IT1 exactamente igual
    const d = deshacerIncorporacion(it2.db, it2.importacionId, e.porId, AHORA);
    expect(Object.values(d.observaciones)).toEqual(Object.values(it1.db.observaciones));
    expect(Object.keys(d.locales).sort()).toEqual(Object.keys(it1.db.locales).sort());
    expect(censoConsolidado(d, e.campanaId).itinerarios[1]).toMatchObject({ registros: 0, archivos: [] });
    expect(verificarEspacio(d, 'ensayo')).toEqual([]);
  });

  it('el histórico se conserva: un portal con un local histórico queda para decisión, sin fusionar ni modificarlo', async () => {
    let e = escenario();
    const h = crearCampana(e.db, { municipioId: e.munId, anio: 2025, nombre: 'Censo 2025 · histórico', clase: 'historica' }, { prefijo: P, porId: e.porId, anioActual: 2026 });
    const destinoH = { municipioId: e.munId, anio: 2025, campanaId: h.campanaId };
    const hist = await prepararIncorporacion(h.db, await libroItinerario('IT1', 3), 'historico_2025.xlsx', destinoH);
    const dbH = aplicarIncorporacion(h.db, hist.resultado, destinoH, {}, hist.plan, { porId: e.porId, ahora: AHORA }).db;
    const historico = JSON.stringify([Object.values(dbH.observaciones), Object.values(dbH.locales), dbH.campanas[h.campanaId]]);
    e = { ...e, db: dbH };
    const p = await preparar(dbH, e, e.its.IT1, await libroItinerario('IT1'), archivoItinerario('IT1'));
    expect(p.plan.filas.every((f) => f.correspondencia === 'ambigua' && f.motivo === 'local-existente-en-direccion')).toBe(true);
    const db = p.aplicar(e.porId).db;
    const obsH = Object.values(db.observaciones).filter((o) => o.campanaId === h.campanaId);
    expect(JSON.stringify([obsH, Object.values(db.locales), db.campanas[h.campanaId]])).toBe(historico);
  });

  it('calles con observaciones: portales y segmentos de G3 como referencia, sin convertirlos en cobertura', async () => {
    const { db, its, campanaId } = await tresItinerarios();
    const t = callesConObservaciones(db, its.IT1);
    const olmo = Object.values(db.calles).find((c) => c.nombre === 'Calle del Olmo')!;
    expect(t.map((x) => [x.nombre, x.segmentos, x.recorrido])).toEqual([['Calle del Olmo', ['w1001', 'w1002'], 'no-confirmado'], ['Calle Real', ['w1003'], 'no-confirmado']]);
    expect(t[0]).toMatchObject({ numeros: [1, 3, 5, 7], acerasConLocales: ['impar'] });
    // No se guarda nada en el itinerario ni en el callejero
    expect(db.itinerarios[its.IT1].tramos).toEqual([]);
    expect(huellaCalle(db.calles[olmo.id])).toBe(huellaCalle(olmo));
    expect(Object.values(db.coberturas).filter((c) => c.campanaId === campanaId)).toEqual([]);
  });
});
