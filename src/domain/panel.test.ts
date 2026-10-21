// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { generarDemo } from '../data/semilla';
import { callejeroSimulado, MEDINA } from '../data/callejero';
import { MUNICIPIO_DEMO, prepararMunicipioDemo } from '../data/escenarioIncorporacion';
import { aplicarEscenario, prepararEscenario } from './incorporacionDemo';
import {
  adopcion, ambitos, bandasVacancia, claseDe, cortesCuantiles, compararGrupos, concentracion, datosCampana, origenDatos, perfilGrupos, rankingCalles, distribucion, filtrar, indicePresencia, matrizCalor, MIN_CELDA, respuestas, resumen, topCalles, UMBRAL_CALLE, type UnidadPanel,
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
    expect(d.registrosSinEstablecimiento).toBe(30);
    // Incidencias de interpretación conservadas en los registros (no excluidos)
    expect(d.incidencias).toBe(298);
    expect(d.registrosConIncidencias).toBeGreaterThan(0);
    expect(d.registrosConIncidencias).toBeLessThanOrEqual(d.incidencias);
    expect(d.registrosExcluidos).toBe(0);
    expect(r).toMatchObject({ establecimientos: 860, locales: 846, negocios: 620, ocupados: 620, vacios: 240, sinLocal: 14 });
    expect(d.correspondencias).toEqual({ confirmada: 0, probable: 846, dudosa: 12, sinVinculo: 32 });
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

  it('registros sin establecimiento observado: se calcula registro a registro, también con observaciones manuales en la misma campaña', () => {
    const base = datosCampana(conHistorico, campanaHist);
    const calleId = base.unidades[0].calleId;
    // 40 observaciones manuales (oficina) en la MISMA campaña histórica, sin registro de origen.
    const manuales = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`obs-manual-${i}`, {
      id: `obs-manual-${i}`, campanaId: campanaHist, localId: null, calleId, fuente: 'oficina' as const, tipo: 'vacio' as const, datos: { numero: 900 + i, vacio: true }, verificacion: 'pendiente' as const,
    }]));
    const mixta: BaseDatos = { ...conHistorico, observaciones: { ...conHistorico.observaciones, ...manuales } };
    const d = datosCampana(mixta, campanaHist);
    expect(d.unidades).toHaveLength(base.unidades.length + 40);
    expect(d.registrosCensales).toBe(890);
    // Una resta daría 890 − 900 = −10; el cálculo directo no cambia: siguen siendo los mismos 30 registros.
    expect(d.registrosCensales - d.unidades.length).toBeLessThan(0);
    expect(d.registrosSinEstablecimiento).toBe(base.registrosSinEstablecimiento);
    // Una campaña sin importaciones no tiene registros sin establecimiento.
    expect(datosCampana(conHistorico, 'camp-medina-2026').registrosSinEstablecimiento).toBe(0);
  });
});

describe('Bloque 1 · Origen real de los datos y coordenadas verificadas', () => {
  it('distingue el tipo de campaña del origen de clasificación, franquicia y revisión digital', () => {
    const esc = origenDatos(datosCampana(conHistorico, campanaHist));
    expect(esc).toMatchObject({ historica: true, demostracion: true, ocupados: 620 });
    expect(esc.clasificacion).toEqual({ confirmada: 0, propuesta: 0, historica: 620, 'sin-clasificar': 0 });
    expect(esc.franquicia.importado).toBe(619);
    // Medina 2025 (demostración): de tipo histórico, pero con clasificaciones confirmadas en el modelo
    const m25 = origenDatos(datosCampana(conHistorico, 'camp-medina-2025'));
    expect(m25.historica).toBe(true);
    expect(m25.clasificacion.confirmada).toBeGreaterThan(0);
    expect(m25.clasificacion.historica).toBe(0);
    expect(m25.demostracion).toBe(true);
    expect(origenDatos(datosCampana(conHistorico, 'camp-medina-2026')).historica).toBe(false);
  });

  it('solo los locales con coordenadas verificadas tienen posición: nunca se usan las simuladas o interpoladas', () => {
    const d0 = datosCampana(demo, 'camp-medina-2026');
    expect(d0.unidades.every((x) => x.coord === undefined)).toBe(true);
    const conCoord = d0.unidades.find((x) => x.localId && demo.locales[x.localId].coord)!;
    const l = demo.locales[conCoord.localId!];
    const verificada: BaseDatos = { ...demo, locales: { ...demo.locales, [l.id]: { ...l, coordVerificada: { fuente: 'gps-campo', fecha: '2026-09-10' } } } };
    const d1 = datosCampana(verificada, 'camp-medina-2026');
    expect(d1.unidades.filter((x) => x.coord).map((x) => x.localId)).toEqual([l.id]);
    expect(d1.unidades.find((x) => x.localId === l.id)!.coord).toEqual(l.coord);
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

  it('ranking de calles: umbral en ocupados y vacíos, recuento absoluto por sector y composición de la calle', () => {
    const us = [
      ...Array.from({ length: 6 }, (_, i) => u({ calleId: 'a', calle: 'A', vacio: i > 3, sector: i < 2 ? 'Comercio' : i < 4 ? 'Servicios' : undefined })),
      ...Array.from({ length: 3 }, () => u({ calleId: 'b', calle: 'B', sector: 'Comercio' })),
    ];
    const oc = rankingCalles(us, 'ocupados');
    expect(oc.filas.map((f) => f.calle)).toEqual(['A']);
    expect(oc).toMatchObject({ consideradas: 1, total: 2, porSector: false });
    expect(oc.filas[0].composicion).toEqual({ Comercio: 2, Servicios: 2, 'Hostelería y Restauración': 0, 'Sin clasificar': 0, 'Vacíos': 2 });
    const com = rankingCalles(us, 'Comercio');
    // Por sector: todas las calles con presencia; la proporción solo si la calle alcanza el umbral
    expect(com.filas.map((f) => [f.calle, f.n, f.prop])).toEqual([['B', 3, null], ['A', 2, 2 / 6]]);
    expect(rankingCalles(us, 'Hostelería y Restauración').filas).toEqual([]);
    expect(rankingCalles(us, 'vacios').filas[0]).toMatchObject({ calle: 'A', n: 2, prop: 2 / 6 });
  });

  it('concentración, perfil por grupo (Sí entre Sí/No) y calles por tasa de vacío', () => {
    expect(concentracion([{ clave: 'a', etiqueta: 'a', n: 6 }, { clave: 'b', etiqueta: 'b', n: 3 }, { clave: 'c', etiqueta: 'c', n: 1 }, { clave: 'd', etiqueta: 'd', n: 0 }], 2))
      .toEqual({ k: 2, top: 9, total: 10, prop: 0.9, conValor: 3 });
    expect(concentracion([]).prop).toBeNull();
    const us = [u({ sector: 'Comercio', franquicia: 'si', d: { web: 'si' } }), u({ sector: 'Comercio', franquicia: 'pendiente', d: { web: 'pendiente' } }), u({ sector: 'Servicios', franquicia: 'no', d: { web: 'no' } }), u({ vacio: true, sector: 'Comercio' })];
    const p = perfilGrupos(us, (x) => x.sector);
    expect(p.map((g) => [g.grupo, g.n, g.franquicia, g.adopcion.web])).toEqual([
      ['Comercio', 2, { n: 1, den: 1 }, { n: 1, den: 1 }],
      ['Servicios', 1, { n: 0, den: 1 }, { n: 0, den: 1 }],
    ]);
    const calles = [
      ...Array.from({ length: 5 }, () => u({ calleId: 'a', calle: 'A' })),
      ...Array.from({ length: 5 }, (_, i) => u({ calleId: 'b', calle: 'B', vacio: i < 3 })),
      ...Array.from({ length: 2 }, () => u({ calleId: 'c', calle: 'C', vacio: true })),
    ];
    const b = bandasVacancia(calles);
    expect(b).toMatchObject({ consideradas: 2, total: 3, conVacios: 1 });
    expect(b.partes.map((x) => x.n)).toEqual([1, 0, 0, 1, 0]);
  });

  it('escala del mapa: cortes por cuantiles ajustados a los datos, sin clases duplicadas', () => {
    // Ocupaciones concentradas (70–100 %): una escala fija 0–100 % las pintaría todas igual
    const v = [0.7, 0.72, 0.75, 0.8, 0.82, 0.85, 0.9, 0.95, 1, 1];
    const c = cortesCuantiles(v);
    expect(c[c.length - 1]).toBe(1);
    expect(c.length).toBeGreaterThanOrEqual(4);
    expect([...c].sort((a, b) => a - b)).toEqual(c);
    expect(claseDe(0.7, c)).toBe(0);
    expect(claseDe(1, c)).toBe(c.length - 1);
    expect(cortesCuantiles([0.5, 0.5, 0.5])).toEqual([0.5]);
    expect(cortesCuantiles([])).toEqual([]);
  });

  it('coherencia: la composición por calle (mapa, matriz y rankings) suma lo mismo que los indicadores, con y sin filtros', () => {
    const d = datosCampana(conHistorico, campanaHist);
    for (const us of [d.unidades, filtrar(d.unidades, { cp: '47400' }), filtrar(d.unidades, { calleId: d.unidades[0].calleId })]) {
      const r = resumen(us);
      const calles = rankingCalles(us, 'ocupados', 1, Infinity).filas;
      const suma = (k: 'Comercio' | 'Servicios' | 'Hostelería y Restauración' | 'Sin clasificar' | 'Vacíos') => calles.reduce((a, f) => a + f.composicion[k], 0);
      expect(calles.reduce((a, f) => a + f.observados, 0)).toBe(r.establecimientos);
      expect(suma('Vacíos')).toBe(r.vacios);
      expect(suma('Comercio') + suma('Servicios') + suma('Hostelería y Restauración') + suma('Sin clasificar')).toBe(r.ocupados);
      for (const s of ['Comercio', 'Servicios', 'Hostelería y Restauración'] as const) expect(suma(s)).toBe(us.filter((u) => !u.vacio && u.sector === s).length);
    }
  });
});
