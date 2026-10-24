// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CASOS_GENERALIDAD } from '../data/xlsxGeneralidad';
import { libroFicticio, type OpcionesLibroFicticio } from '../data/xlsxFicticio';
import { analizarXlsx } from './xlsx/analisis';
import { interpretarXlsx } from './xlsx/interpretacion';

/**
 * G0 · Pruebas de GENERALIDAD: censos sintéticos con estructuras distintas de las de Medina del Campo
 * (otros municipios y años, columnas con otros nombres y en otro orden, columnas desconocidas,
 * campos ausentes, otros formatos de fecha, hojas auxiliares, cabecera fuera de la fila 1).
 *
 * «Lo que ya funciona» son pruebas normales. «Limitaciones conocidas» describen el comportamiento
 * que se quiere conseguir y están marcadas con `it.fails`: la CI pasa MIENTRAS fallen (documentan la
 * limitación sin bloquear) y avisará en cuanto empiecen a funcionar, para convertirlas en pruebas
 * normales con G1.
 */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

const VARIANTES_MEDINA: Record<string, OpcionesLibroFicticio> = {
  'formato Medina con una columna adicional («Observaciones»)': { extra: ['Observaciones'] },
  'formato Medina sin las columnas de redes sociales': { omitir: ['Instagram', 'segu Insta', 'Facebook', 'Segu F', 'Twitter', 'Segu T', 'Nº redes'] },
  'formato Medina con «Dirección» renombrada como «Calle»': { cabeceras: { Dirección: 'Calle' } },
};

describe('G0 · Lo que ya funciona con archivos distintos', () => {
  for (const c of CASOS_GENERALIDAD) {
    it(`caso ${c.id} (${c.municipio} ${c.anio}): se lee con el lector seguro y se describen todas sus hojas`, async () => {
      const inf = await analizarXlsx(await c.generar(), c.archivo);
      expect(inf.hojas.map((h) => h.nombre)).toContain(c.hoja);
      expect(inf.archivo.sha256).toMatch(/^[0-9a-f]{64}$/);
    });
  }
  it('la hoja de resumen (tabla dinámica) se reconoce como resumen y no como datos', async () => {
    const b = CASOS_GENERALIDAD.find((c) => c.id === 'B')!;
    const inf = await analizarXlsx(await b.generar(), b.archivo);
    expect(inf.hojas.find((h) => h.nombre === 'Resumen')?.rol).toBe('resumen');
  });
  it('el formato de referencia de Medina (27 columnas exactas) sigue reconociéndose', async () => {
    const inf = await analizarXlsx(await libroFicticio({ filas: 10 }), 'x.xlsx');
    expect(inf.perfilPropuesto).toBe('censo-municipal-27');
  });
});

describe('G0 · Limitaciones conocidas (se resuelven en G1)', () => {
  for (const c of CASOS_GENERALIDAD.filter((x) => x.id !== 'C')) {
    it.fails(`caso ${c.id}: detecta la hoja de datos «${c.hoja}» y su cabecera en la fila ${c.filaCabecera}`, async () => {
      const inf = await analizarXlsx(await c.generar(), c.archivo);
      expect(inf.hojaDatos).toBe(c.hoja);
      expect(inf.filas.filaCabecera).toBe(c.filaCabecera);
    });
    it.fails(`caso ${c.id}: se interpreta conservando sus ${c.filas} filas`, async () => {
      const r = await interpretarXlsx(await c.generar(), c.archivo);
      expect(r.filas).toHaveLength(c.filas);
    });
  }
  for (const [nombre, o] of Object.entries(VARIANTES_MEDINA)) {
    it.fails(`${nombre}: se interpreta`, async () => {
      const r = await interpretarXlsx(await libroFicticio({ filas: 10, ...o }), 'x.xlsx');
      expect(r.filas).toHaveLength(10);
    });
  }
});
