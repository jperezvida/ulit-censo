import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Almacenamiento simulado: se puede forzar un fallo de escritura. */
const almacen = new Map<string, unknown>();
let fallar = false;
vi.mock('idb-keyval', () => ({
  get: async (k: string) => almacen.get(k),
  set: async (k: string, v: unknown) => {
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
});
