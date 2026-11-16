import type { RevisionCategoriaRegistro } from '../domain/types';
import { ID_CATALOGO_2026 } from '../domain/catalogo2026';
import { validarSeleccion } from '../domain/clasificacion';
import { clienteServidor } from './clienteSupabase';

const ESPACIO = 'real-medina-del-campo-2026';
const CAMPANA = 'real-camp-medina-2026-censo-medina-del-campo-2026';
const RPC = 'ulit_censo_categoria_registro_2026';

export interface CapacidadCategoriaReal {
  habilitada: boolean;
  version?: number;
  catalogo?: string;
  alcance?: string;
  motivo?: string;
  respaldoAutomatico?: boolean;
}

export interface CambioCategoriaReal {
  registroId: string;
  itinerarioId: string;
  version: number;
  accion: 'aceptar' | 'rechazar' | 'corregir';
  revision: RevisionCategoriaRegistro;
}

export async function capacidadCategoriaReal(): Promise<CapacidadCategoriaReal> {
  const cliente = clienteServidor();
  if (!cliente) return { habilitada: false, motivo: 'No hay conexión con el censo real.' };
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO, p_accion: 'estado',
    p_version_esperada: 0, p_registro_id: '', p_nodo_id: '', p_descripcion: '',
  });
  if (error) return { habilitada: false, motivo:
    ['PGRST202','42883'].includes(error.code ?? '')
      ? 'La categorización supervisada todavía no está autorizada en el servidor.'
      : 'No se ha podido verificar el permiso de categorización.' };
  const res = data as CapacidadCategoriaReal | null;
  return res?.habilitada && res.catalogo === ID_CATALOGO_2026
    && res.alcance === 'clasificacion-por-fila-2026' ? res
    : { habilitada: false, motivo: 'Permisos o catálogo oficial no verificables.' };
}

export async function guardarCategoriaReal(
  registroId: string, itinerarioId: string, version: number,
  accion: CambioCategoriaReal['accion'], nodoId = '', descripcion = '',
): Promise<CambioCategoriaReal> {
  const cliente = clienteServidor();
  if (!cliente) throw new Error('Conexión institucional no disponible.');
  if (!registroId || !itinerarioId || !Number.isSafeInteger(version) || version < 8
    || !['aceptar','rechazar','corregir'].includes(accion)
    || descripcion.length > 250) {
    throw new Error('No se puede validar la solicitud de categorización.');
  }
  if (accion === 'rechazar') {
    if (nodoId || descripcion) throw new Error('Rechazar no debe incluir otra categoría.');
  } else {
    validarSeleccion(ID_CATALOGO_2026, nodoId, descripcion);
  }
  const { data, error } = await cliente.rpc(RPC, {
    p_espacio: ESPACIO, p_accion: accion, p_version_esperada: version,
    p_registro_id: registroId, p_nodo_id: nodoId, p_descripcion: descripcion.trim(),
  });
  if (error?.code === 'PT409') throw new Error(
    'El censo ha cambiado en otra sesión. Actualiza los datos antes de continuar.');
  if (error) throw new Error(error.message.replace(/^ULIT Censo: /, ''));
  const resultado = data as Partial<CambioCategoriaReal> | null;
  const revision = resultado?.revision;
  if (!revision || resultado?.version !== version + 1
    || resultado.registroId !== registroId || resultado.itinerarioId !== itinerarioId
    || resultado.accion !== accion || revision.id !== registroId
    || revision.registroId !== registroId || revision.itinerarioId !== itinerarioId
    || revision.campanaId !== CAMPANA || revision.catalogoId !== ID_CATALOGO_2026
    || revision.estado !== ({ aceptar: 'aceptada', rechazar: 'rechazada',
      corregir: 'corregida' } as const)[accion]
    || (accion !== 'rechazar' && revision.nodoId !== nodoId)
    || (accion === 'rechazar' && !!revision.nodoId)
    || !revision.porId || !revision.fecha || !revision.nombreRevisado
    || !revision.valores || typeof revision.valores !== 'object') {
    throw new Error('El servidor no confirmó la categoría. Comprueba la ficha antes de repetir.');
  }
  return { registroId, itinerarioId, version: version + 1, accion, revision };
}
