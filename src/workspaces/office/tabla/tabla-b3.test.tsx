import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useStore } from '../../../store/store';
import { C25_SINT, C26_SINT, MUN_SINT, escenarioOficina } from '../../../data/escenarioOficina';
import { indiceObservaciones, indiceOcupaciones } from '../../../domain/consultas';
import { filasOficina } from '../../../domain/oficina';
import { cerrarRevisionItinerario } from '../../../domain/bloqueo';
import { kNC, kRev, type BaseDatos } from '../../../domain/db';
import OficinaPage from '../OficinaPage';
import { ACTIVIDADES_SELECCIONABLES, COLUMNA_POR_ID, ErrorCeldas, aplicarCambiosCeldas, parseNumeroDigital, parseRespuesta } from './columnas';

const ACT = ACTIVIDADES_SELECCIONABLES.filter((a) => /^[\p{L} ]+$/u.test(a.nombre)).slice(0, 4).map((a) => a.nombre);

let esc: ReturnType<typeof escenarioOficina>;
const db = () => useStore.getState().db!;
const ix = (d: BaseDatos) => ({ obs: indiceObservaciones(d), ocu: indiceOcupaciones(d) });

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
      <Routes>
        <Route path="/oficina/*" element={<OficinaPage />} />
      </Routes>
    </MemoryRouter>,
  );
  const grid = screen.getByRole('grid', { name: 'Tabla de revisión' });
  act(() => grid.focus());
  return grid;
}

const estado = () => document.querySelector('.tab-estado') as HTMLElement;
const tecla = (el: Element, key: string, o: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(el, { key, ...o });
const editor = () => document.querySelector('input.tab-editor') as HTMLInputElement;
const escribir = (txt: string) => fireEvent.change(editor(), { target: { value: txt } });
const celda = (localId: string, col: string) => document.getElementById(`cel-${localId}-${col}`)!;
/** Filas visibles en la tabla, en orden. */
const filasTabla = () => [...document.querySelectorAll('[role="row"][aria-rowindex]')].map((r) => r.querySelector('[role="gridcell"]')!.id.split('-').slice(1, -1).join('-'));

beforeEach(() => {
  esc = escenarioOficina({ calles: 4, localesPorCalle: 12 });
  preparar(esc.db);
});

describe('B3 · tabla de revisión rápida', () => {
  it('escenario 2 · muestra las columnas de la tarea y filtra por pendientes', () => {
    montar('tarea=categorizacion&filtro=pendientes');
    for (const t of ['Calle', 'Nº', 'Establecimiento', 'Actividad', 'Categorización']) expect(screen.getByRole('columnheader', { name: new RegExp(t) })).toBeInTheDocument();
    const n = filasTabla().length;
    expect(n).toBeGreaterThan(5);
    fireEvent.click(screen.getByRole('button', { name: /^Presencia digital/ }));
    expect(screen.getByRole('columnheader', { name: /Página web/ })).toBeInTheDocument();
  });

  it('escenario 3 · categoriza varios negocios solo con el teclado (un deshacer por operación)', () => {
    const grid = montar('tarea=categorizacion&filtro=todos');
    const ids = filasTabla().filter((id) => !esc.db.locales[id] || true);
    const ocupados = filasOficina(esc.db, C26_SINT, ix(esc.db), { itinerarioId: esc.itinerarios[0] }).filter((f) => !f.vacio && f.situacion === 'registrado').map((f) => f.localId);
    expect(ids).toEqual(ocupados);
    tecla(grid, 'ArrowDown'); // primera fila
    for (let k = 0; k < 3; k++) tecla(grid, 'ArrowRight'); // → Actividad (Calle, Nº, Establecimiento fijas)
    expect(grid.getAttribute('aria-activedescendant')).toBe(`cel-${ids[0]}-actividad`);
    for (let i = 0; i < 3; i++) {
      tecla(grid, ACT[i][0]); // empezar a escribir abre el editor
      expect(editor().value).toBe(ACT[i][0]);
      escribir(ACT[i]);
      tecla(editor(), 'Enter'); // confirma y baja
    }
    for (let i = 0; i < 3; i++) {
      const neg = esc.db.ocupaciones[`ocu-${ids[i]}`].negocioId!;
      expect(db().clasificaciones[kNC(neg, C26_SINT)]).toMatchObject({ confirmada: true, porId: 'p-marta' });
      expect(db().revisiones[kRev(C26_SINT, ids[i])].categorizacion).toBe('revisado');
    }
    expect(useStore.getState().pilaDeshacer).toHaveLength(3);
    expect(grid.getAttribute('aria-activedescendant')).toBe(`cel-${ids[3]}-actividad`);
    // Tab confirma y avanza a la derecha; Esc cancela sin guardar
    tecla(grid, 'F2');
    escribir('No es una actividad');
    tecla(editor(), 'Escape');
    expect(editor()).toBeNull();
    expect(useStore.getState().pilaDeshacer).toHaveLength(3);
    // Un valor inexistente se rechaza y el editor sigue abierto
    tecla(grid, 'Enter');
    escribir('Actividad inventada');
    tecla(editor(), 'Enter');
    expect(editor()).not.toBeNull();
    expect(estado()).toHaveTextContent(/no está en el catálogo/);
    expect(useStore.getState().pilaDeshacer).toHaveLength(3);
  });

  it('escenario 4 · copia y pega un rango compatible sin alterar otros registros', () => {
    const grid = montar('tarea=categorizacion&filtro=todos');
    const ids = filasTabla();
    // Clasificar las dos primeras con el teclado
    tecla(grid, 'ArrowDown');
    for (let k = 0; k < 3; k++) tecla(grid, 'ArrowRight');
    for (let i = 0; i < 2; i++) {
      tecla(grid, 'Enter');
      escribir(ACT[i]);
      tecla(editor(), 'Enter');
    }
    // Seleccionar las dos celdas y copiarlas
    tecla(grid, 'ArrowUp');
    tecla(grid, 'ArrowUp');
    tecla(grid, 'ArrowDown', { shiftKey: true });
    let copiado = '';
    fireEvent.copy(grid, { clipboardData: { setData: (_: string, v: string) => (copiado = v), getData: () => '' } });
    expect(copiado).toBe(`${ACT[0]}\n${ACT[1]}`);
    // Pegar en las filas 5 y 6
    tecla(grid, 'ArrowDown');
    tecla(grid, 'ArrowDown');
    tecla(grid, 'ArrowDown');
    tecla(grid, 'ArrowDown');
    const antes = JSON.stringify(db().clasificaciones);
    fireEvent.paste(grid, { clipboardData: { getData: () => copiado, setData: () => undefined } });
    const neg = (id: string) => esc.db.ocupaciones[`ocu-${id}`].negocioId!;
    expect(db().clasificaciones[kNC(neg(ids[5]), C26_SINT)].actividadId).toBe(db().clasificaciones[kNC(neg(ids[0]), C26_SINT)].actividadId);
    expect(db().clasificaciones[kNC(neg(ids[6]), C26_SINT)].actividadId).toBe(db().clasificaciones[kNC(neg(ids[1]), C26_SINT)].actividadId);
    // Solo cambian esas dos clasificaciones
    const a = JSON.parse(antes);
    const b = db().clasificaciones;
    const cambiadas = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    expect(cambiadas.sort()).toEqual([kNC(neg(ids[5]), C26_SINT), kNC(neg(ids[6]), C26_SINT)].sort());
    // Una sola operación deshacible para todo el pegado
    expect(useStore.getState().pilaDeshacer.at(-1)!.etiqueta).toBe('Pegado de 2 celda(s)');
  });

  it('el pegado es atómico: si una celda no es válida no se aplica ninguna', () => {
    const grid = montar('tarea=categorizacion&filtro=todos');
    const ids = filasTabla();
    tecla(grid, 'ArrowDown');
    for (let k = 0; k < 3; k++) tecla(grid, 'ArrowRight');
    const antes = db();
    fireEvent.paste(grid, { clipboardData: { getData: () => `${ACT[0]}\nActividad que no existe\n${ACT[1]}`, setData: () => undefined } });
    expect(db()).toBe(antes);
    expect(estado()).toHaveTextContent(/No se ha aplicado ningún cambio de los 3/);
    expect(celda(ids[1], 'actividad')).toHaveAttribute('aria-invalid', 'true');
    // Pegar sobre una columna de solo lectura también se rechaza entero
    tecla(grid, 'ArrowRight');
    fireEvent.paste(grid, { clipboardData: { getData: () => 'x\ty', setData: () => undefined } });
    expect(db()).toBe(antes);
  });

  it('escenario 5 · deshacer y rehacer una modificación completa', () => {
    const grid = montar('tarea=categorizacion&filtro=todos');
    const ids = filasTabla();
    const neg = esc.db.ocupaciones[`ocu-${ids[0]}`].negocioId!;
    tecla(grid, 'ArrowDown');
    tecla(grid, 'ArrowRight');
    tecla(grid, 'ArrowRight'); // Establecimiento (desde Calle)
    tecla(grid, 'F2');
    for (const parcial of ['B', 'Ba', 'Bar ', 'Bar Nuevo Nombre']) escribir(parcial);
    tecla(editor(), 'Enter');
    expect(db().negocios[neg].nombre).toBe('Bar Nuevo Nombre');
    expect(useStore.getState().pilaDeshacer).toHaveLength(1); // una operación, no una por pulsación
    tecla(grid, 'z', { ctrlKey: true });
    expect(db().negocios[neg].nombre).toBe(esc.db.negocios[neg].nombre);
    tecla(grid, 'y', { ctrlKey: true });
    expect(db().negocios[neg].nombre).toBe('Bar Nuevo Nombre');
  });

  it('escenario 6 · los cambios hechos en la tabla se ven en el modo por establecimientos', () => {
    const grid = montar('tarea=categorizacion&filtro=todos');
    const ids = filasTabla();
    tecla(grid, 'ArrowDown');
    tecla(grid, 'ArrowRight');
    tecla(grid, 'ArrowRight');
    tecla(grid, 'Enter');
    escribir('Nombre Cambiado En Tabla');
    tecla(editor(), 'Enter');
    fireEvent.click(screen.getByText('Por establecimientos'));
    fireEvent.click(document.getElementById(`reg-${ids[0]}`)!);
    expect(screen.getByLabelText('Nombre comercial')).toHaveValue('Nombre Cambiado En Tabla');
    fireEvent.click(screen.getByText('Por tareas'));
    expect(celda(ids[0], 'nombre')).toHaveTextContent('Nombre Cambiado En Tabla');
  });

  it('presencia digital: interpreta 1/0, N/A y números; rechaza lo que no admite la variable', () => {
    const grid = montar('tarea=digital&filtro=todos');
    const ids = filasTabla();
    const neg = esc.db.ocupaciones[`ocu-${ids[0]}`].negocioId!;
    tecla(grid, 'ArrowDown');
    for (let k = 0; k < 4; k++) tecla(grid, 'ArrowRight'); // Página web
    tecla(grid, '1');
    tecla(editor(), 'Tab'); // Venta por internet
    tecla(grid, '0');
    tecla(editor(), 'Enter');
    const rev = db().digital[kNC(neg, C26_SINT)];
    expect(rev.datos.web?.respuesta).toBe('si');
    expect(rev.datos.ventaOnline?.respuesta).toBe('no');
    // «na» no se admite en «Página web»
    tecla(grid, 'ArrowUp');
    tecla(grid, 'ArrowLeft');
    tecla(grid, 'Enter');
    escribir('na');
    tecla(editor(), 'Enter');
    expect(estado()).toHaveTextContent(/no admite/);
    expect(db().digital[kNC(neg, C26_SINT)].datos.web?.respuesta).toBe('si');
    expect(parseRespuesta('Sí')).toBe('si');
    expect(parseNumeroDigital('1.250')).toEqual({ respuesta: 'si', valor: 1250 });
    expect(parseNumeroDigital('4,5')).toEqual({ respuesta: 'si', valor: 4.5 });
    expect(parseNumeroDigital('')).toEqual({ respuesta: 'pendiente' });
  });

  it('escenario 7 · en una calle compartida solo se ven y editan los locales de la propia acera', () => {
    montar('tarea=todos&filtro=todos');
    const ids = filasTabla();
    const deCalle = ids.filter((id) => esc.db.locales[id].direcciones[0].calleId === esc.calleRepartida);
    expect(deCalle.length).toBe(6);
    expect(deCalle.every((id) => esc.db.locales[id].direcciones[0].numero! % 2 === 0)).toBe(true);
    // Aunque se intentara aplicar un cambio sobre la otra acera, el dominio lo rechaza
    const ajena = filasOficina(esc.db, C26_SINT, ix(esc.db), { itinerarioId: esc.itinerarios[1] }).find((f) => f.calleId === esc.calleRepartida && f.situacion === 'registrado' && !f.vacio)!;
    const ctx = { db: esc.db, campanaId: C26_SINT, personaId: 'p-marta', alcance: { itinerarioId: esc.itinerarios[0] }, bloqueado: false };
    expect(() => aplicarCambiosCeldas(esc.db, [{ fila: ajena, col: COLUMNA_POR_ID.nombre, texto: 'Intruso' }], ctx)).toThrow(ErrorCeldas);
    expect(() => aplicarCambiosCeldas(esc.db, [{ fila: ajena, col: COLUMNA_POR_ID.nombre, texto: 'Intruso' }], ctx)).toThrow(/no pertenecen a IT-1/);
  });

  it('escenario 8 · un itinerario cerrado no admite ediciones ni pegados', () => {
    preparar(cerrarRevisionItinerario(esc.db, esc.itinerarios[0], 'p-elena'));
    const grid = montar('tarea=categorizacion&filtro=todos');
    tecla(grid, 'ArrowDown');
    for (let k = 0; k < 3; k++) tecla(grid, 'ArrowRight');
    tecla(grid, 'Enter');
    expect(editor()).toBeNull();
    expect(estado()).toHaveTextContent(/solo lectura/);
    const antes = db();
    fireEvent.paste(grid, { clipboardData: { getData: () => ACT[0], setData: () => undefined } });
    expect(db()).toBe(antes);
  });

  it('escenario 10 · el histórico y la campaña anterior quedan intactos tras editar', () => {
    const grid = montar('tarea=categorizacion&filtro=todos');
    tecla(grid, 'ArrowDown');
    for (let k = 0; k < 3; k++) tecla(grid, 'ArrowRight');
    fireEvent.paste(grid, { clipboardData: { getData: () => `${ACT[0]}\n${ACT[1]}\n${ACT[2]}`, setData: () => undefined } });
    const de2025 = (d: BaseDatos) => JSON.stringify({
      cla: Object.values(d.clasificaciones).filter((c) => c.campanaId === C25_SINT),
      obs: Object.values(d.observaciones).filter((o) => o.campanaId === C25_SINT),
      ocu: d.ocupaciones,
    });
    expect(useStore.getState().pilaDeshacer).toHaveLength(1);
    expect(de2025(db())).toBe(de2025(esc.db));
  });
});

describe('B3 · columnas, ficha y campañas cerradas', () => {
  it('las columnas se ocultan y se fijan, y la configuración se guarda por persona', () => {
    montar('tarea=categorizacion&filtro=todos');
    fireEvent.click(screen.getByRole('button', { name: 'Configurar columnas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fijar Actividad' }));
    const cab = () => screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(cab().slice(1, 5)).toEqual(['Calle', 'Nº', 'Establecimiento', 'Actividad']);
    expect(screen.getByRole('columnheader', { name: /Actividad/ })).toHaveClass('fija');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grupo' }));
    expect(cab()).not.toContain('Grupo');
    expect(useStore.getState().prefs.oficina['p-marta'].columnas!.categorizacion.fijas).toContain('actividad');
  });

  it('Ctrl+Enter abre la ficha con histórico y conciliación sin salir de la tabla', () => {
    const grid = montar('tarea=categorizacion&filtro=todos');
    tecla(grid, 'ArrowDown');
    tecla(grid, 'Enter', { ctrlKey: true });
    const panel = screen.getByRole('complementary', { name: 'Revisión del registro' });
    expect(within(panel).getByRole('tab', { name: 'Histórico' })).toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: /Conciliación/ })).toBeInTheDocument();
    expect(grid).toBeInTheDocument();
  });

  it('una campaña histórica se consulta en modo de solo lectura', () => {
    useStore.setState({ prefs: { ...useStore.getState().prefs, campanaId: C25_SINT } });
    render(
      <MemoryRouter initialEntries={['/oficina/municipal?tarea=todos&filtro=todos']}>
        <Routes><Route path="/oficina/*" element={<OficinaPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(document.querySelector('.ofi-banda-bloqueo')).toHaveTextContent(/solo lectura/);
    const grid = screen.getByRole('grid', { name: 'Tabla de revisión' });
    act(() => grid.focus());
    tecla(grid, 'ArrowDown');
    tecla(grid, 'ArrowRight');
    tecla(grid, 'ArrowRight');
    tecla(grid, 'Enter');
    expect(editor()).toBeNull();
  });
});

describe('B3 · rendimiento de la tabla', () => {
  it('pinta y recorre con el teclado miles de registros (virtualizada)', { timeout: 30000 }, () => {
    esc = escenarioOficina({ calles: 44, localesPorCalle: 80, callesPorItinerario: 40 });
    preparar(esc.db);
    const t0 = performance.now();
    const grid = montar('tarea=todos&filtro=todos', esc.itinerarios[2]);
    const tPintar = performance.now() - t0;
    const total = Number(grid.getAttribute('aria-rowcount')) - 1;
    expect(total).toBeGreaterThan(3000);
    // Solo se pintan las filas visibles
    expect(document.querySelectorAll('[role="row"][aria-rowindex]').length).toBeLessThan(80);
    const t1 = performance.now();
    tecla(grid, 'ArrowDown');
    for (let i = 0; i < 300; i++) tecla(grid, 'ArrowDown');
    for (let i = 0; i < 20; i++) tecla(grid, 'PageDown');
    const tTeclas = performance.now() - t1;
    expect(grid.getAttribute('aria-activedescendant')).toMatch(/^cel-/);
    console.info(`[rendimiento tabla] ${total} filas · primer pintado ${tPintar.toFixed(0)} ms · 321 pulsaciones ${tTeclas.toFixed(0)} ms`);
    expect(tPintar).toBeLessThan(5000);
    expect(tTeclas).toBeLessThan(15000);
  });
});
