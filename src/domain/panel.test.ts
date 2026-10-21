// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { generarDemo } from '../data/semilla';
import { callejeroSimulado, MEDINA } from '../data/callejero';
import { MUNICIPIO_DEMO, prepararMunicipioDemo } from '../data/escenarioIncorporacion';
import { aplicarEscenario, prepararEscenario } from './incorporacionDemo';
import {
  adopcion, ambitos, compararGrupos, datosCampana, distribucion, filtrar, indicePresencia, matrizCalor, MIN_CELDA, respuestas, resumen, topCalles, UMBRAL_CALLE, type UnidadPanel,
} from './panel';
import { filasOficina } from './oficina';
import { indiceObservaciones, indiceOcupaciones } from './consultas';
import type { BaseDatos } from './db';
import type { Respuesta } from './types';

/** Datos FICTICIOS: la demostración y el escenario generado por la aplicación. */
let demo: BaseDatos;
let conHistorico: BaseDatos;
let campanaHist: string;

beforeAll(async () => {
  demo = prepararMunicipioDemo(generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'panel' }));
  const p = await prepararEscenario(demo, 'medina-2025-ficticio', 2025, {});
  const r = await aplicarEscenario(demo, 'medina-2025-ficticio', 2025, p.resultado, {}, p.plan, 'p-elena');
  conHistorico = r.db;
  campanaHist = r.campanaId;
});

/** Unidad sintética mínima para probar las agregaciones. */
const u = (o: Partial<UnidadPanel> & { d?: Partial<Record<string, Respuesta>> } = {}): UnidadPanel => ({
  clave: Math.random().toString(36), localId: 'l', calleId: o.calleId ?? 'c1', calle: o.calle ?? 'Calle 1', numero: 1, vacio: false, negocioId: 'n', fuenteClasificacion: 'confirmada',
  franquicia: 'pendiente', digitalEstado: 'borrador', sinLocal: false,
  ...o, digital: Object.fromEntries(Object.entries(o.d ?? {}).map(([k, r]) => [k, { respuesta: r! }])),
});

describe('C1d-B · Datos del dashboard calculados sobre el modelo', () => {
  it('distingue registros censales, establecimientos, locales físicos, negocios, vacíos y correspondencias pendientes', () => {
    const d = datosCampana(conHistorico, campanaHist);
    const r = resumen(d.unidades);
    expect(d.registrosCensales).toBe(890);
    expect(r).toMatchObject({ establecimientos: 860, locales: 842, negocios: 620, ocupados: 620, vacios: 240, sinLocal: 18 });
    expect(d.correspondencias).toEqual({ confirmada: 0, probable: 842, dudosa: 16, sinVinculo: 32 });
    expect(d.historica).toBe(true);
  });

  it('el histórico usa su texto original como clasificación (sin convertir ni confirmar) y su CP solo si consta en el origen', () => {
    const d = datosCampana(conHistorico, campanaHist);
    const ocup = d.unidades.filter((x) => !x.vacio);
    expect(new Set(ocup.map((x) => x.fuenteClasificacion))).toEqual(new Set(['historica']));
    expect(distribucion(ocup, (x) => x.sector).map((x) => x.clave).sort()).toEqual(['Comercio', 'Hostelería y Restauración', 'Servicios']);
    expect(distribucion(d.unidades, (x) => x.cp).map((x) => x.clave).sort()).toEqual(['47001', '47400']);
    expect(ocup.every((x) => x.digitalEstado === 'borrador')).toBe(true);
    // Medina (seed) no tiene CP en ningún origen: no se deduce del municipio
    expect(datosCampana(conHistorico, 'camp-medina-2025').unidades.every((x) => x.cp === undefined)).toBe(true);
  });

  it('las cifras coinciden con Oficina y el escenario no contamina otros municipios ni campañas', () => {
    const ix = { obs: indiceObservaciones(demo), ocu: indiceOcupaciones(demo) };
    const d26 = datosCampana(demo, 'camp-medina-2026');
    expect(d26.unidades.length).toBe(filasOficina(demo, 'camp-medina-2026', ix).filter((f) => f.situacion === 'registrado').length);
    for (const c of ['camp-medina-2026', 'camp-medina-2025', 'camp-vll-2025']) {
      expect(JSON.stringify(datosCampana(conHistorico, c).unidades)).toBe(JSON.stringify(datosCampana(demo, c).unidades));
    }
    const a = ambitos(conHistorico).find((x) => x.id === MUNICIPIO_DEMO.id)!;
    expect(a.campanas.map((c) => c.id)).toEqual([campanaHist]);
    expect(a.tipo).toBe('municipio');
  });
});

describe('C1d-B · Agregaciones', () => {
  it('calles más ocupadas: umbral mínimo, recuento de calles consideradas y orden', () => {
    const us = [
      ...Array.from({ length: 6 }, (_, i) => u({ calleId: 'a', calle: 'A', vacio: i > 3 })),
      ...Array.from({ length: 3 }, () => u({ calleId: 'b', calle: 'B' })),
      ...Array.from({ length: 5 }, (_, i) => u({ calleId: 'c', calle: 'C', vacio: i > 1 })),
    ];
    const t = topCalles(us, 'ocupados');
    expect(t).toMatchObject({ umbral: UMBRAL_CALLE, consideradas: 2, total: 3 });
    expect(t.filas.map((f) => [f.calle, f.ocupados, f.locales])).toEqual([['A', 4, 6], ['C', 2, 5]]);
    expect(topCalles(us, 'vacios').filas[0].calle).toBe('C');
  });

  it('respuestas digitales con denominador explícito; la adopción solo cuenta Sí/No', () => {
    const us = [u({ d: { web: 'si' } }), u({ d: { web: 'no' } }), u({ d: { web: 'sin-info' } }), u({ d: { web: 'na' } }), u({}), u({ vacio: true })];
    expect(respuestas(us, 'web')).toEqual({ si: 1, no: 1, 'sin-info': 1, na: 1, pendiente: 1, den: 5 });
    expect(adopcion(us, 'web')).toEqual({ n: 1, den: 2 });
  });

  it('mapa de calor: celdas sin datos suficientes quedan vacías', () => {
    const us = [...Array.from({ length: MIN_CELDA }, () => u({ calleId: 'a', calle: 'A', d: { web: 'si' } })), u({ calleId: 'b', calle: 'B', d: { web: 'si', instagram: 'no' } })];
    const m = matrizCalor(us, ['web', 'instagram']);
    expect(m.map((f) => f.calle)).toEqual(['A']);
    expect(m[0].celdas.map((c) => c.valor)).toEqual([1, null]);
  });

  it('índice de presencia solo con los seis canales respondidos; grupos pequeños marcados como insuficientes', () => {
    const completo = { web: 'si', googleBusiness: 'si', ventaOnline: 'no', instagram: 'si', facebook: 'no', twitter: 'no' } as const;
    expect(indicePresencia(u({ d: completo }))).toBe(3);
    expect(indicePresencia(u({ d: { ...completo, twitter: 'pendiente' } }))).toBeNull();
    expect(indicePresencia(u({ vacio: true, d: completo }))).toBeNull();
    const us = [...Array.from({ length: 10 }, () => u({ sector: 'Comercio', d: completo })), ...Array.from({ length: 3 }, () => u({ sector: 'Servicios', d: completo }))];
    expect(compararGrupos(us, (x) => x.sector, indicePresencia)).toEqual([{ grupo: 'Comercio', n: 10, media: 3, suficiente: true }, { grupo: 'Servicios', n: 3, media: null, suficiente: false }]);
  });

  it('filtros globales: franquicia (Sí, No, pendiente o sin dato), CP (incluido «sin CP»), sector y calle', () => {
    const us = [u({ franquicia: 'si', cp: '47400', sector: 'Comercio' }), u({ franquicia: 'no', sector: 'Servicios' }), u({ franquicia: 'sin-info' }), u({ franquicia: 'pendiente', calleId: 'z' }), u({ vacio: true, franquicia: undefined })];
    expect(filtrar(us, { franquicia: 'si' })).toHaveLength(1);
    expect(filtrar(us, { franquicia: 'pendiente' })).toHaveLength(2);
    expect(filtrar(us, { cp: '47400' })).toHaveLength(1);
    expect(filtrar(us, { cp: '__sin__' })).toHaveLength(4);
    expect(filtrar(us, { sector: 'Servicios' })).toHaveLength(1);
    expect(filtrar(us, { calleId: 'z' })).toHaveLength(1);
  });
});
