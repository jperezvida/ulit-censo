import type ExcelJS from 'exceljs';
import { leerLibro, type LimitesXlsx, LIMITES_XLSX } from './lector';
import { analizarLibroLeido, valorPlano, esFormula, type InformeEstructural } from './analisis';
import { PERFILES_IMPORTACION, type PerfilImportacion, type TipoEsperado } from './perfilesImportacion';
import { evaluarCorrespondencia, perfilDesdeCorrespondencia } from './correspondencia';
import { CATEGORIA_DIAGNOSTICO, ETIQUETA_DIAGNOSTICO, diagnosticarClasificacion, type ResultadoClasificacion } from './clasificacionHistorica';
import { DICCIONARIO_SIN_INFORMACION_PROPUESTO, TIPOS_INCIDENCIA, type Decision, type Gravedad, type IdTipoIncidencia } from './reglasInterpretacion';
import type { ConfigTerritorial, ReglaTerritorial } from '../territorio';
import type { CeldaOriginal } from '../types';

/**
 * C1b · Interpretación de valores e incidencias.
 *
 * Tres capas separadas:
 *  1. ORIGINAL: cada celda tal como la leyó C1a (tipo, valor y formato), sin tocar.
 *  2. INTERPRETADA: por cada celda, su estado (válido, vacío, no aplica, inválido, transformado o
 *     pendiente), el valor interpretado si lo hay, la regla aplicada y sus incidencias.
 *  3. MODELO OPERATIVO: no se toca. C1b no importa negocios, no crea locales, no modifica campañas
 *     ni guarda el archivo (eso será C1c/C1d, con decisión humana).
 *
 * Principios: nunca se pierde el original; la ausencia de información nunca pasa a No, a 0 ni a
 * una fecha inventada; ninguna transformación se aplica sin una regla explícita; las decisiones
 * pendientes de la Cátedra no se resuelven aquí.
 */

// ───────────── Capa original ─────────────

/** Mismo tipo que `CeldaOriginal` del modelo: la capa original se guarda tal cual en C1c. */
export type ValorOriginal = CeldaOriginal;

export interface ColumnaOrigen {
  clave: string;
  letra: string;
  /** Cabecera EXACTA del archivo. */
  cabecera: string;
  tipo: TipoEsperado;
  territorial?: 'distrito' | 'zona' | 'cp';
}

export interface FilaOriginal {
  /** Número de fila en la hoja de origen. */
  fila: number;
  celdas: Record<string, ValorOriginal>;
  /** G1 · Valores de las columnas ADICIONALES (sin campo de ULIT), por letra de columna. No se interpretan. */
  adicionales?: Record<string, ValorOriginal>;
}

export interface CapaOriginal {
  archivo: { nombre: string; sha256?: string };
  hoja: string;
  filaCabecera: number;
  perfil: { id: string; version: number };
  columnas: ColumnaOrigen[];
  /** G1 · Columnas sin campo de ULIT: se conservan tal cual (cabecera exacta y letra). */
  adicionales?: { letra: string; cabecera: string }[];
  filas: FilaOriginal[];
  /**
   * Filas que C1a marca HEURÍSTICAMENTE como posibles totales. Se conservan íntegras en `filas`
   * (puede ser un falso positivo): solo podrán excluirse de la aplicación operativa con una
   * decisión humana explícita y trazada (C1d).
   */
  candidatasExcluir: { fila: number; motivo: string; origen: 'heuristica-c1a' }[];
}

// ───────────── Capa interpretada ─────────────

export type EstadoValor = 'valido' | 'vacio' | 'no-aplica' | 'invalido' | 'transformado' | 'pendiente';

export type Portal = { tipo: 'numero'; numero: number; sufijo?: string } | { tipo: 'sin-numero' };
export type ValorInterpretado = boolean | number | string | Portal;

export interface CeldaInterpretada {
  estado: EstadoValor;
  /** Solo en «valido» y «transformado». */
  valor?: ValorInterpretado;
  /** Valor que resultaría si se autorizase la regla (solo en «pendiente»). */
  propuesta?: ValorInterpretado | 'sin-informacion';
  regla: string;
  /** Índices en `ResultadoInterpretacion.incidencias`. */
  incidencias?: number[];
  /** Requiere revisión: inválida, pendiente o con alguna incidencia de error o aviso. */
  revision: boolean;
}

export type EstadoLocal = 'vacio' | 'ocupado' | 'desconocido';

export interface FilaInterpretada {
  fila: number;
  local: EstadoLocal;
  celdas: Record<string, CeldaInterpretada>;
  /** IG + FB + X, solo si las tres respuestas son válidas. */
  redesCalculadas: number | null;
  /** Clasificación histórica conservada como texto, con su diagnóstico. Nunca se confirma. */
  clasificacion?: ResultadoClasificacion & { confirmada: false };
  /** Grupo de calle y número repetidos (solo informativo; no se fusiona nada). */
  grupoDireccion?: number;
  /** Los datos históricos no verifican la franquicia ni la presencia digital de 2026. */
  verificado2026: false;
  /** Posible fila de totales: propuesta de exclusión SIN confirmar (la decide una persona en C1d). */
  exclusion?: { propuesta: 'excluir'; motivo: string; confirmada: false };
}

export interface Incidencia {
  archivo: string;
  hoja: string;
  fila: number;
  columna: string;
  cabecera: string;
  campo: string;
  tipo: IdTipoIncidencia;
  gravedad: Gravedad;
  decision: Decision;
  /** Mensaje INTERNO: puede citar el contenido de la celda. No se exporta. */
  mensaje: string;
  /**
   * Detalle EXPORTABLE: solo números validados, fechas, cabeceras, números de fila y códigos.
   * Nunca reproduce texto libre de una celda.
   */
  detalle?: string;
  propuesta: string;
  /** Representación del valor original (uso interno; no se exporta). */
  valorOriginal: string;
  regla?: string;
  relacionadas?: string[];
}

export interface OpcionesInterpretacion {
  /** Configuración territorial del municipio (Distrito, Zona, CP). */
  territorio?: ConfigTerritorial;
  /** «historico» (por defecto): los vacíos territoriales se conservan. «campana-actual»: se exigen los obligatorios. */
  modo?: 'historico' | 'campana-actual';
  /** Periodo de la campaña (aaaa-mm-dd, ambos incluidos) para comprobar las fechas. */
  periodo?: { desde: string; hasta: string };
  /** Textos que la Cátedra haya APROBADO como «sin información». Por defecto, ninguno. */
  diccionarioAprobado?: string[];
  /** Reglas de clase «propuesta» autorizadas expresamente. Por defecto, ninguna. */
  reglasAutorizadas?: string[];
}

export interface ResultadoInterpretacion {
  original: CapaOriginal;
  filas: FilaInterpretada[];
  incidencias: Incidencia[];
  opciones: OpcionesInterpretacion;
}

// ───────────── Utilidades ─────────────

const norm = (s: string) => s.normalize('NFC').replace(/[\s ]+/g, ' ').trim().toLowerCase();
/**
 * Clave de una denominación de calle para AGRUPAR registros del mismo portal: iguala mayúsculas y
 * espacios («Calle de las Angustias» = «Calle de las angustias»). Solo se usa para contar y agrupar:
 * el valor original se conserva siempre tal cual.
 */
export const claveDenominacion = norm;
const fechaIso = (d: Date) => d.toISOString().slice(0, 10);

export function mostrarOriginal(o: ValorOriginal): string {
  switch (o.t) {
    case 'vacio': return '(vacía)';
    case 'numero': return String(o.v);
    case 'fecha': return o.v.slice(0, 10);
    case 'texto': return `«${o.v}»`;
    case 'booleano': return o.v ? 'VERDADERO' : 'FALSO';
    case 'error': return o.v;
  }
}

/** Fecha real (sin desbordes: 31/02 no existe). */
function fechaValida(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? fechaIso(f) : null;
}

/** Celda de ExcelJS → valor original serializable. */
export function valorOriginal(cell: ExcelJS.Cell): ValorOriginal {
  const v = valorPlano(cell.value);
  const formula = esFormula(cell.value) ? { formula: true as const } : {};
  const formato = cell.numFmt && cell.numFmt !== 'General' ? { formato: cell.numFmt } : {};
  if (v === null || v === undefined || v === '') return { t: 'vacio', ...formula };
  if (v instanceof Date) return { t: 'fecha', v: v.toISOString(), ...formato, ...formula };
  if (typeof v === 'number') return { t: 'numero', v, ...formato, ...formula };
  if (typeof v === 'boolean') return { t: 'booleano', v, ...formula };
  if (typeof v === 'object' && v && 'error' in v) return { t: 'error', v: String((v as { error: unknown }).error), ...formula };
  return { t: 'texto', v: String(v), ...formula };
}

// ───────────── Intérpretes por tipo ─────────────

/** `mensaje`: interno, puede citar la celda. `detalle`: exportable, sin texto libre. */
interface Inc { tipo: IdTipoIncidencia; mensaje?: string; detalle?: string; relacionadas?: string[] }
interface Res { estado: EstadoValor; regla: string; valor?: ValorInterpretado; propuesta?: CeldaInterpretada['propuesta']; inc?: Inc[] }

interface Ctx {
  op: OpcionesInterpretacion;
  autorizadas: Set<string>;
  aprobados: Set<string>;
}

const vacia = (o: ValorOriginal) => o.t === 'vacio' || (o.t === 'texto' && !o.v.trim());

function comunes(o: ValorOriginal): Res | null {
  if (o.t === 'vacio') return { estado: 'vacio', regla: 'celda-vacia' };
  if (o.t === 'texto' && !o.v.trim()) return { estado: 'vacio', regla: 'solo-espacios' };
  if (o.t === 'error') return { estado: 'invalido', regla: 'error-excel', inc: [{ tipo: 'valor-error-excel' }] };
  return null;
}

/** «sin dato», «s/i»…: pendientes salvo que la Cátedra haya aprobado el diccionario. */
function diccionario(o: ValorOriginal, cx: Ctx): Res | null {
  if (o.t !== 'texto') return null;
  const k = norm(o.v);
  if (cx.aprobados.has(k)) return { estado: 'vacio', regla: 'diccionario-sin-informacion' };
  if ((DICCIONARIO_SIN_INFORMACION_PROPUESTO as readonly string[]).includes(k)) {
    return { estado: 'pendiente', regla: 'diccionario-sin-informacion', propuesta: 'sin-informacion', inc: [{ tipo: 'texto-sin-informacion-pendiente' }] };
  }
  return null;
}

/** Aplica una regla de clase «propuesta»: transformada si se autorizó; si no, pendiente con la propuesta visible. */
function propuesta(cx: Ctx, regla: string, valor: ValorInterpretado, inc: Inc): Res {
  return cx.autorizadas.has(regla) ? { estado: 'transformado', regla, valor } : { estado: 'pendiente', regla, propuesta: valor, inc: [inc] };
}

function binario(o: ValorOriginal, cx: Ctx): Res {
  const c = comunes(o) ?? diccionario(o, cx);
  if (c) return c;
  if (o.t === 'numero') {
    if (o.v === 0 || o.v === 1) return { estado: 'valido', regla: 'binario-01', valor: o.v === 1 };
    return { estado: 'invalido', regla: 'binario-fuera-de-dominio', inc: [{ tipo: 'binario-invalido', mensaje: `Valor ${o.v} en una columna 0/1: no se interpreta como Sí.` }] };
  }
  if (o.t === 'texto') {
    const s = o.v.trim();
    if (/^[01](?:[.,]0+)?$/.test(s)) return { estado: 'transformado', regla: 'binario-texto-01', valor: s[0] === '1' };
    if (/^-?\d+(?:[.,]\d+)?$/.test(s)) return { estado: 'invalido', regla: 'binario-fuera-de-dominio', inc: [{ tipo: 'binario-invalido', mensaje: `Valor «${s}» en una columna 0/1: no se interpreta como Sí.` }] };
    return { estado: 'invalido', regla: 'binario-texto-no-reconocido', inc: [{ tipo: 'binario-texto-no-reconocido' }] };
  }
  return { estado: 'invalido', regla: 'tipo-no-admitido', inc: [{ tipo: 'tipo-no-admitido' }] };
}

function entero(o: ValorOriginal, cx: Ctx): Res {
  const c = comunes(o) ?? diccionario(o, cx);
  if (c) return c;
  if (o.t === 'numero') {
    if (Number.isInteger(o.v) && o.v >= 0) return { estado: 'valido', regla: 'entero-no-negativo', valor: o.v };
    return { estado: 'invalido', regla: 'numero-no-valido', inc: [{ tipo: 'numero-no-valido', mensaje: o.v < 0 ? `Número negativo (${o.v}).` : `Número con decimales (${o.v}) donde se espera un entero.` }] };
  }
  if (o.t === 'texto') {
    const s = o.v.trim();
    if (/^\d+$/.test(s)) return { estado: 'transformado', regla: 'entero-texto', valor: Number(s) };
    return { estado: 'invalido', regla: 'numero-texto-no-reconocido', inc: [{ tipo: 'numero-texto-no-reconocido' }] };
  }
  return { estado: 'invalido', regla: 'tipo-no-admitido', inc: [{ tipo: 'tipo-no-admitido' }] };
}

const UNIDAD_METROS = /^(\d+(?:[.,]\d+)?)\s*(?:m|mts?|metros?)\.?$/i;

function fachada(o: ValorOriginal, cx: Ctx): Res {
  const c = comunes(o) ?? diccionario(o, cx);
  if (c) return c;
  if (o.t === 'numero') {
    if (o.v >= 0) return { estado: 'valido', regla: 'decimal-no-negativo', valor: o.v };
    return { estado: 'invalido', regla: 'numero-no-valido', inc: [{ tipo: 'fachada-no-valida', mensaje: `Medida negativa (${o.v}).` }] };
  }
  if (o.t === 'texto') {
    const s = o.v.trim();
    if (/^\d+(?:[.,]\d{1,2})?$/.test(s)) return { estado: 'transformado', regla: 'decimal-texto', valor: Number(s.replace(',', '.')) };
    const m = UNIDAD_METROS.exec(s);
    if (m) return propuesta(cx, 'fachada-con-unidad', Number(m[1].replace(',', '.')), { tipo: 'fachada-con-unidad', mensaje: `«${s}» podría ser ${m[1]} metros.` });
    return { estado: 'invalido', regla: 'numero-texto-no-reconocido', inc: [{ tipo: 'fachada-no-valida' }] };
  }
  return { estado: 'invalido', regla: 'tipo-no-admitido', inc: [{ tipo: 'tipo-no-admitido' }] };
}

function texto(o: ValorOriginal): Res {
  const c = comunes(o);
  if (c) return c;
  if (o.t === 'texto') return { estado: 'valido', regla: 'texto-literal', valor: o.v };
  if (o.t === 'numero') return { estado: 'transformado', regla: 'texto-desde-numero', valor: String(o.v) };
  return { estado: 'invalido', regla: 'tipo-no-admitido', inc: [{ tipo: 'tipo-no-admitido' }] };
}

function fecha(o: ValorOriginal, cx: Ctx): Res {
  const c = comunes(o);
  if (c) return c.estado === 'vacio' ? { ...c, inc: [{ tipo: 'fecha-ausente' }] } : c;
  let r: Res;
  if (o.t === 'fecha') r = { estado: 'valido', regla: 'fecha-excel', valor: o.v.slice(0, 10) };
  else if (o.t === 'numero') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(o.v) * 86400000);
    if (!(o.v > 0 && o.v < 2958466)) return { estado: 'invalido', regla: 'fecha-no-reconocida', inc: [{ tipo: 'fecha-no-reconocida' }] };
    return propuesta(cx, 'fecha-serial-sin-formato', fechaIso(d), { tipo: 'fecha-serial-sin-formato', mensaje: `El número ${o.v} correspondería al ${fechaIso(d)}.`, detalle: `correspondería al ${fechaIso(d)}` });
  } else if (o.t === 'texto') {
    const s = o.v.trim();
    let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    const corto = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/.exec(s);
    if (m) {
      const f = fechaValida(+m[3], +m[2], +m[1]);
      if (!f) return { estado: 'invalido', regla: 'fecha-no-reconocida', inc: [{ tipo: 'fecha-no-reconocida', mensaje: `«${s}» no es una fecha que exista.` }] };
      r = { estado: 'transformado', regla: 'fecha-texto-dma', valor: f };
    } else if (iso) {
      const f = fechaValida(+iso[1], +iso[2], +iso[3]);
      if (!f) return { estado: 'invalido', regla: 'fecha-no-reconocida', inc: [{ tipo: 'fecha-no-reconocida', mensaje: `«${s}» no es una fecha que exista.` }] };
      r = { estado: 'transformado', regla: 'fecha-texto-iso', valor: f };
    } else if ((m = corto)) {
      const f = fechaValida(2000 + +m[3], +m[2], +m[1]);
      if (!f) return { estado: 'invalido', regla: 'fecha-no-reconocida', inc: [{ tipo: 'fecha-no-reconocida' }] };
      return propuesta(cx, 'fecha-anio-dos-cifras', f, { tipo: 'fecha-anio-dos-cifras', mensaje: `«${s}» podría ser el ${f}.`, detalle: `podría ser el ${f}` });
    } else {
      return { estado: 'invalido', regla: 'fecha-no-reconocida', inc: [{ tipo: 'fecha-no-reconocida', mensaje: `«${s}» no es una fecha; la fecha queda ausente.` }] };
    }
  } else return { estado: 'invalido', regla: 'tipo-no-admitido', inc: [{ tipo: 'tipo-no-admitido' }] };

  const p = cx.op.periodo;
  if (p && typeof r.valor === 'string' && (r.valor < p.desde || r.valor > p.hasta)) {
    return { estado: 'pendiente', regla: 'fecha-fuera-de-campana', propuesta: r.valor, inc: [{ tipo: 'fecha-fuera-de-campana', mensaje: `${r.valor} está fuera del periodo ${p.desde} – ${p.hasta}.`, detalle: `${r.valor} fuera de ${p.desde} – ${p.hasta}` }] };
  }
  return r;
}

function portal(o: ValorOriginal): Res {
  if (vacia(o)) return { estado: 'vacio', regla: o.t === 'vacio' ? 'celda-vacia' : 'solo-espacios', inc: [{ tipo: 'numero-ausente' }] };
  const c = comunes(o);
  if (c) return c;
  if (o.t === 'numero') {
    if (Number.isInteger(o.v) && o.v > 0) return { estado: 'valido', regla: 'portal-entero', valor: { tipo: 'numero', numero: o.v } };
    return { estado: 'invalido', regla: 'portal-no-reconocido', inc: [{ tipo: 'numero-no-reconocido', mensaje: `${o.v} no es un número de portal.` }] };
  }
  if (o.t === 'texto') {
    const s = o.v.trim();
    if (/^s\s*\/\s*n\.?$/i.test(s)) return { estado: 'valido', regla: 'portal-sn', valor: { tipo: 'sin-numero' } };
    if (/^\d+$/.test(s) && +s > 0) return { estado: 'transformado', regla: 'portal-texto-entero', valor: { tipo: 'numero', numero: +s } };
    const m = /^(\d+)\s*-?\s*([a-zñ]{1,3}|bis|dup\.?)$/i.exec(s);
    if (m && +m[1] > 0) return { estado: 'transformado', regla: 'portal-sufijo', valor: { tipo: 'numero', numero: +m[1], sufijo: m[2].toUpperCase() } };
  }
  return { estado: 'invalido', regla: 'portal-no-reconocido', inc: [{ tipo: 'numero-no-reconocido' }] };
}

function codigoPostal(o: ValorOriginal, cx: Ctx): Res {
  const c = comunes(o);
  if (c) return c;
  const s = o.t === 'numero' && Number.isInteger(o.v) ? String(o.v) : o.t === 'texto' ? o.v.trim() : '';
  if (/^\d{5}$/.test(s)) return { estado: 'valido', regla: 'cp-cinco-cifras', valor: s };
  if (/^\d{4}$/.test(s)) return propuesta(cx, 'cp-cuatro-cifras', `0${s}`, { tipo: 'cp-cuatro-cifras', mensaje: `«${s}» podría ser 0${s}.` });
  return { estado: 'invalido', regla: 'cp-no-valido', inc: [{ tipo: 'cp-no-valido' }] };
}

function territorial(campo: 'distrito' | 'zona' | 'cp', o: ValorOriginal, cx: Ctx): Res {
  const regla: ReglaTerritorial | undefined = cx.op.territorio?.[campo];
  if (regla?.uso === 'no-se-usa') {
    if (vacia(o)) return { estado: 'no-aplica', regla: 'territorio-no-se-usa' };
    return { estado: 'no-aplica', regla: 'territorio-no-se-usa', inc: [{ tipo: 'territorio-no-usado-con-valor' }] };
  }
  if (vacia(o)) {
    const exigir = cx.op.modo === 'campana-actual' && regla?.obligatorio;
    return { estado: 'vacio', regla: regla ? 'territorio-ausente-historico' : 'celda-vacia', inc: exigir ? [{ tipo: 'territorio-obligatorio-ausente' }] : undefined };
  }
  if (campo !== 'cp') {
    const c = comunes(o);
    if (c) return c;
    const v = o.t === 'numero' ? String(o.v) : o.t === 'texto' ? o.v : null;
    return v === null ? { estado: 'invalido', regla: 'tipo-no-admitido', inc: [{ tipo: 'tipo-no-admitido' }] } : { estado: 'valido', regla: 'territorio-codigo', valor: v };
  }
  const r = codigoPostal(o, cx);
  if (regla?.uso === 'fijo' && r.estado === 'valido' && r.valor !== regla.valorFijo) {
    return { estado: 'pendiente', regla: 'cp-distinto-del-fijo', propuesta: r.valor, inc: [{ tipo: 'cp-distinto-del-fijo', mensaje: `CP ${r.valor}; el municipio tiene el CP fijo ${regla.valorFijo}.`, detalle: `CP ${r.valor}; fijo ${regla.valorFijo}` }] };
  }
  return r;
}

// ───────────── Columnas ─────────────

/** Columnas del NEGOCIO: no aplican en un local vacío. */
const NEGOCIO = new Set([
  'nombre', 'grupoActividad', 'grupoComercio', 'subgrupo', 'actividad', 'descripcionActividad', 'franquicia', 'web', 'googleBusiness', 'ventaOnline',
  'numResenas', 'respondeResenas', 'instagram', 'seguidoresInstagram', 'facebook', 'seguidoresFacebook', 'twitter', 'seguidoresTwitter', 'numRedes',
]);
const CLASIFICACION = ['grupoActividad', 'grupoComercio', 'subgrupo', 'actividad', 'descripcionActividad'];
/** Respuesta de la que depende cada cifra (si es No, la cifra vacía no aplica). */
const DEPENDE: Record<string, string> = { seguidoresInstagram: 'instagram', seguidoresFacebook: 'facebook', seguidoresTwitter: 'twitter', numResenas: 'googleBusiness', respondeResenas: 'googleBusiness' };

function interpretarCelda(col: ColumnaOrigen, o: ValorOriginal, cx: Ctx): Res {
  if (col.territorial) return territorial(col.territorial, o, cx);
  if (col.clave === 'numero') return portal(o);
  if (col.clave === 'fachada') return fachada(o, cx);
  switch (col.tipo) {
    case 'fecha': return fecha(o, cx);
    case 'binario-01': return binario(o, cx);
    case 'entero': return entero(o, cx);
    case 'decimal': return fachada(o, cx);
    case 'portal': return portal(o);
    case 'codigo-postal': return codigoPostal(o, cx);
    default: return texto(o);
  }
}

// ───────────── Interpretación de una capa original ─────────────

export function interpretarCapa(capa: CapaOriginal, op: OpcionesInterpretacion = {}): ResultadoInterpretacion {
  const cx: Ctx = { op, autorizadas: new Set(op.reglasAutorizadas ?? []), aprobados: new Set((op.diccionarioAprobado ?? []).map(norm)) };
  const incidencias: Incidencia[] = [];
  const porClave = new Map(capa.columnas.map((c) => [c.clave, c]));
  const filas: FilaInterpretada[] = [];

  const anotar = (fi: FilaInterpretada, fo: FilaOriginal, clave: string, i: Inc, regla?: string) => {
    const col = porClave.get(clave)!;
    const tipo = TIPOS_INCIDENCIA[i.tipo];
    const n = incidencias.push({
      archivo: capa.archivo.nombre, hoja: capa.hoja, fila: fo.fila, columna: col.letra, cabecera: col.cabecera.trim(), campo: clave,
      tipo: i.tipo, gravedad: tipo.gravedad, decision: tipo.decision, mensaje: i.mensaje ?? tipo.titulo, ...(i.detalle ? { detalle: i.detalle } : {}), propuesta: tipo.propuesta,
      valorOriginal: mostrarOriginal(fo.celdas[clave] ?? { t: 'vacio' }), regla, relacionadas: i.relacionadas,
    }) - 1;
    const celda = fi.celdas[clave];
    if (celda) {
      (celda.incidencias ??= []).push(n);
      if (tipo.gravedad !== 'info') celda.revision = true;
    }
  };
  const fijar = (fi: FilaInterpretada, fo: FilaOriginal, clave: string, r: Res) => {
    fi.celdas[clave] = { estado: r.estado, regla: r.regla, revision: r.estado === 'invalido' || r.estado === 'pendiente', ...(r.valor !== undefined ? { valor: r.valor } : {}), ...(r.propuesta !== undefined ? { propuesta: r.propuesta } : {}) };
    for (const i of r.inc ?? []) anotar(fi, fo, clave, i, r.regla);
  };

  for (const fo of capa.filas) {
    const get = (k: string): ValorOriginal => fo.celdas[k] ?? { t: 'vacio' };
    const fi: FilaInterpretada = { fila: fo.fila, local: 'desconocido', celdas: {}, redesCalculadas: null, verificado2026: false };

    // 1. Local Vacío primero: decide qué significa un campo de negocio vacío.
    if (porClave.has('vacio')) {
      const r = binario(get('vacio'), cx);
      if (r.estado === 'vacio' && r.regla !== 'diccionario-sin-informacion') r.inc = [{ tipo: 'local-vacio-ausente' }];
      else if (r.inc?.some((i) => i.tipo === 'binario-invalido' || i.tipo === 'binario-texto-no-reconocido')) r.inc = [{ tipo: 'local-vacio-invalido', mensaje: `«Local Vacío» = ${mostrarOriginal(get('vacio'))}: no se deduce si está vacío.` }];
      fijar(fi, fo, 'vacio', r);
      if (r.valor === true) fi.local = 'vacio';
      else if (r.valor === false) fi.local = 'ocupado';
    }

    // 2. Cada columna por su tipo y su contexto.
    for (const col of capa.columnas) {
      if (col.clave === 'vacio') continue;
      const o = get(col.clave);
      let r = interpretarCelda(col, o, cx);
      const sinValor = r.estado === 'vacio' && (r.regla === 'celda-vacia' || r.regla === 'solo-espacios');
      if (col.clave === 'fachada' && sinValor && fi.local === 'ocupado') r = { estado: 'no-aplica', regla: 'no-aplica-local-ocupado' };
      if (NEGOCIO.has(col.clave) && sinValor) {
        if (fi.local === 'vacio') r = { estado: 'no-aplica', regla: 'no-aplica-local-vacio' };
        else if (fi.local === 'ocupado' && (col.tipo === 'binario-01' || col.tipo === 'entero') && !DEPENDE[col.clave] && col.clave !== 'numRedes') {
          r = { ...r, inc: [{ tipo: 'sin-dato-ocupado' }] };
        }
      }
      if (col.clave === 'fecha' && r.estado === 'vacio' && !r.inc) r.inc = [{ tipo: 'fecha-ausente' }];
      if (col.clave === 'direccion' && sinValor) r = { ...r, inc: [{ tipo: 'direccion-ausente' }] };
      fijar(fi, fo, col.clave, r);
    }

    const c = fi.celdas;
    const bool = (k: string) => (c[k] && (c[k].estado === 'valido' || c[k].estado === 'transformado') && typeof c[k].valor === 'boolean' ? (c[k].valor as boolean) : undefined);
    const num = (k: string) => (c[k] && (c[k].estado === 'valido' || c[k].estado === 'transformado') && typeof c[k].valor === 'number' ? (c[k].valor as number) : undefined);

    // 3. Coherencias entre campos (nunca corrigen: solo informan).
    if (fi.local === 'ocupado' && c.nombre && c.nombre.estado === 'vacio') anotar(fi, fo, 'nombre', { tipo: 'ocupado-sin-nombre' });
    if (fi.local === 'vacio') {
      const rellenos = [...NEGOCIO].filter((k) => porClave.has(k) && !vacia(get(k)));
      if (rellenos.length) anotar(fi, fo, 'vacio', { tipo: 'vacio-con-datos-negocio', mensaje: `Local vacío con ${rellenos.length} campo(s) de negocio rellenos: ${rellenos.map((k) => `«${porClave.get(k)!.cabecera.trim()}»`).join(', ')}.`, detalle: `${rellenos.length} campo(s) de negocio rellenos`, relacionadas: rellenos });
    }
    if (fi.local === 'ocupado' && c.fachada && c.fachada.estado !== 'no-aplica' && c.fachada.estado !== 'vacio') anotar(fi, fo, 'fachada', { tipo: 'fachada-en-ocupado' });

    for (const [cifra, resp] of Object.entries(DEPENDE)) {
      if (!c[cifra] || !c[resp]) continue;
      const r = bool(resp);
      if (r === false && c[cifra].estado === 'vacio' && (c[cifra].regla === 'celda-vacia' || c[cifra].regla === 'solo-espacios')) {
        c[cifra] = { estado: 'no-aplica', regla: 'no-aplica-red-no', revision: false };
        continue;
      }
      if (fi.local === 'ocupado' && r !== false && c[cifra].estado === 'vacio' && c[cifra].regla !== 'diccionario-sin-informacion') anotar(fi, fo, cifra, { tipo: 'sin-dato-ocupado' });
      if (r !== false) continue;
      if (cifra === 'respondeResenas') {
        if (bool(cifra) === true) anotar(fi, fo, cifra, { tipo: 'responde-sin-google', relacionadas: [resp] });
      } else if ((num(cifra) ?? 0) > 0) {
        anotar(fi, fo, cifra, cifra === 'numResenas' ? { tipo: 'resenas-sin-google', mensaje: `${num(cifra)} reseñas con Google Business = No.`, detalle: `${num(cifra)} reseñas`, relacionadas: [resp] } : { tipo: 'seguidores-con-red-no', mensaje: `${num(cifra)} seguidores con «${porClave.get(resp)!.cabecera.trim()}» = No.`, detalle: `${num(cifra)} seguidores con «${porClave.get(resp)!.cabecera.trim()}» = No`, relacionadas: [resp] });
      }
    }

    // 4. Nº redes: solo IG + FB + X con las tres respuestas válidas.
    if (c.numRedes && c.instagram && c.facebook && c.twitter) {
      const redes = [bool('instagram'), bool('facebook'), bool('twitter')];
      const calculable = redes.every((x) => x !== undefined);
      fi.redesCalculadas = calculable ? redes.filter(Boolean).length : null;
      const orig = num('numRedes');
      const celda = c.numRedes;
      if (celda.estado === 'no-aplica') {
        // local vacío sin dato
      } else if (calculable && orig !== undefined) {
        if (orig === fi.redesCalculadas) celda.regla = 'redes-coincide';
        else {
          Object.assign(celda, { estado: 'invalido', regla: 'redes-discrepa', revision: true });
          delete celda.valor;
          anotar(fi, fo, 'numRedes', { tipo: 'redes-discrepa', mensaje: `«Nº redes» = ${orig}; Instagram + Facebook + Twitter/X = ${fi.redesCalculadas}.`, detalle: `original ${orig}; calculado ${fi.redesCalculadas}`, relacionadas: ['instagram', 'facebook', 'twitter'] }, 'redes-discrepa');
        }
      } else if (!calculable && fi.local !== 'vacio') {
        if (orig !== undefined) {
          Object.assign(celda, { estado: 'pendiente', regla: 'redes-no-calculable', revision: true });
          delete celda.valor;
        }
        const malas = ['instagram', 'facebook', 'twitter'].filter((_, i) => redes[i] === undefined);
        anotar(fi, fo, 'numRedes', { tipo: 'redes-no-calculable', mensaje: `No se calcula: ${malas.map((k) => `«${porClave.get(k)!.cabecera.trim()}»`).join(', ')} sin respuesta válida.`, detalle: `sin respuesta válida en ${malas.map((k) => `«${porClave.get(k)!.cabecera.trim()}»`).join(', ')}`, relacionadas: malas }, 'redes-no-calculable');
      }
    }

    // 5. Clasificación histórica: se conserva y se diagnostica; nunca se confirma ni se reasigna.
    const txt = (k: string) => (c[k]?.estado === 'valido' || c[k]?.estado === 'transformado' ? String(c[k].valor).trim() || undefined : undefined);
    if (CLASIFICACION.some((k) => porClave.has(k)) && (fi.local === 'ocupado' || (fi.local === 'desconocido' && CLASIFICACION.some((k) => txt(k))))) {
      if (c.grupoComercio?.estado === 'vacio' && txt('grupoActividad') && norm(txt('grupoActividad')!) !== 'comercio') c.grupoComercio = { estado: 'no-aplica', regla: 'no-aplica-fuera-de-comercio', revision: false };
      const d = diagnosticarClasificacion({ grupo: txt('grupoActividad'), grupoComercio: txt('grupoComercio'), subgrupo: txt('subgrupo'), actividad: txt('actividad'), descripcion: txt('descripcionActividad') });
      fi.clasificacion = { ...d, confirmada: false };
      const cat = CATEGORIA_DIAGNOSTICO[d.diagnostico];
      const seguro = ETIQUETA_DIAGNOSTICO[d.diagnostico];
      const ancla = d.diagnostico === 'sin-grupo' || d.diagnostico === 'grupo-desconocido' ? 'grupoActividad'
        : d.diagnostico.includes('grupo-comercio') ? 'grupoComercio'
        : d.diagnostico === 'actividad-no-pertenece' || d.diagnostico.startsWith('servicios') || d.diagnostico === 'incompleta-sin-actividad' ? 'actividad' : 'subgrupo';
      const clave = porClave.has(ancla) ? ancla : 'grupoActividad';
      if (porClave.has(clave)) {
        const rel = CLASIFICACION.filter((k) => k !== clave && porClave.has(k));
        if (cat === 'incompleta') anotar(fi, fo, clave, { tipo: 'clasificacion-incompleta', mensaje: d.mensaje, detalle: seguro, relacionadas: rel });
        else if (cat === 'incoherente') anotar(fi, fo, clave, { tipo: 'clasificacion-incoherente', mensaje: d.mensaje, detalle: seguro, relacionadas: rel });
        else if (d.diagnostico === 'servicios-actividad-ejemplo') anotar(fi, fo, clave, { tipo: 'servicios-actividad-ejemplo', mensaje: d.mensaje, detalle: seguro });
        else if (d.diagnostico === 'servicios-actividad-no-prevista') anotar(fi, fo, clave, { tipo: 'servicios-actividad-no-prevista', mensaje: d.mensaje, detalle: seguro });
        for (const k of d.fueraDeLista) if (porClave.has(k)) anotar(fi, fo, k, { tipo: 'clasificacion-fuera-de-lista' });
      }
    }
    filas.push(fi);
  }

  // 6. Posibles filas de totales: se conservan e interpretan; la exclusión queda como propuesta sin confirmar.
  const candidatas = new Map(capa.candidatasExcluir.map((c) => [c.fila, c.motivo]));
  filas.forEach((fi, i) => {
    const motivo = candidatas.get(fi.fila);
    if (!motivo) return;
    fi.exclusion = { propuesta: 'excluir', motivo, confirmada: false };
    anotar(fi, capa.filas[i], capa.columnas[0].clave, { tipo: 'posible-fila-de-totales', mensaje: motivo });
  });

  // 7. Direcciones repetidas y filas idénticas: se conservan todas; solo se informa.
  if (porClave.has('direccion') && porClave.has('numero')) {
    const grupos = new Map<string, number[]>();
    filas.forEach((fi, i) => {
      const d = fi.celdas.direccion;
      const n = fi.celdas.numero;
      if (!d?.valor || !n?.valor || typeof n.valor !== 'object' || n.valor.tipo !== 'numero') return;
      const k = `${claveDenominacion(String(d.valor))}|${n.valor.numero}${n.valor.sufijo ?? ''}`;
      grupos.set(k, [...(grupos.get(k) ?? []), i]);
    });
    let g = 0;
    for (const idx of grupos.values()) {
      if (idx.length < 2) continue;
      g++;
      for (const i of idx) {
        filas[i].grupoDireccion = g;
        anotar(filas[i], capa.filas[i], 'direccion', { tipo: 'direccion-repetida', mensaje: `Misma calle y número que la(s) fila(s) ${idx.filter((j) => j !== i).map((j) => capa.filas[j].fila).join(', ')} (grupo ${g}).`, detalle: `grupo ${g}; otras filas: ${idx.filter((j) => j !== i).map((j) => capa.filas[j].fila).join(', ')}` });
      }
    }
  }
  const huellas = new Map<string, number>();
  capa.filas.forEach((fo, i) => {
    const h = JSON.stringify(capa.columnas.map((c) => fo.celdas[c.clave] ?? null));
    const previa = huellas.get(h);
    if (previa === undefined) return void huellas.set(h, i);
    anotar(filas[i], fo, capa.columnas[0].clave, { tipo: 'fila-duplicada-exacta', mensaje: `Idéntica a la fila ${capa.filas[previa].fila} en todas las columnas.`, detalle: `idéntica a la fila ${capa.filas[previa].fila}` });
  });

  return { original: capa, filas, incidencias, opciones: op };
}

// ───────────── Desde un XLSX ─────────────

export class ErrorInterpretacion extends Error {}

/** Capa original a partir de un libro ya leído, su informe estructural (C1a) y el perfil con el que se analizó. */
export function extraerCapaOriginal(libro: ExcelJS.Workbook, informe: InformeEstructural, perfilElegido?: PerfilImportacion): CapaOriginal {
  const perfil = perfilElegido ?? PERFILES_IMPORTACION.find((p) => p.id === informe.perfilPropuesto);
  if (!perfil || !informe.hojaDatos || !informe.filas.filaCabecera) {
    throw new ErrorInterpretacion('El archivo no es compatible con ningún perfil conocido: revise primero el análisis previo (C1a).');
  }
  const ws = libro.getWorksheet(informe.hojaDatos)!;
  const columnas = informe.columnas.filter((c) => c.perfil).map((c) => {
    const def = perfil.columnas.find((p) => p.clave === c.perfil!.clave)!;
    return { col: c.indice, origen: { clave: def.clave, letra: c.letra, cabecera: c.cabecera, tipo: def.tipo, ...(def.territorial ? { territorial: def.territorial } : {}) } as ColumnaOrigen };
  });
  const asignadas = new Set(columnas.map((c) => c.col));
  const adicionales = informe.cabeceras.filter((c) => !asignadas.has(c.indice));
  const totales = new Set(informe.filas.posiblesTotales);
  const filas: FilaOriginal[] = [];
  const candidatasExcluir: CapaOriginal['candidatasExcluir'] = [];
  const ultima = informe.filas.ultima ?? informe.filas.filaCabecera;
  for (let r = informe.filas.filaCabecera + 1; r <= ultima; r++) {
    const row = ws.getRow(r);
    const celdas: Record<string, ValorOriginal> = {};
    let alguna = false;
    for (const { col, origen } of columnas) {
      const o = valorOriginal(row.getCell(col));
      if (o.t !== 'vacio') celdas[origen.clave] = o;
      if (!vacia(o)) alguna = true;
    }
    const extra: Record<string, ValorOriginal> = {};
    for (const a of adicionales) {
      const o = valorOriginal(row.getCell(a.indice));
      if (o.t !== 'vacio') extra[a.letra] = o;
      if (!vacia(o)) alguna = true;
    }
    if (!alguna) continue;
    // Heurística de C1a (p. ej. «Total…» en la primera celda de texto): puede fallar, así que la fila
    // se conserva entera y solo se marca como candidata a excluir.
    if (totales.has(r)) candidatasExcluir.push({ fila: r, motivo: 'C1a la identifica como posible fila de totales (heurística); pendiente de confirmación humana.', origen: 'heuristica-c1a' });
    filas.push({ fila: r, celdas, ...(Object.keys(extra).length ? { adicionales: extra } : {}) });
  }
  return {
    archivo: { nombre: informe.archivo.nombre, sha256: informe.archivo.sha256 }, hoja: ws.name, filaCabecera: informe.filas.filaCabecera,
    perfil: { id: perfil.id, version: perfil.version }, columnas: columnas.map((c) => c.origen),
    ...(adicionales.length ? { adicionales: adicionales.map((a) => ({ letra: a.letra, cabecera: a.cabecera })) } : {}),
    filas, candidatasExcluir,
  };
}

/**
 * Lee un XLSX con el lector seguro (mismos límites que C1a), identifica hoja y perfil, extrae la
 * capa original e interpreta. Solo lectura: no toca la base de datos ni guarda el archivo.
 */
/**
 * G1 · Cómo leer el archivo: perfil elegido (o creado con la correspondencia de columnas) y, si la
 * detección automática no basta, la hoja y la fila de cabecera.
 */
export interface EleccionLectura {
  perfil?: PerfilImportacion;
  hoja?: string;
  filaCabecera?: number;
}

export async function interpretarXlsx(
  datos: ArrayBuffer | Uint8Array, nombreArchivo: string, opciones: OpcionesInterpretacion = {}, limites: LimitesXlsx = LIMITES_XLSX, eleccion: EleccionLectura = {},
): Promise<ResultadoInterpretacion & { estructura: InformeEstructural }> {
  const bytes = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  const leido = await leerLibro(bytes, limites);
  let perfil = eleccion.perfil;
  // La ubicación guardada en el perfil solo se usa si el libro tiene esa hoja (otro año puede llamarla distinto).
  const hojaPerfil = perfil?.ubicacion?.hoja && leido.libro.getWorksheet(perfil.ubicacion.hoja) ? perfil.ubicacion : undefined;
  const ubic = eleccion.hoja ? { hoja: eleccion.hoja, filaCabecera: eleccion.filaCabecera } : { hoja: hojaPerfil?.hoja, filaCabecera: hojaPerfil?.filaCabecera };
  let estructura = await analizarLibroLeido(leido, bytes, nombreArchivo, { territorio: opciones.territorio, ...(perfil ? { perfiles: [perfil] } : {}), ...ubic });
  if (perfil) {
    const comp = estructura.perfiles.find((p) => p.perfilId === perfil!.id);
    if (!estructura.hojaDatos || !comp?.compatible) {
      throw new ErrorInterpretacion(`El archivo no encaja con el perfil «${perfil.nombre}»${comp?.faltan.length ? `: faltan ${comp.faltan.map((f) => `«${f.trim()}»`).join(', ')}` : ''}. Revise la hoja, la fila de cabecera o las columnas.`);
    }
  } else if (!estructura.perfilPropuesto) {
    // Sin perfil compatible: solo si la correspondencia automática con el catálogo es completa y sin dudas.
    const ev = evaluarCorrespondencia(estructura.correspondencia);
    if (!estructura.hojaDatos || !estructura.filas.filaCabecera || !ev.lista) {
      throw new ErrorInterpretacion('El archivo no es compatible con ningún perfil conocido y sus columnas no se reconocen con seguridad: relaciónelas en el paso «Columnas».');
    }
    perfil = perfilDesdeCorrespondencia(estructura.correspondencia, { id: 'automatico', nombre: 'Correspondencia automática', hoja: estructura.hojaDatos, filaCabecera: estructura.filas.filaCabecera });
    estructura = await analizarLibroLeido(leido, bytes, nombreArchivo, { territorio: opciones.territorio, perfiles: [perfil], hoja: estructura.hojaDatos, filaCabecera: estructura.filas.filaCabecera });
  }
  const capa = extraerCapaOriginal(leido.libro, estructura, perfil);
  return { ...interpretarCapa(capa, opciones), estructura };
}


/**
 * G1 · Primeras filas de datos, tal como figuran (para previsualizar la correspondencia de columnas en
 * el navegador). Solo lectura; no se guarda nada.
 */
export function muestraFilas(libro: ExcelJS.Workbook, hoja: string, filaCabecera: number, indices: number[], n = 5): Record<number, string>[] {
  const ws = libro.getWorksheet(hoja);
  if (!ws) return [];
  const out: Record<number, string>[] = [];
  for (let r = filaCabecera + 1; r <= ws.rowCount && out.length < n; r++) {
    const row = ws.getRow(r);
    const fila: Record<number, string> = {};
    let alguna = false;
    for (const i of indices) {
      const o = valorOriginal(row.getCell(i));
      if (o.t !== 'vacio') alguna = true;
      fila[i] = o.t === 'vacio' ? '' : o.t === 'texto' ? o.v : mostrarOriginal(o);
    }
    if (alguna) out.push(fila);
  }
  return out;
}
