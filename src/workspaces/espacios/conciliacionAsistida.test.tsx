import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { clear as idbClear, createStore, set as idbSet } from 'idb-keyval';
import { ConciliacionPosterior } from './ConciliacionPosterior';
import { useEspacios } from '../../store/espacios';
import { libroConFilas } from '../../data/xlsxItinerarios';
import { escenario, FILAS_2025, importar } from '../../domain/censo2026.fixture';

/** Conciliación asistida en la bandeja G5: selección consciente, candidatos plegados y actividad (SINTÉTICO). */
vi.setConfig({ testTimeout: 120000 });
const tienda = () => createStore('ulit-censo-ensayo', 'datos');
beforeAll(() => { if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
beforeEach(async () => { await idbClear(tienda()); useEspacios.getState().cerrar(); });

async function montar() {
  const filas2025 = FILAS_2025.map((f) => (f.nombre === 'PANADERÍA SINTÉTICA' ? { ...f, actividad: 'Pan y bollería sintética' } : f));
  const e = await escenario(filas2025);
  const libro = await libroConFilas('IT1', [
    { calle: 'Calle del Olmo', num: 3, nombre: 'PANADERÍA SINTÉTICA', actividad: 'Panadería sintética 2026', fecha: '2026-03-02' },
    { calle: 'Calle del Olmo', num: 'S/N', nombre: 'ZAPATERÍA SINTÉTICA', fecha: '2026-03-02' },
  ]);
  const db = (await importar(e.db, e, 'IT1', libro, 'itinerario_IT1_asistida_SINTETICO.xlsx')).aplicar().db;
  await idbSet('db', db, tienda());
  await useEspacios.getState().abrir('ensayo');
  render(<ConciliacionPosterior campanaId={e.campanaId} />);
  const fila = (re: RegExp) => screen.getAllByRole('listitem', { name: /^Fila \d+ de IT1/ }).find((li) => re.test(li.textContent ?? ''))!;
  return { e, fila };
}

describe('Conciliación asistida (interfaz)', () => {
  it('fila sin coincidencia de portal: nada preseleccionado, candidatos de otro portal plegados y señalados, y vincular exige confirmar y justificar', async () => {
    const { e, fila } = await montar();
    const zap = fila(/ZAPATERÍA/);
    expect(zap).toHaveTextContent('Sin correspondencia segura');
    expect(zap).toHaveTextContent('Ningún local en este portal.');
    expect(within(zap).getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);
    const vincular = within(zap).getByRole('button', { name: /mismo local físico/ });
    expect(vincular).toBeDisabled();
    // Los candidatos secundarios están plegados pero se pueden consultar y elegir
    const plegado = within(zap).getByText(/Otros locales de la calle, con otro número de portal/).closest('details')!;
    expect(plegado.open).toBe(false);
    const cands = within(plegado).getAllByLabelText(/^Candidato /);
    expect(cands.length).toBeGreaterThan(1);
    expect(cands.every((c) => /Otro número de portal/.test(c.textContent ?? ''))).toBe(true);
    fireEvent.click(within(cands[0]).getByRole('radio'));
    // Elegir otro portal exige confirmación explícita y justificación
    const conf = within(zap).getByRole('group', { name: /Confirmación de otro portal/ });
    expect(vincular).toBeDisabled();
    fireEvent.click(within(conf).getByRole('checkbox'));
    expect(vincular).toBeDisabled();
    fireEvent.change(within(conf).getByRole('textbox'), { target: { value: 'Portal renumerado, comprobado en campo' } });
    expect(vincular).toBeEnabled();
    fireEvent.click(vincular);
    await waitFor(() => expect(screen.getByLabelText('Decisiones tomadas')).toHaveTextContent(/Vinculada a un local existente.*«Otro portal: Portal renumerado, comprobado en campo»/), { timeout: 20000 });
    // Reversible
    fireEvent.click(within(screen.getByLabelText('Decisiones tomadas')).getByRole('button', { name: /Deshacer/ }));
    await waitFor(() => expect(fila(/ZAPATERÍA/)).toBeDefined(), { timeout: 20000 });
    expect(Object.values(useEspacios.getState().db!.observaciones).filter((o) => o.campanaId === e.campanaId).every((o) => o.localId === null)).toBe(true);
  });

  it('portal compartido: la propuesta clara llega preseleccionada, el otro local del portal es elegible, y se ve la actividad de 2025 y 2026', async () => {
    const { fila } = await montar();
    const pan = fila(/PANADERÍA/);
    expect(pan).toHaveTextContent('Propuesta clara');
    const [primero, segundo] = within(pan).getAllByLabelText(/^Candidato Calle del Olmo, 3/);
    expect(primero).toHaveTextContent(/Mismo portal.*«PANADERÍA SINTÉTICA»/);
    expect(segundo).toHaveTextContent(/Mismo portal.*«PELUQUERÍA SINTÉTICA»/);
    expect(within(primero).getByRole('radio')).toBeChecked();
    expect(within(primero).getByLabelText(/^Comparación con /)).toHaveTextContent(/ActividadPan y bollería sintéticaPanadería sintética 2026/);
    expect(within(primero).getByLabelText(/^Motivos de /)).toHaveTextContent(/En este portal hay 2 locales/);
    // El segundo local del mismo portal se elige sin confirmación de otro portal
    fireEvent.click(within(segundo).getByRole('radio'));
    expect(within(pan).queryByRole('group', { name: /Confirmación de otro portal/ })).toBeNull();
    expect(within(pan).getByRole('button', { name: /mismo local físico/ })).toBeEnabled();
  });
});
