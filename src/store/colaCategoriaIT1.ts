import type { CambioCategoriaIT1 } from './categoriaIT1Real';
import type { ValoresCategoria } from '../domain/revisionCategoriaIT1';

export type AccionCategoriaIT1 = 'aceptar' | 'rechazar' | 'corregir';
export interface DecisionCategoriaIT1 {
  registroId: string;
  accion: AccionCategoriaIT1;
  valores: ValoresCategoria;
}
export interface EstadoColaCategoriaIT1 {
  pendientes: DecisionCategoriaIT1[];
  error: string;
}

/**
 * Cola EN MEMORIA de escrituras reales. El avance de pantalla es inmediato, pero
 * ninguna revisión pasa a "guardada" hasta recibir respuesta válida de la RPC.
 * Las operaciones se envían de una en una porque cada una incrementa la versión
 * global de ULIT Censo; jamás se paralelizan con una versión obsoleta.
 */
export function crearColaCategoriaIT1(
  versionInicial: number,
  guardar: (registroId: string, version: number, accion: AccionCategoriaIT1,
    valores: ValoresCategoria) => Promise<CambioCategoriaIT1>,
  confirmar: (cambio: CambioCategoriaIT1) => void,
  publicar: (estado: EstadoColaCategoriaIT1) => void,
) {
  let version = versionInicial;
  let pendientes: DecisionCategoriaIT1[] = [];
  let error = '';
  let procesando = false;
  const consultar = (): EstadoColaCategoriaIT1 => ({
    pendientes: [...pendientes], error,
  });
  const avisar = () => publicar(consultar());

  const procesar = async (): Promise<void> => {
    if (procesando || error || !pendientes.length) return;
    procesando = true;
    try {
      while (pendientes.length && !error) {
        const decision = pendientes[0];
        let cambio: CambioCategoriaIT1;
        try {
          cambio = await guardar(decision.registroId, version, decision.accion, decision.valores);
        } catch (e) {
          // El servidor pudo haber guardado aunque la conexión perdiera la respuesta.
          // Nunca reintentar automáticamente, para no duplicar operaciones.
          error = e instanceof Error ? e.message : String(e);
          avisar();
          return;
        }
        // La RPC confirmó la escritura: quitar de la cola antes de notificar.
        version = cambio.version;
        pendientes = pendientes.slice(1);
        try {
          confirmar(cambio);
        } catch (e) {
          error = 'Guardado en servidor, pero la pantalla no se actualizó. Comprueba los datos antes de continuar: '
            + (e instanceof Error ? e.message : String(e));
          avisar();
          return;
        }
        avisar();
      }
    } finally {
      procesando = false;
    }
  };

  const encolar = (decision: DecisionCategoriaIT1): boolean => {
    if (error || !decision.registroId || pendientes.length >= 200) return false;
    const anteriores = pendientes.filter((p) => p.registroId === decision.registroId);
    // Es válido rechazar y, sin esperar al servidor, elegir la nueva categoría.
    if (anteriores.length && !(anteriores.length === 1
      && anteriores[0].accion === 'rechazar' && decision.accion === 'corregir')) return false;
    pendientes = [...pendientes, { ...decision, valores: { ...decision.valores } }];
    avisar();
    void procesar();
    return true;
  };
  const reintentar = (): void => {
    if (!error || !pendientes.length) return;
    error = '';
    avisar();
    void procesar();
  };
  const sincronizarVersion = (nueva: number): void => {
    if (pendientes.length) throw new Error('Hay categorías sin confirmar. No se puede recargar el censo todavía.');
    version = nueva;
  };
  return { consultar, encolar, reintentar, sincronizarVersion };
}
