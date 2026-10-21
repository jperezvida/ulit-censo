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
/** Contador de la barra de filtros («N de M establecimientos observados»). */
const contador = () => within(screen.getByRole('group', { name: 'Filtros' })).getByText(/de \d+ establecimientos observados/).textContent ?? '';

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
    const aviso = screen.getByLabelText('Origen de los datos');
    expect(aviso).toHaveTextContent(/Histórico importado · 2025/);
    expect(aviso).toHaveTextContent(/620 con el texto original de 2025 \(sin convertir al catálogo 2026\)/);
    expect(aviso).toHaveTextContent(/Datos de demostración/);
    const kpis = screen.getByLabelText('Indicadores principales');
    expect(kpis).toHaveTextContent('Registros censales890');
    expect(kpis).toHaveTextContent('Establecimientos observados860');
    expect(kpis).toHaveTextContent('Locales físicos identificados846');
    expect(kpis).toHaveTextContent(/Correspondencias pendientes890.*846 probables · 12 dudosas · 32 sin vínculo/);
    expect(screen.getByLabelText('Calles con más locales ocupados')).toBeInTheDocument();
    expect(screen.getByText(/% solo en calles con al menos 5 observados/)).toBeInTheDocument();
    // Filtro vinculado: pulsar un sector filtra todo
    fireEvent.click(within(screen.getByLabelText('Distribución por sector')).getByRole('row', { name: /^Servicios 203/ }));
    expect((screen.getByLabelText('Filtro de sector') as HTMLSelectElement).value).toBe('Servicios');
    expect(contador()).toMatch(/^\d+ de 860/);
    fireEvent.change(screen.getByLabelText('Filtro de sector'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filtro de franquicia'), { target: { value: 'si' } });
    expect(contador()).toMatch(/^58 de 860/);
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
    // Ámbitos distintos: comparación descriptiva, sin diferencias aritméticas
    expect(screen.getByLabelText('Ámbitos territoriales distintos')).toHaveTextContent(/no se calculan diferencias/);
    expect(within(screen.getByRole('table', { name: 'Comparación' })).queryByRole('columnheader', { name: 'Diferencia' })).toBeNull();
    expect(screen.queryByText(/diferencia de cifras:/)).toBeNull();
  });

  it('una campaña con geometría muestra el mapa por calle', () => {
    montar();
    fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Digitalización 1' }));
    expect(screen.getByRole('img', { name: 'Mapa por calle' })).toBeInTheDocument();
  });

  it('comparar: al cambiar el año principal, la campaña secundaria nunca es la misma y se avisa del cambio', () => {
    montar();
    fireEvent.click(screen.getByRole('tab', { name: 'Comparar' }));
    const sel = () => screen.getByLabelText('Campaña con la que comparar') as HTMLSelectElement;
    fireEvent.change(sel(), { target: { value: 'camp-medina-2025' } });
    expect(sel().value).toBe('camp-medina-2025');
    expect(screen.queryByLabelText('Selección de comparación cambiada')).toBeNull();
    // Con la pestaña Comparar abierta, el año principal pasa a ser 2025 (la campaña elegida).
    fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
    expect(sel().value).not.toBe('camp-medina-2025');
    expect([...sel().options].map((o) => o.value)).not.toContain('camp-medina-2025');
    expect([...sel().options].map((o) => o.value)).toContain(sel().value);
    expect(screen.getByLabelText('Selección de comparación cambiada')).toHaveTextContent(/es ahora la campaña principal: una campaña no se compara consigo misma/);
    const cab = within(screen.getByRole('table', { name: 'Comparación' })).getAllByRole('columnheader').map((h) => h.textContent);
    expect(cab[1]).not.toBe(cab[2]);
    // Elegir de nuevo explícitamente quita el aviso.
    fireEvent.change(sel(), { target: { value: 'camp-medina-2026' } });
    expect(screen.queryByLabelText('Selección de comparación cambiada')).toBeNull();
  });

  it('locales vacíos: los filtros de sector y franquicia no producen un cero engañoso; se explica y se pueden quitar', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    fireEvent.change(screen.getByLabelText('Filtro de sector'), { target: { value: 'Comercio' } });
    fireEvent.change(screen.getByLabelText('Filtro de franquicia'), { target: { value: 'no' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Locales vacíos' }));
    expect(screen.getByLabelText('Filtros no aplicados')).toHaveTextContent(/no se aplica el filtro de sector «Comercio» ni el de franquicia «No»/);
    expect(screen.getByText('Locales vacíos', { selector: '.vz-kpi-etq' }).parentElement).toHaveTextContent(/Locales vacíos240/);
    expect(contador()).toMatch(/^860 de 860/);
    // Los filtros siguen activos en las demás pestañas
    fireEvent.click(screen.getByRole('tab', { name: 'Resumen' }));
    expect(contador()).not.toMatch(/^860 de/);
    fireEvent.click(screen.getByRole('tab', { name: 'Locales vacíos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar estos filtros' }));
    expect(screen.queryByLabelText('Filtros no aplicados')).toBeNull();
    expect((screen.getByLabelText('Filtro de sector') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Filtro de franquicia') as HTMLSelectElement).value).toBe('');
  });

  it('rediseño: ranking con criterio, pestaña sectorial con comparación, filtro de calle y trazabilidad de calidad', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    // Resumen: ranking de calles con conmutador de criterio
    fireEvent.click(within(screen.getByRole('group', { name: 'Criterio del ranking' })).getByRole('button', { name: 'Vacíos' }));
    expect(screen.getByRole('table', { name: 'Calles con más locales vacíos' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Perfil de los sectores' })).toHaveTextContent(/Comercio292/);
    // Comercio: indicadores con su denominador y comparación con los otros sectores
    fireEvent.click(screen.getByRole('tab', { name: 'Comercio' }));
    expect(screen.getByLabelText('Indicadores de Comercio')).toHaveTextContent(/Peso en ocupados47,1 %292 de 620 ocupados/);
    expect(screen.getByRole('table', { name: 'Comparación con los otros sectores' })).toHaveTextContent(/Establecimientos292203125/);
    // Filtro de calle desde el selector y «Limpiar filtros»
    const calle = screen.getByLabelText('Filtro de calle') as HTMLSelectElement;
    fireEvent.change(calle, { target: { value: calle.options[1].value } });
    expect(contador()).not.toMatch(/^292 de/);
    fireEvent.click(screen.getByRole('button', { name: /Limpiar filtros/ }));
    expect(calle.value).toBe('');
    // Cobertura y calidad: del registro al establecimiento, sin restas
    fireEvent.click(screen.getByRole('tab', { name: 'Cobertura y calidad' }));
    expect(screen.getByLabelText('Indicadores de cobertura y calidad')).toHaveTextContent(/Sin establecimiento30/);
    expect(screen.getByLabelText('Trazabilidad: del registro al establecimiento')).toHaveTextContent(/890Filas importadas.*860Con establecimiento observado.*14Sin local identificado/);
  });

  it('avisos de origen calculados: un histórico con clasificaciones confirmadas no se presenta como «sin convertir»', () => {
    montar();
    // Medina 2025 (demostración): campaña de tipo histórico importado, con clasificaciones confirmadas en el modelo
    fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
    const aviso = screen.getByLabelText('Origen de los datos');
    expect(aviso).toHaveTextContent(/Histórico importado · 2025/);
    expect(aviso).toHaveTextContent(/474 confirmadas en el modelo/);
    expect(aviso).not.toHaveTextContent(/sin convertir/);
    expect(aviso).toHaveTextContent(/se refieren a la campaña de 2025, no son comprobaciones de 2026/);
    expect(aviso).toHaveTextContent(/Datos de demostración: los estados «confirmada» y «verificada» son ficticios/);
    // Mismo municipio: la comparación sí calcula diferencias
    fireEvent.click(screen.getByRole('tab', { name: 'Comparar' }));
    fireEvent.change(screen.getByLabelText('Campaña con la que comparar'), { target: { value: 'camp-medina-2026' } });
    expect(screen.queryByLabelText('Ámbitos territoriales distintos')).toBeNull();
    expect(within(screen.getByRole('table', { name: 'Comparación' })).getByRole('columnheader', { name: 'Diferencia' })).toBeInTheDocument();
  });
});
