import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import type { BaseDatos } from '../../domain/db';
import { ExportacionTrabajo2026 } from './ExportacionTrabajo2026';

function prueba(): BaseDatos {
  const db = baseVacia();
  db.campanas.c26 = {
    id: 'c26', municipioId: 'medina', anio: 2026, nombre: 'Censo 2026',
    tipo: 'actualizacion', periodo: { inicio: '2026-01-01' },
    ambitoCalleIds: [], ampliacionCalleIds: [],
    estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
    procedencia: 'importado',
  };
  db.itinerarios.it1 = { id: 'it1', campanaId: 'c26', codigo: 'IT1', nombre: 'Zona 1', color: '#123',
    origen: 'excel', tramos: [], asignadosIds: [], creado: '2026-11-10' };
  db.itinerarios.it2 = { ...db.itinerarios.it1, id: 'it2', codigo: 'IT2', nombre: 'Zona 2' };
  db.importaciones.i1 = { id: 'i1', campanaId: 'c26', municipioId: 'medina', archivo: 'IT1.xlsx',
    tipo: 'C-excel-itinerario', fecha: '2026-11-10', filas: 1,
    huella: 'abc', estado: 'confirmada', resumen: {}, procedencia: 'importado' };
  db.importaciones.i2 = { ...db.importaciones.i1, id: 'i2', archivo: 'IT2.xlsx' };
  db.registros.r1 = { id: 'r1', fila: 2, importacionId: 'i1', itinerarioId: 'it1',
    datos: { 'Dirección': 'Calle Uno', Num: '1', 'Local Vacío': '1',
      'Nombre del negocio': '', 'Long fachada': '4' } };
  db.registros.r2 = { id: 'r2', fila: 2, importacionId: 'i2', itinerarioId: 'it2',
    datos: { 'Dirección': 'Calle Dos', Num: '2', 'Local Vacío': '0',
      'Nombre del negocio': 'Tienda', 'Long fachada': '' } };
  return db;
}

describe('Análisis · exportación de trabajo 2026', () => {
  it('muestra el total de Excel y permite filtrar por itinerario sin mezclar locales consolidados', () => {
    const db = prueba();
    render(<MemoryRouter><ExportacionTrabajo2026
      db={db} campanaId="c26" municipio="Medina del Campo"
      its={Object.values(db.itinerarios)} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /Excel de trabajo 2026/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Descargar Excel de trabajo \(2 filas\)/ })).toBeEnabled();
    expect(screen.getByText(/no es el censo final de locales únicos/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Itinerario para exportar el trabajo 2026'), { target: { value: 'it2' } });
    expect(screen.getByRole('button', { name: /Descargar Excel de trabajo \(1 filas\)/ })).toBeEnabled();
    expect(screen.getByRole('link', { name: 'Ir a Revisión general' })).toHaveAttribute('href', '/oficina/revision-general');
    expect(Object.keys(db.registros)).toHaveLength(2);
  });

  it('desactiva la descarga en una selección sin filas reales', () => {
    const db = prueba();
    delete db.registros.r2;
    render(<MemoryRouter><ExportacionTrabajo2026
      db={db} campanaId="c26" municipio="Medina del Campo"
      its={Object.values(db.itinerarios)} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Itinerario para exportar el trabajo 2026'), { target: { value: 'it2' } });
    expect(screen.getByRole('button', { name: /Descargar Excel de trabajo \(0 filas\)/ })).toBeDisabled();
  });
});
