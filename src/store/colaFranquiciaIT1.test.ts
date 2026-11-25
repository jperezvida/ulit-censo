import { describe, expect, it, vi } from 'vitest';
import { crearColaFranquiciaIT1 } from './colaFranquiciaIT1';
import type { CambioFranquiciaIT1 } from './franquiciaIT1Real';

const cambio=(id:string,version:number,respuesta:'si'|'no'='no'):CambioFranquiciaIT1=>({
  version,accion:'resolver',revisiones:[{id,registroId:id,campanaId:'c26',estado:'corregida',
    respuesta,porId:'revisor',fecha:'2026-11-25T10:00:00Z'}],
});
describe('Cola de franquicias IT1',()=>{
  it('avanza sin esperar y solo descuenta cuando el servidor confirma',async()=>{
    let resolver!: (c:CambioFranquiciaIT1)=>void;
    const guardar=vi.fn(() => new Promise<CambioFranquiciaIT1>((resolve)=>{resolver=resolve;}));
    const confirmar=vi.fn();
    const publicar=vi.fn();
    const cola=crearColaFranquiciaIT1(20,guardar,confirmar,publicar);
    expect(cola.encolar({ids:['r12345'],accion:'resolver',respuesta:'si'})).toBe(true);
    expect(cola.consultar().pendientes).toHaveLength(1);
    expect(confirmar).not.toHaveBeenCalled();
    resolver(cambio('r12345',21,'si'));
    await vi.waitFor(()=>expect(cola.consultar().pendientes).toHaveLength(0));
    expect(confirmar).toHaveBeenCalledTimes(1);
  });
  it('un fallo mantiene la cola detenida y solo permite reintento explícito',async()=>{
    const guardar=vi.fn()
      .mockRejectedValueOnce(new Error('sin conexión'))
      .mockResolvedValueOnce(cambio('r12345',21));
    const cola=crearColaFranquiciaIT1(20,guardar,vi.fn(),vi.fn());
    cola.encolar({ids:['r12345'],accion:'resolver',respuesta:'no'});
    await vi.waitFor(()=>expect(cola.consultar().error).toContain('sin conexión'));
    expect(cola.consultar().pendientes).toHaveLength(1);
    cola.reintentar();
    await vi.waitFor(()=>expect(cola.consultar().pendientes).toHaveLength(0));
    expect(guardar).toHaveBeenCalledTimes(2);
  });
  it('aceptar todas viaja como una sola decisión atómica y bloquea solapamientos',async()=>{
    let resolver!: (c:CambioFranquiciaIT1)=>void;
    const cola=crearColaFranquiciaIT1(20,()=>new Promise((r)=>{resolver=r;}),vi.fn(),vi.fn());
    expect(cola.encolar({ids:['reg-1','reg-2'],accion:'aceptar-todas'})).toBe(true);
    expect(cola.encolar({ids:['reg-2'],accion:'rechazar'})).toBe(false);
    expect(cola.consultar().pendientes[0].ids).toHaveLength(2);
    resolver({version:21,accion:'aceptar-todas',revisiones:[
      {id:'reg-1',registroId:'reg-1',campanaId:'c26',estado:'aceptada',respuesta:'no',porId:'revisor',fecha:'2026-11-25T10:00:00Z'},
      {id:'reg-2',registroId:'reg-2',campanaId:'c26',estado:'aceptada',respuesta:'si',porId:'revisor',fecha:'2026-11-25T10:00:00Z'},
    ]});
    await vi.waitFor(()=>expect(cola.consultar().pendientes).toHaveLength(0));
  });
});
