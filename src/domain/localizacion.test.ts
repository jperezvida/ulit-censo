// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { CASOS_GENERALIDAD, DIRECCIONES_E } from '../data/xlsxGeneralidad';
import { libroFicticio } from '../data/xlsxFicticio';
import { validarInstantanea } from '../data/instantaneaOsm';
import { analizarXlsx } from './xlsx/analisis';
import { interpretarXlsx, localizacionDe } from './xlsx/interpretacion';
import { asignarColumna, evaluarCorrespondencia, perfilDesdeCorrespondencia, validarPerfil } from './xlsx/correspondencia';
import { crearBaseEspacio, municipioDeEspacio } from './espacios';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion, type DecisionesIncorporacion } from './incorporacion';
import { conciliacionCalles, diagnosticoAgregado } from './c1e';

/**
 * Localización INCOMPLETA: censos sin columna de número, con «S/N» o con la dirección completa en una
 * sola celda. Siempre se conserva el registro original; los vínculos territoriales que no se pueden
 * resolver con seguridad quedan pendientes; nunca se inventan números; los locales físicos solo se
 * crean con calle única del callejero + número de portal + estado del local conocido.
 */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

const caso = (id: string) => CASOS_GENERALIDAD.find((c) => c.id === id)!;
// Dos calles reales del callejero del espacio de ensayo (cada una con correspondencia única).
const CALLES = ['Calle de las Angustias', 'Calle de las Farolas'];
const AUTORIZADA = 'direccion-completa-coma';

function baseEnsayo() {
  const v = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
  if (!v.ok) throw new Error(v.motivo);
  return crearBaseEspacio('ensayo', { persona: { nombre: 'Persona de Prueba', roles: ['coordinador'] }, calles: v.calles, detalleCallejero: 'OSM', espacioId: 'loc', ahora: '2026-10-25T10:00:00.000Z' });
}
const autorizar = (db: ReturnType<typeof baseEnsayo>): DecisionesIncorporacion => ({ reglasAutorizadas: [{ regla: AUTORIZADA, porId: db.meta.espacioCreadoPorId!, fecha: '2026-10-25' }] });

async function libroSimple(cabeceras: string[], filas: unknown[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Datos');
  ws.addRow(cabeceras);
  for (const f of filas) ws.addRow(f);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('Localización · correspondencia de columnas', () => {
  it('basta la calle: el número es opcional y se avisa de que el vínculo con el portal quedará pendiente', async () => {
    const c = caso('D');
    const inf = await analizarXlsx(await c.generar(), c.archivo);
    expect(inf.hojaDatos).toBe('Censo');
    expect(Object.fromEntries(inf.correspondencia.map((x) => [x.cabecera, x.clave]))).toEqual(c.esperado);
    expect(evaluarCorrespondencia(inf.correspondencia)).toMatchObject({ lista: true, faltaLocalizacion: false, sinNumero: true });
  });

  it('la dirección completa en una sola celda se reconoce como tal (no como calle)', async () => {
    const c = caso('E');
    const inf = await analizarXlsx(await c.generar(), c.archivo);
    expect(Object.fromEntries(inf.correspondencia.map((x) => [x.cabecera, x.clave]))).toEqual(c.esperado);
    expect(evaluarCorrespondencia(inf.correspondencia)).toMatchObject({ lista: true, faltaLocalizacion: false, sinNumero: false });
  });

  it('sin ninguna columna de localización (ni calle ni dirección completa) no se puede continuar', async () => {
    const bytes = await libroSimple(['Nombre comercial', 'Local vacío', 'Fecha', 'Número'], [['X', 0, new Date(Date.UTC(2020, 1, 1)), 3]]);
    const inf = await analizarXlsx(bytes, 'sin_localizacion.xlsx');
    expect(evaluarCorrespondencia(inf.correspondencia)).toMatchObject({ lista: false, faltaLocalizacion: true });
    await expect(interpretarXlsx(bytes, 'sin_localizacion.xlsx')).rejects.toThrow();
  });

  it('una columna «Dirección» puede relacionarse a mano como dirección completa; los perfiles exigen una de las dos', async () => {
    const c = caso('D');
    const inf = await analizarXlsx(await c.generar(), c.archivo);
    const idx = inf.correspondencia.find((x) => x.cabecera === 'Calle')!.indice;
    const comoCompleta = asignarColumna(asignarColumna(inf.correspondencia, idx, null), idx, 'direccionCompleta');
    expect(evaluarCorrespondencia(comoCompleta)).toMatchObject({ lista: true, sinNumero: false });
    expect(evaluarCorrespondencia(asignarColumna(inf.correspondencia, idx, null))).toMatchObject({ lista: false, faltaLocalizacion: true });
    const perfil = perfilDesdeCorrespondencia(inf.correspondencia, { nombre: 'Valle sin número', hoja: 'Censo', filaCabecera: 1, fecha: '2026-10-25' });
    expect(validarPerfil(JSON.parse(JSON.stringify(perfil))).ok).toBe(true);
    const sinLoc = { ...perfil, columnas: perfil.columnas.filter((x) => x.clave !== 'direccion') };
    expect(validarPerfil(sinLoc)).toEqual({ ok: false, motivo: 'Falta la calle o la dirección completa.' });
  });
});

describe('Localización · dirección completa: separación solo con una regla estricta y autorizada', () => {
  it('sin autorización: nada se separa, el texto original se conserva y las separables quedan como propuesta', async () => {
    const c = caso('E');
    const r = await interpretarXlsx(await c.generar(CALLES), c.archivo);
    expect(r.filas).toHaveLength(DIRECCIONES_E.length);
    DIRECCIONES_E.forEach((d, i) => {
      const fo = r.original.filas[i];
      const fi = r.filas[i];
      const literal = d.plantilla(CALLES);
      expect(fo.celdas.direccionCompleta ?? { t: 'vacio' }).toEqual(literal === null ? { t: 'vacio' } : { t: 'texto', v: literal });
      expect(fi.celdas.numero).toBeUndefined();
      expect(fi.celdas.direccion).toBeUndefined();
      const celda = fi.celdas.direccionCompleta!;
      if (d.separable) expect(celda).toMatchObject({ estado: 'pendiente', regla: AUTORIZADA });
      else if (literal !== null) expect(celda).toMatchObject({ estado: 'valido', valor: literal });
      expect(localizacionDe(fi).calle).toBeUndefined();
      expect(localizacionDe(fi).portal).toBeUndefined();
    });
    const tipos = new Set(r.incidencias.map((x) => x.tipo));
    expect(tipos.has('direccion-completa-separable')).toBe(true);
    expect(tipos.has('direccion-completa-no-separable')).toBe(true);
  });

  it('con la regla autorizada: solo se separan las formas inequívocas y sin inventar números', async () => {
    const c = caso('E');
    const r = await interpretarXlsx(await c.generar(CALLES), c.archivo, { reglasAutorizadas: [AUTORIZADA] });
    DIRECCIONES_E.forEach((d, i) => {
      const loc = localizacionDe(r.filas[i]);
      if (d.separable) expect(loc).toEqual({ calle: CALLES[d.separable.calle], portal: d.separable.portal, origen: 'direccion-completa' });
      else expect(loc.calle).toBeUndefined();
      // El original no cambia nunca.
      const literal = d.plantilla(CALLES);
      if (literal !== null) expect(r.original.filas[i].celdas.direccionCompleta).toEqual({ t: 'texto', v: literal });
    });
  });

  it.each([
    ['Calle Mayor, 12', { tipo: 'numero', numero: 12 }],
    ['Calle Mayor ,  12 b', { tipo: 'numero', numero: 12, sufijo: 'B' }],
    ['Calle Mayor, 12 bis', { tipo: 'numero', numero: 12, sufijo: 'BIS' }],
    ['Plaza Mayor, s/n.', { tipo: 'sin-numero' }],
    ['Calle Mayor 12', null],
    ['Calle Mayor, 12, 2º B', null],
    ['Calle Mayor, 12 izq.', null],
    ['Calle Mayor, 0', null],
    ['Calle Mayor, 12-14', null],
    ['Calle 2 de Mayo, 5', null], // calle con cifras: no se separa (se concilia a mano)
    ['Calle Mayor, nº 12', null],
    ['12, Calle Mayor', null],
  ])('«%s»', async (texto, esperado) => {
    const bytes = await libroSimple(['Dirección completa', 'Nombre comercial', 'Local vacío'], [[texto, 'NEGOCIO SINTÉTICO', 0]]);
    const r = await interpretarXlsx(bytes, 'una.xlsx', { reglasAutorizadas: [AUTORIZADA] });
    const loc = localizacionDe(r.filas[0]);
    expect(loc.portal ?? null).toEqual(esperado);
    expect(r.original.filas[0].celdas.direccionCompleta).toEqual({ t: 'texto', v: texto });
  });
});

describe('Localización · plan e incorporación en el ensayo', () => {
  it('sin columna de número: se conservan todos los registros y ningún local se crea (vínculo pendiente)', async () => {
    const db = baseEnsayo();
    const c = caso('D');
    const destino = { municipioId: municipioDeEspacio('ensayo'), anio: c.anio };
    const { resultado, plan } = await prepararIncorporacion(db, await c.generar(CALLES), c.archivo, destino, {});
    expect(plan.aplicable).toBe(true);
    expect(plan.filas.every((f) => f.correspondencia === 'sin-vinculo' && f.motivo === 'numero-desconocido' && !f.localNuevo)).toBe(true);
    // La calle sí se reconoce (queda anotada), pero sin número no hay local físico.
    expect(plan.filas.every((f) => !!f.calleId)).toBe(true);
    const r = aplicarIncorporacion(db, resultado, destino, {}, plan, { porId: db.meta.espacioCreadoPorId!, ahora: '2026-10-25T11:00:00.000Z' });
    const regs = Object.values(r.db.registros);
    expect(regs).toHaveLength(12);
    expect(regs.every((x) => x.original && 'direccion' in x.original && !('numero' in x.original))).toBe(true);
    expect(regs.some((x) => x.adicionales?.Notas)).toBe(true);
    expect(Object.keys(r.db.locales)).toHaveLength(0);
    // Diagnóstico y conciliación de calles funcionan sin la columna de número.
    expect(diagnosticoAgregado(resultado).indicadores.some((i) => i.clave === 'sin-numero')).toBe(false);
    expect(conciliacionCalles(db, resultado, destino.municipioId).denominaciones.map((d) => d.estado)).toEqual(['literal', 'literal']);
  });

  it('dirección completa SIN autorizar la regla: todo queda pendiente de vínculo, con el registro original íntegro', async () => {
    const db = baseEnsayo();
    const c = caso('E');
    const destino = { municipioId: municipioDeEspacio('ensayo'), anio: c.anio };
    const { resultado, plan } = await prepararIncorporacion(db, await c.generar(CALLES), c.archivo, destino, {});
    expect(plan.aplicable).toBe(true);
    expect(plan.pendientes.some((p) => p.includes(AUTORIZADA))).toBe(true);
    const motivos = plan.filas.map((f) => f.motivo);
    expect(motivos).toEqual(DIRECCIONES_E.map((d) => (d.plantilla(CALLES) === null ? 'calle-sin-correspondencia' : 'direccion-sin-separar')));
    expect(plan.filas.every((f) => f.correspondencia === 'sin-vinculo' && !f.calleId)).toBe(true);
    expect(conciliacionCalles(db, resultado, destino.municipioId).denominaciones).toHaveLength(0);
    const r = aplicarIncorporacion(db, resultado, destino, {}, plan, { porId: db.meta.espacioCreadoPorId!, ahora: '2026-10-25T11:00:00.000Z' });
    const regs = Object.values(r.db.registros).sort((a, b) => a.fila - b.fila);
    expect(regs).toHaveLength(DIRECCIONES_E.length);
    regs.forEach((x, i) => {
      const literal = DIRECCIONES_E[i].plantilla(CALLES);
      expect(x.original?.direccionCompleta ?? { t: 'vacio' }).toEqual(literal === null ? { t: 'vacio' } : { t: 'texto', v: literal });
    });
    expect(Object.keys(r.db.locales)).toHaveLength(0);
  });

  it('dirección completa CON la regla autorizada: locales solo con calle única + número + estado; S/N y no separables, pendientes', async () => {
    const db = baseEnsayo();
    const c = caso('E');
    const destino = { municipioId: municipioDeEspacio('ensayo'), anio: c.anio };
    const dec = autorizar(db);
    const { resultado, plan } = await prepararIncorporacion(db, await c.generar(CALLES), c.archivo, destino, dec);
    expect(plan.aplicable).toBe(true);
    expect(plan.pendientes.some((p) => p.includes(AUTORIZADA))).toBe(false);
    const esperado = DIRECCIONES_E.map((d) => {
      if (d.plantilla(CALLES) === null) return ['sin-vinculo', 'calle-sin-correspondencia'];
      if (!d.separable) return ['sin-vinculo', 'direccion-sin-separar'];
      if (d.separable.portal.tipo === 'sin-numero') return ['ambigua', 'sin-numero'];
      return ['inequivoca', undefined];
    });
    expect(plan.filas.map((f) => [f.correspondencia, f.motivo])).toEqual(esperado);
    // La conciliación de calles ve las calles separadas.
    expect(conciliacionCalles(db, resultado, destino.municipioId, dec).denominaciones.map((d) => [d.literal, d.estado])).toEqual(expect.arrayContaining([[CALLES[0], 'literal'], [CALLES[1], 'literal']]));
    const r = aplicarIncorporacion(db, resultado, destino, dec, plan, { porId: db.meta.espacioCreadoPorId!, ahora: '2026-10-25T11:00:00.000Z' });
    const locales = Object.values(r.db.locales);
    const separablesConNumero = DIRECCIONES_E.filter((d) => d.separable && d.separable.portal.tipo === 'numero');
    expect(locales).toHaveLength(separablesConNumero.length);
    // Ningún número inventado: cada local tiene exactamente el portal escrito en el Excel.
    const portales = locales.map((l) => `${r.db.calles[l.direcciones[0].calleId].nombre}|${l.direcciones[0].numero}${l.direcciones[0].sufijo ?? ''}`).sort();
    expect(portales).toEqual(separablesConNumero.map((d) => {
      const s = d.separable as { calle: 0 | 1; portal: { tipo: 'numero'; numero: number; sufijo?: string } };
      return `${CALLES[s.calle]}|${s.portal.numero}${s.portal.sufijo ?? ''}`;
    }).sort());
    expect(Object.values(r.db.registros)).toHaveLength(DIRECCIONES_E.length);
  });

  it('con la regla autorizada pero calles que no están en el callejero: no se crea ningún local', async () => {
    const db = baseEnsayo();
    const c = caso('E');
    const destino = { municipioId: municipioDeEspacio('ensayo'), anio: c.anio };
    const dec = autorizar(db);
    const { plan } = await prepararIncorporacion(db, await c.generar(), c.archivo, destino, dec);
    expect(plan.filas.some((f) => f.localNuevo)).toBe(false);
    expect(plan.filas.filter((f) => f.motivo === 'calle-sin-correspondencia').length).toBeGreaterThan(0);
  });
});

describe('Localización · los formatos actuales siguen igual', () => {
  it('formato Medina de 27 columnas: calle y número en columnas propias, mismo plan que antes', async () => {
    const r = await interpretarXlsx(await libroFicticio({ filas: 20 }), 'x.xlsx');
    expect(r.original.columnas.some((x) => x.clave === 'direccionCompleta')).toBe(false);
    expect(r.filas.every((f) => localizacionDe(f).origen === 'columnas' || localizacionDe(f).origen === 'ninguna')).toBe(true);
  });
  for (const id of ['A', 'B'] as const) {
    it(`caso ${id}: la calle y el número siguen leyéndose de sus columnas`, async () => {
      const c = caso(id);
      const r = await interpretarXlsx(await c.generar(), c.archivo);
      const conPortal = r.filas.filter((f) => localizacionDe(f).portal);
      expect(conPortal.length).toBe(r.filas.length);
    });
  }
});
