import ExcelJS from 'exceljs';

/**
 * Escritura XLSX nativa (no un CSV renombrado). Cada columna declara su tipo, de modo que
 * los números se escriben como números, los textos como texto y los vacíos como celdas vacías.
 */
export type TipoColumnaXlsx = 'texto' | 'entero' | 'decimal' | 'fecha';

export interface HojaXlsx {
  nombre: string;
  columnas: { cabecera: string; tipo: TipoColumnaXlsx; formato?: string; ancho?: number }[];
  filas: (string | number | Date | null | undefined)[][];
}

export async function escribirXlsx(hojas: HojaXlsx[], metadatos: { autor?: string } = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = metadatos.autor ?? 'ULIT Censo';
  wb.created = new Date();
  for (const h of hojas) {
    const ws = wb.addWorksheet(h.nombre);
    ws.columns = h.columnas.map((c) => ({ header: c.cabecera, width: c.ancho ?? Math.max(10, Math.min(40, c.cabecera.length + 4)) }));
    for (const fila of h.filas) {
      const valores = h.columnas.map((c, i) => convertir(fila[i], c.tipo));
      const r = ws.addRow(valores);
      h.columnas.forEach((c, i) => {
        if (c.formato && valores[i] !== null) r.getCell(i + 1).numFmt = c.formato;
      });
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function convertir(v: string | number | Date | null | undefined, tipo: TipoColumnaXlsx): string | number | Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (tipo === 'texto') return String(v);
  if (tipo === 'fecha') return v instanceof Date ? v : new Date(String(v));
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Valor no numérico «${v}» en una columna de tipo ${tipo}`);
  return tipo === 'entero' ? Math.round(n) : n;
}
