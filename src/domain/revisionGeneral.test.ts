import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import type { BaseDatos } from './db';
import type { RegistroOrigen } from './types';
import { auditarRevisionGeneral, CAMPOS_DEL_NEGOCIO, datoRevisionGeneral, nombreEsMarcaDeVacio, propuestaVacioLimpio, revisarRegistroGeneral } from './revisionGeneral';

const fila = (id: string, datos: Record<string, string>, resto: Partial<RegistroOrigen> = {}): RegistroOrigen =>
  ({ id, importacionId: 'it1', itinerarioId: 'it1', fila: Number(id.replace(/\D/g, '')) || 1, datos, ...resto });

const origen = (estado: string, nombre = '', fachada = '') => ({
  'Dirección': 'Calle Mayor', Num: '3', 'Local Vacío': estado,
  'Nombre del negocio': nombre, 'Long fachada': fachada,
});

function base(): BaseDatos {
  const db = baseVacia();
  db.municipios.medina = { id: 'medina', nombre: 'Medina del Campo', provincia: 'Valladolid', fuenteCallejero: 'osm' };
  for (const [id, anio] of [['c25', 2025], ['c26', 2026]] as const) {
    db.campanas[id] = {
      id, municipioId: 'medina', anio, nombre: 'Censo ' + anio, tipo: 'actualizacion',
      periodo: { inicio: anio + '-01-01' }, ambitoCalleIds: [], ampliacionCalleIds: [],
      estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
      procedencia: 'importado',
    };
  }
  db.itinerarios.it1 = { id: 'it1', campanaId: 'c26', codigo: 'IT1', nombre: 'Primero', color: '#045',
    origen: 'excel', tramos: [], asignadosIds: [], creado: '2026-11-10' };
  db.importaciones.it1 = { id: 'it1', municipioId: 'medina', campanaId: 'c26', tipo: 'C-excel-itinerario',
    archivo: 'IT1.xlsx', huella: 'abc', fecha: '2026-11-10', filas: 1, estado: 'confirmada', resumen: {},
    procedencia: 'importado' };
  db.importaciones.historica = { ...db.importaciones.it1, id: 'historica', campanaId: 'c25', archivo: '2025.xlsx', tipo: 'A-censo-historico' };
  return db;
}

describe('Fase 1 · revisión general', () => {

  it('limpia todos los campos del negocio de un LV, incluidos ceros, reseñas y observaciones', () => {
    const registro = fila('r9', {
      ...origen('1', 'LV', '8'), Actividad: 'Peluquería',
      Franquicia: '1', Instagram: '0', 'Nº reseñas Google': '24',
      'Google My Bussines': '1', 'segu Insta': '900',
      Observaciones: 'Notas del ocupante',
    });
    const copia = structuredClone(registro);
    const valores = propuestaVacioLimpio('8');
    expect(valores.vacio).toBe('1');
    expect(valores.fachada).toBe('8');
    for (const clave of CAMPOS_DEL_NEGOCIO) {
      expect(datoRevisionGeneral(registro, clave, valores)).toBe('');
    }
    expect(revisarRegistroGeneral(registro, valores).incidencias).toEqual([]);
    expect(datoRevisionGeneral(registro, 'direccion', valores)).toBe('Calle Mayor');
    expect(datoRevisionGeneral(registro, 'numero', valores)).toBe('3');
    expect(registro).toEqual(copia);
  });

  it('identifica LV y VACÍO como marcadores, nunca como negocios ocupados', () => {
    for (const palabra of ['LV','L.V.','lv','VACÍO','Vacio','LOCAL VACÍO','Sin ocupante']) {
      expect(nombreEsMarcaDeVacio(palabra)).toBe(true);
      expect(revisarRegistroGeneral(fila('r8', origen('0', palabra))).incidencias[0].tipo)
        .toBe('ocupado-sin-nombre');
    }
    expect(nombreEsMarcaDeVacio('Asesoría Nuria Mate')).toBe(false);
    expect(revisarRegistroGeneral(fila('r9', origen('1', 'LV','8'))).incidencias[0].tipo)
      .toBe('vacio-con-nombre');
  });

  it('no permite confirmar un local vacío sin metros positivos', () => {
    for (const invalido of ['','0','-1','1,2345','abc']) {
      expect(() => propuestaVacioLimpio(invalido)).toThrow('metros positivos');
    }
    expect(propuestaVacioLimpio('5,5').fachada).toBe('5,5');
  });

  it('no denuncia un vacío coherente con fachada y ceros de redes', () => {
    const r = revisarRegistroGeneral(fila('r1', {
      ...origen('1', '', '3,5'),
      Instagram: '0', 'Nº redes': '0', 'Google My Bussines': '0', Franquicia: '0',
    }));
    expect(r).toEqual({ estado: 'vacio', incidencias: [] });
  });

  it('agrupa las contradicciones de un vacío en la misma fila, sin borrar nada', () => {
    const f = fila('r2', { ...origen('1', 'Negocio anterior', ''),
      Actividad: 'Peluquería', Descripción: 'Corte de pelo', Instagram: '1', Franquicia: '1', 'Nº reseñas Google': '12',
    });
    const r = revisarRegistroGeneral(f);
    expect(r.estado).toBe('vacio');
    expect(r.incidencias.map((i) => i.tipo)).toEqual([
      'vacio-con-nombre', 'vacio-sin-fachada', 'vacio-con-clasificacion', 'vacio-con-franquicia', 'vacio-con-digital',
    ]);
    expect(f.datos['Nombre del negocio']).toBe('Negocio anterior');
  });

  it('detecta ocupado sin nombre y fachada consignada', () => {
    expect(revisarRegistroGeneral(fila('r3', origen('0', '', '3'))).incidencias.map((i) => i.tipo))
      .toEqual(['ocupado-sin-nombre', 'ocupado-con-fachada']);
    expect(revisarRegistroGeneral(fila('r4', origen('0', 'Comercio', ''))).incidencias).toEqual([]);
  });

  it('no infiere el estado con el nombre cuando falta LV o es inválido', () => {
    expect(revisarRegistroGeneral(fila('r5', origen('', 'Comercio'))).incidencias[0].tipo).toBe('estado-ausente');
    expect(revisarRegistroGeneral(fila('r6', origen('2', 'Comercio'))).incidencias[0].tipo).toBe('estado-invalido');
  });

  it('da prioridad a celdas tipadas originales y reconoce cabeceras auténticas', () => {
    const f = fila('r7', origen('0', 'Texto anterior', ''), { original: {
      vacio: { t: 'numero', v: 1 }, nombre: { t: 'vacio' }, fachada: { t: 'numero', v: 4.5 },
    } });
    expect(datoRevisionGeneral(f, 'nombre')).toBe('');
    expect(revisarRegistroGeneral(f).incidencias).toEqual([]);
    expect(revisarRegistroGeneral(f).estado).toBe('vacio');
  });

  it('audita únicamente filas confirmadas de la campaña; las coincidencias de portal no son errores', () => {
    const db = base();
    db.registros.a = fila('a', origen('1', '', '5'));
    db.registros.b = fila('b', origen('1', '', '5')); // misma dirección y portal: plausible
    db.registros.c = fila('c', origen('0', 'Comercio', ''));
    db.registros.old = fila('old', origen('1', 'Nombre viejo'), { importacionId: 'historica' });
    db.registros.excluido = fila('excluido', origen('1', 'Excluir'), { exclusion: { porId: 'coord', fecha: '2026-11-10', motivo: 'Fuera del censo' } });
    db.importaciones.sinConfirmar = { ...db.importaciones.it1, id: 'sinConfirmar', estado: 'preparacion' };
    db.registros.sinConfirmar = fila('sinConfirmar', origen('1', 'No incorporar'), { importacionId: 'sinConfirmar' });
    const res = auditarRevisionGeneral(db, 'c26');
    expect(res.examinadas).toBe(3);
    expect(res.conIncidencias).toBe(0);
    expect(res.sinIncidencias).toBe(3);
  });

  it('aplica la corrección efectiva sin perder ni reescribir las celdas originales', () => {
    const db = base();
    const original = fila('r1', { ...origen('1', 'Nombre antiguo', '3'), Instagram: '1' });
    db.registros.r1 = original;
    db.correccionesRegistros = {
      r1: { id: 'r1', registroId: 'r1', campanaId: 'c26', valores: { nombre: '', instagram: '' },
        porId: 'revisor', fecha: '2026-11-10', motivo: 'Negocio anterior',
        historial: [] },
    };
    const auditoria = auditarRevisionGeneral(db, 'c26');
    expect(auditoria.conIncidencias).toBe(0);
    expect(auditoria.filas[0].correccion?.motivo).toBe('Negocio anterior');
    expect(original.datos['Nombre del negocio']).toBe('Nombre antiguo');
    expect(original.datos.Instagram).toBe('1');
    expect(revisarRegistroGeneral(original).incidencias.length).toBe(2);
  });

  it('escala a muchos registros y cuenta filas con incidencias, no avisos repetidos', () => {
    const db = base();
    for (let i = 1; i <= 817; i++) {
      db.registros['r' + i] = fila('r' + i, { ...origen(i <= 35 ? '1' : '0', i <= 35 ? 'Nombre anterior' : 'Negocio ' + i, i <= 35 ? '' : '') });
    }
    const res = auditarRevisionGeneral(db, 'c26');
    expect(res.examinadas).toBe(817);
    expect(res.conIncidencias).toBe(35);
    expect(res.incidenciasPorTipo['vacio-con-nombre']).toBe(35);
    expect(res.incidenciasPorTipo['vacio-sin-fachada']).toBe(35);
  });
});
