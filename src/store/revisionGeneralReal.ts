import { clienteServidor } from './clienteSupabase';

/** Escritura específica de la fase 1: el Excel original es inmutable. */
export const ESPACIO_REVISION_2026 = 'real-medina-del-campo-2026';

export interface CapacidadRevisionGeneral {
  habilitada: boolean;
  version?: number;
  motivo?: string;
}

/**
 * Comprueba que la RPC específica está instalada Y que existe una copia íntegra
 * de la versión previa a la primera corrección. No concede permisos desde el cliente.
 */
export async function capacidadRevisionGeneral(): Promise<CapacidadRevisionGeneral> {
  const cliente = clienteServidor();
  if (!cliente) return { habilitada: false, motivo: 'Conexión al servidor sin configurar.' };
  const { data, error } = await cliente.rpc('ulit_censo_revision_general_2026', {
    p_espacio: ESPACIO_REVISION_2026,
    p_accion: 'estado',
    p_version_esperada: 0,
    p_registro_id: '',
    p_valores: {},
    p_motivo: '',
  });
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) return {
      habilitada: false, motivo: 'El guardado supervisado de esta fase aún no está autorizado en el servidor.',
    };
    return { habilitada: false, motivo: 'No se ha podido verificar el permiso para corregir.' };
  }
  const estado = data as CapacidadRevisionGeneral | null;
  return estado && typeof estado.habilitada === 'boolean' ? estado
    : { habilitada: false, motivo: 'El servidor no devolvió un permiso verificable.' };
}

/**
 * No se admite guardado genérico: únicamente cambios de celdas aprobados por la RPC.
 * PT409 indica conflicto; NUNCA se reintenta automáticamente un cambio incierto.
 */
export async function guardarCorreccionRevisionGeneral(
  registroId: string, version: number, valores: Record<string, string>, motivo: string,
): Promise<number> {
  const cliente = clienteServidor();
  if (!cliente) throw new Error('No se ha podido abrir la conexión segura con el servidor.');
  if (!registroId || !Number.isSafeInteger(version) || version < 8 || !motivo.trim() || Object.keys(valores).length > 25) {
    throw new Error('La propuesta de corrección está incompleta o no es válida.');
  }
  const { data, error } = await cliente.rpc('ulit_censo_revision_general_2026', {
    p_espacio: ESPACIO_REVISION_2026,
    p_accion: 'guardar',
    p_version_esperada: version,
    p_registro_id: registroId,
    p_valores: valores,
    p_motivo: motivo.trim(),
  });
  if (error?.code === 'PT409') {
    throw new Error('La base ha cambiado desde que abriste la ficha. Recarga antes de revisar: no se ha sobrescrito nada.');
  }
  if (error) throw new Error(error.message.replace(/^ULIT Censo: /, ''));
  const resultado = data as { version?: unknown; registroId?: unknown } | null;
  if (resultado?.registroId !== registroId || !Number.isSafeInteger(Number(resultado.version)) || Number(resultado.version) <= version) {
    throw new Error('No se pudo verificar el guardado. No repitas la operación: recarga los datos desde el servidor.');
  }
  return Number(resultado.version);
}
