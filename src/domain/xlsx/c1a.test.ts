// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { conPrefijo, libroFicticio } from '../../data/xlsxFicticio';
import { adaptarPrefijos, diagnosticarPaquete, ErrorLector, leerLibro } from './lector';
import { analizarXlsx } from './analisis';
import { compararCabecera, normalizarCabecera, PERFIL_CENSO_27, PERFIL_ITINERARIO_28 } from './perfilesImportacion';
import { perfilarXlsx } from './perfil';
import { CONFIG_TERRITORIAL } from '../territorio';

/** Libros SINTÉTICOS generados en la prueba: ningún dato real. */
const filasDe = (wb: ExcelJS.Workbook, hoja: string) => {
  const out: unknown[][] = [];
  wb.getWorksheet(hoja)!.eachRow({ includeEmpty: true }, (r) => out.push((r.values as unknown[]).slice(1).map((v) => (v instanceof Date ? v.toISOString() : v))));
  return out;
};
const cambiarParte = (bytes: Uint8Array, parte: string, f: (xml: string) => string) => {
  const a = unzipSync(bytes);
  a[parte] = strToU8(f(strFromU8(a[parte])));
  return zipSync(a);
};
const medina = CONFIG_TERRITORIAL['mun-medina'];
const valladolid = CONFIG_TERRITORIAL['mun-valladolid'];

describe('C1a · Capacidades de ExcelJS con ambos formatos', () => {
  it('ExcelJS lee el XML sin prefijo (como guarda Excel) y falla con el prefijo «x:»', async () => {
    const sin = await libroFicticio({ anomalias: true });
    const con = conPrefijo(sin);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(sin as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Datos', 'Hoja1', 'Tablas Dinámicas']);
    await expect(new ExcelJS.Workbook().xlsx.load(con as unknown as ArrayBuffer)).rejects.toThrow();
    expect(strFromU8(unzipSync(con)['xl/worksheets/sheet1.xml'])).toContain('<x:worksheet');
  });

  it('el lector usa ExcelJS sin adaptar nada cuando no hay prefijo', async () => {
    const sin = await libroFicticio();
    const r = await leerLibro(sin);
    expect(r.lector).toBe('exceljs');
    expect(r.adaptaciones).toEqual([]);
    expect(r.diagnostico.prefijadas).toEqual([]);
  });

  it('con prefijo, la adaptación produce EXACTAMENTE los mismos valores, formatos y hojas', async () => {
    const sin = await libroFicticio({ anomalias: true, repetidas: 3 });
    const con = conPrefijo(sin);
    const copia = con.slice();
    const a = await leerLibro(sin);
    const b = await leerLibro(con);
    expect(b.lector).toBe('exceljs+adaptacion-prefijos');
    expect(b.adaptaciones.map((x) => x.parte)).toEqual(expect.arrayContaining(['xl/workbook.xml', 'xl/worksheets/sheet1.xml']));
    for (const h of ['Datos', 'Hoja1', 'Tablas Dinámicas']) expect(filasDe(b.libro, h)).toEqual(filasDe(a.libro, h));
    expect(b.libro.getWorksheet('Datos')!.getCell('A2').numFmt).toBe(a.libro.getWorksheet('Datos')!.getCell('A2').numFmt);
    // El original no se modifica
    expect(con).toEqual(copia);
  });

  it('la adaptación es acotada: rechaza CDATA, atributos prefijados y prefijos de otros espacios de nombres', async () => {
    const con = conPrefijo(await libroFicticio());
    const conCdata = cambiarParte(con, 'xl/worksheets/sheet1.xml', (x) => x.replace('</x:worksheet>', '<x:extLst><![CDATA[<x:c>]]></x:extLst></x:worksheet>'));
    expect(() => adaptarPrefijos(conCdata)).toThrow(/CDATA/);
    await expect(leerLibro(conCdata)).rejects.toBeInstanceOf(ErrorLector);
    const conAtributo = cambiarParte(con, 'xl/worksheets/sheet1.xml', (x) => x.replace('<x:sheetData>', '<x:sheetData x:raro="1">'));
    expect(() => adaptarPrefijos(conAtributo)).toThrow(/atributos/);
    // Un prefijo ligado a otro espacio de nombres no se considera SpreadsheetML: no se toca
    const otro = cambiarParte(await libroFicticio(), 'xl/worksheets/sheet3.xml', (x) => x.replace('<worksheet ', '<worksheet xmlns:y="urn:otro" '));
    expect(diagnosticarPaquete(otro).prefijadas).toEqual([]);
  });

  it('detecta archivos que no son .xlsx o están cifrados / son .xls antiguos', async () => {
    await expect(leerLibro(strToU8('Calle;Num\nVía;1'))).rejects.toMatchObject({ codigo: 'no-es-xlsx' });
    const cfb = new Uint8Array(64);
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(leerLibro(cfb)).rejects.toMatchObject({ codigo: 'cifrado-o-xls' });
  });

  it('el inspector estructural de B0 también abre libros con prefijo', async () => {
    const p = await perfilarXlsx(conPrefijo(await libroFicticio()), 'ficticio.xlsx');
    expect(p.hojas[0]).toMatchObject({ nombre: 'Datos', filaCabecera: 1 });
  });
});

describe('C1a · Perfiles y cabeceras', () => {
  it('reconoce la cabecera con espacios finales sin alterarla', () => {
    const gr = PERFIL_CENSO_27.columnas.find((c) => c.clave === 'grupoComercio')!;
    expect(gr.cabecera).toBe(`Gr Comercio${' '.repeat(56)}`);
    expect(compararCabecera(gr.cabecera, gr)).toBe('exacta');
    expect(compararCabecera('Gr Comercio', gr)).toBe('espacios');
    expect(compararCabecera('GR COMERCIO', gr)).toBe('mayusculas');
    expect(compararCabecera('Gr  Comercio ', PERFIL_ITINERARIO_28.columnas.find((c) => c.clave === 'grupoComercio')!)).toBe('espacios');
    expect(compararCabecera('Direccion', PERFIL_CENSO_27.columnas.find((c) => c.clave === 'direccion')!)).toBe('tildes');
    expect(compararCabecera('Google My Business', PERFIL_CENSO_27.columnas.find((c) => c.clave === 'googleBusiness')!)).toBe('alias');
    expect(compararCabecera('Cadena', PERFIL_CENSO_27.columnas.find((c) => c.clave === 'franquicia')!)).toBeNull();
    expect(normalizarCabecera(' Nº  reseñas Google ')).toBe('nº reseñas google');
  });

  it('perfiles diferenciados: 27 columnas (municipal) y 28 (itinerario Medina 2026)', async () => {
    expect(PERFIL_CENSO_27.columnas).toHaveLength(27);
    expect(PERFIL_ITINERARIO_28.columnas).toHaveLength(28);
    const a = await analizarXlsx(await libroFicticio({ perfil: 'censo-27' }), 'a.xlsx');
    expect(a.perfilPropuesto).toBe('censo-municipal-27');
    expect(a.perfiles.find((p) => p.perfilId === 'itinerario-medina-2026-28')).toMatchObject({ compatible: false, faltan: ['Municipio', 'itinerario', 'Orden Par'], sobran: ['Distrito', 'Zona'] });
    const b = await analizarXlsx(await libroFicticio({ perfil: 'itinerario-28' }), 'b.xlsx');
    expect(b.hojaDatos).toBe('Datos 25');
    expect(b.perfilPropuesto).toBe('itinerario-medina-2026-28');
    expect(b.columnas.find((c) => c.perfil?.clave === 'grupoComercio')!.cabecera).toBe('Gr Comercio');
  });

  it('las diferencias irrelevantes se toleran e informan; la cabecera original se conserva tal cual', async () => {
    const inf = await analizarXlsx(await libroFicticio({ cabeceras: { [`Gr Comercio${' '.repeat(56)}`]: 'Gr Comercio ', 'web': 'WEB', 'Google My Bussines': 'Google My Business' } }), 'x.xlsx');
    expect(inf.perfilPropuesto).toBe('censo-municipal-27');
    const dif = inf.perfiles[0].diferencias;
    expect(dif).toEqual(expect.arrayContaining([
      { cabeceraArchivo: 'Gr Comercio ', cabeceraPerfil: `Gr Comercio${' '.repeat(56)}`, coincidencia: 'espacios' },
      { cabeceraArchivo: 'WEB', cabeceraPerfil: 'web', coincidencia: 'mayusculas' },
      { cabeceraArchivo: 'Google My Business', cabeceraPerfil: 'Google My Bussines', coincidencia: 'alias' },
    ]));
    expect(inf.columnas.find((c) => c.perfil?.clave === 'web')!.cabecera).toBe('WEB');
    expect(inf.columnas.find((c) => c.perfil?.clave === 'grupoComercio')!.espaciosSobrantes).toBe(1);
  });

  it('columnas que faltan, sobran o se repiten impiden la compatibilidad', async () => {
    const inf = await analizarXlsx(await libroFicticio({ omitir: ['Franquicia'], extra: ['Cadena', 'web'] }), 'x.xlsx');
    expect(inf.perfilPropuesto).toBeNull();
    const p = inf.perfiles.find((x) => x.perfilId === 'censo-municipal-27')!;
    expect(p).toMatchObject({ compatible: false, faltan: ['Franquicia'], sobran: ['Cadena'], duplicadas: ['web'] });
    expect(inf.avisos.join(' ')).toMatch(/Ningún perfil es plenamente compatible/);
  });
});

describe('C1a · Hoja de datos por su estructura', () => {
  it('identifica la hoja de datos aunque cambie de nombre y de posición; descarta resumen y listas', async () => {
    const inf = await analizarXlsx(await libroFicticio({ hojaDatos: 'CENSO DEFINITIVO', posicionDatos: 3 }), 'x.xlsx');
    expect(inf.hojaDatos).toBe('CENSO DEFINITIVO');
    expect(inf.eleccionHoja).toBe('automatica');
    expect(inf.hojas.map((h) => [h.nombre, h.posicion, h.rol])).toEqual([['Hoja1', 1, 'listas'], ['Tablas Dinámicas', 2, 'resumen'], ['CENSO DEFINITIVO', 3, 'datos']]);
    expect(inf.avisos.join(' ')).toMatch(/no es la primera del libro/);
  });

  it('dos hojas con la misma estructura obligan a elegir', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await libroFicticio({ auxiliares: false })) as unknown as ArrayBuffer);
    const copia = wb.addWorksheet('Datos (2)');
    wb.getWorksheet('Datos')!.eachRow((r) => copia.addRow((r.values as unknown[]).slice(1)));
    const inf = await analizarXlsx(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), 'x.xlsx');
    expect(inf.eleccionHoja).toBe('ambigua');
  });

  it('un libro sin estructura conocida no propone hoja de datos', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Notas').addRow(['Texto', 'libre', 'sin', 'formato']);
    const inf = await analizarXlsx(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), 'x.xlsx');
    expect(inf).toMatchObject({ hojaDatos: null, eleccionHoja: 'ninguna', columnas: [] });
  });
});

describe('C1a · Tipos, formatos y filas', () => {
  it('fechas de Excel, decimales y binarios; los valores imposibles se cuentan, nunca se convierten', async () => {
    const inf = await analizarXlsx(await libroFicticio({ filas: 40, anomalias: true }), 'x.xlsx');
    const col = (k: string) => inf.columnas.find((c) => c.perfil?.clave === k)!;
    expect(col('fecha').tipos.fecha).toBe(39);
    expect(col('fecha').formatos['dd/mm/yyyy']).toBe(39);
    expect(col('fecha').discordantes).toEqual({ 'texto u otro tipo en columna de fecha': 1 });
    expect(col('fachada').tipos.decimal).toBeGreaterThan(0);
    expect(col('fachada').discordantes).toEqual({ 'texto u otro tipo en columna numérica': 1 });
    for (const k of ['web', 'respondeResenas', 'facebook', 'twitter']) expect(col(k).discordantes).toEqual({ 'número distinto de 0 y 1': 1 });
    expect(col('franquicia').discordantes).toEqual({});
    expect(col('seguidoresInstagram').discordantes).toEqual({ 'texto u otro tipo en columna numérica': 1 });
    expect(col('numero').variantes).toEqual({ 'S/N': 1, 'número con sufijo': 1 });
    // El informe no contiene valores: ni nombres, ni direcciones, ni los números imposibles
    const json = JSON.stringify(inf);
    expect(json).not.toMatch(/FICTICIO 0|VÍA FICTICIA|247|379|sin dato/);
  });

  it('filas: cabecera, datos, en blanco intercaladas y posibles totales', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await libroFicticio({ filas: 10, auxiliares: false })) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Datos')!;
    ws.spliceRows(5, 0, []);
    ws.addRow([]);
    ws.addRow(['Total general']);
    const inf = await analizarXlsx(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), 'x.xlsx');
    expect(inf.filas).toMatchObject({ filaCabecera: 1, conDatos: 11, enBlancoIntercaladas: 2, posiblesTotales: [14] });
  });

  it('direcciones repetidas con negocios distintos: se cuentan y se conservan todas las filas', async () => {
    const inf = await analizarXlsx(await libroFicticio({ filas: 24, repetidas: 3 }), 'x.xlsx');
    expect(inf.filas.conDatos).toBe(27);
    expect(inf.direccionesRepetidas).toMatchObject({ grupos: 3, filas: 6 });
    expect(inf.direccionesRepetidas!.nota).toMatch(/conservarán todas las filas.*conciliación/);
  });
});

describe('C1a · Reglas territoriales por municipio (sin inventar valores)', () => {
  it('Medina: Distrito y Zona vacíos son conformes; el CP fijo se comprueba', async () => {
    const inf = await analizarXlsx(await libroFicticio(), 'x.xlsx', { territorio: medina });
    expect(inf.territorio!.campos.map((c) => [c.campo, c.estado])).toEqual([['distrito', 'conforme'], ['zona', 'conforme'], ['cp', 'conforme']]);
    const otroCp = await analizarXlsx(await libroFicticio({ cp: 47001 }), 'x.xlsx', { territorio: medina });
    expect(otroCp.territorio!.campos[2]).toMatchObject({ estado: 'difiere' });
    // Si Medina recibiera valores de Distrito, se informa pero no se usan
    const conDistrito = await analizarXlsx(await libroFicticio({ distritoZona: true }), 'x.xlsx', { territorio: medina });
    expect(conDistrito.territorio!.campos[0].estado).toBe('difiere');
  });

  it('Valladolid: vacíos en el histórico se conservan ausentes con incidencia futura; nunca se rellenan', async () => {
    const inf = await analizarXlsx(await libroFicticio({ cpVacio: true }), 'x.xlsx', { territorio: valladolid });
    for (const c of inf.territorio!.campos) {
      expect(c.estado).toBe('ausente');
      expect(c.mensaje).toMatch(/Se conservará ausente.*obligatorio/);
    }
    const con = await analizarXlsx(await libroFicticio({ distritoZona: true, cp: 47002 }), 'x.xlsx', { territorio: valladolid });
    expect(con.territorio!.campos.every((c) => c.estado === 'conforme')).toBe(true);
    // El itinerario de 28 columnas no tiene Distrito ni Zona
    const it = await analizarXlsx(await libroFicticio({ perfil: 'itinerario-28' }), 'x.xlsx', { territorio: valladolid });
    expect(it.territorio!.campos[0].mensaje).toMatch(/no tiene esa columna/);
  });
});

describe('C1a · Garantías y rendimiento', () => {
  it('es de solo lectura y declara sus garantías', async () => {
    const bytes = await libroFicticio();
    const copia = bytes.slice();
    const inf = await analizarXlsx(bytes, 'x.xlsx');
    expect(bytes).toEqual(copia);
    expect(inf.garantias.join(' ')).toMatch(/no se ha importado ningún negocio/);
    expect(inf.archivo.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('analiza más de 10.000 filas en un tiempo razonable', async () => {
    const bytes = await libroFicticio({ filas: 10000, anomalias: true });
    const t = performance.now();
    const inf = await analizarXlsx(conPrefijo(bytes), 'grande.xlsx');
    const ms = performance.now() - t;
    console.info(`[rendimiento C1a] 10.000 filas con prefijo: ${ms.toFixed(0)} ms`);
    expect(inf.filas.conDatos).toBe(10000);
    expect(ms).toBeLessThan(30000);
  }, 60000);
});
