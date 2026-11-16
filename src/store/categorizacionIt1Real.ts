import type { CorreccionRegistro } from '../domain/types';
import type { CambioRevisionGeneralReal, CapacidadRevisionGeneral } from './revisionGeneralReal';
import { ESPACIO_REVISION_2026 } from './revisionGeneralReal';
import type { ValoresCategorizacion } from '../domain/revisionCategorizacionIt1';
import { CLAVES_CATEGORIZACION } from '../domain/revisionCategorizacionIt1';
import { clienteServidor } from './clienteSupabase';

const RPC = 'ulit_censo_categoria_it1_2026';
const CAMPANA = 'real-camp-medina-2026-censo-medina-del-campo-2026';
export type AccionCategoria = 'aceptar' | 'rechazar' | 'asignar';

export async function capacidadCategorizacionIt1(): Promise<CapacidadRevisionGeneral> {
  const cliente = clienteServidor();
  if (!cliente) return { habilitada: false, motivo: 'Sin conexión institucional.' };
  const {data,error} = await cliente.rpc(RPC, {p_espacio:ESPACIO_REVISION_2026,
    p_accion:'estado',p_version_esperada:0,p_registro_id:'',p_valores:null});
  if (error) return { habilitada: false, motivo: 'Guardado de categorías no instalado o sin autorización.' };
  const estado = data as CapacidadRevisionGeneral | null;
  return estado?.habilitada === true && estado.alcance === 'categoria-it1-2026'
    ? estado : {habilitada:false,motivo:'El servidor no confirmó el alcance de la categorización.'};
}

export async function guardarCategoriaIt1(
  registroId: string, version: number, accion: AccionCategoria,
  valores?: ValoresCategorizacion,
): Promise<CambioRevisionGeneralReal> {
  if (!registroId || !Number.isSafeInteger(version) || version < 8
    || !['aceptar','rechazar','asignar'].includes(accion)) {
    throw new Error('Revisión de categoría o versión inválida.');
  }
  if (accion === 'asignar') {
    if (!valores || Object.keys(valores).length !== CLAVES_CATEGORIZACION.length
      || CLAVES_CATEGORIZACION.some((k) => typeof valores[k] !== 'string' || valores[k].length > 220)
      || !valores.grupoActividad || !valores.subgrupo) {
      throw new Error('Selecciona una clasificación válida del catálogo 2026.');
    }
  } else if (valores) {
    throw new Error('Aceptar o rechazar nunca modifica la categoría existente.');
  }
  const cliente = clienteServidor();
  if (!cliente) throw new Error('No hay conexión con el servidor.');
  const {data,error} = await cliente.rpc(RPC,{
    p_espacio:ESPACIO_REVISION_2026,p_accion:accion,
    p_version_esperada:version,p_registro_id:registroId,
    p_valores:accion==='asignar'?valores:null,
  });
  if (error?.code==='PT409') throw new Error('Otra revisión ha cambiado el censo. Recarga antes de continuar.');
  if (error) throw new Error(error.message.replace(/^ULIT Censo: /,''));
  const resultado = data as {version?:number;registroId?:string;accion?:string;correccion?:CorreccionRegistro}|null;
  const correccion = resultado?.correccion;
  if (resultado?.version !== version+1 || resultado.registroId !== registroId
    || resultado.accion !== accion || !correccion
    || correccion.id !== registroId || correccion.registroId !== registroId
    || correccion.campanaId !== CAMPANA
    || !correccion.porId || !correccion.fecha
    || !Array.isArray(correccion.historial) || !correccion.valores
    || correccion.revisionClasificacion?.estado !== (accion==='rechazar'?'rechazada':'aceptada')
    || !CLAVES_CATEGORIZACION.every((c) => typeof correccion.revisionClasificacion?.valores[c]==='string')
    || (accion==='asignar' && !CLAVES_CATEGORIZACION.every((c) =>
      correccion.valores[c]===valores?.[c] && correccion.revisionClasificacion?.valores[c]===valores[c]))) {
    throw new Error('El servidor no confirmó la clasificación. No repitas sin comprobar la ficha.');
  }
  return {registroId,version:version+1,correccion};
}
