import ExcelJS from 'exceljs';
import { unzipSync, zipSync } from 'fflate';
import { PERFIL_ITINERARIO_28 } from '../domain/xlsx/perfilesImportacion';
import { MARCA_FICTICIO } from './xlsxSinteticoC1e';

/**
 * G4 · Excel SINTÉTICOS de tres itinerarios (IT1, IT2, IT3) de una campaña operativa de la «Villa
 * Sintética de Arriba» (municipio ficticio de G3; sus calles están en `osmVillaSintetica`). Formato de
 * 28 columnas de los itinerarios. Incluyen a propósito:
 *  - varios establecimientos en un mismo portal (Calle del Olmo 3): son locales distintos;
 *  - un posible duplicado entre itinerarios (FERRETERÍA SINTÉTICA, Calle del Olmo 7, en IT1 e IT2);
 *  - una contradicción (Calle del Olmo 5: vacío en IT1, ocupado en IT2);
 *  - una calle que no está en el callejero, un «S/N», una fila sin fecha y una fila que dice ser de otro itinerario.
 */

type Fila = { calle: string; num: number | string; nombre?: string; vacio?: boolean; fecha?: string | null; itinerario?: number; fachada?: number };

export const FILAS_ITINERARIOS: Record<'IT1' | 'IT2' | 'IT3', Fila[]> = {
  IT1: [
    { calle: 'Calle del Olmo', num: 1, nombre: 'BAR SINTÉTICO EL OLMO', fecha: '2026-03-02' },
    { calle: 'Calle del Olmo', num: 3, nombre: 'PANADERÍA SINTÉTICA', fecha: '2026-03-02' },
    { calle: 'Calle del Olmo', num: 3, nombre: 'PELUQUERÍA SINTÉTICA', fecha: '2026-03-02' },
    { calle: 'Calle del Olmo', num: 5, vacio: true, fachada: 6.5, fecha: '2026-03-03' },
    { calle: 'Calle del Olmo', num: 7, nombre: 'FERRETERÍA SINTÉTICA', fecha: '2026-03-03' },
    { calle: 'Calle Real', num: 2, nombre: 'ESTANCO SINTÉTICO', fecha: '2026-03-04' },
  ],
  IT2: [
    { calle: 'Calle Real', num: 4, nombre: 'FARMACIA SINTÉTICA', fecha: '2026-04-06' },
    { calle: 'Calle Real', num: 6, vacio: true, fachada: 4, fecha: '2026-04-06' },
    { calle: 'Calle del Olmo', num: 7, nombre: 'FERRETERÍA SINTÉTICA', fecha: '2026-04-07' },
    { calle: 'Calle del Olmo', num: 5, nombre: 'CAFETERÍA SINTÉTICA', fecha: '2026-04-07' },
    { calle: 'Calle Peatonal Mayor', num: 2, nombre: 'LIBRERÍA SINTÉTICA', fecha: null },
  ],
  IT3: [
    { calle: 'Plaza de la Fuente', num: 1, nombre: 'KIOSCO SINTÉTICO', fecha: '2026-05-11' },
    { calle: 'Calle Inexistente', num: 4, nombre: 'TIENDA SINTÉTICA', fecha: '2026-05-11' },
    { calle: 'Paseo del Río', num: 'S/N', nombre: 'HELADERÍA SINTÉTICA', fecha: '2026-05-12' },
    { calle: 'Plaza del Mercado', num: 2, nombre: 'MERCERÍA SINTÉTICA', fecha: '2026-05-12', itinerario: 4 },
  ],
};

export const archivoItinerario = (it: 'IT1' | 'IT2' | 'IT3', version = 1) => `itinerario_${it}_villa_sintetica_2026${version > 1 ? `_v${version}` : ''}_SINTETICO.xlsx`;

/** Excel sintético de un itinerario. `version` > 1 genera otro archivo del MISMO itinerario (una fila más). */
export async function libroItinerario(it: 'IT1' | 'IT2' | 'IT3', version = 1): Promise<Uint8Array> {
  const filas = [...FILAS_ITINERARIOS[it], ...(version > 1 ? [{ calle: 'Calle Real', num: 10 + version, nombre: `ALTA SINTÉTICA V${version}`, fecha: '2026-03-05' }] : [])];
  return libroConFilas(it, filas);
}

/**
 * G5 · Variante SINTÉTICA de IT3 para la conciliación posterior: añade una observación repetida
 * (CAFETERÍA SINTÉTICA en Calle del Olmo 5, también en IT2) y una contradicción SIN FECHA (Calle Peatonal
 * Mayor 2: ocupado y sin fecha en IT2, vacío y sin fecha aquí).
 */
export const FILAS_IT3_G5: Fila[] = [
  ...FILAS_ITINERARIOS.IT3,
  { calle: 'Calle del Olmo', num: 5, nombre: 'CAFETERÍA SINTÉTICA', fecha: '2026-05-12' },
  { calle: 'Calle Peatonal Mayor', num: 2, vacio: true, fecha: null },
];
export const archivoIT3G5 = 'itinerario_IT3_villa_sintetica_2026_G5_SINTETICO.xlsx';
export const libroIT3G5 = () => libroConFilas('IT3', FILAS_IT3_G5);

async function libroConFilas(it: 'IT1' | 'IT2' | 'IT3', filas: Fila[]): Promise<Uint8Array> {
  const n = Number(it.slice(2));
  const wb = new ExcelJS.Workbook();
  const fijo = new Date(Date.UTC(2026, 9, 25));
  Object.assign(wb, { creator: 'ULIT Censo · itinerario SINTÉTICO (G4)', lastModifiedBy: 'ULIT Censo', created: fijo, modified: fijo, title: `SINTÉTICO: ${it}`, keywords: MARCA_FICTICIO });
  const ws = wb.addWorksheet('Datos 25');
  const cols = PERFIL_ITINERARIO_28.columnas;
  ws.addRow(cols.map((c) => c.cabecera));
  for (const f of filas) {
    const v: Record<string, unknown> = {
      fecha: f.fecha ? new Date(`${f.fecha}T00:00:00Z`) : null, municipio: 'VILLA SINTÉTICA DE ARRIBA', itinerario: f.itinerario ?? n,
      direccion: f.calle, numero: f.num, vacio: f.vacio ? 1 : 0, fachada: f.fachada ?? null, nombre: f.vacio ? null : f.nombre ?? null,
    };
    const fila = ws.addRow(cols.map((c) => v[c.clave] ?? null));
    const ci = cols.findIndex((c) => c.clave === 'fecha');
    if (f.fecha) fila.getCell(ci + 1).numFmt = 'dd/mm/yyyy';
  }
  const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return zipSync(unzipSync(bytes), { mtime: fijo, level: 6 });
}
