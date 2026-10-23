import { create } from 'zustand';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { VERSION_DATOS, type BaseDatos } from '../domain/db';
import { migrarALaActual } from '../domain/migraciones';
import type { Id, Rol } from '../domain/types';
import { cargarCallejeroMedina, cargarInstantaneaMedina } from '../data/callejero';
import { generarDemo } from '../data/semilla';

const CLAVE_DB = 'ulit-censo:demo-db';
/**
 * Copia de seguridad de la demostración. Se escribe (y se comprueba) ANTES de cualquier sustitución de los
 * datos guardados: «Restablecer demo», el paso al callejero real o la recuperación de la copia anterior.
 */
const CLAVE_RESPALDO = 'ulit-censo:demo-db:respaldo';

export interface Respaldo {
  db: BaseDatos;
  fecha: string;
  motivo: string;
}
export type InfoRespaldo = Omit<Respaldo, 'db'> & { fuenteCallejero?: string };
const infoRespaldo = (r: Respaldo): InfoRespaldo => ({ fecha: r.fecha, motivo: r.motivo, fuenteCallejero: r.db.meta?.fuenteCallejero });

/** Guarda la copia y la vuelve a leer: si no se puede comprobar, lanza y no se sustituye nada. */
async function respaldar(db: BaseDatos, motivo: string): Promise<InfoRespaldo> {
  const r: Respaldo = { db, fecha: new Date().toISOString(), motivo };
  await idbSet(CLAVE_RESPALDO, r);
  const leido = await idbGet<Respaldo>(CLAVE_RESPALDO);
  if (!leido || leido.fecha !== r.fecha || leido.db?.version !== db.version) throw new Error('no se pudo comprobar la copia de seguridad');
  return infoRespaldo(r);
}
const CLAVE_PREFS = 'ulit-censo:prefs';

export interface Prefs {
  municipioId: Id;
  campanaId: Id;
  roles: Rol[];
  personaId: Id; // usuario de escritorio (demo)
  campoPersonaId: Id; // investigador en la app de campo (demo)
  sinConexion: boolean;
  modoSol: boolean;
  guiaAbierta: boolean;
  /** Preferencias de Oficina de cada persona (modo de trabajo y columnas por tarea). */
  oficina: Record<Id, PrefsOficina>;
}

export type ModoOficina = 'tareas' | 'establecimiento';
export interface PrefsOficina {
  modo: ModoOficina;
  /** Por tarea: columnas visibles (en orden) y columnas fijadas a la izquierda. */
  columnas?: Record<string, { visibles: string[]; fijas: string[] }>;
  /** Clasificaciones usadas recientemente, por catálogo (más reciente primero). Solo desempatan. */
  recientesActividad?: Record<string, string[]>;
  /** Número de usos por clasificación y catálogo (no indica corrección). */
  usosActividad?: Record<string, Record<string, number>>;
  /** Por tarea: mostrar las columnas de referencia de la campaña anterior junto a las actuales. */
  comparar?: Record<string, boolean>;
}

const PREFS_INICIALES: Prefs = {
  municipioId: 'mun-medina',
  campanaId: 'camp-medina-2026',
  roles: ['coordinador', 'revisor'],
  personaId: 'p-elena',
  campoPersonaId: 'p-ana',
  sinConexion: false,
  modoSol: false,
  guiaAbierta: false,
  oficina: {},
};

function leerPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(CLAVE_PREFS);
    return raw ? { ...PREFS_INICIALES, ...JSON.parse(raw) } : PREFS_INICIALES;
  } catch {
    return PREFS_INICIALES;
  }
}

export interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'info' | 'error';
  deshacer?: boolean;
}

interface Estado {
  db: BaseDatos | null;
  carga: { fase: 'inicio' | 'cargando' | 'lista' | 'error'; mensaje: string };
  prefs: Prefs;
  pilaDeshacer: { db: BaseDatos; etiqueta: string }[];
  /** Operaciones deshechas que pueden rehacerse (se vacía con cada operación nueva). */
  pilaRehacer: { db: BaseDatos; etiqueta: string }[];
  /** Momento del último guardado local (para el indicador de guardado). */
  guardado: { estado: 'guardado' | 'pendiente' | 'error'; momento?: number };
  avisos: Aviso[];
  /**
   * Callejero real (instantánea OSM del proyecto) disponible mientras la demostración guardada usa el
   * simulado. No se aplica solo: la persona decide si cambia (con copia de seguridad previa).
   */
  callejeroReal: { detalle: string } | null;
  /** Copia de seguridad disponible para recuperar la demostración anterior. */
  respaldo: InfoRespaldo | null;
  inicializar: (forzar?: boolean) => Promise<void>;
  /** Busca la instantánea OSM del proyecto (sin red externa) si la demostración guardada usa el callejero simulado. */
  comprobarCallejeroReal: () => Promise<void>;
  /** Copia de seguridad comprobada y nueva demostración sobre el callejero real; negocios y portales, ficticios. */
  cambiarACallejeroReal: () => Promise<{ ok: boolean; error?: string }>;
  /** Recupera la copia de seguridad; la demostración actual pasa a ser la copia (no se pierde ninguna). */
  restaurarRespaldo: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Aplica una operación de dominio como UN paso deshacible. Con `silencioso` no se muestra el
   * aviso de éxito; con `sinAvisoError` el error lo presenta quien llama (p. ej. la tabla).
   */
  aplicar: (fn: (db: BaseDatos) => BaseDatos, etiqueta: string, opciones?: { silencioso?: boolean; sinAvisoError?: boolean }) => boolean;
  /**
   * Operación con deshacer PROPIO y trazado (incorporación de un censo, su deshacer o el reinicio del
   * escenario ficticio): se aplica, se guarda de inmediato comprobando el resultado y vacía el
   * historial de Ctrl+Z, para que un Ctrl+Z no la revierta sin sus comprobaciones.
   * Devuelve si se aplicó y si se guardó; el error se devuelve a quien llama (no se muestra aviso).
   */
  aplicarConGuardado: (fn: (db: BaseDatos) => BaseDatos, etiqueta: string) => Promise<{ aplicado: boolean; guardado: boolean; error?: string }>;
  /** Vuelve a escribir en el navegador la versión vigente en memoria (sin repetir ninguna operación). */
  reintentarGuardado: () => Promise<{ guardado: boolean; error?: string }>;
  deshacer: () => void;
  rehacer: () => void;
  setPrefsOficina: (personaId: Id, p: Partial<PrefsOficina>) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  avisar: (texto: string, tipo?: Aviso['tipo'], deshacer?: boolean) => void;
  quitarAviso: (id: number) => void;
}

let temporizador: ReturnType<typeof setTimeout> | undefined;
let marcarGuardado: (g: Estado['guardado']) => void = () => undefined;
let dbActual: () => BaseDatos | null = () => null;

/**
 * Escritura en IndexedDB SERIALIZADA: las escrituras se encadenan (nunca dos a la vez) y cada una
 * escribe la versión VIGENTE en memoria en el momento de ejecutarse, no la que la programó. Así, por
 * mucho que se crucen operaciones, lo último que queda guardado nunca es una versión anterior.
 * «guardado» solo se marca si lo escrito es exactamente lo que hay en memoria; si no, sigue
 * «pendiente» hasta la siguiente escritura.
 */
let cola: Promise<unknown> = Promise.resolve();
function escribir(): Promise<void> {
  const tarea = cola.then(async () => {
    const vigente = dbActual();
    if (!vigente) return;
    try {
      await idbSet(CLAVE_DB, vigente);
    } catch (e) {
      if (dbActual() === vigente) marcarGuardado({ estado: 'error', momento: Date.now() });
      throw e;
    }
    marcarGuardado(dbActual() === vigente ? { estado: 'guardado', momento: Date.now() } : { estado: 'pendiente' });
  });
  cola = tarea.catch(() => undefined);
  return tarea;
}

/** Guardado diferido (operaciones normales): agrupa cambios seguidos en una sola escritura. */
function persistir() {
  clearTimeout(temporizador);
  marcarGuardado({ estado: 'pendiente' });
  temporizador = setTimeout(() => {
    escribir().catch(() => {
      /* almacenamiento no disponible: la demo sigue funcionando en memoria; queda en «error» */
    });
  }, 600);
}

const textoErrorGuardado = (e: unknown) =>
  `No se ha podido guardar en el almacenamiento del navegador (${e instanceof Error ? e.message : String(e)}). Los datos siguen en memoria: no cierres la pestaña y pulsa «Reintentar guardado».`;

let nAviso = 0;

export const useStore = create<Estado>((set, get) => ({
  db: null,
  carga: { fase: 'inicio', mensaje: '' },
  prefs: leerPrefs(),
  pilaDeshacer: [],
  pilaRehacer: [],
  guardado: { estado: 'guardado' },
  avisos: [],
  callejeroReal: null,
  respaldo: null,

  inicializar: async (forzar = false) => {
    set({ carga: { fase: 'cargando', mensaje: 'Abriendo datos de demostración…' } });
    const tras = () => {
      void idbGet<Respaldo>(CLAVE_RESPALDO).then((r) => set({ respaldo: r?.db ? infoRespaldo(r) : null })).catch(() => undefined);
      void get().comprobarCallejeroReal();
    };
    try {
      if (!forzar) {
        const guardada = await idbGet<BaseDatos>(CLAVE_DB).catch(() => undefined);
        if (guardada && guardada.version === VERSION_DATOS) {
          set({ db: guardada, carga: { fase: 'lista', mensaje: '' } });
          tras();
          return;
        }
        // v9 → v10 (catálogo 2026) → v11 (franquicias): migración trazable, sin perder los datos de prueba.
        if (guardada && (guardada.version === 9 || guardada.version === 10)) {
          const { db: migrada, avisos } = migrarALaActual(guardada);
          set({ db: migrada, carga: { fase: 'lista', mensaje: '' } });
          persistir();
          for (const a of avisos) get().avisar(a, 'info');
          tras();
          return;
        }
      } else {
        // Restablecer: antes de borrar, copia de seguridad comprobada de la demostración actual.
        const actual = get().db ?? (await idbGet<BaseDatos>(CLAVE_DB).catch(() => undefined));
        if (actual) {
          try {
            set({ respaldo: await respaldar(actual, 'Antes de restablecer la demostración') });
          } catch (e) {
            set({ carga: { fase: actual === get().db ? 'lista' : 'error', mensaje: '' } });
            get().avisar(`No se ha restablecido: ${e instanceof Error ? e.message : String(e)}. Los datos actuales siguen intactos.`, 'error');
            return;
          }
        }
        await idbDel(CLAVE_DB).catch(() => undefined);
      }
      const callejero = await cargarCallejeroMedina((m) => set({ carga: { fase: 'cargando', mensaje: m } }));
      set({ carga: { fase: 'cargando', mensaje: 'Generando datos ficticios reproducibles…' } });
      await new Promise((r) => setTimeout(r, 30));
      const db = generarDemo({ calles: callejero.calles, fuente: callejero.fuente, detalleFuente: callejero.detalle });
      set({ db, carga: { fase: 'lista', mensaje: '' }, pilaDeshacer: [], pilaRehacer: [], callejeroReal: null });
      persistir();
      if (!forzar) tras();
    } catch (e) {
      console.error(e);
      set({ carga: { fase: 'error', mensaje: e instanceof Error ? e.message : String(e) } });
    }
  },

  comprobarCallejeroReal: async () => {
    if (get().db?.meta.fuenteCallejero !== 'simulado') return set({ callejeroReal: null });
    const inst = await cargarInstantaneaMedina();
    if (!inst.ok || get().db?.meta.fuenteCallejero !== 'simulado') return;
    set({ callejeroReal: { detalle: inst.detalle } });
    get().avisar('Hay disponible el callejero real de Medina del Campo (OpenStreetMap). Tu demostración no se ha modificado: puedes cambiar desde el Guion de demostración.', 'info');
  },

  cambiarACallejeroReal: async () => {
    const inst = await cargarInstantaneaMedina();
    if (!inst.ok) return { ok: false, error: inst.motivo ?? 'No hay instantánea del callejero real en el proyecto (public/data/medina-callejero.json).' };
    const actual = get().db;
    if (actual) {
      try {
        set({ respaldo: await respaldar(actual, 'Antes de pasar al callejero real (OSM)') });
      } catch (e) {
        return { ok: false, error: `No se ha cambiado nada: ${e instanceof Error ? e.message : String(e)}.` };
      }
    }
    const db = generarDemo({ calles: inst.calles, fuente: 'instantanea-osm', detalleFuente: inst.detalle });
    clearTimeout(temporizador);
    set({ db, pilaDeshacer: [], pilaRehacer: [], callejeroReal: null, guardado: { estado: 'pendiente' } });
    try {
      await escribir();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `${textoErrorGuardado(e)} La demostración anterior está en la copia de seguridad.` };
    }
  },

  restaurarRespaldo: async () => {
    let r: Respaldo | undefined;
    try {
      r = await idbGet<Respaldo>(CLAVE_RESPALDO);
    } catch {
      r = undefined;
    }
    if (!r?.db) return { ok: false, error: 'No hay ninguna copia de seguridad.' };
    let anterior = r.db;
    if (anterior.version === 9 || anterior.version === 10) anterior = migrarALaActual(anterior).db;
    if (anterior.version !== VERSION_DATOS) return { ok: false, error: `La copia es de una versión de datos no compatible (v${anterior.version}).` };
    const actual = get().db;
    if (actual) {
      try {
        set({ respaldo: await respaldar(actual, 'Antes de recuperar la demostración anterior') });
      } catch (e) {
        return { ok: false, error: `No se ha cambiado nada: ${e instanceof Error ? e.message : String(e)}.` };
      }
    }
    clearTimeout(temporizador);
    set({ db: anterior, pilaDeshacer: [], pilaRehacer: [], guardado: { estado: 'pendiente' } });
    try {
      await escribir();
    } catch (e) {
      return { ok: false, error: textoErrorGuardado(e) };
    }
    void get().comprobarCallejeroReal();
    return { ok: true };
  },

  aplicar: (fn, etiqueta, opciones) => {
    const { db, pilaDeshacer } = get();
    if (!db) return false;
    try {
      const nueva = fn(db);
      if (nueva === db) return false;
      set({ db: nueva, pilaDeshacer: [...pilaDeshacer.slice(-49), { db, etiqueta }], pilaRehacer: [] });
      persistir();
      if (!opciones?.silencioso) get().avisar(etiqueta, 'ok', true);
      return true;
    } catch (e) {
      if (!opciones?.sinAvisoError) get().avisar(e instanceof Error ? e.message : String(e), 'error');
      return false;
    }
  },

  aplicarConGuardado: async (fn, etiqueta) => {
    const { db } = get();
    if (!db) return { aplicado: false, guardado: false, error: 'Los datos todavía no están cargados.' };
    let nueva: BaseDatos;
    try {
      nueva = fn(db);
    } catch (e) {
      return { aplicado: false, guardado: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (nueva === db) return { aplicado: false, guardado: true };
    clearTimeout(temporizador);
    set({ db: nueva, pilaDeshacer: [], pilaRehacer: [], guardado: { estado: 'pendiente' } });
    try {
      // Escribe la versión vigente (que incluye esta operación) en la cola serializada.
      await escribir();
      get().avisar(etiqueta, 'ok');
      return { aplicado: true, guardado: true };
    } catch (e) {
      return { aplicado: true, guardado: false, error: textoErrorGuardado(e) };
    }
  },

  reintentarGuardado: async () => {
    if (!get().db) return { guardado: false, error: 'Los datos todavía no están cargados.' };
    clearTimeout(temporizador);
    set({ guardado: { estado: 'pendiente' } });
    try {
      // Solo vuelve a escribir: nunca repite la operación de dominio.
      await escribir();
      return { guardado: true };
    } catch (e) {
      return { guardado: false, error: textoErrorGuardado(e) };
    }
  },

  deshacer: () => {
    const { pilaDeshacer, pilaRehacer, db } = get();
    const ultimo = pilaDeshacer[pilaDeshacer.length - 1];
    if (!ultimo || !db) return;
    set({ db: ultimo.db, pilaDeshacer: pilaDeshacer.slice(0, -1), pilaRehacer: [...pilaRehacer, { db, etiqueta: ultimo.etiqueta }] });
    persistir();
    get().avisar(`Deshecho: ${ultimo.etiqueta}`, 'info');
  },

  rehacer: () => {
    const { pilaDeshacer, pilaRehacer, db } = get();
    const siguiente = pilaRehacer[pilaRehacer.length - 1];
    if (!siguiente || !db) return;
    set({ db: siguiente.db, pilaRehacer: pilaRehacer.slice(0, -1), pilaDeshacer: [...pilaDeshacer, { db, etiqueta: siguiente.etiqueta }] });
    persistir();
    get().avisar(`Rehecho: ${siguiente.etiqueta}`, 'info');
  },

  setPrefsOficina: (personaId, p) => {
    const actual = get().prefs.oficina[personaId] ?? { modo: 'tareas' as const };
    get().setPrefs({ oficina: { ...get().prefs.oficina, [personaId]: { ...actual, ...p } } });
  },

  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    set({ prefs });
    try {
      localStorage.setItem(CLAVE_PREFS, JSON.stringify(prefs));
    } catch {
      /* sin almacenamiento */
    }
  },

  avisar: (texto, tipo = 'info', deshacer = false) => {
    const id = ++nAviso;
    set({ avisos: [...get().avisos.slice(-1), { id, texto, tipo, deshacer }] });
    setTimeout(() => get().quitarAviso(id), tipo === 'error' ? 6000 : 4000);
  },
  quitarAviso: (id) => set({ avisos: get().avisos.filter((a) => a.id !== id) }),
}));

/** Acceso a la base ya cargada (los componentes solo se montan cuando existe). */
export function useDB(): BaseDatos {
  return useStore((s) => s.db!);
}

marcarGuardado = (g) => useStore.setState({ guardado: g });
dbActual = () => useStore.getState().db;
