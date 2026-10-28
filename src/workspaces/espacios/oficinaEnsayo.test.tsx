import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { clear as idbClear, createStore, get as idbGet, set as idbSet } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useStore } from '../../store/store';
import { archivoItinerario, libroItinerario } from '../../data/xlsxItinerarios';
import { escenario, historico, importar } from '../../domain/censo2026.fixture';
import { pendientesCampana, vincularALocal } from '../../domain/conciliacionPosterior';
import { estadosItinerario } from '../../domain/resumenCampana';
import { kNC, type BaseDatos } from '../../domain/db';
import type { RevisionDigital } from '../../domain/types';

/** Oficina sobre una campaña operativa del espacio de ensayo (datos SINTÉTICOS). */
vi.setConfig({ testTimeout: 240000 });
const tienda = () => createStore('ulit-censo-ensayo', 'datos');
const AHORA = '2026-10-28T10:00:00.000Z';
beforeAll(() => { if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
beforeEach(async () => { await idbClear(tienda()); useEspacios.getState().cerrar(); useStore.setState({ db: null }); });

/**
 * 2025 sintético + IT1 2026 incorporado. Conciliadas: PANADERÍA (mismo local), FERRETERÍA (local de la antigua
 * DROGUERÍA: negocio nuevo) y el vacío de Olmo 5. Sin conciliar: PELUQUERÍA y ESTANCO. La DROGUERÍA tiene datos
 * digitales de 2025 (no deben pasar a la FERRETERÍA).
 */
async function preparar() {
  const e = await escenario();
  let db = (await importar(e.db, e, 'IT1', await libroItinerario('IT1'), archivoItinerario('IT1'))).aplicar().db;
  const f = { porId: e.o.porId, ahora: AHORA };
  for (const re of [/PANADERÍA/, /FERRETERÍA/, /^\(vacío\)$/]) {
    const p = pendientesCampana(db, e.campanaId).find((x) => re.test(x.nombre ?? '(vacío)'))!;
    db = vincularALocal(db, e.campanaId, p.registroId, p.candidatos[0].localId, f);
  }
  const drog = Object.values(db.negocios).find((n) => n.nombre === 'DROGUERÍA SINTÉTICA')!;
  const dig: RevisionDigital = { negocioId: drog.id, campanaId: e.historica, estado: 'verificada', datos: { instagram: { respuesta: 'si', origen: 'importado' }, web: { respuesta: 'si', origen: 'importado' } }, historial: [] } as unknown as RevisionDigital;
  db = { ...db, digital: { ...db.digital, [kNC(drog.id, e.historica)]: dig } };
  await idbSet('db', db, tienda());
  return { e, db };
}

const montar = (campanaId: string, itId: string) => render(
  <MemoryRouter initialEntries={[`/espacios/ensayo/oficina/${campanaId}/${itId}`]}>
    <Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes>
  </MemoryRouter>,
);
const lista = () => screen.getByRole('listbox', { name: 'Establecimientos de IT1' });
const abrir = (re: RegExp) => fireEvent.click(within(lista()).getAllByRole('option').find((o) => re.test(o.textContent ?? ''))!);
const panel = () => screen.getByRole('complementary', { name: 'Revisión del registro' });
const guardado = (etiqueta: RegExp) => waitFor(() => expect(screen.getAllByRole('status').map((s) => s.textContent).join(' ')).toMatch(etiqueta), { timeout: 20000 });
const estadosFicha = () => [...within(panel()).getByRole('group', { name: 'Estados del registro' }).querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')).join(' · ');
const leer = async () => (await idbGet<BaseDatos>('db', tienda()))!;

describe('Oficina en el espacio de ensayo (IT1 · 2026)', () => {
  it('ficha, clasificación y presencia digital guardadas en la campaña 2026 del espacio; vacío, pendientes, recarga y aislamiento', async () => {
    const { e, db: inicial } = await preparar();
    const demoAntes = useStore.getState().db;
    const { unmount } = montar(e.campanaId, e.its.IT1);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Oficina de IT1' })).toBeInTheDocument(), { timeout: 20000 });
    const oficina = screen.getByRole('region', { name: 'Oficina de IT1' });

    // Establecimientos con local (alta + 3 conciliados); las 2 filas sin conciliar se cuentan aparte y no como revisadas
    expect(within(lista()).getAllByRole('option')).toHaveLength(4);
    expect(within(oficina).getByLabelText('Estados de IT1')).toHaveTextContent(/Campo: Excel incorporado \(6 registros\).*Oficina: 2 sin conciliar · 0\/4 locales revisados.*Validación: pendiente/);
    expect(within(oficina).getByText(/Resolver 2 fila\(s\) sin conciliar \(G5\)/)).toBeInTheDocument();
    expect(within(within(oficina).getByLabelText('Filas sin conciliar')).getByRole('region', { name: 'Conciliación posterior' })).toHaveTextContent(/2 fila\(s\) sin local/);

    // Negocio ocupado (alta 2026): Campo terminado (viene del Excel); clasificación y digital pendientes
    abrir(/BAR SINTÉTICO EL OLMO/);
    expect(estadosFicha()).toMatch(/Campo: terminado.*Categoría: pendiente.*Digital: pendiente/);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Bar' }));
    await guardado(/Guardado/);
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Digital' }));
    for (const v of ['Página web', 'Venta por internet', 'Google Business Profile', 'Facebook', 'Twitter / X']) fireEvent.click(within(panel()).getByRole('button', { name: `${v}: No` }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Instagram: Sí' }));
    fireEvent.change(within(panel()).getByRole('group', { name: 'Seguidores Instagram' }).querySelector('input')!, { target: { value: '120' } });
    fireEvent.blur(within(panel()).getByRole('group', { name: 'Seguidores Instagram' }).querySelector('input')!);
    // El botón se habilita cuando lo guardado (escritura verificada) ya no tiene comprobaciones pendientes
    await waitFor(() => expect(within(panel()).getByRole('button', { name: 'Verificar presencia digital de BAR SINTÉTICO EL OLMO' })).toBeEnabled(), { timeout: 30000 });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Verificar presencia digital de BAR SINTÉTICO EL OLMO' }));
    await waitFor(() => expect(within(panel()).getByText(/Verificada/)).toBeInTheDocument(), { timeout: 30000 });

    // Negocio nuevo en el local de la antigua DROGUERÍA: no hereda su presencia digital de 2025
    abrir(/FERRETERÍA/);
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Ficha' }));
    expect(panel()).toHaveTextContent(/lo ocupaba otro negocio \(DROGUERÍA SINTÉTICA\): no se hereda su clasificación/);
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Digital' }));
    expect(within(panel()).queryByRole('button', { name: /Partir de 2025/ })).toBeNull();

    // Local vacío: sin clasificación ni digital; la comprobación del vacío se registra expresamente
    abrir(/Vacío/);
    expect(within(panel()).getByRole('tab', { name: 'Digital' })).toBeDisabled();
    expect(panel()).toHaveTextContent(/No necesita clasificación de actividad ni presencia digital/);
    fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Vacío comprobado en oficina' }));
    await guardado(/Vacío comprobado en oficina/);
    await waitFor(() => expect(within(oficina).getByLabelText('Estados de IT1')).toHaveTextContent(/Oficina: 2 sin conciliar · 2\/4 locales revisados/), { timeout: 20000 });

    // Guardado en el espacio: solo la campaña 2026; histórico 2025 y demostración intactos
    let db = await leer();
    const bar = Object.values(db.negocios).find((n) => n.nombre === 'BAR SINTÉTICO EL OLMO')!;
    expect(db.clasificaciones[kNC(bar.id, e.campanaId)]).toMatchObject({ actividadId: 'a1-hosteleria.restauracion.bares-y-cafeterias.bar', confirmada: true });
    expect(db.digital[kNC(bar.id, e.campanaId)]).toMatchObject({ estado: 'verificada', verificadaPor: e.o.porId, datos: { instagram: { respuesta: 'si' }, facebook: { respuesta: 'no' } } });
    expect(Object.values(db.digital).filter((d) => d.campanaId === e.historica)).toEqual(Object.values(inicial.digital).filter((d) => d.campanaId === e.historica));
    const ferr = Object.values(db.negocios).find((n) => n.nombre === 'FERRETERÍA SINTÉTICA')!;
    expect(db.digital[kNC(ferr.id, e.campanaId)]).toBeUndefined();
    expect(Object.values(db.revisiones).every((r) => r.campanaId === e.campanaId)).toBe(true);
    expect(historico(db, e.historica)).toBe(historico(inicial, e.historica));
    expect(estadosItinerario(db, e.its.IT1)).toMatchObject({ sinConciliar: 2, locales: 4, revisados: 2, oficina: { hecho: false }, validacion: { hecho: false } });
    expect(useStore.getState().db).toBe(demoAntes);

    // Recargar: el trabajo sigue ahí
    unmount();
    useEspacios.getState().cerrar();
    montar(e.campanaId, e.its.IT1);
    await waitFor(() => expect(screen.getByLabelText('Estados de IT1')).toHaveTextContent(/2\/4 locales revisados/), { timeout: 20000 });
    abrir(/BAR SINTÉTICO EL OLMO/);
    expect(estadosFicha()).toMatch(/Campo: terminado.*Categoría: revisado.*Digital: revisado/);
    db = await leer();
    expect(db.revisiones).toBeDefined();
  });
});
