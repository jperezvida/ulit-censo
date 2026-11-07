// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { libroConFilas, type FilaSintetica } from '../data/xlsxItinerarios';
import { verificarEspacio } from './espacios';
import { compararNombres, crearLocalDistinto, decisionesCampana, deshacerConciliacion, ordenarPorClaridad, pendientesCampana, vincularALocal } from './conciliacionPosterior';
import { AHORA, escenario, historico, importar } from './censo2026.fixture';
import type { BaseDatos } from './db';

beforeAll(() => { if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });

/** IT1 de 2026 SINTÉTICO frente al censo 2025 sintético (FILAS_2025). Real 8 no aparece. */
const FILAS_IT1: FilaSintetica[] = [
  { calle: 'Calle del Olmo', num: 3, nombre: 'PANADERÍA SINTÉTICA', fecha: '2026-03-02' },
  { calle: 'Calle del Olmo', num: 3, nombre: 'PELUQUERÍA SINTÉTICA', fecha: '2026-03-02' },
  { calle: 'Calle del Olmo', num: 5, nombre: 'CAFETERÍA SINTÉTICA', fecha: '2026-03-03' },
  { calle: 'Calle del Olmo', num: 7, nombre: 'FERRETERÍA SINTÉTICA', fecha: '2026-03-03' },
  { calle: 'Calle Real', num: 'S/N', nombre: 'BAZAR SINTÉTICO', fecha: '2026-03-04' },
  { calle: 'Calle Inexistente', num: 4, nombre: 'KIOSCO SINTÉTICO', fecha: '2026-03-04' },
];

async function preparado() {
  const e = await escenario();
  const db = (await importar(e.db, e, 'IT1', await libroConFilas('IT1', FILAS_IT1), 'itinerario_IT1_conciliacion_SINTETICO.xlsx')).aplicar().db;
  /** Local de 2025 por el nombre (o «vacío») con que figuraba en el censo histórico. */
  const local2025 = (nombre: string | null) => Object.values(db.observaciones).find((o) => o.campanaId === e.historica && (nombre === null ? o.datos.vacio : o.datos.nombre === nombre))!.localId!;
  const pend = (x: BaseDatos, re: RegExp) => pendientesCampana(x, e.campanaId).find((p) => re.test(p.nombre ?? ''))!;
  return { e, db, local2025, pend, f: { porId: e.o.porId, ahora: AHORA } };
}

describe('Conciliación asistida 2025 → 2026 (SINTÉTICO)', () => {
  it('compara nombres sin dar por igual lo que solo comparte una palabra', () => {
    expect(compararNombres('Panadería  sintética', 'PANADERIA SINTETICA')).toBe('igual');
    expect(compararNombres('BAR EL OLMO', 'BAR OLMO')).toBe('parecido');
    expect(compararNombres('FERRETERÍA SINTÉTICA', 'DROGUERÍA SINTÉTICA')).toBe('distinto');
    expect(compararNombres(undefined, 'X')).toBe('sin-dato');
  });

  it('propone candidatos ordenados y explicados, sin aplicar nada ni interpretar ausencias', async () => {
    const { e, db, local2025, pend } = await preparado();
    const ps = pendientesCampana(db, e.campanaId);
    expect(ps).toHaveLength(6);
    // Nada vinculado automáticamente; Real 8 ausente no es una desaparición; el histórico no cambia
    expect(Object.values(db.observaciones).filter((o) => o.campanaId === e.campanaId).every((o) => o.localId === null)).toBe(true);
    expect(Object.values(db.observaciones).some((o) => o.tipo === 'posible-desaparicion')).toBe(false);
    expect(historico(db, e.historica)).toBe(historico(e.db, e.historica));
    // Orden de revisión: primero lo claro, después el mismo portal y al final lo que no tiene correspondencia segura
    expect(ordenarPorClaridad(ps).map((p) => [p.nombre, p.claridad])).toEqual([
      ['PANADERÍA SINTÉTICA', 'clara'], ['PELUQUERÍA SINTÉTICA', 'clara'],
      ['CAFETERÍA SINTÉTICA', 'mismo-portal'], ['FERRETERÍA SINTÉTICA', 'mismo-portal'],
      ['BAZAR SINTÉTICO', 'sin-correspondencia-segura'], ['KIOSCO SINTÉTICO', 'sin-correspondencia-segura'],
    ]);

    // Mismo portal y mismo nombre, con dos locales en el portal: propuesta clara, pero se explica que hay dos
    const pan = pend(db, /PANADERÍA/);
    expect(pan.candidatos.map((c) => [c.localId, c.nivel, c.nombre])).toEqual([
      [local2025('PANADERÍA SINTÉTICA'), 'portal-y-nombre', 'igual'], [local2025('PELUQUERÍA SINTÉTICA'), 'portal', 'distinto'],
      expect.arrayContaining(['calle']), expect.arrayContaining(['calle']),
    ]);
    expect(pan.candidatos[0].motivos).toEqual(['Mismo portal (calle, número).', 'En este portal hay 2 locales: puede ser cualquiera de ellos o uno distinto.', 'Mismo nombre que en Censo 2025.']);
    expect(pan.candidatos[0].referencia).toMatchObject({ campana: 'Censo 2025', nombre: 'PANADERÍA SINTÉTICA', vacio: false, fecha: '2025-03-02' });

    // Antes vacío, ahora ocupado: se propone el portal y se explica el cambio, sin comparar nombres
    const caf = pend(db, /CAFETERÍA/);
    expect(caf.candidatos[0]).toMatchObject({ localId: local2025(null), nivel: 'portal', nombre: 'sin-dato', referencia: { vacio: true } });
    expect(caf.candidatos[0].motivos).toContain('En Censo 2025 figuraba vacío; ahora aparece ocupado.');

    // Mismo portal con distinto nombre: no es un cambio de negocio confirmado
    const fer = pend(db, /FERRETERÍA/);
    expect(fer.candidatos[0]).toMatchObject({ localId: local2025('DROGUERÍA SINTÉTICA'), nivel: 'portal', nombre: 'distinto' });
    expect(fer.candidatos[0].motivos).toContain('Nombre distinto al de Censo 2025: no confirma un cambio de negocio.');

    // Sin número (S/N): solo candidatos de la misma calle, ninguno de portal; calle inexistente: ninguno
    const baz = pend(db, /BAZAR/);
    expect(baz.candidatos.length).toBeGreaterThan(0);
    expect(baz.candidatos.every((c) => c.nivel === 'calle' && !c.mismoPortal)).toBe(true);
    expect(baz.puedeCrearLocal).toBe(false);
    expect(pend(db, /KIOSCO/)).toMatchObject({ candidatos: [], puedeCrearLocal: false });
  }, 60000);

  it('la persona decide: mismo local físico (sin continuidad de negocio), local distinto en el mismo portal, y se deshace', async () => {
    const { e, db, local2025, pend, f } = await preparado();
    const negocios2025 = JSON.stringify(Object.values(db.negocios));
    // Vincular la ferretería al local de la droguería: mismo local físico, negocio de 2026 propio
    const fer = pend(db, /FERRETERÍA/);
    const d1 = vincularALocal(db, e.campanaId, fer.registroId, fer.candidatos[0].localId, { ...f, motivo: 'Mismo local, comprobado en campo' });
    const obsFer = Object.values(d1.observaciones).find((o) => o.registroId === fer.registroId)!;
    expect(obsFer.localId).toBe(local2025('DROGUERÍA SINTÉTICA'));
    const ocu = Object.values(d1.ocupaciones).find((o) => o.id === `ocu-g5-${fer.registroId}`)!;
    const drog = Object.values(db.observaciones).find((o) => o.campanaId === e.historica && o.datos.nombre === 'DROGUERÍA SINTÉTICA')!;
    expect(ocu).toMatchObject({ localId: obsFer.localId, negocioId: obsFer.datos.negocioId ?? null, desdeCampanaId: e.campanaId });
    expect(ocu.negocioId).not.toBe(drog.datos.negocioId);
    expect(JSON.stringify(Object.values(d1.negocios))).toBe(negocios2025);
    // Trazabilidad: autor, fecha, motivo, itinerario y procedencia
    const [dec] = decisionesCampana(d1, e.campanaId);
    expect(dec.decision).toMatchObject({ accion: 'vincular', porId: f.porId, fecha: AHORA, motivo: 'Mismo local, comprobado en campo', itinerarioId: e.its.IT1, antes: { localId: null } });
    expect(d1.registros[dec.registroId].fila).toBe(5);

    // Mismo portal con dos locales: la panadería se vincula a su local; la peluquería sigue proponiendo el suyo
    const pan = pend(d1, /PANADERÍA/);
    const d2 = vincularALocal(d1, e.campanaId, pan.registroId, pan.candidatos[0].localId, f);
    const pel = pend(d2, /PELUQUERÍA/);
    expect(pel.candidatos.find((c) => c.localId === local2025('PANADERÍA SINTÉTICA'))).toMatchObject({ yaVinculado: true });
    expect(pel.candidatos[0].localId).toBe(local2025('PELUQUERÍA SINTÉTICA'));
    // …o la persona indica que es otro local distinto del mismo portal (exige justificación)
    expect(() => crearLocalDistinto(d2, e.campanaId, pel.registroId, f)).toThrow(/Indique por qué/);
    const d3 = crearLocalDistinto(d2, e.campanaId, pel.registroId, { ...f, motivo: 'Otro establecimiento del portal, comprobado en campo' });
    const nuevo = d3.locales[`loc-g5-${pel.registroId}`];
    expect(nuevo.direcciones[0]).toMatchObject({ numero: 3 });
    expect(Object.values(d3.locales).filter((l) => l.direcciones.at(-1)!.numero === 3 && l.direcciones.at(-1)!.calleId === nuevo.direcciones[0].calleId)).toHaveLength(3);

    // Nada se ha aplicado sin decisión: el resto sigue pendiente; histórico intacto; ni categorías ni redes ni fechas nuevas
    expect(pendientesCampana(d3, e.campanaId).map((p) => p.nombre)).toEqual(['CAFETERÍA SINTÉTICA', 'BAZAR SINTÉTICO', 'KIOSCO SINTÉTICO']);
    expect(historico(d3, e.historica)).toBe(historico(e.db, e.historica));
    expect([Object.keys(d3.clasificaciones).length, Object.keys(d3.revisiones).length]).toEqual([Object.keys(db.clasificaciones).length, 0]);
    expect(JSON.stringify(d3.digital)).toBe(JSON.stringify(db.digital));
    expect(Object.values(d3.ocupaciones).filter((o) => !db.ocupaciones[o.id]).every((o) => o.desdeFecha === Object.values(d3.observaciones).find((x) => x.id === o.desdeObservacionId)!.fecha)).toBe(true);

    // Deshacer la vinculación de la ferretería: vuelve a pendiente y se retira la ocupación creada
    const d4 = deshacerConciliacion(d3, e.campanaId, fer.registroId, f);
    expect(pend(d4, /FERRETERÍA/)).toBeTruthy();
    expect(d4.ocupaciones[`ocu-g5-${fer.registroId}`]).toBeUndefined();
    expect(Object.values(d4.observaciones).find((o) => o.registroId === fer.registroId)!.localId).toBeNull();
    expect(decisionesCampana(d4, e.campanaId).find((x) => x.registroId === fer.registroId)!.decision.deshecha).toMatchObject({ porId: f.porId });
    expect(historico(d4, e.historica)).toBe(historico(e.db, e.historica));
    expect(verificarEspacio(d4, 'ensayo')).toEqual([]);
  }, 60000);
});
