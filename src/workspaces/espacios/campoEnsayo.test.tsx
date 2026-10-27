import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { clear, createStore, get, set } from 'idb-keyval';
import EspaciosApp from './EspaciosApp';
import CampoApp from '../field/CampoApp';
import { useEspacios } from '../../store/espacios';
import { useStore } from '../../store/store';
import { crearBaseEspacio, PREFIJO } from '../../domain/espacios';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from '../../domain/municipios';
import { crearItinerario } from '../../domain/campanaOperativa';
import { aplicarCarga } from '../../domain/callejeros';
import { leerOsmMunicipio } from '../../domain/fuentesCallejero';
import { prepararIncorporacion } from '../../domain/incorporacionXlsx';
import { aplicarIncorporacion } from '../../domain/incorporacion';
import { osmVillaSintetica } from '../../data/callejeroSintetico';
import { archivoItinerario, libroItinerario } from '../../data/xlsxItinerarios';
import { C26_SINT, MUN_SINT, escenarioOficina } from '../../data/escenarioOficina';
import type { BaseDatos } from '../../domain/db';

/** Campo en el espacio de ensayo (solo lectura): aislamiento de datos, navegación y rutas inválidas. */
vi.setConfig({ testTimeout: 60000 });
vi.mock('../../components/mapa/MapaBase', () => ({ MapaBase: () => <div data-testid="mapa" /> }));

const tienda = () => createStore('ulit-censo-ensayo', 'datos');
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});
beforeEach(async () => {
  await clear(tienda());
  localStorage.clear();
  useEspacios.getState().cerrar();
  useStore.setState({ db: null });
});
afterEach(() => cleanup());

/** Ensayo: IT1 con su Excel sintético incorporado y dos calles planificadas (Real completa; Olmo solo pares y un tramo). */
async function preparar() {
  let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Coordinación de Prueba', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'campo', incluirMedina: false });
  const o = { prefijo: PREFIJO.ensayo, porId: db.meta.espacioCreadoPorId!, anioActual: 2026, ahora: '2026-10-27T10:00:00.000Z' };
  const V = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
  const m = altaMunicipio(db, { ...V, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, o); db = m.db;
  const j = osmVillaSintetica(1); const l = leerOsmMunicipio(j, V); if (!l.ok) throw new Error(l.motivo);
  db = aplicarCarga(db, m.municipioId, l, { archivo: 'v.json', contenido: JSON.stringify(j), fuente: 'OpenStreetMap (Overpass API)' }, o).db;
  const c = crearCampana(db, { municipioId: m.municipioId, anio: 2026, nombre: 'Censo 2026', clase: 'operativa', tipoOperativa: 'nuevo' }, o); db = c.db;
  const it1 = crearItinerario(db, c.campanaId, { codigo: 'IT1' }, o); db = it1.db;
  const it2 = crearItinerario(db, c.campanaId, { codigo: 'IT2' }, o); db = it2.db;
  const destino = { municipioId: m.municipioId, anio: 2026, campanaId: c.campanaId, itinerarioId: it1.itinerarioId };
  const p = await prepararIncorporacion(db, await libroItinerario('IT1'), archivoItinerario('IT1'), destino, {});
  db = aplicarIncorporacion(db, p.resultado, destino, {}, p.plan, { porId: o.porId, ahora: o.ahora }).db;
  const calle = (n: string) => Object.values(db.calles).find((x) => x.nombre === n)!;
  const olmo = calle('Calle del Olmo');
  db = { ...db, itinerarios: { ...db.itinerarios, [it1.itinerarioId]: { ...db.itinerarios[it1.itinerarioId], tramos: [
    { calleId: calle('Calle Real').id, acera: 'ambas', orden: 1 },
    { calleId: olmo.id, acera: 'par', segmentoIds: [olmo.segmentos[0].id], orden: 2 },
  ] } } };
  const hist = crearCampana(db, { municipioId: m.municipioId, anio: 2024, nombre: 'Censo 2024', clase: 'historica' }, o); db = hist.db;
  await set('db', db, tienda());
  return { db, campanaId: c.campanaId, it1: it1.itinerarioId, it2: it2.itinerarioId, olmo, historica: hist.campanaId, real: calle('Calle Real') };
}

function Lugar() { return <span data-testid="ruta">{useLocation().pathname}</span>; }
const montar = (ruta: string) => render(<MemoryRouter initialEntries={[ruta]}><Routes><Route path="/espacios/*" element={<><EspaciosApp /><Lugar /></>} /></Routes></MemoryRouter>);

describe('Campo en el espacio de ensayo (solo lectura)', () => {
  it('abre el itinerario con sus calles en orden, aceras y tramos, sin tocar la demostración ni escribir nada', async () => {
    const { db, campanaId, it1 } = await preparar();
    montar(`/espacios/ensayo/campo/${campanaId}/${it1}`);
    await screen.findByRole('button', { name: /Calle del Olmo/ }, { timeout: 20000 });
    const filas = [...document.querySelectorAll('.m-calles > li')].map((li) => li.textContent);
    expect(filas[0]).toMatch(/^1Calle Real/);
    expect(filas[1]).toMatch(/^2Calle del Olmo.*solo pares · 1 de 2 tramos/);
    // Planificada no es censada; sin sincronización simulada
    expect(screen.getAllByText(/Pendiente/).length).toBeGreaterThan(0);
    expect(screen.getByText(/planificada no es censada/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Solo lectura · sin sincronización');
    expect(screen.queryByText(/Sin conexión \(simulado\)|Conectado|sin sincronizar/)).toBeNull();
    // Nunca se ha leído la demostración y la base del ensayo no cambia
    expect(useStore.getState().db).toBeNull();
    expect(await get<BaseDatos>('db', tienda())).toEqual(db);
  });

  it('consulta una calle (locales y observaciones de la campaña) sin acciones de registro y vuelve al ensayo', async () => {
    const { db, campanaId, it1, olmo } = await preparar();
    montar(`/espacios/ensayo/campo/${campanaId}/${it1}`);
    fireEvent.click(await screen.findByRole('button', { name: /Calle del Olmo/ }, { timeout: 20000 }));
    await screen.findByRole('heading', { name: 'Calle del Olmo' });
    expect(screen.getByTestId('ruta')).toHaveTextContent(`/espacios/ensayo/campo/${campanaId}/${it1}/calle/${olmo.id}`);
    expect(screen.getByText('Solo acera par')).toBeInTheDocument();
    expect(screen.getByText('1 de 2 tramos')).toBeInTheDocument();
    const nObs = Object.values(db.observaciones).filter((o) => o.campanaId === campanaId && o.calleId === olmo.id).length;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Registrado ${nObs}`) }));
    expect(screen.getByText('FERRETERÍA SINTÉTICA')).toBeInTheDocument();
    for (const n of ['Local nuevo', 'Finalizar calle', 'Sin cambios', 'Registrar cambios']) expect(screen.queryByRole('button', { name: new RegExp(n) })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent(/Solo lectura/);
    // Calle siguiente/anterior dentro del itinerario y regreso
    fireEvent.click(screen.getByRole('button', { name: 'Calle anterior' }));
    await screen.findByRole('heading', { name: 'Calle Real' });
    fireEvent.click(screen.getByRole('button', { name: 'Volver al itinerario' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Volver al espacio de ensayo' }));
    await screen.findByRole('navigation', { name: 'Accesos' }, { timeout: 20000 });
    expect(screen.getByTestId('ruta')).toHaveTextContent(/^\/espacios\/ensayo$/);
    expect(useStore.getState().db).toBeNull();
  });

  it('rechaza rutas inválidas: otra campaña, campaña histórica, itinerario inexistente, calle no planificada y dirección mal formada', async () => {
    const { campanaId, it1, it2, historica, real } = await preparar();
    const rechazada = async (ruta: string) => {
      cleanup();
      montar(ruta);
      expect(await screen.findByRole('alert', {}, { timeout: 20000 })).toHaveTextContent(/No se encuentra|no encontrad|no válida/i);
    };
    await rechazada(`/espacios/ensayo/campo/${historica}/${it1}`);
    await rechazada(`/espacios/ensayo/campo/${campanaId}/no-existe`);
    await rechazada(`/espacios/ensayo/campo/no-existe/${it1}`);
    await rechazada(`/espacios/ensayo/campo/${campanaId}`);
    await rechazada(`/espacios/ensayo/campo/${campanaId}/${it1}/otra/cosa`);
    // IT2 no tiene la Calle Real planificada
    await rechazada(`/espacios/ensayo/campo/${campanaId}/${it2}/calle/${real.id}`);
    // Un itinerario de la demostración no existe en el ensayo
    await rechazada(`/espacios/ensayo/campo/${C26_SINT}/it-demo`);
    expect(useStore.getState().db).toBeNull();
  });

  it('la demostración conserva Campo con sus datos y su sincronización simulada', () => {
    const esc = escenarioOficina({ calles: 2, localesPorCalle: 3 });
    useStore.setState({ db: esc.db, carga: { fase: 'lista', mensaje: '' }, prefs: { ...useStore.getState().prefs, municipioId: MUN_SINT, campanaId: C26_SINT, campoPersonaId: 'p-ana' } });
    const it = Object.values(esc.db.itinerarios)[0];
    render(<MemoryRouter initialEntries={[`/campo/it/${it.id}`]}><Routes><Route path="/campo/*" element={<CampoApp />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('heading', { name: it.nombre })).toBeInTheDocument();
    expect(screen.getByText(/Conectado/)).toBeInTheDocument();
    expect(screen.queryByText(/Solo lectura/)).toBeNull();
    expect(useEspacios.getState().db).toBeNull();
  });
});
