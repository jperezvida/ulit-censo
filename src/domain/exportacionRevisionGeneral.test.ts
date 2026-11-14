import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import type { BaseDatos } from './db';
import { COLUMNAS_REVISION_GENERAL_2026, csvRevisionGeneral, exportarRevisionGeneral } from './exportacionRevisionGeneral';

function escenario(): BaseDatos {
  const db = baseVacia();
  db.campanas.c25 = { id: 'c25', municipioId: 'medina', anio: 2025, nombre: 'Histórico 2025',
    tipo: 'historico-importado', periodo: { inicio: '2025-01-01' }, ambitoCalleIds: [], ampliacionCalleIds: [],
    estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
    procedencia: 'importado' };
  db.campanas.c26 = { ...db.campanas.c25, id: 'c26', anio: 2026, nombre: 'Censo 2026', tipo: 'actualizacion' };
  db.itinerarios.it1 = { id: 'it1', campanaId: 'c26', codigo: 'IT1', nombre: 'Itinerario 1',
    color: '#123', origen: 'excel', tramos: [], asignadosIds: [], creado: '2026-11-10' };
  db.itinerarios.it2 = { ...db.itinerarios.it1, id: 'it2', codigo: 'IT2' };
  db.importaciones.i1 = { id: 'i1', campanaId: 'c26', municipioId: 'medina', archivo: 'IT1.xlsx',
    tipo: 'C-excel-itinerario', fecha: '2026-11-10', filas: 2,
    huella: 'abc', estado: 'confirmada', resumen: {}, procedencia: 'importado' };
  db.importaciones.i2 = { ...db.importaciones.i1, id: 'i2', archivo: 'IT2.xlsx' };
  db.importaciones.h = { ...db.importaciones.i1, id: 'h', campanaId: 'c25', archivo: '2025.xlsx' };
  db.importaciones.preparacion = { ...db.importaciones.i1, id: 'preparacion', estado: 'preparacion' };
  db.registros.r1 = { id: 'r1', fila: 2, importacionId: 'i1', itinerarioId: 'it1',
    datos: { 'Dirección': 'Calle Mayor', Num: '9', 'Local Vacío': '1',
      'Nombre del negocio': 'Antiguo', 'Long fachada': '3,5', Instagram: '1', Actividad: 'Bar' } };
  db.registros.r2 = { id: 'r2', fila: 3, importacionId: 'i2', itinerarioId: 'it2',
    datos: { 'Dirección': 'Calle Mayor', Num: '9', 'Local Vacío': '0',
      'Nombre del negocio': 'Panadería', 'Long fachada': '', Instagram: '0' } };
  db.registros.h = { id: 'h', fila: 2, importacionId: 'h', datos: { 'Local Vacío': '1' } };
  db.registros.pre = { id: 'pre', fila: 3, importacionId: 'preparacion', datos: { 'Local Vacío': '1' } };
  db.correccionesRegistros = { r1: { id: 'r1', registroId: 'r1', campanaId: 'c26',
    valores: { nombre: '', instagram: '', actividad: '' }, fecha: '2026-11-10T20:00:00Z',
    porId: 'responsable', motivo: 'Cierre confirmado en visita', historial: [] } };
  return db;
}

describe('Exportación 2026 · datos efectivos de revisión', () => {
  it('exporta exactamente las filas confirmadas de 2026, con metadatos y sin perder originales', () => {
    const db = escenario();
    const original = structuredClone(db.registros.r1);
    const salida = exportarRevisionGeneral(db, 'c26');
    expect(salida.resumen).toMatchObject({ filas: 2, vacios: 1, ocupados: 1, desconocidos: 0,
      conIncidencias: 0, conCorreccion: 1 });
    expect(salida.filas).toHaveLength(2);
    expect(salida.filas[0]['Nombre del negocio']).toBe('');
    expect(salida.filas[0].Instagram).toBe('');
    expect(salida.filas[0].Actividad).toBe('');
    expect(salida.filas[0]['Local Vacío']).toBe('1');
    expect(salida.filas[0]['ULIT · Campos corregidos']).toContain('Nombre del negocio');
    expect(salida.columnas).not.toContain('ULIT · Valores originales corregidos');
    expect(JSON.stringify(salida.filas[0])).not.toContain('Antiguo');
    expect(salida.filas[0]['ULIT · Motivo corrección']).toBe('Cierre confirmado en visita');
    expect(salida.filas[1]['Nombre del negocio']).toBe('Panadería');
    expect(salida.filas[1]['ULIT · Fila del Excel']).toBe('3');
    expect(db.registros.r1).toEqual(original);
  });

  it('distingue filas de itinerario y no elimina dos comercios por compartir dirección y número', () => {
    const db = escenario();
    expect(exportarRevisionGeneral(db, 'c26','it1').resumen.filas).toBe(1);
    expect(exportarRevisionGeneral(db, 'c26','it2').resumen.filas).toBe(1);
    expect(exportarRevisionGeneral(db, 'c26','desconocido').resumen.filas).toBe(0);
    expect(exportarRevisionGeneral(db, 'c25').resumen.filas).toBe(0);
  });

  it('incluye las 28 cabeceras reales del itinerario más trazabilidad', () => {
    expect(COLUMNAS_REVISION_GENERAL_2026.length).toBe(38);
    expect(COLUMNAS_REVISION_GENERAL_2026).toContain('Local Vacío');
    expect(COLUMNAS_REVISION_GENERAL_2026).toContain('Google My Bussines');
    expect(COLUMNAS_REVISION_GENERAL_2026).toContain('ULIT · Registro origen');
  });

  it('el nombre LV se deja vacío al exportar un local vacío, sin alterar el Excel original', () => {
    const db = escenario();
    db.correccionesRegistros = {};
    db.registros.r1.datos['Nombre del negocio'] = 'LV';
    const salida = exportarRevisionGeneral(db, 'c26');
    expect(salida.filas[0]['Nombre del negocio']).toBe('');
    expect(db.registros.r1.datos['Nombre del negocio']).toBe('LV');
  });

  it('CSV español escapa separador, comillas y fórmulas inyectadas por valores del Excel', () => {
    const db = escenario();
    db.registros.r2.datos['Nombre del negocio'] = '=HYPERLINK("http://example.invalid";"abrir")';
    const csv = csvRevisionGeneral(exportarRevisionGeneral(db, 'c26'));
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain(';');
    expect(csv).toContain(`"'=HYPERLINK(""http://example.invalid"";""abrir"")"`);
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('marca los avisos pendientes aunque exista una corrección parcial', () => {
    const db = escenario();
    db.correccionesRegistros!.r1.valores = { nombre: '' };
    const salida = exportarRevisionGeneral(db, 'c26');
    expect(salida.resumen.conIncidencias).toBe(1);
    expect(salida.filas[0]['ULIT · Incidencias pendientes']).toContain('presencia digital');
  });
});
