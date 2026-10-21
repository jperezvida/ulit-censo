// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import ExcelJS from 'exceljs';
import { generarDemo } from '../data/semilla';
import { callejeroSimulado, MEDINA } from '../data/callejero';
import { libroFicticio } from '../data/xlsxFicticio';
import { conCallesFicticias, viasFicticias } from '../data/escenarioIncorporacion';
import { aplicarIncorporacion, comprobarIntegridad, deshacerIncorporacion, planificarIncorporacion, type DecisionesIncorporacion, type DestinoIncorporacion } from './incorporacion';
import { prepararIncorporacion } from './incorporacionXlsx';
import { filasOficina } from './oficina';
import { indiceObservaciones, indiceOcupaciones, ocupacionEn } from './consultas';
import { TAXONOMIA } from './taxonomy';
import { ID_CATALOGO_2026 } from './catalogo2026';
import type { BaseDatos } from './db';
import type { ColeccionIncorporada } from './types';
import { useStore } from '../store/store';

/** Todo es FICTICIO: libros generados en memoria y un callejero de «VÍA FICTICIA nnn». */
const DEST: DestinoIncorporacion = { municipioId: 'mun-medina', anio: 2025 };
const AHORA = '2026-10-21T10:00:00.000Z';
let demo: BaseDatos;
let base: BaseDatos;

beforeAll(() => {
  demo = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'c1c' });
  // Calles 001–006 existen; 007 y 008 no (filas sin correspondencia de calle).
  base = conCallesFicticias(demo, 'mun-medina', viasFicticias(1, 6));
});

async function preparar(db: BaseDatos, o: Parameters<typeof libroFicticio>[0] = {}, dec: DecisionesIncorporacion = {}, destino = DEST, bytes?: Uint8Array) {
  const b = bytes ?? (await libroFicticio({ filas: 60, anomalias: true, ...o }));
  return { bytes: b, ...(await prepararIncorporacion(db, b, 'ficticio.xlsx', destino, dec)) };
}
const aplicar = (db: BaseDatos, p: Awaited<ReturnType<typeof preparar>>, dec: DecisionesIncorporacion = {}, extra: { pruebaFalloTrasFilas?: number } = {}, destino = DEST) =>
  aplicarIncorporacion(db, p.resultado, destino, dec, p.plan, { porId: 'p-elena', ahora: AHORA, ...extra });

/** Instantánea comparable de todo lo que ve la campaña 2026. */
function vista2026(db: BaseDatos) {
  const id = 'camp-medina-2026';
  const ix = { obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) };
  const pick = <T extends { campanaId: string }>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([, x]) => x.campanaId === id));
  return JSON.stringify({
    campana: db.campanas[id], filas: filasOficina(db, id, ix), ref: filasOficina(db, 'camp-medina-2025', ix),
    ocupaciones: Object.keys(db.locales).filter((l) => demo.locales[l]).map((l) => ocupacionEn(db, l, id, ix.ocu)?.id ?? null),
    revisiones: pick(db.revisiones), digital: pick(db.digital), clasificaciones: pick(db.clasificaciones), franquicias: pick(db.franquicias),
    itinerarios: Object.values(db.itinerarios).filter((i) => i.campanaId === id), observaciones: Object.values(db.observaciones).filter((o) => o.campanaId === id),
  });
}

describe('C1c · Plan previo (no modifica nada)', () => {
  it('muestra archivo, SHA-256, perfil, municipio, destino, entidades, correspondencias, incidencias y pendientes', async () => {
    const antes = JSON.stringify(base);
    const { plan } = await preparar(base, { repetidas: 2 });
    expect(JSON.stringify(base)).toBe(antes);
    expect(plan.aplicable).toBe(true);
    expect(plan.archivo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.perfil).toEqual({ id: 'censo-municipal-27', version: 1 });
    expect(plan.municipio).toEqual({ id: 'mun-medina', nombre: 'Medina del Campo' });
    expect(plan.destino).toMatchObject({ anio: 2025, nueva: true });
    expect(plan.registros.previstos).toBe(62);
    expect(plan.nuevas.registros).toBe(62);
    // 12 filas en calles 007-008 (sin calle), 1 S/N, y las 4 filas de las 2 direcciones repetidas
    expect(plan.correspondencias.porMotivo).toEqual({ 'calle-sin-correspondencia': 12, 'sin-numero': 1, 'direccion-repetida-en-archivo': 4 });
    expect(plan.correspondencias.inequivoca).toBe(62 - 12 - 1 - 4);
    expect(plan.nuevas.locales).toBe(plan.correspondencias.inequivoca);
    expect(plan.nuevas.clasificaciones).toBe(0);
    expect(plan.incidencias.total).toBeGreaterThan(0);
    expect(plan.pendientes.join('\n')).toMatch(/fachada-con-unidad[\s\S]*diccionario-sin-informacion[\s\S]*ambigua[\s\S]*sin vínculo[\s\S]*sin equivalencia aprobada/);
  });

  it('no acepta un año con una campaña en curso ni decisiones sin firmar o inventadas', async () => {
    const p26 = await preparar(base, {}, {}, { municipioId: 'mun-medina', anio: 2026 });
    expect(p26.plan.bloqueos.map((b) => b.codigo)).toContain('destino-invalido');
    const malas: DecisionesIncorporacion = {
      reglasAutorizadas: [{ regla: 'binario-01', porId: 'p-elena', fecha: '2026-10-01' }, { regla: 'fachada-con-unidad', porId: 'nadie', fecha: '' }],
      exclusiones: [{ fila: 999, porId: 'p-elena', fecha: '2026-10-01', motivo: '' }],
      equivalenciasClasificacion: [{ actividadId: 'no-existe', porId: 'p-elena', fecha: '2026-10-01' }],
    };
    const { plan } = await preparar(base, {}, malas);
    expect(plan.aplicable).toBe(false);
    expect(plan.bloqueos[0].codigo).toBe('decision-invalida');
    expect(plan.bloqueos[0].detalles.join('\n')).toMatch(/binario-01.*no es una regla de clase «propuesta»[\s\S]*persona «nadie» no existe[\s\S]*falta la fecha[\s\S]*fila 999[\s\S]*no-existe/);
  });

  it('la interpretación debe haberse hecho con las mismas decisiones (no se cuela ninguna regla)', async () => {
    const p = await preparar(base, {}, { reglasAutorizadas: [{ regla: 'fachada-con-unidad', porId: 'p-elena', fecha: '2026-10-01' }] });
    const plan = planificarIncorporacion(base, p.resultado, DEST, {});
    expect(plan.bloqueos.map((b) => b.codigo)).toEqual(['interpretacion-incoherente']);
  });
});

describe('C1c · Incorporación del histórico', () => {
  it('crea una campaña histórica nueva sin alterar 2026 ni la referencia 2025 existente', async () => {
    const p = await preparar(base, { repetidas: 2 });
    const antes = vista2026(base);
    const r = aplicar(base, p);
    expect(vista2026(r.db)).toBe(antes);
    const c = r.db.campanas[r.campanaId];
    expect(c).toMatchObject({ anio: 2025, tipo: 'historico-importado', procedencia: 'importado', estados: { revision: 'pendiente', validacion: 'pendiente' } });
    expect(c.ambitoCalleIds.sort()).toEqual(Object.values(base.calles).filter((x) => x.nombre.startsWith('VÍA FICTICIA')).map((x) => x.id).sort());
    // Todas las demás campañas, intactas
    for (const id of Object.keys(base.campanas)) expect(r.db.campanas[id]).toBe(base.campanas[id]);
    // Las ocupaciones importadas quedan cerradas en la campaña histórica
    const ocs = Object.values(r.db.ocupaciones).filter((o) => o.desdeCampanaId === r.campanaId);
    expect(ocs.length).toBe(p.plan.nuevas.ocupaciones);
    expect(ocs.every((o) => o.hastaCampanaId === r.campanaId)).toBe(true);
    expect(r.creadas).toMatchObject({ campanas: 1, registros: 62, locales: p.plan.nuevas.locales, negocios: p.plan.nuevas.negocios, vinculos: 62 });
  });

  it('conserva todas las filas y sus valores originales con tipo y formato, aunque tengan celdas inválidas', async () => {
    const p = await preparar(base);
    const r = aplicar(base, p);
    const regs = Object.values(r.db.registros).filter((x) => x.importacionId === r.importacionId).sort((a, b) => a.fila - b.fila);
    expect(regs).toHaveLength(60);
    regs.forEach((reg, i) => expect(reg.original).toEqual(p.resultado.original.filas[i].celdas));
    const conWeb4 = regs.find((x) => x.original!.web?.t === 'numero' && (x.original!.web as { v: number }).v === 4)!;
    expect(conWeb4.interpretacion!.celdas.web).toMatchObject({ estado: 'invalido' });
    expect(conWeb4.interpretacion!.incidencias).toContain('binario-invalido');
    const fechaTexto = regs.find((x) => x.original!.fecha?.t === 'texto')!;
    expect(fechaTexto.original!.fecha).toEqual({ t: 'texto', v: 'FECHA PENDIENTE' });
    expect(regs[0].original!.fecha).toMatchObject({ t: 'fecha', formato: 'dd/mm/yyyy' });
    // `datos` (texto, compatibilidad) sigue existiendo con las cabeceras originales
    expect(regs[0].datos['Fecha censo']).toMatch(/^2025-\d{2}-\d{2}$/);
    expect(Object.keys(regs[0].datos)).toContain('Gr Comercio');
    expect(regs[0].huellaFila).toMatch(/^[0-9a-f]{8}$/);
  });

  it('ocupados y vacíos: negocio literal, ocupación 2025 con fecha real, nada revisado ni verificado', async () => {
    const p = await preparar(base);
    const r = aplicar(base, p);
    const fi = (n: number) => p.resultado.filas.find((f) => f.fila === n)!;
    const vacio = p.plan.filas.find((f) => f.local === 'vacio' && f.localNuevo && fi(f.fila).celdas.fachada.estado === 'valido')!;
    const ocupado = p.plan.filas.find((f) => f.local === 'ocupado' && f.localNuevo && fi(f.fila).celdas.fecha.estado === 'valido')!;
    const ocV = r.db.ocupaciones[`ocu-${r.importacionId}-${vacio.fila}`];
    expect(ocV).toMatchObject({ negocioId: null, metrosFachada: expect.any(Number), desdeFecha: expect.stringMatching(/^2025-/) });
    expect(r.db.observaciones[`obs-${r.importacionId}-${vacio.fila}`]).toMatchObject({ tipo: 'vacio', verificacion: 'pendiente', fuente: 'importacion' });
    const neg = r.db.negocios[`neg-${r.importacionId}-${ocupado.fila}`];
    expect(neg.nombre).toBe(fi(ocupado.fila).celdas.nombre.valor);
    expect(neg.cadena).toBeUndefined();
    expect(r.db.ocupaciones[`ocu-${r.importacionId}-${ocupado.fila}`]).toMatchObject({ negocioId: neg.id, desdeFecha: fi(ocupado.fila).celdas.fecha.valor });
    // Ningún dato histórico queda revisado, verificado, validado ni confirmado
    expect(Object.values(r.db.revisiones).some((x) => x.campanaId === r.campanaId)).toBe(false);
    expect(Object.values(r.db.digital).filter((d) => d.campanaId === r.campanaId).every((d) => d.estado === 'borrador' && Object.values(d.datos).every((x) => x!.origen === 'importado'))).toBe(true);
    expect(Object.values(r.db.franquicias).filter((f) => f.campanaId === r.campanaId).every((f) => f.origen === 'importado' && !f.porId)).toBe(true);
    expect(Object.values(r.db.observaciones).filter((o) => o.campanaId === r.campanaId).every((o) => o.verificacion === 'pendiente')).toBe(true);
    expect(Object.values(r.db.negocios).filter((n) => n.id.startsWith('neg-imp-c1')).every((n) => n.cadena === undefined)).toBe(true);
    // Sin equivalencia aprobada no hay ClasificacionCampana: los cinco textos siguen en el registro
    expect(Object.values(r.db.clasificaciones).some((c) => c.campanaId === r.campanaId)).toBe(false);
    const reg = r.db.registros[`reg-${r.importacionId}-${ocupado.fila}`];
    expect(Object.keys(reg.original!)).toEqual(expect.arrayContaining(['grupoActividad', 'subgrupo', 'actividad']));
    expect(reg.interpretacion!.clasificacion).toMatchObject({ confirmada: false });
  });

  it('valores inválidos y pendientes no llegan al modelo; solo con una decisión firmada se aplica la regla', async () => {
    const p = await preparar(base);
    const r = aplicar(base, p);
    const filaDe = (pred: (f: (typeof p.resultado.filas)[number]) => boolean) => p.resultado.filas.find(pred)!.fila;
    const web4 = filaDe((f) => f.celdas.web?.regla === 'binario-fuera-de-dominio');
    expect(r.db.digital[`neg-${r.importacionId}-${web4}|${r.campanaId}`]?.datos.web).toBeUndefined();
    const sinDato = filaDe((f) => f.celdas.seguidoresInstagram?.estado === 'pendiente');
    expect(r.db.digital[`neg-${r.importacionId}-${sinDato}|${r.campanaId}`]?.datos.seguidoresInstagram).toBeUndefined();
    const fachada = filaDe((f) => f.celdas.fachada?.regla === 'fachada-con-unidad');
    expect(r.db.ocupaciones[`ocu-${r.importacionId}-${fachada}`]?.metrosFachada).toBeUndefined();
    const fechaMala = filaDe((f) => f.celdas.fecha?.estado === 'invalido');
    expect(r.db.observaciones[`obs-${r.importacionId}-${fechaMala}`]?.fecha).toBeUndefined();
    // Con la regla autorizada y firmada, «3,5 m» pasa a 3,5 m
    const dec: DecisionesIncorporacion = { reglasAutorizadas: [{ regla: 'fachada-con-unidad', porId: 'p-elena', fecha: '2026-10-20', motivo: 'Acuerdo de la Cátedra (simulado)' }] };
    const p2 = await preparar(base, {}, dec);
    const r2 = aplicar(base, p2, dec);
    expect(r2.db.ocupaciones[`ocu-${r2.importacionId}-${fachada}`]?.metrosFachada).toBe(3.5);
    expect(r2.db.importaciones[r2.importacionId].c1!.decisiones).toEqual(dec);
  });

  it('una equivalencia de clasificación aprobada crea la clasificación como importada y sin confirmar', async () => {
    const pan = TAXONOMIA.find((n) => n.catalogo === ID_CATALOGO_2026 && n.nivel === 4 && n.nombre === 'Bar')!;
    const dec: DecisionesIncorporacion = { equivalenciasClasificacion: [{ grupo: 'Hostelería y Restauración', subgrupo: 'Bares y Cafeterías', actividad: 'Bar', actividadId: pan.id, porId: 'p-elena', fecha: '2026-10-20' }] };
    const p = await preparar(base, {}, dec);
    const r = aplicar(base, p, dec);
    const cls = Object.values(r.db.clasificaciones).filter((c) => c.campanaId === r.campanaId);
    expect(cls.length).toBe(p.plan.nuevas.clasificaciones);
    expect(cls.length).toBeGreaterThan(0);
    expect(cls.every((c) => c.actividadId === pan.id && c.origen === 'importado' && c.confirmada === false && c.catalogoId === ID_CATALOGO_2026)).toBe(true);
  });
});

describe('C1c · Correspondencias: direcciones repetidas, locales existentes y calles sin correspondencia', () => {
  it('dos negocios en la misma dirección no se resuelven como dos locales: quedan sin local y pendientes', async () => {
    const p = await preparar(base, { repetidas: 2 });
    const r = aplicar(base, p);
    const amb = p.plan.filas.filter((f) => f.motivo === 'direccion-repetida-en-archivo');
    expect(amb).toHaveLength(4);
    for (const f of amb) {
      expect(f.localId).toBeUndefined();
      const v = r.db.vinculos[`vin-reg-${r.importacionId}-${f.fila}`];
      expect(v).toMatchObject({ localId: null, confianza: 'dudosa' });
      expect(r.db.observaciones[`obs-${r.importacionId}-${f.fila}`]).toMatchObject({ localId: null });
      expect(r.db.locales[`loc-${r.importacionId}-${f.fila}`]).toBeUndefined();
    }
    // Ambos negocios existen (identidad comercial), sin local ni ocupación
    expect(amb.filter((f) => r.db.negocios[`neg-${r.importacionId}-${f.fila}`]).length).toBe(amb.filter((f) => f.negocio).length);
    expect(amb.every((f) => !r.db.ocupaciones[`ocu-${r.importacionId}-${f.fila}`])).toBe(true);
  });

  it('una decisión humana firmada puede separarlos en dos locales (vínculo confirmado con revisor)', async () => {
    const p0 = await preparar(base, { repetidas: 1 });
    const filas = p0.plan.filas.filter((f) => f.motivo === 'direccion-repetida-en-archivo').map((f) => f.fila);
    const dec: DecisionesIncorporacion = { correspondencias: filas.map((fila) => ({ fila, accion: 'local-nuevo' as const, porId: 'p-elena', fecha: '2026-10-20', motivo: 'Comprobado en campo: dos locales' })) };
    const p = await preparar(base, { repetidas: 1 }, dec);
    const r = aplicar(base, p, dec);
    for (const fila of filas) {
      expect(r.db.locales[`loc-${r.importacionId}-${fila}`]).toBeDefined();
      expect(r.db.vinculos[`vin-reg-${r.importacionId}-${fila}`]).toMatchObject({ confianza: 'confirmada', revisadoPorId: 'p-elena' });
    }
  });

  it('un local ya existente en la dirección no se reutiliza automáticamente: se propone como candidato', async () => {
    const calle = Object.values(base.calles).find((c) => c.nombre === 'VÍA FICTICIA 001')!;
    const conLocal: BaseDatos = { ...base, locales: { ...base.locales, 'loc-previo': { id: 'loc-previo', municipioId: 'mun-medina', direcciones: [{ calleId: calle.id, numero: 3 }], estado: 'activo', procedencia: 'simulado' } } };
    const p = await preparar(conLocal);
    const f = p.plan.filas.find((x) => x.motivo === 'local-existente-en-direccion')!;
    expect(f).toMatchObject({ correspondencia: 'ambigua', candidatos: ['loc-previo'], localNuevo: false });
    const r = aplicar(conLocal, p);
    expect(r.db.vinculos[`vin-reg-${r.importacionId}-${f.fila}`]).toMatchObject({ localId: null, confianza: 'dudosa', candidatos: [{ localId: 'loc-previo' }] });
    expect(r.db.locales['loc-previo']).toBe(conLocal.locales['loc-previo']);
    // Con decisión firmada se vincula al local existente
    const dec: DecisionesIncorporacion = { correspondencias: [{ fila: f.fila, accion: 'local-existente', localId: 'loc-previo', porId: 'p-elena', fecha: '2026-10-20' }] };
    const p2 = await preparar(conLocal, {}, dec);
    const r2 = aplicar(conLocal, p2, dec);
    expect(r2.db.ocupaciones[`ocu-${r2.importacionId}-${f.fila}`]).toMatchObject({ localId: 'loc-previo', hastaCampanaId: r2.campanaId });
    expect(r2.creadas.locales).toBe(p2.plan.nuevas.locales);
    // …salvo que el local tenga ya una ocupación de otra campaña del mismo año
    const local25 = Object.values(demo.ocupaciones).find((o) => o.desdeCampanaId === 'camp-medina-2025')!.localId;
    const p3 = await preparar(conLocal, {}, { correspondencias: [{ fila: f.fila, accion: 'local-existente', localId: local25, porId: 'p-elena', fecha: '2026-10-20' }] });
    expect(p3.plan.bloqueos[0].detalles.join()).toMatch(/ya tiene una ocupación de otra campaña de 2025/);
  });

  it('una calle sin correspondencia conserva el registro sin inventar calle, local ni negocio', async () => {
    const p = await preparar(base);
    const r = aplicar(base, p);
    const sin = p.plan.filas.filter((f) => f.motivo === 'calle-sin-correspondencia');
    expect(sin).toHaveLength(12);
    for (const f of sin) {
      expect(r.db.registros[`reg-${r.importacionId}-${f.fila}`].original!.direccion).toMatchObject({ t: 'texto' });
      expect(r.db.vinculos[`vin-reg-${r.importacionId}-${f.fila}`]).toMatchObject({ localId: null, confianza: 'sin-vinculo' });
      for (const p of ['obs', 'neg', 'loc', 'ocu']) expect((r.db as unknown as Record<string, Record<string, unknown>>)[{ obs: 'observaciones', neg: 'negocios', loc: 'locales', ocu: 'ocupaciones' }[p]!][`${p}-${r.importacionId}-${f.fila}`]).toBeUndefined();
    }
  });
});

describe('C1c · Posibles totales y exclusiones', () => {
  it('una posible fila de totales se incorpora como registro salvo exclusión firmada; excluida, se conserva el registro', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await libroFicticio({ filas: 16, auxiliares: false })) as unknown as ArrayBuffer);
    wb.getWorksheet('Datos')!.addRow(['Total general']);
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const p = await preparar(base, {}, {}, DEST, bytes);
    expect(p.plan.registros.candidatasExcluir).toEqual([{ fila: 18, decidida: false }]);
    expect(p.plan.pendientes.join()).toMatch(/posible\(s\) fila\(s\) de totales sin decidir/);
    const r = aplicar(base, p);
    expect(r.db.registros[`reg-${r.importacionId}-18`]).toBeDefined();
    const dec: DecisionesIncorporacion = { exclusiones: [{ fila: 18, porId: 'p-elena', fecha: '2026-10-20', motivo: 'Fila de totales confirmada' }] };
    const p2 = await preparar(base, {}, dec, DEST, bytes);
    const r2 = aplicar(base, p2, dec);
    expect(r2.db.registros[`reg-${r2.importacionId}-18`].exclusion).toEqual({ porId: 'p-elena', fecha: '2026-10-20', motivo: 'Fila de totales confirmada' });
    expect(r2.db.vinculos[`vin-reg-${r2.importacionId}-18`]).toBeUndefined();
    expect(p2.plan.registros).toMatchObject({ previstos: 17, excluidos: 1 });
  });
});

describe('C1c · Reimportación', () => {
  it('el mismo archivo otra vez: resultado controlado, sin duplicar nada', async () => {
    const p = await preparar(base);
    const r = aplicar(base, p);
    const p2 = await preparar(r.db, {}, {}, DEST, p.bytes);
    expect(p2.plan.aplicable).toBe(false);
    expect(p2.plan.bloqueos.map((b) => b.codigo)).toEqual(['reimportacion-identica']);
    expect(p2.plan.reimportacion).toMatchObject({ importacionId: r.importacionId, filasIguales: 60, filasCambiadas: [] });
    const r2 = aplicar(r.db, p2);
    expect(r2.sinCambios).toBe(true);
    expect(r2.db).toBe(r.db);
  });

  it('un archivo modificado exige nueva conciliación y no sobrescribe el histórico', async () => {
    const p = await preparar(base);
    const r = aplicar(base, p);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(p.bytes as unknown as ArrayBuffer);
    wb.getWorksheet('Datos')!.getRow(10).getCell(9).value = 'COMERCIO FICTICIO RENOMBRADO';
    const otro = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const p2 = await preparar(r.db, {}, {}, DEST, otro);
    expect(p2.plan.bloqueos.map((b) => b.codigo)).toEqual(['archivo-distinto']);
    expect(p2.plan.reimportacion).toMatchObject({ filasCambiadas: [10], filasNuevas: [], filasDesaparecidas: [], filasIguales: 59 });
    expect(() => aplicar(r.db, p2)).toThrow(/nueva conciliación/);
  });
});

describe('C1c · Identidad de una incorporación (municipio, año, SHA-256 y perfil con versión)', () => {
  it('el mismo archivo en dos años históricos distintos no se trata como la misma incorporación', async () => {
    const D24: DestinoIncorporacion = { municipioId: 'mun-medina', anio: 2024 };
    const p25 = await preparar(base);
    const r25 = aplicar(base, p25);
    const p24 = await preparar(r25.db, {}, {}, D24, p25.bytes);
    expect(p24.plan.aplicable).toBe(true);
    expect(p24.plan.bloqueos).toEqual([]);
    expect(p24.plan.reimportacion).toBeUndefined();
    expect(p24.plan.pendientes.join('\n')).toMatch(new RegExp(`ya se incorporó como histórico de 2025 \\(importación «${r25.importacionId}»\\)`));
    const r24 = aplicar(r25.db, p24, {}, {}, D24);
    expect(r24.sinCambios).toBeUndefined();
    expect(r24.importacionId).not.toBe(r25.importacionId);
    expect(r24.campanaId).not.toBe(r25.campanaId);
    expect(r24.db.campanas[r24.campanaId].anio).toBe(2024);
    expect(r24.creadas.registros).toBe(60);
    // Cada año reconoce SOLO su propia incorporación como idéntica
    for (const [d, r] of [[D24, r24], [DEST, r25]] as const) {
      const again = await preparar(r24.db, {}, {}, d, p25.bytes);
      expect(again.plan.bloqueos.map((b) => b.codigo)).toEqual(['reimportacion-identica']);
      expect(again.plan.reimportacion?.importacionId).toBe(r.importacionId);
      expect(aplicar(r24.db, again, {}, {}, d).sinCambios).toBe(true);
    }
  });

  it('el mismo archivo con otra versión del perfil en el mismo ámbito exige conciliación', async () => {
    const p = await preparar(base);
    const r = aplicar(base, p);
    const imp = r.db.importaciones[r.importacionId];
    const conV0: BaseDatos = { ...r.db, importaciones: { ...r.db.importaciones, [imp.id]: { ...imp, c1: { ...imp.c1!, perfil: { ...imp.c1!.perfil, version: 0 } } } } };
    const p2 = await preparar(conV0, {}, {}, DEST, p.bytes);
    // Además de exigir conciliación, la campaña e importación de ese archivo y año ya existen
    expect(p2.plan.bloqueos.map((b) => b.codigo)).toEqual(['archivo-distinto', 'destino-invalido', 'destino-invalido']);
    expect(p2.plan.bloqueos[0].detalles[0]).toBe('Mismo archivo, perfil v0 → v1');
    expect(() => aplicar(conV0, p2)).toThrow(/nueva conciliación/);
  });
});

describe('C1c · Atomicidad, integridad y deshacer', () => {
  it('un fallo a mitad no deja cambios parciales (ni en la base ni en el almacén de la aplicación)', async () => {
    const p = await preparar(base);
    const antes = JSON.stringify(base);
    expect(() => aplicar(base, p, {}, { pruebaFalloTrasFilas: 30 })).toThrow(/Fallo simulado tras 30 filas/);
    expect(JSON.stringify(base)).toBe(antes);
    useStore.setState({ db: base, pilaDeshacer: [], pilaRehacer: [] });
    const ok = useStore.getState().aplicar((db) => aplicar(db, p, {}, { pruebaFalloTrasFilas: 30 }).db, 'Incorporar', { silencioso: true, sinAvisoError: true });
    expect(ok).toBe(false);
    expect(useStore.getState().db).toBe(base);
  });

  it('un plan obsoleto (la base cambió) no se aplica', async () => {
    const p = await preparar(base);
    const cambiada = conCallesFicticias(base, 'mun-medina', ['VÍA FICTICIA 007']);
    expect(() => aplicar(cambiada, p)).toThrow(/han cambiado desde que se preparó el plan/);
  });

  it('integridad referencial de todo lo creado', async () => {
    const p = await preparar(base, { repetidas: 2 });
    const r = aplicar(base, p);
    const c1 = r.db.importaciones[r.importacionId].c1!;
    const creadas = Object.fromEntries(Object.entries(c1.creadas).map(([k, v]) => [k, Object.keys(v!)])) as Record<ColeccionIncorporada, string[]>;
    expect(comprobarIntegridad(r.db, creadas, r.importacionId)).toEqual([]);
    expect(Object.values(c1.creadas).reduce((a, x) => a + Object.keys(x!).length, 0)).toBe(Object.values(r.creadas).reduce((a, b) => a + b, 0));
    expect(c1).toMatchObject({ sha256: p.plan.archivo.sha256, perfil: p.plan.perfil, porId: 'p-elena', firmaPlan: p.plan.firma, modificadas: {} });
    expect(r.db.importaciones[r.importacionId]).toMatchObject({ huella: p.plan.archivo.sha256, estado: 'confirmada', tipo: 'A-censo-historico' });
  });

  it('deshacer completo devuelve la base a su estado anterior (salvo la traza de la importación deshecha)', async () => {
    const p = await preparar(base, { repetidas: 2 });
    const r = aplicar(base, p);
    const u = deshacerIncorporacion(r.db, r.importacionId, 'p-elena', AHORA);
    const { importaciones: iu, secuencia: _su, ...restoU } = u;
    const { importaciones: ib, secuencia: _sb, ...restoB } = base;
    expect(JSON.stringify(restoU)).toBe(JSON.stringify(restoB));
    expect(Object.keys(iu).filter((k) => !ib[k])).toEqual([r.importacionId]);
    expect(iu[r.importacionId]).toMatchObject({ estado: 'descartada', c1: { deshecha: { porId: 'p-elena', fecha: AHORA } } });
    expect(() => deshacerIncorporacion(u, r.importacionId, 'p-elena')).toThrow(/ya se deshizo/);
    // Tras deshacer, se puede volver a incorporar (con otra traza)
    const p2 = await preparar(u, {}, {}, DEST, p.bytes);
    expect(p2.plan.aplicable).toBe(true);
    expect(p2.plan.destino.importacionId).toBe(`${r.importacionId}-2`);
  });

  it('deshacer restaura las colecciones pero no retrocede la secuencia global de orden', async () => {
    const p = await preparar(base);
    const r = aplicar(base, p);
    const s0 = base.secuencia;
    const s1 = r.db.secuencia;
    expect(s1).toBe(s0 + p.plan.nuevas.observaciones + p.plan.nuevas.ocupaciones);
    const u = deshacerIncorporacion(r.db, r.importacionId, 'p-elena', AHORA);
    expect(u.secuencia).toBe(s1);
    // Lo registrado después del deshacer ordena siempre detrás de lo ya emitido: ningún número se reutiliza
    const p2 = await preparar(u, {}, {}, DEST, p.bytes);
    const r2 = aplicar(u, p2);
    const ordenes = [...Object.values(r2.db.observaciones), ...Object.values(r2.db.ocupaciones)].filter((x) => x.id.includes(r2.importacionId)).map((x) => x.orden!);
    expect(Math.min(...ordenes)).toBe(s1 + 1);
    const usados = new Set([...Object.values(r.db.observaciones), ...Object.values(r.db.ocupaciones)].filter((x) => x.id.includes(r.importacionId)).map((x) => x.orden));
    expect(ordenes.some((o) => usados.has(o))).toBe(false);
  });

  it('protege los cambios posteriores: deshacer se bloquea y lo explica, sin tocar nada', async () => {
    const p = await preparar(base);
    const r = aplicar(base, p);
    const negId = Object.keys(r.db.negocios).find((k) => k.startsWith(`neg-${r.importacionId}`))!;
    const locId = Object.keys(r.db.locales).find((k) => k.startsWith(`loc-${r.importacionId}`))!;
    const casos: [string, BaseDatos, RegExp][] = [
      ['negocio renombrado', { ...r.db, negocios: { ...r.db.negocios, [negId]: { ...r.db.negocios[negId], nombre: 'Corregido en oficina' } } }, /negocios «.*» se ha modificado/],
      ['observación nueva sobre un local importado', { ...r.db, observaciones: { ...r.db.observaciones, 'obs-posterior': { ...Object.values(r.db.observaciones)[0], id: 'obs-posterior', campanaId: 'camp-medina-2026', localId: locId } } }, /Observación posterior «obs-posterior»/],
      ['clasificación manual de un negocio importado', { ...r.db, clasificaciones: { ...r.db.clasificaciones, [`${negId}|camp-medina-2026`]: { negocioId: negId, campanaId: 'camp-medina-2026', actividadId: TAXONOMIA[5].id, origen: 'manual', confirmada: true } } }, /clasificaciones posterior/],
      ['registro importado borrado', { ...r.db, registros: Object.fromEntries(Object.entries(r.db.registros).filter(([k]) => k !== `reg-${r.importacionId}-2`)) }, /registros «.*» ya no existe/],
    ];
    for (const [nombre, db, motivo] of casos) {
      const antes = JSON.stringify(db);
      let error: unknown;
      try {
        deshacerIncorporacion(db, r.importacionId, 'p-elena');
      } catch (e) {
        error = e;
      }
      expect(error, nombre).toMatchObject({ codigo: 'bloqueado' });
      expect((error as { detalles: string[] }).detalles.join('\n'), nombre).toMatch(motivo);
      expect(JSON.stringify(db), nombre).toBe(antes);
    }
  });
});

describe('C1c · Perfiles de 27 y 28 columnas', () => {
  it('el itinerario de 28 columnas se incorpora con las mismas reglas', async () => {
    const p = await preparar(base, { perfil: 'itinerario-28', filas: 40 });
    expect(p.plan.perfil.id).toBe('itinerario-medina-2026-28');
    const r = aplicar(base, p);
    const reg = Object.values(r.db.registros).find((x) => x.importacionId === r.importacionId)!;
    expect(Object.keys(reg.original!)).toEqual(expect.arrayContaining(['municipio', 'itinerario']));
    expect(reg.original!.distrito).toBeUndefined();
    expect(r.db.importaciones[r.importacionId].c1!.columnas).toHaveLength(28);
    expect(r.creadas.locales).toBeGreaterThan(0);
  });
});

describe('C1c · Rendimiento y persistencia con 10.000 registros', () => {
  it('planifica, aplica, guarda en IndexedDB y deshace 10.000 filas sintéticas', async () => {
    const db = conCallesFicticias(demo, 'mun-medina', viasFicticias(1, 1250));
    const bytes = await libroFicticio({ filas: 10000, anomalias: true });
    const t0 = performance.now();
    const p = await prepararIncorporacion(db, bytes, 'ficticio-10000.xlsx', DEST);
    const t1 = performance.now();
    const r = aplicarIncorporacion(db, p.resultado, DEST, {}, p.plan, { porId: 'p-elena', ahora: AHORA });
    const t2 = performance.now();
    const json = JSON.stringify(r.db);
    await idbSet('c1c-prueba', r.db);
    const leida = await idbGet<BaseDatos>('c1c-prueba');
    const t3 = performance.now();
    const u = deshacerIncorporacion(r.db, r.importacionId, 'p-elena', AHORA);
    const t4 = performance.now();
    console.info(`[C1c] 10.000 filas: lectura+interpretación+plan ${Math.round(t1 - t0)} ms · aplicación ${Math.round(t2 - t1)} ms · guardado+lectura IndexedDB ${Math.round(t3 - t2)} ms (${(json.length / 1048576).toFixed(1)} MB) · deshacer ${Math.round(t4 - t3)} ms`);
    expect(r.creadas.registros).toBe(10000);
    expect(Object.keys(leida!.registros).length).toBe(Object.keys(r.db.registros).length);
    expect(leida!.importaciones[r.importacionId].c1!.sha256).toBe(p.plan.archivo.sha256);
    expect(Object.keys(u.registros).length).toBe(Object.keys(db.registros).length);
    expect(t2 - t1).toBeLessThan(10000);
  }, 180000);
});
