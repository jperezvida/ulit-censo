import { describe, expect, it } from 'vitest';
import { claveCalle, similitud } from './text';

describe('claveCalle', () => {
  it('iguala variantes de escritura de la misma calle', () => {
    expect(claveCalle('C/ de los Mostenes')).toBe(claveCalle('Los Mostenes'));
    expect(claveCalle('Calle López Flores')).toBe(claveCalle('López Flores'));
    expect(claveCalle('Pza. Mayor')).toBe(claveCalle('Plaza Mayor'));
  });
  it('no confunde tipos de vía distintos con el mismo nombre', () => {
    expect(claveCalle('Travesía del Fresno')).not.toBe(claveCalle('Calle del Fresno'));
    expect(claveCalle('Plaza de San Francisco')).not.toBe(claveCalle('Calle San Francisco'));
  });
});

describe('similitud', () => {
  it('es alta para nombres casi iguales y baja para distintos', () => {
    expect(similitud('Bar Delia', 'Bar  Delia')).toBe(1);
    expect(similitud('Zapatería Real', 'Peluquería Nogal')).toBeLessThan(0.5);
  });
});
