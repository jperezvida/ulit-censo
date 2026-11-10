import { describe, expect, it } from 'vitest';
import type { FilaRevisionGeneral } from '../../domain/revisionGeneral';
import { revisarRegistroGeneral } from '../../domain/revisionGeneral';
import { propuestaRevisionGeneral } from './CorregirRevisionGeneral';

const fila: FilaRevisionGeneral = {
  id: 'r1', archivo: 'IT1.xlsx', itinerario: 'IT1', direccion: 'Calle A', numero: '1', nombre: 'Antiguo',
  estado: 'vacio',
  registro: {
    id: 'r1', importacionId: 'imp', fila: 1, datos: {
      'Local Vacío': '1', 'Long fachada': '3,5', 'Nombre del negocio': 'Antiguo',
      Actividad: 'Peluquería', Instagram: '1', Facebook: '0', Franquicia: '1',
    },
  },
  incidencias: [],
};

describe('Fase 1 · propuesta de corrección supervisada', () => {
  it('limpia las contradicciones del local vacío sin tocar el origen', () => {
    const propuestos = propuestaRevisionGeneral(fila, '1', '', '3,5', true, true, true);
    expect(propuestos).toEqual({ nombre: '', actividad: '', franquicia: '', instagram: '', facebook: '' });
    expect(revisarRegistroGeneral(fila.registro, propuestos).incidencias).toEqual([]);
    expect(fila.registro.datos.Actividad).toBe('Peluquería');
    expect(fila.registro.datos.Instagram).toBe('1');
  });

  it('propone metros facilitados por persona, no los inventa la aplicación', () => {
    const base: FilaRevisionGeneral = { ...fila, registro: { ...fila.registro,
      datos: { 'Local Vacío': '1', 'Long fachada': '', 'Nombre del negocio': '' } } };
    expect(propuestaRevisionGeneral(base, '1', '', '4,5', false, false, false)).toEqual({ fachada: '4,5' });
    expect(revisarRegistroGeneral(base.registro, {}).incidencias.map((i) => i.tipo)).toContain('vacio-sin-fachada');
  });

  it('permite revertir un valor corregido al original sin borrar el historial', () => {
    const anterior: FilaRevisionGeneral = { ...fila, correccion: {
      id: 'r1', registroId: 'r1', campanaId: 'c26', valores: { nombre: '' },
      porId: 'revisor', fecha: '2026-11-10', motivo: 'Revisión provisional', historial: [],
    } };
    expect(propuestaRevisionGeneral(anterior, '1', 'Antiguo', '3,5', false, false, false)).toEqual({});
    expect(anterior.correccion?.valores).toEqual({ nombre: '' });
  });
});
