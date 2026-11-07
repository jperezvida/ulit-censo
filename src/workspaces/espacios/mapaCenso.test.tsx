import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ExcelJS from 'exceljs';
import { clear as idbClear, createStore, keys as idbKeys } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useStore } from '../../store/store';
import { useAsistenteEspacio } from './estadoAsistenteEspacio';
import { validarInstantanea } from '../../data/instantaneaOsm';
import { libroSinteticoC1e } from '../../data/xlsxSinteticoC1e';
import { censoTemporal } from '../../domain/censoTemporal';

/** C1e-B · Censo analizado en el mapa, sin guardar. Archivo SINTÉTICO de 889 filas sobre el callejero OSM. */
vi.mock('../../components/mapa/MapaBase', () => ({ MapaBase: () => <div data-testid="mapa" /> }));
const snapshot = readFileSync('public/data/medina-callejero.json', 'utf8');
let externo: Uint8Array;
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const v = validarInstantanea(JSON.parse(snapshot));
  if (!v.ok) throw new Error(v.motivo);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await libroSinteticoC1e(v.calles)) as unknown as ArrayBuffer);
  Object.assign(wb, { keywords: '', creator: 'Otro programa', title: '' });
  externo = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}, 60000);
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => JSON.parse(snapshot) }) as unknown as Response));
  for (const t of ['ensayo', 'real']) await idbClear(createStore(`ulit-censo-${t}`, 'datos'));
  useEspacios.getState().cerrar();
  useAsistenteEspacio.getState().reiniciar();
  useStore.setState({ db: null });
});
afterEach(() => vi.unstubAllGlobals());

const cifra = (region: HTMLElement, etiqueta: string) => Number(within(region).getByText(etiqueta).previousSibling!.textContent!.replace(/\./g, ''));

describe('C1e-B · Ver censo en mapa (sin guardar)', () => {
  it('cifras iguales al análisis, ubicaciones inciertas señaladas, filtros, regreso al diagnóstico y descarte al salir', async () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/espacios/analisis']}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
    await within(screen.getByRole('region', { name: 'Garantías del sitio' })).findByText(/Garantías verificadas/);
    fireEvent.change(screen.getByLabelText('Nombre de quien analiza'), { target: { value: 'Persona que analiza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Empezar el análisis' }));
    fireEvent.change(await screen.findByLabelText('Archivo XLSX del censo', undefined, { timeout: 20000 }), { target: { files: [new File([externo as BlobPart], 'censo.xlsx')] } });
    await screen.findByLabelText('Identificación del archivo', undefined, { timeout: 20000 });
    expect(screen.queryByRole('button', { name: /Ver censo en mapa/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: columnas/ }));
    fireEvent.change(await screen.findByLabelText('Perfil de importación', undefined, { timeout: 20000 }), { target: { value: 'medina-2025-referencia' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled(), { timeout: 20000 });
    fireEvent.click(screen.getByRole('button', { name: /Analizar con estas columnas/ }));
    await screen.findByRole('region', { name: 'Diagnóstico agregado' }, { timeout: 60000 });

    fireEvent.click(screen.getByRole('button', { name: /Ver censo en mapa/ }));
    const panel = screen.getByRole('region', { name: 'Censo en mapa' });
    expect(screen.getByTestId('mapa')).toBeInTheDocument();
    const { resultado, plan } = useAsistenteEspacio.getState().preparado!;
    const esperado = censoTemporal(resultado, plan).resumen;
    const res = within(panel).getByLabelText('Resumen del censo analizado');
    expect(cifra(res, 'registros')).toBe(889);
    expect(plan.filas).toHaveLength(889);
    expect([cifra(res, 'ocupados'), cifra(res, 'vacíos'), cifra(res, 'sin localización fiable'), cifra(res, 'incidencias del archivo')])
      .toEqual([esperado.ocupados, esperado.vacios, esperado.sinLocalizacion, resultado.incidencias.length]);
    expect(esperado.ocupados + esperado.vacios + esperado.desconocidos).toBe(889);
    // Las calles no reconocidas en el plan coinciden con «sin localización fiable»
    expect(esperado.sinLocalizacion).toBe(plan.filas.filter((f) => !f.calleId).length);
    expect(esperado.sinLocalizacion).toBeGreaterThan(0);
    // Ubicaciones inciertas señaladas y ningún punto: el aviso lo explica
    expect(panel).toHaveTextContent(/agrupados por calle.*nunca en un punto concreto/);
    const tabla = within(panel).getByRole('table', { name: 'Registros del censo analizado' });
    fireEvent.change(within(panel).getByLabelText('Filtrar por localización'), { target: { value: 'sin-localizacion' } });
    expect(panel).toHaveTextContent(new RegExp(`${esperado.sinLocalizacion} registro\\(s\\) con los filtros · 0 calle\\(s\\) en el mapa`));
    expect(within(tabla).getAllByText(/Sin localización/)).toHaveLength(Math.min(100, esperado.sinLocalizacion));
    fireEvent.change(within(panel).getByLabelText('Filtrar por localización'), { target: { value: '' } });

    // Filtros
    fireEvent.change(within(panel).getByLabelText('Filtrar por estado'), { target: { value: 'vacio' } });
    expect(panel).toHaveTextContent(new RegExp(`${esperado.vacios.toLocaleString('es-ES')} registro\\(s\\) con los filtros`));
    fireEvent.change(within(panel).getByLabelText('Filtrar por estado'), { target: { value: '' } });
    const calleSel = within(panel).getByLabelText('Filtrar por calle') as HTMLSelectElement;
    const calleId = calleSel.options[1].value;
    fireEvent.change(calleSel, { target: { value: calleId } });
    const nCalle = plan.filas.filter((f) => f.calleId === calleId).length;
    expect(panel).toHaveTextContent(new RegExp(`^.*${nCalle} registro\\(s\\) con los filtros · 1 calle\\(s\\) en el mapa · 0 sin localización`));
    const actSel = within(panel).getByLabelText('Filtrar por actividad') as HTMLSelectElement;
    fireEvent.change(calleSel, { target: { value: '' } });
    fireEvent.change(actSel, { target: { value: actSel.options[1].value } });
    expect(within(tabla).getAllByRole('row').slice(1).every((tr) => tr.children[5].textContent === (actSel.options[1].value || '—'))).toBe(true);

    // Incidencias y regreso al diagnóstico
    expect(within(panel).getByLabelText('Incidencias por tipo').children.length).toBeGreaterThan(0);
    fireEvent.click(within(panel).getAllByRole('button', { name: /Volver al diagnóstico/ })[0]);
    await screen.findByRole('region', { name: 'Diagnóstico agregado' });

    // Nada guardado y nada de la demostración; al salir se descarta
    expect(await idbKeys(createStore('ulit-censo-real', 'datos'))).toEqual([]);
    expect(useStore.getState().db).toBeNull();
    unmount();
    expect(useEspacios.getState().db).toBeNull();
    expect(useAsistenteEspacio.getState().preparado).toBeNull();
  }, 180000);
});
