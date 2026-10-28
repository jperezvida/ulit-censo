// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { archivoItinerario, libroConFilas, libroItinerario } from '../data/xlsxItinerarios';
import { verificarEspacio } from './espacios';
import { crearCampana } from './municipios';
import { deshacerIncorporacion } from './incorporacion';
import { censoConsolidado } from './campanaOperativa';
import { pendientesCampana } from './conciliacionPosterior';
import { estadosItinerario } from './resumenCampana';
import { direccionVigente } from './consultas';
import { kRev, type BaseDatos } from './db';

beforeAll(() => { if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });

import { AHORA, escenario, historico, importar } from './censo2026.fixture';

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
      { hecho: true, texto: 'Campo: Excel incorporado (6 registros)' }, { hecho: false, texto: 'Oficina: 5 sin conciliar · 0/1 locales revisados' }, { hecho: false, texto: 'Validación: pendiente' },
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

  it('Oficina no termina con filas sin conciliar; los locales vacíos no exigen presencia digital', async () => {
    const e = await escenario();
    const revisar = (db: BaseDatos, localIds: string[], digital: 'pendiente' | 'revisado') => ({
      ...db, revisiones: { ...db.revisiones, ...Object.fromEntries(localIds.map((l) => [kRev(e.campanaId, l), { campanaId: e.campanaId, localId: l, campo: 'terminado', categorizacion: 'revisado', digital, validacion: 'pendiente' } as const])) },
    });
    const localesDe = (db: BaseDatos, it: string) => [...new Set(Object.values(db.observaciones).filter((o) => o.itinerarioId === it && o.localId).map((o) => o.localId!))];
    // IT1: el único local vinculado, revisado del todo; quedan 5 filas sin conciliar → Oficina NO terminada
    const db1 = (await importar(e.db, e, 'IT1', await libroItinerario('IT1'), archivoItinerario('IT1'))).aplicar().db;
    const db1r = revisar(db1, localesDe(db1, e.its.IT1), 'revisado');
    expect(estadosItinerario(db1r, e.its.IT1)).toMatchObject({ registros: 6, sinConciliar: 5, locales: 1, revisados: 1, oficina: { hecho: false, texto: 'Oficina: 5 sin conciliar · 1/1 locales revisados' } });
    // IT2: dos altas en portales sin censo anterior (una ocupada y una vacía): sin pendientes
    const libro = await libroConFilas('IT2', [
      { calle: 'Calle del Olmo', num: 21, nombre: 'BAR SINTÉTICO NUEVO', fecha: '2026-03-06' },
      { calle: 'Calle Real', num: 31, vacio: true, fecha: '2026-03-06' },
    ]);
    const db2 = (await importar(db1, e, 'IT2', libro, 'itinerario_IT2_altas_SINTETICO.xlsx')).aplicar().db;
    const ls = localesDe(db2, e.its.IT2);
    const vacio = ls.find((l) => Object.values(db2.observaciones).some((o) => o.localId === l && o.tipo === 'vacio'))!;
    const ocupado = ls.find((l) => l !== vacio)!;
    expect(estadosItinerario(db2, e.its.IT2)).toMatchObject({ registros: 2, sinConciliar: 0, locales: 2, revisados: 0, oficina: { hecho: false } });
    // Vacío con solo la categorización revisada cuenta; el ocupado sin presencia digital revisada, no
    const parcial = revisar(revisar(db2, [vacio], 'pendiente'), [ocupado], 'pendiente');
    expect(estadosItinerario(parcial, e.its.IT2)).toMatchObject({ revisados: 1, oficina: { hecho: false } });
    const completo = revisar(revisar(db2, [vacio], 'pendiente'), [ocupado], 'revisado');
    const est = estadosItinerario(completo, e.its.IT2);
    expect(est).toMatchObject({ revisados: 2, oficina: { hecho: true, texto: 'Oficina: 0 sin conciliar · 2/2 locales revisados' } });
    // Validación sigue independiente; IT1 y el histórico 2025 no cambian
    expect(est.validacion).toEqual({ hecho: false, texto: 'Validación: pendiente' });
    expect(estadosItinerario(completo, e.its.IT1)).toEqual(estadosItinerario(db1, e.its.IT1));
    expect(historico(completo, e.historica)).toBe(historico(e.db, e.historica));
  }, 60000);

  it('la referencia de una campaña operativa debe ser un censo histórico anterior del mismo municipio', async () => {
    const e = await escenario();
    const o = { ...e.o };
    expect(() => crearCampana(e.db, { municipioId: e.munId, anio: 2026, nombre: 'Otra 2026', clase: 'operativa', campanaReferenciaId: e.campanaId }, o)).toThrow(/histórica anterior/);
    expect(() => crearCampana(e.db, { municipioId: e.munId, anio: 2024, nombre: 'Hist 2024', clase: 'historica', campanaReferenciaId: e.historica }, o)).toThrow(/Solo una campaña operativa/);
  });
});
