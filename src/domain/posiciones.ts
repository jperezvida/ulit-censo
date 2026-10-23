import type { BaseDatos } from './db';
import { desplazarPerpendicular, longitudLinea, puntoEnLinea } from './geo';
import type { UnidadPanel } from './panel';
import type { Calle, Id, LngLat, Municipio } from './types';

/**
 * Posiciones de los establecimientos para el mapa «Por establecimientos» del cuadro de mando.
 * Un punto por LOCAL FÍSICO observado; nunca se fusionan locales, aunque compartan portal.
 *
 * Tres tipos de posición, siempre distinguibles y nunca mezclados:
 * - **verificada**: el local tiene `coord` con `coordVerificada` (GPS de campo, catastro o comprobación manual);
 * - **aproximada**: datos reales con `coord` SIN verificar (p. ej., situada sobre la calle al importar).
 *   Se dibuja diferenciada y queda pendiente de validación: aquí no se confirma nada;
 * - **simulada**: SOLO en datos ficticios (escenario de demostración o locales simulados) y SOLO sobre la
 *   geometría existente de la calle. Se genera al calcular, de forma reproducible, y NO se guarda en el
 *   local: no es una coordenada.
 * Sin ninguna de las tres, el local no se dibuja (se cuenta como «sin posición»).
 */

export type TipoPosicion = 'verificada' | 'aproximada' | 'simulada';

export interface PosicionEstablecimiento {
  clave: string;
  localId: Id;
  calleId: Id;
  /** Posición del local según su tipo. */
  coord: LngLat;
  tipo: TipoPosicion;
  /** Portal (calle + número + sufijo). Varios locales pueden compartirlo: siguen siendo independientes. */
  portal: string;
  /** Grupo de locales dibujados en la misma posición (para expandirlos al dibujar) y orden dentro de él. */
  grupo: string;
  enGrupo: number;
  indiceEnGrupo: number;
}

export interface ResultadoPosiciones {
  posiciones: PosicionEstablecimiento[];
  porTipo: Record<TipoPosicion, number>;
  /** Locales físicos observados sin posición dibujable (ni verificada, ni aproximada, ni simulable). */
  sinPosicion: number;
  /** Observaciones sin local físico identificado: no son un local y no se dibujan como punto. */
  sinLocal: number;
  /** Locales que comparten portal con otro (cada uno conserva su punto). */
  enPortalCompartido: number;
}

/** ¿Es un dato ficticio? Escenario de demostración o local/negocio simulado. Solo a estos se les simula posición. */
export const esFicticio = (u: UnidadPanel, municipio: Pick<Municipio, 'escenarioDemo'>) => !!municipio.escenarioDemo || u.procedencia === 'simulado';

export const clavePortal = (u: Pick<UnidadPanel, 'calleId' | 'numero' | 'sufijo' | 'clave'>) =>
  u.numero === null ? `${u.calleId}|s/n|${u.clave}` : `${u.calleId}|${u.numero}${u.sufijo ? `|${u.sufijo}` : ''}`;

/** Hash FNV-1a de 32 bits: determinista, para lo que no depende del número de portal. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Distancia (m) de cada acera al eje de la calle en las posiciones simuladas. */
const ACERA_M = 7;

/**
 * Tramos de la calle encadenados en un recorrido continuo. En OSM una calle son varias vías en orden
 * arbitrario y con sentidos distintos: se empieza por el extremo más occidental (o más meridional) y se
 * enlaza cada vez el tramo cuyo extremo queda más cerca, invirtiéndolo si hace falta. Así la numeración
 * avanza en un solo sentido y pares e impares quedan cada uno en su acera. Determinista.
 */
export function recorridoCalle(calle: Calle): LngLat[][] {
  const pend = calle.segmentos.filter((s) => s.coords.length > 1).map((s) => s.coords);
  if (pend.length <= 1) return pend;
  const clave = (p: LngLat) => p[0] + p[1] * 0.5;
  let iIni = 0;
  let invertir = false;
  pend.forEach((c, i) => {
    for (const [p, inv] of [[c[0], false], [c[c.length - 1], true]] as const) {
      const ini = invertir ? pend[iIni][pend[iIni].length - 1] : pend[iIni][0];
      if (clave(p) < clave(ini)) { iIni = i; invertir = inv; }
    }
  });
  const orden: LngLat[][] = [];
  let actual = pend.splice(iIni, 1)[0];
  if (invertir) actual = [...actual].reverse();
  orden.push(actual);
  const d2 = (a: LngLat, b: LngLat) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  while (pend.length) {
    const fin = orden[orden.length - 1][orden[orden.length - 1].length - 1];
    let mejor = 0;
    let inv = false;
    let dm = Infinity;
    pend.forEach((c, i) => {
      const a = d2(fin, c[0]);
      const b = d2(fin, c[c.length - 1]);
      if (a < dm) { dm = a; mejor = i; inv = false; }
      if (b < dm) { dm = b; mejor = i; inv = true; }
    });
    const c = pend.splice(mejor, 1)[0];
    orden.push(inv ? [...c].reverse() : c);
  }
  return orden;
}

/** Punto a la fracción `t` de la longitud TOTAL de la calle, recorriendo sus tramos encadenados. */
function puntoEnCalle(calle: Calle, t: number): { p: LngLat; dir: LngLat } | undefined {
  const segs = recorridoCalle(calle).map((c) => ({ c, l: longitudLinea(c) }));
  const total = segs.reduce((a, s) => a + s.l, 0);
  if (!segs.length || total <= 0) return undefined;
  let resto = t * total;
  for (const s of segs) {
    if (resto <= s.l) return puntoEnLinea(s.c, s.l ? resto / s.l : 0);
    resto -= s.l;
  }
  const u = segs[segs.length - 1];
  return puntoEnLinea(u.c, 1);
}

/**
 * Posiciones simuladas (reproducibles) de los portales de una calle: los números pares a un lado y los
 * impares al otro, repartidos a lo largo de la geometría en el orden de su numeración. Los locales del
 * mismo portal reciben la MISMA posición (el dibujo los expande); los «s/n», una posición propia por hash.
 */
function simularCalle(calle: Calle, portales: { clave: string; numero: number | null; sufijo?: string }[]): Map<string, LngLat> {
  const out = new Map<string, LngLat>();
  const lado = (par: boolean) => {
    const ps = portales.filter((p) => p.numero !== null && (p.numero % 2 === 0) === par)
      .sort((a, b) => a.numero! - b.numero! || (a.sufijo ?? '').localeCompare(b.sufijo ?? ''));
    ps.forEach((p, i) => {
      const r = puntoEnCalle(calle, (i + 0.5) / ps.length);
      if (r) out.set(p.clave, redondear(desplazarPerpendicular(r.p, r.dir, par ? -ACERA_M : ACERA_M)));
    });
  };
  lado(true);
  lado(false);
  for (const p of portales.filter((x) => x.numero === null)) {
    const h = hash(p.clave);
    const r = puntoEnCalle(calle, 0.05 + 0.9 * ((h % 10007) / 10007));
    if (r) out.set(p.clave, redondear(desplazarPerpendicular(r.p, r.dir, h % 2 ? ACERA_M : -ACERA_M)));
  }
  return out;
}

const redondear = (p: LngLat): LngLat => [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7];

/**
 * Calcula las posiciones de las unidades. Para que sean estables al filtrar, pásense TODAS las unidades de la
 * campaña y fíltrese después al dibujar. No modifica la base de datos.
 */
export function posicionesEstablecimientos(db: BaseDatos, municipio: Municipio, unidades: UnidadPanel[]): ResultadoPosiciones {
  const conLocal = unidades.filter((u) => u.localId);
  const porTipo: Record<TipoPosicion, number> = { verificada: 0, aproximada: 0, simulada: 0 };
  const posiciones: PosicionEstablecimiento[] = [];

  // Portales ficticios a simular, por calle (solo calles con geometría).
  const aSimular = new Map<Id, Map<string, { clave: string; numero: number | null; sufijo?: string }>>();
  const tipoDe = new Map<string, TipoPosicion>();
  for (const u of conLocal) {
    const l = db.locales[u.localId!];
    if (l?.coord && l.coordVerificada) tipoDe.set(u.clave, 'verificada');
    else if (esFicticio(u, municipio)) {
      const c = db.calles[u.calleId];
      if (!c?.segmentos.some((s) => s.coords.length > 1)) continue;
      const k = clavePortal(u);
      if (!aSimular.has(u.calleId)) aSimular.set(u.calleId, new Map());
      aSimular.get(u.calleId)!.set(k, { clave: k, numero: u.numero, sufijo: u.sufijo });
      tipoDe.set(u.clave, 'simulada');
    } else if (l?.coord) tipoDe.set(u.clave, 'aproximada');
  }
  const simuladas = new Map<string, LngLat>();
  for (const [calleId, ps] of aSimular) for (const [k, p] of simularCalle(db.calles[calleId], [...ps.values()])) simuladas.set(k, p);

  for (const u of conLocal) {
    const tipo = tipoDe.get(u.clave);
    if (!tipo) continue;
    const portal = clavePortal(u);
    const coord = tipo === 'simulada' ? simuladas.get(portal) : db.locales[u.localId!].coord;
    if (!coord) { tipoDe.delete(u.clave); continue; }
    posiciones.push({ clave: u.clave, localId: u.localId!, calleId: u.calleId, coord, tipo, portal, grupo: '', enGrupo: 1, indiceEnGrupo: 0 });
    porTipo[tipo]++;
  }

  // Grupos de posiciones coincidentes (≈1 m): se expanden al dibujar, sin fusionar locales.
  const grupos = new Map<string, PosicionEstablecimiento[]>();
  for (const p of posiciones) {
    const g = `${p.tipo === 'simulada' ? 's' : 'r'}:${Math.round(p.coord[0] * 1e5)}:${Math.round(p.coord[1] * 1e5)}`;
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g)!.push(p);
  }
  for (const [g, ps] of grupos) {
    ps.sort((a, b) => a.clave.localeCompare(b.clave));
    ps.forEach((p, i) => Object.assign(p, { grupo: g, enGrupo: ps.length, indiceEnGrupo: i }));
  }
  const porPortal = new Map<string, number>();
  for (const u of conLocal) porPortal.set(clavePortal(u), (porPortal.get(clavePortal(u)) ?? 0) + 1);

  return {
    posiciones,
    porTipo,
    sinPosicion: conLocal.length - posiciones.length,
    sinLocal: unidades.length - conLocal.length,
    enPortalCompartido: conLocal.filter((u) => u.numero !== null && (porPortal.get(clavePortal(u)) ?? 0) > 1).length,
  };
}

/**
 * Desplazamiento de dibujo, en píxeles, de un punto dentro de su grupo de posiciones coincidentes: los
 * locales se colocan en corona alrededor de la posición común (expansión), que se marca con un ancla.
 */
export function desplazamientoGrupo(enGrupo: number, indice: number, radioBase = 7): [number, number] {
  if (enGrupo <= 1) return [0, 0];
  const r = radioBase + Math.max(0, enGrupo - 3) * 1.6;
  const a = -Math.PI / 2 + (2 * Math.PI * indice) / enGrupo;
  return [r * Math.cos(a), r * Math.sin(a)];
}
