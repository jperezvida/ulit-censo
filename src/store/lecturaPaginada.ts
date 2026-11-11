import type { SupabaseClient } from '@supabase/supabase-js';
import { reconstruir, type InfoEspacioRemoto } from './almacenSupabase';
import type { BaseDatos } from '../domain/db';

/** Lectura autenticada, consistente y limitada a la campaña real de Medina. */
const ESPACIO_REAL = 'real-medina-del-campo-2026';
const POR_PAGINA = 250;
const MAX_PAGINAS = 100;
const MAX_ENTIDADES = 25000;

export class LecturaPaginadaNoDisponible extends Error {
  constructor() {
    super('La lectura rápida por lotes todavía no está instalada en el servidor.');
  }
}
export class LecturaPaginadaInconsistente extends Error {}

interface Pagina {
  version: number;
  cantidad: number;
  items: { c: string; id: string; v: unknown }[];
}

interface Acceso {
  espacio_id: string;
  tipo: string;
  version: number;
  escritura_habilitada: boolean;
  rol: string;
  persona_id: string;
}

/**
 * Evita pedir un único JSON gigante que puede acabar en 500/520. Cada página
 * contiene como máximo 250 entidades y comprueba la versión de Supabase.
 * En caso de fallo no entrega un censo parcial ni intenta escribir.
 */
export async function leerEspacioPaginado(
  cliente: SupabaseClient,
  espacioId: string,
  signal?: AbortSignal,
  onProgreso?: (entidades: number) => void,
): Promise<{ db: BaseDatos; info: InfoEspacioRemoto }> {
  if (espacioId !== ESPACIO_REAL) throw new LecturaPaginadaInconsistente('Espacio fuera del alcance de la revisión.');
  const accesoRpc = cliente.rpc('ulit_censo_mis_espacios', {}, { get: true });
  const { data: accesos, error: errorAcceso } =
    await (signal ? accesoRpc.abortSignal(signal) : accesoRpc);
  if (errorAcceso) throw new Error('No se pudo verificar la pertenencia al espacio real.');
  const acceso = (accesos as Acceso[] | null)?.find((x) => x.espacio_id === espacioId);
  if (!acceso || acceso.tipo !== 'real' || !['administrador','coordinador','revisor','investigador'].includes(acceso.rol)
    || !Number.isSafeInteger(Number(acceso.version)) || Number(acceso.version) < 1) {
    throw new LecturaPaginadaInconsistente('La sesión no acredita acceso al censo real.');
  }

  const version = Number(acceso.version);
  const entidades: Record<string, Record<string, unknown>> = {};
  let ultimaColeccion = '';
  let ultimoId = '';
  let total = 0;
  let terminada = false;

  for (let numero = 0; numero < MAX_PAGINAS; numero++) {
    const solicitud = cliente.rpc('ulit_censo_leer_parte', {
      p_espacio: espacioId,
      p_version_esperada: version,
      p_despues_coleccion: ultimaColeccion,
      p_despues_id: ultimoId,
      p_limite: POR_PAGINA,
    }, { get: true });
    const { data, error } = await (signal ? solicitud.abortSignal(signal) : solicitud);
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') throw new LecturaPaginadaNoDisponible();
      if (error.code === 'PT409') throw new LecturaPaginadaInconsistente(
        'El censo cambió mientras se cargaba. Compruebe el acceso de nuevo; no se han escrito datos.',
      );
      throw new Error(`No se pudo cargar una parte del censo: ${error.message}`);
    }
    const pagina = data as Pagina | null;
    if (!pagina || Number(pagina.version) !== version || !Array.isArray(pagina.items)
      || pagina.items.length > POR_PAGINA || Number(pagina.cantidad) !== pagina.items.length) {
      throw new LecturaPaginadaInconsistente('La respuesta del servidor no es consistente.');
    }
    for (const item of pagina.items) {
      if (!item || typeof item.c !== 'string' || typeof item.id !== 'string'
        || !item.c || !item.id || (item.c === ultimaColeccion && item.id === ultimoId)) {
        throw new LecturaPaginadaInconsistente('La paginación contiene una entidad sin identificador válido.');
      }
      const coleccion = entidades[item.c] ?? (entidades[item.c] = {});
      if (Object.prototype.hasOwnProperty.call(coleccion, item.id)) {
        throw new LecturaPaginadaInconsistente('La lectura contiene una entidad duplicada.');
      }
      coleccion[item.id] = item.v;
      ultimaColeccion = item.c;
      ultimoId = item.id;
      total++;
    }
    if (total > MAX_ENTIDADES) throw new LecturaPaginadaInconsistente('La lectura superó el límite de seguridad.');
    onProgreso?.(total);
    if (pagina.items.length < POR_PAGINA) { terminada = true; break; }
  }
  if (!terminada) throw new LecturaPaginadaInconsistente('No se alcanzó el final de la lectura autorizada.');

  const db = reconstruir(entidades);
  if (!db) throw new LecturaPaginadaInconsistente('Falta la raíz del espacio real. Lectura incompleta.');
  return { db, info: {
    espacioId, tipo: 'real', version,
    rol: acceso.rol, personaId: acceso.persona_id,
    escrituraHabilitada: acceso.escritura_habilitada,
    preparacionHabilitada: false,
  } };
}
