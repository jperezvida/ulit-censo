import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DatosPage from './DatosPage';
import { useStore } from '../../store/store';
import { generarDemo } from '../../data/semilla';
import { callejeroSimulado, MEDINA } from '../../data/callejero';
import type { BaseDatos } from '../../domain/db';

let base: BaseDatos;
beforeAll(() => {
  base = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'test' });
  if (!File.prototype.text) {
    File.prototype.text = function text(this: File) {
      return new Promise<string>((ok) => {
        const r = new FileReader();
        r.onload = () => ok(r.result as string);
        r.readAsText(this);
      });
    };
  }
});
beforeEach(() => {
  useStore.setState({ db: base, carga: { fase: 'lista', mensaje: '' }, pilaDeshacer: [], pilaRehacer: [], prefs: { ...useStore.getState().prefs, municipioId: MEDINA.id, campanaId: 'camp-medina-2026', personaId: 'p-elena' } });
});

const montar = () => render(<MemoryRouter><DatosPage /></MemoryRouter>);

describe('Datos · análisis previo frente al importador CSV provisional', () => {
  it('el análisis previo es la acción principal; el CSV antiguo se presenta como demostración', () => {
    montar();
    expect(screen.getByRole('button', { name: /Análisis previo de importación/ })).toHaveClass('primario');
    const csv = screen.getByRole('button', { name: /Importador CSV provisional/ });
    expect(csv).not.toHaveClass('primario');
    expect(csv).toHaveTextContent('demostración');
    expect(screen.queryByRole('button', { name: /^Nueva importación$/ })).toBeNull();
  });

  it('un CSV subido solo se previsualiza: no se puede incorporar y la base de datos no cambia', async () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /Importador CSV provisional/ }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByRole('note', { name: 'Importador provisional' })).toHaveTextContent(/no apto para censos reales/);
    expect(within(dlg).getByRole('note', { name: 'Importador provisional' })).toHaveTextContent(/83/);
    fireEvent.click(within(dlg).getByText('A · Censo histórico completo'));
    const csv = 'Calle;Num;Nombre del negocio;Local Vacío\nCalle Ficticia;1;Comercio Ficticio;0\n';
    const input = dlg.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([csv], 'subido.csv', { type: 'text/csv' })] } });
    });
    await waitFor(() => within(dlg).getByText(/Solo previsualización/));
    const confirmar = within(dlg).getByRole('button', { name: 'Confirmar incorporación' });
    expect(confirmar).toBeDisabled();
    const antes = useStore.getState().db;
    fireEvent.click(confirmar);
    expect(useStore.getState().db).toBe(antes);
  });

  it('los ejemplos simulados siguen pudiéndose incorporar (escenarios ficticios preservados)', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /Importador CSV provisional/ }));
    const dlg = screen.getByRole('dialog');
    fireEvent.click(within(dlg).getByText('A · Censo histórico completo'));
    fireEvent.click(within(dlg).getByRole('button', { name: /Usar un archivo de ejemplo/ }));
    expect(within(dlg).getByText('Archivo simulado')).toBeInTheDocument();
    const confirmar = within(dlg).getByRole('button', { name: 'Confirmar incorporación' });
    expect(confirmar).toBeEnabled();
    const antes = Object.keys(useStore.getState().db!.campanas).length;
    fireEvent.click(confirmar);
    expect(Object.keys(useStore.getState().db!.campanas).length).toBe(antes + 1);
  });
});
