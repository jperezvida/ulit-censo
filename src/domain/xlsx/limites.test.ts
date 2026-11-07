// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { conPrefijo, libroFicticio } from '../../data/xlsxFicticio';
import { analizarXlsx } from './analisis';
import { descomprimirSeguro, directorioCentral, ErrorLector, LIMITES_XLSX, leerLibro, type LimitesXlsx } from './lector';

/** Paquetes ZIP SINTÉTICOS (ningún dato real) para comprobar el rechazo seguro. */
const MiB = 1024 * 1024;
const minimo = () => ({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'),
});
const lim = (o: Partial<LimitesXlsx>): LimitesXlsx => ({ ...LIMITES_XLSX, ...o });

/** Rechaza con código «limites», rápido y sin llegar a ExcelJS. */
async function rechazaPorLimites(bytes: Uint8Array, patron: RegExp, l?: LimitesXlsx) {
  const t = performance.now();
  const e = await leerLibro(bytes, l).then(() => null, (x) => x);
  expect(e).toBeInstanceOf(ErrorLector);
  expect(e).toMatchObject({ codigo: 'limites' });
  expect(e.message).toMatch(patron);
  return performance.now() - t;
}

/** Cambia el tamaño descomprimido DECLARADO de una entrada (cabecera local y directorio central). */
function mentirTamano(zip: Uint8Array, nombre: string, declarado: number): Uint8Array {
  const b = zip.slice();
  const dv = new DataView(b.buffer);
  const nom = strToU8(nombre);
  const igual = (p: number) => nom.every((c, k) => b[p + k] === c);
  for (let i = 0; i < b.length - 46; i++) {
    const sig = dv.getUint32(i, true);
    if (sig === 0x04034b50 && dv.getUint16(i + 26, true) === nom.length && igual(i + 30)) dv.setUint32(i + 22, declarado, true);
    if (sig === 0x02014b50 && dv.getUint16(i + 28, true) === nom.length && igual(i + 46)) dv.setUint32(i + 24, declarado, true);
  }
  return b;
}

describe('C1a · Límites de seguridad del lector XLSX', () => {
  it('límites por defecto: margen amplio para un censo y tope a lo desproporcionado', () => {
    expect(LIMITES_XLSX).toEqual({ maxBytesArchivo: 25 * MiB, maxEntradas: 1000, maxBytesEntrada: 150 * MiB, maxBytesDescomprimidos: 250 * MiB, maxProporcion: 200 });
  });

  it('un libro normal (con o sin prefijo) pasa los límites', async () => {
    const b = await libroFicticio({ filas: 2000, anomalias: true });
    expect((await leerLibro(b)).libro.worksheets).toHaveLength(3);
    expect((await leerLibro(conPrefijo(b))).lector).toBe('exceljs+adaptacion-prefijos');
  });

  it('archivo demasiado grande: se rechaza antes de descomprimir', async () => {
    const b = await libroFicticio({ filas: 200 });
    await rechazaPorLimites(b, /El archivo ocupa .* \(máximo/, lim({ maxBytesArchivo: 1000 }));
  });

  it('«bomba ZIP»: 40 MB de ceros en ~40 KB se rechazan por la proporción declarada, sin descomprimir', async () => {
    const bomba = zipSync({ ...minimo(), 'xl/worksheets/sheet1.xml': new Uint8Array(40 * MiB) }, { level: 9 });
    expect(bomba.byteLength).toBeLessThan(200 * 1024);
    const ms = await rechazaPorLimites(bomba, /se expande de forma desproporcionada/);
    expect(ms).toBeLessThan(2000);
    // También a través del análisis
    await expect(analizarXlsx(bomba, 'bomba.xlsx')).rejects.toMatchObject({ codigo: 'limites' });
  });

  it('total descomprimido y tamaño por entrada por encima del máximo', async () => {
    const b = await libroFicticio({ filas: 3000 });
    const total = directorioCentral(b).reduce((a, e) => a + e.descomprimido, 0);
    await rechazaPorLimites(b, /El libro ocupa .* descomprimido/, lim({ maxBytesDescomprimidos: Math.floor(total / 2) }));
    await rechazaPorLimites(b, /Un elemento interno ocupa/, lim({ maxBytesEntrada: 64 * 1024 }));
  });

  it('demasiadas entradas internas', async () => {
    const muchas: Record<string, Uint8Array> = minimo();
    for (let i = 0; i < 30; i++) muchas[`xl/media/x${i}.xml`] = strToU8('<a/>');
    await rechazaPorLimites(zipSync(muchas), /contiene 32 elementos internos \(máximo 10\)/, lim({ maxEntradas: 10 }));
  });

  it('cabeceras que MIENTEN sobre el tamaño: la descompresión real se detiene en el acto', async () => {
    const real = zipSync({ ...minimo(), 'xl/worksheets/sheet1.xml': new Uint8Array(2 * MiB) }, { level: 9 });
    const falso = mentirTamano(real, 'xl/worksheets/sheet1.xml', 100);
    expect(directorioCentral(falso).find((e) => e.nombre === 'xl/worksheets/sheet1.xml')!.descomprimido).toBe(100);
    await rechazaPorLimites(falso, /se descomprime en más bytes de los que declara/);
    expect(() => descomprimirSeguro(falso)).toThrow(/más bytes de los que declara/);
  });

  it('ZIP64 o directorio central dañado se rechazan sin procesar el contenido', async () => {
    const b = (await libroFicticio({ filas: 5 })).slice();
    const dv = new DataView(b.buffer);
    let eocd = -1;
    for (let i = b.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    const z64 = b.slice();
    new DataView(z64.buffer).setUint16(eocd + 10, 0xffff, true);
    await rechazaPorLimites(z64, /ZIP64/);
    const roto = b.slice(0, b.length - 30);
    await expect(leerLibro(roto)).rejects.toMatchObject({ codigo: 'no-es-xlsx' });
  });

  it('la verificación no altera el contenido: ExcelJS recibe exactamente lo descomprimido', async () => {
    const b = await libroFicticio({ filas: 50, anomalias: true });
    const a = descomprimirSeguro(b);
    const directo = unzipSync(b);
    expect(Object.keys(a).sort()).toEqual(Object.keys(directo).sort());
    for (const k of Object.keys(directo)) expect(a[k]).toEqual(directo[k]);
  });
});
