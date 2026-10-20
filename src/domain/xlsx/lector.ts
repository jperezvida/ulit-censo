import ExcelJS from 'exceljs';
import { Unzip, UnzipInflate, UnzipPassThrough, strFromU8, strToU8, zipSync } from 'fflate';

/**
 * Lector de libros XLSX para la importación (C1a).
 *
 * Se usa ExcelJS, que lee correctamente los archivos guardados por Excel (etiquetas OOXML sin
 * prefijo, como los originales de Medina 2025, Medina 2026 y Valladolid 2024). ExcelJS no admite
 * el XML de SpreadsheetML con PREFIJO de espacio de nombres (`<x:worksheet>`), que es válido y lo
 * generan otras herramientas (p. ej. el libro ficticio de pruebas). Para esos archivos se aplica
 * una adaptación SEGURA y ACOTADA, en memoria y sobre una copia:
 *
 *  - solo en partes `xl/**.xml` cuyo elemento raíz lleva un prefijo ligado EXACTAMENTE al espacio
 *    de nombres principal de SpreadsheetML;
 *  - solo se quita ese prefijo de las etiquetas y se declara el espacio como predeterminado;
 *  - se rechaza (sin adaptar) si la parte tiene CDATA, atributos con ese prefijo o ya declara un
 *    espacio predeterminado: en esos casos no hay garantía de equivalencia;
 *  - el resto del paquete queda byte a byte igual y el archivo original no se modifica nunca.
 *
 * Cada adaptación se registra para que el informe la muestre.
 *
 * LÍMITES DE SEGURIDAD (antes de procesar el contenido): un .xlsx es un ZIP y un archivo pequeño
 * podría descomprimirse en cientos de GB («bomba ZIP») y bloquear el navegador. Por eso:
 *  1. se rechaza el archivo si supera el tamaño máximo, antes incluso de leerlo entero;
 *  2. se lee el directorio central del ZIP y se rechaza si declara demasiadas entradas, una
 *     entrada o un total descomprimido excesivos, o una proporción de compresión desmesurada;
 *  3. se descomprime por tramos contando los bytes REALES: si superan lo declarado o los límites
 *     (cabeceras que mienten), se detiene en el acto;
 *  4. ExcelJS recibe un paquete reconstruido SIN compresión a partir de lo ya verificado, de modo
 *     que nunca descomprime nada por su cuenta.
 */

export interface LimitesXlsx {
  /** Tamaño máximo del archivo .xlsx (comprimido). */
  maxBytesArchivo: number;
  /** Número máximo de entradas del ZIP. */
  maxEntradas: number;
  /** Tamaño máximo descomprimido de una entrada. */
  maxBytesEntrada: number;
  /** Tamaño máximo descomprimido de todo el libro. */
  maxBytesDescomprimidos: number;
  /** Proporción máxima descomprimido/comprimido de una entrada de más de 1 MiB. */
  maxProporcion: number;
}

const MiB = 1024 * 1024;
/**
 * Límites por defecto. Un censo municipal de unas 900 filas ocupa ~0,1 MB y descomprimido ~1 MB;
 * los límites dejan un margen amplio (decenas de miles de filas) sin permitir descompresiones
 * desproporcionadas. Las hojas XML de Excel se comprimen habitualmente entre 5 y 20 veces.
 */
export const LIMITES_XLSX: LimitesXlsx = {
  maxBytesArchivo: 25 * MiB,
  maxEntradas: 1000,
  maxBytesEntrada: 150 * MiB,
  maxBytesDescomprimidos: 250 * MiB,
  maxProporcion: 200,
};

const mb = (n: number) => `${(n / MiB).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`;

export const NS_SPREADSHEETML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
/** Espacio de nombres de OOXML «Strict»: ExcelJS no lo interpreta y no se adapta. */
export const NS_SPREADSHEETML_STRICT = 'http://purl.oclc.org/ooxml/spreadsheetml/main';

export interface AdaptacionParte {
  parte: string;
  prefijo: string;
  etiquetas: number;
}

export interface DiagnosticoPaquete {
  formato: 'xlsx' | 'cifrado-o-xls' | 'no-es-xlsx';
  /** Partes con SpreadsheetML prefijado (adaptables o no). */
  prefijadas: { parte: string; prefijo: string; adaptable: boolean; motivo?: string }[];
  /** Relaciones con destino absoluto («/xl/…»): válidas y admitidas por ExcelJS; solo informativo. */
  rutasAbsolutas: boolean;
  strict: boolean;
}

export class ErrorLector extends Error {
  constructor(mensaje: string, public codigo: 'no-es-xlsx' | 'cifrado-o-xls' | 'strict' | 'no-adaptable' | 'lectura' | 'limites') {
    super(mensaje);
    this.name = 'ErrorLector';
  }
}

const esZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const esCFB = (b: Uint8Array) => b.length > 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
const texto = (u: Uint8Array) => strFromU8(u).replace(/^﻿/, '');

/** Elemento raíz de un XML (tras la declaración y los comentarios). */
function raiz(xml: string): { prefijo: string | null; etiqueta: string } | null {
  const m = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').match(/<([A-Za-z_][\w.-]*)(?::([A-Za-z_][\w.-]*))?(\s[^>]*)?>/);
  if (!m) return null;
  return m[2] ? { prefijo: m[1], etiqueta: m[0] } : { prefijo: null, etiqueta: m[0] };
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ¿Se puede quitar el prefijo de esta parte sin cambiar su significado? Devuelve el motivo si no. */
function motivoNoAdaptable(xml: string, prefijo: string, etiquetaRaiz: string): string | null {
  if (!new RegExp(`xmlns:${escRe(prefijo)}\\s*=\\s*"${escRe(NS_SPREADSHEETML)}"`).test(etiquetaRaiz)) return 'el prefijo no está ligado al espacio principal de SpreadsheetML en el elemento raíz';
  if (/\sxmlns\s*=/.test(etiquetaRaiz)) return 'el elemento raíz ya declara un espacio de nombres predeterminado';
  if (xml.includes('<![CDATA[')) return 'contiene secciones CDATA';
  if (new RegExp(`\\s${escRe(prefijo)}:[\\w.-]+\\s*=`).test(xml)) return `usa atributos con el prefijo «${prefijo}:»`;
  if (new RegExp(`xmlns:${escRe(prefijo)}\\s*=`, 'g').exec(xml.slice(xml.indexOf(etiquetaRaiz) + etiquetaRaiz.length))) return `redeclara el prefijo «${prefijo}:» en elementos internos`;
  return null;
}

function partesXml(archivos: Record<string, Uint8Array>) {
  return Object.keys(archivos).filter((n) => n.startsWith('xl/') && n.endsWith('.xml'));
}

// ───────────── Descompresión con límites ─────────────

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

export interface EntradaZip {
  nombre: string;
  comprimido: number;
  descomprimido: number;
}

/** Lee el directorio central del ZIP (tamaños DECLARADOS) sin descomprimir nada. */
export function directorioCentral(b: Uint8Array): EntradaZip[] {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ErrorLector('El archivo no es un libro .xlsx válido (ZIP sin directorio central).', 'no-es-xlsx');
  const total = u16(b, eocd + 10);
  const offset = u32(b, eocd + 16);
  if (total === 0xffff || offset === 0xffffffff) throw new ErrorLector('El archivo usa ZIP64 (tamaño o número de entradas fuera de los límites admitidos).', 'limites');
  const out: EntradaZip[] = [];
  let p = offset;
  for (let k = 0; k < total; k++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new ErrorLector('El archivo no es un libro .xlsx válido (directorio central dañado).', 'no-es-xlsx');
    const nl = u16(b, p + 28);
    out.push({ nombre: strFromU8(b.subarray(p + 46, p + 46 + nl)), comprimido: u32(b, p + 20), descomprimido: u32(b, p + 24) });
    p += 46 + nl + u16(b, p + 30) + u16(b, p + 32);
  }
  return out;
}

/** Comprueba los tamaños DECLARADOS frente a los límites. */
export function comprobarLimitesDeclarados(entradas: EntradaZip[], lim: LimitesXlsx = LIMITES_XLSX): void {
  if (entradas.length > lim.maxEntradas) throw new ErrorLector(`El archivo contiene ${entradas.length} elementos internos (máximo ${lim.maxEntradas}).`, 'limites');
  let total = 0;
  for (const e of entradas) {
    if (e.descomprimido > lim.maxBytesEntrada) throw new ErrorLector(`Un elemento interno ocupa ${mb(e.descomprimido)} descomprimido (máximo ${mb(lim.maxBytesEntrada)}).`, 'limites');
    if (e.descomprimido > MiB && e.descomprimido > lim.maxProporcion * Math.max(1, e.comprimido)) {
      throw new ErrorLector(`Un elemento interno se expande de forma desproporcionada (${Math.round(e.descomprimido / Math.max(1, e.comprimido))} veces; máximo ${lim.maxProporcion}). Por seguridad no se procesa.`, 'limites');
    }
    total += e.descomprimido;
  }
  if (total > lim.maxBytesDescomprimidos) throw new ErrorLector(`El libro ocupa ${mb(total)} descomprimido (máximo ${mb(lim.maxBytesDescomprimidos)}).`, 'limites');
}

/**
 * Descomprime contando los bytes REALES por tramos: se detiene en cuanto una entrada supera lo
 * que declaraba o algún límite. Devuelve el contenido verificado.
 */
export function descomprimirSeguro(b: Uint8Array, lim: LimitesXlsx = LIMITES_XLSX): Record<string, Uint8Array> {
  if (b.byteLength > lim.maxBytesArchivo) throw new ErrorLector(`El archivo ocupa ${mb(b.byteLength)} (máximo ${mb(lim.maxBytesArchivo)}).`, 'limites');
  const entradas = directorioCentral(b);
  comprobarLimitesDeclarados(entradas, lim);
  const declarado = new Map(entradas.map((e) => [e.nombre, e.descomprimido]));
  const archivos: Record<string, Uint8Array> = {};
  let total = 0;
  let error: ErrorLector | null = null;
  const fallo = (e: ErrorLector) => {
    if (!error) error = e;
  };
  const uz = new Unzip((f) => {
    if (error) return;
    const max = declarado.get(f.name);
    if (max === undefined) return fallo(new ErrorLector(`Elemento interno «${f.name}» no declarado en el directorio central.`, 'no-es-xlsx'));
    const trozos: Uint8Array[] = [];
    let n = 0;
    f.ondata = (err, d, final) => {
      if (error) return;
      if (err) return fallo(new ErrorLector('El archivo no es un libro .xlsx válido (datos comprimidos dañados).', 'no-es-xlsx'));
      n += d.length;
      total += d.length;
      if (n > max) {
        fallo(new ErrorLector(`El elemento interno «${f.name}» se descomprime en más bytes de los que declara. Por seguridad no se procesa.`, 'limites'));
        return f.terminate();
      }
      if (n > lim.maxBytesEntrada || total > lim.maxBytesDescomprimidos) {
        fallo(new ErrorLector(`El libro supera el tamaño máximo descomprimido (${mb(lim.maxBytesDescomprimidos)}).`, 'limites'));
        return f.terminate();
      }
      trozos.push(d);
      if (final) {
        const u = new Uint8Array(n);
        let o = 0;
        for (const t of trozos) {
          u.set(t, o);
          o += t.length;
        }
        archivos[f.name] = u;
      }
    };
    f.start();
  });
  uz.register(UnzipInflate);
  uz.register(UnzipPassThrough);
  // Por tramos pequeños: cada tramo comprimido produce una salida acotada antes de comprobarla.
  const TRAMO = 16 * 1024;
  for (let i = 0; i < b.length && !error; i += TRAMO) {
    try {
      uz.push(b.subarray(i, Math.min(b.length, i + TRAMO)), i + TRAMO >= b.length);
    } catch {
      fallo(new ErrorLector('El archivo no es un libro .xlsx válido (ZIP dañado).', 'no-es-xlsx'));
    }
  }
  if (error) throw error;
  for (const e of entradas) if (!e.nombre.endsWith('/') && !archivos[e.nombre]) throw new ErrorLector(`El elemento interno «${e.nombre}» no se ha podido leer.`, 'no-es-xlsx');
  return archivos;
}

function diagnosticarArchivos(archivos: Record<string, Uint8Array>): DiagnosticoPaquete {
  if (!archivos['[Content_Types].xml'] || !Object.keys(archivos).some((n) => /^xl\/workbook\.xml$/i.test(n))) return { formato: 'no-es-xlsx', prefijadas: [], rutasAbsolutas: false, strict: false };
  const prefijadas: DiagnosticoPaquete['prefijadas'] = [];
  let strict = false;
  for (const parte of partesXml(archivos)) {
    const xml = texto(archivos[parte]);
    if (xml.includes(NS_SPREADSHEETML_STRICT)) strict = true;
    const r = raiz(xml);
    if (!r?.prefijo || !r.etiqueta.includes(NS_SPREADSHEETML)) continue;
    const motivo = motivoNoAdaptable(xml, r.prefijo, r.etiqueta);
    prefijadas.push({ parte, prefijo: r.prefijo, adaptable: !motivo, motivo: motivo ?? undefined });
  }
  const rels = Object.keys(archivos).filter((n) => n.endsWith('.rels')).map((n) => texto(archivos[n]));
  return { formato: 'xlsx', prefijadas, rutasAbsolutas: rels.some((x) => /Target="\//.test(x)), strict };
}

/** Diagnóstico del paquete OOXML sin modificar nada (con los límites de seguridad). */
export function diagnosticarPaquete(bytes: Uint8Array, lim: LimitesXlsx = LIMITES_XLSX): DiagnosticoPaquete {
  const vacio = (formato: DiagnosticoPaquete['formato']): DiagnosticoPaquete => ({ formato, prefijadas: [], rutasAbsolutas: false, strict: false });
  if (esCFB(bytes)) return vacio('cifrado-o-xls');
  if (!esZip(bytes)) return vacio('no-es-xlsx');
  let archivos: Record<string, Uint8Array>;
  try {
    archivos = descomprimirSeguro(bytes, lim);
  } catch (e) {
    if (e instanceof ErrorLector && e.codigo === 'limites') throw e;
    return vacio('no-es-xlsx');
  }
  return diagnosticarArchivos(archivos);
}

/** Quita el prefijo de SpreadsheetML de las partes adaptables (modifica `archivos`, que es una copia). */
function adaptarArchivos(archivos: Record<string, Uint8Array>): AdaptacionParte[] {
  const adaptaciones: AdaptacionParte[] = [];
  for (const parte of partesXml(archivos)) {
    const xml = texto(archivos[parte]);
    const r = raiz(xml);
    if (!r?.prefijo || !r.etiqueta.includes(NS_SPREADSHEETML)) continue;
    const motivo = motivoNoAdaptable(xml, r.prefijo, r.etiqueta);
    if (motivo) throw new ErrorLector(`No se puede adaptar «${parte}» con garantías: ${motivo}.`, 'no-adaptable');
    const p = escRe(r.prefijo);
    let etiquetas = 0;
    const nuevo = xml
      .replace(new RegExp(`<(/?)${p}:`, 'g'), (_m, cierre: string) => {
        etiquetas++;
        return `<${cierre}`;
      })
      .replace(new RegExp(`xmlns:${p}(\\s*=\\s*"${escRe(NS_SPREADSHEETML)}")`), 'xmlns$1');
    archivos[parte] = strToU8(nuevo);
    adaptaciones.push({ parte, prefijo: r.prefijo, etiquetas });
  }
  return adaptaciones;
}

/**
 * Copia del paquete con el prefijo de SpreadsheetML eliminado de las partes adaptables. Lanza
 * ErrorLector si alguna parte prefijada no es adaptable con garantías.
 */
export function adaptarPrefijos(bytes: Uint8Array, lim: LimitesXlsx = LIMITES_XLSX): { bytes: Uint8Array; adaptaciones: AdaptacionParte[] } {
  const archivos = descomprimirSeguro(bytes, lim);
  const adaptaciones = adaptarArchivos(archivos);
  return { bytes: adaptaciones.length ? zipSync(archivos) : bytes, adaptaciones };
}

export interface LibroLeido {
  libro: ExcelJS.Workbook;
  lector: 'exceljs' | 'exceljs+adaptacion-prefijos';
  adaptaciones: AdaptacionParte[];
  diagnostico: DiagnosticoPaquete;
}

async function cargarExcelJS(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb;
}

/**
 * Lee un libro XLSX. El ORIGINAL no se modifica: la descompresión (con límites) y la adaptación,
 * si hace falta, trabajan sobre una copia en memoria y quedan registradas en el resultado.
 */
export async function leerLibro(datos: ArrayBuffer | Uint8Array, lim: LimitesXlsx = LIMITES_XLSX): Promise<LibroLeido> {
  const original = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  if (original.byteLength > lim.maxBytesArchivo) throw new ErrorLector(`El archivo ocupa ${mb(original.byteLength)} (máximo ${mb(lim.maxBytesArchivo)}).`, 'limites');
  if (esCFB(original)) throw new ErrorLector('El archivo está protegido con contraseña o es un .xls antiguo: guárdalo como .xlsx sin contraseña.', 'cifrado-o-xls');
  if (!esZip(original)) throw new ErrorLector('El archivo no es un libro .xlsx válido.', 'no-es-xlsx');
  // Límites ANTES de procesar el contenido; los errores de límites se propagan tal cual.
  const archivos = descomprimirSeguro(original, lim);
  const diagnostico = diagnosticarArchivos(archivos);
  if (diagnostico.formato === 'no-es-xlsx') throw new ErrorLector('El archivo no es un libro .xlsx válido.', 'no-es-xlsx');
  if (diagnostico.strict) throw new ErrorLector('El libro está guardado en formato «OOXML Strict», que no se admite: guárdalo como «Libro de Excel (.xlsx)».', 'strict');
  const adaptaciones = diagnostico.prefijadas.length ? adaptarArchivos(archivos) : [];
  // ExcelJS recibe un paquete SIN compresión construido con el contenido ya verificado.
  const verificado = zipSync(archivos, { level: 0 });
  try {
    const libro = await cargarExcelJS(verificado);
    return { libro, lector: adaptaciones.length ? 'exceljs+adaptacion-prefijos' : 'exceljs', adaptaciones, diagnostico };
  } catch (e) {
    throw new ErrorLector(`No se ha podido leer el libro: ${e instanceof Error ? e.message : String(e)}`, 'lectura');
  }
}
