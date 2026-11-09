import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import { codigoItinerarioExcel, filaPreviaExcel, validarDestinoExcel, prepararExcelReal } from './flujoExcelReal';
import type { BaseDatos } from './db';
import type { Campana, Importacion, Itinerario, RegistroOrigen } from './types';

function escenario(): BaseDatos {
  const db = baseVacia();
  db.meta.espacio = 'real';
  db.campanas['c26'] = { id: 'c26', municipioId: 'medina', anio: 2026, tipo: 'actualizacion' } as Campana;
  db.campanas['c25'] = { id: 'c25', municipioId: 'medina', anio: 2025, tipo: 'historico-importado' } as Campana;
  db.itinerarios['it1'] = { id: 'it1', campanaId: 'c26', codigo: 'IT1' } as Itinerario;
  db.importaciones['imp1'] = { id: 'imp1', campanaId: 'c26', estado: 'confirmada', huella: 'sha-it1',
    c1: { itinerario: { id: 'it1' } } } as Importacion;
  db.registros['fila1'] = { id: 'fila1', importacionId: 'imp1', itinerarioId: 'it1', fila: 2, datos: {} } as RegistroOrigen;
  return db;
}

describe('Excel operativo real desde la aplicación única', () => {
  it('detecta IT2, IT5 parte 2 e IT7 sin depender del nombre municipal', () => {
    expect(codigoItinerarioExcel('ITINERARIO 2 MEDINA.xlsx')).toBe('IT2');
    expect(codigoItinerarioExcel('IT5 PARTE 2.xlsx')).toBe('IT5');
    expect(codigoItinerarioExcel('it_07 medina.xlsx')).toBe('IT7');
    expect(codigoItinerarioExcel('censo completo 2025.xlsx')).toBeNull();
    expect(codigoItinerarioExcel('IT2 IT3.xlsx')).toBeNull();
    expect(codigoItinerarioExcel('IT0.xlsx')).toBeNull();
  });
  it('no reimporta IT1 ya existente ni confunde el histórico con una campaña operativa', () => {
    const db = escenario();
    expect(validarDestinoExcel(db,'c26','IT1',false)).toMatchObject({ yaIncorporado: true, error: expect.stringContaining('ya tiene Excel') });
    expect(validarDestinoExcel(db,'c26','IT1',true)).toMatchObject({ yaIncorporado: true, error: null, itinerarioId: 'it1' });
    expect(validarDestinoExcel(db,'c26','IT2',false)).toMatchObject({ yaIncorporado: false, itinerarioId: null, error: null });
    expect(validarDestinoExcel(db,'c25','IT2',false).error).toMatch(/campaña operativa/);
    expect(validarDestinoExcel(db,'c26','dos',false).error).toMatch(/IT2/);
  });
  it('no altera ni la campaña ni los registros al validar un itinerario nuevo', () => {
    const db = escenario();
    const antes = JSON.stringify(db);
    validarDestinoExcel(db,'c26','IT2',false);
    expect(JSON.stringify(db)).toBe(antes);
  });
  it('conserva las columnas originales y sus valores sin inventar cambios', () => {
    const fila = { id: 'fila-24', importacionId: 'imp2', fila: 24, datos: {
      ' Dirección ': 'Calle Carrera', 'Num': '12', 'Nombre del negocio': 'Comercio A',
      'Actividad': 'Calzado', 'Local Vacío': '0',
    } } as RegistroOrigen;
    expect(filaPreviaExcel(fila)).toEqual({
      fila: 24, calle:'Calle Carrera', numero:'12', negocio:'Comercio A', actividad:'Calzado', vacio:'0',
    });
  });
  it('rechaza archivos que no sean xlsx antes de cualquier análisis', async () => {
    const db = escenario();
    await expect(prepararExcelReal(db,'c26','p','IT2.csv',new Uint8Array(0),'IT2',false))
      .rejects.toThrow(/xlsx/);
  });
});
