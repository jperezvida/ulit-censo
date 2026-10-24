import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { clear as idbClear, createStore } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useAsistenteEspacio } from './estadoAsistenteEspacio';
import { CASOS_GENERALIDAD } from '../../data/xlsxGeneralidad';
import { BASE_PERFILES, listarPerfiles } from '../../store/perfiles';

/** G1 · Paso «Columnas» en pantalla, con censos SINTÉTICOS de otros municipios (espacio de ensayo). */
const snapshot = readFileSync('public/data/medina-callejero.json', 'utf8');
const caso = (id: string) => CASOS_GENERALIDAD.find((c) => c.id === id)!;
let bytesC: Uint8Array;
let bytesA: Uint8Array;

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  bytesC = await caso('C').generar();
  bytesA = await caso('A').generar();
}, 60000);
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => JSON.parse(snapshot) }) as unknown as Response));
  for (const t of ['ensayo', 'real']) await idbClear(createStore(`ulit-censo-${t}`, 'datos'));
  await idbClear(createStore(BASE_PERFILES, 'perfiles'));
  useEspacios.getState().cerrar();
  useAsistenteEspacio.getState().reiniciar();
});
afterEach(() => vi.unstubAllGlobals());

async function abrirEnsayoCon(bytes: Uint8Array, nombre: string) {
  render(<MemoryRouter initialEntries={['/espacios/ensayo']}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
  if (await screen.findByRole('region', { name: /Crear el espacio|Estado del espacio/ }, { timeout: 20000 }).then((r) => r.getAttribute('aria-label') === 'Crear el espacio')) {
    fireEvent.change(screen.getByLabelText('Persona responsable'), { target: { value: 'Coordinación de Prueba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear el espacio' }));
    await screen.findByRole('region', { name: 'Estado del espacio' }, { timeout: 20000 });
  }
  await crearCampanaHistorica();
  fireEvent.change(screen.getByLabelText('Archivo XLSX del censo'), { target: { files: [new File([bytes as BlobPart], nombre)] } });
  await screen.findByLabelText('Identificación del archivo', undefined, { timeout: 20000 });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente: columnas/ }));
  return screen.findByRole('table', { name: 'Correspondencia de columnas' }, { timeout: 20000 });
}
/** G2 · Destino: crea (desde el asistente) la campaña histórica en la que se incorporará el Excel. */
async function crearCampanaHistorica(anio = 2025, nombre = `Censo ${anio} · histórico`) {
  const destino = await screen.findByRole('region', { name: 'Destino' }, { timeout: 20000 });
  fireEvent.click(within(destino).getByRole('button', { name: 'Crear una campaña histórica' }));
  fireEvent.change(within(destino).getByLabelText('Año de la campaña'), { target: { value: String(anio) } });
  fireEvent.change(within(destino).getByLabelText('Nombre de la campaña'), { target: { value: nombre } });
  fireEvent.click(within(destino).getByRole('button', { name: /Crear la campaña/ }));
  await waitFor(() => expect((within(screen.getByRole('region', { name: 'Destino' })).getByLabelText('Campaña de destino') as HTMLSelectElement).selectedOptions[0]?.textContent).toMatch(new RegExp(`${anio}`)), { timeout: 20000 });
}

const datoDe = (cabecera: string) => screen.getByLabelText(`Dato de ULIT para «${cabecera}»`) as HTMLSelectElement;

describe('G1 · Paso «Columnas» (interfaz)', () => {
  it('columnas dudosas: no se asignan solas; se relacionan a mano, se guarda el perfil y se analiza sin informe de referencia', async () => {
    const c = caso('C');
    await abrirEnsayoCon(bytesC, c.archivo);
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/Falta indicar qué columna es la calle o la dirección completa.*4 columna\(s\) podrían ser el mismo dato/);
    expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeDisabled();
    expect(datoDe('Número').value).toBe('numero');
    expect(datoDe('Dirección').value).toBe('');
    fireEvent.change(datoDe('Nombre comercial'), { target: { value: 'nombre' } });
    fireEvent.change(datoDe('Dirección'), { target: { value: 'direccion' } });
    fireEvent.change(datoDe('Nombre del local'), { target: { value: '' } });
    fireEvent.change(datoDe('Dirección fiscal'), { target: { value: '' } });
    // Un campo ya usado no se puede elegir en otra columna
    expect(within(datoDe('Dirección fiscal')).getByRole('option', { name: /Calle o vía.*ya en C/ })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled());
    // Vista previa de las primeras filas con los datos elegidos
    const previa = screen.getByRole('table', { name: 'Primeras filas' });
    expect(previa).toHaveTextContent(/Nombre del negocio/);
    expect(previa).toHaveTextContent(/NEGOCIO SINTÉTICO C1/);
    // Guardar (solo estructura) y reutilizar
    fireEvent.change(screen.getByLabelText('Nombre del perfil'), { target: { value: 'Aldea Sintética' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar perfil/ }));
    await screen.findByText(/Perfil «Aldea Sintética» guardado \(versión 1\)/);
    const [g] = await listarPerfiles();
    expect(g).toMatchObject({ id: 'usuario-aldea-sintetica', version: 1, adicionales: ['Nombre del local', 'Dirección fiscal'] });
    expect(JSON.stringify(g)).not.toMatch(/NEGOCIO SINTÉTICO/);
    fireEvent.click(screen.getByRole('button', { name: /Analizar con estas columnas/ }));
    const diag = await screen.findByRole('region', { name: 'Diagnóstico agregado' }, { timeout: 60000 });
    expect(diag).toHaveTextContent(/Diagnóstico del archivo/);
    expect(diag).toHaveTextContent(/Sin informe de referencia/);
    expect(useAsistenteEspacio.getState().preparado!.resultado.original.filas).toHaveLength(12);
    expect(useAsistenteEspacio.getState().preparado!.resultado.original.perfil.id).toBe('usuario-aldea-sintetica');
  }, 120000);

  it('otro municipio con la cabecera en la fila 3 y columnas adicionales: se reconoce sola y el perfil guardado se reutiliza', async () => {
    const c = caso('A');
    await abrirEnsayoCon(bytesA, c.archivo);
    expect((screen.getByLabelText('Hoja con los datos') as HTMLSelectElement).value).toBe('Censo 2023');
    expect((screen.getByLabelText('Fila de títulos') as HTMLInputElement).value).toBe('3');
    for (const [h, k] of Object.entries(c.esperado)) expect(datoDe(h).value, h).toBe(k ?? '');
    expect(screen.getByLabelText('Resumen de columnas')).toHaveTextContent(/8 reconocidas · 2 adicionales/);
    await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled());
    // La fila de títulos se puede cambiar a mano (si se elige mal, faltan los obligatorios)
    fireEvent.change(screen.getByLabelText('Fila de títulos'), { target: { value: '1' } });
    await screen.findByText(/Falta indicar qué columna es la calle o la dirección completa/);
    fireEvent.change(screen.getByLabelText('Fila de títulos'), { target: { value: '3' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Analizar con estas columnas/ }));
    await screen.findByRole('region', { name: 'Diagnóstico agregado' }, { timeout: 60000 });
    const res = useAsistenteEspacio.getState().preparado!.resultado;
    expect(res.original.filas).toHaveLength(40);
    expect(res.original.adicionales?.map((x) => x.cabecera)).toEqual(['Observaciones del censista', 'Código interno']);
  }, 120000);

  it('localización incompleta: sin columna de número o con la dirección completa en una celda, se puede continuar', async () => {
    const d = caso('D');
    await abrirEnsayoCon(await d.generar(), d.archivo);
    for (const [h, k] of Object.entries(d.esperado)) expect(datoDe(h).value, h).toBe(k ?? '');
    expect(screen.getByLabelText('Resumen de columnas')).toHaveTextContent(/Calle o dirección completa.*Número \(opcional\)/);
    expect(screen.getByText(/Sin columna de número: los registros se importan igualmente/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled());
    // La misma columna, relacionada a mano como dirección completa: el aviso de número desaparece.
    fireEvent.change(datoDe('Calle'), { target: { value: '' } });
    await screen.findByText(/Falta indicar qué columna es la calle o la dirección completa/);
    expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeDisabled();
    fireEvent.change(datoDe('Calle'), { target: { value: 'direccionCompleta' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled());
    expect(screen.queryByText(/Sin columna de número/)).toBeNull();
  }, 120000);
});
