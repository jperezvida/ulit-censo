import type { BaseDatos } from './db';
import { claveCalle, normalizar, similitud } from './text';
import type { Calle, Id } from './types';

/**
 * Conciliación SUPERVISADA de denominaciones de calle (censo histórico → callejero del municipio).
 *
 * Para cada denominación del archivo que no coincide con el callejero se preparan PROPUESTAS, cada una
 * con su FUENTE (por qué se propone) y su explicación. Ninguna propuesta se aplica sola: solo una
 * decisión humana trazada (persona, fecha y justificación) vincula los registros a una calle. Una
 * propuesta basada SOLO en el parecido del texto se marca como tal y nunca basta por sí misma.
 * Cuando la calle no existe en el callejero (p. ej. la denominación oficial no está en OpenStreetMap)
 * se dice así: no se inventan calles, geometrías ni coordenadas.
 */

export type FuentePropuesta =
  | 'denominacion-actual-y-antigua'
  | 'contiene-nombre-callejero'
  | 'abreviatura-tipo-via'
  | 'mismo-nombre-otro-tipo'
  | 'referencia-catedra'
  | 'similitud-textual';

export const FUENTE_TXT: Record<FuentePropuesta, { titulo: string; solida: boolean }> = {
  'denominacion-actual-y-antigua': { titulo: 'La denominación incluye el nombre actual y el antiguo («… antigua …»)', solida: true },
  'contiene-nombre-callejero': { titulo: 'La denominación contiene el nombre completo de una calle del callejero', solida: true },
  'abreviatura-tipo-via': { titulo: 'Abreviatura del tipo de vía no reconocida automáticamente', solida: true },
  'mismo-nombre-otro-tipo': { titulo: 'Mismo nombre con otro tipo de vía (o sin él)', solida: false },
  'referencia-catedra': { titulo: 'Referencia comunicada por la Cátedra', solida: true },
  'similitud-textual': { titulo: 'Solo parecido del texto: NO basta para confirmar', solida: false },
};

export interface Propuesta {
  calleId: Id;
  calle: string;
  fuente: FuentePropuesta;
  explicacion: string;
}

/**
 * Referencias de denominaciones comunicadas por la Cátedra (no son equivalencias aprobadas: solo
 * orientan la revisión). `oficial` es la denominación oficial que habría que encontrar en el callejero.
 */
export const REFERENCIAS_CATEDRA: { denominacion: string; oficial: string; nota: string; fecha: string }[] = [
  {
    denominacion: 'Plaza Mayor',
    oficial: 'Plaza Mayor de la Hispanidad',
    nota: 'Indicado por la Cátedra al revisar el censo 2025: «Plaza Mayor» corresponde a la Plaza Mayor de la Hispanidad.',
    fecha: '2026-10-24',
  },
];

/** Abreviaturas de tipo de vía que el reconocimiento automático NO expande (solo se proponen). */
const ABREVIATURAS: Record<string, string> = {
  rda: 'Ronda', avd: 'Avenida', avda: 'Avenida', pso: 'Paseo', pje: 'Pasaje', psje: 'Pasaje', trva: 'Travesía', trav: 'Travesía',
  cmno: 'Camino', gta: 'Glorieta', ctra: 'Carretera', crta: 'Carretera', pl: 'Plaza', pza: 'Plaza', plz: 'Plaza', c: 'Calle', cl: 'Calle', cal: 'Calle',
};
const UMBRAL_SIMILITUD = 0.72;

const nombreSinTipo = (n: string) => claveCalle(n).split(' ').slice(1).join(' ');

export interface DenominacionPendiente {
  denominacion: string;
  filas: number;
  propuestas: Propuesta[];
  /** La calle oficial de una referencia que NO está en el callejero (no se inventa). */
  ausente?: { oficial: string; nota: string };
}

/** Propuestas para UNA denominación sin correspondencia automática. */
export function proponer(denominacion: string, calles: Calle[]): Pick<DenominacionPendiente, 'propuestas' | 'ausente'> {
  const props: Propuesta[] = [];
  const unicas = new Map<string, Calle[]>();
  for (const c of calles) unicas.set(claveCalle(c.nombre), [...(unicas.get(claveCalle(c.nombre)) ?? []), c]);
  const unica = (clave: string) => (unicas.get(clave)?.length === 1 ? unicas.get(clave)![0] : undefined);
  const add = (c: Calle, fuente: FuentePropuesta, explicacion: string) => {
    if (!props.some((p) => p.calleId === c.id)) props.push({ calleId: c.id, calle: c.nombre, fuente, explicacion });
  };
  const n = normalizar(denominacion);
  let ausente: DenominacionPendiente['ausente'];

  // 1. Referencia de la Cátedra (denominación oficial): se busca en el callejero; si no está, se dice.
  for (const r of REFERENCIAS_CATEDRA) {
    if (normalizar(r.denominacion) !== n) continue;
    const c = unica(claveCalle(r.oficial));
    if (c) add(c, 'referencia-catedra', `${r.nota} «${r.oficial}» figura en el callejero.`);
    else ausente = { oficial: r.oficial, nota: `${r.nota} «${r.oficial}» NO figura en el callejero OSM actual: no se puede vincular ni se inventa su geometría.` };
  }

  // 2. «Nombre actual antigua Nombre anterior».
  const partes = denominacion.split(/\s+antigu[ao]\s+/i);
  if (partes.length === 2) {
    const c = unica(claveCalle(partes[0]));
    if (c) add(c, 'denominacion-actual-y-antigua', `«${partes[0].trim()}» es el nombre actual y «${partes[1].trim()}» el antiguo, según la propia denominación.`);
  }

  // 3. La denominación empieza por el nombre completo (con tipo de vía) de una calle del callejero.
  for (const c of calles) {
    const nc = normalizar(c.nombre);
    if (n !== nc && n.startsWith(`${nc} `) && unica(claveCalle(c.nombre))) add(c, 'contiene-nombre-callejero', `Empieza por «${c.nombre}» y añade «${denominacion.slice(c.nombre.length).trim()}».`);
  }

  // 4. Abreviatura de tipo de vía que el reconocimiento automático no expande.
  const m = denominacion.trim().match(/^([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\.?\s+(.+)$/);
  if (m && ABREVIATURAS[normalizar(m[1])]) {
    const c = unica(claveCalle(`${ABREVIATURAS[normalizar(m[1])]} ${m[2]}`));
    if (c) add(c, 'abreviatura-tipo-via', `«${m[1]}» se interpreta como «${ABREVIATURAS[normalizar(m[1])]}»: «${ABREVIATURAS[normalizar(m[1])]} ${m[2]}» = «${c.nombre}».`);
  }

  // 5. Mismo nombre con otro tipo de vía (o sin tipo): solo si hay UNA calle con ese nombre.
  const nombre = nombreSinTipo(denominacion);
  const mismos = calles.filter((c) => nombreSinTipo(c.nombre) === nombre);
  if (nombre && mismos.length === 1) add(mismos[0], 'mismo-nombre-otro-tipo', `Mismo nombre («${nombre}») con otro tipo de vía: comprobar que es la misma vía.`);

  // 6. Solo parecido de texto (las tres más parecidas por encima del umbral).
  if (!props.length) {
    calles.map((c) => ({ c, s: similitud(denominacion, c.nombre) })).filter((x) => x.s >= UMBRAL_SIMILITUD).sort((a, b) => b.s - a.s).slice(0, 3)
      .forEach(({ c, s }) => add(c, 'similitud-textual', `Parecido del texto ${Math.round(s * 100)} %. No basta para confirmar: hay que comprobarlo con otra fuente (nomenclátor, plano, visita).`));
  }
  return { propuestas: props, ...(ausente ? { ausente } : {}) };
}

// ───────────── Decisiones de conciliación (trazadas) ─────────────

export type DecisionCalle =
  | { denominacion: string; accion: 'vincular'; calleId: Id; fuente: FuentePropuesta | 'eleccion-manual'; porId: Id; fecha: string; motivo: string }
  | { denominacion: string; accion: 'sin-correspondencia'; porId: Id; fecha: string; motivo: string };

/** Validación de las decisiones de calle frente al callejero y al archivo. */
export function validarDecisionesCalle(db: BaseDatos, ds: DecisionCalle[], municipioId: Id, denominaciones: Set<string>): string[] {
  const errores: string[] = [];
  const vistas = new Set<string>();
  for (const d of ds) {
    const que = `Calle «${d.denominacion}»`;
    if (!d.porId || !db.personas[d.porId]) errores.push(`${que}: la persona «${d.porId}» no existe; toda decisión debe estar firmada.`);
    if (!/^\d{4}-\d{2}-\d{2}/.test(d.fecha ?? '')) errores.push(`${que}: falta la fecha de la decisión.`);
    if (!d.motivo?.trim()) errores.push(`${que}: falta la justificación.`);
    if (!denominaciones.has(d.denominacion)) errores.push(`${que}: la denominación no aparece en el archivo.`);
    if (vistas.has(d.denominacion)) errores.push(`${que}: decisión duplicada.`);
    vistas.add(d.denominacion);
    if (d.accion === 'vincular') {
      const c = db.calles[d.calleId];
      if (!c || c.municipioId !== municipioId) errores.push(`${que}: la calle «${d.calleId}» no existe en el callejero del municipio.`);
    }
  }
  return errores;
}
