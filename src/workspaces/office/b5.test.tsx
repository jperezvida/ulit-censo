import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useStore } from '../../store/store';
import { C25_SINT, C26_SINT, MUN_SINT, escenarioOficina } from '../../data/escenarioOficina';
import { kNC, kRev, type BaseDatos } from '../../domain/db';
import { cerrarRevisionItinerario } from '../../domain/bloqueo';
import { registrarNuevoNegocio } from '../../domain/campo';
import { franquiciaEn, revisionFranquicia } from '../../domain/franquicias';
import { clasificar } from '../../domain/clasificacion';
import { NODOS_2026, rutaActividad } from '../../domain/taxonomy';
import OficinaPage from './OficinaPage';

let esc: ReturnType<typeof escenarioOficina>;
const db = () => useStore.getState().db!;
const tecla = (el: Element, key: string, o: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(el, { key, ...o });
const editor = () => document.querySelector('input.tab-editor') as HTMLInputElement | null;
const filasTabla = () => [...document.querySelectorAll('[role="row"][aria-rowindex]')].map((r) => r.querySelector('[role="gridcell"]')!.id.split('-').slice(1, -1).join('-'));
const neg = (localId: string) => db().ocupaciones[`ocu-${localId}`]?.negocioId ?? esc.db.ocupaciones[`ocu-${localId}`].negocioId!;
const activa = (grid: HTMLElement) => grid.getAttribute('aria-activedescendant');

function preparar(base: BaseDatos) {
  useStore.setState({
    db: base,
    carga: { fase: 'lista', mensaje: '' },
    pilaDeshacer: [],
    pilaRehacer: [],
    prefs: { ...useStore.getState().prefs, municipioId: MUN_SINT, campanaId: C26_SINT, personaId: 'p-marta', oficina: {} },
  });
}

function montar(q: string, it = esc.itinerarios[0]) {
  render(
    <MemoryRouter initialEntries={[`/oficina/it/${it}?${q}`]}>
      <Routes><Route path="/oficina/*" element={<OficinaPage />} /></Routes>
    </MemoryRouter>,
  );
  const grid = screen.getByRole('grid', { name: 'Tabla de revisión' });
  act(() => grid.focus());
  return grid;
}

/** Lleva el cursor a la columna indicada de la primera fila. */
function irAColumna(grid: HTMLElement, col: string) {
  tecla(grid, 'ArrowDown');
  for (let k = 0; k < 40 && !activa(grid)?.endsWith(`-${col}`); k++) tecla(grid, 'ArrowRight');
  expect(activa(grid)).toMatch(new RegExp(`-${col.replace('.', '\\.')}$`));
}

beforeEach(() => {
  esc = escenarioOficina({ calles: 4, localesPorCalle: 12 });
  preparar(esc.db);
});

describe('B5 · Respuestas inmediatas con el teclado', () => {
  it('Franquicias: 1/0 sin editor, con filtro «Pendientes» y muchos registros seguidos sin ratón', () => {
    const grid = montar('tarea=franquicias&filtro=pendientes');
    const antes = filasTabla();
    irAColumna(grid, 'franquicia');
    for (let i = 0; i < 12; i++) {
      tecla(grid, i % 2 ? '0' : '1');
      expect(editor()).toBeNull();
    }
    // Cada registro respondido sale del filtro y el cursor queda en el siguiente pendiente
    expect(filasTabla().length).toBe(antes.length - 12);
    expect(activa(grid)).toBe(`cel-${antes[12]}-franquicia`);
    antes.slice(0, 12).forEach((id, i) => {
      expect(franquiciaEn(db(), neg(id), C26_SINT)).toMatchObject({ respuesta: i % 2 ? 'no' : 'si', origen: 'manual', porId: 'p-marta' });
      expect(revisionFranquicia(db().revisiones[kRev(C26_SINT, id)])).toBe('revisado');
    });
    // Una operación deshacible por respuesta
    expect(useStore.getState().pilaDeshacer).toHaveLength(12);
  });

  it('N no se admite en franquicia; ? registra «sin información» sin revisar; Supr vuelve a pendiente', () => {
    const grid = montar('tarea=franquicias&filtro=todos');
    const [id0] = filasTabla();
    irAColumna(grid, 'franquicia');
    tecla(grid, 'N');
    expect(document.querySelector('.tab-estado')).toHaveTextContent(/no admite/);
    expect(franquiciaEn(db(), neg(id0), C26_SINT)).toBeUndefined();
    tecla(grid, '?');
    expect(franquiciaEn(db(), neg(id0), C26_SINT)?.respuesta).toBe('sin-info');
    expect(revisionFranquicia(db().revisiones[kRev(C26_SINT, id0)])).toBe('pendiente');
    tecla(grid, 'ArrowUp');
    tecla(grid, '1');
    expect(revisionFranquicia(db().revisiones[kRev(C26_SINT, id0)])).toBe('revisado');
    tecla(grid, 'ArrowUp');
    tecla(grid, 'Delete');
    expect(franquiciaEn(db(), neg(id0), C26_SINT)?.respuesta).toBe('pendiente');
    expect(revisionFranquicia(db().revisiones[kRev(C26_SINT, id0)])).toBe('pendiente');
  });

  it('no modifican nombres, actividades ni cantidades, ni se interceptan en campos de texto', () => {
    const grid = montar('tarea=digital&filtro=todos');
    const antes = db();
    // Nombre: «1» empieza a escribir (editor), no responde
    tecla(grid, 'ArrowDown');
    tecla(grid, 'ArrowRight');
    tecla(grid, 'ArrowRight');
    expect(activa(grid)).toMatch(/-nombre$/);
    tecla(grid, '1');
    expect(editor()?.value).toBe('1');
    tecla(editor()!, 'Escape');
    expect(db()).toBe(antes);
    // Cantidad numérica: igual, se abre el editor
    irAColumna(grid, 'dig.numResenas');
    tecla(grid, '0');
    expect(editor()?.value).toBe('0');
    tecla(editor()!, 'Escape');
    expect(db()).toBe(antes);
    // En el buscador de la vista no se intercepta
    const busca = screen.getByLabelText('Búsqueda');
    tecla(busca, '1');
    fireEvent.change(busca, { target: { value: '1' } });
    expect(db()).toBe(antes);
  });

  it('presencia digital: 1 en Instagram avanza a «Seguidores Instagram» y nunca verifica', () => {
    const grid = montar('tarea=digital&filtro=pendientes');
    const [id0] = filasTabla();
    irAColumna(grid, 'dig.instagram');
    tecla(grid, '1');
    expect(activa(grid)).toBe(`cel-${id0}-dig.seguidoresInstagram`);
    tecla(grid, '5'); // numérico: abre el editor
    fireEvent.change(editor()!, { target: { value: '1.250' } });
    tecla(editor()!, 'Enter');
    const rev = db().digital[kNC(neg(id0), C26_SINT)];
    expect(rev.datos.seguidoresInstagram).toMatchObject({ respuesta: 'si', valor: 1250 });
    expect(rev.estado).toBe('borrador');
    expect(db().revisiones[kRev(C26_SINT, id0)].digital).toBe('pendiente');
  });

  it('pinta y responde con miles de registros (virtualizada)', { timeout: 60000 }, () => {
    esc = escenarioOficina({ calles: 44, localesPorCalle: 80, callesPorItinerario: 40 });
    preparar(esc.db);
    const grid = montar('tarea=franquicias&filtro=pendientes', esc.itinerarios[2]);
    expect(Number(grid.getAttribute('aria-rowcount')) - 1).toBeGreaterThan(2000);
    irAColumna(grid, 'franquicia');
    const t = performance.now();
    for (let i = 0; i < 40; i++) tecla(grid, i % 3 ? '0' : '1');
    const ms = performance.now() - t;
    console.info(`[rendimiento B5 tabla] 40 respuestas con ${grid.getAttribute('aria-rowcount')} filas: ${ms.toFixed(0)} ms`);
    expect(Object.values(db().franquicias).filter((f) => f.campanaId === C26_SINT)).toHaveLength(40);
    expect(ms).toBeLessThan(30000);
  });
});

describe('B5 · Acciones masivas', () => {
  it('Espacio marca, Mayús+F10 muestra el plan, se aplica de una vez y un solo Ctrl+Z lo deshace', () => {
    const grid = montar('tarea=franquicias&filtro=todos');
    const ids = filasTabla();
    tecla(grid, 'ArrowDown');
    for (let i = 0; i < 3; i++) {
      tecla(grid, ' ');
      tecla(grid, 'ArrowDown');
    }
    tecla(grid, 'F10', { shiftKey: true });
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByText(/3 registro\(s\) seleccionados/)).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('radio', { name: 'No (0)' }));
    expect(within(dlg).getByRole('status')).toHaveTextContent('3 registro(s) afectados · Franquicia = No');
    const antes = useStore.getState().pilaDeshacer.length;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Aplicar a 3 registros' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    for (const id of ids.slice(0, 3)) expect(franquiciaEn(db(), neg(id), C26_SINT)?.respuesta).toBe('no');
    expect(useStore.getState().pilaDeshacer.length).toBe(antes + 1);
    // Un único Ctrl+Z deshace las tres; Ctrl+Y las rehace
    tecla(grid, 'z', { ctrlKey: true });
    for (const id of ids.slice(0, 3)) expect(franquiciaEn(db(), neg(id), C26_SINT)).toBeUndefined();
    tecla(grid, 'y', { ctrlKey: true });
    for (const id of ids.slice(0, 3)) expect(franquiciaEn(db(), neg(id), C26_SINT)?.respuesta).toBe('no');
  });

  it('una respuesta masiva de presencia digital no la verifica ni aprueba registros', () => {
    const grid = montar('tarea=digital&filtro=todos');
    const ids = filasTabla();
    tecla(grid, 'ArrowDown');
    for (let i = 0; i < 4; i++) tecla(grid, 'ArrowDown', { shiftKey: true });
    tecla(grid, 'ContextMenu');
    const dlg = screen.getByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Variable'), { target: { value: 'web' } });
    fireEvent.click(within(dlg).getByRole('radio', { name: 'No (0)' }));
    fireEvent.click(within(dlg).getByRole('button', { name: /^Aplicar a/ }));
    for (const id of ids.slice(0, 5)) {
      const n = neg(id);
      if (!n) continue;
      expect(db().digital[kNC(n, C26_SINT)]?.estado ?? 'borrador').toBe('borrador');
      expect(db().revisiones[kRev(C26_SINT, id)]).toMatchObject({ digital: 'pendiente', validacion: 'pendiente' });
    }
  });

  it('en un itinerario cerrado no hay registros a los que aplicar nada', () => {
    preparar(cerrarRevisionItinerario(esc.db, esc.itinerarios[0], 'p-elena'));
    const grid = montar('tarea=franquicias&filtro=todos');
    tecla(grid, 'ArrowDown');
    tecla(grid, 'ArrowDown', { shiftKey: true });
    tecla(grid, 'F10', { shiftKey: true });
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).getByRole('status')).toHaveTextContent(/^0 registro\(s\) afectados/);
    expect(within(dlg).getByRole('button', { name: 'Aplicar a 0 registros' })).toBeDisabled();
    expect(within(dlg).getByText(/2 registro\(s\) excluidos/)).toBeInTheDocument();
  });
});

describe('B5 · Comparación con 2025 y ficha', () => {
  it('columnas de referencia de solo lectura; «≠» cuando era otro negocio', () => {
    const [primero] = Object.values(esc.db.revisiones).filter((r) => r.campanaId === C26_SINT && esc.db.ocupaciones[`ocu-${r.localId}`]?.negocioId);
    preparar(registrarNuevoNegocio(esc.db, { campanaId: C26_SINT, investigadorId: 'p-ana', fecha: '2026-10-05T10:00:00' }, primero.localId, 'Perfumería Nueva Prueba'));
    const grid = montar('tarea=franquicias&filtro=todos');
    fireEvent.click(screen.getByRole('button', { name: /Comparar con 2025/ }));
    expect(screen.getByRole('columnheader', { name: /2025 · Establecimiento/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /2025 · Franquicia/ })).toBeInTheDocument();
    const celda = document.getElementById(`cel-${primero.localId}-ref.negocio`)!;
    expect(celda).toHaveTextContent('≠');
    expect(celda).toHaveTextContent(esc.db.negocios[esc.db.ocupaciones[`ocu-${primero.localId}`].negocioId!].nombre);
    expect(celda).toHaveAttribute('aria-readonly', 'true');
    // No se puede escribir en una columna de referencia
    act(() => grid.focus());
    fireEvent.mouseDown(celda);
    tecla(grid, '1');
    expect(editor()).toBeNull();
    expect(db().franquicias[kNC(esc.db.ocupaciones[`ocu-${primero.localId}`].negocioId!, C25_SINT)]).toEqual(esc.db.franquicias[kNC(esc.db.ocupaciones[`ocu-${primero.localId}`].negocioId!, C25_SINT)]);
  });

  it('la ficha separa franquicia, nombre de cadena y descripción del negocio, con estado de revisión', () => {
    const grid = montar('tarea=franquicias&filtro=todos');
    const [id0] = filasTabla();
    tecla(grid, 'ArrowDown');
    tecla(grid, 'Enter', { ctrlKey: true });
    const panel = screen.getByRole('complementary', { name: 'Revisión del registro' });
    fireEvent.click(within(panel).getByRole('tab', { name: 'Ficha' }));
    expect(within(panel).getByLabelText('Franquicia: pendiente')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Nombre de cadena')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Descripción del negocio')).toBeInTheDocument();
    expect(within(panel).getByText('Revisión pendiente', { exact: false })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Franquicia 2026: No' }));
    expect(franquiciaEn(db(), neg(id0), C26_SINT)?.respuesta).toBe('no');
    expect(within(panel).getByText(/Revisada · Marta/)).toBeInTheDocument();
    expect(within(panel).getByLabelText('Franquicia: revisado')).toBeInTheDocument();
    // Escribir un nombre de cadena no cambia la franquicia
    fireEvent.change(within(panel).getByLabelText('Nombre de cadena'), { target: { value: 'Cadena Ficticia' } });
    fireEvent.keyDown(within(panel).getByLabelText('Nombre de cadena'), { key: 'Enter' });
    expect(db().negocios[neg(id0)].cadena).toBe('Cadena Ficticia');
    expect(franquiciaEn(db(), neg(id0), C26_SINT)?.respuesta).toBe('no');
  });
});

describe('B5 · Avisos de clasificación sospechosa', () => {
  it('se ven en la tabla y en la ficha, filtran con «Con avisos» y no cambian la actividad', () => {
    const bar = NODOS_2026.find((n) => rutaActividad(n.id).map((x) => x.nombre).join('|') === 'Hostelería y Restauración|Bares y cafeterías|Bar')!.id;
    const farmacia = Object.values(esc.db.negocios).find((n) => n.nombre.startsWith('Farmacia') && Object.values(esc.db.revisiones).some((r) => r.campanaId === C26_SINT && esc.db.ocupaciones[`ocu-${r.localId}`]?.negocioId === n.id))!;
    preparar(clasificar(esc.db, farmacia.id, C26_SINT, bar, 'p-marta'));
    const grid = montar('tarea=categorizacion&filtro=avisos');
    const visibles = filasTabla();
    const localFarmacia = Object.values(esc.db.ocupaciones).find((o) => o.negocioId === farmacia.id)!.localId;
    expect(visibles).toContain(localFarmacia);
    expect(document.getElementById(`cel-${localFarmacia}-avisos`)).toHaveTextContent(/El nombre sugiere «Farmacias»/);
    expect(db().clasificaciones[kNC(farmacia.id, C26_SINT)].actividadId).toBe(bar);
    // En la ficha, junto a la clasificación
    act(() => grid.focus());
    fireEvent.mouseDown(document.getElementById(`cel-${localFarmacia}-avisos`)!);
    tecla(grid, 'Enter', { ctrlKey: true });
    const panel = screen.getByRole('complementary', { name: 'Revisión del registro' });
    fireEvent.click(within(panel).getByRole('tab', { name: 'Ficha' }));
    expect(within(panel).getByRole('list', { name: 'Avisos de clasificación' })).toHaveTextContent(/Farmacias/);
    expect(within(panel).getByLabelText('Descripción de la actividad clasificada')).toBeInTheDocument();
  });
});
