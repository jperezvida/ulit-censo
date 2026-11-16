import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clienteServidor } from './clienteSupabase';
import { capacidadCategorizacionIt1, guardarCategoriaIt1 } from './categorizacionIt1Real';
vi.mock('./clienteSupabase',()=>({clienteServidor:vi.fn()}));
const rpc=vi.fn();
const id='reg-imp-it1-27';
const snapshot={grupoActividad:'Comercio',grupoComercio:'Alimentación',
  subgrupo:'Carnes',actividad:'Carnicería',descripcionActividad:''};
const registro=(estado:'aceptada'|'rechazada')=>({
 id,registroId:id,campanaId:'real-camp-medina-2026-censo-medina-del-campo-2026',
 fecha:'2026-11-16T11:00:00Z',porId:'coordinacion',motivo:'Revisión',
 valores:{},historial:[],
 revisionClasificacion:{estado,valores:snapshot,fecha:'2026-11-16T11:00:00Z',porId:'coordinacion'},
});
describe('RPC categorización IT1',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.mocked(clienteServidor).mockReturnValue({rpc} as never);});
 it('solo habilita la función con el alcance específico del IT1',async()=>{
  rpc.mockResolvedValueOnce({data:{habilitada:true,alcance:'categoria-it1-2026',version:22},error:null});
  expect((await capacidadCategorizacionIt1()).habilitada).toBe(true);
  expect(rpc).toHaveBeenCalledWith('ulit_censo_categoria_it1_2026',
    expect.objectContaining({p_accion:'estado'}));
 });
 it('acepta una clasificación existente y verifica respuesta íntegra',async()=>{
  rpc.mockResolvedValueOnce({data:{version:23,registroId:id,accion:'aceptar',
    correccion:registro('aceptada')},error:null});
  const r=await guardarCategoriaIt1(id,22,'aceptar');
  expect(r.correccion?.revisionClasificacion?.estado).toBe('aceptada');
  expect(rpc).toHaveBeenCalledWith('ulit_censo_categoria_it1_2026',
    expect.objectContaining({p_accion:'aceptar',p_valores:null}));
 });
 it('el rechazo conserva categoría sin sustituirla',async()=>{
  rpc.mockResolvedValueOnce({data:{version:23,registroId:id,accion:'rechazar',
    correccion:registro('rechazada')},error:null});
  const r=await guardarCategoriaIt1(id,22,'rechazar');
  expect(r.correccion?.revisionClasificacion?.estado).toBe('rechazada');
  expect(r.correccion?.valores).toEqual({});
 });
 it('asignación no permite campos adicionales ni categorías parciales',async()=>{
  await expect(guardarCategoriaIt1(id,22,'asignar',undefined))
    .rejects.toThrow('Selecciona una clasificación');
  await expect(guardarCategoriaIt1(id,22,'asignar',
    {...snapshot,subgrupo:'',hack:'X'} as never)).rejects.toThrow('Selecciona');
  await expect(guardarCategoriaIt1(id,22,'aceptar',snapshot)).rejects.toThrow('nunca modifica');
  expect(rpc).not.toHaveBeenCalled();
 });
 it('bloquea respuesta de otra fila y conflicto de versión',async()=>{
  rpc.mockResolvedValueOnce({data:{version:23,registroId:'otra',accion:'aceptar',
    correccion:registro('aceptada')},error:null});
  await expect(guardarCategoriaIt1(id,22,'aceptar')).rejects.toThrow('no confirmó');
  rpc.mockResolvedValueOnce({data:null,error:{code:'PT409',message:'Conflict'}});
  await expect(guardarCategoriaIt1(id,22,'aceptar')).rejects.toThrow('Recarga');
 });
});
