import ExcelJS from 'exceljs';
import { unzipSync, zipSync } from 'fflate';
import { PERFIL_CENSO_27 } from '../domain/xlsx/perfilesImportacion';
import { claveCalle } from '../domain/text';
import { crearRng } from './rng';
import type { Calle } from '../domain/types';

/**
 * C1e · Archivo XLSX SINTÉTICO que reproduce las características AGREGADAS del censo real de Medina
 * del Campo 2025 (informe agregado de la Cátedra), para desarrollar y probar sin el archivo auténtico.
 *
 * - Hoja «Datos» con 889 filas y las 27 columnas exactas del perfil; hojas auxiliares «Tablas
 *   Dinámicas» (resumen estático) y «Hoja1» (listas), que no deben importarse como registros.
 * - 608 ocupadas, 280 vacías y 1 sin estado; GrActividad 242 / 277 / 90 (dos grafías de Hostelería).
 * - Fechas: 355 de 2024, 533 de 2025 y 1 texto no válido. CP 47400 en todas las filas.
 * - 93 denominaciones de calle literales (92 sin distinguir mayúsculas): nombres REALES del callejero
 *   OSM (10 literales y 60 en mayúsculas) y 23 inexistentes, para ejercitar la conciliación.
 * - 5 filas sin número; 625 pares calle + número, 186 repetidos con 445 registros (mismo portal =
 *   locales independientes); 12 vacíos sin fachada; 108 ocupados sin actividad; franquicia 529/79/281.
 *
 * Los negocios son inventados («NEGOCIO SINTÉTICO nnnn»), así como los números de portal. El archivo
 * lleva la marca `ULIT-C1E-SINTETICO` en sus propiedades: el espacio de datos reales lo rechaza.
 * DETERMINISTA: mismo callejero → mismo archivo y mismo SHA-256.
 */

export const MARCA_SINTETICO = 'ULIT-C1E-SINTETICO';
/** Marca de cualquier libro FICTICIO generado por la aplicación (C1a, escenario C1d). */
export const MARCA_FICTICIO = 'ULIT-GENERADO-FICTICIO';
export const ARCHIVO_SINTETICO_C1E = 'CENSO_MEDINA_2025_SINTETICO_C1E.xlsx';

const COMBOS: Record<'Comercio' | 'Servicios' | 'Hostelería', [string | null, string, string][]> = {
  Comercio: [
    ['Alimentación', 'Pan y Lácteos', 'Panadería'], ['Alimentación', 'Carnes', 'Carnicería'], ['Equipamiento Personal', 'Ropa', 'Moda Mujer'],
    ['Equipamiento Personal', 'Calzado', 'Calzado'], ['Otros Equipamientos', 'Estancos', 'Estancos'], ['Otros Equipamientos', 'Ocio', 'Papelería, Prensa y Librería'],
    ['Equipamiento del Hogar', 'Bricolaje y ferreterías', 'Bricolaje y Ferreterías'],
  ],
  Servicios: [[null, 'Otros servicios Profesionales', 'Asesorías'], [null, 'Servicios Médicos', 'Fisioterapia'], [null, 'Banca y Finanzas', 'Bancos'], [null, 'Peluquerías', 'Peluquería']],
  Hostelería: [[null, 'Bares y Cafeterías', 'Bar'], [null, 'Restaurantes', 'Tradicional']],
};

/** Permutación determinista de 0..n-1. */
function permutacion(n: number, semilla: string): number[] {
  const rng = crearRng(semilla);
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/** Denominaciones de calle: 10 literales OSM, 60 en mayúsculas (una repite a otra) y 23 inexistentes. */
export function denominacionesSinteticas(calles: Calle[]): { literales: string[]; existentes: number; inexistentes: number } {
  const unicas = new Map<string, string>();
  const repetidas = new Set<string>();
  for (const c of [...calles].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
    const k = claveCalle(c.nombre);
    if (unicas.has(k)) repetidas.add(k);
    else unicas.set(k, c.nombre);
  }
  const nombres = [...unicas.entries()].filter(([k]) => !repetidas.has(k)).map(([, n]) => n);
  if (nombres.length < 69) throw new Error(`El callejero tiene ${nombres.length} calles con nombre inequívoco; hacen falta al menos 69 para el archivo sintético.`);
  const orden = permutacion(nombres.length, 'c1e-calles').map((i) => nombres[i]);
  const literales = [
    ...orden.slice(0, 10), // literal OSM
    ...orden.slice(9, 69).map((n) => n.toLocaleUpperCase('es')), // en mayúsculas (orden[9] repite a uno literal)
    ...Array.from({ length: 23 }, (_, i) => `VÍA SINTÉTICA SIN CALLEJERO ${String(i + 1).padStart(2, '0')}`),
  ];
  return { literales, existentes: 70, inexistentes: 23 };
}

export async function libroSinteticoC1e(calles: Calle[]): Promise<Uint8Array> {
  const N = 889;
  const rng = crearRng('c1e-medina-2025-sintetico');
  const { literales } = denominacionesSinteticas(calles);

  // ── Direcciones: 625 pares (439 únicos, 113 × 2, 73 × 3 = 445 en portales compartidos) y 5 sin número.
  const multiplicidades = [...Array(439).fill(1), ...Array(113).fill(2), ...Array(73).fill(3)] as number[];
  const permM = permutacion(multiplicidades.length, 'c1e-portales');
  const dirs: { calle: string; numero: number | null }[] = [];
  const siguiente = new Map<string, number>();
  permM.forEach((idx, j) => {
    const calle = literales[j % literales.length];
    const n = (siguiente.get(calle) ?? 0) + 1 + (j % 3 === 0 ? 1 : 0);
    siguiente.set(calle, n);
    for (let k = 0; k < multiplicidades[idx]; k++) dirs.push({ calle, numero: n });
  });
  for (let k = 0; k < 5; k++) dirs.push({ calle: literales[(k * 17) % literales.length], numero: null });
  // Orden por calle y número, como un censo recorrido calle a calle.
  dirs.sort((a, b) => literales.indexOf(a.calle) - literales.indexOf(b.calle) || (a.numero ?? 1e9) - (b.numero ?? 1e9));

  // ── Estado del local y clasificación, con los recuentos exactos.
  const perm = permutacion(N, 'c1e-estado');
  const estado: ('vacio' | 'ocupado' | 'sin')[] = Array(N).fill('ocupado');
  perm.slice(0, 280).forEach((i) => (estado[i] = 'vacio'));
  estado[perm[280]] = 'sin';
  const conGrupo = perm.slice(280); // 609 (608 ocupadas + 1 sin estado)
  const grupo: (string | null)[] = Array(N).fill(null);
  conGrupo.forEach((i, j) => (grupo[i] = j < 242 ? 'Comercio' : j < 519 ? 'Servicios' : j < 589 ? 'Hostelería y Restauración' : 'Hostelería y restauración'));
  const ocupadas = perm.slice(281);
  const sinActividad = new Set(permutacion(608, 'c1e-actividad').slice(0, 108).map((j) => ocupadas[j]));
  const franqUno = new Set(permutacion(608, 'c1e-franquicia').slice(0, 79).map((j) => ocupadas[j]));
  const vacios = perm.slice(0, 280);
  const sinFachada = new Set(permutacion(280, 'c1e-fachada').slice(0, 12).map((j) => vacios[j]));

  // ── Fechas: 355 de 2024 (oct–dic) y 533 de 2025 (ene–nov); 1 texto no válido.
  const permF = permutacion(N, 'c1e-fechas');
  const fecha: (Date | string)[] = Array(N);
  permF.forEach((i, j) => {
    if (j === 0) fecha[i] = 'FECHA PENDIENTE';
    else if (j <= 355) fecha[i] = new Date(Date.UTC(2024, 9 + (j % 3), 1 + (j % 28)));
    else fecha[i] = new Date(Date.UTC(2025, j % 11, 1 + (j % 28)));
  });

  const filas: Record<string, unknown>[] = [];
  for (let i = 0; i < N; i++) {
    const e = estado[i];
    const g = grupo[i];
    const sector = g === 'Comercio' ? 'Comercio' : g === 'Servicios' ? 'Servicios' : g ? 'Hostelería' : null;
    const combo = sector ? COMBOS[sector][i % COMBOS[sector].length] : null;
    const ocupada = e === 'ocupado';
    const b = (p: number) => (rng.chance(p) ? 1 : 0);
    const google = b(0.55), ig = b(0.45), fb = b(0.35), tw = b(0.08);
    filas.push({
      fecha: fecha[i], cp: 47400, direccion: dirs[i].calle, numero: dirs[i].numero,
      vacio: e === 'vacio' ? 1 : e === 'ocupado' ? 0 : null,
      fachada: e === 'vacio' && !sinFachada.has(i) ? Math.round(rng.int(25, 140)) / 10 : null,
      nombre: g ? `NEGOCIO SINTÉTICO ${String(i + 1).padStart(4, '0')}` : null,
      grupoActividad: g, grupoComercio: combo?.[0] ?? null, subgrupo: combo?.[1] ?? null,
      actividad: combo && !sinActividad.has(i) ? combo[2] : null, descripcionActividad: null,
      franquicia: ocupada ? (franqUno.has(i) ? 1 : 0) : null,
      web: ocupada ? b(0.4) : null, googleBusiness: ocupada ? google : null, ventaOnline: ocupada ? b(0.12) : null,
      numResenas: ocupada ? (google ? rng.int(0, 500) : 0) : null, respondeResenas: ocupada ? (google ? b(0.5) : 0) : null,
      instagram: ocupada ? ig : null, seguidoresInstagram: ocupada ? (ig ? rng.int(30, 8000) : 0) : null,
      facebook: ocupada ? fb : null, seguidoresFacebook: ocupada ? (fb ? rng.int(20, 5000) : 0) : null,
      twitter: ocupada ? tw : null, seguidoresTwitter: ocupada ? (tw ? rng.int(5, 2000) : 0) : null,
      numRedes: ocupada ? ig + fb + tw : null,
    });
  }

  const wb = new ExcelJS.Workbook();
  const fijo = new Date(Date.UTC(2026, 9, 23));
  Object.assign(wb, {
    creator: 'ULIT Censo · archivo SINTÉTICO C1e', lastModifiedBy: 'ULIT Censo · archivo SINTÉTICO C1e', created: fijo, modified: fijo,
    title: 'SINTÉTICO: no es el censo real de Medina del Campo', keywords: MARCA_SINTETICO,
  });
  const ws = wb.addWorksheet('Datos');
  ws.addRow(PERFIL_CENSO_27.columnas.map((c) => c.cabecera));
  ws.views = [{ state: 'frozen', xSplit: 6, ySplit: 1 }];
  for (const f of filas) {
    const row = ws.addRow(PERFIL_CENSO_27.columnas.map((c) => f[c.clave] ?? null));
    if (f.fecha instanceof Date) row.getCell(1).numFmt = 'dd/mm/yyyy';
  }
  const td = wb.addWorksheet('Tablas Dinámicas');
  td.addRow(['RESUMEN SINTÉTICO (simulación): NO ES UNA FUENTE DE REGISTROS']);
  td.addRow([]);
  td.addRow(['Etiquetas de fila', 'Cuenta de GrActividad', 'Suma de Franquicia']);
  const cuenta = (pred: (f: Record<string, unknown>) => boolean) => filas.filter(pred).length;
  const franq = (pred: (f: Record<string, unknown>) => boolean) => filas.filter((f) => pred(f) && f.franquicia === 1).length;
  td.addRow(['Comercio', cuenta((f) => f.grupoActividad === 'Comercio'), franq((f) => f.grupoActividad === 'Comercio')]);
  td.addRow(['Hostelería y Restauración', cuenta((f) => String(f.grupoActividad ?? '').startsWith('Hostelería')), franq((f) => String(f.grupoActividad ?? '').startsWith('Hostelería'))]);
  td.addRow(['Servicios', cuenta((f) => f.grupoActividad === 'Servicios'), franq((f) => f.grupoActividad === 'Servicios')]);
  td.addRow(['Total general', cuenta((f) => !!f.grupoActividad), franq(() => true)]);
  const h1 = wb.addWorksheet('Hoja1');
  h1.addRow(['NÚMERO', 'LOCAL VACÍO', 'GR ACTIVIDAD', 'GR COMERCIO', 'SUBGRUPO ACTIVIDAD', 'ACTIVIDAD']);
  [[1, 0, 'Comercio', 'Alimentación', 'Pan y Lácteos', 'Panadería'], [2, 1, 'Hostelería y Restauración', 'Equipamiento Personal', 'Bares y Cafeterías', 'Bar'], [3, null, 'Servicios', 'Otros Equipamientos', 'Peluquerías', 'Asesorías']].forEach((r) => h1.addRow(r));
  const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return zipSync(unzipSync(bytes), { mtime: fijo, level: 6 });
}

/**
 * ¿Lleva el archivo la marca de un libro generado por la aplicación (sintético de C1e o ficticio de C1a/C1d)? Solo lee `docProps/core.xml` (pequeño), sin
 * descomprimir el resto. Cualquier error de lectura → «no consta» (lo validará el lector seguro de C1a).
 */
export function esArchivoSintetico(bytes: Uint8Array): boolean {
  try {
    const partes = unzipSync(bytes, { filter: (f) => f.name === 'docProps/core.xml' && f.originalSize < 256 * 1024 });
    const core = partes['docProps/core.xml'];
    const xml = core ? new TextDecoder().decode(core) : '';
    return xml.includes(MARCA_SINTETICO) || xml.includes(MARCA_FICTICIO);
  } catch {
    return false;
  }
}
