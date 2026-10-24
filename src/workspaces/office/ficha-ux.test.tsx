import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useStore } from '../../store/store';
import { C26_SINT, MUN_SINT, escenarioOficina } from '../../data/escenarioOficina';
import { kNC } from '../../domain/db';
import OficinaPage from './OficinaPage';

let esc: ReturnType<typeof escenarioOficina>;
const db = () => useStore.getState().db!;
const panel = () => screen.getByRole('complementary', { name: 'Revisión del registro' });
const titulo = () => panel().querySelector('.ofp-titulo')!.textContent;

beforeEach(() => {
  esc = escenarioOficina({ calles: 4, localesPorCalle: 12 });
  useStore.setState({
    db: esc.db,
    carga: { fase: 'lista', mensaje: '' },
    pilaDeshacer: [],
    pilaRehacer: [],
    prefs: { ...useStore.getState().prefs, municipioId: MUN_SINT, campanaId: C26_SINT, personaId: 'p-marta', oficina: {} },
  });
});

function abrirFicha(tarea = 'digital') {
  render(
    <MemoryRouter initialEntries={[`/oficina/it/${esc.itinerarios[0]}?tarea=${tarea}&filtro=todos`]}>
      <Routes><Route path="/oficina/*" element={<OficinaPage />} /></Routes>
    </MemoryRouter>,
  );
  const grid = screen.getByRole('grid', { name: 'Tabla de revisión' });
  act(() => grid.focus());
  fireEvent.keyDown(grid, { key: 'ArrowDown' });
  fireEvent.keyDown(grid, { key: 'Enter', ctrlKey: true });
  return grid;
}

describe('Ficha de establecimiento · lateral compacta y ampliada', () => {
  it('la ficha lateral es compacta: indicadores en línea, pestañas y acciones visibles', () => {
    abrirFicha();
    const p = panel();
    // Indicadores compactos (no tarjetas) con su estado accesible
    expect(within(p).getByRole('group', { name: 'Estados del registro' })).toBeInTheDocument();
    expect(within(p).getByLabelText('Campo: terminado')).toBeInTheDocument();
    expect(p.querySelector('.of-estados4')).toBeNull();
    for (const t of ['Ficha', 'Digital', 'Histórico', /Conciliación/]) expect(within(p).getByRole('tab', { name: t })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: /Ampliar ficha/ })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: 'Establecimiento siguiente' })).toBeInTheDocument();
    expect(within(p).getByRole('button', { name: /Siguiente pendiente/ })).toBeInTheDocument();
  });

  it('«Ampliar ficha» ocupa el área central y «Reducir» vuelve a la tabla sin perder la pestaña', () => {
    abrirFicha();
    expect(within(panel()).getByRole('tab', { name: 'Digital' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(panel()).getByRole('button', { name: /Ampliar ficha/ }));
    expect(panel()).toHaveClass('ofp-ampliada');
    expect(document.querySelector('.ofi-espacio')).toHaveClass('ficha-ampliada');
    expect(document.querySelector('.ofi-tabla-zona')).toHaveAttribute('hidden');
    expect(within(panel()).getByRole('tab', { name: 'Digital' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(panel()).getByRole('button', { name: /Reducir ficha/ }));
    expect(panel()).not.toHaveClass('ofp-ampliada');
    expect(document.querySelector('.ofi-tabla-zona')).not.toHaveAttribute('hidden');
    expect(within(panel()).getByRole('tab', { name: 'Digital' })).toHaveAttribute('aria-selected', 'true');
    // Esc (fuera de un campo) también reduce
    fireEvent.click(within(panel()).getByRole('button', { name: /Ampliar ficha/ }));
    fireEvent.keyDown(within(panel()).getByRole('tab', { name: 'Digital' }), { key: 'Escape' });
    expect(panel()).not.toHaveClass('ofp-ampliada');
  });

  it('Presencia digital: dos grupos con todos los campos del procedimiento 2026', () => {
    abrirFicha();
    fireEvent.click(within(panel()).getByRole('button', { name: /Ampliar ficha/ }));
    const web = screen.getByRole('region', { name: 'Web y Google' });
    const redes = screen.getByRole('region', { name: 'Redes sociales' });
    for (const c of ['Página web', 'Venta por internet', 'Google Business Profile', 'Nº de reseñas', 'Responde reseñas']) expect(within(web).getByRole('group', { name: c })).toBeInTheDocument();
    for (const c of ['Instagram', 'Seguidores Instagram', 'Facebook', 'Seguidores Facebook', 'Twitter / X', 'Seguidores Twitter / X']) expect(within(redes).getByRole('group', { name: c })).toBeInTheDocument();
    expect(within(redes).getByText('Nº redes')).toBeInTheDocument();
    // Nº redes = Instagram + Facebook + Twitter
    fireEvent.click(within(redes).getByRole('button', { name: 'Instagram: Sí' }));
    fireEvent.click(within(redes).getByRole('button', { name: 'Facebook: No' }));
    fireEvent.click(within(redes).getByRole('button', { name: 'Twitter / X: Sí' }));
    expect(within(redes).getByText('2')).toBeInTheDocument();
    // «Sin información» en una red no se cuenta como «No»: no hay total definitivo
    fireEvent.click(within(redes).getByRole('button', { name: 'Twitter / X: ¿?' }));
    expect(within(redes).getByLabelText('Nº redes sin determinar')).toBeInTheDocument();
    // Los campos adicionales se marcan como opcionales
    expect(within(web).getByRole('group', { name: 'Valoración media' }).parentElement).toHaveTextContent('opcional');
    expect(within(redes).getByText('Otras redes').parentElement).toHaveTextContent('opcional');
  });

  it('«Verificar presencia digital» nombra el establecimiento y es distinta de «Aprobar registro»', () => {
    abrirFicha();
    const nombre = titulo()!;
    const verificar = within(panel()).getByRole('button', { name: `Verificar presencia digital de ${nombre}` });
    const aprobar = within(panel()).getByRole('button', { name: `Aprobar registro (revisión general) de ${nombre}` });
    expect(verificar).toHaveTextContent(nombre);
    expect(verificar).not.toBe(aprobar);
    expect(aprobar.closest('footer')).not.toBeNull(); // la aprobación vive en el pie fijo
    expect(verificar.closest('footer')).toBeNull();
    // También en la barra de la tabla
    expect(screen.getAllByRole('button', { name: `Verificar presencia digital de ${nombre}` }).length).toBe(2);
  });

  it('tras verificar, la ficha sigue en el mismo establecimiento aunque salga del filtro «Pendientes»', async () => {
    render(
      <MemoryRouter initialEntries={[`/oficina/it/${esc.itinerarios[0]}?tarea=digital&filtro=pendientes`]}>
        <Routes><Route path="/oficina/*" element={<OficinaPage />} /></Routes>
      </MemoryRouter>,
    );
    const grid = screen.getByRole('grid', { name: 'Tabla de revisión' });
    act(() => grid.focus());
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter', ctrlKey: true });
    const nombre = titulo()!;
    for (const v of ['Página web', 'Venta por internet', 'Google Business Profile', 'Instagram', 'Facebook', 'Twitter / X']) {
      fireEvent.click(within(panel()).getByRole('button', { name: `${v}: No` }));
    }
    fireEvent.click(within(panel()).getByRole('button', { name: `Verificar presencia digital de ${nombre}` }));
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(titulo()).toBe(nombre);
    expect(within(panel()).getByText(/Verificada/)).toBeInTheDocument();
    expect(panel().querySelector('.ofp-pos')!.textContent).toBe('fuera del filtro');
  });

  it('pasa al siguiente y al siguiente pendiente sin cerrar la ficha (también con Alt+↓)', () => {
    abrirFicha('categorizacion');
    const primero = titulo();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Establecimiento siguiente' }));
    const segundo = titulo();
    expect(segundo).not.toBe(primero);
    fireEvent.keyDown(panel(), { key: 'ArrowDown', altKey: true });
    expect(titulo()).not.toBe(segundo);
    fireEvent.click(within(panel()).getByRole('button', { name: /Siguiente pendiente/ }));
    expect(panel()).toBeInTheDocument();
    expect(panel().querySelector('.ofp-pos')!.textContent).toMatch(/^\d+ \/ \d+$/);
  });

  it('no se pierde lo tecleado al cambiar de ficha o al ampliar', () => {
    abrirFicha('categorizacion');
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Ficha' }));
    const negocioId = Object.values(db().negocios).find((n) => n.nombre === titulo())!.id;
    fireEvent.change(within(panel()).getByLabelText('Nombre comercial'), { target: { value: 'Nombre sin confirmar' } });
    fireEvent.click(within(panel()).getByRole('button', { name: /Ampliar ficha/ }));
    expect(within(panel()).getByLabelText('Nombre comercial')).toHaveValue('Nombre sin confirmar');
    // Cambiar de establecimiento sin pulsar Enter ni salir del campo: se guarda
    fireEvent.click(within(panel()).getByRole('button', { name: 'Establecimiento siguiente' }));
    expect(db().negocios[negocioId].nombre).toBe('Nombre sin confirmar');
    // Lo mismo con un valor numérico de presencia digital
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Digital' }));
    const neg2 = Object.values(db().negocios).find((n) => n.nombre === titulo())!.id;
    fireEvent.click(screen.getByRole('button', { name: 'Google Business Profile: Sí' }));
    fireEvent.change(screen.getByLabelText('Nº de reseñas (valor)'), { target: { value: '37' } });
    fireEvent.click(within(panel()).getByRole('button', { name: /Reducir ficha/ }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Establecimiento siguiente' }));
    expect(db().digital[kNC(neg2, C26_SINT)].datos.numResenas).toMatchObject({ respuesta: 'si', valor: 37 });
    // «1.250» en la ficha son mil doscientos cincuenta (como en la tabla), no 1,25
    fireEvent.click(within(panel()).getByRole('button', { name: 'Establecimiento anterior' }));
    fireEvent.change(screen.getByLabelText('Nº de reseñas (valor)'), { target: { value: '1.250' } });
    fireEvent.keyDown(screen.getByLabelText('Nº de reseñas (valor)'), { key: 'Enter' });
    expect(db().digital[kNC(neg2, C26_SINT)].datos.numResenas).toMatchObject({ respuesta: 'si', valor: 1250 });
  });

  it('en el modo por establecimientos la ficha usa la misma navegación compacta', () => {
    abrirFicha('categorizacion');
    fireEvent.click(screen.getByText('Por establecimientos'));
    fireEvent.click(document.querySelector('.ofi-lista-item')!);
    const p = panel();
    expect(within(p).getByRole('button', { name: /Siguiente pendiente/ })).toBeInTheDocument();
    expect(within(p).queryByRole('button', { name: /Ampliar ficha/ })).toBeNull(); // ya ocupa el área central
    expect(within(p).getByRole('button', { name: /Aprobar registro/ })).toBeInTheDocument();
  });
});
