import type { RevisionCategoriaRegistro } from '../domain/types';
import { CLAVES_CATEGORIA, type ValoresCategoria } from '../domain/revisionCategoriaIT1';
import { clienteServidor } from './clienteSupabase';
import { ESPACIO_REVISION_2026 } from './revisionGeneralReal';

const RPC = 'ulit_censo_categorizar_it1_2026';
export interface CambioCategoriaIT1 {
  registroId: string;
  version: number;
  revision: RevisionCategoriaRegistro;
}
export interface CapacidadCategoriaIT1 {
  habilitada: boolean;
  motivo?: string;
  alcance?: string;
}

export async function capacidadCategoriaIT1(): Promise<CapacidadCategoriaIT1> {
  const cliente = clienteServidor();
  if (!cliente) return { habilitada: false, motivo: 'No hay conexión al servidor.' };
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO_REVISION_2026, p_accion: 'estado',
    p_version_esperada: 0, p_registro_id: '', p_valores: {},
  });
  if (error) return { habilitada: false,
    motivo: ['PGRST202','42883'].includes(error.code ?? '')
      ? 'La revisión de categorías aún no está instalada en el servidor.'
      : 'No se pudo comprobar el permiso de categorización.' };
  const estado = data as CapacidadCategoriaIT1 | null;
  return estado?.habilitada && estado.alcance === 'it1-categorias-supervisadas'
    ? estado : { habilitada: false, motivo: 'Permiso de revisión no verificable.' };
}

export async function guardarCategoriaIT1(
  registroId: string, version: number,
  accion: 'aceptar' | 'rechazar' | 'corregir',
  valores: ValoresCategoria,
): Promise<CambioCategoriaIT1> {
  if (!registroId || !Number.isSafeInteger(version) || version < 8
    || !CLAVES_CATEGORIA.every((clave) => typeof valores[clave] === 'string'
      && valores[clave].length <= 300)
    || Object.keys(valores).sort().join(',') !== [...CLAVES_CATEGORIA].sort().join(',')
    || (accion === 'corregir' && (!valores.grupoActividad || !valores.subgrupo))
    || (!['aceptar','rechazar','corregir'] as string[]).includes(accion)) {
    throw new Error('La categoría seleccionada no es válida.');
  }
  const cliente = clienteServidor();
  if (!cliente) throw new Error('No hay conexión al servidor.');
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO_REVISION_2026, p_accion: accion,
    p_version_esperada: version, p_registro_id: registroId, p_valores: valores,
  });
  if (error?.code === 'PT409') throw new Error(
    'El censo ha cambiado. Actualiza la página antes de guardar otra categoría.');
  if (error) throw new Error(error.message.replace(/^ULIT Censo: /, ''));
  const r = data as { version?: number; registroId?: string; accion?: string; revision?: RevisionCategoriaRegistro } | null;
  if (!r || r.version !== version + 1 || r.registroId !== registroId || r.accion !== accion
    || !r.revision || r.revision.id !== registroId || r.revision.registroId !== registroId
    || r.revision.campanaId !== 'real-camp-medina-2026-censo-medina-del-campo-2026'
    || r.revision.estado !== (accion === 'aceptar' ? 'aceptada' : accion === 'rechazar' ? 'rechazada' : 'corregida')
    || !r.revision.porId || !r.revision.fecha
    || !CLAVES_CATEGORIA.every((clave) => r.revision!.valores?.[clave] === valores[clave])) {
    throw new Error('El servidor no confirmó la categoría. Comprueba la ficha.');
  }
  return { registroId, version: r.version, revision: r.revision };
}
