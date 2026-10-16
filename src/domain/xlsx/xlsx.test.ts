// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { cargarLibro, esAmarillo, esColumnaAutorizada, perfilarXlsx, rellenoDe, tipoDeCelda } from './perfil';
import { escribirXlsx } from './escribir';
// @ts-expect-error módulo JS sin tipos
import { archivosProhibidos } from '../../../scripts/datos-reales.mjs';

/** Libro SINTÉTICO con la forma de los Excel de la Cátedra (ningún dato real). */
async function libroSintetico(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('CENSO');
  ws.addRow(['Calle', 'Número', 'Nombre del negocio', 'Local Vacío', 'Long fachada', 'GrActividad', 'Gr Comercio', 'Subgrupo de actividad', 'Actividad', 'web', 'Zona ']);
  const filas: (string | number | null)[][] = [
    ['Calle Ficticia Uno', 2, 'Bar Ficticio Alfa', 0, 0, 'Hostelería', 'Hostelería', 'Bares', 'Bar', 1, 'Centro'],
    ['Calle Ficticia Uno', 4, null, 1, 6.5, null, null, null, null, 0, 'Centro'],
    ['Calle Ficticia Uno', 6, 'Peluquería Ficticia Beta', 0, 0, 'Servicios', 'Servicios personales', 'Cuidado personal', 'Peluquería', 0, 'Centro'],
    ['Calle Ficticia Dos', 1, 'Bar Ficticio Gamma', '1.0', null, 'Hostelería', 'Hostelería', 'Bares', 'Bar', 1, 'Norte'],
    ['Calle Ficticia Dos', 3, 'Tienda Ficticia Delta', '0.0', null, 'Comercio', 'Alimentación', 'Alimentación general', 'Ultramarinos', 1, 'Norte'],
  ];
  for (const f of filas) ws.addRow(f);
  const amarillo: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  ws.getCell('C2').fill = amarillo;
  ws.getCell('C5').fill = amarillo;
  ws.getCell('B3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; // azul claro: no es amarillo
  ws.getCell('E3').numFmt = '0.0';
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];
  (ws as unknown as { dataValidations: { add: (r: string, v: object) => void } }).dataValidations.add('I2:I999', { type: 'list', allowBlank: true, formulae: ['Hoja1!$D$2:$D$154'] });
  const aux = wb.addWorksheet('Hoja1');
  aux.addRow(['Grupo de actividad', 'Grupo de comercio', 'Subgrupo de actividad', 'Actividad']);
  aux.addRow(['Comercio', 'Alimentación', 'Alimentación general', 'Ultramarinos']);
  aux.addRow(['Servicios', 'Servicios personales', 'Cuidado personal', 'Peluquería']);
  aux.addRow(['Hostelería', 'Hostelería', 'Bares', 'Bar']);
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('lectura de estilos y tipos con ExcelJS', () => {
  it('detecta rellenos amarillos y distingue otros colores', async () => {
    const wb = await cargarLibro(await libroSintetico());
    const ws = wb.getWorksheet('CENSO')!;
    expect(rellenoDe(ws.getCell('C2'))).toBe('argb:FFFFFF00');
    expect(esAmarillo(rellenoDe(ws.getCell('C2')))).toBe(true);
    expect(esAmarillo(rellenoDe(ws.getCell('B3')))).toBe(false);
    expect(rellenoDe(ws.getCell('A2'))).toBeNull();
    expect(esAmarillo('argb:FFFFF2CC')).toBe(true); // amarillo claro de Office
    expect(esAmarillo('argb:FFFFC000')).toBe(true); // ámbar
    expect(esAmarillo('argb:FFFF0000')).toBe(false); // rojo
  });

  it('clasifica 0/1 numéricos y textuales, decimales y vacíos', async () => {
    const wb = await cargarLibro(await libroSintetico());
    const ws = wb.getWorksheet('CENSO')!;
    expect(tipoDeCelda(ws.getCell('D2'))).toBe('numero-01');
    expect(tipoDeCelda(ws.getCell('D5'))).toBe('texto-01-decimal');
    expect(tipoDeCelda(ws.getCell('E3'))).toBe('decimal');
    expect(tipoDeCelda(ws.getCell('C3'))).toBe('vacia');
  });
});

describe('perfil estructural', () => {
  it('conserva cabeceras exactas y describe tipos, formatos, amarillo y validaciones', async () => {
    const p = await perfilarXlsx(await libroSintetico(), 'sintetico.xlsx');
    const h = p.hojas.find((x) => x.nombre === 'CENSO')!;
    expect(h.filaCabecera).toBe(1);
    expect(h.filasConDatos).toBe(5);
    expect(h.columnas.map((c) => c.cabecera)).toEqual(['Calle', 'Número', 'Nombre del negocio', 'Local Vacío', 'Long fachada', 'GrActividad', 'Gr Comercio', 'Subgrupo de actividad', 'Actividad', 'web', 'Zona ']);
    const col = (n: string) => h.columnas.find((c) => c.cabecera === n)!;
    expect(col('Nombre del negocio').rellenos.amarillo).toBe(2);
    expect(col('Número').rellenos.amarillo).toBe(0);
    expect(col('Local Vacío').tipos).toMatchObject({ 'numero-01': 3, 'texto-01-decimal': 2 });
    expect(col('Long fachada').formatosNumero['0.0']).toBe(1);
    expect(col('web').valores).toEqual([{ valor: '1', n: 3 }, { valor: '0', n: 2 }]);
    expect(col('Zona ').valores?.map((v) => v.valor)).toEqual(['Centro', 'Norte']);
    expect(h.panelesCongelados).toEqual({ filas: 1, columnas: 0 });
    expect(h.validaciones[0]).toMatchObject({ tipo: 'list' });
    expect(p.archivo.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('nunca incluye nombres de negocio ni direcciones', async () => {
    const p = await perfilarXlsx(await libroSintetico(), 'sintetico.xlsx');
    const json = JSON.stringify(p);
    for (const dato of ['Bar Ficticio Alfa', 'Peluquería Ficticia Beta', 'Tienda Ficticia Delta', 'Calle Ficticia Uno']) expect(json).not.toContain(dato);
    const h = p.hojas.find((x) => x.nombre === 'CENSO')!;
    expect(h.columnas.find((c) => c.cabecera === 'Nombre del negocio')!.motivoSinValores).toBe('no-autorizada');
    expect(h.columnas.find((c) => c.cabecera === 'Calle')!.motivoSinValores).toBe('no-autorizada');
    expect(esColumnaAutorizada('Teléfono')).toBe(false);
    expect(esColumnaAutorizada('GrActividad')).toBe(true);
    expect(esColumnaAutorizada('Gr Comercio                 ')).toBe(true);
  });

  it('una columna no autorizada (p. ej. «Cadena») solo aporta estructura, nunca sus valores', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Datos');
    const cadenas = ['Cadena Ficticia Uno', 'Cadena Ficticia Dos', 'Cadena Ficticia Uno', 'Franquicia Ficticia Tres', 'Cadena Ficticia Dos', 'Cadena Ficticia Uno'];
    ws.addRow(['Cadena', 'Observaciones', 'Fecha censo', 'Franquicia', 'Nº reseñas Google']);
    cadenas.forEach((c, i) => ws.addRow([c, `Nota ficticia ${i}`, new Date(Date.UTC(2026, 8, 10 + i)), i % 2, 10 + i]));
    const p = await perfilarXlsx(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), 'cadenas.xlsx');
    const json = JSON.stringify(p);
    for (const c of [...new Set(cadenas)]) expect(json).not.toContain(c);
    expect(json).not.toContain('Nota ficticia');
    expect(json).not.toContain('2026-09-1');
    const col = (n: string) => p.hojas[0].columnas.find((c) => c.cabecera === n)!;
    expect(col('Cadena')).toMatchObject({ valores: null, motivoSinValores: 'no-autorizada', noVacias: 6, distintos: 3 });
    expect(col('Franquicia').valores).toEqual([{ valor: '0', n: 3 }, { valor: '1', n: 3 }]);
    expect(col('Nº reseñas Google').valores).toBeNull();
    expect(col('Nº reseñas Google').numerico).toEqual({ min: 10, max: 15, soloEnteros: true });
  });

  it('extrae las combinaciones de los cuatro niveles y las listas auxiliares de Hoja1', async () => {
    const p = await perfilarXlsx(await libroSintetico(), 'sintetico.xlsx');
    const h = p.hojas.find((x) => x.nombre === 'CENSO')!;
    expect(h.tuplasActividad?.columnas).toEqual(['GrActividad', 'Gr Comercio', 'Subgrupo de actividad', 'Actividad']);
    expect(h.tuplasActividad?.tuplas[0]).toEqual({ niveles: ['Hostelería', 'Hostelería', 'Bares', 'Bar'], n: 2 });
    const aux = p.hojas.find((x) => x.nombre === 'Hoja1')!;
    expect(aux.columnas.find((c) => c.cabecera === 'Actividad')!.valores?.map((v) => v.valor).sort()).toEqual(['Bar', 'Peluquería', 'Ultramarinos']);
  });
});

describe('escritura XLSX nativa', () => {
  it('escribe cabeceras exactas, números como números y vacíos como celdas vacías', async () => {
    const bytes = await escribirXlsx([
      {
        nombre: 'Censo',
        columnas: [{ cabecera: 'Calle', tipo: 'texto' }, { cabecera: 'Número', tipo: 'entero' }, { cabecera: 'Long fachada', tipo: 'decimal', formato: '0.0' }, { cabecera: 'web', tipo: 'entero' }],
        filas: [['Calle Ficticia', 3, 4.5, 1], ['Calle Ficticia', '5', null, 0]],
      },
    ]);
    const wb = await cargarLibro(bytes);
    const ws = wb.getWorksheet('Censo')!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(['Calle', 'Número', 'Long fachada', 'web']);
    expect(ws.getCell('B3').value).toBe(5);
    expect(typeof ws.getCell('B3').value).toBe('number');
    expect(ws.getCell('C2').value).toBe(4.5);
    expect(ws.getCell('C2').numFmt).toBe('0.0');
    expect(ws.getCell('C3').value).toBeNull();
    expect(ws.getCell('D3').value).toBe(0);
  });

  it('rechaza valores no numéricos en columnas numéricas', async () => {
    await expect(escribirXlsx([{ nombre: 'x', columnas: [{ cabecera: 'n', tipo: 'entero' }], filas: [['abc']] }])).rejects.toThrow(/no numérico/);
  });
});

describe('protección frente a datos reales en git', () => {
  it('detecta libros Excel, perfiles sin revisar y la carpeta datos-reales', () => {
    expect(archivosProhibidos(['src/a.ts', 'CENSO COMPLETO MEDINA 2025.xlsx', 'datos-reales/x.csv', 'b.perfil.json', 'docs/x.md'])).toEqual([
      'CENSO COMPLETO MEDINA 2025.xlsx', 'datos-reales/x.csv', 'b.perfil.json',
    ]);
  });
});
