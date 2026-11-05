import type { SupabaseClient } from '@supabase/supabase-js';
import { baseVacia, type BaseDatos } from '../domain/db';
import type { TipoEspacio } from '../domain/espacios';

/**
 * Persistencia REMOTA de un espacio en el esquema privado `ulit_censo` de Supabase.
 *
 * - Solo usa la clave pública y la sesión de Supabase Auth de la persona; el servidor decide con su
 *   pertenencia al espacio (`ulit_censo.miembro`) qué puede leer o escribir. Nunca una clave privilegiada.
 * - Guarda únicamente las entidades que han cambiado (el dominio comparte estructura: basta comparar
 *   referencias), en UNA transacción, con la versión esperada del espacio.
 * - Si otra pestaña o persona guardó antes, el servidor responde PT409 y aquí se lanza `ConflictoRemoto`:
 *   no se reintenta ni se sobrescribe nada.
 * - Los envíos grandes (la carga del censo) se suben por partes y se aplican en una sola transacción.
 */

export type Cambio = { c: string; id: string; v: unknown };

const VACIA = baseVacia();
/** Colecciones `Record<id, entidad>` de la base (una fila por entidad en el servidor). */
export const COLECCIONES = (Object.keys(VACIA) as (keyof BaseDatos)[]).filter((k) => k !== 'meta' && VACIA[k] !== null && typeof VACIA[k] === 'object' && !Array.isArray(VACIA[k]));
/** Valores escalares de la base (se guardan juntos como la entidad `_raiz/raiz`). */
export const ESCALARES = (Object.keys(VACIA) as (keyof BaseDatos)[]).filter((k) => !COLECCIONES.includes(k));

/** Límites de cada petición (por debajo de los del servidor y de la API: tamaño y tiempo de sentencia). */
export const LIMITE_PARTE = { entidades: 2000, bytes: 1_500_000 };

export class ConflictoRemoto extends Error {
  constructor() {
    super('Otra pestaña o persona ha guardado cambios en el servidor desde que se abrió el espacio. No se ha sobrescrito nada: recupere lo guardado y repita la operación.');
  }
}
export class ErrorRemoto extends Error {}

const raiz = (d: BaseDatos) => Object.fromEntries(ESCALARES.map((k) => [k, d[k]]));

/** Diferencia por referencia entre dos estados (null = estado vacío del servidor). */
export function diferencia(antes: BaseDatos | null, despues: BaseDatos): Cambio[] {
  const out: Cambio[] = [];
  if (!antes || ESCALARES.some((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k]))) out.push({ c: '_raiz', id: 'raiz', v: raiz(despues) });
  for (const c of COLECCIONES) {
    const x = (antes?.[c] ?? {}) as Record<string, unknown>;
    const y = (despues[c] ?? {}) as Record<string, unknown>;
    if (x === y) continue;
    for (const k of Object.keys(y)) if (x[k] !== y[k]) out.push({ c, id: k, v: y[k] });
    for (const k of Object.keys(x)) if (!(k in y)) out.push({ c, id: k, v: null });
  }
  return out;
}

/** Reconstruye la base a partir de las entidades del servidor (`{ coleccion: { id: valor } }`). */
export function reconstruir(entidades: Record<string, Record<string, unknown>>): BaseDatos | null {
  const r = entidades._raiz?.raiz as Partial<BaseDatos> | undefined;
  if (!r) return null;
  const db = baseVacia() as unknown as Record<string, unknown>;
  for (const k of ESCALARES) if (k in r) db[k] = (r as Record<string, unknown>)[k];
  for (const c of COLECCIONES) db[c] = entidades[c] ?? {};
  return db as unknown as BaseDatos;
}

/**
 * JSON con las claves ordenadas: PostgreSQL (jsonb) no conserva el orden de las claves, así que la
 * comparación entre lo guardado y lo leído se hace sobre esta forma canónica.
 */
export function jsonCanonico(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map((v) => (v === undefined ? 'null' : jsonCanonico(v))).join(',')}]`;
  if (x && typeof x === 'object') return `{${Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${jsonCanonico((x as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(x) ?? 'null';
}

/** Reparte los cambios en partes que respetan los límites de petición. */
export function partir(cambios: Cambio[], lim = LIMITE_PARTE): Cambio[][] {
  const partes: Cambio[][] = [];
  let actual: Cambio[] = [];
  let bytes = 0;
  for (const x of cambios) {
    const b = JSON.stringify(x).length;
    if (actual.length && (actual.length >= lim.entidades || bytes + b > lim.bytes)) { partes.push(actual); actual = []; bytes = 0; }
    actual.push(x);
    bytes += b;
  }
  if (actual.length) partes.push(actual);
  return partes;
}

export interface InfoEspacioRemoto {
  espacioId: string;
  tipo: TipoEspacio;
  version: number;
  escrituraHabilitada: boolean;
  preparacionHabilitada?: boolean;
  rol: string;
  personaId: string;
}

export class AlmacenSupabase {
  info: InfoEspacioRemoto | null = null;
  constructor(readonly cliente: SupabaseClient, readonly espacioId: string) {}

  get version() { return this.info?.version ?? 0; }

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.cliente.rpc(fn, args);
    if (error) {
      if (error.code === 'PT409') throw new ConflictoRemoto();
      throw new ErrorRemoto(error.message.replace(/^ULIT Censo: /, ''));
    }
    return data as T;
  }

  /** Lee el espacio entero. `db` es null si aún no tiene contenido (espacio recién dado de alta). */
  async leer(): Promise<{ db: BaseDatos | null; info: InfoEspacioRemoto }> {
    const r = await this.rpc<{ espacioId: string; tipo: TipoEspacio; version: number; escrituraHabilitada: boolean; preparacionHabilitada?: boolean; rol: string; personaId: string; entidades: Record<string, Record<string, unknown>> }>('ulit_censo_leer', { p_espacio: this.espacioId });
    this.info = { espacioId: r.espacioId, tipo: r.tipo, version: Number(r.version), escrituraHabilitada: r.escrituraHabilitada, preparacionHabilitada: r.preparacionHabilitada ?? false, rol: r.rol, personaId: r.personaId };
    return { db: reconstruir(r.entidades), info: this.info };
  }

  /** Guarda lo que cambia de `antes` a `despues` con la versión esperada. Devuelve la nueva versión. */
  async guardar(antes: BaseDatos | null, despues: BaseDatos, etiqueta: string): Promise<number> {
    const cambios = diferencia(antes, despues);
    if (!cambios.length) return this.version;
    const partes = partir(cambios);
    let v: number;
    if (partes.length === 1) {
      v = await this.rpc<number>('ulit_censo_aplicar', { p_espacio: this.espacioId, p_version_esperada: this.version, p_etiqueta: etiqueta, p_cambios: cambios });
    } else {
      const lote = globalThis.crypto.randomUUID();
      for (const [i, p] of partes.entries()) await this.rpc('ulit_censo_lote_subir', { p_espacio: this.espacioId, p_lote: lote, p_parte: i, p_cambios: p });
      v = await this.rpc<number>('ulit_censo_lote_aplicar', { p_espacio: this.espacioId, p_lote: lote, p_partes: partes.length, p_version_esperada: this.version, p_etiqueta: etiqueta });
    }
    if (this.info) this.info.version = Number(v);
    return Number(v);
  }

  /**
   * Punto de recuperación obligatorio para la PRIMERA importación REAL.
   * Crea una copia privada en el servidor y comprueba que representa EXACTAMENTE
   * el estado que la aplicación acaba de leer, antes de enviar cambios.
   *
   * No habilita la escritura, no restaura y no afecta a otros espacios.
   * Si otro actor cambió la versión o los datos no coinciden, falla cerrado.
   */
  async asegurarRecuperacionAntesDeImportar(db: BaseDatos): Promise<{ id: string; version: number; sha256: string }> {
    const info = this.info;
    if (!info || info.espacioId !== this.espacioId || info.tipo !== 'real' || info.version !== 1 || info.preparacionHabilitada) {
      throw new ErrorRemoto('La copia previa requiere el espacio real en versión 1, sin preparación inicial activa.');
    }
    const version = info.version;
    const id = await this.crearCopia('Automática PREVIA a la primera incorporación real de Medina 2025');
    const meta = (await this.listarCopias()).find((c) => c.id === id);
    if (!meta || Number(meta.version) !== version || !/^[a-f0-9]{64}$/.test(meta.sha256)) {
      throw new ErrorRemoto('La copia del servidor no corresponde a la versión esperada; no se importa.');
    }
    const exportada = await this.descargarCopia(id);
    const contenido = exportada.contenido as { espacioId?: string; tipo?: TipoEspacio; version?: number; entidades?: Record<string, Record<string, unknown>> } | null;
    if (exportada.sha256 !== meta.sha256 || contenido?.espacioId !== this.espacioId || contenido?.tipo !== 'real' || Number(contenido?.version) !== version || !contenido?.entidades) {
      throw new ErrorRemoto('La copia del servidor carece de identidad, versión o integridad verificables; no se importa.');
    }
    const restaurada = reconstruir(contenido.entidades);
    if (!restaurada || jsonCanonico(restaurada) !== jsonCanonico(db)) {
      throw new ErrorRemoto('La copia recuperable no coincide con el estado que se pretende importar; no se modifica nada.');
    }
    return { id, version, sha256: meta.sha256 };
  }

  /**
   * ÚNICA operación autorizable en el espacio real v1.
   * El servidor exige una autorización administrativa temporal para ESTA cuenta,
   * SHA aprobado, 889 registros y copia recuperable intacta; escribe y vuelve a
   * cerrar dentro de UNA única transacción de PostgreSQL.
   *
   * NO utilizar guardar() (genérico) con datos reales, aunque alguien manipule
   * el estado del navegador: siempre debe intervenir el control servidor.
   */
  async importarPrimerHistorico2025(
    antes: BaseDatos, despues: BaseDatos, copia: { id: string; version: number; sha256: string },
  ): Promise<number> {
    const info = this.info;
    if (!info || info.espacioId !== this.espacioId || info.tipo !== 'real' || info.version !== 1 || info.preparacionHabilitada || info.escrituraHabilitada) {
      throw new ErrorRemoto('La importación histórica exige el espacio real cerrado en versión 1.');
    }
    if (copia.version !== 1 || !/^[a-f0-9]{64}$/.test(copia.sha256)) {
      throw new ErrorRemoto('Falta el punto de recuperación verificable de la versión inicial.');
    }
    const cambios = diferencia(antes, despues);
    const partes = partir(cambios);
    if (!partes.length || partes.length > 999) throw new ErrorRemoto('El lote histórico no tiene un tamaño admitido.');
    const lote = globalThis.crypto.randomUUID();
    for (const [i, parte] of partes.entries()) {
      await this.rpc('ulit_censo_lote_subir', { p_espacio: this.espacioId, p_lote: lote, p_parte: i, p_cambios: parte });
    }
    const version = await this.rpc<number>('ulit_censo_importar_historico_2025', {
      p_espacio: this.espacioId, p_lote: lote, p_partes: partes.length, p_version_esperada: 1, p_copia: copia.id,
    });
    if (Number(version) !== 2) throw new ErrorRemoto('La versión devuelta por el servidor no es la esperada tras incorporar.');
    // Comprobación posterior: se ha guardado exactamente lo planeado Y permanece cerrado.
    const verificado = await this.leer();
    if (verificado.info.version !== 2 || verificado.info.escrituraHabilitada || !verificado.db ||
        jsonCanonico(verificado.db) !== jsonCanonico(despues)) {
      throw new ErrorRemoto('La operación del servidor se ejecutó, pero la verificación posterior no coincide. No repetir; comprobar el estado antes de restaurar.');
    }
    return 2;
  }

  crearCopia(motivo: string) { return this.rpc<string>('ulit_censo_crear_copia', { p_espacio: this.espacioId, p_motivo: motivo }); }
  listarCopias() { return this.rpc<{ id: string; version: number; motivo: string; sha256: string; bytes: number; creada_en: string }[]>('ulit_censo_listar_copias', { p_espacio: this.espacioId }); }
  /** Exportación: el contenido de una copia con su SHA-256, para archivarla fuera de Supabase. */
  descargarCopia(id: string) { return this.rpc<{ copia: string; sha256: string; creadaEn: string; motivo: string; contenido: unknown }>('ulit_censo_descargar_copia', { p_espacio: this.espacioId, p_copia: id }); }
  async restaurarCopia(id: string, motivo: string): Promise<number> {
    const v = await this.rpc<number>('ulit_censo_restaurar_copia', { p_espacio: this.espacioId, p_copia: id, p_version_esperada: this.version, p_motivo: motivo });
    if (this.info) this.info.version = Number(v);
    return Number(v);
  }
}

/** Espacios del servidor a los que pertenece la cuenta con sesión iniciada. */
export async function misEspacios(cliente: SupabaseClient) {
  const { data, error } = await cliente.rpc('ulit_censo_mis_espacios');
  if (error) throw new ErrorRemoto(error.message);
  return (data ?? []) as { espacio_id: string; tipo: TipoEspacio; nombre: string; version: number; escritura_habilitada: boolean; rol: string; persona_id: string }[];
}
