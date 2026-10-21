import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Almacenamiento simulado: se puede forzar un fallo de escritura. */
const almacen = new Map<string, unknown>();
let fallar = false;
/** Si se define, cada escritura espera a que la prueba la libere (para cruzar escrituras). */
let retener: ((liberar: () => void) => void) | null = null;
let escrituras = 0;
vi.mock('idb-keyval', () => ({
  get: async (k: string) => almacen.get(k),
  set: async (k: string, v: unknown) => {
    escrituras++;
    if (retener) await new Promise<void>((r) => retener!(r));
    if (fallar) throw new Error('QuotaExceededError (simulado)');
    almacen.set(k, v);
  },
  del: async (k: string) => void almacen.delete(k),
}));

const { useStore } = await import('./store');
const { baseVacia } = await import('../domain/db');

describe('C1d · Guardado comprobado de operaciones con deshacer propio', () => {
  beforeEach(() => {
    almacen.clear();
    fallar = false;
    retener = null;
    escrituras = 0;
    const db = baseVacia();
    useStore.setState({ db, pilaDeshacer: [{ db, etiqueta: 'anterior' }], pilaRehacer: [{ db, etiqueta: 'x' }], guardado: { estado: 'guardado' } });
  });

  it('aplica, guarda de inmediato y vacía el historial de Ctrl+Z', async () => {
    const r = await useStore.getState().aplicarConGuardado((d) => ({ ...d, meta: { prueba: 'sí' } }), 'Operación');
    expect(r).toEqual({ aplicado: true, guardado: true });
    expect((almacen.get('ulit-censo:demo-db') as { meta: Record<string, string> }).meta.prueba).toBe('sí');
    expect(useStore.getState().pilaDeshacer).toEqual([]);
    expect(useStore.getState().pilaRehacer).toEqual([]);
    expect(useStore.getState().guardado.estado).toBe('guardado');
  });

  it('si el almacenamiento falla, lo informa claramente y conserva los datos en memoria', async () => {
    fallar = true;
    const r = await useStore.getState().aplicarConGuardado((d) => ({ ...d, meta: { prueba: 'sí' } }), 'Operación');
    expect(r.aplicado).toBe(true);
    expect(r.guardado).toBe(false);
    expect(r.error).toMatch(/No se ha podido guardar en el almacenamiento del navegador.*no cierres la pestaña/);
    expect(useStore.getState().db!.meta.prueba).toBe('sí');
    expect(useStore.getState().guardado.estado).toBe('error');
  });

  it('si la operación falla, no cambia nada ni se guarda', async () => {
    const antes = useStore.getState().db;
    const r = await useStore.getState().aplicarConGuardado(() => {
      throw new Error('Plan obsoleto');
    }, 'Operación');
    expect(r).toEqual({ aplicado: false, guardado: false, error: 'Plan obsoleto' });
    expect(useStore.getState().db).toBe(antes);
    expect(useStore.getState().pilaDeshacer).toHaveLength(1);
    expect(almacen.size).toBe(0);
  });

  it('«Reintentar guardado» vuelve a escribir lo que hay en memoria sin repetir la operación', async () => {
    fallar = true;
    let ejecuciones = 0;
    const r = await useStore.getState().aplicarConGuardado((d) => {
      ejecuciones++;
      return { ...d, meta: { prueba: 'sí' } };
    }, 'Operación');
    expect(r.guardado).toBe(false);
    // Sigue fallando: no se anuncia como guardado.
    const r2 = await useStore.getState().reintentarGuardado();
    expect(r2.guardado).toBe(false);
    expect(r2.error).toMatch(/Reintentar guardado/);
    expect(useStore.getState().guardado.estado).toBe('error');
    expect(almacen.size).toBe(0);
    // Se recupera el almacenamiento: el reintento guarda la misma versión, sin volver a aplicar nada.
    fallar = false;
    const enMemoria = useStore.getState().db;
    expect(await useStore.getState().reintentarGuardado()).toEqual({ guardado: true });
    expect(almacen.get('ulit-censo:demo-db')).toBe(enMemoria);
    expect(ejecuciones).toBe(1);
    expect(useStore.getState().guardado.estado).toBe('guardado');
  });

  it('mientras la escritura está en curso el estado es «pendiente», nunca «guardado»', async () => {
    const liberar: (() => void)[] = [];
    retener = (l) => liberar.push(l);
    const p = useStore.getState().aplicarConGuardado((d) => ({ ...d, meta: { n: '1' } }), 'Operación');
    await vi.waitFor(() => expect(liberar).toHaveLength(1));
    expect(useStore.getState().guardado.estado).toBe('pendiente');
    liberar[0]();
    expect((await p).guardado).toBe(true);
    expect(useStore.getState().guardado.estado).toBe('guardado');
  });

  it('dos escrituras cruzadas no pueden dejar guardada una versión anterior', async () => {
    const liberar: (() => void)[] = [];
    retener = (l) => liberar.push(l);
    const p1 = useStore.getState().aplicarConGuardado((d) => ({ ...d, meta: { n: '1' } }), 'Primera');
    await vi.waitFor(() => expect(liberar).toHaveLength(1));
    const p2 = useStore.getState().aplicarConGuardado((d) => ({ ...d, meta: { ...d.meta, n: '2' } }), 'Segunda');
    // La segunda escritura no empieza hasta que termina la primera (cola serializada).
    await new Promise((r) => setTimeout(r, 20));
    expect(escrituras).toBe(1);
    // La primera termina DESPUÉS de que la segunda operación ya esté en memoria: no marca «guardado».
    liberar[0]();
    await vi.waitFor(() => expect(liberar).toHaveLength(2));
    expect(useStore.getState().guardado.estado).toBe('pendiente');
    liberar[1]();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.guardado && r2.guardado).toBe(true);
    // Lo último escrito es la versión vigente (la segunda), no la primera.
    expect((almacen.get('ulit-censo:demo-db') as { meta: Record<string, string> }).meta.n).toBe('2');
    expect(almacen.get('ulit-censo:demo-db')).toBe(useStore.getState().db);
    expect(useStore.getState().guardado.estado).toBe('guardado');
  });

  it('una escritura diferida programada antes no sobrescribe un guardado posterior', async () => {
    vi.useFakeTimers();
    try {
      useStore.getState().aplicar((d) => ({ ...d, meta: { n: 'diferida' } }), 'Edición normal');
      const r = useStore.getState().aplicarConGuardado((d) => ({ ...d, meta: { n: 'inmediata' } }), 'Operación');
      await vi.runAllTimersAsync();
      expect((await r).guardado).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect((almacen.get('ulit-censo:demo-db') as { meta: Record<string, string> }).meta.n).toBe('inmediata');
    expect(useStore.getState().guardado.estado).toBe('guardado');
  });
});
