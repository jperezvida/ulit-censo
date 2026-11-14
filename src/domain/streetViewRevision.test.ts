import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import type { BaseDatos } from './db';
import type { FilaRevisionGeneral } from './revisionGeneral';
import { streetViewParaRevision } from './streetViewRevision';

const CAMPANA = 'c26';
function escenario(): { db: BaseDatos; fila: FilaRevisionGeneral } {
  const db = baseVacia();
  db.municipios.medina = {
    id: 'medina', nombre: 'Medina del Campo', provincia: 'Valladolid', fuenteCallejero: 'osm',
  };
  db.campanas[CAMPANA] = {
    id: CAMPANA, municipioId: 'medina', anio: 2026, nombre: 'Censo 2026',
    tipo: 'actualizacion', periodo: { inicio: '2026-01-01' }, ambitoCalleIds: [], ampliacionCalleIds: [],
    estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
    procedencia: 'importado',
  };
  db.calles.leonor = {
    id: 'leonor', municipioId: 'medina', nombre: 'Calle de Leonor de Aragón',
    tipoVia: 'Calle', procedencia: 'osm', longitudM: 150, refsFuente: ['osm:way/1'],
    segmentos: [{ id: 'tramo1', coords: [[-4.921205, 41.309758], [-4.920205, 41.310758]],
      longitudM: 150 }],
  };
  const registro = { id: 'r20', importacionId: 'it1', itinerarioId: 'it1', fila: 20,
    datos: { 'Local Vacío': '1', Dirección: 'Calle Doña Leonor', Num: '31' } };
  const fila: FilaRevisionGeneral = {
    id: registro.id, registro, archivo: 'ITINERARIO 1.xlsx', itinerario: 'IT1',
    direccion: 'Calle Doña Leonor', numero: '31', nombre: '', estado: 'vacio', incidencias: [],
  };
  return { db, fila };
}

describe('Street View directo · Fase 1', () => {
  it('Doña Leonor 31 abre panorama y avisa que el portal NO está geolocalizado', () => {
    const { db, fila } = escenario();
    const resultado = streetViewParaRevision(db, CAMPANA, fila);
    expect(resultado?.origen).toBe('calle');
    expect(resultado?.precision).toBe('aproximada');
    expect(resultado?.aviso).toContain('NO del portal 31');
    const url = new URL(resultado!.url);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('www.google.com');
    expect(url.pathname).toBe('/maps/@');
    expect(url.searchParams.get('map_action')).toBe('pano');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.has('query')).toBe(false);
    const [lat,lng] = url.searchParams.get('viewpoint')!.split(',').map(Number);
    expect(lat).toBeCloseTo(41.310258);
    expect(lng).toBeCloseTo(-4.920705);
  });

  it('prioriza la coordenada verificada del local vinculado', () => {
    const { db, fila } = escenario();
    db.locales.local1 = {
      id: 'local1', municipioId: 'medina', direcciones: [], coord: [-4.9181, 41.3123],
      coordVerificada: { fuente: 'gps-campo', fecha: '2026-11-14' },
      estado: 'activo', procedencia: 'manual',
    };
    db.vinculos.v1 = {
      id: 'v1', origen: { tipo: 'registro', id: fila.id }, localId: 'local1',
      confianza: 'confirmada', criterio: 'revisión manual',
    };
    const resultado = streetViewParaRevision(db, CAMPANA, fila)!;
    expect(resultado.origen).toBe('local-verificado');
    expect(resultado.precision).toBe('verificada');
    expect(new URL(resultado.url).searchParams.get('viewpoint')).toBe('41.3123,-4.9181');
  });

  it('no toma el municipio como fachada si falta la calle', () => {
    const { db, fila } = escenario();
    db.municipios.medina.centro = [-4.914, 41.309];
    fila.direccion = 'Calle no identificada';
    expect(streetViewParaRevision(db, CAMPANA, fila)).toBeNull();
  });

  it('no inventa posición si hay dos calles homónimas ni usa calles simuladas', () => {
    const { db, fila } = escenario();
    db.calles.leonor2 = { ...db.calles.leonor, id: 'leonor2' };
    expect(streetViewParaRevision(db, CAMPANA, fila)).toBeNull();
    delete db.calles.leonor2;
    db.calles.leonor.procedencia = 'simulado';
    expect(streetViewParaRevision(db, CAMPANA, fila)).toBeNull();
  });

  it('no confunde calles de municipios diferentes y usa alias del callejero', () => {
    const { db, fila } = escenario();
    fila.direccion = 'Calle del Duque de Ahumada';
    db.calles.leonor.alias = [{ nombre: 'Calle del Duque de Ahumada', tipo: 'alternativo',
      fuente: 'callejero', porId: 'coordinacion', fecha: '2026-11-14' }];
    expect(streetViewParaRevision(db, CAMPANA, fila)?.origen).toBe('calle');
    db.calles.leonor.municipioId = 'otro';
    expect(streetViewParaRevision(db, CAMPANA, fila)).toBeNull();
  });
});
