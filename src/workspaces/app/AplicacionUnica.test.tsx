import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import { useFuenteOficina } from '../../store/fuenteOficina';

const servidor = vi.hoisted(() => ({
  sesion: true,
  denegar: false,
  logins: 0,
  lecturas: 0,
}));

vi.mock('../../store/clienteSupabase', () => {
  const cliente = { auth: {
    getSession: async () => ({ data: { session: servidor.sesion ? { user: { id: 'usuario-institucional' } } : null }, error: null }),
    signInWithPassword: async () => { servidor.logins++; servidor.sesion = true; return { error: null }; },
  }};
  return { clienteServidor: () => cliente };
});
vi.mock('../../store/almacenSupabase', () => ({
  AlmacenSupabase: class {
    async leer() {
      servidor.lecturas++;
      if (servidor.denegar) throw Error('Supabase deniega el acceso');
      const db = baseVacia();
      db.meta = { ...db.meta, espacio: 'real', espacioId: 'real-medina-del-campo-2026' };
      db.campanas = {
        'camp-real-2025': { id: 'camp-real-2025', municipioId: 'real-mun-medina', anio: 2025, nombre: 'Histórico real 2025' },
        'camp-real-2026': { id: 'camp-real-2026', municipioId: 'real-mun-medina', anio: 2026, nombre: 'Censo real 2026' },
      } as typeof db.campanas;
      return { db, info: { tipo: 'real', espacioId: 'real-medina-del-campo-2026', personaId: 'coordinacion', rol: 'administrador', version: 4 } };
    }
  },
}));
vi.mock('../../domain/espacios', () => ({
  verificarEspacio: () => [],
  personaEspacio: () => ({ id: 'coordinacion' }),
}));

import AplicacionUnica from './AplicacionUnica';

function PantallaAutentica() {
  const fuente = useFuenteOficina();
  return <div>
    <h1>Interfaz original completa</h1>
    <p>{fuente?.db.campanas['camp-real-2025']?.nombre}</p>
    <p>{fuente?.db.campanas['camp-real-2026']?.nombre}</p>
    <span>{fuente?.versionReal}</span>
    <span>{fuente?.soloLectura ? 'Sin escritura genérica' : 'Error de permisos'}</span>
    <button onClick={() => fuente?.elegirCampana?.('camp-real-2025')}>Elegir histórico</button>
    <p>Elegida: {fuente?.campanaId}</p>
  </div>;
}
const montar = () => render(<MemoryRouter initialEntries={['/campanas']}>
  <Routes><Route element={<AplicacionUnica />}><Route path="/campanas" element={<PantallaAutentica/>}/></Route></Routes>
</MemoryRouter>);

beforeEach(() => { servidor.sesion=true; servidor.denegar=false; servidor.logins=0; servidor.lecturas=0; });

describe('Una sola aplicación completa, nunca demo ni pantalla auxiliar', () => {
  it('muestra campañas auténticas en las rutas originales y permite elegir campaña en consulta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Histórico real 2025')).toBeInTheDocument());
    expect(screen.getByText('Censo real 2026')).toBeInTheDocument();
    expect(screen.getByText('Sin escritura genérica')).toBeInTheDocument();
    expect(screen.queryByText('Datos simulados')).toBeNull();
    expect(screen.getByText('Elegida: camp-real-2026')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Elegir histórico'));
    expect(screen.getByText('Elegida: camp-real-2025')).toBeInTheDocument();
    expect(servidor.lecturas).toBe(1);
  });
  it('requiere iniciar sesión sin redirigir al viejo espacio auxiliar', async () => {
    servidor.sesion=false;
    montar();
    await waitFor(() => expect(screen.getByRole('button',{name:'Entrar en ULIT Censo'})).toBeInTheDocument());
    expect(screen.queryByText('Interfaz original completa')).toBeNull();
    fireEvent.change(screen.getByLabelText('Correo de la cuenta autorizada'), { target: { value: 'persona@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave-test' } });
    fireEvent.click(screen.getByRole('button',{name:'Entrar en ULIT Censo'}));
    await waitFor(() => expect(screen.getByText('Histórico real 2025')).toBeInTheDocument());
    expect(servidor.logins).toBe(1);
  });
  it('si Supabase falla, nunca sustituye reales por datos ficticios', async () => {
    servidor.denegar=true;
    montar();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Supabase deniega el acceso'));
    expect(screen.queryByText('Histórico real 2025')).toBeNull();
    expect(screen.queryByText('Censo real 2026')).toBeNull();
  });
});
