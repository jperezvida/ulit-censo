import type ExcelJS from 'exceljs';
import { leerLibro, type AdaptacionParte } from './lector';
import { compararCabecera, normalizarCabecera, PERFILES_IMPORTACION, type Coincidencia, type ColumnaPerfil, type PerfilImportacion, type TipoEsperado } from './perfilesImportacion';
import { evaluarCampoTerritorial, type ConfigTerritorial, type EvaluacionTerritorial } from '../territorio';

/**
 * Informe ESTRUCTURAL previo a una importación (C1a).
 *
 * Identifica la hoja de datos por su estructura (no por su nombre ni su posición), la fila de
 * cabecera, las columnas con su cabecera original exacta, los tipos y formatos detectados, las
 * filas y los perfiles compatibles, con sus diferencias.
 *
 * Garantías: es una función PURA sobre el archivo. No importa negocios, no crea locales, no
 * modifica campañas ni guarda el archivo. No incluye nombres de negocio ni direcciones: solo
 * recuentos y categorías de tipo.
 */

export type TipoDetectado = 'fecha' | 'entero' | 'decimal' | 'texto' | 'texto-numerico' | 'booleano' | 'error';

export interface InformeColumna {
  indice: number;
  letra: string;
  /** Cabecera EXACTA del archivo (con espacios). */
  cabecera: string;
  /** Espacios al principio o al final de la cabecera original (para hacerlos visibles). */
  espaciosSobrantes: number;
  perfil?: { clave: string; cabeceraPerfil: string; tipoEsperado: TipoEsperado; coincidencia: Coincidencia };
  tipos: Partial<Record<TipoDetectado, number>>;
  formatos: Record<string, number>;
  vacias: number;
  noVacias: number;
  formulas: number;
  /** Celdas cuyo tipo no encaja con el esperado, por categoría (sin valores). */
  discordantes: Record<string, number>;
  /** Variantes admitidas que conviene conocer (p. ej. «con sufijo», «S/N»), por categoría. */
  variantes: Record<string, number>;
}

export interface CompatibilidadPerfil {
  perfilId: string;
  version: number;
  nombre: string;
  compatible: boolean;
  encontradas: number;
  total: number;
  faltan: string[];
  sobran: string[];
  diferencias: { cabeceraArchivo: string; cabeceraPerfil: string; coincidencia: Exclude<Coincidencia, 'exacta'> }[];
  ordenIgual: boolean;
  duplicadas: string[];
}

export type RolHoja = 'datos' | 'listas' | 'resumen' | 'otra';

export interface InformeHoja {
  nombre: string;
  posicion: number;
  visible: boolean;
  filas: number;
  columnas: number;
  filaCabecera: number | null;
  rol: RolHoja;
  motivo: string;
  /** Mejor cobertura de un perfil (0–1). */
  cobertura: number;
}

export interface InformeEstructural {
  formato: 'ulit-censo/informe-estructural';
  version: 1;
  generado: string;
  archivo: { nombre: string; bytes: number; sha256: string };
  lector: { motor: 'exceljs' | 'exceljs+adaptacion-prefijos'; adaptaciones: AdaptacionParte[]; rutasAbsolutas: boolean };
  hojas: InformeHoja[];
  hojaDatos: string | null;
  eleccionHoja: 'automatica' | 'ambigua' | 'ninguna';
  perfiles: CompatibilidadPerfil[];
  perfilPropuesto: string | null;
  columnas: InformeColumna[];
  filas: { filaCabecera: number | null; conDatos: number; primera: number | null; ultima: number | null; enBlancoIntercaladas: number; posiblesTotales: number[] };
  estructura: { panelesCongelados?: { filas: number; columnas: number }; filtro?: string; filasOcultas: number; columnasOcultas: number; celdasCombinadas: number; validaciones: number; formulas: number };
  territorio?: { municipio: string; version: number; campos: EvaluacionTerritorial[]; nota: string };
  direccionesRepetidas?: { grupos: number; filas: number; nota: string };
  avisos: string[];
  garantias: string[];
}

export interface OpcionesAnalisis {
  /** Configuración territorial del municipio al que se destina el archivo. */
  territorio?: ConfigTerritorial;
  perfiles?: PerfilImportacion[];
}

// ───────────── Utilidades de celda ─────────────

export function letraColumna(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function valorPlano(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return (v as { result?: unknown }).result ?? null;
    if ('richText' in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
    if ('text' in v) return (v as { text: unknown }).text;
    if ('error' in v) return { error: (v as { error: string }).error };
  }
  return v;
}

const esFormula = (v: ExcelJS.CellValue) => !!v && typeof v === 'object' && !(v instanceof Date) && ('formula' in v || 'sharedFormula' in v);

function tipoDe(v: unknown): TipoDetectado | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return 'fecha';
  if (typeof v === 'number') return Number.isInteger(v) ? 'entero' : 'decimal';
  if (typeof v === 'boolean') return 'booleano';
  if (typeof v === 'object') return 'error';
  const t = String(v).trim();
  if (!t) return null;
  return /^-?\d+([.,]\d+)?$/.test(t) ? 'texto-numerico' : 'texto';
}

const sumar = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);

/** Clasifica una celda frente al tipo esperado: discordancia o variante admitida (solo categorías). */
function clasificar(tipo: TipoEsperado, t: TipoDetectado, v: unknown, col: InformeColumna) {
  const num = typeof v === 'number' ? v : t === 'texto-numerico' ? Number(String(v).trim().replace(',', '.')) : NaN;
  switch (tipo) {
    case 'fecha':
      if (t === 'entero' || t === 'decimal') sumar(col.discordantes, 'número sin formato de fecha');
      else if (t !== 'fecha') sumar(col.discordantes, 'texto u otro tipo en columna de fecha');
      return;
    case 'binario-01':
      if ((t === 'entero' || t === 'decimal') && (num === 0 || num === 1)) return;
      if (t === 'texto-numerico' && (num === 0 || num === 1)) return void sumar(col.variantes, '0/1 guardado como texto');
      if (t === 'entero' || t === 'decimal' || t === 'texto-numerico') return void sumar(col.discordantes, 'número distinto de 0 y 1');
      return void sumar(col.discordantes, 'texto u otro tipo en columna 0/1');
    case 'entero':
      if (t === 'entero') return void (num < 0 && sumar(col.discordantes, 'número negativo'));
      if (t === 'decimal') return void sumar(col.discordantes, 'decimal en columna de enteros');
      if (t === 'texto-numerico') return void sumar(col.variantes, 'número guardado como texto');
      return void sumar(col.discordantes, 'texto u otro tipo en columna numérica');
    case 'decimal':
      if (t === 'entero' || t === 'decimal') return;
      if (t === 'texto-numerico') return void sumar(col.variantes, 'número guardado como texto');
      return void sumar(col.discordantes, 'texto u otro tipo en columna numérica');
    case 'portal': {
      if (t === 'entero') return;
      const s = String(v).trim();
      if (/^s\s*\/\s*n$/i.test(s)) return void sumar(col.variantes, 'S/N');
      if (/^\d+\s*[A-Za-zºª.-]{1,5}$|^\d+\s+(bis|dup\.?|esq\.?)$/i.test(s)) return void sumar(col.variantes, 'número con sufijo');
      if (t === 'decimal') return void sumar(col.discordantes, 'número decimal');
      if (t === 'texto-numerico') return void sumar(col.variantes, 'número guardado como texto');
      return void sumar(col.discordantes, 'texto no reconocido como número de portal');
    }
    case 'codigo-postal': {
      const s = typeof v === 'number' ? String(v) : String(v).trim();
      if (/^\d{5}$/.test(s)) return void (t !== 'entero' && sumar(col.variantes, 'código postal guardado como texto'));
      if (/^\d{4}$/.test(s)) return void sumar(col.discordantes, 'código postal de 4 cifras (¿cero inicial perdido?)');
      return void sumar(col.discordantes, 'valor que no es un código postal de 5 cifras');
    }
    case 'codigo':
      return;
    case 'texto':
    case 'lista':
      if (t !== 'texto' && t !== 'texto-numerico') sumar(col.variantes, 'valor no textual');
  }
}

// ───────────── Cabecera, roles y perfiles ─────────────

function cabecerasDeFila(ws: ExcelJS.Worksheet, r: number): Map<number, string> {
  const m = new Map<number, string>();
  ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
    const v = valorPlano(cell.value);
    if (typeof v === 'string' && v.trim()) m.set(col, v);
  });
  return m;
}

function compatibilidad(cabs: Map<number, string>, perfil: PerfilImportacion): CompatibilidadPerfil & { asignacion: Map<number, { col: ColumnaPerfil; coincidencia: Coincidencia }> } {
  const asignacion = new Map<number, { col: ColumnaPerfil; coincidencia: Coincidencia }>();
  const usadas = new Set<string>();
  const duplicadas: string[] = [];
  const repetidas = new Set<number>();
  const diferencias: CompatibilidadPerfil['diferencias'] = [];
  const orden = [...cabs.keys()].sort((a, b) => a - b);
  for (const idx of orden) {
    const h = cabs.get(idx)!;
    let mejor: { col: ColumnaPerfil; coincidencia: Coincidencia } | undefined;
    for (const col of perfil.columnas) {
      const k = compararCabecera(h, col);
      if (k && (!mejor || RANGO[k] < RANGO[mejor.coincidencia])) mejor = { col, coincidencia: k };
    }
    if (!mejor) continue;
    if (usadas.has(mejor.col.clave)) {
      duplicadas.push(h);
      repetidas.add(idx);
      continue;
    }
    usadas.add(mejor.col.clave);
    asignacion.set(idx, mejor);
    if (mejor.coincidencia !== 'exacta') diferencias.push({ cabeceraArchivo: h, cabeceraPerfil: mejor.col.cabecera, coincidencia: mejor.coincidencia });
  }
  const faltan = perfil.columnas.filter((c) => !usadas.has(c.clave)).map((c) => c.cabecera);
  const sobran = orden.filter((i) => !asignacion.has(i) && !repetidas.has(i)).map((i) => cabs.get(i)!);
  const ordenArchivo = orden.filter((i) => asignacion.has(i)).map((i) => asignacion.get(i)!.col.clave);
  const ordenPerfil = perfil.columnas.map((c) => c.clave).filter((k) => usadas.has(k));
  const obligatoriasFaltan = perfil.columnas.filter((c) => c.obligatoria && !usadas.has(c.clave)).length;
  return {
    perfilId: perfil.id, version: perfil.version, nombre: perfil.nombre,
    compatible: obligatoriasFaltan === 0 && sobran.length === 0 && duplicadas.length === 0,
    encontradas: usadas.size, total: perfil.columnas.length, faltan, sobran, diferencias,
    ordenIgual: ordenArchivo.join('|') === ordenPerfil.join('|'), duplicadas, asignacion,
  };
}
const RANGO: Record<Coincidencia, number> = { exacta: 0, espacios: 1, mayusculas: 2, alias: 3, tildes: 4 };

const MARCAS_RESUMEN = ['etiquetas de fila', 'total general', 'cuenta de', 'suma de', 'promedio de', 'tabla dinamica', 'tabla dinámica'];
const CABECERAS_LISTAS = ['local vacio', 'local vacío', 'gr actividad', 'gr comercio', 'subgrupo actividad', 'actividad'];

/** Fila de cabecera: la que mejor cubre algún perfil entre las 10 primeras. */
function mejorCabecera(ws: ExcelJS.Worksheet, perfiles: PerfilImportacion[]) {
  let mejor = { fila: null as number | null, cobertura: 0, cabs: new Map<number, string>() };
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const cabs = cabecerasDeFila(ws, r);
    if (cabs.size < 3) continue;
    for (const p of perfiles) {
      const comp = compatibilidad(cabs, p);
      const cobertura = comp.encontradas / p.columnas.length;
      if (cobertura > mejor.cobertura) mejor = { fila: r, cobertura, cabs };
    }
  }
  return mejor;
}

function rolDeHoja(ws: ExcelJS.Worksheet, cobertura: number): { rol: RolHoja; motivo: string } {
  const textos: string[] = [];
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      const v = valorPlano(cell.value);
      if (typeof v === 'string') textos.push(normalizarCabecera(v));
    });
  }
  const resumen = textos.filter((t) => MARCAS_RESUMEN.some((m) => t.startsWith(m) || t.includes(m)));
  if (resumen.length >= 2) return { rol: 'resumen', motivo: 'Contiene rótulos de tabla de resumen («Etiquetas de fila», «Cuenta de…», «Total general»): no es fuente de registros.' };
  if (cobertura >= 0.6) return { rol: 'datos', motivo: `Sus cabeceras cubren el ${Math.round(cobertura * 100)} % de un perfil conocido.` };
  const listas = textos.filter((t) => CABECERAS_LISTAS.includes(t)).length;
  if (listas >= 3) return { rol: 'listas', motivo: 'Listas de clasificación (columnas independientes; no forman una jerarquía).' };
  return { rol: 'otra', motivo: 'No coincide con ningún perfil conocido.' };
}

async function sha256(datos: Uint8Array): Promise<string> {
  const h = await globalThis.crypto.subtle.digest('SHA-256', datos as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────────── Análisis ─────────────

export async function analizarXlsx(datos: ArrayBuffer | Uint8Array, nombreArchivo: string, opciones: OpcionesAnalisis = {}): Promise<InformeEstructural> {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const perfiles = opciones.perfiles ?? PERFILES_IMPORTACION;
  const leido = await leerLibro(bytes);
  const avisos: string[] = [];
  if (leido.adaptaciones.length) {
    avisos.push(`El libro usa XML con prefijo de espacio de nombres (válido en OOXML, pero no lo guarda así Excel). Se ha leído con una adaptación en memoria de ${leido.adaptaciones.length} parte(s); el archivo original no se modifica.`);
  }

  // 1. Hojas y rol de cada una
  const hojas: InformeHoja[] = [];
  const candidatas: { ws: ExcelJS.Worksheet; fila: number; cobertura: number; cabs: Map<number, string> }[] = [];
  leido.libro.worksheets.forEach((ws, i) => {
    const m = mejorCabecera(ws, perfiles);
    const { rol, motivo } = rolDeHoja(ws, m.cobertura);
    hojas.push({ nombre: ws.name, posicion: i + 1, visible: ws.state === undefined || ws.state === 'visible', filas: ws.actualRowCount, columnas: ws.actualColumnCount, filaCabecera: rol === 'datos' ? m.fila : null, rol, motivo, cobertura: Math.round(m.cobertura * 1000) / 1000 });
    if (rol === 'datos' && m.fila) candidatas.push({ ws, fila: m.fila, cobertura: m.cobertura, cabs: m.cabs });
  });
  candidatas.sort((a, b) => b.cobertura - a.cobertura);
  const elegida = candidatas[0];
  const eleccionHoja: InformeEstructural['eleccionHoja'] = !elegida ? 'ninguna' : candidatas.length > 1 && candidatas[1].cobertura === elegida.cobertura ? 'ambigua' : 'automatica';
  if (eleccionHoja === 'ninguna') avisos.push('No se ha encontrado ninguna hoja cuyas cabeceras coincidan con un perfil conocido.');
  if (eleccionHoja === 'ambigua') avisos.push(`Varias hojas tienen la misma estructura de datos (${candidatas.filter((c) => c.cobertura === elegida.cobertura).map((c) => `«${c.ws.name}»`).join(', ')}): hay que elegir cuál importar.`);
  for (const h of hojas) if (h.rol === 'resumen') avisos.push(`Hoja «${h.nombre}»: es un resumen y no se usará como origen de registros.`);
  if (elegida && hojas.find((h) => h.nombre === elegida.ws.name)!.posicion !== 1) avisos.push(`La hoja de datos «${elegida.ws.name}» no es la primera del libro: se ha identificado por su estructura.`);

  const base = {
    formato: 'ulit-censo/informe-estructural' as const, version: 1 as const, generado: new Date().toISOString(),
    archivo: { nombre: nombreArchivo, bytes: bytes.byteLength, sha256: await sha256(bytes) },
    lector: { motor: leido.lector, adaptaciones: leido.adaptaciones, rutasAbsolutas: leido.diagnostico.rutasAbsolutas },
    hojas, eleccionHoja,
    garantias: [
      'Análisis de solo lectura: no se ha importado ningún negocio, no se han creado locales ni se ha modificado ninguna campaña.',
      'El archivo no se ha guardado en la aplicación ni se ha enviado a ningún servidor.',
      'El informe no contiene nombres de negocio ni direcciones: solo estructura y recuentos.',
    ],
  };
  if (!elegida) {
    return { ...base, hojaDatos: null, perfiles: [], perfilPropuesto: null, columnas: [], filas: { filaCabecera: null, conDatos: 0, primera: null, ultima: null, enBlancoIntercaladas: 0, posiblesTotales: [] }, estructura: { filasOcultas: 0, columnasOcultas: 0, celdasCombinadas: 0, validaciones: 0, formulas: 0 }, avisos };
  }

  // 2. Perfiles compatibles con la hoja de datos
  const ws = elegida.ws;
  const comps = perfiles.map((p) => compatibilidad(elegida.cabs, p)).sort((a, b) => Number(b.compatible) - Number(a.compatible) || b.encontradas / b.total - a.encontradas / a.total);
  const propuesto = comps.find((c) => c.compatible) ?? null;
  const asignacion = (propuesto ?? comps[0]).asignacion;
  if (!propuesto) avisos.push(`Ningún perfil es plenamente compatible. El más cercano es «${comps[0].nombre}» (${comps[0].encontradas} de ${comps[0].total} columnas).`);
  for (const c of comps) for (const d of c.diferencias) if (c === propuesto && d.coincidencia === 'tildes') avisos.push(`Cabecera «${d.cabeceraArchivo}» reconocida como «${d.cabeceraPerfil}» pese a una diferencia de tildes: revísala.`);

  // 3. Columnas, tipos y formatos
  const primera = elegida.fila + 1;
  const ultimaFila = ws.actualRowCount ? ws.rowCount : elegida.fila;
  const ncols = Math.max(ws.actualColumnCount, ...elegida.cabs.keys());
  const columnas: InformeColumna[] = [];
  let formulas = 0;
  const filasConDatos: number[] = [];
  const posiblesTotales: number[] = [];
  for (let r = primera; r <= ultimaFila; r++) {
    const row = ws.getRow(r);
    if (row.actualCellCount === 0) continue;
    let alguna = false;
    let primeraTexto: string | null = null;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = valorPlano(cell.value);
      if (tipoDe(v)) {
        alguna = true;
        if (primeraTexto === null && typeof v === 'string') primeraTexto = normalizarCabecera(v);
      }
    });
    if (!alguna) continue;
    filasConDatos.push(r);
    if (primeraTexto && /^(total|suma|subtotal)\b/.test(primeraTexto)) posiblesTotales.push(r);
  }
  for (let ci = 1; ci <= ncols; ci++) {
    const cab = elegida.cabs.get(ci) ?? '';
    const asig = asignacion.get(ci);
    const col: InformeColumna = {
      indice: ci, letra: letraColumna(ci), cabecera: cab, espaciosSobrantes: cab.length - cab.trim().length,
      perfil: asig ? { clave: asig.col.clave, cabeceraPerfil: asig.col.cabecera, tipoEsperado: asig.col.tipo, coincidencia: asig.coincidencia } : undefined,
      tipos: {}, formatos: {}, vacias: 0, noVacias: 0, formulas: 0, discordantes: {}, variantes: {},
    };
    for (const r of filasConDatos) {
      const cell = ws.getRow(r).getCell(ci);
      if (esFormula(cell.value)) {
        col.formulas++;
        formulas++;
      }
      const v = valorPlano(cell.value);
      const t = tipoDe(v);
      if (!t) {
        col.vacias++;
        continue;
      }
      col.noVacias++;
      sumar(col.tipos as Record<string, number>, t);
      sumar(col.formatos, cell.numFmt || 'General');
      if (asig) clasificar(asig.col.tipo, t, v, col);
    }
    if (!cab && !col.noVacias) continue;
    columnas.push(col);
  }
  const enBlanco = filasConDatos.length ? filasConDatos[filasConDatos.length - 1] - filasConDatos[0] + 1 - filasConDatos.length : 0;
  if (enBlanco) avisos.push(`${enBlanco} fila(s) en blanco entre los datos: no se tratarán como registros.`);
  if (posiblesTotales.length) avisos.push(`Posibles filas de totales al final de los datos (filas ${posiblesTotales.join(', ')}): no son registros.`);
  for (const col of columnas) {
    const n = Object.values(col.discordantes).reduce((a, b) => a + b, 0);
    if (n) avisos.push(`Columna «${col.cabecera.trim()}»: ${n} celda(s) no encajan con el tipo esperado (${Object.entries(col.discordantes).map(([k, v]) => `${v} ${k}`).join('; ')}). Se tratarán en C1b sin convertirlas automáticamente.`);
    if (col.espaciosSobrantes) avisos.push(`Cabecera «${col.cabecera.trim()}» con ${col.espaciosSobrantes} espacio(s) sobrante(s): se reconoce y se conserva tal cual.`);
  }

  // 4. Estructura de la hoja
  const vista = ws.views?.[0] as { state?: string; ySplit?: number; xSplit?: number } | undefined;
  let filasOcultas = 0;
  for (let r = 1; r <= ws.rowCount; r++) if (ws.getRow(r).hidden) filasOcultas++;
  let columnasOcultas = 0;
  for (let ci = 1; ci <= ncols; ci++) if (ws.getColumn(ci).hidden) columnasOcultas++;
  const merges = Object.keys((ws as unknown as { _merges?: Record<string, unknown> })._merges ?? {}).length;
  const validaciones = Object.keys((ws as unknown as { dataValidations?: { model?: Record<string, unknown> } }).dataValidations?.model ?? {}).length;
  const filtro = ws.autoFilter ? (typeof ws.autoFilter === 'string' ? ws.autoFilter : JSON.stringify(ws.autoFilter)) : undefined;
  if (filasOcultas || columnasOcultas) avisos.push(`La hoja tiene ${filasOcultas} fila(s) y ${columnasOcultas} columna(s) ocultas: se analizan igualmente.`);
  if (merges) avisos.push(`La hoja tiene ${merges} rango(s) de celdas combinadas.`);
  if (formulas) avisos.push(`${formulas} celda(s) con fórmula en la hoja de datos: se usará el valor calculado guardado, que puede no estar actualizado.`);

  // 5. Territorio (solo informa; nunca completa)
  let territorio: InformeEstructural['territorio'];
  if (opciones.territorio) {
    const cfg = opciones.territorio;
    const datosCampo = (clave: 'distrito' | 'zona' | 'cp') => {
      const col = columnas.find((c) => c.perfil?.clave === clave);
      if (!col) return undefined;
      let distintasDelFijo = 0;
      const fijo = cfg[clave].valorFijo;
      if (fijo) for (const r of filasConDatos) {
        const v = valorPlano(ws.getRow(r).getCell(col.indice).value);
        if (tipoDe(v) && String(v).trim() !== fijo) distintasDelFijo++;
      }
      return { conValor: col.noVacias, vacias: col.vacias, distintasDelFijo };
    };
    territorio = {
      municipio: cfg.municipio, version: cfg.version, nota: cfg.nota,
      campos: (['distrito', 'zona', 'cp'] as const).map((k) => evaluarCampoTerritorial(k, cfg[k], datosCampo(k))),
    };
  }

  // 6. Direcciones repetidas (solo recuento: nunca se deduplica)
  let direccionesRepetidas: InformeEstructural['direccionesRepetidas'];
  const cDir = columnas.find((c) => c.perfil?.clave === 'direccion');
  const cNum = columnas.find((c) => c.perfil?.clave === 'numero');
  if (cDir && cNum) {
    const grupos = new Map<string, number>();
    for (const r of filasConDatos) {
      const row = ws.getRow(r);
      const d = valorPlano(row.getCell(cDir.indice).value);
      const n = valorPlano(row.getCell(cNum.indice).value);
      if (!tipoDe(d) || !tipoDe(n) || /^s\s*\/\s*n$/i.test(String(n).trim())) continue;
      const k = `${normalizarCabecera(String(d))}|${normalizarCabecera(String(n)).replace(/\s+/g, '')}`;
      grupos.set(k, (grupos.get(k) ?? 0) + 1);
    }
    const rep = [...grupos.values()].filter((x) => x > 1);
    direccionesRepetidas = {
      grupos: rep.length, filas: rep.reduce((a, b) => a + b, 0),
      nota: 'Una misma calle y número en varias filas puede ser locales distintos, una sustitución de actividad o un duplicado. Se conservarán todas las filas de origen y la correspondencia física quedará pendiente de conciliación cuando no sea inequívoca.',
    };
  }

  return {
    ...base,
    hojaDatos: ws.name,
    perfiles: comps.map(({ asignacion: _a, ...c }) => c),
    perfilPropuesto: propuesto?.perfilId ?? null,
    columnas,
    filas: { filaCabecera: elegida.fila, conDatos: filasConDatos.length, primera: filasConDatos[0] ?? null, ultima: filasConDatos.at(-1) ?? null, enBlancoIntercaladas: enBlanco, posiblesTotales },
    estructura: { panelesCongelados: vista?.state === 'frozen' ? { filas: vista.ySplit ?? 0, columnas: vista.xSplit ?? 0 } : undefined, filtro, filasOcultas, columnasOcultas, celdasCombinadas: merges, validaciones, formulas },
    territorio,
    direccionesRepetidas,
    avisos,
  };
}
