import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import { baseVacia } from '../../domain/db';
import { ID_CATALOGO_2026 } from '../../domain/catalogo2026';
import { OPCIONES_CATEGORIAS_2026 } from '../../domain/revisionCategoriaIT1';
import { sugerirPorNombre } from '../../domain/buscador';
import { BuscadorClasificacion } from './BuscadorClasificacion';

const carniceria = OPCIONES_CATEGORIAS_2026.find((o) => o.etiqueta.includes('Carnicería'))!.id;

function montar(props: Partial<Parameters<typeof BuscadorClasificacion>[0]> = {}) {
  const onElegir = vi.fn();
  render(<FuenteOficinaContext.Provider value={{ db: baseVacia(), campanaId: 'c26',
    personaId: 'p', roles: ['coordinador'], soloLectura: true, aplicar: () => false }}>
    <BuscadorClasificacion catalogo={ID_CATALOGO_2026} onElegir={onElegir} {...props}/>
  </FuenteOficinaContext.Provider>);
  return onElegir;
}

describe('BuscadorClasificacion · propuestas y frecuentes', () => {
  it('sin la opción, una propuesta por el nombre no queda marcada ni se aplica', () => {
    const onElegir = montar({ nombreNegocio: 'Peluquería Sol' });
    expect(screen.getByRole('option', { name: /Peluquería/ })).toHaveAttribute('aria-selected', 'false');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onElegir).not.toHaveBeenCalled();
  });
  it('con marcarPropuestaUnica queda marcada y se aplica solo con Enter', () => {
    const onElegir = montar({ nombreNegocio: 'Peluquería Sol', marcarPropuestaUnica: true });
    expect(screen.getByRole('option', { name: /Peluquería/ })).toHaveAttribute('aria-selected', 'true');
    expect(onElegir).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onElegir).toHaveBeenCalledTimes(1);
    expect(onElegir.mock.calls[0][0].opcion.etiqueta).toMatch(/Peluquer/);
  });
  it('muestra las frecuentes con la búsqueda vacía, sin marcarlas', () => {
    const onElegir = montar({ nombreNegocio: 'Negocio ficticio', frecuentes: [carniceria], marcarPropuestaUnica: true });
    const op = screen.getByRole('option', { name: /Carnicería/ });
    expect(op).toHaveTextContent('frecuente');
    expect(op).toHaveAttribute('aria-selected', 'false');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onElegir).not.toHaveBeenCalled();
  });
  it('una propuesta equivalente a la categoría rechazada se señala, no se marca y solo se elige a mano', () => {
    const clave = sugerirPorNombre(ID_CATALOGO_2026, 'Peluquería Sol').sugerencias[0].clave;
    const onElegir = montar({ nombreNegocio: 'Peluquería Sol', marcarPropuestaUnica: true, rechazadas: [clave] });
    const op = screen.getByRole('option', { name: /Peluquería/ });
    expect(op).toHaveAttribute('aria-selected', 'false');
    expect(op).toHaveTextContent('rechazada en el Excel');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onElegir).not.toHaveBeenCalled();
    fireEvent.click(op);
    expect(onElegir).toHaveBeenCalledTimes(1);
  });
});
