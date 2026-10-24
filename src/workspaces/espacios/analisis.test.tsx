import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ExcelJS from 'exceljs';
import { clear as idbClear, createStore, keys as idbKeys } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useAsistenteEspacio } from './estadoAsistenteEspacio';
import { validarInstantanea } from '../../data/instantaneaOsm';
import { libroSinteticoC1e } from '../../data/xlsxSinteticoC1e';

/** Callejero REAL (OSM) y un archivo SINTÉTICO sin marca (hace las veces de «archivo externo»). */
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
});
afterEach(() => vi.unstubAllGlobals());

describe('C1e-B · Análisis del Excel real SIN GUARDAR', () => {
  it('almacén: la base vive solo en memoria y toda escritura se rechaza', async () => {
    expect(await useEspacios.getState().abrirEnMemoria('real', { nombre: 'Persona que analiza', roles: ['coordinador'] })).toEqual({ ok: true });
    const s = useEspacios.getState();
    expect(s.soloMemoria).toBe(true);
    expect(s.db!.meta.espacio).toBe('real');
    for (const r of [await s.crear({ nombre: 'Otra', roles: ['coordinador'] }), await s.restaurar('{}'), await s.deshacer('x'), await s.verificarRespaldo('{}', 'x')]) {
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/sin guardar/) });
    }
    expect(() => s.prepararRespaldo()).toThrow(/sin guardar/);
    expect(await idbKeys(createStore('ulit-censo-real', 'datos'))).toEqual([]);
  }, 60000);

  it('interfaz: garantías → persona → archivo → vista previa; nada se incorpora ni se guarda y al salir se descarta', async () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/espacios/analisis']}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('banner', { name: 'Espacio activo' })).toHaveTextContent(/SIN GUARDAR.*no se sube a ningún servidor/);
    const gar = screen.getByRole('region', { name: 'Garantías del sitio' });
    await within(gar).findByText(/Garantías verificadas/);
    expect(gar).toHaveTextContent(/Equipo propio \(localhost\)/);
    fireEvent.change(screen.getByLabelText('Nombre de quien analiza'), { target: { value: 'Persona que analiza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Empezar el análisis' }));
    await screen.findByLabelText('Archivo XLSX del censo', undefined, { timeout: 20000 });
    fireEvent.change(screen.getByLabelText('Archivo XLSX del censo'), { target: { files: [new File([externo as BlobPart], 'censo.xlsx')] } });
    await screen.findByLabelText('Identificación del archivo', undefined, { timeout: 20000 });
    fireEvent.click(screen.getByRole('button', { name: /Analizar el archivo/ }));
    await screen.findByRole('region', { name: 'Diagnóstico agregado' }, { timeout: 60000 });
    // Diagnóstico corregido: calle normalizada, «S/N» y portales numéricos por separado
    const ind = screen.getByRole('table', { name: 'Indicadores del archivo' });
    expect(ind).toHaveTextContent(/Pares calle \+ número distintos.*Calle normalizada.*625625/);
    expect(ind).toHaveTextContent(/«S\/N» agrupados por calle.*3/);
    expect(ind).toHaveTextContent(/portales NUMÉRICOS compartidos \(regla de C1b\).*442/);
    // Revisión por clases
    const clases = screen.getByRole('group', { name: 'Clases de revisión' });
    expect(clases).toHaveTextContent(/Errores efectivos/);
    expect(clases).toHaveTextContent(/Pendientes de comprobar/);
    expect(clases).toHaveTextContent(/Informativos/);
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Decisiones/ }));
    // Conciliación supervisada: la Plaza Mayor no se puede vincular; Farolas se confirma con justificación
    const conc = screen.getByLabelText('Conciliación de calles');
    expect(within(conc).getByLabelText('Denominación Plaza Mayor')).toHaveTextContent(/Plaza Mayor de la Hispanidad.*NO figura en el callejero OSM actual/);
    const farolas = within(conc).getByLabelText('Denominación Calle de las Farolas Antigua Ángel Molina');
    expect(farolas).toHaveTextContent(/42/);
    expect(farolas).toHaveTextContent(/Calle de las Farolas.*nombre actual y el antiguo/);
    fireEvent.change(within(farolas).getByLabelText(/^Decisión para/), { target: { value: within(farolas).getByRole('option', { name: 'Confirmar: Calle de las Farolas' }).getAttribute('value') } });
    expect(within(farolas).getByRole('button', { name: 'Confirmar decisión' })).toBeDisabled();
    fireEvent.change(within(farolas).getByLabelText(/^Justificación para/), { target: { value: 'Nomenclátor: antigua calle de Ángel Molina.' } });
    fireEvent.click(within(farolas).getByRole('button', { name: 'Confirmar decisión' }));
    await waitFor(() => expect(useAsistenteEspacio.getState().preparado!.plan.correspondencias.porMotivo['calle-sin-correspondencia']).toBe(135));
    expect(useAsistenteEspacio.getState().decisiones.calles![0]).toMatchObject({ denominacion: 'Calle de las Farolas Antigua Ángel Molina', accion: 'vincular', motivo: 'Nomenclátor: antigua calle de Ángel Molina.' });
    // Revisión en bloque con un clic (sin justificación)
    fireEvent.click(screen.getByRole('tab', { name: 'Revisión en bloque' }));
    const bloque = screen.getByLabelText('Grupo «Local Vacío» sin valor');
    fireEvent.click(within(bloque).getByRole('button', { name: /Marcar como revisado/ }));
    await waitFor(() => expect(within(screen.getByLabelText('Grupo «Local Vacío» sin valor')).getByText(/Revisado en bloque/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Vista previa/ }));
    expect(screen.getByRole('region', { name: 'Recuento de registros' })).toHaveTextContent(/Preparados889/);
    const conf = screen.getByRole('region', { name: 'Confirmación' });
    expect(conf).toHaveTextContent(/Análisis sin guardar\. Esta vista previa vive solo en la memoria/);
    expect(conf).toHaveTextContent(/Análisis SIN GUARDAR \(C1e-B\): solo vista previa/);
    expect(conf).toHaveTextContent(/C1e-B · Detenido aquí/);
    fireEvent.click(within(conf).getByLabelText('He revisado la vista previa'));
    expect(within(conf).getByRole('button', { name: /Incorporar al espacio/ })).toBeDisabled();
    expect(await idbKeys(createStore('ulit-censo-real', 'datos'))).toEqual([]);
    // Al salir de la página no queda nada en memoria
    unmount();
    expect(useEspacios.getState().db).toBeNull();
    expect(useAsistenteEspacio.getState().archivo).toBeNull();
    expect(useAsistenteEspacio.getState().preparado).toBeNull();
  }, 180000);
});
