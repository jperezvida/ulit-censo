import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import type { BaseDatos } from '../../domain/db';
import PendientesSinLocal, { vistaBreveRegistro } from './PendientesSinLocal';

function escenario(): BaseDatos {
  const db = baseVacia();
  db.municipios.medina = { id: 'medina', nombre: 'Medina del Campo', provincia: 'Valladolid', fuenteCallejero: 'osm' };
  for (const [id, anio] of [['c25', 2025], ['c26', 2026]] as const) {
    db.campanas[id] = {
      id, anio, municipioId: 'medina', nombre: 'Censo ' + anio,
      tipo: anio === 2025 ? 'historico-importado' : 'actualizacion',
      periodo: { inicio: anio + '-01-01' }, ambitoCalleIds: [], ampliacionCalleIds: [],
      estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
      procedencia: 'importado',
    };
    db.importaciones['imp-' + id] = {
      id: 'imp-' + id, municipioId: 'medina', campanaId: id, tipo: 'C-excel-itinerario',
      archivo: id + '.xlsx', huella: id, fecha: '2026-11-07', filas: anio === 2026 ? 105 : 1,
      estado: 'confirmada', resumen: {}, procedencia: 'importado',
    };
  }
  db.itinerarios.it1 = { id: 'it1', campanaId: 'c26', codigo: 'IT1', nombre: 'Primero',
    color: '#0044ff', origen: 'excel', tramos: [], asignadosIds: [], creado: '2026-11-07' };
  db.registros.historico = { id: 'historico', importacionId: 'imp-c25', fila: 1, datos: { Negocio: 'Histórico' } };
  for (let i = 1; i <= 105; i++) {
    const id = 'fila-' + i;
    db.registros[id] = { id, importacionId: 'imp-c26', itinerarioId: 'it1', fila: i, datos: { 'Dirección': 'Calle Prueba', Num: String(i), 'Nombre del negocio': 'Negocio ' + i, Actividad: 'Peluquería' } };
    db.vinculos['v-' + i] = {
      id: 'v-' + i, origen: { tipo: 'registro', id }, localId: i <= 14 ? 'local-' + i : null,
      confianza: i <= 14 ? 'confirmada' : 'sin-vinculo', criterio: 'Prueba',
    };
  }
  return db;
}

const db = escenario();
function Vista({ campanaId }: { campanaId: string }) {
  return (
    <FuenteOficinaContext.Provider value={{
      db, campanaId, personaId: 'operador', roles: ['administrador'], soloLectura: true, aplicar: () => false,
    }}>
      <MemoryRouter><PendientesSinLocal /></MemoryRouter>
    </FuenteOficinaContext.Provider>
  );
}

describe('Oficina real: registros originales sin local', () => {
  it('muestra 91 de las 105 filas de IT1 sin tratar el histórico 2025 como campaña activa', () => {
    render(<Vista campanaId="c26" />);
    expect(screen.getByText(/91 registros pendientes de asociación/)).toBeInTheDocument();
    expect(screen.getByText(/91 de 91 filas/)).toBeInTheDocument();
    expect(screen.queryByText('Histórico')).not.toBeInTheDocument();
    expect(screen.queryByText('IT1 · fila 1')).not.toBeInTheDocument();
    expect(screen.getByText('IT1 · fila 15')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de IT1 · fila 15' }));
    expect(screen.getByText('Detalle de la fila 15')).toBeInTheDocument();
    expect(screen.getAllByText('Negocio 15').length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Calle Prueba').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /conciliar|guardar|vincular/i })).not.toBeInTheDocument();
  });

  it('identifica calle, negocio y actividad por cabecera, no por las primeras columnas CP o municipio', () => {
    const r = {
      id: 'r', importacionId: 'imp', fila: 1,
      datos: { CP: '47400', Num: '3', Municipio: 'Medina del Campo', 'Dirección': 'Calle Mayor', 'Nombre del negocio': 'Comercio X', Actividad: 'Moda' },
    };
    expect(vistaBreveRegistro(r)).toEqual({ calle: 'Calle Mayor', numero: '3', negocio: 'Comercio X', actividad: 'Moda' });
  });

  it('no mezcla registros de otras campañas', () => {
    render(<Vista campanaId="c25" />);
    expect(screen.getByText(/1 registros pendientes de asociación/)).toBeInTheDocument();
    expect(screen.queryByText('IT1 · fila 15')).not.toBeInTheDocument();
  });
});
