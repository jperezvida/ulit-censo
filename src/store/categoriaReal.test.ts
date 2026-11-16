import { beforeEach,describe,expect,it,vi } from 'vitest';
import { clienteServidor } from './clienteSupabase';
import { capacidadCategoriaReal, guardarCategoriaReal } from './categoriaReal';

vi.mock('./clienteSupabase',()=>({clienteServidor:vi.fn()}));
const rpc=vi.fn();
const REG='reg-2026-ensayo';
const IT='it1';
const nodo='c26.C.A.pan-y-lacteos.panaderia';
const entidad=(estado:'aceptada'|'rechazada'|'corregida',id=nodo)=>({
  id:REG,registroId:REG,itinerarioId:IT,
  campanaId:'real-camp-medina-2026-censo-medina-del-campo-2026',
  estado,catalogoId:'clasificacion-2026@v1',nodoId:estado==='rechazada'?null:id,
  nombreRevisado:'Panadería sintética',
  valores:{grupoActividad:'Comercio',grupoComercio:'Alimentación',
    subgrupo:'Pan y Lácteos',actividad:'Panadería',descripcionActividad:''},
  porId:'admin',fecha:'2026-11-16T10:00:00Z',
});

describe('Categorización real: RPC restringida por fila',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.mocked(clienteServidor).mockReturnValue({rpc} as never)});
  it('habilita solo con alcance y catálogo oficial 2026',async()=>{
    rpc.mockResolvedValueOnce({data:{habilitada:true,catalogo:'clasificacion-2026@v1',alcance:'clasificacion-por-fila-2026'},error:null});
    expect((await capacidadCategoriaReal()).habilitada).toBe(true);
    rpc.mockResolvedValueOnce({data:{habilitada:true,catalogo:'demo',alcance:'clasificacion-por-fila-2026'},error:null});
    expect((await capacidadCategoriaReal()).habilitada).toBe(false);
  });
  it('aceptar se guarda una sola vez y devuelve la revisión oficial del servidor',async()=>{
    rpc.mockResolvedValueOnce({data:{version:21,registroId:REG,itinerarioId:IT,accion:'aceptar',revision:entidad('aceptada')},error:null});
    const r=await guardarCategoriaReal(REG,IT,20,'aceptar',nodo);
    expect(r.revision.estado).toBe('aceptada');
    expect(r.version).toBe(21);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('ulit_censo_categoria_registro_2026',expect.objectContaining({
      p_accion:'aceptar',p_nodo_id:nodo,p_espacio:'real-medina-del-campo-2026',p_version_esperada:20,
    }));
  });
  it('rechazar requiere vaciar el nodo, pero no acredita revisión terminada',async()=>{
    rpc.mockResolvedValueOnce({data:{version:21,registroId:REG,itinerarioId:IT,accion:'rechazar',revision:entidad('rechazada')},error:null});
    const r=await guardarCategoriaReal(REG,IT,20,'rechazar');
    expect(r.revision.estado).toBe('rechazada');
    expect(r.revision.nodoId).toBeNull();
    expect(rpc).toHaveBeenCalledWith('ulit_censo_categoria_registro_2026',expect.objectContaining({
      p_accion:'rechazar',p_nodo_id:'',p_descripcion:'',
    }));
  });
  it('no permite el catálogo demo ni nodos incompletos',async()=>{
    await expect(guardarCategoriaReal(REG,IT,20,'aceptar','a1-comercio')).rejects.toThrow();
    await expect(guardarCategoriaReal(REG,IT,20,'aceptar','c26.C')).rejects.toThrow();
    await expect(guardarCategoriaReal(REG,IT,20,'rechazar',nodo)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('impide sobrescribir por versión obsoleta',async()=>{
    rpc.mockResolvedValueOnce({data:null,error:{code:'PT409',message:'old'}});
    await expect(guardarCategoriaReal(REG,IT,20,'corregir',nodo)).rejects.toThrow('cambiado');
  });
  it('no acepta respuesta de otro registro, otro catálogo o ruta diferente',async()=>{
    rpc.mockResolvedValueOnce({data:{version:21,registroId:'otro',itinerarioId:IT,accion:'aceptar',revision:entidad('aceptada')},error:null});
    await expect(guardarCategoriaReal(REG,IT,20,'aceptar',nodo)).rejects.toThrow('no confirmó');
    rpc.mockResolvedValueOnce({data:{version:21,registroId:REG,itinerarioId:IT,accion:'aceptar',revision:{...entidad('aceptada'),catalogoId:'demo'}},error:null});
    await expect(guardarCategoriaReal(REG,IT,20,'aceptar',nodo)).rejects.toThrow('no confirmó');
  });
});
