import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { clear as idbClear, createStore, get as idbGet } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useAsistenteEspacio } from './estadoAsistenteEspacio';
import { osmVillaSintetica } from '../../data/callejeroSintetico';
import type { BaseDatos } from '../../domain/db';

/**
 * G3 · Callejero en pantalla (espacio de ensayo SIN Medina, municipio y callejero SINTÉTICOS):
 * alta del municipio → carga del callejero OSM con vista previa → alta supervisada de una plaza sin geometría.
 */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});
beforeEach(async () => {
  for (const t of ['ensayo', 'real']) await idbClear(createStore(`ulit-censo-${t}`, 'datos'));
  useEspacios.getState().cerrar();
  useAsistenteEspacio.getState().reiniciar();
});
afterEach(() => vi.unstubAllGlobals());

const guardada = () => idbGet<BaseDatos>('db', createStore('ulit-censo-ensayo', 'datos'));

describe('G3 · Callejero de un municipio (interfaz)', () => {
  it('alta de un municipio nuevo, carga de su callejero OSM y alta supervisada de una plaza que falta', async () => {
    // Sin Medina: no hace falta su instantánea (no se descarga nada)
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<MemoryRouter initialEntries={['/espacios/ensayo']}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
    await screen.findByRole('region', { name: 'Crear el espacio' }, { timeout: 20000 });
    fireEvent.change(screen.getByLabelText('Persona responsable'), { target: { value: 'Coordinación de Prueba' } });
    fireEvent.click(screen.getByLabelText('Incluir Medina del Campo'));
    fireEvent.click(screen.getByRole('button', { name: 'Crear el espacio' }));
    const municipios = await screen.findByRole('region', { name: 'Municipios' }, { timeout: 20000 });
    expect(fetch).not.toHaveBeenCalled();
    expect(within(municipios).queryByRole('button', { name: /Medina del Campo/ })).toBeNull();

    // 1. Alta del municipio con su código INE
    fireEvent.click(within(municipios).getByRole('button', { name: /Dar de alta un municipio/ }));
    const alta = within(municipios).getByRole('group', { name: 'Alta de municipio' });
    fireEvent.change(within(alta).getByLabelText('Nombre del municipio'), { target: { value: 'Villa Sintética de Arriba' } });
    fireEvent.change(within(alta).getByLabelText('Provincia'), { target: { value: 'Provincia Sintética' } });
    fireEvent.change(within(alta).getByLabelText('Código INE'), { target: { value: '99001' } });
    fireEvent.click(within(alta).getByRole('button', { name: /Dar de alta/ }));
    const cj = await screen.findByRole('region', { name: 'Callejero' }, { timeout: 20000 });
    expect(within(cj).getByRole('heading')).toHaveTextContent('Callejero de Villa Sintética de Arriba');
    expect(within(cj).getByLabelText('Resumen del callejero')).toHaveTextContent(/Sin callejero/);

    // 2. Cargar el callejero desde OpenStreetMap: consulta por límite administrativo y archivo exportado
    fireEvent.click(within(cj).getByRole('button', { name: /Cargar callejero/ }));
    const carga = within(cj).getByRole('group', { name: 'Cargar callejero' });
    expect((within(carga).getByLabelText('Consulta de Overpass') as HTMLTextAreaElement).value).toMatch(/"ine:municipio"="99001"/);
    const texto = JSON.stringify(osmVillaSintetica(1));
    fireEvent.change(within(carga).getByLabelText('Archivo del callejero'), { target: { files: [new File([texto], 'villa-osm.json', { type: 'application/json' })] } });
    const prev = await within(carga).findByLabelText('Vista previa de la carga', undefined, { timeout: 20000 });
    expect(prev).toHaveTextContent(/Nueva7/);
    expect(prev).toHaveTextContent(/Plazas y espacios4/);
    expect(prev).toHaveTextContent(/fuera del límite del municipio/);
    expect((within(carga).getByLabelText('Fecha de los datos') as HTMLInputElement).value).toBe('2026-09-30');
    fireEvent.click(within(prev).getByRole('button', { name: /Aplicar la carga/ }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Callejero' })).getByLabelText('Resumen del callejero')).toHaveTextContent(/7 vías.*4 plazas y espacios/), { timeout: 20000 });
    expect(within(screen.getByRole('region', { name: 'Callejero' })).getByRole('table', { name: 'Cargas del callejero' })).toHaveTextContent(/OpenStreetMap \(Overpass API\).*villa-osm\.json.*7 nuevas/);

    // 3. Añadir una plaza que no está en OpenStreetMap, sin geometría y con su fuente documental
    fireEvent.click(within(screen.getByRole('region', { name: 'Callejero' })).getByRole('button', { name: /Añadir calle o plaza/ }));
    const add = within(screen.getByRole('region', { name: 'Callejero' })).getByRole('group', { name: 'Añadir calle o plaza' });
    fireEvent.change(within(add).getByLabelText('Nombre de la vía'), { target: { value: 'del Pozo' } });
    expect(add).toHaveTextContent(/Se registrará como «Plaza del Pozo»/);
    expect(within(add).getByRole('button', { name: /Proponer el alta/ })).toBeDisabled();
    fireEvent.change(within(add).getByLabelText('Fuente documental'), { target: { value: 'Nomenclátor municipal (prueba)' } });
    fireEvent.click(within(add).getByRole('button', { name: /Proponer el alta/ }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Callejero' })).getByLabelText('Resumen del callejero')).toHaveTextContent(/1 alta\(s\) por validar/), { timeout: 20000 });

    // 4. Supervisión: la persona de coordinación la valida desde su ficha
    const vias = within(screen.getByRole('region', { name: 'Callejero' })).getByLabelText('Vías del callejero');
    fireEvent.change(within(vias).getByLabelText('Filtro de vías'), { target: { value: 'propuestas' } });
    fireEvent.click(within(vias).getByRole('button', { name: 'Ficha de Plaza del Pozo' }));
    const ficha = within(vias).getByRole('group', { name: 'Ficha de la vía Plaza del Pozo' });
    expect(ficha).toHaveTextContent(/Sin geometría \(la vía existe aunque no esté dibujada\)/);
    expect(ficha).toHaveTextContent(/Propuesta por Coordinación de Prueba.*fuente: Nomenclátor municipal \(prueba\)/);
    fireEvent.click(within(ficha).getByRole('button', { name: /Validar el alta/ }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Callejero' })).getByLabelText('Resumen del callejero')).toHaveTextContent(/8 vías.*1 sin geometría.*1 añadidas a mano/), { timeout: 20000 });

    const db = await guardada();
    const pozo = Object.values(db!.calles).find((c) => c.nombre === 'Plaza del Pozo')!;
    expect(pozo).toMatchObject({ procedencia: 'manual', segmentos: [], alta: { estado: 'validada', fuenteDocumental: 'Nomenclátor municipal (prueba)' } });
    const mun = Object.values(db!.municipios)[0];
    expect(mun.callejero).toMatchObject({ estado: 'disponible', cargas: [expect.objectContaining({ archivo: 'villa-osm.json', fechaDatos: '2026-09-30' })] });
  }, 120000);
});
