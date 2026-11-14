// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { COLUMNAS_REVISION_GENERAL_2026, type ExportacionRevisionGeneral } from './exportacionRevisionGeneral';
import { generarXlsxRevisionGeneral } from './exportacionRevisionXlsx';
import { PERFIL_ITINERARIO_28 } from './xlsx/perfilesImportacion';

const simulado = (): ExportacionRevisionGeneral => ({
  columnas: COLUMNAS_REVISION_GENERAL_2026,
  filas: [{
    'Fecha censo': '2026-10-20', Municipio: 'Medina del Campo', itinerario: '1',
    'Dirección': 'Calle de Prueba', Num: '7', 'Local Vacío': '1',
    'Long fachada': '3,5', 'Nombre del negocio': '', Instagram: '0',
    'ULIT · Registro origen': 'reg-ficticio',
    'ULIT · Archivo de origen': 'IT1 ficticio.xlsx',
    'ULIT · Fila del Excel': '2', 'ULIT · Itinerario': 'IT1',
    'ULIT · Estado de revisión': 'Corregido; sin avisos automáticos',
    'ULIT · Incidencias pendientes': '',
    'ULIT · Campos corregidos': 'Nombre del negocio',
    'ULIT · Fecha corrección': '2026-11-10',
    'ULIT · Responsable corrección': 'revisor',
    'ULIT · Motivo corrección': 'Cierre confirmado en campo',
  }],
  resumen: { filas: 1, vacios: 1, ocupados: 0, desconocidos: 0,
    conIncidencias: 0, conCorreccion: 1, incidencias: 0 },
});

describe('Excel nativo · trabajo Medina 2026', () => {
  it('tiene 28 columnas originales, 3 hojas y trazabilidad en la misma fila', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await generarXlsxRevisionGeneral(simulado())) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Datos 2026', 'Origen y correcciones', 'Resumen']);
    const datos = wb.getWorksheet('Datos 2026')!;
    const trazas = wb.getWorksheet('Origen y correcciones')!;
    expect(datos.columnCount).toBe(28);
    expect(datos.rowCount).toBe(2);
    expect(trazas.rowCount).toBe(2);
    expect(datos.views[0].state).toBe('frozen');
    expect((datos.getRow(1).values as ExcelJS.CellValue[]).slice(1)).toEqual(PERFIL_ITINERARIO_28.columnas.map((c) => c.cabecera));
    const idxNombre = PERFIL_ITINERARIO_28.columnas.findIndex((c) => c.clave === 'nombre') + 1;
    expect(datos.getRow(2).getCell(idxNombre).value ?? '').toBe('');
    expect(trazas.getRow(2).getCell(1).value).toBe('reg-ficticio');
    expect(trazas.getRow(2).getCell(9).value).toBe('revisor');
    expect(wb.getWorksheet('Resumen')!.getCell('B3').value).toBe(1);
  });

  it('no ejecuta fórmulas peligrosas del Excel original al escribir cadenas', async () => {
    const salida = simulado();
    salida.filas[0]['Nombre del negocio'] = '=1+2';
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await generarXlsxRevisionGeneral(salida)) as unknown as ArrayBuffer);
    const datos = wb.getWorksheet('Datos 2026')!;
    const idxNombre = PERFIL_ITINERARIO_28.columnas.findIndex((c) => c.clave === 'nombre') + 1;
    expect(datos.getRow(2).getCell(idxNombre).value).toBe('=1+2');
    expect(typeof datos.getRow(2).getCell(idxNombre).value).toBe('string');
  });
});
