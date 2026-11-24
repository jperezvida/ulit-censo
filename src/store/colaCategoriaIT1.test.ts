import { describe, expect, it, vi } from 'vitest';
import { crearColaCategoriaIT1, type DecisionCategoriaIT1 } from './colaCategoriaIT1';
import type { CambioCategoriaIT1 } from './categoriaIT1Real';

const valores = {
  grupoActividad:'Servicios', grupoComercio:'', subgrupo:'Reparaciones',
  actividad:'Reparación', descripcionActividad:'',
};
const d = (registroId: string, accion: DecisionCategoriaIT1['accion'] = 'aceptar'):
  DecisionCategoriaIT1 => ({ registroId, accion, valores });
const respuesta = (registroId: string, version: number, accion: DecisionCategoriaIT1['accion']):
  CambioCategoriaIT1 => ({ registroId, version, revision: {
    id:registroId, registroId, campanaId:'c26',
    estado:accion === 'rechazar' ? 'rechazada' : accion === 'corregir' ? 'corregida' : 'aceptada',
    porId:'p1', fecha:'2026-11-24T17:00:00Z', valores,
  } });

describe('Cola IT1: avance instantáneo sin falsos guardados', () => {
  it('encola dos decisiones sin esperar y envía versiones en orden', async () => {
    let resolverPrimera!: (v: CambioCategoriaIT1) => void;
    const guardar = vi.fn()
      .mockImplementationOnce(() => new Promise<CambioCategoriaIT1>((resolve) => { resolverPrimera = resolve; }))
      .mockImplementation(async (id: string, ver: number, accion: DecisionCategoriaIT1['accion']) =>
        respuesta(id, ver + 1, accion));
    const recibir = vi.fn();
    const publicar = vi.fn();
    const cola = crearColaCategoriaIT1(20, guardar, recibir, publicar);
    expect(cola.encolar(d('r1'))).toBe(true);
    expect(cola.encolar(d('r2'))).toBe(true);
    expect(cola.consultar().pendientes).toHaveLength(2);
    expect(recibir).not.toHaveBeenCalled();
    expect(guardar).toHaveBeenCalledTimes(1);
    resolverPrimera(respuesta('r1', 21, 'aceptar'));
    await vi.waitFor(() => expect(recibir).toHaveBeenCalledTimes(2));
    expect(guardar).toHaveBeenNthCalledWith(2, 'r2', 21, 'aceptar', valores);
    expect(cola.consultar().pendientes).toHaveLength(0);
    expect(publicar).toHaveBeenCalled();
  });

  it('permite rechazo seguido de corrección de la misma ficha y evita duplicados', async () => {
    let resolver!: (v: CambioCategoriaIT1) => void;
    const guardar = vi.fn().mockImplementationOnce(() =>
      new Promise<CambioCategoriaIT1>((resolve) => { resolver = resolve; }))
      .mockImplementation(async (id: string, ver: number, accion: DecisionCategoriaIT1['accion']) =>
        respuesta(id, ver + 1, accion));
    const cola = crearColaCategoriaIT1(20, guardar, vi.fn(), vi.fn());
    expect(cola.encolar(d('r1', 'rechazar'))).toBe(true);
    expect(cola.encolar(d('r1', 'corregir'))).toBe(true);
    expect(cola.encolar(d('r1', 'aceptar'))).toBe(false);
    expect(cola.consultar().pendientes).toHaveLength(2);
    resolver(respuesta('r1', 21, 'rechazar'));
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(2));
    expect(guardar).toHaveBeenNthCalledWith(2, 'r1', 21, 'corregir', valores);
    await vi.waitFor(() => expect(cola.consultar().pendientes).toHaveLength(0));
  });

  it('con fallo de red no borra la cola ni confirma escrituras inexistentes', async () => {
    const guardar = vi.fn().mockRejectedValueOnce(new Error('Sin conexión'))
      .mockImplementation(async (id: string, ver: number, accion: DecisionCategoriaIT1['accion']) =>
        respuesta(id, ver + 1, accion));
    const confirmar = vi.fn();
    const cola = crearColaCategoriaIT1(20, guardar, confirmar, vi.fn());
    expect(cola.encolar(d('r1'))).toBe(true);
    await vi.waitFor(() => expect(cola.consultar().error).toBe('Sin conexión'));
    expect(cola.consultar().pendientes).toHaveLength(1);
    expect(confirmar).not.toHaveBeenCalled();
    expect(cola.encolar(d('r2'))).toBe(false);
    expect(() => cola.sincronizarVersion(21)).toThrow();
    cola.reintentar();
    await vi.waitFor(() => expect(cola.consultar().pendientes).toHaveLength(0));
    expect(confirmar).toHaveBeenCalledTimes(1);
  });
});
