// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { osmVillaSintetica } from '../data/callejeroSintetico';
import { archivoItinerario, libroConFilas, libroItinerario } from '../data/xlsxItinerarios';
import { crearBaseEspacio, PREFIJO, verificarEspacio } from './espacios';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from './municipios';
import { aplicarCarga } from './callejeros';
import { leerOsmMunicipio } from './fuentesCallejero';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion, deshacerIncorporacion } from './incorporacion';
import { censoConsolidado, crearItinerario } from './campanaOperativa';
import { pendientesCampana } from './conciliacionPosterior';
import { estadosItinerario } from './resumenCampana';
import { direccionVigente } from './consultas';
import type { BaseDatos } from './db';

beforeAll(() => { if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
const P = PREFIJO.ensayo;
const AHORA = '2026-10-28T10:00:00.000Z';

import { FILAS_2025 } from './censo2026.fixture';

async function escenario() {
  let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Coordinación de Prueba', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'c26', ahora: AHORA, incluirMedina: false });
  const o = { prefijo: P, porId: db.meta.espacioCreadoPorId!, ahora: AHORA, anioActual: 2026 };
  const V = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
  const m = altaMunicipio(db, { ...V, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, o); db = m.db;
  const j = osmVillaSintetica(1); const l = leerOsmMunicipio(j, V); if (!l.ok) throw new Error(l.motivo);
  db = aplicarCarga(db, m.municipioId, l, { archivo: 'v.json', contenido: JSON.stringify(j), fuente: 'OpenStreetMap (Overpass API)' }, o).db;
  const h = crearCampana(db, { municipioId: m.municipioId, anio: 2025, nombre: 'Censo 2025', clase: 'historica' }, o); db = h.db;
  const d25 = { municipioId: m.municipioId, anio: 2025, campanaId: h.campanaId };
  const p25 = await prepararIncorporacion(db, await libroConFilas('IT1', FILAS_2025), 'censo_2025_SINTETICO.xlsx', d25, {});
  db = aplicarIncorporacion(db, p25.resultado, d25, {}, p25.plan, { porId: o.porId, ahora: AHORA }).db;
  const c = crearCampana(db, { municipioId: m.municipioId, anio: 2026, nombre: 'Censo 2026', clase: 'operativa', tipoOperativa: 'actualizacion', campanaReferenciaId: h.campanaId }, o); db = c.db;
  const its: Record<string, string> = {};
  for (const k of ['IT1', 'IT2']) { const r = crearItinerario(db, c.campanaId, { codigo: k }, o); db = r.db; its[k] = r.itinerarioId; }
  return { db, o, munId: m.municipioId, historica: h.campanaId, campanaId: c.campanaId, its };
}
async function importar(db: BaseDatos, e: Awaited<ReturnType<typeof escenario>>, it: 'IT1' | 'IT2', bytes: Uint8Array, archivo: string) {
  const destino = { municipioId: e.munId, anio: 2026, campanaId: e.campanaId, itinerarioId: e.its[it] };
  const p = await prepararIncorporacion(db, bytes, archivo, destino, {});
  return { plan: p.plan, aplicar: () => aplicarIncorporacion(db, p.resultado, destino, {}, p.plan, { porId: e.o.porId, ahora: AHORA }) };
}

const historico = (db: BaseDatos, campanaId: string) => JSON.stringify([
  Object.values(db.observaciones).filter((o) => o.campanaId === campanaId),
  Object.values(db.ocupaciones).filter((o) => o.desdeCampanaId === campanaId),
  Object.values(db.locales).filter((l) => Object.values(db.observaciones).some((o) => o.localId === l.id && o.campanaId === campanaId)),
]);

describe('Censo 2026 construido por itinerarios sobre el censo 2025 (SINTÉTICO)', () => {
  it('IT1: alta, existentes, vacío, posible cambio de negocio y ausentes, sin fusionar ni dar nada por revisado', async () => {
    const e = await escenario();
    expect(e.db.campanas[e.campanaId].campanaReferenciaId).toBe(e.historica);
    const antes = historico(e.db, e.historica);
    const i1 = await importar(e.db, e, 'IT1', await libroItinerario('IT1'), archivoItinerario('IT1'));
    expect(i1.plan).toMatchObject({ aplicable: true, modo: 'operativo', nuevas: { campanas: 0, registros: 6, locales: 1 } });
    // Olmo 1 no estaba en 2025: alta. El resto comparte portal con un local de 2025: queda para conciliar (no se fusiona)
    expect(i1.plan.filas.map((f) => [f.correspondencia, f.motivo ?? null, f.localNuevo])).toEqual([
      ['inequivoca', null, true],
      ...Array(5).fill(['ambigua', 'local-existente-en-direccion', false]),
    ]);
    const db1 = i1.aplicar().db;
    expect(pendientesCampana(db1, e.campanaId).map((p) => p.nombre ?? '(vacío)')).toEqual(['PANADERÍA SINTÉTICA', 'PELUQUERÍA SINTÉTICA', '(vacío)', 'FERRETERÍA SINTÉTICA', 'ESTANCO SINTÉTICO']);
    // FERRETERÍA (2026) frente a DROGUERÍA (2025): no es un cambio de negocio confirmado; Real 8 ausente no es una desaparición
    expect(historico(db1, e.historica)).toBe(antes);
    expect(Object.values(db1.observaciones).filter((o) => o.campanaId === e.campanaId).map((o) => o.tipo)).not.toContain('posible-desaparicion');
    const real8 = Object.values(db1.locales).find((l) => direccionVigente(l).numero === 8)!;
    expect(Object.values(db1.observaciones).filter((o) => o.localId === real8.id).map((o) => o.campanaId)).toEqual([e.historica]);
    // Procedencia de cada registro y observación
    const regs = Object.values(db1.registros).filter((r) => r.itinerarioId === e.its.IT1);
    expect(regs.map((r) => r.fila)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(Object.values(db1.observaciones).filter((o) => o.campanaId === e.campanaId).every((o) => o.itinerarioId === e.its.IT1 && regs.some((r) => r.id === o.registroId))).toBe(true);
    // Campo / Oficina / Validación separados; nada revisado ni confirmado
    expect(Object.keys(db1.revisiones)).toHaveLength(0);
    expect(Object.values(db1.digital).every((d) => d.estado === 'borrador')).toBe(true);
    expect(Object.values(db1.clasificaciones).every((c) => !c.confirmada)).toBe(true);
    const est = estadosItinerario(db1, e.its.IT1);
    expect([est.campo, est.oficina, est.validacion]).toEqual([
      { hecho: true, texto: 'Campo: Excel incorporado (6 filas)' }, { hecho: false, texto: 'Oficina: 0/1 revisados' }, { hecho: false, texto: 'Validación: pendiente' },
    ]);
    expect(db1.campanas[e.campanaId].estados).toEqual(e.db.campanas[e.campanaId].estados);
    expect(verificarEspacio(db1, 'ensayo')).toEqual([]);
  }, 60000);

  it('IT2 se suma al mismo censo; el mismo Excel no se duplica; una versión corregida exige deshacer la anterior', async () => {
    const e = await escenario();
    const db1 = (await importar(e.db, e, 'IT1', await libroItinerario('IT1'), archivoItinerario('IT1'))).aplicar().db;
    const it1 = JSON.stringify(Object.values(db1.registros).filter((r) => r.itinerarioId === e.its.IT1));
    const r2 = (await importar(db1, e, 'IT2', await libroItinerario('IT2'), archivoItinerario('IT2'))).aplicar();
    const db2 = r2.db;
    expect(Object.keys(db2.campanas)).toEqual(Object.keys(e.db.campanas));
    expect(censoConsolidado(db2, e.campanaId).itinerarios.map((d) => [d.itinerario.codigo, d.registros])).toEqual([['IT1', 6], ['IT2', 5]]);
    expect(JSON.stringify(Object.values(db2.registros).filter((r) => r.itinerarioId === e.its.IT1))).toBe(it1);
    // Reimportar el mismo archivo: bloqueado (en cualquier itinerario)
    for (const it of ['IT1', 'IT2'] as const) {
      const rep = await importar(db2, e, it, await libroItinerario('IT1'), archivoItinerario('IT1'));
      expect(rep.plan.aplicable).toBe(false);
      expect(rep.plan.bloqueos[0].codigo).toBe('reimportacion-identica');
    }
    // Versión corregida de IT1: bloqueada hasta deshacer la anterior; después entra sin tocar IT2 ni el histórico
    const v2 = await importar(db2, e, 'IT1', await libroItinerario('IT1', 2), archivoItinerario('IT1', 2));
    expect(v2.plan.bloqueos.map((b) => b.mensaje).join(' ')).toMatch(/ya tiene otro archivo incorporado.*deshaga antes/);
    const sin1 = deshacerIncorporacion(db2, (Object.values(db2.importaciones).find((i) => i.c1?.itinerario?.id === e.its.IT1))!.id, e.o.porId, AHORA);
    const v2b = await importar(sin1, e, 'IT1', await libroItinerario('IT1', 2), archivoItinerario('IT1', 2));
    expect(v2b.plan.aplicable).toBe(true);
    const db3 = v2b.aplicar().db;
    expect(censoConsolidado(db3, e.campanaId).itinerarios.map((d) => [d.itinerario.codigo, d.registros])).toEqual([['IT1', 7], ['IT2', 5]]);
    expect(Object.values(db3.importaciones).map((i) => [i.c1?.itinerario?.codigo, i.estado])).toEqual(expect.arrayContaining([['IT1', 'descartada'], ['IT2', 'confirmada'], ['IT1', 'confirmada']]));
    expect(historico(db3, e.historica)).toBe(historico(e.db, e.historica));
    expect(verificarEspacio(db3, 'ensayo')).toEqual([]);
  }, 60000);

  it('la referencia de una campaña operativa debe ser un censo histórico anterior del mismo municipio', async () => {
    const e = await escenario();
    const o = { ...e.o };
    expect(() => crearCampana(e.db, { municipioId: e.munId, anio: 2026, nombre: 'Otra 2026', clase: 'operativa', campanaReferenciaId: e.campanaId }, o)).toThrow(/histórica anterior/);
    expect(() => crearCampana(e.db, { municipioId: e.munId, anio: 2024, nombre: 'Hist 2024', clase: 'historica', campanaReferenciaId: e.historica }, o)).toThrow(/Solo una campaña operativa/);
  });
});
