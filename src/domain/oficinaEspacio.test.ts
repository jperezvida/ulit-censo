// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { archivoItinerario, libroItinerario } from '../data/xlsxItinerarios';
import { escenario, importar } from './censo2026.fixture';
import { itinerariosDeLocal } from './bloqueo';
import { indiceObservaciones, indiceOcupaciones, revisionDe } from './consultas';
import { actualizarRevisiones, filasOficina } from './oficina';
import { registrarDatoDigital } from './digital';

beforeAll(() => { if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });

describe('Oficina sobre itinerarios incorporados desde Excel (G4, SINTÉTICO)', () => {
  it('el local pertenece al itinerario de su Excel aunque no esté planificado; el campo ya está hecho; el alcance aísla itinerarios', async () => {
    const e = await escenario();
    expect(Object.values(e.db.itinerarios).every((it) => it.tramos.length === 0)).toBe(true);
    const db = (await importar(e.db, e, 'IT1', await libroItinerario('IT1'), archivoItinerario('IT1'))).aplicar().db;
    const filas = filasOficina(db, e.campanaId, { obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) }, { itinerarioId: e.its.IT1 });
    expect(filas.map((f) => f.nombre)).toEqual(['BAR SINTÉTICO EL OLMO']);
    const bar = filas[0];
    expect(itinerariosDeLocal(db, e.campanaId, bar.localId).map((it) => it.codigo)).toEqual(['IT1']);
    // Campo: lo aporta el Excel incorporado; no vuelve a «pendiente» al revisar en Oficina
    expect(revisionDe(db, e.campanaId, bar.localId).campo).toBe('terminado');
    const d1 = actualizarRevisiones(db, e.campanaId, [bar.localId], { pendienteComprobacion: true }, { itinerarioId: e.its.IT1 });
    expect(revisionDe(d1, e.campanaId, bar.localId)).toMatchObject({ campo: 'terminado', categorizacion: 'pendiente', digital: 'pendiente' });
    // Desde IT2 no se modifica un registro de IT1
    expect(() => actualizarRevisiones(db, e.campanaId, [bar.localId], { pendienteComprobacion: true }, { itinerarioId: e.its.IT2 })).toThrow(/no pertenecen a IT2/);
    expect(() => registrarDatoDigital(db, bar.negocioId!, e.campanaId, 'instagram', { respuesta: 'si' }, e.o.porId, { alcance: { itinerarioId: e.its.IT2 } })).toThrow(/IT2/);
    // «Sin información» no es «No»: queda como respuesta propia y la revisión sigue pendiente
    const d2 = registrarDatoDigital(db, bar.negocioId!, e.campanaId, 'instagram', { respuesta: 'sin-info' }, e.o.porId, { alcance: { itinerarioId: e.its.IT1 } });
    expect(Object.values(d2.digital)[0].datos.instagram?.respuesta).toBe('sin-info');
    expect(revisionDe(d2, e.campanaId, bar.localId).digital).toBe('pendiente');
    // En el histórico 2025 (sin Excel de itinerario) nada cambia: campo pendiente por defecto
    const l25 = Object.values(db.observaciones).find((o) => o.campanaId === e.historica)!.localId!;
    expect(itinerariosDeLocal(db, e.historica, l25)).toEqual([]);
  }, 60000);
});
