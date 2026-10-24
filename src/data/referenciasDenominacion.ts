import type { ReferenciaDenominacion } from '../domain/types';

/**
 * G3 · Referencias de denominación DE PARTIDA de cada municipio (datos con su fuente, no lógica). Se
 * copian al callejero del municipio al crear un espacio y, a partir de ahí, se gestionan desde la
 * interfaz (añadir o retirar). Las bases anteriores a G3, que aún no tienen la lista guardada, las usan
 * tal cual. Clave: identificador del municipio sin el prefijo del espacio.
 */
export const REFERENCIAS_INICIALES: Record<string, ReferenciaDenominacion[]> = {
  'mun-medina': [
    {
      denominacion: 'Plaza Mayor',
      oficial: 'Plaza Mayor de la Hispanidad',
      nota: 'Indicado por la Cátedra al revisar el censo 2025: «Plaza Mayor» corresponde a la Plaza Mayor de la Hispanidad.',
      fuente: 'Cátedra (revisión del censo 2025)',
      fecha: '2026-10-24',
    },
  ],
};
