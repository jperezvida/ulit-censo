import ExcelJS from 'exceljs';
import { unzipSync, zipSync } from 'fflate';
import { crearRng } from './rng';
import { MARCA_FICTICIO } from './xlsxSinteticoC1e';

/**
 * G0 · Censos SINTÉTICOS con estructuras DIFERENTES a las de Medina del Campo, para comprobar que
 * ULIT Censo recibe archivos distintos sin cambiar el código. Todos los datos son inventados
 * (municipios, calles y negocios ficticios) y llevan la marca de archivo generado por la aplicación.
 *
 *  A · «Villa Sintética de Arriba 2023»: portada antes de los datos; títulos en las filas 1–2 y
 *      cabecera en la fila 3; columnas con otros nombres y en otro orden; dos columnas que ULIT no
 *      conoce; sin CP, Distrito, Zona ni presencia digital; fechas escritas como texto (dd-mm-aaaa y
 *      aaaa-mm-dd); portales como texto; franquicia como «Sí»/«No».
 *  B · «Pueblo Sintético del Río 2024»: hoja de datos llamada «Hoja1» que no es la primera; cabeceras
 *      en MAYÚSCULAS y sin tildes; fechas de Excel con formato dd/mm/aa; portales con sufijo y «S/N»;
 *      0/1 guardados como texto; presencia digital parcial; una columna adicional; hojas auxiliares
 *      de listas y de resumen.
 *  C · «Aldea Sintética 2022»: cabeceras AMBIGUAS (dos columnas que podrían ser el nombre y dos que
 *      podrían ser la dirección): ninguna se debe asignar automáticamente.
 *  D · «Lugar Sintético del Valle 2021»: SIN columna de número de portal (solo la calle).
 *  E · «Monte Sintético 2020»: la dirección COMPLETA en una sola celda («Domicilio completo»), con
 *      formas separables («…, 12», «…, 3 B», «…, S/N») y no separables («… 7», «…, 4, 1º A»,
 *      «Polígono…, nave 3»), y una vacía.
 */

export interface CasoGeneralidad {
  id: 'A' | 'B' | 'C' | 'D' | 'E';
  municipio: string;
  anio: number;
  archivo: string;
  filas: number;
  /** Hoja y fila de cabecera reales (para comprobar la detección). */
  hoja: string;
  filaCabecera: number;
  /** Correspondencia esperada cabecera → campo de ULIT (las ambiguas, sin campo). */
  esperado: Record<string, string | null>;
  generar: (calles?: string[]) => Promise<Uint8Array>;
}

const CALLES_FICTICIAS = ['Calle del Olmo', 'Calle Real', 'Plaza de la Fuente', 'Avenida del Río', 'Calle Nueva', 'Travesía del Molino', 'Calle de la Ermita', 'Camino del Prado'];
const ACTIVIDADES: [string, string][] = [['Comercio', 'Panadería'], ['Comercio', 'Ferretería'], ['Hostelería y Restauración', 'Bar'], ['Servicios', 'Peluquería'], ['Servicios', 'Asesoría']];
const fijo = new Date(Date.UTC(2026, 9, 25));

async function cerrar(wb: ExcelJS.Workbook, titulo: string): Promise<Uint8Array> {
  Object.assign(wb, { creator: 'ULIT Censo · censo SINTÉTICO de generalidad (G0)', lastModifiedBy: 'ULIT Censo', created: fijo, modified: fijo, title: `SINTÉTICO: ${titulo}`, keywords: MARCA_FICTICIO });
  const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return zipSync(unzipSync(bytes), { mtime: fijo, level: 6 });
}

const dosCifras = (n: number) => String(n).padStart(2, '0');

/** A · Villa Sintética de Arriba 2023 (40 filas). */
async function libroA(calles = CALLES_FICTICIAS): Promise<Uint8Array> {
  const rng = crearRng('g0-villa-arriba-2023');
  const wb = new ExcelJS.Workbook();
  const portada = wb.addWorksheet('Portada');
  portada.addRow(['CENSO COMERCIAL SINTÉTICO · Villa Sintética de Arriba · 2023']);
  portada.addRow(['Datos inventados para pruebas de ULIT Censo.']);
  const ws = wb.addWorksheet('Censo 2023');
  ws.addRow(['Villa Sintética de Arriba · censo comercial 2023 (SINTÉTICO)']);
  ws.addRow(['Elaborado para pruebas']);
  ws.addRow(['Nombre comercial', 'Calle', 'Nº', 'Local vacío', 'Fecha de visita', 'Sector', 'Actividad', '¿Franquicia?', 'Observaciones del censista', 'Código interno']);
  for (let i = 0; i < 40; i++) {
    const vacio = i % 5 === 0;
    const [sector, act] = ACTIVIDADES[i % ACTIVIDADES.length];
    const dia = 1 + (i % 27);
    const fecha = i % 2 ? `${dosCifras(dia)}-0${1 + (i % 9)}-2023` : `2023-0${1 + (i % 9)}-${dosCifras(dia)}`;
    ws.addRow([
      vacio ? null : `TIENDA SINTÉTICA A${String(i + 1).padStart(3, '0')}`,
      calles[i % calles.length], String(2 + 2 * Math.floor(i / calles.length)), vacio ? 1 : 0, fecha,
      vacio ? null : sector, vacio ? null : act, vacio ? null : rng.chance(0.2) ? 'Sí' : 'No',
      i % 7 === 0 ? 'Persiana bajada' : null, `VSA-${1000 + i}`,
    ]);
  }
  return cerrar(wb, 'Villa Sintética de Arriba 2023');
}

/** B · Pueblo Sintético del Río 2024 (60 filas). */
async function libroB(calles = CALLES_FICTICIAS): Promise<Uint8Array> {
  const rng = crearRng('g0-pueblo-rio-2024');
  const wb = new ExcelJS.Workbook();
  const listas = wb.addWorksheet('Listas');
  listas.addRow(['GR ACTIVIDAD', 'ACTIVIDAD']);
  for (const [g, a] of ACTIVIDADES) listas.addRow([g, a]);
  const ws = wb.addWorksheet('Hoja1');
  ws.addRow(['FECHA', 'DIRECCION', 'NUMERO', 'CP', 'VACIO', 'NOMBRE DEL NEGOCIO', 'GRUPO ACTIVIDAD', 'ACTIVIDAD', 'WEB', 'INSTAGRAM', 'FACEBOOK', 'SUPERFICIE M2']);
  for (let i = 0; i < 60; i++) {
    const vacio = i % 6 === 0;
    const [g, a] = ACTIVIDADES[i % ACTIVIDADES.length];
    const n = 1 + Math.floor(i / calles.length) * 2;
    const numero = i === 7 ? 'S/N' : i % 11 === 0 ? `${n} B` : n;
    const row = ws.addRow([
      new Date(Date.UTC(2024, i % 12, 1 + (i % 28))), calles[i % calles.length], numero, 47999, vacio ? '1' : '0',
      vacio ? null : `COMERCIO SINTÉTICO B${String(i + 1).padStart(3, '0')}`, vacio ? null : g, vacio ? null : a,
      vacio ? null : rng.chance(0.4) ? 1 : 0, vacio ? null : rng.chance(0.5) ? 1 : 0, vacio ? null : rng.chance(0.3) ? 1 : 0, rng.int(20, 300),
    ]);
    row.getCell(1).numFmt = 'dd/mm/yy';
  }
  const res = wb.addWorksheet('Resumen');
  res.addRow(['Etiquetas de fila', 'Cuenta de NOMBRE DEL NEGOCIO']);
  res.addRow(['Comercio', 24]);
  res.addRow(['Total general', 50]);
  return cerrar(wb, 'Pueblo Sintético del Río 2024');
}

/** C · Aldea Sintética 2022 (12 filas) con cabeceras ambiguas. */
async function libroC(calles = CALLES_FICTICIAS): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Datos');
  ws.addRow(['Nombre comercial', 'Nombre del local', 'Dirección', 'Dirección fiscal', 'Número', 'Vacío', 'Fecha']);
  for (let i = 0; i < 12; i++) {
    const row = ws.addRow([`NEGOCIO SINTÉTICO C${i + 1}`, `LOCAL SINTÉTICO C${i + 1}`, calles[i % calles.length], `Apartado sintético ${i + 1}`, 3 + i, 0, new Date(Date.UTC(2022, 4, 1 + i))]);
    row.getCell(7).numFmt = 'dd/mm/yyyy';
  }
  return cerrar(wb, 'Aldea Sintética 2022');
}

/** D · Lugar Sintético del Valle 2021 (12 filas): sin columna de número. */
async function libroD(calles = CALLES_FICTICIAS): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Censo');
  ws.addRow(['Calle', 'Nombre comercial', 'Local vacío', 'Fecha', 'Notas']);
  for (let i = 0; i < 12; i++) {
    const vacio = i % 4 === 0;
    const row = ws.addRow([calles[i % calles.length], vacio ? null : `ESTABLECIMIENTO SINTÉTICO D${i + 1}`, vacio ? 1 : 0, new Date(Date.UTC(2021, 2, 1 + i)), i === 3 ? 'Junto a la iglesia' : null]);
    row.getCell(4).numFmt = 'dd/mm/yyyy';
  }
  return cerrar(wb, 'Lugar Sintético del Valle 2021');
}

/**
 * E · Monte Sintético 2020 (10 filas): dirección completa en una celda. `DIRECCIONES_E` describe cada
 * fila y lo que se espera de ella (para las pruebas): separable o no, y el portal si lo es.
 */
export const DIRECCIONES_E: { plantilla: (c: string[]) => string | null; separable: false | { calle: 0 | 1; portal: { tipo: 'numero'; numero: number; sufijo?: string } | { tipo: 'sin-numero' } } }[] = [
  { plantilla: (c) => `${c[0]}, 12`, separable: { calle: 0, portal: { tipo: 'numero', numero: 12 } } },
  { plantilla: (c) => `${c[1]}, 3 B`, separable: { calle: 1, portal: { tipo: 'numero', numero: 3, sufijo: 'B' } } },
  { plantilla: (c) => `${c[0]}, S/N`, separable: { calle: 0, portal: { tipo: 'sin-numero' } } },
  { plantilla: (c) => `${c[1]} 7`, separable: false },
  { plantilla: (c) => `${c[0]}, 4, 1º A`, separable: false },
  { plantilla: (c) => `${c[1]}, 14`, separable: { calle: 1, portal: { tipo: 'numero', numero: 14 } } },
  { plantilla: () => null, separable: false },
  { plantilla: (c) => `${c[0]}, 12`, separable: { calle: 0, portal: { tipo: 'numero', numero: 12 } } },
  { plantilla: () => 'Polígono sintético, nave 3', separable: false },
  { plantilla: (c) => `${c[1]}, 20 izq.`, separable: false },
];

async function libroE(calles = CALLES_FICTICIAS): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Locales');
  ws.addRow(['Domicilio completo', 'Nombre comercial', 'Local vacío', 'Fecha de visita']);
  DIRECCIONES_E.forEach((d, i) => {
    const vacio = i === 5;
    const row = ws.addRow([d.plantilla(calles), vacio ? null : `NEGOCIO SINTÉTICO E${i + 1}`, vacio ? 1 : 0, new Date(Date.UTC(2020, 5, 1 + i))]);
    row.getCell(4).numFmt = 'dd/mm/yyyy';
  });
  return cerrar(wb, 'Monte Sintético 2020');
}

export const CASOS_GENERALIDAD: CasoGeneralidad[] = [
  {
    id: 'A', municipio: 'Villa Sintética de Arriba', anio: 2023, archivo: 'censo_villa_sintetica_arriba_2023_SINTETICO.xlsx', filas: 40, hoja: 'Censo 2023', filaCabecera: 3,
    esperado: { 'Nombre comercial': 'nombre', Calle: 'direccion', 'Nº': 'numero', 'Local vacío': 'vacio', 'Fecha de visita': 'fecha', Sector: 'grupoActividad', Actividad: 'actividad', '¿Franquicia?': 'franquicia', 'Observaciones del censista': null, 'Código interno': null },
    generar: libroA,
  },
  {
    id: 'B', municipio: 'Pueblo Sintético del Río', anio: 2024, archivo: 'censo_pueblo_sintetico_rio_2024_SINTETICO.xlsx', filas: 60, hoja: 'Hoja1', filaCabecera: 1,
    esperado: { FECHA: 'fecha', DIRECCION: 'direccion', NUMERO: 'numero', CP: 'cp', VACIO: 'vacio', 'NOMBRE DEL NEGOCIO': 'nombre', 'GRUPO ACTIVIDAD': 'grupoActividad', ACTIVIDAD: 'actividad', WEB: 'web', INSTAGRAM: 'instagram', FACEBOOK: 'facebook', 'SUPERFICIE M2': null },
    generar: libroB,
  },
  {
    id: 'C', municipio: 'Aldea Sintética', anio: 2022, archivo: 'censo_aldea_sintetica_2022_SINTETICO.xlsx', filas: 12, hoja: 'Datos', filaCabecera: 1,
    esperado: { 'Nombre comercial': null, 'Nombre del local': null, Dirección: null, 'Dirección fiscal': null, Número: 'numero', Vacío: 'vacio', Fecha: 'fecha' },
    generar: libroC,
  },
  {
    id: 'D', municipio: 'Lugar Sintético del Valle', anio: 2021, archivo: 'censo_lugar_sintetico_valle_2021_SINTETICO.xlsx', filas: 12, hoja: 'Censo', filaCabecera: 1,
    esperado: { Calle: 'direccion', 'Nombre comercial': 'nombre', 'Local vacío': 'vacio', Fecha: 'fecha', Notas: null },
    generar: libroD,
  },
  {
    id: 'E', municipio: 'Monte Sintético', anio: 2020, archivo: 'censo_monte_sintetico_2020_SINTETICO.xlsx', filas: 10, hoja: 'Locales', filaCabecera: 1,
    esperado: { 'Domicilio completo': 'direccionCompleta', 'Nombre comercial': 'nombre', 'Local vacío': 'vacio', 'Fecha de visita': 'fecha' },
    generar: libroE,
  },
];
