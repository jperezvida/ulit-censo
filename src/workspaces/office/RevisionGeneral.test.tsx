import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import RevisionGeneral from './RevisionGeneral';

function Vista() {
  const db = baseVacia();
  db.municipios.medina = { id: 'medina', nombre: 'Medina del Campo', provincia: 'Valladolid', fuenteCallejero: 'osm' };
  db.campanas.c26 = { id: 'c26', municipioId: 'medina', anio: 2026, nombre: 'Censo 2026', tipo: 'actualizacion',
    periodo: { inicio: '2026-01-01' }, ambitoCalleIds: [], ampliacionCalleIds: [],
    estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
    procedencia: 'importado' };
  db.importaciones.imp = { id: 'imp', municipioId: 'medina', campanaId: 'c26', tipo: 'C-excel-itinerario',
    archivo: 'IT1.xlsx', huella: 'abc', fecha: '2026-11-10', filas: 2, estado: 'confirmada', resumen: {}, procedencia: 'importado' };
  db.itinerarios.it1 = { id: 'it1', campanaId: 'c26', codigo: 'IT1', nombre: 'Primero', origen: 'excel', color: '#009',
    tramos: [], asignadosIds: [], creado: '2026-11-10' };
  db.registros.a = { id: 'a', importacionId: 'imp', itinerarioId: 'it1', fila: 1,
    datos: { 'Dirección': 'Calle A', Num: '2', 'Local Vacío': '1', 'Nombre del negocio': '', 'Long fachada': '' } };
  db.registros.b = { id: 'b', importacionId: 'imp', itinerarioId: 'it1', fila: 2,
    datos: { 'Dirección': 'Calle B', Num: '2', 'Local Vacío': '0', 'Nombre del negocio': 'Comercio B', 'Long fachada': '' } };
  return <FuenteOficinaContext.Provider value={{ db, campanaId: 'c26', personaId: 'admin', roles: ['administrador'],
    soloLectura: true, aplicar: () => false }}>
    <MemoryRouter><RevisionGeneral /></MemoryRouter>
  </FuenteOficinaContext.Provider>;
}

describe('Oficina · interfaz de revisión general', () => {
  it('presenta sólo los problemas inicialmente y permite mirar vacíos y ocupados sin editar datos', () => {
    render(<Vista />);
    expect(screen.getByRole('heading', { name: 'Revisión general' })).toBeInTheDocument();
    expect(screen.getByText(/registros comprobados/)).toBeInTheDocument();
    expect(screen.getAllByText(/Faltan metros válidos/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Locales ocupados/ }));
    expect(screen.getAllByText('Comercio B').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Guardar|Corregir|Aprobar/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Consultar todas las columnas del Excel original'));
    expect(screen.getByText('Local Vacío')).toBeInTheDocument();
  });
});
