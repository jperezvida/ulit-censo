import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { clear as idbClear, createStore, get as idbGet, set as idbSet } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { useStore } from '../../store/store';
import { useAsistenteEspacio, useSeleccionEspacio } from './estadoAsistenteEspacio';
import { osmVillaSintetica } from '../../data/callejeroSintetico';
import { archivoItinerario, libroConFilas, libroItinerario } from '../../data/xlsxItinerarios';
import { crearBaseEspacio, PREFIJO } from '../../domain/espacios';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from '../../domain/municipios';
import { aplicarCarga } from '../../domain/callejeros';
import { leerOsmMunicipio } from '../../domain/fuentesCallejero';
import { prepararIncorporacion } from '../../domain/incorporacionXlsx';
import { aplicarIncorporacion } from '../../domain/incorporacion';
import { FILAS_2025 } from '../../domain/censo2026.fixture';
import type { BaseDatos } from '../../domain/db';

/** Censo 2026 por itinerarios sobre el censo 2025, desde el inicio sencillo (datos SINTÉTICOS). */
vi.setConfig({ testTimeout: 240000 });
const tienda = () => createStore('ulit-censo-ensayo', 'datos');
const AHORA = '2026-10-28T10:00:00.000Z';
let bytes: Record<string, Uint8Array>;
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  bytes = { IT1: await libroItinerario('IT1'), IT2: await libroItinerario('IT2'), IT1v2: await libroItinerario('IT1', 2) };
}, 60000);
beforeEach(async () => {
  await idbClear(tienda());
  localStorage.clear();
  useEspacios.getState().cerrar();
  useAsistenteEspacio.getState().reiniciar();
  useSeleccionEspacio.getState().reiniciar();
  useStore.setState({ db: null });
});
afterEach(() => vi.unstubAllGlobals());

/** Espacio con la Villa Sintética, su callejero y el censo histórico 2025 ya incorporado. */
async function sembrar() {
  let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Coordinación de Prueba', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'c26ui', ahora: AHORA, incluirMedina: false });
  const o = { prefijo: PREFIJO.ensayo, porId: db.meta.espacioCreadoPorId!, ahora: AHORA, anioActual: 2026 };
  const V = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
  const m = altaMunicipio(db, { ...V, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, o); db = m.db;
  const j = osmVillaSintetica(1); const l = leerOsmMunicipio(j, V); if (!l.ok) throw new Error(l.motivo);
  db = aplicarCarga(db, m.municipioId, l, { archivo: 'v.json', contenido: JSON.stringify(j), fuente: 'OpenStreetMap (Overpass API)' }, o).db;
  const h = crearCampana(db, { municipioId: m.municipioId, anio: 2025, nombre: 'Censo 2025', clase: 'historica' }, o); db = h.db;
  const d = { municipioId: m.municipioId, anio: 2025, campanaId: h.campanaId };
  const p = await prepararIncorporacion(db, await libroConFilas('IT1', FILAS_2025), 'censo_2025_SINTETICO.xlsx', d, {});
  db = aplicarIncorporacion(db, p.resultado, d, {}, p.plan, { porId: o.porId, ahora: AHORA }).db;
  await idbSet('db', db, tienda());
  return { historica: h.campanaId };
}

const acceso = (n: string) => within(screen.getByRole('navigation', { name: 'Accesos' })).getByRole('button', { name: n });
const tarjeta = (codigo: string) => within(screen.getByRole('list', { name: 'Itinerarios' })).getAllByRole('listitem').find((li) => li.querySelector('b')?.textContent === codigo)!;

async function incorporar(clave: 'IT1' | 'IT2' | 'IT1v2', archivo: string) {
  const panel = screen.getByRole('region', { name: 'Incorporar Excel' });
  fireEvent.change(within(panel).getByLabelText('Archivo XLSX del censo'), { target: { files: [new File([bytes[clave] as BlobPart], archivo)] } });
  await waitFor(() => expect(within(panel).getByRole('button', { name: /Continuar/ })).toBeEnabled(), { timeout: 20000 });
  fireEvent.click(within(panel).getByRole('button', { name: /Continuar/ }));
  await waitFor(() => expect(within(panel).getByRole('button', { name: /Analizar con estas columnas/ })).toBeEnabled(), { timeout: 20000 });
  fireEvent.click(within(panel).getByRole('button', { name: /Analizar con estas columnas/ }));
  await within(panel).findByRole('region', { name: 'Resultado de la comprobación' }, { timeout: 60000 });
  return panel;
}
async function confirmar(panel: HTMLElement) {
  fireEvent.click(within(panel).getByRole('button', { name: /Siguiente: Decisiones/ }));
  fireEvent.click(within(panel).getByRole('button', { name: /Siguiente: Vista previa/ }));
  const conf = within(panel).getByRole('region', { name: 'Confirmación' });
  fireEvent.click(within(conf).getByLabelText('He revisado la vista previa'));
  const r = useEspacios.getState().prepararRespaldo();
  fireEvent.change(within(conf).getByLabelText('Comprobar un respaldo'), { target: { files: [new File([r.texto], r.nombreArchivo, { type: 'application/json' })] } });
  await waitFor(() => expect(within(conf).getByRole('button', { name: /Incorporar al espacio/ })).toBeEnabled(), { timeout: 20000 });
  fireEvent.click(within(conf).getByRole('button', { name: /Incorporar al espacio/ }));
  await within(panel).findByRole('region', { name: 'Resultado' }, { timeout: 60000 });
  fireEvent.click(within(panel).getByRole('button', { name: 'Cerrar el asistente' }));
}

describe('Censo 2026 por itinerarios (interfaz)', () => {
  it('campaña 2026 con referencia 2025, IT1 e IT2 acumulados, reimportación bloqueada y versión corregida tras deshacer', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const { historica } = await sembrar();
    render(<MemoryRouter initialEntries={['/espacios/ensayo']}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
    const ctx = await screen.findByRole('region', { name: 'Municipio y campaña' }, { timeout: 20000 });
    // Campaña operativa 2026 relacionada con el censo 2025
    fireEvent.click(within(ctx).getByRole('button', { name: /Campaña/ }));
    const f = screen.getByRole('group', { name: 'Nueva campaña' });
    fireEvent.click(within(f).getByRole('radio', { name: 'Operativa' }));
    fireEvent.change(within(f).getByLabelText('Año de la campaña'), { target: { value: '2026' } });
    fireEvent.change(within(f).getByLabelText('Nombre de la campaña'), { target: { value: 'Censo 2026' } });
    fireEvent.change(within(f).getByLabelText('Censo anterior de referencia'), { target: { value: historica } });
    fireEvent.click(within(f).getByRole('button', { name: /Crear la campaña/ }));
    await waitFor(() => expect((within(ctx).getByLabelText('Campaña') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Censo 2026'), { timeout: 20000 });
    const camp26 = Object.values(useEspacios.getState().db!.campanas).find((c) => c.anio === 2026)!;
    expect(camp26.campanaReferenciaId).toBe(historica);
    for (const k of ['IT1', 'IT2']) {
      fireEvent.change(screen.getByLabelText('Código del itinerario'), { target: { value: k } });
      fireEvent.click(screen.getByRole('button', { name: /Añadir itinerario/ }));
      await waitFor(() => expect(tarjeta(k)).toBeDefined(), { timeout: 20000 });
    }
    // IT1
    fireEvent.click(within(tarjeta('IT1')).getByRole('button', { name: /Incorporar su Excel/ }));
    await confirmar(await incorporar('IT1', archivoItinerario('IT1')));
    fireEvent.click(acceso('Itinerarios'));
    expect(within(tarjeta('IT1')).getByLabelText('Estados de IT1')).toHaveTextContent(/Campo: Excel incorporado \(6 registros\).*Oficina: 5 sin conciliar · 0\/1 locales revisados.*Validación: pendiente/);
    expect(acceso('Incidencias')).toHaveTextContent(/5.*por resolver/);
    // Conciliación asistida: primero las propuestas claras; cada candidato compara 2025 con 2026 y explica por qué
    fireEvent.click(acceso('Incidencias'));
    const filas = within(screen.getByRole('region', { name: 'Incidencias' })).getAllByRole('listitem', { name: /^Fila \d+ de IT1/ });
    expect(filas.map((li) => li.textContent!.match(/Propuesta clara|Mismo portal, revisar|Sin correspondencia segura/)![0])).toEqual(['Propuesta clara', 'Propuesta clara', 'Propuesta clara', 'Propuesta clara', 'Mismo portal, revisar']);
    const ferr = filas[4];
    expect(ferr).toHaveTextContent(/FERRETERÍA SINTÉTICA/);
    expect(within(ferr).getAllByLabelText(/^Comparación con /)[0]).toHaveTextContent(/NombreDROGUERÍA SINTÉTICAFERRETERÍA SINTÉTICA.*EstadoOcupadoOcupado/);
    expect(within(ferr).getAllByLabelText(/^Motivos de /)[0]).toHaveTextContent(/Nombre distinto al de Censo 2025: no confirma un cambio de negocio/);
    expect(ferr).toHaveTextContent(/no confirma que sea el mismo negocio/);
    fireEvent.click(acceso('Itinerarios'));
    // IT2 se suma a la misma campaña
    fireEvent.click(within(tarjeta('IT2')).getByRole('button', { name: /Incorporar su Excel/ }));
    await confirmar(await incorporar('IT2', archivoItinerario('IT2')));
    let db = (await idbGet<BaseDatos>('db', tienda()))!;
    expect(Object.values(db.campanas)).toHaveLength(2);
    expect(Object.values(db.importaciones).filter((i) => i.campanaId === camp26.id && i.estado === 'confirmada').map((i) => i.c1?.itinerario?.codigo).sort()).toEqual(['IT1', 'IT2']);
    // Reimportar el mismo Excel en IT2: bloqueado
    fireEvent.click(acceso('Incorporar Excel'));
    fireEvent.change(screen.getByLabelText('Itinerario de destino'), { target: { value: tarjetaId(db, 'IT2') } });
    let panel = await incorporar('IT1', archivoItinerario('IT1'));
    expect(within(panel).getAllByRole('alert').map((a) => a.textContent).join(' ')).toMatch(/No se puede incorporar: .*ya se incorporó/);
    fireEvent.click(within(panel).getAllByRole('button', { name: /Archivo/ })[0]);
    // Versión corregida de IT1: hay que deshacer antes la anterior desde su tarjeta
    fireEvent.click(acceso('Itinerarios'));
    fireEvent.click(within(tarjeta('IT1')).getByRole('button', { name: 'Consultar' }));
    vi.stubGlobal('confirm', () => true);
    fireEvent.click(within(tarjeta('IT1')).getByRole('button', { name: /Deshacer su Excel/ }));
    await waitFor(() => expect(within(tarjeta('IT1')).getByRole('button', { name: /Incorporar su Excel/ })).toBeInTheDocument(), { timeout: 20000 });
    fireEvent.click(within(tarjeta('IT1')).getByRole('button', { name: /Incorporar su Excel/ }));
    await confirmar(await incorporar('IT1v2', archivoItinerario('IT1', 2)));
    db = (await idbGet<BaseDatos>('db', tienda()))!;
    expect(Object.values(db.importaciones).filter((i) => i.campanaId === camp26.id).map((i) => [i.c1?.itinerario?.codigo, i.estado, i.filas]).sort()).toEqual([['IT1', 'confirmada', 7], ['IT1', 'descartada', 6], ['IT2', 'confirmada', 5]]);
    fireEvent.click(acceso('Itinerarios'));
    expect(within(tarjeta('IT1')).getByLabelText('Estados de IT1')).toHaveTextContent(/Excel incorporado \(7 registros\)/);
    expect(useStore.getState().db).toBeNull();
    panel = screen.getByRole('region', { name: 'Itinerarios' });
    expect(panel).toBeInTheDocument();
  });
});

function tarjetaId(db: BaseDatos, codigo: string) { return Object.values(db.itinerarios).find((i) => i.codigo === codigo)!.id; }
