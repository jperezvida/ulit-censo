import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ExcelJS from 'exceljs';
import { clear as idbClear, createStore, get as idbGet } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useAsistenteEspacio } from './estadoAsistenteEspacio';
import { validarInstantanea } from '../../data/instantaneaOsm';
import { ARCHIVO_SINTETICO_C1E, libroSinteticoC1e } from '../../data/xlsxSinteticoC1e';
import type { BaseDatos } from '../../domain/db';

/** Callejero REAL (OSM) y archivo SINTÉTICO de C1e; IndexedDB simulada. Ningún dato comercial real. */
const snapshot = readFileSync('public/data/medina-callejero.json', 'utf8');
let bytes: Uint8Array;
let sinMarca: Uint8Array;

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const v = validarInstantanea(JSON.parse(snapshot));
  if (!v.ok) throw new Error(v.motivo);
  bytes = await libroSinteticoC1e(v.calles);
  // Mismo contenido SIN la marca de sintético (simula un archivo externo cualquiera, no el auténtico)
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  Object.assign(wb, { keywords: '', creator: 'Otro programa', title: '' });
  sinMarca = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}, 60000);

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => JSON.parse(snapshot) }) as unknown as Response));
  for (const t of ['ensayo', 'real']) await idbClear(createStore(`ulit-censo-${t}`, 'datos'));
  useEspacios.getState().cerrar();
  useAsistenteEspacio.getState().reiniciar();
});
afterEach(() => vi.unstubAllGlobals());

const montar = (ruta: string) => render(<MemoryRouter initialEntries={[ruta]}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
const archivo = (b: Uint8Array, nombre = ARCHIVO_SINTETICO_C1E) => new File([b as BlobPart], nombre, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

async function crearEspacio() {
  await screen.findByRole('region', { name: 'Crear el espacio' });
  fireEvent.change(screen.getByLabelText('Persona responsable'), { target: { value: 'Coordinación de Prueba' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear el espacio' }));
  await screen.findByRole('region', { name: 'Estado del espacio' }, { timeout: 20000 });
}

async function elegirYAnalizar(b: Uint8Array) {
  fireEvent.change(screen.getByLabelText('Archivo XLSX del censo'), { target: { files: [archivo(b)] } });
  await screen.findByLabelText('Identificación del archivo', undefined, { timeout: 20000 });
}


/** Paso «Columnas»: elegir el perfil de referencia de Medina 2025 y comparar con su informe. */
async function columnasMedina() {
  const sel = await screen.findByLabelText('Perfil de importación', undefined, { timeout: 20000 });
  fireEvent.change(sel, { target: { value: 'medina-2025-referencia' } });
  await waitFor(() => expect(screen.getByLabelText('Comparar con el informe de referencia')).toBeInTheDocument(), { timeout: 20000 });
  fireEvent.click(screen.getByLabelText('Comparar con el informe de referencia'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /Analizar con estas columnas/ }));
}

describe('C1e · Espacios aislados (interfaz)', () => {
  it('ensayo: archivo local → diagnóstico igual al informe → vista previa → exige respaldo comprobado → incorpora', async () => {
    montar('/espacios/ensayo');
    expect(screen.getByRole('banner', { name: 'Espacio activo' })).toHaveTextContent(/ESPACIO DE ENSAYO.*SINTÉTICOS/);
    await crearEspacio();
    await elegirYAnalizar(bytes);
    const ident = screen.getByLabelText('Identificación del archivo');
    expect(ident).toHaveTextContent(/Archivo SINTÉTICO/);
    expect(ident).toHaveTextContent(/No coincide con la huella del archivo auténtico/);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: columnas/ }));
    await columnasMedina();
    const diag = await screen.findByRole('region', { name: 'Diagnóstico agregado' }, { timeout: 60000 });
    expect(diag).toHaveTextContent(/indicadores coinciden con el informe de referencia/);
    expect(diag).toHaveTextContent(/«Tablas Dinámicas» \(resumen, no se importa\)/);
    const calles = screen.getByRole('region', { name: 'Conciliación de calles' });
    expect(within(calles).getByRole('table', { name: /Pendiente de conciliar/ }).querySelectorAll('tbody tr')).toHaveLength(21);
    // Vista previa
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Decisiones/ }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Vista previa/ }));
    const rec = screen.getByRole('region', { name: 'Recuento de registros' });
    expect(rec).toHaveTextContent(/Preparados889de 889 filas/);
    expect(rec).toHaveTextContent(/Bloqueados0ninguno/);
    const conf = screen.getByRole('region', { name: 'Confirmación' });
    expect(conf).toHaveTextContent(/Falta un respaldo externo comprobado/);
    fireEvent.click(within(conf).getByLabelText('He revisado la vista previa'));
    expect(within(conf).getByRole('button', { name: /Incorporar al espacio/ })).toBeDisabled();
    // Respaldo: se prepara y se comprueba con el selector de archivo (como haría la persona)
    const r = useEspacios.getState().prepararRespaldo();
    fireEvent.change(screen.getByLabelText('Comprobar un respaldo'), { target: { files: [new File([r.texto], r.nombreArchivo, { type: 'application/json' })] } });
    await screen.findByText(/Respaldo correcto y completo: coincide con el estado actual/, undefined, { timeout: 20000 });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Confirmación' })).getByRole('button', { name: /Incorporar al espacio/ })).toBeEnabled());
    fireEvent.click(within(screen.getByRole('region', { name: 'Confirmación' })).getByRole('button', { name: /Incorporar al espacio/ }));
    const res = await screen.findByRole('region', { name: 'Resultado' }, { timeout: 60000 });
    expect(res).toHaveTextContent(/Incorporación aplicada como una única operación/);
    expect(res).toHaveTextContent(/respaldo nuevo/);
    const guardada = await idbGet<BaseDatos>('db', createStore('ulit-censo-ensayo', 'datos'));
    expect(Object.keys(guardada!.registros)).toHaveLength(889);
    expect(await idbGet<BaseDatos>('db', createStore('ulit-censo-real', 'datos'))).toBeUndefined();
  }, 180000);

  it('real: rechaza el archivo sintético y, con otro archivo, la confirmación queda bloqueada (C1e-B)', async () => {
    montar('/espacios/real');
    expect(screen.getByRole('banner', { name: 'Espacio activo' })).toHaveTextContent(/ESPACIO DE DATOS REALES/);
    await crearEspacio();
    await elegirYAnalizar(bytes);
    expect(screen.getByRole('alert')).toHaveTextContent(/no se admite en el espacio de datos reales/);
    expect(screen.getByRole('button', { name: /Siguiente: columnas/ })).toBeDisabled();
    await elegirYAnalizar(sinMarca);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: columnas/ }));
    await columnasMedina();
    await screen.findByRole('region', { name: 'Diagnóstico agregado' }, { timeout: 60000 });
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Decisiones/ }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Vista previa/ }));
    const conf = screen.getByRole('region', { name: 'Confirmación' });
    expect(conf).toHaveTextContent(/C1e-B · Detenido aquí/);
    expect(conf).toHaveTextContent(/el SHA-256 no coincide con el del diagnóstico agregado/);
    fireEvent.click(within(conf).getByLabelText('He revisado la vista previa'));
    expect(within(conf).getByRole('button', { name: /Incorporar al espacio/ })).toBeDisabled();
    expect(Object.keys((await idbGet<BaseDatos>('db', createStore('ulit-censo-real', 'datos')))!.registros)).toHaveLength(0);
  }, 180000);
});
