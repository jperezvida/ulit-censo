import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { clear, createStore, get, set } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useStore } from '../../store/store';
import { escenarioSinCambios, INVESTIGADORA } from '../../domain/escenarioCampoEnsayo';
import type { BaseDatos } from '../../domain/db';

/** Campo en el ensayo · «Sin cambios» desde la interfaz con guardado verificado (datos SINTÉTICOS). */
vi.setConfig({ testTimeout: 60000 });
vi.mock('../../components/mapa/MapaBase', () => ({ MapaBase: () => <div data-testid="mapa" /> }));
const tienda = () => createStore('ulit-censo-ensayo', 'datos');
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});
beforeEach(async () => {
  await clear(tienda());
  useEspacios.getState().cerrar();
  useStore.setState({ db: null });
});
afterEach(() => cleanup());

async function abrir() {
  const e = await escenarioSinCambios();
  await set('db', e.db, tienda());
  render(<MemoryRouter initialEntries={[`/espacios/ensayo/campo/${e.campanaId}/${e.it}/calle/${e.olmo.id}`]}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Calle del Olmo' }, { timeout: 20000 });
  return e;
}
const fila = (n: string) => [...document.querySelectorAll('.m-local')].find((x) => x.querySelector('.m-local-num')?.textContent?.startsWith(n)) as HTMLElement;
const obsCampana = (db: BaseDatos, campanaId: string) => Object.values(db.observaciones).filter((o) => o.campanaId === campanaId);

describe('Campo en el ensayo · «Sin cambios» desde la interfaz', () => {
  it('confirma un local, muestra «Guardado comprobado» solo tras guardar y persiste al reabrir el ensayo', async () => {
    const e = await abrir();
    // Única investigadora asignada: preseleccionada; la selección es declarada, no autenticación
    expect((screen.getByLabelText(/Quién registra/) as HTMLSelectElement).value).toBe(INVESTIGADORA);
    const historico = obsCampana(e.db, e.historica);
    fireEvent.click(within(fila('1')).getByRole('button', { name: 'Sin cambios' }));
    await screen.findByText(/Nº 1: sin cambios\. Guardado comprobado\./, undefined, { timeout: 20000 });
    const guardada = (await get<BaseDatos>('db', tienda()))!;
    expect(obsCampana(guardada, e.campanaId)).toEqual([expect.objectContaining({ localId: e.local1.id, tipo: 'confirmado', investigadorId: INVESTIGADORA })]);
    expect(obsCampana(guardada, e.historica)).toEqual(historico);
    // El local queda marcado como registrado y sin botón
    expect(within(fila('1')).queryByRole('button', { name: 'Sin cambios' })).toBeNull();
    expect(fila('1')).toHaveTextContent(/Sin cambios/);
    // Las demás acciones siguen sin ofrecerse
    for (const n of ['Local nuevo', 'Finalizar calle', 'Registrar cambios', 'Cambiar']) expect(screen.queryByRole('button', { name: new RegExp(n) })).toBeNull();
    // Reabrir el ensayo
    useEspacios.getState().cerrar();
    await useEspacios.getState().abrir('ensayo');
    expect(obsCampana(useEspacios.getState().db!, e.campanaId)).toHaveLength(1);
    expect(useStore.getState().db).toBeNull();
  });

  it('si otra pestaña cambió el espacio, no confirma y explica la causa', async () => {
    const e = await abrir();
    const externa = { ...e.db, meta: { ...e.db.meta, nota: 'otra pestaña' } } as BaseDatos;
    await set('db', externa, tienda());
    fireEvent.click(within(fila('1')).getByRole('button', { name: 'Sin cambios' }));
    expect(await screen.findByRole('alert', {}, { timeout: 20000 })).toHaveTextContent(/No se ha guardado: .*otra pestaña/);
    expect(screen.queryByText(/Guardado comprobado/)).toBeNull();
    expect(await get<BaseDatos>('db', tienda())).toEqual(externa);
    expect(within(fila('1')).getByRole('button', { name: 'Sin cambios' })).toBeEnabled();
  });

  it('sin persona investigadora elegida no se registra, y la coordinación no aparece como opción', async () => {
    const e = await escenarioSinCambios();
    const dos = { ...e.db, personas: { ...e.db.personas, 'ensayo-per-otra': { id: 'ensayo-per-otra', nombre: 'Otra Investigadora', iniciales: 'OI', roles: ['investigador' as const], color: '#123' } },
      itinerarios: { ...e.db.itinerarios, [e.it]: { ...e.db.itinerarios[e.it], asignadosIds: [INVESTIGADORA, 'ensayo-per-otra'] } } };
    await set('db', dos, tienda());
    render(<MemoryRouter initialEntries={[`/espacios/ensayo/campo/${e.campanaId}/${e.it}/calle/${e.olmo.id}`]}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Calle del Olmo' }, { timeout: 20000 });
    const sel = screen.getByLabelText(/Quién registra/) as HTMLSelectElement;
    expect(sel.value).toBe('');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Quién registra…', 'Investigadora Sintética', 'Otra Investigadora']);
    expect(within(fila('1')).getByRole('button', { name: 'Sin cambios' })).toBeDisabled();
    fireEvent.change(sel, { target: { value: 'ensayo-per-otra' } });
    fireEvent.click(within(fila('1')).getByRole('button', { name: 'Sin cambios' }));
    await waitFor(async () => expect(obsCampana((await get<BaseDatos>('db', tienda()))!, e.campanaId)[0]?.investigadorId).toBe('ensayo-per-otra'), { timeout: 20000 });
  });
});
