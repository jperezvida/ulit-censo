import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clienteServidor } from './clienteSupabase';
import { capacidadRevisionGeneral, guardarCorreccionRevisionGeneral } from './revisionGeneralReal';
import type { CorreccionRegistro } from '../domain/types';

vi.mock('./clienteSupabase', () => ({ clienteServidor: vi.fn() }));

const REG='reg-imp-27';
const CAMP='real-camp-medina-2026-censo-medina-del-campo-2026';
const correccion=(valores: Record<string,string>): CorreccionRegistro => ({
  id:REG, registroId:REG, campanaId:CAMP, valores,
  fecha:'2026-11-13T12:00:00Z', porId:'responsable', motivo:'Revisión', historial:[],
});
const rpc=vi.fn();

describe('RPC restringida de revisión y respuesta para actualización instantánea', () => {
  beforeEach(()=>{vi.clearAllMocks();vi.mocked(clienteServidor).mockReturnValue({rpc} as never);});
  it('comprueba permiso específico para fachada y ocupación', async () => {
    rpc.mockResolvedValueOnce({data:{habilitada:true,version:9,alcance:'fachada-y-ocupacion'},error:null});
    const capacidad=await capacidadRevisionGeneral();
    expect(capacidad.habilitada).toBe(true);
    expect(rpc).toHaveBeenCalledWith('ulit_censo_revision_fase1_2026',expect.objectContaining({p_accion:'estado'}));
  });
  it('la transición a ocupado no manda metros, y devuelve la entidad completa', async () => {
    rpc.mockResolvedValueOnce({data:{version:10,registroId:REG,accion:'ocupar',
      correccion:correccion({vacio:'0'})},error:null});
    const resultado=await guardarCorreccionRevisionGeneral(REG,9,{vacio:'0',fachada:''});
    expect(resultado.version).toBe(10);
    expect(resultado.correccion.valores.vacio).toBe('0');
    expect(rpc).toHaveBeenCalledWith('ulit_censo_revision_fase1_2026',expect.objectContaining({
      p_accion:'ocupar', p_metros:'', p_registro_id:REG, p_version_esperada:9,
    }));
  });
  it('fachada positiva se almacena sin pedir una segunda carga del censo', async () => {
    rpc.mockResolvedValueOnce({data:{version:10,registroId:REG,accion:'guardar',
      correccion:correccion({fachada:'4,5'})},error:null});
    const resultado=await guardarCorreccionRevisionGeneral(REG,9,{fachada:'4,5'});
    expect(resultado.correccion.valores.fachada).toBe('4,5');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('rechaza cambios arbitrarios y estados no autorizados ANTES de invocar la RPC', async () => {
    await expect(guardarCorreccionRevisionGeneral(REG,9,{nombre:'otro'})).rejects.toThrow('Solo se permiten');
    await expect(guardarCorreccionRevisionGeneral(REG,9,{vacio:'1',fachada:''})).rejects.toThrow('Solo se permiten');
    await expect(guardarCorreccionRevisionGeneral(REG,9,{fachada:'0'})).rejects.toThrow('Solo se permiten');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('no confirma una respuesta incoherente del servidor', async () => {
    rpc.mockResolvedValueOnce({data:{version:10,registroId:REG,accion:'ocupar',
      correccion:correccion({vacio:'1'})},error:null});
    await expect(guardarCorreccionRevisionGeneral(REG,9,{vacio:'0',fachada:''}))
      .rejects.toThrow('no confirmó');
  });
});
