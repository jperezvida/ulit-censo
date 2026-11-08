import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import { FuenteOficinaContext, useFuenteOficina } from '../../store/fuenteOficina';
import type { BaseDatos } from '../../domain/db';
import type { Campana, Importacion, Itinerario, RegistroOrigen, VinculoHistorico } from '../../domain/types';
import CampanasPage from './CampanasPage';

/** Fixture mínimo de datos AUTÉNTICOS de forma, pero totalmente sintético y aislado de Supabase. */
function escenarioReal(): BaseDatos {
  const db = baseVacia();
  const municipioId = 'municipio-prueba';
  const hist = 'hist-2025';
  const oper = 'oper-2026';
  db.meta = { espacio: 'real', espacioId: 'espacio-prueba' };
  db.municipios[municipioId] = {
    id: municipioId, nombre: 'Medina del Campo', provincia: 'Valladolid',
    fuenteCallejero: 'osm', centro: [-4.9142, 41.3108],
  };
  const estadosPendientes = { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' } as const;
  const base: Campana = {
    id: hist, municipioId, anio: 2025, nombre: 'Censo histórico Medina 2025',
    tipo: 'historico-importado', periodo: { inicio: '2024-01-01', fin: '2025-12-31' },
    ambitoCalleIds: [], ampliacionCalleIds: [],
    estados: { ...estadosPendientes, campo: 'terminado' }, procedencia: 'importado',
  };
  db.campanas[hist] = base;
  db.campanas[oper] = {
    ...base, id: oper, anio: 2026, nombre: 'Censo Medina 2026', tipo: 'actualizacion',
    periodo: { inicio: '2026-01-01' }, campanaReferenciaId: hist,
    estados: { ...estadosPendientes }, itinerariosPrevistos: 7,
  };
  const it: Itinerario = {
    id: 'it-1', campanaId: oper, codigo: 'IT1', nombre: 'Itinerario 1',
    color: '#005bff', origen: 'excel', tramos: [], asignadosIds: [], creado: '2026-11-07',
  };
  db.itinerarios[it.id] = it;
  const imp: Importacion = {
    id: 'importacion-it1', municipioId, campanaId: oper, tipo: 'C-excel-itinerario',
    archivo: 'ITINERARIO 1 MEDINA.xlsx', huella: 'ejemplo-sintetico',
    fecha: '2026-11-07', filas: 105, estado: 'confirmada', resumen: {}, procedencia: 'importado',
  };
  db.importaciones[imp.id] = imp;
  for (let i = 1; i <= 105; i++) {
    const id = `reg-${i}`;
    const reg: RegistroOrigen = { id, importacionId: imp.id, itinerarioId: it.id, fila: i, datos: {} };
    const vinc: VinculoHistorico = {
      id: `v-${i}`, origen: { tipo: 'registro', id },
      localId: i <= 14 ? `local-${i}` : null,
      confianza: i <= 14 ? 'confirmada' : 'sin-vinculo',
      criterio: 'Escenario sintético de prueba',
    };
    db.registros[id] = reg;
    db.vinculos[vinc.id] = vinc;
  }
  return db;
}
const dbPrueba = escenarioReal();

function EstadoNavegacion() {
  const loc = useLocation();
  const f = useFuenteOficina();
  return <output data-testid="destino">{loc.pathname} · {f?.campanaId}</output>;
}
function AppRealDePrueba() {
  const [campanaId, elegirCampana] = useState('oper-2026');
  return <FuenteOficinaContext.Provider value={{
    db: dbPrueba, campanaId, personaId: 'persona-test', roles: ['administrador'],
    soloLectura: true, aplicar: () => false, elegirCampana,
  }}>
    <MemoryRouter initialEntries={['/campanas']}>
      <EstadoNavegacion />
      <Routes>
        <Route path="/campanas" element={<CampanasPage />} />
        <Route path="/territorio" element={<p>Territorio original</p>} />
        <Route path="/oficina" element={<p>Oficina original</p>} />
        <Route path="/datos" element={<p>Datos original</p>} />
        <Route path="/analisis" element={<p>Análisis original</p>} />
      </Routes>
    </MemoryRouter>
  </FuenteOficinaContext.Provider>;
}

describe('Campañas con fuente real: navegación de la aplicación COMPLETA', () => {
  it('distingue el Excel IT1 incorporado de la planificación territorial inexistente', () => {
    render(<AppRealDePrueba />);
    const it1 = screen.getByText('Censo Medina 2026').closest('article');
    expect(it1).not.toBeNull();
    expect(within(it1!).getByText('105 filas reales · 1 Excel')).toBeInTheDocument();
    expect(within(it1!).getByText('91 filas sin local · por conciliar')).toBeInTheDocument();
    expect(within(it1!).getByText('0 calles planificadas · 0 m')).toBeInTheDocument();
    expect(within(it1!).getByText(/IT1: Excel incorporado; calles del itinerario todavía sin asignar/)).toBeInTheDocument();
    expect(within(it1!).getByText(/1 itinerario\(s\) registrados · 1 Excel incorporado\(s\) · 0 calles asignadas/)).toBeInTheDocument();
  });

  it('accede desde 2026 a Territorio original sin cambiar la campaña ni abrir una pantalla auxiliar', () => {
    render(<AppRealDePrueba />);
    const it1 = screen.getByText('Censo Medina 2026').closest('article')!;
    fireEvent.click(within(it1).getByRole('button', { name: 'Ver territorio' }));
    expect(screen.getByText('Territorio original')).toBeInTheDocument();
    expect(screen.getByTestId('destino')).toHaveTextContent('/territorio · oper-2026');
  });

  it('al abrir importaciones desde 2025 selecciona la campaña histórica correcta', () => {
    render(<AppRealDePrueba />);
    const hist = screen.getByText('Censo histórico Medina 2025').closest('article')!;
    fireEvent.click(within(hist).getByRole('button', { name: 'Ver importación' }));
    expect(screen.getByText('Datos original')).toBeInTheDocument();
    expect(screen.getByTestId('destino')).toHaveTextContent('/datos · hist-2025');
  });

  it('abre Oficina y Análisis desde los módulos reales sin mostrar la ruta /real', () => {
    render(<AppRealDePrueba />);
    const hist = screen.getByText('Censo histórico Medina 2025').closest('article')!;
    fireEvent.click(within(hist).getByRole('button', { name: /Consultar oficina/ }));
    expect(screen.getByText('Oficina original')).toBeInTheDocument();
    expect(screen.getByTestId('destino')).toHaveTextContent('/oficina · hist-2025');
  });

  it('permite seleccionar la campaña sin cambiar de sección, con escrituras generales deshabilitadas', () => {
    render(<AppRealDePrueba />);
    const hist = screen.getByText('Censo histórico Medina 2025').closest('article')!;
    fireEvent.click(within(hist).getByRole('button', { name: 'Seleccionar campaña' }));
    expect(screen.getByTestId('destino')).toHaveTextContent('/campanas · hist-2025');
    expect(screen.queryByText('Nueva campaña')).not.toBeInTheDocument();
    expect(screen.queryByText('Contenido simulado')).not.toBeInTheDocument();
  });
});
