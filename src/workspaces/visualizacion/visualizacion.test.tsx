import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import VisualizacionPage from './VisualizacionPage';
import { useStore } from '../../store/store';
import { generarDemo } from '../../data/semilla';
import { callejeroSimulado, MEDINA } from '../../data/callejero';
import { MUNICIPIO_DEMO, prepararMunicipioDemo } from '../../data/escenarioIncorporacion';
import { aplicarEscenario, prepararEscenario } from '../../domain/incorporacionDemo';

/** Datos FICTICIOS: demostración + escenario generado por la aplicación. */
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const demo = prepararMunicipioDemo(generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'vz' }));
  const p = await prepararEscenario(demo, 'medina-2025-ficticio', 2025, {});
  const r = await aplicarEscenario(demo, 'medina-2025-ficticio', 2025, p.resultado, {}, p.plan, 'p-elena');
  useStore.setState({ db: r.db, prefs: { ...useStore.getState().prefs, municipioId: 'mun-medina', campanaId: 'camp-medina-2026' } });
}, 120000);

const montar = () => render(<MemoryRouter><VisualizacionPage /></MemoryRouter>);

describe('C1d-B · Dashboard', () => {
  it('ámbito, año y emblema neutro; tipos de ámbito sin datos deshabilitados', () => {
    montar();
    expect(screen.getByRole('img', { name: /Identificador neutro de Medina del Campo \(sin escudo verificado\)/ })).toBeInTheDocument();
    const tipos = screen.getByLabelText('Tipo de ámbito') as HTMLSelectElement;
    expect([...tipos.options].filter((o) => o.disabled).map((o) => o.textContent)).toEqual(['Barrio (sin datos)', 'Eje comercial (sin datos)', 'Zona de estudio (sin datos)', 'Mercado municipal (sin datos)']);
    expect(screen.getByRole('tablist', { name: 'Año y campaña' })).toHaveTextContent(/2026.*en curso.*2025.*histórico/);
    // Sin CP en el origen: el filtro está deshabilitado (no se deduce)
    expect(screen.getByLabelText('Filtro de código postal')).toBeDisabled();
  });

  it('histórico importado: aviso de referencia, cifras separadas y filtros vinculados', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    expect(screen.getByText(/Es una referencia: nada está revisado ni verificado para 2026/)).toBeInTheDocument();
    const kpis = screen.getByLabelText('Indicadores principales');
    expect(kpis).toHaveTextContent('Registros censales890');
    expect(kpis).toHaveTextContent('Establecimientos observados860');
    expect(kpis).toHaveTextContent('Locales físicos identificados842');
    expect(kpis).toHaveTextContent(/Correspondencias pendientes890.*842 probables · 16 dudosas · 32 sin vínculo/);
    expect(screen.getByLabelText('Calles con más locales ocupados')).toBeInTheDocument();
    expect(screen.getByText(/\* Umbral: solo calles con al menos 5 establecimientos observados/)).toBeInTheDocument();
    // Filtro vinculado: pulsar un sector filtra todo
    fireEvent.click(within(screen.getByLabelText('Distribución por sector')).getByTitle(/^Servicios:/));
    expect((screen.getByLabelText('Filtro de sector') as HTMLSelectElement).value).toBe('Servicios');
    expect(screen.getByText(/de 860 establecimientos observados/).textContent).toMatch(/^\d+ de 860/);
    fireEvent.change(screen.getByLabelText('Filtro de sector'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filtro de franquicia'), { target: { value: 'si' } });
    expect(screen.getByText(/de 860 establecimientos observados/).textContent).toMatch(/^58 de 860/);
  });

  it('pestañas de vacíos, digitalización (estado importado, sin coordenadas inventadas) y comparar con avisos de cobertura', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    fireEvent.click(screen.getByRole('tab', { name: 'Locales vacíos' }));
    expect(screen.getByText('CP con más vacíos').parentElement).toHaveTextContent('47400');
    fireEvent.click(screen.getByRole('tab', { name: 'Digitalización 1' }));
    expect(screen.getAllByLabelText('Estado de la revisión digital')[0]).toHaveTextContent(/Verificada 0 .*Borrador o importada 620 100 %/);
    expect(screen.getByText(/no tienen geometría fiable/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mapa de calor por calle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Digitalización 2' }));
    expect(screen.getByText(/Solo se calcula con los seis respondidos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Comparar' }));
    fireEvent.change(screen.getByLabelText('Campaña con la que comparar'), { target: { value: 'camp-medina-2025' } });
    expect(screen.getAllByRole('note').some((n) => /Las diferencias no son aperturas ni cierres confirmados/.test(n.textContent ?? ''))).toBe(true);
    expect(screen.getByText(/Son ámbitos geográficos distintos/)).toBeInTheDocument();
  });

  it('una campaña con geometría muestra el mapa por calle', () => {
    montar();
    fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Digitalización 1' }));
    expect(screen.getByRole('img', { name: 'Mapa por calle' })).toBeInTheDocument();
  });
});
