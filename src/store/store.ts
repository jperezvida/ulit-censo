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
  avisos: Aviso[];
  inicializar: (forzar?: boolean) => Promise<void>;
  aplicar: (fn: (db: BaseDatos) => BaseDatos, etiqueta: string, opciones?: { silencioso?: boolean }) => boolean;
  deshacer: () => void;
  setPrefs: (p: Partial<Prefs>) => void;
  avisar: (texto: string, tipo?: Aviso['tipo'], deshacer?: boolean) => void;
  quitarAviso: (id: number) => void;
}

let temporizador: ReturnType<typeof setTimeout> | undefined;
function persistir(db: BaseDatos) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    idbSet(CLAVE_DB, db).catch(() => {
      /* almacenamiento no disponible: la demo sigue funcionando en memoria */
    });
  }, 600);
}

let nAviso = 0;

export const useStore = create<Estado>((set, get) => ({
  db: null,
  carga: { fase: 'inicio', mensaje: '' },
  prefs: leerPrefs(),
  pilaDeshacer: [],
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
      set({ db, carga: { fase: 'lista', mensaje: '' }, pilaDeshacer: [] });
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
      set({ db: nueva, pilaDeshacer: [...pilaDeshacer.slice(-29), { db, etiqueta }] });
      persistir(nueva);
      if (!opciones?.silencioso) get().avisar(etiqueta, 'ok', true);
      return true;
    } catch (e) {
      get().avisar(e instanceof Error ? e.message : String(e), 'error');
      return false;
    }
  },

  deshacer: () => {
    const { pilaDeshacer } = get();
    const ultimo = pilaDeshacer[pilaDeshacer.length - 1];
    if (!ultimo) return;
    set({ db: ultimo.db, pilaDeshacer: pilaDeshacer.slice(0, -1) });
    persistir(ultimo.db);
    get().avisar(`Deshecho: ${ultimo.etiqueta}`, 'info');
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
    set({ avisos: [...get().avisos.slice(-2), { id, texto, tipo, deshacer }] });
    setTimeout(() => get().quitarAviso(id), tipo === 'error' ? 6000 : 4000);
  },
  quitarAviso: (id) => set({ avisos: get().avisos.filter((a) => a.id !== id) }),
}));

/** Acceso a la base ya cargada (los componentes solo se montan cuando existe). */
export function useDB(): BaseDatos {
  return useStore((s) => s.db!);
}
