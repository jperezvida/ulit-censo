import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { clear as idbClear, createStore, set as idbSet } from 'idb-keyval';
import { crearBaseEspacio } from '../../domain/espacios';
import { diferencia } from '../../store/almacenSupabase';
import { borrarSeleccionRemota, guardarSeleccionRemota, leerSeleccionRemota } from '../../store/seleccionRemota';

/** Recarga (F5) de una dirección de espacio abierta desde el SERVIDOR: nunca debe abrirse IndexedDB en su lugar. */
const servidor = vi.hoisted(() => ({ sesion: null as unknown, entidades: {} as Record<string, Record<string, unknown>>, llamadas: [] as string[] }));
vi.mock('../../store/clienteSupabase', () => ({
  configServidor: () => ({ url: 'http://servidor.invalid', clave: 'sb_publishable_x', origen: 'http://servidor.invalid' }),
  clienteServidor: () => ({
    auth: { getSession: async () => ({ data: { session: servidor.sesion } }), signOut: async () => ({}) },
    rpc: async (fn: string) => {
      servidor.llamadas.push(fn);
      if (fn === 'ulit_censo_leer') return { data: { espacioId: 'ensayo-remoto', tipo: 'ensayo', version: 3, escrituraHabilitada: true, rol: 'administrador', personaId: 'ensayo-p-persona-del-servidor', entidades: servidor.entidades }, error: null };
      if (fn === 'ulit_censo_mis_espacios') return { data: [], error: null };
      return { data: null, error: { message: 'no previsto' } };
    },
  }),
}));
import EspaciosApp from './EspaciosApp';
import { useEspacios } from '../../store/espacios';

const montar = () => render(<MemoryRouter initialEntries={['/espacios/ensayo']}><Routes><Route path="/espacios/*" element={<EspaciosApp />} /></Routes></MemoryRouter>);
const base = (nombre: string, espacioId: string) => crearBaseEspacio('ensayo', { persona: { nombre, roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId, incluirMedina: false });

beforeAll(() => { if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); });
beforeEach(async () => {
  await idbClear(createStore('ulit-censo-ensayo', 'datos'));
  // En este navegador hay OTRO espacio de ensayo (IndexedDB) con otra persona responsable.
  await idbSet('db', base('Persona del navegador', 'local'), createStore('ulit-censo-ensayo', 'datos'));
  const remota = base('Persona del servidor', 'remoto');
  servidor.entidades = {};
  for (const x of diferencia(null, remota)) (servidor.entidades[x.c] ??= {})[x.id] = x.v;
  servidor.llamadas = [];
  useEspacios.getState().cerrar();
  borrarSeleccionRemota();
});

describe('Recarga de un espacio del servidor', () => {
  it('con sesión: al recargar se vuelve a abrir el espacio del servidor, no el de IndexedDB', async () => {
    servidor.sesion = { user: { email: 'coord@ejemplo.invalid' } };
    guardarSeleccionRemota({ espacioId: 'ensayo-remoto', tipo: 'ensayo' });
    montar();
    await waitFor(() => expect(useEspacios.getState().fase).toBe('listo'));
    expect(useEspacios.getState().remoto?.espacioId).toBe('ensayo-remoto');
    expect(Object.values(useEspacios.getState().db!.personas).map((p) => p.nombre)).toEqual(['Persona del servidor']);
    expect(screen.getByLabelText('Dónde se guarda')).toHaveTextContent('Servidor · ensayo-remoto');
    expect(servidor.llamadas).toContain('ulit_censo_leer');
  });

  it('sin sesión: error claro y NO se abre el espacio de IndexedDB', async () => {
    servidor.sesion = null;
    guardarSeleccionRemota({ espacioId: 'ensayo-remoto', tipo: 'ensayo' });
    montar();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/La sesión del servidor ha terminado.*No se ha abierto el espacio guardado en este navegador/));
    expect(useEspacios.getState()).toMatchObject({ db: null, remoto: null, fase: 'error' });
    expect(servidor.llamadas).toEqual([]);
  });

  it('sin selección remota (o tras elegir el espacio local): se abre IndexedDB como siempre', async () => {
    montar();
    await waitFor(() => expect(useEspacios.getState().fase).toBe('listo'));
    expect(useEspacios.getState().remoto).toBeNull();
    expect(Object.values(useEspacios.getState().db!.personas).map((p) => p.nombre)).toEqual(['Persona del navegador']);
    expect(screen.getByLabelText('Dónde se guarda')).toHaveTextContent('Este navegador (IndexedDB)');
    expect(leerSeleccionRemota()).toBeNull();
  });
});
