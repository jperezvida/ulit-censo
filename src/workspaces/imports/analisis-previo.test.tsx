import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { AnalisisPrevio } from './AnalisisPrevio';
import { conPrefijo, libroFicticio } from '../../data/xlsxFicticio';
import { useStore } from '../../store/store';
import { escenarioOficina } from '../../data/escenarioOficina';

beforeAll(() => {
  // jsdom: File#arrayBuffer y crypto.subtle pueden faltar según la versión.
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function arrayBuffer(this: File) {
      return new Promise<ArrayBuffer>((ok) => {
        const r = new FileReader();
        r.onload = () => ok(r.result as ArrayBuffer);
        r.readAsArrayBuffer(this);
      });
    };
  }
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

async function analizar(bytes: Uint8Array, nombre: string, municipio = 'mun-medina') {
  render(<AnalisisPrevio municipioId={municipio} onCerrar={() => undefined} />);
  fireEvent.change(screen.getByLabelText('Archivo xlsx'), { target: { files: [new File([bytes as BlobPart], nombre)] } });
  return waitFor(() => screen.getByLabelText('Informe estructural'), { timeout: 15000 });
}

describe('C1a · Análisis previo en la interfaz', () => {
  it('muestra hoja de datos, perfil, columnas y territorio de un XLSX ficticio con prefijo, sin tocar la base de datos', async () => {
    const esc = escenarioOficina({ calles: 2, localesPorCalle: 4 });
    useStore.setState({ db: esc.db });
    const antes = useStore.getState().db;
    const inf = await analizar(conPrefijo(await libroFicticio({ filas: 30, anomalias: true })), 'ficticio.xlsx');
    expect(within(inf.querySelector('.ap-resumen') as HTMLElement).getByText('Censo municipal histórico · 27 columnas')).toBeInTheDocument();
    expect(within(inf).getByText('ExcelJS + adaptación')).toBeInTheDocument();
    expect(within(inf).getByText(/Distrito: vacío en todas las filas, como corresponde/)).toBeInTheDocument();
    // La cabecera original conserva sus 56 espacios finales (se indican, no se eliminan)
    expect(within(inf).getByText('+56 esp.', { exact: false })).toBeInTheDocument();
    expect(within(inf).getAllByText(/número distinto de 0 y 1/).length).toBeGreaterThan(0);
    expect(within(inf).getByLabelText('Garantías')).toHaveTextContent(/no se ha importado ningún negocio/);
    // Nada en la base de datos ha cambiado
    expect(useStore.getState().db).toBe(antes);
  });

  it('con Valladolid, los campos territoriales vacíos se conservan ausentes (no se inventan)', async () => {
    const inf = await analizar(await libroFicticio({ filas: 20, cpVacio: true }), 'valladolid.xlsx', 'mun-valladolid');
    expect(within(inf).getAllByText(/Se conservará ausente/)).toHaveLength(3);
  });

  it('C1b: interpreta los valores desde el mismo archivo, sin importar nada ni mostrar nombres', async () => {
    const esc = escenarioOficina({ calles: 2, localesPorCalle: 4 });
    useStore.setState({ db: esc.db });
    const antes = useStore.getState().db;
    await analizar(await libroFicticio({ filas: 30, anomalias: true }), 'ficticio.xlsx');
    fireEvent.click(screen.getByRole('button', { name: /Interpretar valores \(C1b\)/ }));
    const panel = await waitFor(() => screen.getByLabelText('Interpretación de valores'), { timeout: 15000 });
    expect(within(panel).getByText('Valor 0/1 imposible')).toBeInTheDocument();
    expect(within(panel).getByText('Texto candidato a «sin información»')).toBeInTheDocument();
    expect(within(panel).getByText(/Decisión 1: Diccionario de equivalencias/)).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/COMERCIO FICTICIO|VÍA FICTICIA/);
    expect(screen.getByRole('button', { name: /Informe de interpretación/ })).toBeInTheDocument();
    expect(useStore.getState().db).toBe(antes);
  });

  it('un archivo que no es XLSX muestra un error claro', async () => {
    render(<AnalisisPrevio municipioId="mun-medina" onCerrar={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Archivo xlsx'), { target: { files: [new File(['Calle;Num'], 'datos.csv')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es un libro .xlsx válido/);
  });
});
