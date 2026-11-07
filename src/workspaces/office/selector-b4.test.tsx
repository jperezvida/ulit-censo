import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useStore } from '../../store/store';
import { C25_SINT, C26_SINT, MUN_SINT, escenarioOficina } from '../../data/escenarioOficina';
import { kNC, kRev } from '../../domain/db';
import { NODOS_2026, rutaActividad } from '../../domain/taxonomy';
import { clasificar } from '../../domain/clasificacion';
import OficinaPage from './OficinaPage';

let esc: ReturnType<typeof escenarioOficina>;
const db = () => useStore.getState().db!;
const nodo = (...ruta: string[]) => NODOS_2026.find((n) => rutaActividad(n.id).map((x) => x.nombre).join('|') === ruta.join('|'))!.id;
const tecla = (el: Element, key: string, o: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(el, { key, ...o });
const editor = () => document.querySelector('input.tab-editor') as HTMLInputElement;
const escribir = (txt: string) => fireEvent.change(editor(), { target: { value: txt } });
const opciones = () => within(screen.getByRole('listbox', { name: 'Clasificaciones' })).queryAllByRole('option');
const filas = () => [...document.querySelectorAll('[role="row"][aria-rowindex]')].map((r) => r.querySelector('[role="gridcell"]')!.id.split('-').slice(1, -1).join('-'));
const neg = (localId: string) => esc.db.ocupaciones[`ocu-${localId}`].negocioId!;
const cla = (localId: string) => db().clasificaciones[kNC(neg(localId), C26_SINT)];

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

/** Monta la tabla de categorización y deja el foco en la columna «Actividad» de la primera fila. */
function montar() {
  render(
    <MemoryRouter initialEntries={[`/oficina/it/${esc.itinerarios[0]}?tarea=categorizacion&filtro=todos`]}>
      <Routes><Route path="/oficina/*" element={<OficinaPage />} /></Routes>
    </MemoryRouter>,
  );
  const grid = screen.getByRole('grid', { name: 'Tabla de revisión' });
  act(() => grid.focus());
  tecla(grid, 'ArrowDown');
  for (let k = 0; k < 3; k++) tecla(grid, 'ArrowRight');
  return grid;
}

/** Cambia el nombre de un negocio para probar las propuestas por el nombre. */
function renombrar(negocioId: string, nombre: string) {
  const d = structuredClone(db());
  d.negocios[negocioId].nombre = nombre;
  act(() => useStore.setState({ db: d }));
}

describe('B4 · selector de actividades en la tabla (solo teclado)', () => {
  it('la propuesta por el nombre se muestra pero no se aplica sola; ↓ + Enter la elige y rellena los niveles', () => {
    const grid = montar();
    const id0 = filas()[0];
    renombrar(neg(id0), 'Estanco nº 9');
    tecla(grid, 'Enter');
    const [op] = opciones();
    expect(op).toHaveTextContent(/Estancos/);
    expect(op).toHaveTextContent(/propuesta/);
    expect(op).toHaveTextContent('Comercio › Otros equipamientos › Estancos › Estancos');
    expect(op).toHaveAttribute('aria-selected', 'false');
    // Enter sin elegir no aplica nada
    tecla(editor(), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent(/Elige una opción/);
    expect(cla(id0)).toBeUndefined();
    tecla(editor(), 'ArrowDown');
    tecla(editor(), 'Enter');
    expect(cla(id0)).toMatchObject({ actividadId: nodo('Comercio', 'Otros equipamientos', 'Estancos', 'Estancos'), confirmada: true });
    expect(db().revisiones[kRev(C26_SINT, id0)].categorizacion).toBe('revisado');
    expect(document.getElementById(`cel-${id0}-grupo`)).toHaveTextContent('Comercio');
    expect(document.getElementById(`cel-${id0}-grupoComercio`)).toHaveTextContent('Otros equipamientos');
    expect(document.getElementById(`cel-${id0}-subgrupo`)).toHaveTextContent('Estancos');
  });

  it('texto parcial sin tildes: la mejor coincidencia queda marcada y Enter la elige', () => {
    const grid = montar();
    const id0 = filas()[0];
    tecla(grid, 'c');
    escribir('carniceria');
    expect(opciones()[0]).toHaveAttribute('aria-selected', 'true');
    expect(opciones()[0]).toHaveTextContent('Comercio › Alimentación › Carnes › Carnicería');
    tecla(editor(), 'Enter');
    expect(cla(id0).actividadId).toBe(nodo('Comercio', 'Alimentación', 'Carnes', 'Carnicería'));
  });

  it('un nombre ambiguo obliga a elegir: Enter sin selección avisa; ↓↓ + Enter elige la segunda ruta', () => {
    const grid = montar();
    const id0 = filas()[0];
    tecla(grid, 'o');
    escribir('otros');
    expect(screen.getByText(/Varias clasificaciones con ese nombre/)).toBeInTheDocument();
    expect(opciones().every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
    tecla(editor(), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent(/clasificaciones posibles/);
    expect(cla(id0)).toBeUndefined();
    const ruta = opciones()[1].querySelector('.bc-ruta')!.textContent!;
    tecla(editor(), 'ArrowDown');
    tecla(editor(), 'ArrowDown');
    tecla(editor(), 'Enter');
    expect(rutaActividad(cla(id0).actividadId).map((n) => n.nombre).join(' › ')).toBe(ruta.split(' · ')[0]);
  });

  it('subgrupo con actividades: pide una breve descripción y la guarda dentro del subgrupo', () => {
    const grid = montar();
    const id0 = filas()[0];
    tecla(grid, 'c');
    escribir('carnes');
    const i = opciones().findIndex((o) => /sin actividad · con descripción/.test(o.textContent!));
    expect(i).toBeGreaterThanOrEqual(0);
    for (let k = 0; k <= i; k++) tecla(editor(), 'ArrowDown');
    if (opciones()[i].getAttribute('aria-selected') !== 'true') tecla(editor(), 'ArrowUp');
    tecla(editor(), 'Enter');
    expect(editor()).toHaveAccessibleName('Descripción para Carnes');
    tecla(editor(), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent(/breve descripción/);
    fireEvent.change(editor(), { target: { value: 'Venta de caza' } });
    tecla(editor(), 'Enter');
    expect(cla(id0)).toMatchObject({ actividadId: nodo('Comercio', 'Alimentación', 'Carnes'), descripcion: 'Venta de caza' });
    expect(document.getElementById(`cel-${id0}-actividad`)).toHaveTextContent('Carnes · Venta de caza');
  });

  it('un ejemplo de Servicios guarda el subgrupo con su descripción; Esc cancela sin guardar', () => {
    const grid = montar();
    const [id0] = filas();
    tecla(grid, 'f');
    escribir('fisio');
    tecla(editor(), 'Escape');
    expect(editor()).toBeNull();
    expect(cla(id0)).toBeUndefined();
    tecla(grid, 'f');
    escribir('fisio');
    tecla(editor(), 'Enter');
    expect(cla(id0)).toMatchObject({ actividadId: nodo('Servicios', 'Servicios médicos'), descripcion: 'Fisioterapia' });
  });

  it('lo usado recientemente aparece al abrir el editor vacío en la fila siguiente', () => {
    const grid = montar();
    tecla(grid, 'h');
    escribir('hostal');
    tecla(editor(), 'Enter'); // baja a la fila siguiente
    tecla(grid, 'F2');
    escribir('');
    expect(screen.getByLabelText('Usada recientemente').closest('[role="option"]')).toHaveTextContent('Hostal');
  });

  it('copiar y pegar actividades entre filas conserva la ruta (ambiguas) y la descripción', () => {
    const grid = montar();
    const ids = filas();
    // Fila 0: «Otros» de Restaurantes (nombre ambiguo); fila 1: Servicios médicos · Fisioterapia
    act(() => useStore.getState().aplicar((d) => {
      let x = clasificar(d, neg(ids[0]), C26_SINT, nodo('Hostelería y Restauración', 'Restaurantes', 'Otros'), 'p-marta');
      x = clasificar(x, neg(ids[1]), C26_SINT, nodo('Servicios', 'Servicios médicos'), 'p-marta', { descripcion: 'Fisioterapia' });
      return x;
    }, 'preparar'));
    tecla(grid, 'ArrowDown', { shiftKey: true });
    let copiado = '';
    fireEvent.copy(grid, { clipboardData: { setData: (_: string, v: string) => (copiado = v), getData: () => '' } });
    expect(copiado).toBe('Hostelería y Restauración › Restaurantes › Otros\nServicios médicos · Fisioterapia');
    for (let k = 0; k < 4; k++) tecla(grid, 'ArrowDown');
    fireEvent.paste(grid, { clipboardData: { getData: () => copiado, setData: () => undefined } });
    expect(cla(ids[5])).toMatchObject({ actividadId: cla(ids[0]).actividadId, descripcion: undefined });
    expect(cla(ids[6])).toMatchObject({ actividadId: cla(ids[1]).actividadId, descripcion: 'Fisioterapia' });
    // Un nombre ambiguo pegado sin ruta se rechaza entero
    const antes = db();
    fireEvent.paste(grid, { clipboardData: { getData: () => 'Otros', setData: () => undefined } });
    expect(db()).toBe(antes);
  });
});

describe('B4 · selector en la ficha', () => {
  it('muestra los niveles según el grupo, la propuesta por el nombre y no altera 2025', () => {
    const grid = montar();
    const id0 = filas()[0];
    renombrar(neg(id0), 'Hotel San Antón');
    const antes2025 = db().clasificaciones[kNC(neg(id0), C25_SINT)];
    tecla(grid, 'Enter', { ctrlKey: true });
    const panel = screen.getByRole('complementary', { name: 'Revisión del registro' });
    fireEvent.click(within(panel).getByRole('tab', { name: 'Ficha' }));
    const prop = within(panel).getByRole('button', { name: 'Hotel' });
    expect(cla(id0)).toBeUndefined(); // la propuesta no se aplica sola
    fireEvent.click(prop);
    expect(cla(id0)).toMatchObject({ actividadId: nodo('Hostelería y Restauración', 'Hoteles y hospedaje', 'Hotel'), confirmada: true });
    const niveles = panel.querySelector('dl.scl-niveles')!;
    expect(niveles).toHaveTextContent('GrupoHostelería y Restauración');
    expect(niveles).not.toHaveTextContent('Grupo de comercio'); // Hostelería: tres niveles
    expect(niveles).toHaveTextContent('SubgrupoHoteles y hospedaje');
    expect(niveles).toHaveTextContent('ActividadHotel');
    expect(db().clasificaciones[kNC(neg(id0), C25_SINT)]).toEqual(antes2025);
  });
});
