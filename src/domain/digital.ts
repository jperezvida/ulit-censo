import type { BaseDatos } from './db';
import { ErrorDominio, kNC, kRev } from './db';
import { anioDe, revisionDe } from './consultas';
import { prepararOperacionNegocio, type Alcance } from './bloqueo';
import { estaResuelta } from './respuesta';
import type { DatoDigital, Id, Respuesta, RevisionDigital, VariableDigital } from './types';

/**
 * Revisión de la presencia digital de un NEGOCIO en una campaña.
 *
 * Reglas:
 *  - Las obligaciones son condicionales: sin Google Business Profile no se exigen reseñas;
 *    sin Instagram no se exigen seguidores.
 *  - «pendiente» bloquea la verificación; «no aplicable» y «sin información» la permiten.
 *  - Cambiar una variable relevante después de verificar reabre la revisión.
 *  - Lo heredado de otra campaña entra como borrador y nunca como verificado.
 *  - Solo se hereda del MISMO negocio.
 *
 * El conjunto de variables es PROVISIONAL: se ajustará a las columnas del perfil real.
 */

export interface DefVariable {
  id: VariableDigital;
  etiqueta: string;
  tipo: 'respuesta' | 'numero';
  /** Variable de la que depende (solo se exige si el padre es «sí»). */
  depende?: VariableDigital;
  obligatoria: boolean;
  rango?: [number, number];
  /** «na» admitido (además de cuando el padre no es «sí»). */
  admiteNa?: boolean;
  /**
   * La presencia debe comprobarse y registrarse como Sí o No para verificar: «sin información»
   * queda registrada pero no permite verificar (procedimiento 2026: Facebook y Twitter / X).
   */
  exigeSiNo?: boolean;
}

export const VARIABLES_DIGITALES: DefVariable[] = [
  { id: 'web', etiqueta: 'Página web', tipo: 'respuesta', obligatoria: true },
  { id: 'ventaOnline', etiqueta: 'Venta por internet', tipo: 'respuesta', obligatoria: true },
  { id: 'googleBusiness', etiqueta: 'Google Business Profile', tipo: 'respuesta', obligatoria: true },
  // Campo adicional opcional: no figura en el procedimiento 2026 y no bloquea la verificación.
  { id: 'valoracion', etiqueta: 'Valoración media', tipo: 'numero', depende: 'googleBusiness', obligatoria: false, rango: [1, 5] },
  { id: 'numResenas', etiqueta: 'Nº de reseñas', tipo: 'numero', depende: 'googleBusiness', obligatoria: true, rango: [0, 1e6] },
  { id: 'respondeResenas', etiqueta: 'Responde reseñas', tipo: 'respuesta', depende: 'googleBusiness', obligatoria: true },
  { id: 'instagram', etiqueta: 'Instagram', tipo: 'respuesta', obligatoria: true },
  { id: 'seguidoresInstagram', etiqueta: 'Seguidores Instagram', tipo: 'numero', depende: 'instagram', obligatoria: true, rango: [0, 1e9] },
  { id: 'facebook', etiqueta: 'Facebook', tipo: 'respuesta', obligatoria: true, exigeSiNo: true },
  { id: 'seguidoresFacebook', etiqueta: 'Seguidores Facebook', tipo: 'numero', depende: 'facebook', obligatoria: true, rango: [0, 1e9] },
  { id: 'twitter', etiqueta: 'Twitter / X', tipo: 'respuesta', obligatoria: true, exigeSiNo: true },
  { id: 'seguidoresTwitter', etiqueta: 'Seguidores Twitter / X', tipo: 'numero', depende: 'twitter', obligatoria: true, rango: [0, 1e9] },
  // Campo adicional opcional: no bloquea la verificación.
  { id: 'otrasRedes', etiqueta: 'Otras redes', tipo: 'respuesta', obligatoria: false, admiteNa: true },
];
/**
 * Grupos de presentación (procedimiento 2026): web y Google / redes sociales. «Valoración media»
 * y «Otras redes» son campos ADICIONALES opcionales: no figuran en el procedimiento 2026, no
 * bloquean la verificación y no pasarán al Excel municipal salvo que lo recoja la plantilla
 * acordada con informática (exportador oficial: bloque C3).
 */
export const VARIABLES_ADICIONALES: VariableDigital[] = ['valoracion', 'otrasRedes'];

export const GRUPOS_DIGITALES: { titulo: string; variables: VariableDigital[] }[] = [
  { titulo: 'Web y Google', variables: ['web', 'ventaOnline', 'googleBusiness', 'numResenas', 'respondeResenas', 'valoracion'] },
  { titulo: 'Redes sociales', variables: ['instagram', 'seguidoresInstagram', 'facebook', 'seguidoresFacebook', 'twitter', 'seguidoresTwitter', 'otrasRedes'] },
];

/**
 * «Nº redes» del procedimiento 2026 = Instagram + Facebook + Twitter / X (nada más). Solo hay total
 * definitivo si las tres están contestadas con Sí o No: «pendiente» y «sin información» (o
 * cualquier otra respuesta) dejan el total sin determinar. «Sin información» NUNCA cuenta como «No».
 */
export const REDES_CONTABLES: VariableDigital[] = ['instagram', 'facebook', 'twitter'];
export function numeroRedes(rev: RevisionDigital | undefined): number | null {
  let n = 0;
  for (const v of REDES_CONTABLES) {
    const r = rev?.datos[v]?.respuesta ?? 'pendiente';
    if (r !== 'si' && r !== 'no') return null;
    if (r === 'si') n++;
  }
  return n;
}

export const DEF_VARIABLE: Record<VariableDigital, DefVariable> = Object.fromEntries(VARIABLES_DIGITALES.map((v) => [v.id, v])) as Record<VariableDigital, DefVariable>;

const resp = (r: RevisionDigital | undefined, v: VariableDigital): Respuesta => r?.datos[v]?.respuesta ?? 'pendiente';

/** ¿Se exige esta variable con las respuestas actuales? */
export function esExigible(rev: RevisionDigital | undefined, v: VariableDigital): boolean {
  const def = DEF_VARIABLE[v];
  if (!def.obligatoria) return false;
  if (def.depende && resp(rev, def.depende) !== 'si') return false;
  // Sin reseñas no se exige la respuesta a reseñas.
  if (v === 'respondeResenas' && rev?.datos.numResenas?.respuesta === 'si' && rev.datos.numResenas.valor === 0) return false;
  return true;
}

export interface Problema {
  variable: VariableDigital;
  tipo: 'pendiente' | 'contradiccion';
  mensaje: string;
}

export function problemasDigitales(rev: RevisionDigital | undefined): Problema[] {
  const out: Problema[] = [];
  for (const def of VARIABLES_DIGITALES) {
    const d = rev?.datos[def.id];
    const r = d?.respuesta ?? 'pendiente';
    if (esExigible(rev, def.id) && !estaResuelta(r)) out.push({ variable: def.id, tipo: 'pendiente', mensaje: `${def.etiqueta}: pendiente de comprobar` });
    else if (esExigible(rev, def.id) && def.exigeSiNo && r !== 'si' && r !== 'no') {
      out.push({ variable: def.id, tipo: 'pendiente', mensaje: `${def.etiqueta}: hay que registrar Sí o No` });
    }
    if (def.depende && ['no', 'na'].includes(resp(rev, def.depende)) && r === 'si') {
      out.push({ variable: def.id, tipo: 'contradiccion', mensaje: `${def.etiqueta} registrado, pero ${DEF_VARIABLE[def.depende].etiqueta} = ${resp(rev, def.depende) === 'no' ? 'no' : 'no aplicable'}` });
    }
    if (def.tipo === 'numero' && r === 'si') {
      if (d?.valor === undefined || !Number.isFinite(d.valor)) out.push({ variable: def.id, tipo: 'contradiccion', mensaje: `${def.etiqueta}: falta el valor numérico` });
      else if (def.rango && (d.valor < def.rango[0] || d.valor > def.rango[1])) out.push({ variable: def.id, tipo: 'contradiccion', mensaje: `${def.etiqueta}: ${d.valor} fuera de rango (${def.rango[0]}–${def.rango[1]})` });
    }
  }
  return out;
}

export type EstadoDigital = 'sin-datos' | 'solo-historico' | 'borrador' | 'verificada';

export function revisionDigitalEn(db: BaseDatos, negocioId: Id, campanaId: Id): RevisionDigital | undefined {
  return db.digital[kNC(negocioId, campanaId)];
}

/** La revisión más reciente del MISMO negocio en una campaña anterior. */
export function revisionDigitalAnterior(db: BaseDatos, negocioId: Id, campanaId: Id): RevisionDigital | undefined {
  const anio = anioDe(db, campanaId);
  let mejor: RevisionDigital | undefined;
  for (const r of Object.values(db.digital)) {
    if (r.negocioId !== negocioId || r.campanaId === campanaId) continue;
    const a = anioDe(db, r.campanaId);
    if (a < anio && (!mejor || a > anioDe(db, mejor.campanaId))) mejor = r;
  }
  return mejor;
}

export function estadoDigital(db: BaseDatos, negocioId: Id, campanaId: Id): EstadoDigital {
  const r = revisionDigitalEn(db, negocioId, campanaId);
  if (r) return r.estado;
  return revisionDigitalAnterior(db, negocioId, campanaId) ? 'solo-historico' : 'sin-datos';
}

/** Alcance y bloqueo sobre todos los locales del negocio; devuelve solo aquellos donde es vigente. */
const preparar = prepararOperacionNegocio;

function marcarRevisiones(db: BaseDatos, campanaId: Id, localIds: Id[], digital: 'pendiente' | 'revisado') {
  const revisiones = { ...db.revisiones };
  for (const id of localIds) revisiones[kRev(campanaId, id)] = { ...revisionDe(db, campanaId, id), digital };
  db.revisiones = revisiones;
}

const igual = (a?: DatoDigital, b?: DatoDigital) => (a?.respuesta ?? 'pendiente') === (b?.respuesta ?? 'pendiente') && a?.valor === b?.valor;

/**
 * Registra una variable. Si la revisión estaba verificada y el dato cambia, se reabre
 * (vuelve a borrador) y la revisión digital de esos registros pasa a pendiente.
 */
export function registrarDatoDigital(
  db0: BaseDatos, negocioId: Id, campanaId: Id, variable: VariableDigital,
  dato: { respuesta: Respuesta; valor?: number; origen?: DatoDigital['origen'] },
  porId: Id, opciones: { alcance?: Alcance; fecha?: string } = {},
): BaseDatos {
  const def = DEF_VARIABLE[variable];
  if (dato.respuesta === 'na' && !def.admiteNa && !def.depende) {
    throw new ErrorDominio('regla', `${def.etiqueta} no admite «no aplicable»: usa sí, no o sin información.`);
  }
  const ids = preparar(db0, negocioId, campanaId, opciones.alcance);
  const db: BaseDatos = { ...db0 };
  const fecha = opciones.fecha ?? new Date().toISOString();
  const k = kNC(negocioId, campanaId);
  const actual: RevisionDigital = db.digital[k] ?? { negocioId, campanaId, datos: {}, estado: 'borrador', historial: [] };
  const nuevo: DatoDigital = { respuesta: dato.respuesta, valor: def.tipo === 'numero' && dato.respuesta === 'si' ? dato.valor : undefined, origen: dato.origen ?? 'manual', porId, fecha };
  if (igual(actual.datos[variable], nuevo) && actual.datos[variable]?.origen === nuevo.origen) return db0;
  let siguiente: RevisionDigital = { ...actual, datos: { ...actual.datos, [variable]: nuevo } };
  if (actual.estado === 'verificada') {
    siguiente = {
      ...siguiente, estado: 'borrador', verificadaPor: undefined, verificadaEn: undefined,
      historial: [...actual.historial, { accion: 'reabrir', porId, fecha, motivo: `Cambio en ${def.etiqueta}` }],
    };
  }
  db.digital = { ...db.digital, [k]: siguiente };
  marcarRevisiones(db, campanaId, ids, 'pendiente');
  return db;
}

/** Verifica la revisión digital. Falla si quedan variables exigibles pendientes o contradicciones. */
export function verificarDigital(db0: BaseDatos, negocioId: Id, campanaId: Id, porId: Id, opciones: { alcance?: Alcance; fecha?: string } = {}): BaseDatos {
  const ids = preparar(db0, negocioId, campanaId, opciones.alcance);
  const k = kNC(negocioId, campanaId);
  const rev = db0.digital[k];
  const problemas = problemasDigitales(rev);
  if (!rev || problemas.length) {
    throw new ErrorDominio('verificacion-incompleta', `No se puede verificar: ${problemas.length || 'todas las'} comprobación(es) pendiente(s) o incoherente(s).`, problemas.map((p) => p.mensaje));
  }
  const heredadas = Object.entries(rev.datos).filter(([, d]) => d?.origen === 'heredado');
  if (heredadas.length) {
    throw new ErrorDominio('verificacion-incompleta', 'Hay datos copiados de otra campaña sin confirmar.', heredadas.map(([v]) => `${DEF_VARIABLE[v as VariableDigital].etiqueta}: heredado sin comprobar`));
  }
  const fecha = opciones.fecha ?? new Date().toISOString();
  const db: BaseDatos = { ...db0, digital: { ...db0.digital, [k]: { ...rev, estado: 'verificada', verificadaPor: porId, verificadaEn: fecha, historial: [...rev.historial, { accion: 'verificar', porId, fecha }] } } };
  marcarRevisiones(db, campanaId, ids, 'revisado');
  return db;
}

/** Copia la revisión anterior del MISMO negocio como borrador (origen «heredado»). */
export function partirDeDigitalAnterior(db0: BaseDatos, negocioId: Id, campanaId: Id, porId: Id, opciones: { alcance?: Alcance } = {}): BaseDatos {
  const ant = revisionDigitalAnterior(db0, negocioId, campanaId);
  if (!ant) return db0;
  const ids = preparar(db0, negocioId, campanaId, opciones.alcance);
  const k = kNC(negocioId, campanaId);
  const actual = db0.digital[k];
  const fecha = new Date().toISOString();
  const datos: RevisionDigital['datos'] = { ...(actual?.datos ?? {}) };
  for (const [v, d] of Object.entries(ant.datos) as [VariableDigital, DatoDigital][]) {
    if (estaResuelta(datos[v]?.respuesta)) continue; // nunca pisa lo ya revisado en esta campaña
    datos[v] = { respuesta: d.respuesta, valor: d.valor, origen: 'heredado', porId, fecha };
  }
  const db: BaseDatos = {
    ...db0,
    digital: {
      ...db0.digital,
      [k]: { negocioId, campanaId, datos, estado: 'borrador', historial: [...(actual?.historial ?? []), { accion: 'partir-de-anterior', porId, fecha, motivo: `Desde ${db0.campanas[ant.campanaId]?.nombre ?? 'campaña anterior'}` }] },
    },
  };
  marcarRevisiones(db, campanaId, ids, 'pendiente');
  return db;
}

/** Confirma como «manual» un dato heredado sin cambiarlo (acción rápida de revisión). */
export function confirmarDatoHeredado(db: BaseDatos, negocioId: Id, campanaId: Id, variable: VariableDigital, porId: Id, opciones: { alcance?: Alcance } = {}): BaseDatos {
  const d = db.digital[kNC(negocioId, campanaId)]?.datos[variable];
  if (!d || d.origen !== 'heredado') return db;
  return registrarDatoDigital(db, negocioId, campanaId, variable, { respuesta: d.respuesta, valor: d.valor, origen: 'manual' }, porId, opciones);
}
