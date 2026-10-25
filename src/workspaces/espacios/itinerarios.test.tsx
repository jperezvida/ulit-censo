import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { clear as idbClear, createStore, get as idbGet } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useAsistenteEspacio, useSeleccionEspacio } from './estadoAsistenteEspacio';
import { osmVillaSintetica } from '../../data/callejeroSintetico';
import { archivoItinerario, libroItinerario } from '../../data/xlsxItinerarios';
import type { BaseDatos } from '../../domain/db';

/** G4 · Dos Excel de itinerario en UNA campaña operativa, desde la interfaz (datos SINTÉTICOS). */
let bytes: Record<'IT1' | 'IT2', Uint8Array>;
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  bytes = { IT1: await libroItinerario('IT1'), IT2: await libroItinerario('IT2') };
}, 60000);
beforeEach(async () => {
  for (const t of ['ensayo', 'real']) await idbClear(createStore(`ulit-censo-${t}`, 'datos'));
  useEspacios.getState().cerrar();
  useAsistenteEspacio.getState().reiniciar();
  useSeleccionEspacio.getState().reiniciar();
});
afterEach(() => vi.unstubAllGlobals());

const region = (n: string) => screen.getByRole('region', { name: n });

async function incorporar(it: 'IT1' | 'IT2') {
  fireEvent.click(within(screen.getByRole('table', { name: 'Desglose por itinerario' })).getAllByRole('button', { name: /Incorporar su Excel/ })[0]);
  const destino = region('Destino');
  await waitFor(() => expect((within(destino).getByLabelText('Itinerario de destino') as HTMLSelectElement).selectedOptions[0].textContent).toMatch(new RegExp(`^${it}`)));
  fireEvent.change(screen.getByLabelText('Archivo XLSX del censo'), { target: { files: [new File([bytes[it] as BlobPart], archivoItinerario(it))] } });
  await screen.findByLabelText('Identificación del archivo', undefined, { timeout: 20000 });
  expect(region('Qué se hará')).toHaveTextContent(new RegExp(`itinerario ${it} de la campaña operativa «Censo 2026»`));
  fireEvent.click(screen.getByRole('button', { name: /Siguiente: columnas/ }));
  await screen.findByRole('table', { name: 'Correspondencia de columnas' }, { timeout: 20000 });
  await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Analizar con estas columnas/ }));
  await screen.findByRole('region', { name: 'Diagnóstico agregado' }, { timeout: 60000 });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente: Decisiones/ }));
  fireEvent.click(screen.getByRole('button', { name: /Siguiente: Vista previa/ }));
  const r = useEspacios.getState().prepararRespaldo();
  fireEvent.change(screen.getByLabelText('Comprobar un respaldo'), { target: { files: [new File([r.texto], r.nombreArchivo, { type: 'application/json' })] } });
  await screen.findByText(/Respaldo correcto y completo/, undefined, { timeout: 20000 });
  const conf = region('Confirmación');
  expect(conf).toHaveTextContent(new RegExp(`Excel del itinerario ${it}.*campaña operativa «Censo 2026»`));
  fireEvent.click(within(conf).getByLabelText('He revisado la vista previa'));
  await waitFor(() => expect(within(conf).getByRole('button', { name: /Incorporar al espacio/ })).toBeEnabled());
  fireEvent.click(within(conf).getByRole('button', { name: /Incorporar al espacio/ }));
  await screen.findByRole('region', { name: 'Resultado' }, { timeout: 60000 });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar el asistente' }));
}

describe('G4 · Itinerarios de una campaña operativa (interfaz)', () => {
  it('IT1 e IT2 en la misma campaña: desglose, consolidado, cruces sin fusionar y conciliación posterior (G5)', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<MemoryRouter initialEntries={['/espacios/ensayo']}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
    await screen.findByRole('region', { name: 'Crear el espacio' }, { timeout: 20000 });
    fireEvent.change(screen.getByLabelText('Persona responsable'), { target: { value: 'Coordinación de Prueba' } });
    fireEvent.click(screen.getByLabelText('Incluir Medina del Campo'));
    fireEvent.click(screen.getByRole('button', { name: 'Crear el espacio' }));
    const municipios = await screen.findByRole('region', { name: 'Municipios' }, { timeout: 20000 });
    // Municipio y callejero sintéticos (G2, G3)
    fireEvent.click(within(municipios).getByRole('button', { name: /Dar de alta un municipio/ }));
    const alta = within(municipios).getByRole('group', { name: 'Alta de municipio' });
    fireEvent.change(within(alta).getByLabelText('Nombre del municipio'), { target: { value: 'Villa Sintética de Arriba' } });
    fireEvent.change(within(alta).getByLabelText('Provincia'), { target: { value: 'Provincia Sintética' } });
    fireEvent.change(within(alta).getByLabelText('Código INE'), { target: { value: '99001' } });
    fireEvent.click(within(alta).getByRole('button', { name: /Dar de alta/ }));
    await screen.findByRole('heading', { name: /Callejero de Villa Sintética/ });
    fireEvent.click(within(region('Callejero')).getByRole('button', { name: /Cargar callejero/ }));
    fireEvent.change(within(region('Callejero')).getByLabelText('Archivo del callejero'), { target: { files: [new File([JSON.stringify(osmVillaSintetica(1))], 'villa.json')] } });
    fireEvent.click(await within(region('Callejero')).findByRole('button', { name: /Aplicar la carga/ }, { timeout: 20000 }));
    await waitFor(() => expect(within(region('Callejero')).getByLabelText('Resumen del callejero')).toHaveTextContent(/7 vías/), { timeout: 20000 });
    // Campaña operativa 2026 y sus itinerarios
    fireEvent.click(within(region('Campañas')).getByRole('button', { name: /Nueva campaña/ }));
    const f = within(region('Campañas')).getByRole('group', { name: 'Nueva campaña' });
    fireEvent.click(within(f).getByRole('radio', { name: 'Operativa' }));
    fireEvent.change(within(f).getByLabelText('Año de la campaña'), { target: { value: '2026' } });
    fireEvent.change(within(f).getByLabelText('Nombre de la campaña'), { target: { value: 'Censo 2026' } });
    fireEvent.click(within(f).getByRole('button', { name: /Crear la campaña/ }));
    fireEvent.click(await within(region('Campañas')).findByRole('button', { name: 'Itinerarios y censo' }, { timeout: 20000 }));
    for (const it of ['IT1', 'IT2']) {
      fireEvent.change(screen.getByLabelText('Código del itinerario'), { target: { value: it } });
      fireEvent.click(screen.getByRole('button', { name: /Añadir itinerario/ }));
      await screen.findByRole('cell', { name: new RegExp(`^${it}`) }, { timeout: 20000 });
    }
    await incorporar('IT1');
    await incorporar('IT2');

    const panel = screen.getByRole('group', { name: 'Campaña operativa Censo 2026' });
    const desglose = within(panel).getByRole('table', { name: 'Desglose por itinerario' });
    expect(desglose).toHaveTextContent(/IT1.*itinerario_IT1_villa_sintetica_2026_SINTETICO\.xlsx.*6.*6.*0.*2026-03-02 – 2026-03-04/);
    expect(desglose).toHaveTextContent(/IT2.*itinerario_IT2_villa_sintetica_2026_SINTETICO\.xlsx.*5.*3.*2.*1 sin fecha/);
    expect(within(panel).getByLabelText('Censo consolidado')).toHaveTextContent(/Itinerarios2.*Registros11/);
    const cruces = within(panel).getByLabelText('Cruces entre itinerarios');
    expect(cruces).toHaveTextContent(/Posible duplicado: «FERRETERÍA SINTÉTICA», Calle del Olmo, 7 · IT1 \(fila \d+\) y IT2 \(fila \d+\) · pendiente de conciliar/);
    expect(cruces).toHaveTextContent(/Contradicción: Calle del Olmo, 5 · vacío según IT1 y ocupado según IT2/);
    expect(cruces).toHaveTextContent(/Calle del Olmo, 3: 2 locales distintos en el mismo portal/);
    // G5 · Conciliación posterior: las 2 filas de IT2 sin local, con filtros; vincular, deshacer y estado de locales
    const conc = within(panel).getByRole('region', { name: 'Conciliación posterior' });
    expect(conc).toHaveTextContent(/2 fila\(s\) sin local/);
    expect(within(conc).getAllByRole('listitem', { name: /^Fila \d+ de IT2/ })).toHaveLength(2);
    expect(within(panel).getByLabelText('Censo consolidado')).toHaveTextContent(/Locales únicos9.*Pendientes2/);
    const ferr = within(conc).getAllByRole('listitem', { name: /^Fila \d+ de IT2/ }).find((li) => /FERRETERÍA/.test(li.textContent ?? ''))!;
    expect(within(ferr).getByRole('combobox')).toHaveDisplayValue(/Calle del Olmo, 7 \(mismo portal\)/);
    fireEvent.click(within(ferr).getByRole('button', { name: /Vincular/ }));
    await waitFor(() => expect(within(panel).getByRole('region', { name: 'Conciliación posterior' })).toHaveTextContent(/1 fila\(s\) sin local/), { timeout: 20000 });
    expect(within(panel).getByLabelText('Decisiones tomadas')).toHaveTextContent(/IT2 fila \d+ · Vinculada a un local existente · Coordinación de Prueba/);
    expect(within(panel).getByLabelText('Cruces entre itinerarios')).toHaveTextContent(/FERRETERÍA SINTÉTICA.*conciliado: es el mismo local/);
    // Filtro por tipo de incidencia
    fireEvent.change(within(panel).getByLabelText('Filtrar por tipo'), { target: { value: 'local-existente-en-direccion' } });
    expect(within(panel).getAllByRole('listitem', { name: /^Fila \d+ de IT2/ })).toHaveLength(1);
    // Deshacer la decisión
    fireEvent.click(within(within(panel).getByLabelText('Decisiones tomadas')).getByRole('button', { name: /Deshacer/ }));
    await waitFor(() => expect(within(panel).getByRole('region', { name: 'Conciliación posterior' })).toHaveTextContent(/2 fila\(s\) sin local/), { timeout: 20000 });
    // La cafetería: vincularla al local vacío de IT1 crea una contradicción con fecha → estado dudoso
    const caf = within(panel).getAllByRole('listitem', { name: /^Fila \d+ de IT2/ }).find((li) => /CAFETERÍA/.test(li.textContent ?? ''))!;
    fireEvent.click(within(caf).getByRole('button', { name: /Vincular/ }));
    expect(within(panel).getByLabelText('Estado de locales por revisar')).toHaveTextContent(/Calle Peatonal Mayor, 2 · Información sin fecha suficiente/);
    await waitFor(() => expect(within(panel).getByLabelText('Estado de locales por revisar')).toHaveTextContent(/Calle del Olmo, 5 · Estado dudoso/), { timeout: 20000 });
    const revisar = within(within(panel).getByLabelText('Estado de locales por revisar')).getAllByRole('listitem').find((li) => /Olmo, 5/.test(li.textContent ?? ''))!;
    expect(revisar).toHaveTextContent(/Propuesta \(no aplicada\): La observación más reciente \(2026-04-07\) dice «ocupado»/);
    fireEvent.click(within(revisar).getByRole('button', { name: /Confirmar ocupado/ }));
    await waitFor(() => expect(within(panel).getByLabelText('Estado de locales por revisar')).toHaveTextContent(/Estado actual confirmado: ocupado/), { timeout: 20000 });
    expect(within(panel).getByLabelText('Cruces entre itinerarios')).toHaveTextContent(/Calle del Olmo, 5.*resuelta por decisión/);
    expect(screen.queryByRole('button', { name: /como tramos/ })).toBeNull();
    const db = await idbGet<BaseDatos>('db', createStore('ulit-censo-ensayo', 'datos'));
    expect(Object.keys(db!.campanas)).toHaveLength(1);
    expect(Object.values(db!.importaciones).map((i) => [i.tipo, i.c1?.itinerario?.codigo])).toEqual([['C-excel-itinerario', 'IT1'], ['C-excel-itinerario', 'IT2']]);
  }, 240000);
});
