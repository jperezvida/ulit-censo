import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { clear, createStore, get, set } from 'idb-keyval';
import { useEffect } from 'react';
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';
import { crearBaseEspacio, PREFIJO } from '../../domain/espacios';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from '../../domain/municipios';
import { crearItinerario } from '../../domain/campanaOperativa';
import { aplicarCarga } from '../../domain/callejeros';
import { leerOsmMunicipio } from '../../domain/fuentesCallejero';
import { osmVillaSintetica } from '../../data/callejeroSintetico';
import type { BaseDatos } from '../../domain/db';

const mapaFalso = vi.hoisted(() => ({ clic: null as null | ((e: unknown) => void), calleId: '', segId: 'seg-1' }));
vi.mock('maplibre-gl', async (importOriginal) => ({
  ...await importOriginal<typeof import('maplibre-gl')>(),
  Marker: class {
    setLngLat() { return this; }
    addTo() { return this; }
    remove() { return this; }
  },
}));
vi.mock('../../components/mapa/MapaBase', () => ({
  MapaBase: ({ onListo }: { onListo: (m: unknown) => void }) => {
    useEffect(() => {
      onListo({
        addSource: () => undefined, addLayer: () => undefined,
        getSource: () => ({ setData: () => undefined }),
        fitBounds: () => undefined,
        setLayoutProperty: () => undefined, setFilter: () => undefined,
        queryRenderedFeatures: () => [{ properties: { calleId: mapaFalso.calleId, segId: mapaFalso.segId } }],
        on: (evento: string, capa: string | ((e: unknown) => void)) => {
          if (evento === 'click' && typeof capa === 'function') mapaFalso.clic = capa;
        },
        getCanvas: () => ({ style: {} }),
      });
      // El mapa real instala las capas una vez, al cargar su estilo.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="mapa-reutilizado" />;
  },
}));

const tienda = () => createStore('ulit-censo-ensayo', 'datos');
beforeEach(async () => {
  await clear(tienda());
  localStorage.clear();
  useEspacios.getState().cerrar();
  mapaFalso.clic = null;
  mapaFalso.calleId = '';
  mapaFalso.segId = 'seg-1';
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function preparar() {
  let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Coordinadora Sintética', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'prueba-plan', incluirMedina: false });
  const opciones = { prefijo: PREFIJO.ensayo, porId: db.meta.espacioCreadoPorId!, anioActual: 2026 };
  const villa = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
  const m = altaMunicipio(db, { ...villa, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, opciones);
  db = m.db;
  const json = osmVillaSintetica(1);
  const lectura = leerOsmMunicipio(json, villa);
  if (!lectura.ok) throw new Error(lectura.motivo);
  db = aplicarCarga(db, m.municipioId, lectura, { archivo: 'villa.json', contenido: JSON.stringify(json), fuente: 'OpenStreetMap (Overpass API)' }, opciones).db;
  const c = crearCampana(db, { municipioId: m.municipioId, anio: 2026, nombre: 'Campaña sintética', clase: 'operativa', tipoOperativa: 'nuevo' }, opciones);
  db = c.db;
  const it = crearItinerario(db, c.campanaId, { codigo: 'IT1' }, opciones);
  db = it.db;
  const calle = Object.values(db.calles).find((x) => x.municipioId === m.municipioId && x.nombre.includes('Olmo') && x.segmentos.length > 1)!;
  await set('db', db, tienda());
  return { db, campanaId: c.campanaId, itinerarioId: it.itinerarioId, calle };
}

function montar(campanaId: string, itinerarioId: string) {
  return render(<MemoryRouter initialEntries={[`/espacios/ensayo/planificar/${campanaId}/${itinerarioId}`]}>
    <Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes>
  </MemoryRouter>);
}

describe('Mapa del itinerario de ensayo', () => {
  it('guarda una calle planificada sin tocar los demás datos y la recupera al reabrir', async () => {
    const { db, campanaId, itinerarioId, calle } = await preparar();
    montar(campanaId, itinerarioId);
    await screen.findByRole('region', { name: 'Planificación en mapa del ensayo' });
    expect(screen.getByTestId('mapa-reutilizado')).toBeInTheDocument();
    await waitFor(() => expect(mapaFalso.clic).toBeTypeOf('function'));
    mapaFalso.calleId = calle.id;
    act(() => mapaFalso.clic!({ point: { x: 10, y: 10 }, lngLat: { lng: 0, lat: 0 } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Asignar calle completa' }));
    await screen.findByText(/Guardado comprobado/);
    const guardada = (await get<BaseDatos>('db', tienda()))!;
    expect(guardada.itinerarios[itinerarioId].tramos).toMatchObject([{ calleId: calle.id, acera: 'ambas' }]);
    expect(guardada.locales).toEqual(db.locales);
    expect(guardada.observaciones).toEqual(db.observaciones);
    expect(guardada.importaciones).toEqual(db.importaciones);
    useEspacios.getState().cerrar();
    await useEspacios.getState().abrir('ensayo');
    expect(useEspacios.getState().db?.itinerarios[itinerarioId].tramos[0].calleId).toBe(calle.id);
  });

  it('rechaza un guardado si otra pestaña cambió la base', async () => {
    const { db, campanaId, itinerarioId, calle } = await preparar();
    montar(campanaId, itinerarioId);
    await screen.findByRole('region', { name: 'Planificación en mapa del ensayo' });
    await waitFor(() => expect(mapaFalso.clic).toBeTypeOf('function'));
    mapaFalso.calleId = calle.id;
    act(() => mapaFalso.clic!({ point: { x: 10, y: 10 }, lngLat: { lng: 0, lat: 0 } }));
    await screen.findByRole('button', { name: 'Asignar calle completa' });
    const externa = { ...db, itinerarios: { ...db.itinerarios, [itinerarioId]: { ...db.itinerarios[itinerarioId], notas: 'Cambio en otra pestaña' } } };
    await set('db', externa, tienda());
    fireEvent.click(screen.getByRole('button', { name: 'Asignar calle completa' }));
    await screen.findByRole('alert');
    expect((await get<BaseDatos>('db', tienda()))!.itinerarios[itinerarioId]).toEqual(externa.itinerarios[itinerarioId]);
  });

  it('guarda acera y división de segmentos en el planificador original', async () => {
    const { campanaId, itinerarioId, calle } = await preparar();
    montar(campanaId, itinerarioId);
    await waitFor(() => expect(mapaFalso.clic).toBeTypeOf('function'));
    mapaFalso.calleId = calle.id;
    act(() => mapaFalso.clic!({ point: { x: 10, y: 10 }, lngLat: { lng: 0, lat: 0 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Asignar calle completa' }));
    await screen.findByText(/Guardado comprobado/);
    fireEvent.click(screen.getByText('Avanzado: aceras y división de la calle'));
    const avanzado = screen.getByText('Avanzado: aceras y división de la calle').closest('details')!;
    fireEvent.change(within(avanzado).getByRole('combobox'), { target: { value: 'par' } });
    await waitFor(async () => expect((await get<BaseDatos>('db', tienda()))!.itinerarios[itinerarioId].tramos[0].acera).toBe('par'));
    fireEvent.click(screen.getByRole('button', { name: 'Dividir por segmentos' }));
    mapaFalso.segId = calle.segmentos[0].id;
    act(() => mapaFalso.clic!({ point: { x: 10, y: 10 }, lngLat: { lng: 0, lat: 0 } }));
    await waitFor(async () => expect((await get<BaseDatos>('db', tienda()))!.itinerarios[itinerarioId].tramos[0].segmentoIds).toEqual(calle.segmentos.slice(1).map((s) => s.id)));
    fireEvent.click(screen.getByRole('button', { name: 'Volver a calle completa' }));
    await waitFor(async () => expect((await get<BaseDatos>('db', tienda()))!.itinerarios[itinerarioId].tramos[0].segmentoIds).toBeUndefined());
  });

  it('guarda la etiqueta de una calle del ensayo y la recupera al reabrir', async () => {
    const { campanaId, itinerarioId, calle } = await preparar();
    montar(campanaId, itinerarioId);
    await waitFor(() => expect(mapaFalso.clic).toBeTypeOf('function'));
    mapaFalso.calleId = calle.id;
    act(() => mapaFalso.clic!({ point: { x: 10, y: 10 }, lngLat: { lng: 0, lat: 0 } }));
    fireEvent.click(screen.getByRole('button', { name: 'Asignar calle completa' }));
    await screen.findByText(/Guardado comprobado/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Etiqueta de planificación' }), { target: { value: ' Revisar portales pares ' } });
    // No debe guardarse hasta pulsar expresamente el botón.
    expect((await get<BaseDatos>('db', tienda()))!.itinerarios[itinerarioId].tramos[0].etiqueta).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar etiqueta' }));
    await waitFor(async () => expect((await get<BaseDatos>('db', tienda()))!.itinerarios[itinerarioId].tramos[0].etiqueta).toBe('Revisar portales pares'));
    useEspacios.getState().cerrar();
    await useEspacios.getState().abrir('ensayo');
    expect(useEspacios.getState().db?.itinerarios[itinerarioId].tramos[0].etiqueta).toBe('Revisar portales pares');
  });

});
