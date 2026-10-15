import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useStore } from '../../store/store';
import { generarDemo } from '../../data/semilla';
import { callejeroSimulado, MEDINA } from '../../data/callejero';
import CampanasPage from './CampanasPage';

describe('Campañas (interfaz)', () => {
  it('muestra Medina del Campo con sus campañas y marca los datos como simulados', () => {
    const db = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'test' });
    useStore.setState({ db, carga: { fase: 'lista', mensaje: '' } });
    render(
      <MemoryRouter>
        <CampanasPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Medina del Campo').length).toBeGreaterThan(0);
    expect(screen.getByText('Censo 2026')).toBeInTheDocument();
    expect(screen.getByText('Censo 2025')).toBeInTheDocument();
    expect(screen.getAllByText(/simulad/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/4 de ~7 itinerarios/)).toBeInTheDocument();
  });
});
