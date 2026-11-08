import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * ÚNICA vía de conciliación de datos reales. Nunca se envían entidades
 * arbitrarias ni se abre ulit_censo_aplicar al navegador.
 */
const ESPACIO_REAL = 'real-medina-del-campo-2026';
const RPC = 'ulit_censo_conciliar_it1_2026';
export type AccionReal = 'vincular' | 'local-nuevo' | 'mantener-pendiente' | 'deshacer';

export interface DecisionIt1 {
  versionEsperada: number;
  registroId: string;
  accion: AccionReal;
  localId?: string | null;
  motivo?: string;
  /** Decisión humana explícita si ya existe otro local en el mismo portal. */
  localDistintoConfirmado?: boolean;
}
export interface ResultadoDecision {
  version: number;
  accion: AccionReal;
  registroId: string;
  localId: string | null;
}

export async function conciliacionDisponible(
  cliente: SupabaseClient, versionEsperada: number,
): Promise<boolean> {
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO_REAL,
    p_version_esperada: versionEsperada,
    p_registro_id: '',
    p_accion: 'estado',
    p_local_id: null,
    p_motivo: null,
  });
  // El esquema NO se ha migrado: la pantalla sigue en consulta, sin botones.
  if (error?.code === 'PGRST202' || error?.code === '42883') return false;
  if (error) throw new Error(error.message);
  const estado = data as { habilitada?: boolean; version?: number } | null;
  return estado?.habilitada === true && Number.isSafeInteger(estado.version);
}

export async function guardarDecisionIt1(
  cliente: SupabaseClient, d: DecisionIt1,
): Promise<ResultadoDecision> {
  if (!Number.isSafeInteger(d.versionEsperada) || d.versionEsperada < 4) {
    throw new Error('Versión real no verificada. Recargue Oficina.');
  }
  if (!d.registroId || d.registroId.length > 350 ||
      !['vincular', 'local-nuevo', 'mantener-pendiente', 'deshacer'].includes(d.accion)) {
    throw new Error('La decisión no corresponde a una fila real válida.');
  }
  if (d.accion === 'vincular' ? !d.localId : !!d.localId) {
    throw new Error('Selección de local incompatible con la decisión.');
  }
  if ((d.motivo?.trim().length ?? 0) < 8) {
    throw new Error('Escriba un motivo concreto de al menos ocho caracteres.');
  }
  if (d.accion !== 'local-nuevo' && d.localDistintoConfirmado) {
    throw new Error('Confirmación de local distinto incompatible con la acción.');
  }
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO_REAL,
    p_version_esperada: d.versionEsperada,
    p_registro_id: d.registroId,
    p_accion: d.accion,
    p_local_id: d.accion === 'vincular' ? d.localId : null,
    p_motivo: d.motivo!.trim(),
    p_confirmar_distinto: d.accion === 'local-nuevo' && d.localDistintoConfirmado === true,
  });
  if (error) {
    if (error.code === 'PT409') throw new Error('Otra pestaña o persona guardó antes. Recargue los datos: no se ha sobrescrito nada.');
    throw new Error(error.message + ' Si no puede verificar el estado, no repita la acción: recargue Oficina.');
  }
  const resultado = data as ResultadoDecision | null;
  if (!resultado || resultado.version !== d.versionEsperada + 1 ||
      resultado.registroId !== d.registroId || resultado.accion !== d.accion) {
    throw new Error('El servidor respondió sin confirmación verificable. No repita la acción: consulte el estado actual.');
  }
  return resultado;
}
