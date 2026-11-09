import { describe, expect, it } from 'vitest';
import { portalesPendientesOperativos } from './incorporacion';

describe('Portales duplicados: conservar origen sin inventar locales', () => {
  const f = (fila: number, clave?: string) => ({ fila, clave });
  it('mantiene como pendientes dos locales vacíos idénticos en el mismo portal', () => {
    const m = portalesPendientesOperativos([f(30,'c|4|'),f(31,'c|4|')],new Map());
    expect(m.get(30)).toMatchObject({ motivo:'direccion-repetida-en-archivo' });
    expect(m.get(31)).toMatchObject({ motivo:'direccion-repetida-en-archivo' });
  });
  it('no crea automáticamente locales en un portal del histórico, aun con una sola fila', () => {
    const m = portalesPendientesOperativos([f(35,'c|5|')],new Map([['c|5|',['local-2025']]]));
    expect(m.get(35)).toEqual({ motivo:'local-existente-en-direccion',candidatos:['local-2025'] });
  });
  it('distingue sufijos de puerta y no bloquea portales diferentes', () => {
    const m = portalesPendientesOperativos([f(36,'c|5|A'),f(37,'c|5|B'),f(38,'c|9|')],new Map());
    expect(m.size).toBe(0);
  });
  it('conserva filas sin dirección, ya gestionadas por la interpretación', () => {
    const m = portalesPendientesOperativos([f(40),f(41,'c|7|')],new Map());
    expect(m.size).toBe(0);
  });
  it('detecta todo un bloque coincidente entre itinerarios, sin fusionarlo', () => {
    const historic = new Map<string, string[]>([['ronda|1|',['hist1']],['ronda|4|',['hist4']]]);
    const m = portalesPendientesOperativos([f(63,'ronda|1|'),f(64,'ronda|1|'),f(75,'ronda|4|')],historic);
    expect(m.size).toBe(3);
    expect(m.get(64)?.candidatos).toEqual(['hist1']);
  });
});
