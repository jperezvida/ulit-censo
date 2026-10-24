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
 *   OSM (10 literales, 61 en mayúsculas y una variante en minúsculas de «Calle de las Angustias») y 21
 *   sin correspondencia (177 registros), entre ellas «Plaza Mayor» (45) y «Calle de las Farolas Antigua
 *   Ángel Molina» (42), para ejercitar la conciliación supervisada.
 * - 5 filas sin número; 625 pares calle (normalizada) + número, 186 repetidos con 445 registros (mismo
 *   portal = locales independientes), entre ellos 3 «Carretera de Peñaranda, S/N»; sin normalizar la
 *   calle serían 630 pares y 440 registros (variante en los portales 37, 39, 42, 46 y 48).
 * - 12 vacíos sin fachada; 108 ocupados sin actividad; franquicia 529/79/281.
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

/** Calle con dos grafías que solo difieren en mayúsculas (como en el archivo auténtico). */
export const CALLE_VARIANTE = 'Calle de las Angustias';
/** Portales donde conviven ambas grafías (en el auténtico: 37, 39, 42, 46 y 48). */
export const PORTALES_VARIANTE = [37, 39, 42, 46, 48];
/** Vía con tres registros «S/N»: se agrupan textualmente pero no identifican un portal numérico. */
export const CALLE_SN = 'Carretera de Peñaranda';
/**
 * Denominaciones SIN correspondencia literal en el callejero OSM, con los registros del auténtico en las
 * cuatro prioritarias. Las grafías de las rondas son variantes SINTÉTICAS verosímiles (el informe no da
 * las literales); «Plaza Mayor» y «Calle de las Farolas Antigua Ángel Molina» reproducen los casos
 * comunicados por la Cátedra.
 */
export const PENDIENTES_SINTETICAS: [string, number][] = [
  ['Plaza Mayor', 45], ['Calle de las Farolas Antigua Ángel Molina', 42], ['Rda. de Gracia', 19], ['Rda. de las Flores', 13],
  ...Array.from({ length: 17 }, (_, i): [string, number] => [`VÍA SINTÉTICA SIN CALLEJERO ${String(i + 1).padStart(2, '0')}`, i < 7 ? 4 : 3]),
];
const variante = (n: string) => n.replace(/(\s)(\p{Lu})(\p{Ll}+)$/u, (_, sp: string, a: string, b: string) => `${sp}${a.toLocaleLowerCase('es')}${b}`);

/**
 * Denominaciones de calle (93 literales, 92 sin distinguir mayúsculas): 10 literales OSM (incluidas la
 * calle con variante y la vía con S/N si existen), la variante en minúsculas, 61 en mayúsculas y las 21
 * sin correspondencia de `PENDIENTES_SINTETICAS`.
 */
export function denominacionesSinteticas(calles: Calle[]): { literales: string[]; reconocidas: string[]; variante: { calle: string; grafia: string }; sn: string; pendientes: [string, number][] } {
  const unicas = new Map<string, string>();
  const repetidas = new Set<string>();
  for (const c of [...calles].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))) {
    const k = claveCalle(c.nombre);
    if (unicas.has(k)) repetidas.add(k);
    else unicas.set(k, c.nombre);
  }
  const nombres = [...unicas.entries()].filter(([k]) => !repetidas.has(k)).map(([, n]) => n);
  if (nombres.length < 71) throw new Error(`El callejero tiene ${nombres.length} calles con nombre inequívoco; hacen falta al menos 71 para el archivo sintético.`);
  const prioritarias = [CALLE_VARIANTE, CALLE_SN].filter((n) => nombres.includes(n));
  const orden = [...prioritarias, ...permutacion(nombres.length, 'c1e-calles').map((i) => nombres[i]).filter((n) => !prioritarias.includes(n))];
  const calleVar = orden[0];
  const grafia = variante(calleVar) !== calleVar ? variante(calleVar) : calleVar.toLocaleUpperCase('es');
  const sn = prioritarias.includes(CALLE_SN) ? CALLE_SN : orden[1];
  const reconocidas = [...orden.slice(0, 10), ...orden.slice(10, 71).map((n) => n.toLocaleUpperCase('es'))];
  return { literales: [...reconocidas, grafia, ...PENDIENTES_SINTETICAS.map(([n]) => n)], reconocidas, variante: { calle: calleVar, grafia }, sn, pendientes: PENDIENTES_SINTETICAS };
}

/**
 * Direcciones de las 889 filas (en el orden de un censo recorrido calle a calle):
 * - 625 pares calle (normalizada) + número: 439 únicos, 113 × 2 y 73 × 3 (186 repetidos, 445 registros);
 * - en 5 portales de la calle con variante, 2 registros con la grafía OSM y 1 con la variante: sin
 *   normalizar son 630 pares y 440 registros en portales compartidos;
 * - uno de los pares triples es «S/N» (3 registros que no identifican un portal numérico);
 * - 177 registros en las 21 denominaciones sin correspondencia; 5 filas sin número.
 */
export function direccionesSinteticas(calles: Calle[]): { calle: string; numero: number | string | null }[] {
  const den = denominacionesSinteticas(calles);
  const pool = { 1: 439, 2: 113, 3: 73 } as Record<1 | 2 | 3, number>;
  const pares: { calle: string; numero: number | string; mult: number; grafias?: [number, number] }[] = [];
  const tomar = (m: 1 | 2 | 3) => {
    if (pool[m] <= 0) throw new Error('Reparto de portales imposible.');
    pool[m]--;
    return m;
  };
  const siguiente = new Map<string, number>();
  const reservados = new Set(PORTALES_VARIANTE);
  const numero = (calle: string, j: number) => {
    let n = (siguiente.get(calle) ?? 0) + 1 + (j % 3 === 0 ? 1 : 0);
    while (calle === den.variante.calle && reservados.has(n)) n++;
    siguiente.set(calle, n);
    return n;
  };
  // Portales con ambas grafías (pares triples) y el «S/N».
  for (const n of PORTALES_VARIANTE) pares.push({ calle: den.variante.calle, numero: n, mult: tomar(3), grafias: [2, 1] });
  pares.push({ calle: den.sn, numero: 'S/N', mult: tomar(3) });
  // Denominaciones sin correspondencia, con su número exacto de registros.
  let j = 0;
  for (const [calle, total] of den.pendientes) {
    let resto = total;
    for (const m of [3, 2] as const) for (let k = 0; k < Math.floor(total / 10); k++) if (resto - m >= 1) { resto -= m; pares.push({ calle, numero: numero(calle, j++), mult: tomar(m) }); }
    while (resto > 0) { resto--; pares.push({ calle, numero: numero(calle, j++), mult: tomar(1) }); }
  }
  // El resto se reparte entre las calles reconocidas.
  const restantes = permutacion(pool[1] + pool[2] + pool[3], 'c1e-portales').map((i) => (i < pool[1] ? 1 : i < pool[1] + pool[2] ? 2 : 3));
  restantes.forEach((m, k) => {
    const calle = den.reconocidas[k % den.reconocidas.length];
    pares.push({ calle, numero: numero(calle, j++), mult: m });
  });
  const dirs: { calle: string; numero: number | string | null }[] = [];
  for (const p of pares) {
    if (p.grafias) {
      for (let k = 0; k < p.grafias[0]; k++) dirs.push({ calle: p.calle, numero: p.numero });
      for (let k = 0; k < p.grafias[1]; k++) dirs.push({ calle: den.variante.grafia, numero: p.numero });
    } else for (let k = 0; k < p.mult; k++) dirs.push({ calle: p.calle, numero: p.numero });
  }
  for (let k = 0; k < 5; k++) dirs.push({ calle: den.reconocidas[(k * 17) % den.reconocidas.length], numero: null });
  const pos = (c: string) => { const i = den.literales.indexOf(c); return c === den.variante.grafia ? den.literales.indexOf(den.variante.calle) : i; };
  const num = (n: number | string | null) => (typeof n === 'number' ? n : n === null ? 1e9 : 1e8);
  return dirs.sort((a, b) => pos(a.calle) - pos(b.calle) || num(a.numero) - num(b.numero));
}

export async function libroSinteticoC1e(calles: Calle[]): Promise<Uint8Array> {
  const N = 889;
  const rng = crearRng('c1e-medina-2025-sintetico');
  const dirs = direccionesSinteticas(calles);
  if (dirs.length !== N) throw new Error(`Reparto de direcciones incorrecto: ${dirs.length} filas.`);

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
