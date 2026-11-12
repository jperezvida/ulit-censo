import { clienteServidor } from './clienteSupabase';

/** Guardado REAL 2026: únicamente metros de fachada de locales vacíos. */
export const ESPACIO_REVISION_2026 = 'real-medina-del-campo-2026';

export interface CapacidadRevisionGeneral {
  habilitada: boolean;
  version?: number;
  motivo?: string;
  alcance?: string;
  respaldoAutomatico?: boolean;
}

/** La copia inicial es creada atómicamente por el servidor en el primer guardado. */
export async function capacidadRevisionGeneral(): Promise<CapacidadRevisionGeneral> {
  const cliente = clienteServidor();
  if (!cliente) return { habilitada: false, motivo: 'No está configurada la conexión institucional.' };
  const { data, error } = await cliente.rpc('ulit_censo_fachada_2026', {
    p_espacio: ESPACIO_REVISION_2026, p_accion: 'estado',
    p_version_esperada: 0, p_registro_id: '', p_metros: '',
  });
  if (error) {
    return { habilitada: false, motivo: ['PGRST202','42883'].includes(error.code ?? '')
      ? 'Todavía no está instalada la autorización de metros de fachada.'
      : 'No ha sido posible comprobar el permiso de guardado.' };
  }
  const estado = data as CapacidadRevisionGeneral | null;
  return estado?.habilitada === true && estado.alcance === 'fachada-vacios'
    ? estado : { habilitada: false, motivo: estado?.motivo || 'Permiso no verificable.' };
}

/** Sin escritura genérica. No se permite alterar otros campos por esta vía. */
export async function guardarCorreccionRevisionGeneral(
  registroId: string, version: number, valores: Record<string, string>, _motivo?: string,
): Promise<number> {
  const cliente = clienteServidor();
  if (!cliente) throw new Error('No se puede conectar con Supabase.');
  const claves = Object.keys(valores);
  const metros = valores.fachada ?? '';
  if (!registroId || !Number.isSafeInteger(version) || version < 8
    || claves.length !== 1 || claves[0] !== 'fachada'
    || !/^[0-9]{1,5}([,.][0-9]{1,3})?$/.test(metros.trim())
    || Number(metros.replace(',','.')) <= 0) {
    throw new Error('Ahora solo se pueden guardar metros positivos de fachada para locales vacíos.');
  }
  const { data, error } = await cliente.rpc('ulit_censo_fachada_2026', {
    p_espacio: ESPACIO_REVISION_2026, p_accion: 'guardar',
    p_version_esperada: version, p_registro_id: registroId, p_metros: metros.trim(),
  });
  if (error?.code === 'PT409') {
    throw new Error('El censo se ha actualizado. Recarga antes de guardar de nuevo para no sobrescribir cambios.');
  }
  if (error) throw new Error(error.message.replace(/^ULIT Censo: /,''));
  const resultado = data as { version?: unknown; registroId?: unknown } | null;
  if (resultado?.registroId !== registroId
    || !Number.isSafeInteger(Number(resultado.version))
    || Number(resultado.version) <= version) {
    throw new Error('El servidor no confirmó el guardado. No repitas la operación: comprueba primero la ficha.');
  }
  return Number(resultado.version);
}
