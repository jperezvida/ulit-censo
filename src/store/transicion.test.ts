import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Almacenamiento simulado (IndexedDB): se puede forzar un fallo de escritura. */
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
const { generarDemo } = await import('../data/semilla');
const { callejeroSimulado, MEDINA } = await import('../data/callejero');
const { instantaneaSintetica } = await import('../data/fixtureOsmSintetico');

const CLAVE = 'ulit-censo:demo-db';
const RESPALDO = 'ulit-censo:demo-db:respaldo';
const respuesta = (json: unknown) => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => json }) as unknown as Response;
/** Demostración guardada con el callejero SIMULADO y una modificación del usuario. */
const guardadaSimulada = () => {
  const db = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'simulado' });
  return { ...db, meta: { ...db.meta, cambioDelUsuario: 'sí' } };
};
const espera = () => new Promise((r) => setTimeout(r, 20));

describe('Transición segura al callejero real · IndexedDB', () => {
  beforeEach(() => {
    almacen.clear();
    fallar = false;
    useStore.setState({ db: null, callejeroReal: null, respaldo: null, avisos: [], pilaDeshacer: [], pilaRehacer: [] });
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(instantaneaSintetica())));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('al abrir, NO sobrescribe la demostración guardada aunque haya callejero real: solo lo ofrece', async () => {
    const guardada = guardadaSimulada();
    almacen.set(CLAVE, guardada);
    await useStore.getState().inicializar();
    await espera();
    expect(useStore.getState().db).toBe(guardada);
    expect(almacen.get(CLAVE)).toBe(guardada);
    expect(almacen.has(RESPALDO)).toBe(false);
    expect(useStore.getState().callejeroReal?.detalle).toMatch(/calles reales · instantánea OSM/);
    expect(useStore.getState().avisos.some((a) => /no se ha modificado/.test(a.texto))).toBe(true);
  });

  it('cambiar al callejero real guarda antes una copia comprobada; recuperar la intercambia sin perder ninguna', async () => {
    const guardada = guardadaSimulada();
    almacen.set(CLAVE, guardada);
    await useStore.getState().inicializar();
    const r = await useStore.getState().cambiarACallejeroReal();
    expect(r).toEqual({ ok: true });
    const nueva = useStore.getState().db!;
    expect(nueva.meta.fuenteCallejero).toBe('instantanea-osm');
    expect(nueva.municipios[MEDINA.id].fuenteCallejero).toBe('osm');
    expect(Object.values(nueva.calles).filter((c) => c.municipioId === MEDINA.id).every((c) => c.procedencia === 'osm')).toBe(true);
    // Negocios de Medina: todos simulados
    expect(Object.values(nueva.negocios).filter((n) => n.id.startsWith('neg-loc-med')).every((n) => n.procedencia === 'simulado')).toBe(true);
    expect((almacen.get(CLAVE) as typeof nueva).meta.fuenteCallejero).toBe('instantanea-osm');
    expect((almacen.get(RESPALDO) as { db: typeof guardada }).db.meta.cambioDelUsuario).toBe('sí');
    expect(useStore.getState().respaldo).toMatchObject({ motivo: 'Antes de pasar al callejero real (OSM)', fuenteCallejero: 'simulado' });
    expect(useStore.getState().callejeroReal).toBeNull();
    // Recuperar: vuelve la anterior y la del callejero real pasa a ser la copia
    expect(await useStore.getState().restaurarRespaldo()).toEqual({ ok: true });
    expect(useStore.getState().db!.meta.cambioDelUsuario).toBe('sí');
    expect((almacen.get(CLAVE) as typeof guardada).meta.cambioDelUsuario).toBe('sí');
    expect((almacen.get(RESPALDO) as { db: typeof nueva }).db.meta.fuenteCallejero).toBe('instantanea-osm');
  });

  it('si la copia de seguridad no se puede escribir, no cambia nada', async () => {
    const guardada = guardadaSimulada();
    almacen.set(CLAVE, guardada);
    await useStore.getState().inicializar();
    fallar = true;
    const r = await useStore.getState().cambiarACallejeroReal();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No se ha cambiado nada/);
    expect(useStore.getState().db).toBe(guardada);
    expect(almacen.get(CLAVE)).toBe(guardada);
  });

  it('sin instantánea válida no se ofrece ni se aplica el cambio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ ...instantaneaSintetica(), __fuente: undefined })));
    const guardada = guardadaSimulada();
    almacen.set(CLAVE, guardada);
    await useStore.getState().inicializar();
    await espera();
    expect(useStore.getState().callejeroReal).toBeNull();
    const r = await useStore.getState().cambiarACallejeroReal();
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/licencia/) });
    expect(useStore.getState().db).toBe(guardada);
  });

  it('«Restablecer demo» guarda antes una copia de la demostración actual', async () => {
    const guardada = guardadaSimulada();
    almacen.set(CLAVE, guardada);
    await useStore.getState().inicializar();
    await useStore.getState().inicializar(true);
    expect((almacen.get(RESPALDO) as { db: typeof guardada; motivo: string }).db.meta.cambioDelUsuario).toBe('sí');
    expect(useStore.getState().db!.meta.fuenteCallejero).toBe('instantanea-osm');
  });
});
