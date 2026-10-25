import type { ReferenciaDenominacion } from '../domain/types';

/**
 * G3 · Referencias de denominación DE PARTIDA de cada municipio (datos con su procedencia, no lógica).
 * Se copian al callejero del municipio al crear un espacio y, a partir de ahí, se gestionan desde la
 * interfaz (añadir o retirar). Las bases anteriores a G3, que aún no tienen la lista guardada, las usan
 * tal cual. Clave: identificador del municipio sin el prefijo del espacio.
 *
 * La de la Plaza Mayor NO es un acuerdo institucional documentado: es una referencia aportada durante la
 * revisión del censo 2025, pendiente de respaldo documental o de validación formal.
 */
export const REFERENCIAS_INICIALES: Record<string, ReferenciaDenominacion[]> = {
  'mun-medina': [
    {
      denominacion: 'Plaza Mayor',
      oficial: 'Plaza Mayor de la Hispanidad',
      nota: 'Referencia aportada durante la revisión del censo 2025: «Plaza Mayor» correspondería a la Plaza Mayor de la Hispanidad. Pendiente de respaldo documental o de validación formal.',
      fuente: 'Revisión del censo 2025 (referencia aportada; sin documentación que la acredite todavía)',
      respaldo: 'pendiente',
      fecha: '2026-10-24',
    },
  ],
};

/**
 * Versiones ANTERIORES de las referencias de partida que ya pueden estar guardadas en un espacio (G3,
 * 24-10-2026). Su redacción presentaba la referencia como indicación de la Cátedra. No se reescriben los
 * datos guardados: al mostrarlas (y si la persona edita la lista) se usa la redacción corregida.
 */
export const REFERENCIAS_SUPERADAS: { denominacion: string; fuente: string; nota: string; actual: string }[] = [
  {
    denominacion: 'Plaza Mayor',
    fuente: 'Cátedra (revisión del censo 2025)',
    nota: 'Indicado por la Cátedra al revisar el censo 2025: «Plaza Mayor» corresponde a la Plaza Mayor de la Hispanidad.',
    actual: 'mun-medina',
  },
];
