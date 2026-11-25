import type { DecisionFranquiciaIT1 } from '../domain/revisionFranquiciaIT1';
import type { CambioFranquiciaIT1 } from './franquiciaIT1Real';

export interface EstadoColaFranquiciaIT1 {
  pendientes: DecisionFranquiciaIT1[];
  error: string;
}

/** Cola secuencial: la UI avanza inmediatamente, pero solo se confirma con ACK del servidor. */
export function crearColaFranquiciaIT1(
  versionInicial: number,
  guardar: (decision: DecisionFranquiciaIT1, version: number) => Promise<CambioFranquiciaIT1>,
  confirmar: (cambio: CambioFranquiciaIT1) => void,
  publicar: (estado: EstadoColaFranquiciaIT1) => void,
) {
  let version = versionInicial;
  let pendientes: DecisionFranquiciaIT1[] = [];
  let error = '';
  let procesando = false;
  const consultar = () => ({ pendientes: [...pendientes], error });
  const avisar = () => publicar(consultar());
  const procesar = async () => {
    if (procesando || error || !pendientes.length) return;
    procesando = true;
    try {
      while (pendientes.length && !error) {
        let cambio: CambioFranquiciaIT1;
        try { cambio = await guardar(pendientes[0],version); }
        catch (e) {
          error = e instanceof Error ? e.message : String(e);
          avisar();
          return;
        }
        version = cambio.version;
        pendientes = pendientes.slice(1);
        try { confirmar(cambio); }
        catch (e) {
          error = 'Guardado confirmado, pero la pantalla no se actualizó. Comprueba los datos antes de continuar: '
            + (e instanceof Error ? e.message : String(e));
          avisar();
          return;
        }
        avisar();
      }
    } finally { procesando = false; }
  };
  const encolar = (d: DecisionFranquiciaIT1) => {
    const ocupados = new Set(pendientes.flatMap((x) => x.ids));
    if (error || !d.ids.length || pendientes.reduce((s,x)=>s+x.ids.length,0)+d.ids.length > 200 ||
      d.ids.some((id) => ocupados.has(id))) return false;
    pendientes = [...pendientes, { ...d, ids: [...d.ids] }];
    avisar();
    void procesar();
    return true;
  };
  const reintentar = () => {
    if (!error || !pendientes.length) return;
    error = '';
    avisar();
    void procesar();
  };
  const sincronizarVersion = (nueva: number) => {
    if (pendientes.length) throw new Error('Hay decisiones de franquicia por confirmar.');
    version = nueva;
  };
  return { consultar, encolar, reintentar, sincronizarVersion };
}
