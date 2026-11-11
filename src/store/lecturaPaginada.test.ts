import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leerEspacioPaginado, LecturaPaginadaInconsistente, LecturaPaginadaNoDisponible } from './lecturaPaginada';

const ESPACIO = 'real-medina-del-campo-2026';
const raiz = { version: 11, generado: '2026-11-11T00:00:00Z',
  secuencia: 7, meta: { espacio: 'real', espacioId: ESPACIO }, colaSync: [] };

function servidor(filas: number, opcion: 'normal'|'ausente'|'conflicto' = 'normal') {
  const todos = [
    { c: '_raiz', id: 'raiz', v: raiz },
    ...Array.from({ length: filas }, (_, i) => ({
      c: 'registros', id: `r${String(i).padStart(5,'0')}`,
      v: { id: `r${String(i).padStart(5,'0')}`, importacionId: 'it1', fila: i + 2, datos: {} },
    })),
  ];
  const rpc = vi.fn((fn: string, args?: Record<string, unknown>) => {
    let respuesta: { data: unknown; error: { code: string; message: string } | null };
    if (fn === 'ulit_censo_mis_espacios') {
      respuesta = { data: [{ espacio_id: ESPACIO, tipo: 'real', version: 8,
        escritura_habilitada: false, rol: 'administrador', persona_id: 'jaime' }], error: null };
    } else if (opcion === 'ausente') {
      respuesta = { data: null, error: { code: 'PGRST202', message: 'RPC no instalada' } };
    } else if (opcion === 'conflicto') {
      respuesta = { data: null, error: { code: 'PT409', message: 'Versión antigua' } };
    } else {
      const coleccion = String(args?.p_despues_coleccion ?? '');
      const id = String(args?.p_despues_id ?? '');
      const limite = Number(args?.p_limite ?? 0);
      const desde = todos.findIndex((x) => x.c > coleccion || (x.c === coleccion && x.id > id));
      const items = desde < 0 ? [] : todos.slice(desde, desde + limite);
      respuesta = { data: { version: 8, cantidad: items.length, items }, error: null };
    }
    const promesa = Promise.resolve(respuesta);
    return Object.assign(promesa, { abortSignal: (_signal: AbortSignal) => promesa });
  });
  return { cliente: { rpc } as unknown as SupabaseClient, rpc };
}

describe('Lectura paginada del censo real', () => {
  it('reconstruye todas las entidades y su raíz sin duplicados, por lotes de 250', async () => {
    const { cliente, rpc } = servidor(817);
    const progreso: number[] = [];
    const resultado = await leerEspacioPaginado(cliente, ESPACIO, undefined, (n) => progreso.push(n));
    expect(Object.keys(resultado.db.registros)).toHaveLength(817);
    expect(resultado.db.meta.espacioId).toBe(ESPACIO);
    expect(resultado.info.version).toBe(8);
    expect(resultado.info.escrituraHabilitada).toBe(false);
    expect(progreso).toEqual([250, 500, 750, 818]);
    expect(rpc).toHaveBeenCalledTimes(5);
    expect(rpc).not.toHaveBeenCalledWith('ulit_censo_aplicar', expect.anything());
  });
  it('se detiene si falta la RPC nueva, sin entregar datos parciales', async () => {
    await expect(leerEspacioPaginado(servidor(817,'ausente').cliente, ESPACIO))
      .rejects.toBeInstanceOf(LecturaPaginadaNoDisponible);
  });
  it('falla cerrado si la versión cambia mientras se lee', async () => {
    await expect(leerEspacioPaginado(servidor(817,'conflicto').cliente, ESPACIO))
      .rejects.toBeInstanceOf(LecturaPaginadaInconsistente);
  });
  it('rechaza lecturas desde otro espacio', async () => {
    await expect(leerEspacioPaginado(servidor(817).cliente, 'otro'))
      .rejects.toThrow('fuera del alcance');
  });
});
