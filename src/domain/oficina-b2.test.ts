import { describe, expect, it } from 'vitest';
import { C25_SINT, C26_SINT, escenarioOficina } from '../data/escenarioOficina';
import { indiceObservaciones, indiceOcupaciones } from './consultas';
import { callesDeItinerario, filasOficina, resumenItinerarios } from './oficina';
import { cerrarRevisionItinerario, comprobarEditable, itinerariosDeLocal } from './bloqueo';
import { confirmarSinCambios } from './campo';
import type { BaseDatos } from './db';

const ix = (db: BaseDatos) => ({ obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) });

describe('B2 · pertenencia por ámbito territorial efectivo', () => {
  const esc = escenarioOficina({ calles: 4, localesPorCalle: 12 });
  const [it1, it2] = esc.itinerarios;
  const filas = filasOficina(esc.db, C26_SINT, ix(esc.db));

  it('una calle dividida entre pares e impares reparte sus locales sin mezclarlos', () => {
    const deCalle = filas.filter((f) => f.calleId === esc.calleRepartida);
    expect(deCalle).toHaveLength(12);
    for (const f of deCalle) {
      expect(f.itinerarioIds).toEqual([f.numero! % 2 === 0 ? it1 : it2]);
      expect(itinerariosDeLocal(esc.db, C26_SINT, f.localId).map((i) => i.id)).toEqual(f.itinerarioIds);
    }
    const soloIt1 = filasOficina(esc.db, C26_SINT, ix(esc.db), { itinerarioId: it1 }).filter((f) => f.calleId === esc.calleRepartida);
    expect(soloIt1.map((f) => f.numero)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('una calle repartida por segmentos asigna cada local al itinerario de su segmento', () => {
    const deCalle = filas.filter((f) => f.calleId === esc.calleSegmentos);
    expect(deCalle.length).toBe(12);
    expect(deCalle.every((f) => f.itinerarioIds.length === 1)).toBe(true);
    const n1 = deCalle.filter((f) => f.itinerarioIds[0] === it1).length;
    expect(n1).toBeGreaterThan(0);
    expect(n1).toBeLessThan(12);
  });

  it('los locales de referencia no visitados siguen en el seguimiento como «pendiente de visita»', () => {
    const it2Filas = filasOficina(esc.db, C26_SINT, ix(esc.db), { itinerarioId: it2 });
    const pend = it2Filas.filter((f) => f.situacion === 'pendiente-visita');
    const reg = it2Filas.filter((f) => f.situacion === 'registrado');
    expect(pend.length).toBeGreaterThan(0);
    expect(reg.length).toBeGreaterThan(0);
    // Muestran los datos de referencia (negocio de 2025) y el campo pendiente
    for (const f of pend) {
      expect(f.rev.campo).toBe('pendiente');
      expect(f.obs).toBeUndefined();
      if (!f.vacio) expect(f.nombre).toBe(esc.db.negocios[f.negocioId!].nombre);
    }
    // Al visitarlo pasa a registrado sin duplicarse
    let db = esc.db;
    db = confirmarSinCambios(db, { campanaId: C26_SINT, investigadorId: 'p-ana', fecha: '2026-10-01T10:00:00' }, pend[0].localId);
    const tras = filasOficina(db, C26_SINT, ix(db), { itinerarioId: it2 });
    expect(tras).toHaveLength(it2Filas.length);
    expect(tras.find((f) => f.localId === pend[0].localId)!.situacion).toBe('registrado');
  });

  it('una calle sin locales conserva su estado de cobertura', () => {
    const it = esc.db.itinerarios[it2];
    const calles = callesDeItinerario(esc.db, it, filas);
    const sin = calles.find((c) => c.tramo.calleId === esc.calleSinLocales)!;
    expect(sin).toMatchObject({ estado: 'completada-sin-locales', registrados: 0, pendientesVisita: 0 });
  });

  it('el progreso de cada itinerario es independiente', () => {
    const r = resumenItinerarios(esc.db, C26_SINT, filas);
    const r1 = r.find((x) => x.itinerarioId === it1)!;
    const r2 = r.find((x) => x.itinerarioId === it2)!;
    // IT-1: campo terminado, oficina pendiente
    expect(r1.campo.pendientes).toBe(0);
    expect(r1.calles.completadas).toBe(r1.calles.total);
    expect(r1.categorizacion.hechos).toBe(0);
    expect(r1.categorizacion.pendientes).toBeGreaterThan(0);
    expect(r1.estado).toBe('en-revision');
    // IT-2: campo a medias; su calle sin locales cuenta como completada
    expect(r2.campo.pendientes).toBeGreaterThan(0);
    expect(r2.calles.sinLocales).toBe(1);
    // Ningún registro se cuenta en dos itinerarios
    expect(r1.total + r2.total).toBe(filas.filter((f) => f.itinerarioIds.some((i) => i === it1 || i === it2)).length);
  });

  it('cerrar un itinerario solo bloquea su acera de la calle compartida', () => {
    const db = cerrarRevisionItinerario(esc.db, it1, 'p-elena');
    const deCalle = filasOficina(db, C26_SINT, ix(db)).filter((f) => f.calleId === esc.calleRepartida);
    for (const f of deCalle) {
      const par = f.numero! % 2 === 0;
      expect(f.bloqueado).toBe(par);
      if (par) expect(() => comprobarEditable(db, C26_SINT, { localId: f.localId })).toThrow(/IT-1/);
      else expect(() => comprobarEditable(db, C26_SINT, { localId: f.localId })).not.toThrow();
    }
  });

  it('la campaña anterior no se ve afectada por la vista de oficina', () => {
    const f25 = filasOficina(esc.db, C25_SINT, ix(esc.db));
    expect(f25.every((f) => f.situacion === 'registrado' && f.itinerarioIds.length === 0)).toBe(true);
  });
});

describe('B2 · rendimiento con muchos registros', () => {
  it('calcula filas y resúmenes de varios miles de registros en poco tiempo', () => {
    const t0 = performance.now();
    const esc = escenarioOficina({ calles: 64, localesPorCalle: 80, visitados: (i) => (i % 3) / 2 });
    const tGen = performance.now() - t0;
    const t1 = performance.now();
    const indices = ix(esc.db);
    const filas = filasOficina(esc.db, C26_SINT, indices);
    const res = resumenItinerarios(esc.db, C26_SINT, filas);
    const t = performance.now() - t1;
    expect(filas.length).toBeGreaterThan(4500);
    expect(res.length).toBeGreaterThan(5);
    // Margen amplio para máquinas lentas de CI; en un portátil normal tarda bastante menos.
    expect(t).toBeLessThan(3000);
    console.info(`[rendimiento] ${filas.length} registros: generación ${tGen.toFixed(0)} ms · filas+resúmenes ${t.toFixed(0)} ms`);
  });
});
