import { describe, expect, it } from 'vitest';
import {
  SHA256_APROBADO_MEDINA_2025, SHA256_ORIGINAL_MEDINA_2025,
  PERFIL_MEDINA_2025, INFORME_AGREGADO_MEDINA_2025, referenciaAplicable,
} from './referencias';

describe('Referencia histórica 2025 y fuente aprobada por la Cátedra', () => {
  it('reconoce como fuente oficial la copia aprobada sin borrar la huella anterior', () => {
    expect(SHA256_APROBADO_MEDINA_2025).toBe('9e367ca51cfecf56d93f124d166f708e374f6555a4cc36d3166afde2f1f7ba82');
    expect(SHA256_ORIGINAL_MEDINA_2025).toBe('645179a850474ab92bc54c9ed4e6e2f300790f62081fb0ea02d3999e3c4cb67a');
    expect(SHA256_ORIGINAL_MEDINA_2025).not.toBe(SHA256_APROBADO_MEDINA_2025);
  });
  it('permite contrastar agregados contra la copia aprobada y la antigua referencia', () => {
    expect(referenciaAplicable(PERFIL_MEDINA_2025, SHA256_APROBADO_MEDINA_2025)).toBe(INFORME_AGREGADO_MEDINA_2025);
    expect(referenciaAplicable(PERFIL_MEDINA_2025, SHA256_ORIGINAL_MEDINA_2025)).toBe(INFORME_AGREGADO_MEDINA_2025);
  });
  it('no extrapola el informe de Medina a otro archivo no identificado', () => {
    expect(referenciaAplicable(PERFIL_MEDINA_2025, '0'.repeat(64))).toBeUndefined();
    expect(referenciaAplicable(PERFIL_MEDINA_2025, SHA256_APROBADO_MEDINA_2025, false)).toBeUndefined();
  });
});
