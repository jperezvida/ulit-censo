import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { clear as idbClear, createStore, get as idbGet } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useAsistenteEspacio } from './estadoAsistenteEspacio';
import { CASOS_GENERALIDAD } from '../../data/xlsxGeneralidad';
import { BASE_PERFILES } from '../../store/perfiles';
import type { BaseDatos } from '../../domain/db';

/** G2 · Municipios y campañas en pantalla (espacio de ensayo, datos SINTÉTICOS). */
const snapshot = readFileSync('public/data/medina-callejero.json', 'utf8');
const casoA = CASOS_GENERALIDAD.find((c) => c.id === 'A')!;
let bytesA: Uint8Array;

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  bytesA = await casoA.generar();
}, 60000);
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => JSON.parse(snapshot) }) as unknown as Response));
  for (const t of ['ensayo', 'real']) await idbClear(createStore(`ulit-censo-${t}`, 'datos'));
  await idbClear(createStore(BASE_PERFILES, 'perfiles'));
  useEspacios.getState().cerrar();
  useAsistenteEspacio.getState().reiniciar();
});
afterEach(() => vi.unstubAllGlobals());

const montar = () => render(<MemoryRouter initialEntries={['/espacios/ensayo']}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
const guardada = () => idbGet<BaseDatos>('db', createStore('ulit-censo-ensayo', 'datos'));

describe('G2 · Municipios y campañas (interfaz)', () => {
  it('alta de un municipio sin callejero, sus campañas y la incorporación de un Excel con G1', async () => {
    montar();
    await screen.findByRole('region', { name: 'Crear el espacio' }, { timeout: 20000 });
    fireEvent.change(screen.getByLabelText('Persona responsable'), { target: { value: 'Coordinación de Prueba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear el espacio' }));
    const municipios = await screen.findByRole('region', { name: 'Municipios' }, { timeout: 20000 });
    // Medina del Campo, con su callejero real, y dónde se guarda
    expect(within(municipios).getByRole('button', { name: /Medina del Campo/ })).toHaveTextContent(/Callejero: [\d.]+ calles/);
    expect(municipios).toHaveTextContent(/ulit-censo-ensayo.*este navegador.*No se comparten con otras personas/);

    // 1. Alta del municipio
    fireEvent.click(within(municipios).getByRole('button', { name: /Dar de alta un municipio/ }));
    const alta = within(municipios).getByRole('group', { name: 'Alta de municipio' });
    fireEvent.change(within(alta).getByLabelText('Nombre del municipio'), { target: { value: 'Villa Sintética de Arriba' } });
    fireEvent.change(within(alta).getByLabelText('Provincia'), { target: { value: 'Provincia Sintética' } });
    fireEvent.change(within(alta).getByLabelText('Código INE'), { target: { value: '123' } });
    expect(within(alta).getByRole('alert')).toHaveTextContent(/5 cifras/);
    expect(within(alta).getByRole('button', { name: /Dar de alta/ })).toBeDisabled();
    fireEvent.change(within(alta).getByLabelText('Código INE'), { target: { value: '99001' } });
    fireEvent.change(within(alta).getByLabelText('Código postal'), { target: { value: 'fijo' } });
    fireEvent.change(within(alta).getByLabelText('Valor único de Código postal'), { target: { value: '47999' } });
    expect(alta).toHaveTextContent(/sin callejero/);
    fireEvent.click(within(alta).getByRole('button', { name: /Dar de alta/ }));
    const villa = await within(municipios).findByRole('button', { name: /Villa Sintética de Arriba/ }, { timeout: 20000 });
    expect(villa).toHaveAttribute('aria-pressed', 'true');
    expect(villa).toHaveTextContent(/INE 99001.*Sin callejero.*0 campañas/);

    // 2. Campañas: histórica 2023 (dos del mismo año) y operativa 2027
    const campanas = screen.getByRole('region', { name: 'Campañas' });
    expect(campanas).toHaveTextContent(/Villa Sintética de Arriba todavía no tiene callejero/);
    expect(campanas).toHaveTextContent(/CP un único valor para todo el municipio \(47999\)/);
    const nueva = async (clase: 'Histórica' | 'Operativa', anio: number, nombre: string) => {
      fireEvent.click(within(screen.getByRole('region', { name: 'Campañas' })).getByRole('button', { name: /Nueva campaña/ }));
      const f = within(screen.getByRole('region', { name: 'Campañas' })).getByRole('group', { name: 'Nueva campaña' });
      fireEvent.click(within(f).getByRole('radio', { name: clase }));
      fireEvent.change(within(f).getByLabelText('Año de la campaña'), { target: { value: String(anio) } });
      fireEvent.change(within(f).getByLabelText('Nombre de la campaña'), { target: { value: nombre } });
      fireEvent.click(within(f).getByRole('button', { name: /Crear la campaña/ }));
      await within(screen.getByRole('region', { name: 'Campañas' })).findByRole('cell', { name: nombre }, { timeout: 20000 });
    };
    await nueva('Histórica', 2023, 'Censo 2023 · histórico');
    await nueva('Histórica', 2023, 'Censo 2023 · polígono');
    await nueva('Operativa', 2027, 'Censo 2027');
    const tabla = within(screen.getByRole('region', { name: 'Campañas' })).getByRole('table', { name: 'Campañas de Villa Sintética de Arriba' });
    expect(tabla.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(tabla).toHaveTextContent(/Censo 2027.*Operativa · Actualización/);
    // Un nombre repetido en el mismo año no se admite
    fireEvent.click(within(screen.getByRole('region', { name: 'Campañas' })).getByRole('button', { name: /Nueva campaña/ }));
    const rep = within(screen.getByRole('region', { name: 'Campañas' })).getByRole('group', { name: 'Nueva campaña' });
    fireEvent.change(within(rep).getByLabelText('Año de la campaña'), { target: { value: '2023' } });
    fireEvent.change(within(rep).getByLabelText('Nombre de la campaña'), { target: { value: 'Censo 2023 · histórico' } });
    expect(within(rep).getByRole('alert')).toHaveTextContent(/Ya hay una campaña/);
    fireEvent.click(within(rep).getByRole('button', { name: 'Cancelar' }));

    // Guardado en la base del espacio (este navegador)
    const db = await guardada();
    const munId = Object.keys(db!.municipios).find((k) => db!.municipios[k].nombre === 'Villa Sintética de Arriba')!;
    expect(db!.municipios[munId]).toMatchObject({ ine: '99001', callejero: { estado: 'sin-callejero' }, territorio: { cp: { uso: 'fijo', valorFijo: '47999' } } });
    expect(Object.values(db!.campanas).filter((c) => c.municipioId === munId)).toHaveLength(3);

    // 3. Incorporar un Excel: el destino se elige antes del archivo
    fireEvent.click(within(tabla).getAllByRole('button', { name: 'Incorporar un Excel aquí' })[0]);
    const destino = screen.getByRole('region', { name: 'Destino' });
    expect((within(destino).getByLabelText('Municipio de destino') as HTMLSelectElement).value).toBe(munId);
    const opciones = [...(within(destino).getByLabelText('Campaña de destino') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(opciones).toEqual(['Censo 2023 · histórico (2023)', 'Censo 2023 · polígono (2023)']);
    expect(destino).toHaveTextContent(/no tiene callejero todavía/);
    expect(screen.getByRole('button', { name: /Siguiente: columnas/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Archivo XLSX del censo'), { target: { files: [new File([bytesA as BlobPart], casoA.archivo)] } });
    await screen.findByLabelText('Identificación del archivo', undefined, { timeout: 20000 });
    expect(screen.getByRole('region', { name: 'Qué se hará' })).toHaveTextContent(/«Censo 2023 · histórico» \(2023\) de Villa Sintética de Arriba/);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: columnas/ }));
    await screen.findByRole('table', { name: 'Correspondencia de columnas' }, { timeout: 20000 });
    await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Analizar con estas columnas/ }));
    await screen.findByRole('region', { name: 'Diagnóstico agregado' }, { timeout: 60000 });
    expect(screen.getByRole('region', { name: 'Conciliación de calles' })).toHaveTextContent(/Villa Sintética de Arriba no tiene callejero todavía/);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Decisiones/ }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Vista previa/ }));
    expect(screen.getByRole('region', { name: 'Identificación' })).toHaveTextContent(/Censo 2023 · histórico/);
    expect(screen.getByRole('region', { name: 'Recuento de registros' })).toHaveTextContent(/Preparados40de 40 filas.*Vinculados0/);
    // Respaldo comprobado y confirmación (espacio de ensayo)
    const r = useEspacios.getState().prepararRespaldo();
    fireEvent.change(screen.getByLabelText('Comprobar un respaldo'), { target: { files: [new File([r.texto], r.nombreArchivo, { type: 'application/json' })] } });
    await screen.findByText(/Respaldo correcto y completo/, undefined, { timeout: 20000 });
    const conf = screen.getByRole('region', { name: 'Confirmación' });
    fireEvent.click(within(conf).getByLabelText('He revisado la vista previa'));
    await waitFor(() => expect(within(conf).getByRole('button', { name: /Incorporar al espacio/ })).toBeEnabled());
    fireEvent.click(within(conf).getByRole('button', { name: /Incorporar al espacio/ }));
    await screen.findByRole('region', { name: 'Resultado' }, { timeout: 60000 });
    const fin = await guardada();
    const imp = Object.values(fin!.importaciones)[0];
    expect(imp).toMatchObject({ municipioId: munId, campanaId: Object.values(fin!.campanas).find((c) => c.nombre === 'Censo 2023 · histórico')!.id });
    expect(Object.keys(fin!.registros)).toHaveLength(40);
    expect(Object.keys(fin!.locales)).toHaveLength(0);
    expect(within(screen.getByRole('region', { name: 'Campañas' })).getByRole('table')).toHaveTextContent(/40 registros · 1 incorporación/);

    // 4. Al volver a abrir el espacio, municipios y campañas siguen ahí
    cleanup();
    useEspacios.getState().cerrar();
    montar();
    const otra = await screen.findByRole('region', { name: 'Municipios' }, { timeout: 20000 });
    expect(within(otra).getByRole('button', { name: /Villa Sintética de Arriba/ })).toHaveTextContent(/3 campañas/);
  }, 240000);
});
