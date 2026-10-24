import type { BaseDatos } from './db';
import { interpretarXlsx, type EleccionLectura, type ResultadoInterpretacion } from './xlsx/interpretacion';
import { LIMITES_XLSX } from './xlsx/lector';
import { opcionesInterpretacion, planificarIncorporacion, type DecisionesIncorporacion, type DestinoIncorporacion, type PlanIncorporacion } from './incorporacion';

/**
 * C1c · Prepara la incorporación de un XLSX: lo lee con el lector seguro (límites de C1a), lo
 * interpreta con C1b usando SOLO las decisiones recibidas y construye el plan. No modifica nada
 * ni guarda el archivo: los bytes se descartan al terminar.
 */
export async function prepararIncorporacion(
  db: BaseDatos, datos: Uint8Array, nombreArchivo: string, destino: DestinoIncorporacion, decisiones: DecisionesIncorporacion = {}, eleccion: EleccionLectura = {},
): Promise<{ resultado: ResultadoInterpretacion; plan: PlanIncorporacion }> {
  const resultado = await interpretarXlsx(datos, nombreArchivo, opcionesInterpretacion(destino.municipioId, destino.anio, decisiones), LIMITES_XLSX, eleccion);
  return { resultado, plan: planificarIncorporacion(db, resultado, destino, decisiones) };
}
