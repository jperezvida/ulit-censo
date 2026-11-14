import ExcelJS from 'exceljs';
import type { ExportacionRevisionGeneral } from './exportacionRevisionGeneral';
import { PERFIL_ITINERARIO_28 } from './xlsx/perfilesImportacion';

/**
 * XLSX de trabajo 2026 con la estructura original de itinerario (28 cabeceras),
 * otra hoja de trazabilidad y un resumen PROVISIONAL. No inventa locales únicos.
 * Escribe texto literal, NUNCA fórmulas interpretadas de un Excel de origen.
 */
export async function generarXlsxRevisionGeneral(datos: ExportacionRevisionGeneral): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ULIT Censo · Cátedra de Innovación para el Comercio';
  wb.title = 'Medina del Campo 2026 · Excel de trabajo revisado';
  wb.subject = 'Exportación provisional de filas de itinerarios y correcciones supervisadas';
  wb.created = new Date();

  const cabecerasCenso = PERFIL_ITINERARIO_28.columnas.map((c) => c.cabecera);
  const cabecerasTraza = datos.columnas.slice(cabecerasCenso.length);
  const censo = wb.addWorksheet('Datos 2026');
  const traza = wb.addWorksheet('Origen y correcciones');
  const resumen = wb.addWorksheet('Resumen');

  const estiloHoja = (hoja: ExcelJS.Worksheet, cabeceras: readonly string[], anchuras: number[]) => {
    hoja.columns = cabeceras.map((cabecera, i) => ({
      header: cabecera, width: anchuras[i] ?? 19, key: 'c' + i,
    }));
    hoja.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cabeceras.length } };
    const encabezado = hoja.getRow(1);
    encabezado.height = 27;
    encabezado.font = { name: 'Aptos', size: 10, color: { argb: 'FFFFFFFF' }, bold: true };
    encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24476B' } };
    encabezado.alignment = { vertical: 'middle', wrapText: true };
    hoja.properties.defaultRowHeight = 19;
  };

  estiloHoja(censo, cabecerasCenso, cabecerasCenso.map((cabecera) =>
    cabecera === 'Dirección' || cabecera === 'Nombre del negocio' ? 36 :
      cabecera === 'Descripción' ? 32 : cabecera === 'Subgrupo de actividad' ? 27 : 18));
  estiloHoja(traza, cabecerasTraza, cabecerasTraza.map((cabecera) =>
    cabecera.includes('Valores originales') || cabecera.includes('Motivo') ? 42 :
      cabecera.includes('Incidencias') || cabecera.includes('Campos corregidos') ? 34 : 24));

  for (const registro of datos.filas) {
    censo.addRow(cabecerasCenso.map((c) => registro[c] ?? ''));
    traza.addRow(cabecerasTraza.map((c) => registro[c] ?? ''));
  }

  resumen.columns = [{ width: 47 }, { width: 20 }];
  resumen.mergeCells('A1:B1');
  resumen.getCell('A1').value = 'Censo Medina del Campo 2026 · Trabajo de revisión';
  resumen.getCell('A1').font = { name: 'Aptos', bold: true, size: 14, color: { argb: 'FF24476B' } };
  resumen.getRow(1).height = 30;
  const indicadores: [string, number][] = [
    ['Filas de itinerarios incluidas', datos.resumen.filas],
    ['Indicador de vacío = 1', datos.resumen.vacios],
    ['Indicador de ocupado = 0', datos.resumen.ocupados],
    ['Estado por confirmar', datos.resumen.desconocidos],
    ['Filas con avisos pendientes', datos.resumen.conIncidencias],
    ['Avisos automáticos pendientes', datos.resumen.incidencias],
    ['Filas con correcciones guardadas', datos.resumen.conCorreccion],
  ];
  resumen.addRow(['Indicador', 'Valor']);
  resumen.getRow(2).font = { name: 'Aptos', bold: true, color: { argb: 'FFFFFFFF' } };
  resumen.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF24476B' } };
  for (const indicador of indicadores) resumen.addRow(indicador);
  resumen.getCell('A11').value = 'ATENCIÓN: cifras provisionales de filas de Excel; NO equivalen a locales físicos únicos.';
  resumen.mergeCells('A11:B11');
  resumen.getCell('A11').font = { color: { argb: 'FF85510D' }, italic: true };
  resumen.getCell('A13').value = 'Los datos efectivos corregidos figuran en «Datos 2026». La trazabilidad funcional no muestra datos de antiguos ocupantes.';
  resumen.mergeCells('A13:B13');
  resumen.getCell('A13').alignment = { wrapText: true };
  resumen.getRow(13).height = 35;

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** Descarga de datos locales, sin enviarlos a servicios externos. */
export function descargarXlsxRevisionGeneral(nombre: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
