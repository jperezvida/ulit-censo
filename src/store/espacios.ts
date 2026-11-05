import { create } from 'zustand';
import { createStore, get as idbGet, set as idbSet, type UseStore } from 'idb-keyval';
import { VERSION_DATOS, type BaseDatos } from '../domain/db';
import { migrarALaActual } from '../domain/migraciones';
import { PERFIL_ITINERARIO_28 } from '../domain/xlsx/perfilesImportacion';
import { BASE_INDEXEDDB, crearBaseEspacio, huellaBase, municipioDeEspacio, personaEspacio, PREFIJO, SHA256_ORIGINAL_MEDINA_2025, verificarEspacio, type TipoEspacio } from '../domain/espacios';
import { altaMunicipio, crearCampana, type DatosCampana, type DatosMunicipio } from '../domain/municipios';
import { aplicarIncorporacion, deshacerIncorporacion, type DecisionesIncorporacion, type DestinoIncorporacion, type PlanIncorporacion } from '../domain/incorporacion';
import { comprobarRespaldo, crearRespaldo, type Respaldo } from '../domain/respaldo';
import { cargarInstantaneaMedina } from '../data/callejero';
import type { ResultadoInterpretacion } from '../domain/xlsx/interpretacion';
import type { Id, Rol } from '../domain/types';
import { comprobarCandidatoMedina2025 } from '../domain/comprobarCandidatoMedina2025';
import { AlmacenSupabase } from './almacenSupabase';
import { clienteServidor } from './clienteSupabase';
import { guardarSeleccionRemota, type SeleccionRemota } from './seleccionRemota';

/**
 * C1e · Almacén de los ESPACIOS AISLADOS (ensayo y datos reales). Es independiente del store de la
 * demostración: otra base de IndexedDB por espacio (`ulit-censo-ensayo`, `ulit-censo-real`), otro estado
 * en memoria y otras reglas. La demostración nunca lee ni escribe aquí, ni este almacén allí.
 *
 * Garantías:
 * - nada se sobrescribe sin querer: crear un espacio exige que no exista; restaurar guarda antes una copia interna;
 * - cada escritura se VERIFICA: se vuelve a leer y se compara la huella SHA-256 del contenido; además,
 *   antes de escribir se comprueba que nadie (otra pestaña) haya cambiado el espacio desde que se abrió;
 * - toda base que se lee, se escribe o se restaura supera `verificarEspacio` (marca, prefijos, nada simulado);
 * - incorporar exige un respaldo externo COMPROBADO del estado actual, espacio suficiente y la vista previa revisada;
 * - en el espacio REAL, la confirmación está bloqueada en C1e-B hasta revisar juntos la vista previa.
 */

/**
 * C1e-B: la incorporación del censo AUTÉNTICO queda deshabilitada hasta que la Cátedra revise la vista
 * previa. Habilitarla exige un cambio de código autorizado (no hay ninguna forma de hacerlo desde la interfaz).
 */
export const CONFIRMACION_REAL_HABILITADA = false;

const CLAVE_DB = 'db';
const CLAVE_RESPALDO_INTERNO = 'respaldo-interno';
const CLAVE_VERIFICADO = 'respaldo-externo-verificado';

const almacenes: Partial<Record<TipoEspacio, UseStore>> = {};
const almacen = (t: TipoEspacio) => (almacenes[t] ??= createStore(BASE_INDEXEDDB[t], 'datos'));

export interface Almacenamiento {
  usado?: number;
  cuota?: number;
  /** El navegador se ha comprometido a no borrar estos datos por falta de espacio. */
  persistente?: boolean;
}

export interface RespaldoVerificado {
  /** Huella del contenido del respaldo comprobado (coincide con la base en ese momento). */
  huella: string;
  fecha: string;
  archivo: string;
}

export interface Requisito {
  id: 'persona' | 'vista-previa' | 'plan' | 'perfil' | 'respaldo' | 'espacio-disco' | 'archivo' | 'espacio' | 'confirmacion-real' | 'sin-guardar' | 'preflight-medina-2025';
  ok: boolean;
  /** Cumplido, pero con algo que revisar (no bloquea). */
  aviso?: boolean;
  texto: string;
}

interface Estado {
  tipo: TipoEspacio | null;
  db: BaseDatos | null;
  fase: 'cerrado' | 'cargando' | 'sin-crear' | 'listo' | 'error';
  error?: string;
  /** Huella del contenido tal como se leyó o se escribió por última vez (control de concurrencia). */
  huella: string | null;
  respaldoVerificado: RespaldoVerificado | null;
  almacenamiento: Almacenamiento | null;
  ocupado: string | null;
  /**
   * C1e-B · Análisis SIN GUARDAR: la base solo existe en memoria (callejero real y la persona que analiza).
   * Ninguna operación escribe en el navegador; al cerrar la pestaña no queda nada.
   */
  soloMemoria: boolean;
  /**
   * Persistencia REMOTA (Supabase, esquema `ulit_censo`). Null = IndexedDB de este navegador (demostración
   * aparte; ensayo local). Con un almacén remoto, todas las escrituras de este store van al servidor.
   */
  remoto: AlmacenSupabase | null;
  abrir: (tipo: TipoEspacio) => Promise<void>;
  /** Abre un espacio del servidor (la sesión de Supabase Auth ya iniciada en el cliente del almacén). */
  abrirRemoto: (almacen: AlmacenSupabase) => Promise<void>;
  /** Vuelve a leer el espacio abierto desde donde se guarda (IndexedDB o servidor). */
  reabrir: () => Promise<void>;
  /**
   * Tras recargar la página: vuelve a abrir el espacio del servidor elegido en esta pestaña con la sesión de
   * Supabase Auth. Sin sesión o sin conexión configurada, queda en error: nunca abre IndexedDB en su lugar.
   */
  restaurarRemoto: (sel: SeleccionRemota) => Promise<void>;
  abrirEnMemoria: (tipo: TipoEspacio, persona: { nombre: string; roles: Rol[] }) => Promise<{ ok: boolean; error?: string }>;
  cerrar: () => void;
  /** `incluirMedina` (G3): Medina del Campo con su callejero OSM es opcional (por defecto, sí). */
  crear: (persona: { nombre: string; roles: Rol[] }, opciones?: { incluirMedina?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  medirAlmacenamiento: () => Promise<Almacenamiento>;
  solicitarPersistencia: () => Promise<boolean>;
  prepararRespaldo: () => Respaldo;
  /** Comprueba un archivo de respaldo; si coincide con la base actual, queda registrado como respaldo verificado. */
  verificarRespaldo: (texto: string, archivo: string) => Promise<{ ok: boolean; coincide?: boolean; error?: string }>;
  restaurar: (texto: string) => Promise<{ ok: boolean; error?: string }>;
  incorporar: (p: { resultado: ResultadoInterpretacion; destino: DestinoIncorporacion; decisiones: DecisionesIncorporacion; plan: PlanIncorporacion; requisitos: Requisito[] }) => Promise<{ ok: boolean; error?: string; importacionId?: Id; campanaId?: Id; creadas?: Record<string, number> }>;
  deshacer: (importacionId: Id) => Promise<{ ok: boolean; error?: string }>;
  /** G2 · Alta de un municipio (sin callejero) en el espacio abierto. */
  altaMunicipio: (d: DatosMunicipio) => Promise<{ ok: boolean; error?: string; municipioId?: Id }>;
  /** G2 · Campaña nueva (histórica u operativa) de un municipio del espacio. */
  crearCampana: (d: DatosCampana) => Promise<{ ok: boolean; error?: string; campanaId?: Id }>;
  /**
   * G3 · Cambio de configuración del espacio (callejero: cargas, altas, validaciones, alias, referencias),
   * guardado con escritura VERIFICADA. `cambio` recibe la base, el prefijo del espacio y la persona responsable.
   */
  modificar: (mensaje: string, cambio: (db: BaseDatos, ctx: { prefijo: string; porId: Id }) => BaseDatos) => Promise<{ ok: boolean; error?: string }>;
}

const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MiB = 1024 * 1024;

/** Escritura VERIFICADA: comprueba que nadie haya cambiado el espacio, escribe, vuelve a leer y compara. */
async function escribirVerificado(tipo: TipoEspacio, db: BaseDatos, huellaEsperadaAntes: string | null): Promise<string> {
  const problemas = verificarEspacio(db, tipo);
  if (problemas.length) throw new Error(`La base no supera la verificación del espacio: ${problemas[0]}`);
  const st = almacen(tipo);
  const actual = await idbGet<BaseDatos>(CLAVE_DB, st);
  if ((actual ? huellaBase(actual) : null) !== huellaEsperadaAntes) {
    throw new Error('El espacio ha cambiado en el almacenamiento desde que se abrió (¿otra pestaña?). Vuelva a abrirlo; no se ha escrito nada.');
  }
  const h = huellaBase(db);
  await idbSet(CLAVE_DB, db, st);
  const leido = await idbGet<BaseDatos>(CLAVE_DB, st);
  if (!leido || huellaBase(leido) !== h) {
    // Lo escrito no es lo esperado: se intenta dejar el almacenamiento como estaba.
    if (actual) await idbSet(CLAVE_DB, actual, st).catch(() => undefined);
    throw new Error('La comprobación tras guardar ha fallado (lo leído no coincide con lo escrito). Se ha restablecido el estado anterior.');
  }
  return h;
}

/**
 * Guarda el nuevo estado donde corresponda: en el servidor (solo las entidades cambiadas, con la versión
 * esperada; un conflicto no sobrescribe nada) o en IndexedDB con escritura verificada. Devuelve la huella.
 */
async function persistir(get: () => Estado, tipo: TipoEspacio, antes: BaseDatos | null, db: BaseDatos, huellaAntes: string | null, etiqueta: string): Promise<string> {
  const remoto = get().remoto;
  if (!remoto) return escribirVerificado(tipo, db, huellaAntes);
  const problemas = verificarEspacio(db, tipo);
  if (problemas.length) throw new Error(`La base no supera la verificación del espacio: ${problemas[0]}`);
  if (db.meta?.espacioId !== remoto.espacioId) {
    throw new Error('El identificador interno del espacio no coincide con el servidor: no se guarda.');
  }
  if (!remoto.info) throw new Error('El espacio remoto no tiene una sesión validada.');
  // Defensa adicional al cierre de escritura del servidor. No habilitar datos reales
  // desde la interfaz: solo Supabase puede activar escritura_habilitada tras autorización.
  if (tipo === 'real' && !remoto.info.escrituraHabilitada) {
    throw new Error('El espacio real está en solo lectura: Supabase no tiene habilitada su escritura.');
  }
  // Hasta el trabajo con varias personas (2027), solo la persona responsable del espacio escribe desde aquí.
  if (remoto.info && personaEspacio(db)?.id !== remoto.info.personaId) {
    throw new Error(`Esta cuenta representa a «${remoto.info.personaId}», no a la persona responsable del espacio: no se guarda.`);
  }
  await remoto.guardar(antes, db, etiqueta);
  return huellaBase(db);
}

/** Evalúa los requisitos para incorporar (puros: se muestran en pantalla y se vuelven a comprobar al confirmar). */
export function requisitosIncorporacion(p: {
  tipo: TipoEspacio; db: BaseDatos; huella: string | null; respaldoVerificado: RespaldoVerificado | null; almacenamiento: Almacenamiento | null;
  plan: PlanIncorporacion | null; vistaPreviaRevisada: boolean; sintetico: boolean; soloMemoria?: boolean;
}): Requisito[] {
  const persona = personaEspacio(p.db);
  const autorizada = !!persona && (persona.roles.includes('coordinador') || persona.roles.includes('administrador'));
  const tamano = JSON.stringify(p.db).length * 2;
  const libre = p.almacenamiento?.cuota !== undefined && p.almacenamiento.usado !== undefined ? p.almacenamiento.cuota - p.almacenamiento.usado : undefined;
  // Margen: la base nueva (estimada) más la copia interna, con holgura.
  const necesario = Math.max(50 * MiB, tamano * 4);
  const problemasEspacio = verificarEspacio(p.db, p.tipo);
  const sha = p.plan?.archivo.sha256;
  const r: Requisito[] = [
    { id: 'espacio', ok: problemasEspacio.length === 0, texto: problemasEspacio.length ? `El espacio no supera la verificación: ${problemasEspacio[0]}` : 'Espacio verificado: aislado de la demostración y sin datos simulados.' },
    { id: 'persona', ok: autorizada, texto: autorizada ? `Confirma: ${persona!.nombre} (coordinación).` : 'La persona responsable del espacio debe tener el rol de coordinación o administración.' },
    { id: 'plan', ok: !!p.plan?.aplicable, texto: !p.plan ? 'Falta analizar el archivo.' : p.plan.aplicable ? 'Plan aplicable, sin bloqueos.' : `Plan bloqueado: ${p.plan.bloqueos[0]?.mensaje ?? ''}` },
    {
      id: 'perfil',
      // G1: cualquier perfil de CENSO histórico (de referencia o creado con la correspondencia de columnas);
      // los itinerarios de campo 2026 no se importan como histórico. G2: en la campaña histórica elegida.
      // G4: un Excel de itinerario se incorpora en su campaña OPERATIVA (con cualquier perfil).
      ok: !p.plan || p.plan.modo === 'operativo' || p.plan.perfil.id !== PERFIL_ITINERARIO_28.id,
      texto: p.plan?.modo === 'operativo'
        ? `Excel del itinerario ${p.plan.destino.itinerario?.codigo} (perfil «${p.plan.perfil.id}») en la campaña operativa «${p.plan.destino.nombre}» (${p.plan.destino.anio}).`
        : !p.plan || p.plan.perfil.id !== PERFIL_ITINERARIO_28.id
          ? `Censo histórico (perfil «${p.plan?.perfil.id ?? '—'}») en la campaña histórica «${p.plan?.destino.nombre ?? '—'}» (${p.plan?.destino.anio ?? '—'}).`
          : 'Un Excel de itinerario se incorpora en su campaña operativa (elija «Itinerario de una campaña operativa» en el destino), no como censo histórico.',
    },
    {
      id: 'archivo',
      ok: p.tipo === 'real' ? !p.sintetico : sha !== SHA256_ORIGINAL_MEDINA_2025,
      aviso: p.tipo === 'real' && !p.sintetico && !!sha && sha !== SHA256_ORIGINAL_MEDINA_2025,
      texto: p.tipo === 'real'
        ? (p.sintetico ? 'Es un archivo SINTÉTICO: no se incorpora al espacio de datos reales.' : sha === SHA256_ORIGINAL_MEDINA_2025 ? 'Archivo auténtico: su SHA-256 coincide con el del diagnóstico agregado.' : 'Atención: el SHA-256 no coincide con el del diagnóstico agregado (¿otra versión del archivo?). Revíselo antes de continuar.')
        : (sha === SHA256_ORIGINAL_MEDINA_2025 ? 'Es el archivo AUTÉNTICO: no se usa en el ensayo (use el espacio de datos reales).' : 'Archivo de ensayo (no es el auténtico).'),
    },
    { id: 'vista-previa', ok: p.vistaPreviaRevisada, texto: p.vistaPreviaRevisada ? 'Vista previa revisada.' : 'Revise la vista previa completa y márquela como revisada.' },
    {
      id: 'respaldo',
      ok: !!p.respaldoVerificado && p.respaldoVerificado.huella === p.huella,
      texto: !p.respaldoVerificado ? 'Falta un respaldo externo comprobado del estado actual.' : p.respaldoVerificado.huella === p.huella ? `Respaldo externo comprobado del estado actual (${p.respaldoVerificado.archivo}).` : 'El último respaldo comprobado no corresponde al estado actual: haga y compruebe uno nuevo.',
    },
    {
      id: 'espacio-disco',
      ok: libre === undefined ? true : libre >= necesario,
      aviso: libre === undefined,
      texto: libre === undefined ? 'El navegador no informa del espacio disponible: la escritura se verificará al guardar.' : libre >= necesario ? `Espacio disponible suficiente (${Math.round(libre / MiB)} MB libres).` : `Espacio insuficiente: ${Math.round(libre / MiB)} MB libres; hacen falta al menos ${Math.round(necesario / MiB)} MB.`,
    },
  ];
  if (p.soloMemoria) {
    r.push({ id: 'sin-guardar', ok: false, texto: 'Análisis SIN GUARDAR (C1e-B): solo vista previa; no se incorpora ni se guarda nada.' });
    return r.filter((x) => x.id !== 'respaldo' && x.id !== 'espacio-disco');
  }
  if (p.tipo === 'real') {
    if (p.plan) {
      const errores = comprobarCandidatoMedina2025(p.db.meta.espacioId, p.plan);
      r.push({ id: 'preflight-medina-2025', ok: errores.length === 0,
        texto: errores.length ? `Preflight de Medina 2025 no superado: ${errores.join(' ')}` : 'Preflight de Medina 2025: espacio, SHA-256, periodo y 889 registros sin exclusiones comprobados (no autoriza escritura).',
      });
    }
    r.push({ id: 'confirmacion-real', ok: CONFIRMACION_REAL_HABILITADA, texto: CONFIRMACION_REAL_HABILITADA ? 'Confirmación real habilitada.' : 'C1e-B: la confirmación de la incorporación real está BLOQUEADA hasta revisar juntos la vista previa. No se incorporará nada.' });
  }
  return r;
}

export const useEspacios = create<Estado>((set, get) => ({
  tipo: null, db: null, fase: 'cerrado', huella: null, respaldoVerificado: null, almacenamiento: null, ocupado: null, soloMemoria: false, remoto: null,

  abrirRemoto: async (almacen) => {
    set({ tipo: null, db: null, fase: 'cargando', error: undefined, huella: null, respaldoVerificado: null, soloMemoria: false, remoto: almacen });
    try {
      const { db: leido, info } = await almacen.leer();
      set({ tipo: info.tipo });
      guardarSeleccionRemota({ espacioId: almacen.espacioId, tipo: info.tipo });
      if (!leido) return set({ fase: 'sin-crear' });
      if (leido.meta?.espacioId !== almacen.espacioId) {
        return set({ fase: 'error', error: 'El identificador interno del espacio no coincide con el servidor. No se abre.' });
      }
      let db = leido;
      if (db.version !== VERSION_DATOS) {
        if (db.version === 9 || db.version === 10) db = migrarALaActual(db).db;
        else return set({ fase: 'error', error: `Versión de datos no compatible (v${db.version}).` });
      }
      const problemas = verificarEspacio(db, info.tipo);
      if (problemas.length) return set({ fase: 'error', error: `No se abre: ${problemas.slice(0, 3).join(' · ')}` });
      // La migración del modelo se guarda al primer cambio: la base remota de partida es la leída.
      set({ db, huella: huellaBase(db), fase: 'listo' });
    } catch (e) {
      set({ fase: 'error', error: texto(e) });
    }
  },

  restaurarRemoto: async (sel) => {
    set({ tipo: sel.tipo, db: null, fase: 'cargando', error: undefined, huella: null, respaldoVerificado: null, soloMemoria: false, remoto: null });
    const fallo = (m: string) => set({ fase: 'error', error: `${m} No se ha abierto el espacio guardado en este navegador.` });
    try {
      const cliente = clienteServidor();
      if (!cliente) return fallo('Este espacio está en el servidor, pero esta versión no tiene configurada la conexión.');
      const { data } = await cliente.auth.getSession();
      if (!data.session) return fallo('La sesión del servidor ha terminado: vuelva al selector de espacios e inicie sesión de nuevo.');
      await get().abrirRemoto(new AlmacenSupabase(cliente, sel.espacioId));
      if (get().tipo !== sel.tipo) fallo('El espacio del servidor no es del tipo indicado en la dirección.');
    } catch (e) {
      fallo(texto(e));
    }
  },

  reabrir: async () => {
    const { remoto, tipo } = get();
    if (remoto) return get().abrirRemoto(remoto);
    if (tipo) return get().abrir(tipo);
  },

  abrir: async (tipo) => {
    set({ tipo, db: null, fase: 'cargando', error: undefined, huella: null, respaldoVerificado: null, soloMemoria: false, remoto: null });
    try {
      const st = almacen(tipo);
      let db = await idbGet<BaseDatos>(CLAVE_DB, st);
      const verificado = (await idbGet<RespaldoVerificado>(CLAVE_VERIFICADO, st)) ?? null;
      void get().medirAlmacenamiento();
      if (!db) return set({ fase: 'sin-crear' });
      const huella = huellaBase(db);
      if (db.version !== VERSION_DATOS) {
        if (db.version === 9 || db.version === 10) db = migrarALaActual(db).db;
        else return set({ fase: 'error', error: `Versión de datos no compatible (v${db.version}).` });
      }
      const problemas = verificarEspacio(db, tipo);
      if (problemas.length) return set({ fase: 'error', error: `No se abre: ${problemas.slice(0, 3).join(' · ')}` });
      set({ db, huella, respaldoVerificado: verificado, fase: 'listo' });
    } catch (e) {
      set({ fase: 'error', error: texto(e) });
    }
  },

  cerrar: () => set({ tipo: null, db: null, fase: 'cerrado', huella: null, respaldoVerificado: null, error: undefined, soloMemoria: false, remoto: null }),

  abrirEnMemoria: async (tipo, persona) => {
    set({ tipo, db: null, fase: 'cargando', error: undefined, huella: null, respaldoVerificado: null, soloMemoria: true, remoto: null });
    try {
      const inst = await cargarInstantaneaMedina();
      if (!inst.ok) {
        set({ fase: 'error', error: 'Hace falta el callejero real de Medina del Campo (instantánea OSM del proyecto).' });
        return { ok: false, error: 'Falta el callejero real.' };
      }
      // Solo en memoria: no se lee ni se escribe ninguna base del navegador.
      const base = crearBaseEspacio(tipo, { persona, calles: inst.calles, detalleCallejero: inst.detalle, espacioId: `memoria-${Date.now().toString(36)}` });
      // G2: destino de la vista previa, una campaña histórica 2025 de Medina que tampoco se guarda.
      const { db } = crearCampana(base, { municipioId: municipioDeEspacio(tipo), anio: 2025, nombre: 'Censo 2025 · histórico (vista previa sin guardar)', clase: 'historica' }, { prefijo: PREFIJO[tipo], porId: personaEspacio(base)!.id });
      set({ db, fase: 'listo' });
      return { ok: true };
    } catch (e) {
      set({ fase: 'error', error: texto(e) });
      return { ok: false, error: texto(e) };
    }
  },

  crear: async (persona, opciones = {}) => {
    if (get().soloMemoria) return { ok: false, error: 'Análisis sin guardar: no se escribe nada en el navegador.' };
    const { tipo } = get();
    if (!tipo) return { ok: false, error: 'No hay espacio seleccionado.' };
    set({ ocupado: 'Creando el espacio…' });
    try {
      const remoto = get().remoto;
      if (remoto ? remoto.version > 0 : await idbGet(CLAVE_DB, almacen(tipo))) return { ok: false, error: 'El espacio ya existe: no se sobrescribe.' };
      if (remoto?.info?.preparacionHabilitada && opciones.incluirMedina === false) {
        return { ok: false, error: 'La preparación real exige incluir Medina del Campo y su callejero OSM.' };
      }
      const conMedina = opciones.incluirMedina !== false;
      const inst = conMedina ? await cargarInstantaneaMedina() : null;
      if (inst && !inst.ok) return { ok: false, error: `Hace falta el callejero real de Medina del Campo (instantánea OSM del proyecto). ${inst.motivo ?? ''}`.trim() };
      const espacioId = remoto?.espacioId ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
      const db = crearBaseEspacio(tipo, { persona, calles: inst?.ok ? inst.calles : [], detalleCallejero: inst?.ok ? inst.detalle : '', espacioId, personaId: remoto?.info?.personaId, incluirMedina: conMedina });
      const huella = await persistir(get, tipo, null, db, null, 'Creación del espacio');
      if (remoto?.info?.preparacionHabilitada) {
        // La RPC cierra la autorización de inicialización en la misma transacción.
        // La recarga evita mostrar permisos de escritura caducados después del primer guardado.
        try {
          await remoto.leer();
        } catch {
          if (remoto.info) {
            remoto.info.escrituraHabilitada = false;
            remoto.info.preparacionHabilitada = false;
          }
        }
      }
      set({ db, huella, fase: 'listo', respaldoVerificado: null });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: texto(e) };
    } finally {
      set({ ocupado: null });
    }
  },

  medirAlmacenamiento: async () => {
    const s = globalThis.navigator?.storage;
    const a: Almacenamiento = {};
    try {
      const e = await s?.estimate?.();
      if (e?.quota !== undefined) Object.assign(a, { cuota: e.quota, usado: e.usage ?? 0 });
      if (s?.persisted) a.persistente = await s.persisted();
    } catch {
      /* el navegador no informa */
    }
    set({ almacenamiento: a });
    return a;
  },

  solicitarPersistencia: async () => {
    try {
      const ok = (await globalThis.navigator?.storage?.persist?.()) ?? false;
      await get().medirAlmacenamiento();
      return ok;
    } catch {
      return false;
    }
  },

  prepararRespaldo: () => {
    if (get().soloMemoria) throw new Error('Análisis sin guardar: no hay nada que respaldar.');
    const { db, tipo } = get();
    if (!db || !tipo) throw new Error('No hay espacio abierto.');
    return crearRespaldo(db, tipo);
  },

  verificarRespaldo: async (contenido, archivo) => {
    if (get().soloMemoria) return { ok: false, error: 'Análisis sin guardar: no se escribe nada en el navegador.' };
    const { db, tipo, huella } = get();
    if (!db || !tipo) return { ok: false, error: 'No hay espacio abierto.' };
    const c = comprobarRespaldo(contenido, tipo);
    if (!c.ok) return { ok: false, error: c.motivo };
    const coincide = huellaBase(c.db) === huella;
    if (coincide) {
      const v: RespaldoVerificado = { huella: huella!, fecha: new Date().toISOString(), archivo };
      try {
        // En un espacio remoto la comprobación vale para esta sesión: no se escribe en el navegador.
        if (!get().remoto) await idbSet(CLAVE_VERIFICADO, v, almacen(tipo));
      } catch (e) {
        return { ok: false, error: `El respaldo es correcto, pero no se ha podido registrar la comprobación: ${texto(e)}` };
      }
      set({ respaldoVerificado: v });
    }
    return { ok: true, coincide };
  },

  restaurar: async (contenido) => {
    if (get().soloMemoria) return { ok: false, error: 'Análisis sin guardar: no se escribe nada en el navegador.' };
    const { tipo, db, huella } = get();
    if (!tipo) return { ok: false, error: 'No hay espacio abierto.' };
    const c = comprobarRespaldo(contenido, tipo);
    if (!c.ok) return { ok: false, error: c.motivo };
    if (db && c.db.meta.espacioId !== db.meta.espacioId) {
      return { ok: false, error: 'El respaldo es de OTRO espacio del mismo tipo (otro identificador de espacio). Por seguridad no se mezcla con el actual.' };
    }
    set({ ocupado: 'Restaurando el respaldo…' });
    try {
      const remoto = get().remoto;
      if (remoto) await remoto.crearCopia('Automática antes de restaurar un respaldo externo');
      else if (db) await idbSet(CLAVE_RESPALDO_INTERNO, { db, fecha: new Date().toISOString(), motivo: 'Antes de restaurar un respaldo externo' }, almacen(tipo));
      const h = await persistir(get, tipo, db, c.db, huella, 'Restauración de un respaldo externo');
      set({ db: c.db, huella: h, fase: 'listo' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: texto(e) };
    } finally {
      set({ ocupado: null });
    }
  },

  incorporar: async ({ resultado, destino, decisiones, plan, requisitos }) => {
    if (get().soloMemoria) return { ok: false, error: 'Análisis sin guardar: no se escribe nada en el navegador.' };
    const { tipo, db, huella, ocupado } = get();
    if (!tipo || !db) return { ok: false, error: 'No hay espacio abierto.' };
    if (ocupado) return { ok: false, error: 'Ya hay una operación en curso.' };
    const pendientes = requisitos.filter((r) => !r.ok);
    if (pendientes.length) return { ok: false, error: `No se incorpora nada: ${pendientes.map((r) => r.texto).join(' ')}` };
    // Doble seguro en el espacio real (C1e-B), independiente de lo que muestre la interfaz.
    if (tipo === 'real' && !CONFIRMACION_REAL_HABILITADA) return { ok: false, error: 'C1e-B: la incorporación real está bloqueada hasta revisar la vista previa.' };
    if (tipo === 'real') {
      if (!get().remoto?.info?.escrituraHabilitada) return { ok: false, error: 'Supabase no autoriza escrituras en el espacio real.' };
      const errores = comprobarCandidatoMedina2025(db.meta.espacioId, plan, { filas: resultado.original.filas.length, columnas: resultado.original.columnas.length });
      if (errores.length) return { ok: false, error: `Preflight de importación real fallido: ${errores.join(' ')}` };
    }
    if (!db.municipios[destino.municipioId]) return { ok: false, error: 'El destino no es un municipio de este espacio.' };
    set({ ocupado: 'Incorporando…' });
    try {
      const persona = personaEspacio(db)!;
      const r = aplicarIncorporacion(db, resultado, destino, decisiones, plan, { porId: persona.id });
      if (r.sinCambios) return { ok: false, error: 'Este archivo ya estaba incorporado: no se ha duplicado nada.' };
      const h = await persistir(get, tipo, db, r.db, huella, `Incorporación de ${plan.archivo.nombre}`);
      set({ db: r.db, huella: h });
      return { ok: true, importacionId: r.importacionId, campanaId: r.campanaId, creadas: r.creadas };
    } catch (e) {
      return { ok: false, error: `No se ha incorporado nada. ${texto(e)}` };
    } finally {
      set({ ocupado: null });
    }
  },

  deshacer: async (importacionId) => {
    if (get().soloMemoria) return { ok: false, error: 'Análisis sin guardar: no se escribe nada en el navegador.' };
    const { tipo, db, huella } = get();
    if (!tipo || !db) return { ok: false, error: 'No hay espacio abierto.' };
    set({ ocupado: 'Deshaciendo…' });
    try {
      const nueva = deshacerIncorporacion(db, importacionId, personaEspacio(db)!.id);
      const h = await persistir(get, tipo, db, nueva, huella, 'Deshacer una incorporación');
      set({ db: nueva, huella: h });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: texto(e) };
    } finally {
      set({ ocupado: null });
    }
  },

  altaMunicipio: async (d) => {
    const r = await guardarCambio(get, set, 'Dando de alta el municipio…', (db, tipo) => {
      const x = altaMunicipio(db, d, { prefijo: PREFIJO[tipo], porId: personaEspacio(db)!.id });
      return { db: x.db, id: x.municipioId };
    });
    return r.ok ? { ok: true, municipioId: r.id } : r;
  },

  modificar: async (mensaje, cambio) => {
    const r = await guardarCambio(get, set, mensaje, (db, tipo) => ({ db: cambio(db, { prefijo: PREFIJO[tipo], porId: personaEspacio(db)!.id }), id: '' }));
    return r.ok ? { ok: true } : r;
  },

  crearCampana: async (d) => {
    const r = await guardarCambio(get, set, 'Creando la campaña…', (db, tipo) => {
      const x = crearCampana(db, d, { prefijo: PREFIJO[tipo], porId: personaEspacio(db)!.id });
      return { db: x.db, id: x.campanaId };
    });
    return r.ok ? { ok: true, campanaId: r.id } : r;
  },
}));

/**
 * G2 · Aplica un cambio de configuración (municipio o campaña) al espacio abierto y lo guarda con
 * escritura VERIFICADA. En el análisis sin guardar (C1e-B) el cambio se queda solo en memoria.
 */
async function guardarCambio(
  get: () => Estado, set: (p: Partial<Estado>) => void, mensaje: string, cambio: (db: BaseDatos, tipo: TipoEspacio) => { db: BaseDatos; id: Id },
): Promise<{ ok: true; id: Id } | { ok: false; error: string }> {
  const { tipo, db, huella, ocupado, soloMemoria } = get();
  if (!tipo || !db) return { ok: false, error: 'No hay espacio abierto.' };
  if (ocupado) return { ok: false, error: 'Ya hay una operación en curso.' };
  set({ ocupado: mensaje });
  try {
    const r = cambio(db, tipo);
    if (soloMemoria) {
      set({ db: r.db });
      return { ok: true, id: r.id };
    }
    const h = await persistir(get, tipo, db, r.db, huella, mensaje.replace(/…$/, ''));
    set({ db: r.db, huella: h });
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: texto(e) };
  } finally {
    set({ ocupado: null });
  }
}
