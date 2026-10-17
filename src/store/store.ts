import { create } from 'zustand';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { VERSION_DATOS, type BaseDatos } from '../domain/db';
import type { Id, Rol } from '../domain/types';
import { cargarCallejeroMedina } from '../data/callejero';
import { generarDemo } from '../data/semilla';

const CLAVE_DB = 'ulit-censo:demo-db';
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
  inicializar: (forzar?: boolean) => Promise<void>;
  /**
   * Aplica una operación de dominio como UN paso deshacible. Con `silencioso` no se muestra el
   * aviso de éxito; con `sinAvisoError` el error lo presenta quien llama (p. ej. la tabla).
   */
  aplicar: (fn: (db: BaseDatos) => BaseDatos, etiqueta: string, opciones?: { silencioso?: boolean; sinAvisoError?: boolean }) => boolean;
  deshacer: () => void;
  rehacer: () => void;
  setPrefsOficina: (personaId: Id, p: Partial<PrefsOficina>) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  avisar: (texto: string, tipo?: Aviso['tipo'], deshacer?: boolean) => void;
  quitarAviso: (id: number) => void;
}

let temporizador: ReturnType<typeof setTimeout> | undefined;
let marcarGuardado: (g: Estado['guardado']) => void = () => undefined;
function persistir(db: BaseDatos) {
  clearTimeout(temporizador);
  marcarGuardado({ estado: 'pendiente' });
  temporizador = setTimeout(() => {
    idbSet(CLAVE_DB, db)
      .then(() => marcarGuardado({ estado: 'guardado', momento: Date.now() }))
      .catch(() => {
        /* almacenamiento no disponible: la demo sigue funcionando en memoria */
        marcarGuardado({ estado: 'error', momento: Date.now() });
      });
  }, 600);
}

let nAviso = 0;

export const useStore = create<Estado>((set, get) => ({
  db: null,
  carga: { fase: 'inicio', mensaje: '' },
  prefs: leerPrefs(),
  pilaDeshacer: [],
  pilaRehacer: [],
  guardado: { estado: 'guardado' },
  avisos: [],

  inicializar: async (forzar = false) => {
    set({ carga: { fase: 'cargando', mensaje: 'Abriendo datos de demostración…' } });
    try {
      if (!forzar) {
        const guardada = await idbGet<BaseDatos>(CLAVE_DB).catch(() => undefined);
        if (guardada && guardada.version === VERSION_DATOS) {
          set({ db: guardada, carga: { fase: 'lista', mensaje: '' } });
          return;
        }
      } else {
        await idbDel(CLAVE_DB).catch(() => undefined);
      }
      const callejero = await cargarCallejeroMedina((m) => set({ carga: { fase: 'cargando', mensaje: m } }));
      set({ carga: { fase: 'cargando', mensaje: 'Generando datos ficticios reproducibles…' } });
      await new Promise((r) => setTimeout(r, 30));
      const db = generarDemo({ calles: callejero.calles, fuente: callejero.fuente, detalleFuente: callejero.detalle });
      set({ db, carga: { fase: 'lista', mensaje: '' }, pilaDeshacer: [], pilaRehacer: [] });
      persistir(db);
    } catch (e) {
      console.error(e);
      set({ carga: { fase: 'error', mensaje: e instanceof Error ? e.message : String(e) } });
    }
  },

  aplicar: (fn, etiqueta, opciones) => {
    const { db, pilaDeshacer } = get();
    if (!db) return false;
    try {
      const nueva = fn(db);
      if (nueva === db) return false;
      set({ db: nueva, pilaDeshacer: [...pilaDeshacer.slice(-49), { db, etiqueta }], pilaRehacer: [] });
      persistir(nueva);
      if (!opciones?.silencioso) get().avisar(etiqueta, 'ok', true);
      return true;
    } catch (e) {
      if (!opciones?.sinAvisoError) get().avisar(e instanceof Error ? e.message : String(e), 'error');
      return false;
    }
  },

  deshacer: () => {
    const { pilaDeshacer, pilaRehacer, db } = get();
    const ultimo = pilaDeshacer[pilaDeshacer.length - 1];
    if (!ultimo || !db) return;
    set({ db: ultimo.db, pilaDeshacer: pilaDeshacer.slice(0, -1), pilaRehacer: [...pilaRehacer, { db, etiqueta: ultimo.etiqueta }] });
    persistir(ultimo.db);
    get().avisar(`Deshecho: ${ultimo.etiqueta}`, 'info');
  },

  rehacer: () => {
    const { pilaDeshacer, pilaRehacer, db } = get();
    const siguiente = pilaRehacer[pilaRehacer.length - 1];
    if (!siguiente || !db) return;
    set({ db: siguiente.db, pilaRehacer: pilaRehacer.slice(0, -1), pilaDeshacer: [...pilaDeshacer, { db, etiqueta: siguiente.etiqueta }] });
    persistir(siguiente.db);
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
