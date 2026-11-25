import { clienteServidor } from './clienteSupabase';
import { ESPACIO_REVISION_2026 } from './revisionGeneralReal';
import type { RevisionFranquiciaRegistro } from '../domain/types';
import type { DecisionFranquiciaIT1 } from '../domain/revisionFranquiciaIT1';

const RPC = 'ulit_censo_franquicias_it1_2026';
const CAMPANA = 'real-camp-medina-2026-censo-medina-del-campo-2026';

export interface CambioFranquiciaIT1 {
  version: number;
  accion: DecisionFranquiciaIT1['accion'];
  revisiones: RevisionFranquiciaRegistro[];
}
export interface CapacidadFranquiciaIT1 { habilitada: boolean; motivo?: string; }

export async function capacidadFranquiciaIT1(): Promise<CapacidadFranquiciaIT1> {
  const cliente = clienteServidor();
  if (!cliente) return { habilitada: false, motivo: 'No hay conexión al servidor.' };
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO_REVISION_2026, p_accion: 'estado',
    p_version_esperada: 0, p_ids: [], p_respuesta: null,
  });
  if (error) return { habilitada:false, motivo:['PGRST202','42883'].includes(error.code ?? '')
    ? 'La revisión de franquicias aún no está instalada en el servidor (0017).'
    : 'No se pudo comprobar la autorización de franquicias.' };
  const r = data as { habilitada?: boolean; alcance?: string } | null;
  return r?.habilitada && r.alcance === 'it1-franquicias-supervisadas'
    ? { habilitada: true } : { habilitada:false, motivo:'Permiso de franquicias no verificable.' };
}

export async function guardarFranquiciaIT1(
  decision: DecisionFranquiciaIT1, version: number,
): Promise<CambioFranquiciaIT1> {
  if (!Number.isSafeInteger(version) || version < 8 ||
      !decision.ids.length || decision.ids.length > 200 ||
      new Set(decision.ids).size !== decision.ids.length ||
      decision.ids.some((id) => typeof id !== 'string' || id.length < 5 || id.length > 350) ||
      !['aceptar','rechazar','resolver','aceptar-todas'].includes(decision.accion) ||
      (decision.accion === 'resolver' ? !['si','no'].includes(decision.respuesta ?? '') : !!decision.respuesta) ||
      (decision.accion !== 'aceptar-todas' && decision.ids.length !== 1)) {
    throw new Error('La decisión de franquicia no es válida.');
  }
  const cliente = clienteServidor();
  if (!cliente) throw new Error('No hay conexión al servidor.');
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO_REVISION_2026, p_accion: decision.accion,
    p_version_esperada: version, p_ids: decision.ids,
    p_respuesta: decision.respuesta ?? null,
  });
  if (error?.code === 'PT409') throw new Error('Otra operación modificó el censo. Comprueba el guardado y recarga antes de continuar.');
  if (error) throw new Error(error.message.replace(/^ULIT Censo: /,''));
  const r = data as CambioFranquiciaIT1 | null;
  const ids = new Set(decision.ids);
  const expected = decision.accion === 'rechazar' ? 'rechazada' :
    decision.accion === 'resolver' ? 'corregida' : 'aceptada';
  if (!r || r.version !== version+1 || r.accion !== decision.accion ||
      !Array.isArray(r.revisiones) || r.revisiones.length !== ids.size ||
      !r.revisiones.every((v) => ids.has(v.registroId) && v.id === v.registroId &&
        v.campanaId === CAMPANA && v.estado === expected && !!v.porId && !!v.fecha &&
        (expected === 'rechazada' ? !v.respuesta : ['si','no'].includes(v.respuesta ?? '')))) {
    throw new Error('El servidor no confirmó la revisión de franquicia. Comprueba la ficha.');
  }
  return r;
}
