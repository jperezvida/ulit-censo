import type { Respuesta } from './types';

export const RESPUESTA_TXT: Record<Respuesta, string> = {
  si: 'Sí',
  no: 'No',
  pendiente: 'Pendiente',
  na: 'No aplicable',
  'sin-info': 'Sin información',
};

/** ¿La variable ya tiene una respuesta (aunque sea «no aplicable» o «sin información»)? */
export function estaResuelta(r: Respuesta | undefined): boolean {
  return r !== undefined && r !== 'pendiente';
}

/**
 * Codificación de salida. Solo «sí» y «no» tienen código (1/0, 1.0/0.0…);
 * pendiente, no aplicable y sin información se escriben como vacío salvo que el perfil
 * indique otra cosa. Nunca se convierte un pendiente en 0.
 */
export function codificarRespuesta<T>(
  r: Respuesta | undefined,
  cod: { si: T; no: T; pendiente?: T | null; na?: T | null; sinInfo?: T | null },
): T | null {
  switch (r) {
    case 'si':
      return cod.si;
    case 'no':
      return cod.no;
    case 'na':
      return cod.na ?? null;
    case 'sin-info':
      return cod.sinInfo ?? null;
    default:
      return cod.pendiente ?? null;
  }
}

/** Lectura de un valor heredado o importado (1, 1.0, «sí», «x»…). Vacío ⇒ pendiente, nunca «no». */
export function respuestaDesdeValor(v: unknown): Respuesta {
  if (v === null || v === undefined) return 'pendiente';
  if (typeof v === 'boolean') return v ? 'si' : 'no';
  if (typeof v === 'number') return v === 0 ? 'no' : 'si';
  const s = String(v).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (s === '') return 'pendiente';
  const n = Number(s.replace(',', '.'));
  if (Number.isFinite(n)) return n === 0 ? 'no' : 'si';
  if (['si', 's', 'x', 'true'].includes(s)) return 'si';
  if (['no', 'n', 'false'].includes(s)) return 'no';
  if (['na', 'n/a', 'no aplica'].includes(s)) return 'na';
  return 'pendiente';
}
