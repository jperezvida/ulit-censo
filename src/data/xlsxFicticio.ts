import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { NS_SPREADSHEETML } from '../domain/xlsx/lector';
import { PERFIL_CENSO_27, PERFIL_ITINERARIO_28, type PerfilImportacion } from '../domain/xlsx/perfilesImportacion';

/**
 * Libros XLSX FICTICIOS para pruebas y demostraciones de C1a. Reproducen la ESTRUCTURA de los
 * formatos de la Cátedra (cabeceras, tipos, hojas auxiliares) con datos inventados («VÍA
 * FICTICIA», «COMERCIO FICTICIO»…). No contienen datos reales.
 */
export interface OpcionesLibroFicticio {
  perfil?: 'censo-27' | 'itinerario-28';
  filas?: number;
  /** Nombre de la hoja de datos (por defecto, el habitual del perfil). */
  hojaDatos?: string;
  /** Posición de la hoja de datos entre las demás (1 = primera). */
  posicionDatos?: number;
  /** Incluir Hoja1 (listas) y una hoja de resumen. */
  auxiliares?: boolean;
  /** Valores anómalos históricos (0/1 imposibles, fecha en texto, «3,5 m», «S/N»…). */
  anomalias?: boolean;
  /** Direcciones repetidas con negocios distintos (como en el itinerario de Valladolid). */
  repetidas?: number;
  /** CP de todas las filas (vacío si se omite y `cpVacio`). */
  cp?: number;
  cpVacio?: boolean;
  /** Distrito/Zona con valor (para simular un municipio que los usa). */
  distritoZona?: boolean;
  /** Cabeceras alteradas: { original → nueva } (p. ej. quitar espacios, cambiar mayúsculas). */
  cabeceras?: Record<string, string>;
  /** Columnas a omitir (por cabecera original). */
  omitir?: string[];
  /** Columnas adicionales al final. */
  extra?: string[];
}

const GRUPOS = [
  ['Comercio', 'Otros Equipamientos', 'Estancos', 'Estancos'],
  ['Hostelería y Restauración', null, 'Bares y Cafeterías', 'Bar'],
  ['Servicios', null, 'Peluquerías', null],
  ['Comercio', 'Alimentación', 'Pan y Lácteos', 'Panadería'],
] as const;

export async function libroFicticio(o: OpcionesLibroFicticio = {}): Promise<Uint8Array> {
  const perfil: PerfilImportacion = o.perfil === 'itinerario-28' ? PERFIL_ITINERARIO_28 : PERFIL_CENSO_27;
  const n = o.filas ?? 60;
  const wb = new ExcelJS.Workbook();
  const nombreDatos = o.hojaDatos ?? perfil.hojasHabituales[0];
  const orden: ('datos' | 'listas' | 'resumen')[] = o.auxiliares === false ? ['datos'] : ['datos', 'listas', 'resumen'];
  const pos = Math.min(Math.max(1, o.posicionDatos ?? 1), orden.length) - 1;
  orden.splice(0, 1);
  orden.splice(pos, 0, 'datos');
  const hojas: Record<string, ExcelJS.Worksheet> = {};
  for (const h of orden) hojas[h] = wb.addWorksheet(h === 'datos' ? nombreDatos : h === 'listas' ? 'Hoja1' : 'Tablas Dinámicas');

  const columnas = perfil.columnas.filter((c) => !(o.omitir ?? []).includes(c.cabecera));
  const ws = hojas.datos;
  ws.addRow([...columnas.map((c) => o.cabeceras?.[c.cabecera] ?? c.cabecera), ...(o.extra ?? [])]);
  ws.views = [{ state: 'frozen', xSplit: 6, ySplit: 1 }];
  const filas: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const vacio = i % 4 === 3;
    const g = GRUPOS[i % GRUPOS.length];
    const binario = (k: number) => (vacio ? null : (i + k) % 3 === 0 ? 1 : 0);
    const ig = binario(1);
    const fb = binario(2);
    const tw = binario(0);
    filas.push({
      fecha: new Date(Date.UTC(2025, i % 11, 1 + (i % 27))), municipio: 'MUNICIPIO FICTICIO', itinerario: 1, ordenPar: null,
      distrito: o.distritoZona ? 1 + (i % 5) : null, zona: o.distritoZona ? 10 + (i % 3) : null, cp: o.cpVacio ? null : o.cp ?? 47400,
      direccion: `VÍA FICTICIA ${String(1 + Math.floor(i / 8)).padStart(3, '0')}`, numero: 1 + (i % 8) * 2, vacio: vacio ? 1 : 0,
      fachada: vacio ? 4 + (i % 7) * 0.5 : null, nombre: vacio ? null : `COMERCIO FICTICIO ${String(i + 1).padStart(4, '0')}`,
      grupoActividad: vacio ? null : g[0], grupoComercio: vacio ? null : g[1], subgrupo: vacio ? null : g[2], actividad: vacio ? null : g[3],
      descripcionActividad: vacio || g[3] ? null : `Actividad de ejemplo ficticia ${i}`, franquicia: binario(4), web: binario(5), googleBusiness: binario(6),
      ventaOnline: binario(7), numResenas: vacio ? null : (i * 7) % 300, respondeResenas: binario(8), instagram: ig, seguidoresInstagram: vacio ? null : ig ? 100 + i : 0,
      facebook: fb, seguidoresFacebook: vacio ? null : fb ? 50 + i : 0, twitter: tw, seguidoresTwitter: vacio ? null : tw ? 10 + i : 0,
      numRedes: vacio ? null : (ig ?? 0) + (fb ?? 0) + (tw ?? 0),
    });
  }
  if (o.anomalias && n >= 12) {
    const ocupada = (k: number) => filas.filter((f) => f.vacio === 0)[k];
    filas[1].fecha = 'FECHA PENDIENTE';
    ocupada(0).web = 4;
    ocupada(1).respondeResenas = 23;
    ocupada(2).facebook = 247;
    ocupada(3).twitter = 379;
    ocupada(4).seguidoresInstagram = 'sin dato';
    ocupada(5).seguidoresFacebook = 's/i';
    ocupada(6).numRedes = 380;
    filas[3].fachada = '3,5 m';
    filas[5].numero = 'S/N';
    filas[6].numero = '6 B';
  }
  for (let k = 0; k < (o.repetidas ?? 0) && k + 1 < filas.length; k++) {
    // Misma calle y número con OTRO negocio (no se debe deduplicar)
    const base = filas[k * 2];
    filas.push({ ...base, vacio: 0, nombre: `SERVICIO FICTICIO REPETIDO ${k + 1}`, fachada: null });
  }
  for (const f of filas) {
    const fila = ws.addRow(columnas.map((c) => f[c.clave] ?? null));
    const ci = columnas.findIndex((c) => c.clave === 'fecha');
    if (ci >= 0 && f.fecha instanceof Date) fila.getCell(ci + 1).numFmt = 'dd/mm/yyyy';
  }

  if (hojas.listas) {
    const h = hojas.listas;
    h.addRow(['NÚMERO', 'LOCAL VACÍO', 'GR ACTIVIDAD', 'GR COMERCIO', 'SUBGRUPO ACTIVIDAD', 'ACTIVIDAD']);
    const listas = [[0, 1], ['Comercio', 'Hostelería y Restauración', 'Servicios'], ['Alimentación', 'Equipamiento Personal', 'Equipamiento del Hogar', 'Otros Equipamientos'], ['Agencias de Viajes', 'Alimentación Seca', 'Bares y Cafeterías'], ['Academias', 'Bar', 'Estancos']];
    for (let i = 0; i < 6; i++) h.addRow([i + 1, ...listas.map((l) => l[i] ?? null)]);
  }
  if (hojas.resumen) {
    const h = hojas.resumen;
    h.addRow(['RESUMEN FICTICIO; NO ES UNA FUENTE DE REGISTROS']);
    h.addRow([]);
    h.addRow(['Etiquetas de fila', 'Cuenta de GrActividad', 'Suma de Franquicia']);
    h.addRow(['Comercio', 10, 2]);
    h.addRow(['Total general', 10, 2]);
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/**
 * Convierte un libro en SpreadsheetML con PREFIJO de espacio de nombres (`<x:…>`), como lo
 * escriben algunas herramientas. Solo para pruebas del lector.
 */
export function conPrefijo(bytes: Uint8Array, prefijo = 'x'): Uint8Array {
  const archivos = unzipSync(bytes);
  for (const parte of Object.keys(archivos)) {
    if (!parte.startsWith('xl/') || !parte.endsWith('.xml')) continue;
    const xml = strFromU8(archivos[parte]);
    if (!new RegExp(`<[A-Za-z]+[^>]*\\sxmlns="${NS_SPREADSHEETML.replace(/[/.]/g, '\\$&')}"`).test(xml)) continue;
    const nuevo = xml
      .replace(/<(\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g, (m, cierre: string, nombre: string) => (nombre.includes(':') ? m : `<${cierre}${prefijo}:${nombre}`))
      .replace(`xmlns="${NS_SPREADSHEETML}"`, `xmlns:${prefijo}="${NS_SPREADSHEETML}"`);
    archivos[parte] = strToU8(nuevo);
  }
  return zipSync(archivos);
}
