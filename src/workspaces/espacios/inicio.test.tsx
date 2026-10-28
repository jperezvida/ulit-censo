import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { clear as idbClear, createStore, get as idbGet, set as idbSet } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useAsistenteEspacio, useSeleccionEspacio } from './estadoAsistenteEspacio';
import { osmVillaSintetica } from '../../data/callejeroSintetico';
import { archivoItinerario, libroItinerario } from '../../data/xlsxItinerarios';
import { crearBaseEspacio, PREFIJO } from '../../domain/espacios';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from '../../domain/municipios';
import { aplicarCarga } from '../../domain/callejeros';
import { leerOsmMunicipio } from '../../domain/fuentesCallejero';
import { crearItinerario } from '../../domain/campanaOperativa';
import type { BaseDatos } from '../../domain/db';

/**
 * UX1 · Recorrido de la pantalla de inicio sencilla con datos SINTÉTICOS: cuatro accesos con cifras
 * reales, importación guiada (con respaldo y confirmación obligatorios), incidencias, censo y
 * persistencia al volver a abrir.
 */
let bytes: Record<'IT1' | 'IT2', Uint8Array>;
const tienda = () => createStore('ulit-censo-ensayo', 'datos');
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  bytes = { IT1: await libroItinerario('IT1'), IT2: await libroItinerario('IT2') };
}, 60000);
beforeEach(async () => {
  for (const t of ['ensayo', 'real']) await idbClear(createStore(`ulit-censo-${t}`, 'datos'));
  localStorage.clear();
  useEspacios.getState().cerrar();
  useAsistenteEspacio.getState().reiniciar();
  useSeleccionEspacio.getState().reiniciar();
});
afterEach(() => vi.unstubAllGlobals());

/** Espacio de ensayo con la Villa Sintética, su callejero y la campaña operativa «Censo 2026» con IT1 e IT2 (sin Excel). */
async function sembrar() {
  const AHORA = '2026-10-25T10:00:00.000Z';
  let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Coordinación de Prueba', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'ux1', ahora: AHORA, incluirMedina: false });
  const o = { prefijo: PREFIJO.ensayo, porId: db.meta.espacioCreadoPorId!, ahora: AHORA, anioActual: 2026 };
  const VILLA = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
  const m = altaMunicipio(db, { ...VILLA, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, o);
  db = m.db;
  const json = osmVillaSintetica(1);
  const l = leerOsmMunicipio(json, VILLA);
  if (!l.ok) throw new Error(l.motivo);
  db = aplicarCarga(db, m.municipioId, l, { archivo: 'villa.json', contenido: JSON.stringify(json), fuente: 'OpenStreetMap (Overpass API)' }, o).db;
  const c = crearCampana(db, { municipioId: m.municipioId, anio: 2026, nombre: 'Censo 2026', clase: 'operativa', tipoOperativa: 'nuevo' }, o);
  db = c.db;
  for (const k of ['IT1', 'IT2']) db = crearItinerario(db, c.campanaId, { codigo: k }, o).db;
  await idbSet('db', db, tienda());
}

const montar = (ruta = '/espacios/ensayo') => render(<MemoryRouter initialEntries={[ruta]}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
const acceso = (n: string) => within(screen.getByRole('navigation', { name: 'Accesos' })).getByRole('button', { name: n });

async function incorporar(it: 'IT1' | 'IT2') {
  const panel = screen.getByRole('region', { name: 'Incorporar Excel' });
  await waitFor(() => expect((within(panel).getByLabelText('Itinerario de destino') as HTMLSelectElement).selectedOptions[0].textContent).toBe(it));
  fireEvent.change(within(panel).getByLabelText('Archivo XLSX del censo'), { target: { files: [new File([bytes[it] as BlobPart], archivoItinerario(it))] } });
  await waitFor(() => expect(within(panel).getByRole("button", { name: /Continuar/ })).toBeEnabled(), { timeout: 20000 });
  fireEvent.click(within(panel).getByRole('button', { name: /Continuar/ }));
  // Columnas reconocidas: el detalle queda plegado
  expect(await within(panel).findByRole('region', { name: 'Columnas reconocidas' }, { timeout: 20000 })).toHaveTextContent(/columnas reconocidas.*Puede continuar/);
  await waitFor(() => expect(within(panel).getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled());
  fireEvent.click(within(panel).getByRole('button', { name: /Analizar con estas columnas/ }));
  expect(await within(panel).findByRole('region', { name: 'Resultado de la comprobación' }, { timeout: 60000 })).toHaveTextContent(/filas leídas/);
  fireEvent.click(within(panel).getByRole('button', { name: /Siguiente: Decisiones/ }));
  fireEvent.click(within(panel).getByRole('button', { name: /Siguiente: Vista previa/ }));
  expect(within(panel).getByRole('region', { name: 'Resumen de la incorporación' })).toHaveTextContent(new RegExp(`Censo 2026 · ${it}`));
  // Respaldo obligatorio: sin él no se puede incorporar
  const conf = within(panel).getByRole('region', { name: 'Confirmación' });
  fireEvent.click(within(conf).getByLabelText('He revisado la vista previa'));
  expect(within(conf).getByRole('button', { name: /Incorporar al espacio/ })).toBeDisabled();
  const r = useEspacios.getState().prepararRespaldo();
  fireEvent.change(within(conf).getByLabelText('Comprobar un respaldo'), { target: { files: [new File([r.texto], r.nombreArchivo, { type: 'application/json' })] } });
  await waitFor(() => expect(within(conf).getByRole('button', { name: /Incorporar al espacio/ })).toBeEnabled(), { timeout: 20000 });
  fireEvent.click(within(conf).getByRole('button', { name: /Incorporar al espacio/ }));
  await within(panel).findByRole('region', { name: 'Resultado' }, { timeout: 60000 });
  fireEvent.click(within(panel).getByRole('button', { name: 'Cerrar el asistente' }));
}

describe('UX1 · Inicio sencillo', () => {
  it('cuatro accesos con cifras reales, importación guiada, incidencias, censo y persistencia', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await sembrar();
    montar();
    const ctx = await screen.findByRole('region', { name: 'Municipio y campaña' }, { timeout: 20000 });
    expect((within(ctx).getByLabelText('Campaña') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Censo 2026');
    expect(ctx).toHaveTextContent(/Operativa · en curso/);
    // Cifras reales de partida
    expect(acceso('Itinerarios')).toHaveTextContent(/2.*2 sin Excel/);
    expect(acceso('Incorporar Excel')).toHaveTextContent(/0/);
    expect(acceso('Incidencias')).toHaveTextContent(/0.*nada pendiente/);
    expect(acceso('Censo')).toHaveTextContent(/0.*locales/);

    // 1 · Itinerarios: crear uno nuevo
    const its = screen.getByRole('region', { name: 'Itinerarios' });
    fireEvent.change(within(its).getByLabelText('Código del itinerario'), { target: { value: 'IT3' } });
    fireEvent.click(within(its).getByRole('button', { name: /Añadir itinerario/ }));
    await waitFor(() => expect(acceso('Itinerarios')).toHaveTextContent(/3.*3 sin Excel/), { timeout: 20000 });

    // 2 · Incorporar desde la tarjeta del itinerario
    const it1 = within(screen.getByRole('list', { name: 'Itinerarios' })).getAllByRole('listitem')[0];
    fireEvent.click(within(it1).getByRole('button', { name: /Incorporar su Excel/ }));
    await incorporar('IT1');
    fireEvent.click(acceso('Itinerarios'));
    const it2 = within(screen.getByRole('list', { name: 'Itinerarios' })).getAllByRole('listitem')[1];
    fireEvent.click(within(it2).getByRole('button', { name: /Incorporar su Excel/ }));
    await incorporar('IT2');
    expect(acceso('Incorporar Excel')).toHaveTextContent(/2.*Excel incorporados/);
    expect(acceso('Itinerarios')).toHaveTextContent(/1 sin Excel/);

    // 3 · Incidencias: solo lo que requiere intervención
    expect(acceso('Incidencias')).toHaveTextContent(/2.*por resolver/);
    fireEvent.click(acceso('Incidencias'));
    const inc = screen.getByRole('region', { name: 'Incidencias' });
    expect(within(inc).getAllByRole('listitem', { name: /^Fila \d+ de IT2/ })).toHaveLength(2);
    const ferr = within(inc).getAllByRole('listitem', { name: /^Fila \d+ de IT2/ }).find((li) => /FERRETERÍA/.test(li.textContent ?? ''))!;
    fireEvent.click(within(ferr).getByRole('button', { name: /mismo local físico/ }));
    await waitFor(() => expect(acceso('Incidencias')).toHaveTextContent(/1.*por resolver/), { timeout: 20000 });
    expect(within(screen.getByRole('region', { name: 'Incidencias' })).getByText(/Decisiones tomadas \(1\)/)).toBeInTheDocument();

    // 4 · Censo: locales únicos con su estado y búsqueda
    fireEvent.click(acceso('Censo'));
    const censo = screen.getByRole('region', { name: 'Censo' });
    expect(within(censo).getByLabelText('Resumen del censo')).toHaveTextContent(/9locales/);
    expect(within(censo).getByRole('table', { name: 'Locales' }).querySelectorAll('tbody tr')).toHaveLength(9);
    fireEvent.change(within(censo).getByLabelText('Buscar un local'), { target: { value: 'ferretería' } });
    expect(within(censo).getByRole('table', { name: 'Locales' })).toHaveTextContent(/Calle del Olmo, 7.*FERRETERÍA SINTÉTICA.*Ocupado/);

    // Persistencia: se cierra y se vuelve a abrir; datos, campaña y acceso elegido se conservan
    const guardada = await idbGet<BaseDatos>('db', tienda());
    expect(Object.values(guardada!.importaciones).filter((i) => i.estado === 'confirmada')).toHaveLength(2);
    cleanup();
    useEspacios.getState().cerrar();
    montar();
    await screen.findByRole('region', { name: 'Municipio y campaña' }, { timeout: 20000 });
    expect(acceso('Censo')).toHaveAttribute('aria-pressed', 'true');
    expect(acceso('Incidencias')).toHaveTextContent(/1.*por resolver/);

    // La vista completa sigue disponible
    expect(screen.getByRole('link', { name: /Vista completa/ })).toHaveAttribute('href', '/espacios/ensayo/avanzado');
  }, 240000);

  it('campaña histórica: se distingue, no tiene itinerarios y el asistente apunta a ella', async () => {
    await sembrar();
    montar();
    const ctx = await screen.findByRole('region', { name: 'Municipio y campaña' }, { timeout: 20000 });
    fireEvent.click(within(ctx).getByRole('button', { name: /Campaña/ }));
    const f = screen.getByRole('group', { name: 'Nueva campaña' });
    fireEvent.change(within(f).getByLabelText('Año de la campaña'), { target: { value: '2024' } });
    fireEvent.click(within(f).getByRole('button', { name: /Crear la campaña/ }));
    await waitFor(() => expect((within(ctx).getByLabelText('Campaña') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Censo 2024 · histórico'), { timeout: 20000 });
    expect(ctx).toHaveTextContent(/Histórica · censo anterior/);
    expect(acceso('Itinerarios')).toHaveTextContent(/campaña histórica/);
    fireEvent.click(acceso('Incorporar Excel'));
    const panel = screen.getByRole('region', { name: 'Incorporar Excel' });
    expect(await within(panel).findByRole('group', { name: 'Destino' })).toHaveTextContent(/Censo 2024 · histórico/);
    expect(within(panel).queryByLabelText('Itinerario de destino')).toBeNull();
  }, 60000);
});
