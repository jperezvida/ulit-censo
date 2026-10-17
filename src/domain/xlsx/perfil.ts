import ExcelJS from 'exceljs';
import { normalizar } from '../text';

/**
 * Perfil ESTRUCTURAL de un libro Excel.
 *
 * Describe hojas, cabeceras exactas, tipos, formatos, rellenos (amarillo) y validaciones.
 * Solo enumera valores de las columnas de una LISTA EXPLÍCITA DE AUTORIZADAS (categorías,
 * códigos y respuestas 0/1). Cualquier otra columna —aunque su cabecera parezca inocua,
 * como «Cadena»— aporta únicamente estructura y recuentos: nunca sus valores.
 */

export type TipoCelda =
  | 'vacia'
  | 'texto'
  | 'texto-01' // "0" / "1"
  | 'texto-01-decimal' // "0.0" / "1,0"
  | 'texto-numerico'
  | 'numero-01' // 0 / 1 numéricos (también 0.0 / 1.0 guardados como número)
  | 'entero'
  | 'decimal'
  | 'fecha'
  | 'booleano'
  | 'hipervinculo'
  | 'error';

export interface PerfilColumna {
  indice: number; // 1 = columna A
  letra: string;
  /** Cabecera EXACTA tal como figura en la celda (espacios incluidos). */
  cabecera: string;
  cabeceraNormalizada: string;
  tipos: Partial<Record<TipoCelda, number>>;
  formulas: number;
  vacias: number;
  noVacias: number;
  distintos: number;
  formatosNumero: Record<string, number>;
  numerico?: { min: number; max: number; soloEnteros: boolean };
  /** Valores distintos con frecuencia; null si la columna no está autorizada o no es categórica. */
  valores: { valor: string; n: number }[] | null;
  motivoSinValores?: 'no-autorizada' | 'no-categorica' | 'numerica';
  rellenos: { amarillo: number; otros: Record<string, number> };
}

export interface PerfilHoja {
  nombre: string;
  visible: boolean;
  filasConDatos: number;
  columnasConDatos: number;
  filaCabecera: number | null;
  panelesCongelados?: { filas: number; columnas: number };
  validaciones: { rango: string; tipo: string; formula: string[] }[];
  columnas: PerfilColumna[];
  /** Combinaciones de los cuatro niveles de actividad con su frecuencia (si se detectan las columnas). */
  tuplasActividad?: { columnas: string[]; tuplas: { niveles: string[]; n: number }[] };
}

export interface PerfilEstructural {
  formato: 'ulit-censo/perfil-estructural';
  version: 1;
  generado: string;
  archivo: { nombre: string; bytes: number; sha256: string };
  hojas: PerfilHoja[];
  avisos: string[];
}

export interface OpcionesPerfil {
  /** Máximo de valores distintos para considerar una columna categórica. */
  maxCategorias?: number;
  /** Proporción máxima distintos/no vacías para considerar una columna categórica. */
  maxProporcion?: number;
}

/**
 * Columnas AUTORIZADAS para enumerar valores (cabecera normalizada, coincidencia exacta).
 * Solo categorías del catálogo, códigos territoriales y respuestas codificadas que hace falta
 * analizar. Ampliar esta lista exige revisión: cualquier otra columna queda en modo estadístico.
 */
export const COLUMNAS_AUTORIZADAS: readonly string[] = [
  // Situación y catálogo de actividad
  'local vacio',
  'gractividad', 'gr actividad', 'grupo de actividad', 'grupo actividad',
  'gr comercio', 'grcomercio', 'grupo de comercio', 'grupo comercio', 'comercio grupos',
  'subgrupo de actividad', 'subgrupo actividad', 'subgrupo',
  'actividad',
  // Códigos territoriales y organizativos
  'distrito', 'zona', 'cp', 'codigo postal', 'municipio', 'itinerario',
  // Respuestas 0/1
  'franquicia', 'web', 'google my bussines', 'google my business', 'vende internet',
  'responde resenas g', 'instagram', 'facebook', 'twitter', 'twiter',
];

export function esColumnaAutorizada(cabecera: string): boolean {
  return COLUMNAS_AUTORIZADAS.includes(normalizar(cabecera));
}

const NIVELES_ACTIVIDAD: RegExp[] = [
  /^(gr ?actividad|grupo de actividad|grupo actividad)$/,
  /^(gr ?comercio|grupo de comercio|grupo comercio)$/,
  /^(subgrupo|subgrupo de actividad|subgrupo actividad|sub ?grupo)$/,
  /^actividad$/,
];

export function letraColumna(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Valor «plano» de una celda de ExcelJS (resultado de fórmula, texto enriquecido, hipervínculo…). */
export function valorPlano(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('formula' in v || 'sharedFormula' in v) return valorPlano((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('hyperlink' in v) return (v as ExcelJS.CellHyperlinkValue).text;
    if ('error' in v) return { error: (v as ExcelJS.CellErrorValue).error };
  }
  return v;
}

export function tipoDeCelda(cell: ExcelJS.Cell): TipoCelda {
  const bruto = cell.value;
  if (bruto && typeof bruto === 'object' && !(bruto instanceof Date) && 'hyperlink' in bruto) return 'hipervinculo';
  const v = valorPlano(bruto);
  if (v === null || v === undefined) return 'vacia';
  if (typeof v === 'object' && v !== null && 'error' in v) return 'error';
  if (v instanceof Date) return 'fecha';
  if (typeof v === 'boolean') return 'booleano';
  if (typeof v === 'number') {
    if (v === 0 || v === 1) return 'numero-01';
    return Number.isInteger(v) ? 'entero' : 'decimal';
  }
  const s = String(v).trim();
  if (s === '') return 'vacia';
  if (/^[01]$/.test(s)) return 'texto-01';
  if (/^[01][.,]0+$/.test(s)) return 'texto-01-decimal';
  if (/^-?\d+([.,]\d+)?$/.test(s)) return 'texto-numerico';
  return 'texto';
}

/** Color de relleno sólido de la celda: «argb:FFFFFF00», «tema:7» o null. */
export function rellenoDe(cell: ExcelJS.Cell): string | null {
  const f = cell.fill as ExcelJS.FillPattern | undefined;
  if (!f || f.type !== 'pattern' || f.pattern === 'none') return null;
  const c = (f.fgColor ?? f.bgColor) as { argb?: string; theme?: number; indexed?: number } | undefined;
  if (!c) return null;
  if (c.argb) return `argb:${c.argb.toUpperCase()}`;
  if (c.theme !== undefined) return `tema:${c.theme}`;
  if (c.indexed !== undefined) return `indexado:${c.indexed}`;
  return null;
}

/** ¿El color es un amarillo? (solo colores ARGB explícitos o el amarillo de la paleta indexada) */
export function esAmarillo(relleno: string | null): boolean {
  if (!relleno) return false;
  if (relleno === 'indexado:13' || relleno === 'indexado:5') return true; // amarillo en la paleta clásica
  const m = relleno.match(/^argb:([0-9A-F]{2})?([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/);
  if (!m) return false;
  const [r, g, b] = [parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255, parseInt(m[4], 16) / 255];
  // Tono entre 40° y 65° (del ámbar al amarillo limón), algo saturado y claro.
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  if (max < 0.7 || sat < 0.15 || max !== r && max !== g) return false;
  const d = max - min;
  let tono = 0;
  if (max === r) tono = 60 * (((g - b) / d) % 6);
  else tono = 60 * ((b - r) / d + 2);
  if (tono < 0) tono += 360;
  return tono >= 40 && tono <= 65;
}

function detectarFilaCabecera(ws: ExcelJS.Worksheet): number | null {
  const max = Math.min(ws.rowCount, 10);
  for (let r = 1; r <= max; r++) {
    const fila = ws.getRow(r);
    let texto = 0;
    let llenas = 0;
    fila.eachCell({ includeEmpty: false }, (c) => {
      const t = tipoDeCelda(c);
      if (t === 'vacia') return;
      llenas++;
      if (t === 'texto') texto++;
    });
    if (llenas >= 2 && texto / llenas >= 0.6) return r;
    if (llenas === 1 && ws.columnCount === 1 && texto === 1) return r;
  }
  return null;
}

async function sha256(datos: Uint8Array): Promise<string> {
  const h = await globalThis.crypto.subtle.digest('SHA-256', datos as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function cargarLibro(datos: ArrayBuffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const buf = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

export async function perfilarXlsx(datos: ArrayBuffer | Uint8Array, nombreArchivo: string, opciones: OpcionesPerfil = {}): Promise<PerfilEstructural> {
  const { maxCategorias = 250, maxProporcion = 0.5 } = opciones;
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const wb = await cargarLibro(bytes);
  const avisos: string[] = [];
  const hojas: PerfilHoja[] = [];

  wb.eachSheet((ws) => {
    const filaCab = detectarFilaCabecera(ws);
    if (filaCab === null) avisos.push(`Hoja «${ws.name}»: no se detectó una fila de cabecera clara; se describen las columnas sin nombre.`);
    const cabeceras = new Map<number, string>();
    if (filaCab) ws.getRow(filaCab).eachCell({ includeEmpty: false }, (c, col) => cabeceras.set(col, String(valorPlano(c.value) ?? '')));
    const primera = filaCab ? filaCab + 1 : 1;
    const ncols = ws.columnCount;
    const columnas: PerfilColumna[] = [];
    const indicesNivel: (number | undefined)[] = NIVELES_ACTIVIDAD.map((re) => [...cabeceras.entries()].find(([, h]) => re.test(normalizar(h)))?.[0]);

    let filasConDatos = 0;
    for (let r = primera; r <= ws.rowCount; r++) if (ws.getRow(r).actualCellCount > 0) filasConDatos++;

    for (let col = 1; col <= ncols; col++) {
      const cabecera = cabeceras.get(col) ?? '';
      const autorizada = cabecera !== '' && esColumnaAutorizada(cabecera);
      const tipos: Partial<Record<TipoCelda, number>> = {};
      const formatos: Record<string, number> = {};
      const cuenta = new Map<string, number>();
      const rellenos = { amarillo: 0, otros: {} as Record<string, number> };
      let formulas = 0;
      let vacias = 0;
      let min = Infinity;
      let max = -Infinity;
      let soloEnteros = true;
      let numericas = 0;
      for (let r = primera; r <= ws.rowCount; r++) {
        const cell = ws.getRow(r).getCell(col);
        const t = tipoDeCelda(cell);
        tipos[t] = (tipos[t] ?? 0) + 1;
        if (cell.value && typeof cell.value === 'object' && !(cell.value instanceof Date) && ('formula' in cell.value || 'sharedFormula' in cell.value)) formulas++;
        if (cell.numFmt) formatos[cell.numFmt] = (formatos[cell.numFmt] ?? 0) + 1;
        const rel = rellenoDe(cell);
        if (rel) {
          if (esAmarillo(rel)) rellenos.amarillo++;
          else rellenos.otros[rel] = (rellenos.otros[rel] ?? 0) + 1;
        }
        if (t === 'vacia') {
          vacias++;
          continue;
        }
        const v = valorPlano(cell.value);
        if (typeof v === 'number') {
          numericas++;
          if (v < min) min = v;
          if (v > max) max = v;
          if (!Number.isInteger(v)) soloEnteros = false;
        }
        // Los valores se cuentan en memoria para conocer la cardinalidad, pero solo se devuelven
        // los de columnas autorizadas.
        const clave = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
        cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
      }
      const noVacias = Math.max(0, ws.rowCount - primera + 1 - vacias);
      if (noVacias === 0 && cabecera === '') continue; // columna totalmente vacía y sin cabecera
      const distintos = cuenta.size;
      const numerica = numericas > 0 && numericas >= noVacias * 0.9 && !(tipos['numero-01'] && Object.keys(tipos).filter((k) => k !== 'vacia').length === 1);
      let valores: PerfilColumna['valores'] = null;
      let motivo: PerfilColumna['motivoSinValores'];
      if (!autorizada) motivo = 'no-autorizada';
      else if (numerica && distintos > 12) motivo = 'numerica';
      else if (distintos > maxCategorias || (noVacias > 20 && distintos / noVacias > maxProporcion)) motivo = 'no-categorica';
      else valores = [...cuenta.entries()].map(([valor, n]) => ({ valor, n })).sort((a, b) => b.n - a.n || a.valor.localeCompare(b.valor, 'es'));
      columnas.push({
        indice: col, letra: letraColumna(col), cabecera, cabeceraNormalizada: normalizar(cabecera), tipos, formulas, vacias, noVacias, distintos,
        formatosNumero: formatos, numerico: numericas ? { min, max, soloEnteros } : undefined, valores, motivoSinValores: motivo, rellenos,
      });
    }

    let tuplasActividad: PerfilHoja['tuplasActividad'];
    if (indicesNivel.every((i) => i !== undefined && esColumnaAutorizada(cabeceras.get(i) ?? ''))) {
      const t = new Map<string, number>();
      for (let r = primera; r <= ws.rowCount; r++) {
        const fila = ws.getRow(r);
        const niveles = indicesNivel.map((i) => String(valorPlano(fila.getCell(i!).value) ?? '').trim());
        if (niveles.every((x) => x === '')) continue;
        const k = JSON.stringify(niveles);
        t.set(k, (t.get(k) ?? 0) + 1);
      }
      tuplasActividad = {
        columnas: indicesNivel.map((i) => cabeceras.get(i!)!),
        tuplas: [...t.entries()].map(([k, n]) => ({ niveles: JSON.parse(k) as string[], n })).sort((a, b) => b.n - a.n),
      };
    }

    const vista = ws.views?.[0] as { state?: string; ySplit?: number; xSplit?: number } | undefined;
    const validaciones: PerfilHoja['validaciones'] = [];
    const dv = (ws as unknown as { dataValidations?: { model?: Record<string, { type?: string; formulae?: unknown[] }> } }).dataValidations?.model ?? {};
    for (const [rango, v] of Object.entries(dv)) validaciones.push({ rango, tipo: v.type ?? '?', formula: (v.formulae ?? []).map(String) });

    hojas.push({
      nombre: ws.name,
      visible: ws.state === 'visible' || ws.state === undefined,
      filasConDatos,
      columnasConDatos: columnas.filter((c) => c.noVacias > 0).length,
      filaCabecera: filaCab,
      panelesCongelados: vista?.state === 'frozen' ? { filas: vista.ySplit ?? 0, columnas: vista.xSplit ?? 0 } : undefined,
      validaciones,
      columnas,
      tuplasActividad,
    });
  });

  return {
    formato: 'ulit-censo/perfil-estructural',
    version: 1,
    generado: new Date().toISOString(),
    archivo: { nombre: nombreArchivo, bytes: bytes.byteLength, sha256: await sha256(bytes) },
    hojas,
    avisos,
  };
}
