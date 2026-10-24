import { baseVacia, ErrorDominio, type BaseDatos } from './db';
import { sha256Texto } from './sha256';
import { MEDINA } from '../data/callejero';
import type { Calle, Id, Persona, Rol } from './types';
import { CONFIG_TERRITORIAL, territorioComoDato } from './territorio';
import { verificarSeparacionMunicipios } from './municipios';
import { referenciasIniciales } from './callejeros';

/**
 * C1e · ESPACIOS DE TRABAJO independientes.
 *
 * - **demo**: la demostración ficticia de siempre (store principal, IndexedDB «keyval-store»). No cambia.
 * - **ensayo**: espacio aislado para probar el procedimiento real con archivos SINTÉTICOS.
 * - **real**: espacio aislado para el censo AUTÉNTICO de Medina del Campo (2025 y, más adelante, 2026).
 *
 * Ensayo y real usan cada uno su PROPIA base de datos de IndexedDB (`ulit-censo-ensayo`,
 * `ulit-censo-real`), nunca la de la demostración. Cada base lleva su marca de espacio y un
 * identificador propio, que se comprueban al leer, al escribir y al restaurar un respaldo; sus
 * municipios, calles y personas llevan un prefijo propio. Como los identificadores de C1c derivan del
 * municipio (`camp-hist-<municipio>-…`, `imp-c1-<municipio>-…`, `reg-…`, `loc-…`, `neg-…`), ningún
 * registro, local ni campaña puede coincidir con los de la demostración.
 */

export type TipoEspacio = 'ensayo' | 'real';
export const TIPOS_ESPACIO: TipoEspacio[] = ['ensayo', 'real'];

export const ESPACIO_TXT: Record<TipoEspacio, { nombre: string; corto: string; descripcion: string }> = {
  ensayo: {
    nombre: 'Espacio de ensayo',
    corto: 'Ensayo',
    descripcion: 'Para probar el procedimiento completo con archivos SINTÉTICOS. No admite el archivo auténtico.',
  },
  real: {
    nombre: 'Espacio de datos reales',
    corto: 'Datos reales',
    descripcion: 'Para el censo auténtico de Medina del Campo. Separado de la demostración y del ensayo.',
  },
};

/** Prefijo de los identificadores propios de cada espacio. */
export const PREFIJO: Record<TipoEspacio, string> = { ensayo: 'ensayo', real: 'real' };
/**
 * Municipio PILOTO de cada espacio (Medina del Campo, con el callejero real). Desde G2 un espacio puede
 * tener más municipios, dados de alta como datos (`altaMunicipio`), todos con el prefijo del espacio.
 */
export const municipioDeEspacio = (tipo: TipoEspacio): Id => `${PREFIJO[tipo]}-mun-medina`;
/** Nombre de la base de IndexedDB de cada espacio (la demostración usa otra: «keyval-store»). */
export const BASE_INDEXEDDB: Record<TipoEspacio, string> = { ensayo: 'ulit-censo-ensayo', real: 'ulit-censo-real' };

/**
 * SHA-256 del archivo auténtico según el diagnóstico agregado facilitado por la Cátedra
 * (`CENSO COMPLETO MEDINA 2025(1).xlsx`). Una huella no revela el contenido. Se usa para:
 * avisar si el archivo elegido en el espacio real NO es ese; e impedir que se use en el ensayo.
 */
export { SHA256_ORIGINAL_MEDINA_2025 } from './xlsx/referencias';

export interface MetaEspacio {
  espacio: TipoEspacio;
  espacioId: string;
  creado: string;
  creadoPorId: Id;
}

export const metaEspacio = (db: BaseDatos): MetaEspacio | null =>
  db.meta?.espacio === 'ensayo' || db.meta?.espacio === 'real'
    ? { espacio: db.meta.espacio, espacioId: db.meta.espacioId ?? '', creado: db.meta.espacioCreado ?? '', creadoPorId: db.meta.espacioCreadoPorId ?? '' }
    : null;

/** ¿Pertenece la base a un espacio aislado (ensayo o real)? La demostración no lleva marca. */
export const esBaseDeEspacio = (db: BaseDatos | null | undefined) => !!db && (db.meta?.espacio === 'ensayo' || db.meta?.espacio === 'real');

const iniciales = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);

export interface DatosCreacion {
  persona: { nombre: string; roles: Rol[] };
  /**
   * Callejero REAL de Medina (instantánea OSM validada). G3: Medina es OPCIONAL (caso de prueba, no la base
   * obligatoria): con `incluirMedina: false` el espacio se crea sin ningún municipio.
   */
  calles: Calle[];
  incluirMedina?: boolean;
  detalleCallejero: string;
  /** Identificador aleatorio del espacio (lo da quien llama; en pruebas, fijo). */
  espacioId: string;
  ahora?: string;
}

/**
 * Base NUEVA de un espacio aislado: el municipio con su callejero real (identificadores con prefijo)
 * y la persona que lo crea. Sin campañas: la histórica 2025 la crea la incorporación (C1c) y la de
 * 2026 se creará en su fase, sin copiar nada de 2025.
 */
export function crearBaseEspacio(tipo: TipoEspacio, d: DatosCreacion): BaseDatos {
  const nombre = d.persona.nombre.trim();
  if (nombre.length < 3) throw new ErrorDominio('regla', 'Indique el nombre de la persona responsable (al menos 3 caracteres).');
  if (!d.persona.roles.length) throw new ErrorDominio('regla', 'Indique al menos un rol.');
  const conMedina = d.incluirMedina !== false;
  if (conMedina && (d.calles.length < 20 || d.calles.some((c) => c.procedencia !== 'osm'))) {
    throw new ErrorDominio('bloqueado', 'Hace falta el callejero real de Medina del Campo (instantánea OSM validada): no se crea el espacio con un callejero simulado.');
  }
  const p = PREFIJO[tipo];
  const ahora = d.ahora ?? new Date().toISOString();
  const db = baseVacia();
  const munId = municipioDeEspacio(tipo);
  const persona: Persona = { id: `${p}-p-${slug(nombre)}`, nombre, iniciales: iniciales(nombre), roles: d.persona.roles, color: tipo === 'real' ? '#8a1c1c' : '#5a48c9' };
  db.personas[persona.id] = persona;
  if (!conMedina) {
    db.meta = { espacio: tipo, espacioId: d.espacioId, espacioCreado: ahora, espacioCreadoPorId: persona.id };
    return db;
  }
  db.municipios[munId] = {
    id: munId, nombre: 'Medina del Campo', provincia: 'Valladolid', centro: MEDINA.centro, fuenteCallejero: 'osm',
    nota: tipo === 'real'
      ? 'Espacio de datos REALES. Separado de la demostración y del ensayo.'
      : 'Espacio de ENSAYO con archivos sintéticos. Separado de la demostración y del espacio real.',
    // G2: la configuración territorial y el estado del callejero se guardan como datos del municipio.
    territorio: territorioComoDato(CONFIG_TERRITORIAL['mun-medina']),
    // G3: las referencias de denominación de partida (con su fuente) quedan como datos del callejero.
    callejero: { estado: 'disponible', fuente: 'osm-instantanea', detalle: d.detalleCallejero, actualizado: ahora, referencias: referenciasIniciales(munId) },
  };
  for (const c of d.calles) {
    const id = `${p}-${c.id}`;
    db.calles[id] = { ...c, id, municipioId: munId };
  }
  db.meta = {
    espacio: tipo, espacioId: d.espacioId, espacioCreado: ahora, espacioCreadoPorId: persona.id,
    fuenteCallejero: 'instantanea-osm', detalleCallejero: d.detalleCallejero,
  };
  return db;
}

/** Persona responsable del espacio (la que lo creó). */
export const personaEspacio = (db: BaseDatos): Persona | undefined => db.personas[db.meta?.espacioCreadoPorId ?? ''];

/**
 * Comprueba que una base es de ESE espacio y no contiene nada de la demostración ni de otro espacio.
 * Devuelve la lista de problemas (vacía = correcta). Se usa al abrir, antes de escribir y al restaurar.
 */
export function verificarEspacio(db: BaseDatos, tipo: TipoEspacio): string[] {
  const e: string[] = [];
  const m = metaEspacio(db);
  if (!m) return ['La base no lleva marca de espacio: parece la demostración u otra aplicación.'];
  if (m.espacio !== tipo) return [`La base es del espacio «${m.espacio}», no del espacio «${tipo}».`];
  if (!m.espacioId) e.push('Falta el identificador del espacio.');
  const pref = `${PREFIJO[tipo]}-`;
  // G2: varios municipios por espacio, todos con el prefijo del espacio y ninguno de la demostración.
  for (const mun of Object.values(db.municipios)) {
    if (!mun.id.startsWith(`${pref}mun-`)) e.push(`Municipio ajeno al espacio: «${mun.id}».`);
    if (mun.escenarioDemo) e.push(`Municipio de demostración: «${mun.id}».`);
  }
  const ajeno = (col: string, id: string, municipioId?: string) => {
    if (municipioId !== undefined && !db.municipios[municipioId]) e.push(`${col} «${id}» de un municipio que no es del espacio («${municipioId}»).`);
  };
  for (const c of Object.values(db.calles)) {
    ajeno('Calle', c.id, c.municipioId);
    if (!c.id.startsWith(pref)) e.push(`Calle sin el prefijo del espacio: «${c.id}».`);
  }
  for (const c of Object.values(db.campanas)) ajeno('Campaña', c.id, c.municipioId);
  for (const l of Object.values(db.locales)) ajeno('Local', l.id, l.municipioId);
  for (const i of Object.values(db.importaciones)) ajeno('Importación', i.id, i.municipioId);
  for (const c of Object.keys(db.campanas)) if (!c.startsWith(pref) && !c.startsWith(`camp-hist-${pref}`)) e.push(`Campaña sin el prefijo del espacio: «${c}».`);
  for (const p of Object.keys(db.personas)) if (!p.startsWith(pref)) e.push(`Persona sin el prefijo del espacio: «${p}».`);
  // G2: ninguna entidad relaciona datos de municipios distintos.
  e.push(...verificarSeparacionMunicipios(db));
  // Nada simulado en un espacio con datos reales o de ensayo (los sintéticos entran como «importado»).
  for (const col of ['locales', 'negocios', 'campanas', 'importaciones'] as const) {
    for (const x of Object.values(db[col]) as { id: string; procedencia?: string }[]) if (x.procedencia === 'simulado') e.push(`${col} «${x.id}» procede de la demostración (simulado).`);
  }
  // G3: OSM, callejero oficial («importado») o alta manual supervisada; nunca simulado.
  for (const c of Object.values(db.calles)) if (c.procedencia !== 'osm' && c.procedencia !== 'manual' && c.procedencia !== 'importado') e.push(`Calle «${c.id}» no procede de un callejero real.`);
  // Coordenadas: en un espacio real no se generan ni se guardan posiciones simuladas.
  for (const l of Object.values(db.locales)) if (l.coord && !l.coordVerificada) e.push(`Local «${l.id}» con coordenadas sin verificar.`);
  return e.slice(0, 50);
}

/** Huella SHA-256 del contenido completo de una base (para comprobar escrituras y respaldos). */
export const huellaBase = (db: BaseDatos) => sha256Texto(JSON.stringify(db));
