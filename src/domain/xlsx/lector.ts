import ExcelJS from 'exceljs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

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
 */

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
  constructor(mensaje: string, public codigo: 'no-es-xlsx' | 'cifrado-o-xls' | 'strict' | 'no-adaptable' | 'lectura') {
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

/** Diagnóstico del paquete OOXML sin modificar nada. */
export function diagnosticarPaquete(bytes: Uint8Array): DiagnosticoPaquete {
  if (esCFB(bytes)) return { formato: 'cifrado-o-xls', prefijadas: [], rutasAbsolutas: false, strict: false };
  if (!esZip(bytes)) return { formato: 'no-es-xlsx', prefijadas: [], rutasAbsolutas: false, strict: false };
  let archivos: Record<string, Uint8Array>;
  try {
    archivos = unzipSync(bytes);
  } catch {
    return { formato: 'no-es-xlsx', prefijadas: [], rutasAbsolutas: false, strict: false };
  }
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

/**
 * Copia del paquete con el prefijo de SpreadsheetML eliminado de las partes adaptables. Lanza
 * ErrorLector si alguna parte prefijada no es adaptable con garantías.
 */
export function adaptarPrefijos(bytes: Uint8Array): { bytes: Uint8Array; adaptaciones: AdaptacionParte[] } {
  const archivos = unzipSync(bytes);
  const adaptaciones: AdaptacionParte[] = [];
  const salida: Record<string, Uint8Array> = { ...archivos };
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
    salida[parte] = strToU8(nuevo);
    adaptaciones.push({ parte, prefijo: r.prefijo, etiquetas });
  }
  return { bytes: adaptaciones.length ? zipSync(salida) : bytes, adaptaciones };
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
 * Lee un libro XLSX. El ORIGINAL no se modifica: la adaptación, si hace falta, trabaja sobre una
 * copia en memoria y queda registrada en el resultado.
 */
export async function leerLibro(datos: ArrayBuffer | Uint8Array): Promise<LibroLeido> {
  const original = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const diagnostico = diagnosticarPaquete(original);
  if (diagnostico.formato === 'cifrado-o-xls') throw new ErrorLector('El archivo está protegido con contraseña o es un .xls antiguo: guárdalo como .xlsx sin contraseña.', 'cifrado-o-xls');
  if (diagnostico.formato === 'no-es-xlsx') throw new ErrorLector('El archivo no es un libro .xlsx válido.', 'no-es-xlsx');
  if (diagnostico.strict) throw new ErrorLector('El libro está guardado en formato «OOXML Strict», que no se admite: guárdalo como «Libro de Excel (.xlsx)».', 'strict');
  let bytes = original;
  let adaptaciones: AdaptacionParte[] = [];
  if (diagnostico.prefijadas.length) {
    const a = adaptarPrefijos(original);
    bytes = a.bytes;
    adaptaciones = a.adaptaciones;
  }
  try {
    const libro = await cargarExcelJS(bytes);
    return { libro, lector: adaptaciones.length ? 'exceljs+adaptacion-prefijos' : 'exceljs', adaptaciones, diagnostico };
  } catch (e) {
    throw new ErrorLector(`No se ha podido leer el libro: ${e instanceof Error ? e.message : String(e)}`, 'lectura');
  }
}
