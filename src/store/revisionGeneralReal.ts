import type { CorreccionRegistro } from '../domain/types';
import { clienteServidor } from './clienteSupabase';

/** Espacio real; nunca se usa la escritura genérica para Fase 1. */
export const ESPACIO_REVISION_2026 = 'real-medina-del-campo-2026';
const CAMPANA_2026 = 'real-camp-medina-2026-censo-medina-del-campo-2026';

export interface CapacidadRevisionGeneral {
  habilitada: boolean;
  version?: number;
  motivo?: string;
  alcance?: string;
  respaldoAutomatico?: boolean;
}

/** Resultado firmado por la RPC, con la entidad efectiva completa para no releer 9.000 entidades. */
export interface CambioRevisionGeneralReal {
  registroId: string;
  version: number;
  correccion: CorreccionRegistro;
}

const RPC = 'ulit_censo_revision_fase1_2026';

/** La capacidad es específica del servidor y exige que la RPC declare su alcance. */
export async function capacidadRevisionGeneral(): Promise<CapacidadRevisionGeneral> {
  const cliente = clienteServidor();
  if (!cliente) return { habilitada: false, motivo: 'Conexión institucional no configurada.' };
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO_REVISION_2026,
    p_accion: 'estado', p_version_esperada: 0, p_registro_id: '', p_metros: '',
  });
  if (error) return { habilitada: false, motivo:
    ['PGRST202','42883'].includes(error.code ?? '')
      ? 'El guardado supervisado aún no está instalado en el servidor.'
      : 'No se pudo comprobar la autorización de guardado.' };
  const estado = data as CapacidadRevisionGeneral | null;
  return estado?.habilitada === true && estado.alcance === 'fachada-y-ocupacion'
    ? estado : { habilitada: false, motivo: estado?.motivo || 'Autorización no verificable.' };
}

/**
 * Lista blanca: (a) fachada positiva en un vacío, o (b) vacío→ocupado y retirar
 * fachada. El backend vuelve a comprobar rol, campaña, estado, nombre y versión.
 */
export async function guardarCorreccionRevisionGeneral(
  registroId: string,
  version: number,
  valores: Record<string, string>,
  _motivo?: string,
): Promise<CambioRevisionGeneralReal> {
  const cliente = clienteServidor();
  if (!cliente) throw new Error('No se puede conectar con el servidor.');
  const claves = Object.keys(valores).sort();
  const ocupar = claves.join(',') === 'fachada,vacio'
    && valores.vacio === '0' && valores.fachada === '';
  const fachada = claves.join(',') === 'fachada'
    && /^[0-9]{1,5}([,.][0-9]{1,3})?$/.test((valores.fachada ?? '').trim())
    && Number(valores.fachada.replace(',','.')) > 0;
  if (!registroId || !Number.isSafeInteger(version) || version < 8 || (!ocupar && !fachada)) {
    throw new Error('Solo se permiten los metros de fachada o confirmar la ocupación de un local con nombre.');
  }
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO_REVISION_2026,
    p_accion: ocupar ? 'ocupar' : 'guardar',
    p_version_esperada: version,
    p_registro_id: registroId,
    p_metros: ocupar ? '' : valores.fachada.trim(),
  });
  if (error?.code === 'PT409') throw new Error(
    'Otra corrección ha actualizado el censo. Recarga la ficha antes de volver a guardar.',
  );
  if (error) throw new Error(error.message.replace(/^ULIT Censo: /, ''));
  const resultado = data as {
    version?: unknown;
    registroId?: unknown;
    correccion?: CorreccionRegistro;
    accion?: string;
  } | null;
  const entidad = resultado?.correccion;
  if (resultado?.registroId !== registroId || Number(resultado.version) !== version + 1
    || resultado.accion !== (ocupar ? 'ocupar' : 'guardar')
    || entidad?.id !== registroId || entidad.registroId !== registroId
    || entidad.campanaId !== CAMPANA_2026 || !entidad.porId || !entidad.fecha
    || !entidad.valores || !Array.isArray(entidad.historial)
    || (ocupar ? entidad.valores.vacio !== '0' ||
      !['',undefined].includes(entidad.valores.fachada) : entidad.valores.fachada !== valores.fachada.trim())) {
    throw new Error('El servidor no confirmó la corrección. Comprueba la ficha antes de repetirla.');
  }
  return { registroId, version: version + 1, correccion: entidad };
}
