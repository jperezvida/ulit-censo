import { describe, expect, it } from 'vitest';
import { callejeroSimulado, MEDINA } from './callejero';
import { generarDemo } from './semilla';
import { itinerariosDe } from '../domain/consultas';
import { progresoItinerario } from '../domain/planificacion';

describe('datos de demostración', () => {
  const calles = callejeroSimulado(MEDINA.id, MEDINA.centro);
  const db = generarDemo({ calles, fuente: 'simulado', detalleFuente: 'test' });

  it('es reproducible (misma semilla → mismos locales)', () => {
    const otra = generarDemo({ calles, fuente: 'simulado', detalleFuente: 'test' });
    const a = Object.values(db.locales).filter((l) => l.municipioId === MEDINA.id).length;
    const b = Object.values(otra.locales).filter((l) => l.municipioId === MEDINA.id).length;
    expect(a).toBe(b);
    expect(Object.keys(db.registros)).toEqual(Object.keys(otra.registros));
  });

  it('marca todo lo generado como simulado', () => {
    expect(Object.values(db.campanas).every((c) => c.procedencia === 'simulado')).toBe(true);
    expect(Object.values(db.calles).filter((c) => c.municipioId === MEDINA.id).every((c) => c.procedencia === 'simulado')).toBe(true);
  });

  it('IT-C tiene el campo terminado y la oficina pendiente; IT-A está en curso', () => {
    const its = itinerariosDe(db, 'camp-medina-2026');
    expect(its.map((i) => i.codigo)).toEqual(['IT-A', 'IT-B', 'IT-C', 'IT-D']);
    const c = progresoItinerario(db, db.itinerarios[db.meta.itCampoTerminado]);
    expect(c.campoTerminado).toBe(true);
    const a = progresoItinerario(db, db.itinerarios[db.meta.itEnCurso]);
    expect(a.campoTerminado).toBe(false);
    expect(a.completadas).toBeGreaterThan(0);
    const revs = Object.values(db.revisiones).filter((r) => r.campanaId === 'camp-medina-2026');
    expect(revs.length).toBeGreaterThan(0);
    expect(revs.every((r) => r.validacion === 'pendiente')).toBe(true);
  });

  it('genera volumen en Valladolid y un local con historia de tres campañas', () => {
    const n = Object.values(db.locales).filter((l) => l.municipioId === 'mun-valladolid').length;
    expect(n).toBeGreaterThan(4000);
    expect(db.meta.localHistoricoValladolid).toBeTruthy();
    expect(db.meta.localHistoricoMedina).toBeTruthy();
  });
});
