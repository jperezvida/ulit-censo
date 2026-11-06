import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import { diferencia } from '../../store/almacenSupabase';
import { useStore } from '../../store/store';

const servidor = vi.hoisted(() => ({
  sesion: true,
  llamadas: [] as string[],
  entidades: {} as Record<string, Record<string, unknown>>,
  denegar: false,
}));

vi.mock('../../store/clienteSupabase', () => ({
  clienteServidor: () => ({
    auth: { getSession: async () => ({ data: { session: servidor.sesion ? { user: { email: 'coord@example.invalid' } } : null }, error: null }) },
    rpc: async (fn: string) => {
      servidor.llamadas.push(fn);
      if (servidor.denegar) return { data: null, error: { message: 'Sin autorización' } };
      if (fn === 'ulit_censo_leer') return { data: {
        espacioId: 'real-medina-del-campo-2026', tipo: 'real', version: 3,
        escrituraHabilitada: false, preparacionHabilitada: false,
        rol: 'administrador', personaId: 'real-p-coordinacion', entidades: servidor.entidades,
      }, error: null };
      return { data: null, error: { message: 'RPC no admitida' } };
    },
  }),
}));

import RealApp from './RealApp';

function fixture() {
  const db = baseVacia();
  db.meta = { espacio: 'real', espacioId: 'real-medina-del-campo-2026', espacioCreadoPorId: 'real-p-coordinacion' };
  db.personas = { 'real-p-coordinacion': { id: 'real-p-coordinacion', nombre: 'Coordinación real', iniciales: 'CR', roles: ['administrador'], color: '#8a1c1c' } };
  db.municipios = { 'real-mun-medina': { id: 'real-mun-medina', nombre: 'Medina del Campo', provincia: 'Valladolid', centro: [-4.9,41.3], fuenteCallejero: 'osm' } };
  const hist = 'camp-hist-real-mun-medina-2025-abc';
  const op = 'real-camp-medina-2026';
  const estados = { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' } as const;
  db.campanas = {
    [hist]: { id:hist, municipioId:'real-mun-medina', anio:2025, nombre:'Censo histórico Medina del Campo 2025', tipo:'historico-importado', periodo:{inicio:'2024-01-01',fin:'2025-12-31'}, ambitoCalleIds:[], ampliacionCalleIds:[], estados:{...estados, planificacion:'no-aplica',campo:'terminado'}, procedencia:'importado' },
    [op]: { id:op, municipioId:'real-mun-medina', anio:2026, nombre:'Censo Medina del Campo 2026', tipo:'actualizacion', periodo:{inicio:'2026-01-01'}, ambitoCalleIds:[], ampliacionCalleIds:[], estados, procedencia:'manual', campanaReferenciaId:hist },
  };
  const imp = 'imp-real-2025';
  db.importaciones = { [imp]: { id: imp, municipioId:'real-mun-medina', campanaId: hist, estado: 'confirmada' } } as unknown as typeof db.importaciones;
  db.registros = Object.fromEntries(Array.from({ length:889 },(_,i)=>['reg-real-'+i,{ id:'reg-real-'+i, importacionId:imp, fila:i+2 }])) as typeof db.registros;
  db.locales = Object.fromEntries(Array.from({length:696},(_,i)=>['real-local-'+i,{id:'real-local-'+i, municipioId:'real-mun-medina', direcciones:[], estado:'activo', procedencia:'importado'}])) as typeof db.locales;
  return db;
}

const montar = () => render(<MemoryRouter initialEntries={['/real/campanas']}><Routes><Route path="/real/*" element={<RealApp />} /></Routes></MemoryRouter>);

beforeEach(() => {
  servidor.sesion = true;
  servidor.denegar = false;
  servidor.llamadas = [];
  servidor.entidades = {};
  for (const x of diferencia(null, fixture())) (servidor.entidades[x.c] ??= {})[x.id] = x.v;
  // Nunca usar la base de demostración como alternativa implícita a Supabase.
  useStore.setState({ db: null, carga: { fase:'inicio', mensaje:'' } });
});

describe('Interfaz COMPLETA con base real', () => {
  it('muestra las dos campañas auténticas y las 889 filas, sin controles de edición', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Censo histórico Medina del Campo 2025')).toBeInTheDocument());
    expect(screen.getAllByText('Censo Medina del Campo 2026').length).toBeGreaterThan(0);
    expect(screen.getByText(/889 filas reales/)).toBeInTheDocument();
    expect(screen.getByText(/Datos reales · consulta/i)).toBeInTheDocument();
    expect(screen.queryByText('Datos simulados')).toBeNull();
    expect(screen.queryByText('Demo de volumen')).toBeNull();
    expect(screen.getAllByText('Datos reales').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button',{name:'Nueva campaña'})).toBeNull();
    expect(screen.queryByRole('link',{name:'Oficina'})).toBeNull();
    expect(screen.getByText(/versión 3/)).toBeInTheDocument();
    expect(servidor.llamadas).toEqual(['ulit_censo_leer']);
    fireEvent.click(screen.getAllByRole('button', { name: /Seleccionar campaña real/ })[0]);
    expect(servidor.llamadas).toEqual(['ulit_censo_leer']);
  });
  it('la aplicación COMPLETA abre Datos de IT1 real sin ofrecer escrituras en Supabase', async () => {
    montar();
    await waitFor(() => expect(screen.getAllByText('Censo Medina del Campo 2026').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('link', { name: 'Datos' })[0]);
    expect(screen.getByRole('heading', { name: /Incorporación de Excel · IT1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analizar IT1 sin guardar' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Incorporar al espacio|Guardar IT1/i })).toBeNull();
    expect(servidor.llamadas).toEqual(['ulit_censo_leer']);
  });
  it('sin sesión rechaza la carga y nunca abre una demostración', async () => {
    servidor.sesion = false;
    montar();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No hay una sesión autorizada/));
    expect(screen.queryByText('Censo histórico Medina del Campo 2025')).toBeNull();
    expect(servidor.llamadas).toHaveLength(0);
  });
  it('si Supabase rechaza la lectura falla cerrado, sin datos ficticios', async () => {
    servidor.denegar = true;
    montar();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Sin autorización/));
    expect(screen.queryByText('Censo histórico Medina del Campo 2025')).toBeNull();
    expect(servidor.llamadas).toEqual(['ulit_censo_leer']);
  });
});
