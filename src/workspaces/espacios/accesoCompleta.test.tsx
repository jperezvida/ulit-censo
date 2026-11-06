import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  sesion: false,
  autorizado: true,
  inicios: 0,
  consultas: 0,
}));

vi.mock('../../store/clienteSupabase', () => {
  // En producción clienteServidor devuelve un cliente singleton: respetar
  // también esa identidad en la prueba para no repetir efectos artificialmente.
  const cliente = {
    auth: {
      getSession: async () => ({ data: { session: auth.sesion ? { user: { email: 'responsable@example.invalid' } } : null } }),
      signInWithPassword: async ({ email }: { email: string }) => {
        auth.sesion = true;
        auth.inicios++;
        return { data: { user: { email } }, error: null };
      },
    },
  };
  return { clienteServidor: () => cliente };
});
vi.mock('../../store/almacenSupabase', () => ({
  misEspacios: async () => {
    auth.consultas++;
    return auth.autorizado
      ? [{ espacio_id: 'real-medina-del-campo-2026', nombre: 'Medina del Campo', tipo: 'real', rol: 'administrador', version: 3, escritura_habilitada: false }]
      : [];
  },
  AlmacenSupabase: class {},
}));

import { AccesoServidor } from './AccesoServidor';

function montar(origen = '') {
  return render(
    <MemoryRouter initialEntries={[`/espacios${origen}`]}>
      <Routes>
        <Route path="/espacios" element={<AccesoServidor />} />
        <Route path="/real/campanas" element={<h1>Aplicación completa con datos auténticos</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.sesion = false;
  auth.autorizado = true;
  auth.inicios = 0;
  auth.consultas = 0;
});

describe('Retorno a la aplicación COMPLETA tras iniciar sesión', () => {
  it('tras entrar desde la interfaz completa vuelve automáticamente y solo cuando hay membresía real', async () => {
    montar('?volver=real');
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'responsable@example.invalid' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave-de-prueba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Aplicación completa con datos auténticos' })).toBeInTheDocument());
    expect(auth.inicios).toBe(1);
    expect(auth.consultas).toBeGreaterThan(0);
  });

  it('con sesión existente regresa sin pedir contraseña', async () => {
    auth.sesion = true;
    montar('?volver=real');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Aplicación completa con datos auténticos' })).toBeInTheDocument());
    expect(auth.inicios).toBe(0);
  });

  it('al abrir el auxiliar directamente NO sale de él, pero ofrece ir a la completa', async () => {
    auth.sesion = true;
    montar();
    const enlace = await screen.findByRole('link', { name: 'Abrir la aplicación completa con datos reales' });
    expect(enlace).toHaveAttribute('href', '/real/campanas');
    expect(screen.queryByRole('heading', { name: 'Aplicación completa con datos auténticos' })).toBeNull();
  });

  it('sin autorización para Medina no redirige aunque se pida el retorno', async () => {
    auth.sesion = true;
    auth.autorizado = false;
    montar('?volver=real');
    await waitFor(() => expect(screen.getByText(/no pertenece a ningún espacio/i)).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Aplicación completa con datos auténticos' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Abrir la aplicación completa con datos reales' })).toBeNull();
  });

  it('no acepta destinos arbitrarios desde el parámetro volver', async () => {
    auth.sesion = true;
    montar('?volver=https://ejemplo.invalid');
    await screen.findByRole('link', { name: 'Abrir la aplicación completa con datos reales' });
    expect(screen.queryByRole('heading', { name: 'Aplicación completa con datos auténticos' })).toBeNull();
  });
});
