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

  private async rpc<T>(fn: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const peticion = this.cliente.rpc(fn, args);
    const { data, error } = await (signal ? peticion.abortSignal(signal) : peticion);
    if (error) {
      if (error.code === 'PT409') throw new ConflictoRemoto();
      throw new ErrorRemoto(error.message.replace(/^ULIT Censo: /, ''));
    }
    return data as T;
  }

  /** Lee el espacio entero. `db` es null si aún no tiene contenido (espacio recién dado de alta). */
  async leer(signal?: AbortSignal): Promise<{ db: BaseDatos | null; info: InfoEspacioRemoto }> {
    const r = await this.rpc<{ espacioId: string; tipo: TipoEspacio; version: number; escrituraHabilitada: boolean; preparacionHabilitada?: boolean; rol: string; personaId: string; entidades: Record<string, Record<string, unknown>> }>('ulit_censo_leer', { p_espacio: this.espacioId }, signal);
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
    try {
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
    } catch (error) {
      // El servidor mantiene una carga rechazada como partes privadas. Borrarlas
      // únicamente para ESTE lote y ESTA cuenta; nunca restaurar automáticamente.
      // Si hubo un commit pero falló la red, el lote ya no existe: descartar es inocuo.
      await this.rpc<number>('ulit_censo_descartar_lote_2025', {
        p_espacio: this.espacioId, p_lote: lote,
      }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Única carga real de IT1 (2026): el SERVIDOR crea la copia íntegra v3,
   * autoriza exclusivamente el SHA comprobado y aplica el lote en UNA transacción.
   * No utiliza el guardar() genérico, ni abre escritura normal.
   */
  async importarIt1_2026(antes: BaseDatos, despues: BaseDatos, sha: string): Promise<number> {
    const esperado = '7a6d4230a68370cc0bb0245ce68e8c56648be4d89e76531cc0edbd9ab341da61';
    if (this.espacioId !== 'real-medina-del-campo-2026' || sha !== esperado)
      throw new ErrorRemoto('El archivo no corresponde al IT1 aprobado. No se ha escrito nada.');
    const { db: actual, info } = await this.leer();
    if (!actual || info.tipo !== 'real' || info.rol !== 'administrador' || info.version !== 3 ||
        info.escrituraHabilitada || info.preparacionHabilitada ||
        jsonCanonico(actual) !== jsonCanonico(antes)) {
      throw new ErrorRemoto('El espacio real cambió desde el análisis o no está cerrado en versión 3. No se ha escrito nada.');
    }
    const origen = Object.values(antes.importaciones).find((x) => x.campanaId === 'camp-hist-real-mun-medina-2025-9e367ca51c');
    const incorporada = Object.values(despues.importaciones).find((x) => x.campanaId === 'real-camp-medina-2026-censo-medina-del-campo-2026');
    const itinerario = Object.values(despues.itinerarios).find((x) => x.codigo === 'IT1');
    const nuevosReg = Object.values(despues.registros).filter((x) => x.importacionId === incorporada?.id);
    const nuevosVin = Object.values(despues.vinculos).filter((x) => nuevosReg.some((r) => x.origen.id === r.id));
    if (!origen || Object.keys(antes.registros).length !== 889 || Object.keys(antes.itinerarios).length !== 0 ||
        Object.keys(despues.registros).length !== 994 || Object.keys(despues.itinerarios).length !== 1 ||
        Object.keys(despues.locales).length !== 710 || incorporada?.filas !== 105 ||
        incorporada.huella !== esperado || incorporada.c1?.sha256 !== esperado ||
        incorporada.c1?.itinerario?.id !== itinerario?.id || nuevosReg.length !== 105 ||
        nuevosVin.length !== 105 || Object.keys(despues.campanas).length !== 2) {
      throw new ErrorRemoto('El plan de IT1 no coincide con las 105 filas y los 14 locales previstos. No se ha escrito nada.');
    }
    const cambios = diferencia(antes, despues);
    const permitidas = new Set(['itinerarios','importaciones','registros','vinculos','locales','negocios',
      'observaciones','ocupaciones','franquicias','digital','clasificaciones']);
    // siguienteOrden() actualiza la secuencia global: es la ÚNICA modificación
    // admitida de la raíz, sin tocar la identidad, permisos ni la configuración.
    const raizAntes = Object.fromEntries(ESCALARES.map((k) => [k, antes[k]]));
    const raizValida = (x: Cambio) => {
      if (x.c !== '_raiz' || x.id !== 'raiz' || !x.v || typeof x.v !== 'object') return false;
      const raizNueva = x.v as Record<string, unknown>;
      return Number.isSafeInteger(raizNueva.secuencia) &&
        Number(raizNueva.secuencia) > Number(antes.secuencia) &&
        jsonCanonico({ ...raizNueva, secuencia: raizAntes.secuencia }) === jsonCanonico(raizAntes);
    };
    if (cambios.some((x) => x.c === '_raiz' ? !raizValida(x) :
        !permitidas.has(x.c) || x.v == null ||
        !!(antes[x.c as keyof BaseDatos] as Record<string, unknown> | undefined)?.[x.id])) {
      throw new ErrorRemoto('La operación intenta cambiar datos existentes o colecciones ajenas al IT1. No se ha escrito nada.');
    }
    const partes = partir(cambios);
    if (!partes.length || partes.length > 40) throw new ErrorRemoto('El lote de IT1 excede el tamaño autorizado.');

    // Preparación por la propia cuenta ADMINISTRADORA: reserva permiso específico
    // y copia interna recuperable ANTES de que se suba ninguna parte del lote.
    const preparado = await this.rpc<{ copia: string; version: number }>('ulit_censo_preparar_it1_2026', {
      p_espacio: this.espacioId, p_sha: sha, p_version: 3,
    });
    if (preparado.version !== 3 || !preparado.copia) throw new ErrorRemoto('El servidor no ha emitido una copia previa válida.');
    const respaldo = await this.descargarCopia(preparado.copia);
    const contenido = respaldo.contenido as { espacioId?: string; tipo?: string; version?: number; entidades?: Record<string, Record<string, unknown>> } | null;
    if (contenido?.espacioId !== this.espacioId || contenido.tipo !== 'real' || contenido.version !== 3 ||
        !contenido.entidades || jsonCanonico(reconstruir(contenido.entidades)) !== jsonCanonico(antes)) {
      throw new ErrorRemoto('La copia recuperable no coincide con el estado anterior. No se importa IT1.');
    }

    const lote = globalThis.crypto.randomUUID();
    try {
      for (const [indice, parte] of partes.entries()) {
        await this.rpc<number>('ulit_censo_lote_subir', {
          p_espacio: this.espacioId, p_lote: lote, p_parte: indice, p_cambios: parte,
        });
      }
      const version = await this.rpc<number>('ulit_censo_importar_it1_2026', {
        p_espacio: this.espacioId, p_lote: lote, p_partes: partes.length,
        p_version_esperada: 3, p_copia: preparado.copia,
      });
      if (Number(version) !== 4) throw new ErrorRemoto('La versión de IT1 no es la prevista; no repetir la operación.');
      const { db: guardado, info: comprobacion } = await this.leer();
      if (!guardado || comprobacion.version !== 4 || comprobacion.escrituraHabilitada ||
          jsonCanonico(guardado) !== jsonCanonico(despues)) {
        throw new ErrorRemoto('El servidor respondió, pero falta verificar el estado. No repetir; consultar Supabase.');
      }
      return 4;
    } catch (error) {
      // No restaurar ni repetir: si hubo commit y falló la red se debe
      // verificar manualmente primero. Solo descartar partes propias.
      await this.rpc<number>('ulit_censo_descartar_lote_2025', {
        p_espacio: this.espacioId, p_lote: lote,
      }).catch(() => undefined);
      throw error;
    }
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
