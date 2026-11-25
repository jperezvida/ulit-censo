import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from '../../store/store';
import { C25_SINT, C26_SINT, MUN_SINT, escenarioOficina } from '../../data/escenarioOficina';
import { registrarVacio } from '../../domain/campo';
import { kRev } from '../../domain/db';
import { prepararRevisionCategoriaIT1 } from '../../domain/revisionCategoriaIT1';
import OficinaPage from './OficinaPage';

let ruta = '';
function Ruta() {
  ruta = useLocation().pathname + useLocation().search;
  return null;
}

function montar(entrada: string) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route path="/oficina/*" element={<><OficinaPage /><Ruta /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

let esc: ReturnType<typeof escenarioOficina>;
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

describe('B2 · Oficina organizada por itinerarios (interfaz)', () => {

  it('IT1: el panel muestra la revisión del Excel y mantiene separado el progreso de locales', () => {
    const db = esc.db;
    const itId = esc.itinerarios[0];
    db.itinerarios[itId].codigo = 'IT1';
    db.importaciones['imp-it1-panel'] = {
      id:'imp-it1-panel',campanaId:C26_SINT,municipioId:MUN_SINT,
      tipo:'C-excel-itinerario',archivo:'IT1.xlsx',huella:'ficticia',fecha:'2026-10-01',
      filas:1,estado:'confirmada',resumen:{},procedencia:'simulado',
    };
    db.registros['fila-it1-panel'] = {
      id:'fila-it1-panel',importacionId:'imp-it1-panel',itinerarioId:itId,fila:2,
      datos:{'Local Vacío':'0','Nombre del negocio':'Negocio sintético IT1',
        'Dirección':'Calle Ficticia','Num':'1','GrActividad':'Servicios',
        'Subgrupo de actividad':'Reparaciones','Actividad':'Reparaciones'},
    };
    const f = prepararRevisionCategoriaIT1(db, C26_SINT).find((x) => x.fila.id === 'fila-it1-panel')!;
    expect(f).toBeDefined();
    montar('/oficina');
    const tarjeta = screen.getByRole('article',{name:'Itinerario IT1'});
    expect(within(tarjeta).getByRole('button',
      {name:/Categorización del Excel: 0 revisados, 1 pendientes/})).toBeInTheDocument();
    const localesAntes = within(tarjeta).getByText(/Revisión de locales físicos:/).textContent;
    db.revisionesCategoriaRegistros!['fila-it1-panel'] = {
      id:'fila-it1-panel',registroId:'fila-it1-panel',campanaId:C26_SINT,
      estado:'aceptada',valores:f.existentes,porId:'p-marta',fecha:'2026-11-25T10:00:00Z',
    };
    act(() => useStore.setState({ db: { ...db } }));
    expect(within(tarjeta).getByRole('button',
      {name:/Categorización del Excel: 1 revisados, 0 pendientes/})).toBeInTheDocument();
    expect(within(tarjeta).getByText(/Revisión de locales físicos:/).textContent).toBe(localesAntes);
    fireEvent.click(within(tarjeta).getByRole('button',
      {name:/Categorización del Excel: 1 revisados, 0 pendientes/}));
    expect(ruta).toContain('/oficina/categoria-it1');
  });

  it('muestra primero los itinerarios con su progreso independiente', () => {
    montar('/oficina');
    const it1 = screen.getByRole('article', { name: 'Itinerario IT-1' });
    expect(within(it1).getByRole('button', { name: /Trabajo de campo: \d+ registrados, 0 pendientes/ })).toBeInTheDocument();
    // B5: progreso real e independiente de franquicias
    expect(within(it1).getByRole('button', { name: /Franquicias: 0 revisados, \d+ pendientes/ })).toBeInTheDocument();
    const it2 = screen.getByRole('article', { name: 'Itinerario IT-2' });
    expect(within(it2).getByText(/1 sin locales/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vista general municipal/ })).toBeInTheDocument();
  });

  it('escenario 1 · abre un itinerario con campo terminado y oficina pendiente', () => {
    montar('/oficina');
    const it1 = screen.getByRole('article', { name: 'Itinerario IT-1' });
    fireEvent.click(within(it1).getByRole('button', { name: /Categorización/ }));
    expect(ruta).toContain(`/oficina/it/${esc.itinerarios[0]}`);
    expect(ruta).toContain('tarea=categorizacion');
    expect(screen.getByText(/IT-1 · Itinerario IT-1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Categorización/, pressed: true })).toBeInTheDocument();
  });

  it('escenario 6 · el modo de trabajo se conserva por persona y la selección al cambiar de vista', () => {
    const local = Object.values(esc.db.revisiones).find((r) => r.campanaId === C26_SINT)!.localId;
    montar(`/oficina/it/${esc.itinerarios[0]}?tarea=todos&filtro=todos&sel=${local}`);
    fireEvent.click(screen.getByText('Por establecimientos'));
    expect(useStore.getState().prefs.oficina['p-marta'].modo).toBe('establecimiento');
    expect(ruta).toContain(`sel=${local}`);
    expect(within(screen.getByRole('listbox')).getByRole('option', { selected: true })).toHaveAttribute('id', `reg-${local}`);
    // Otra persona conserva su propio modo
    act(() => useStore.getState().setPrefs({ personaId: 'p-ana' }));
    expect(useStore.getState().prefs.oficina['p-ana']).toBeUndefined();
  });

  it('escenario 8 · cierre provisional: registra quién y cuándo, bloquea y no se presenta como apto', () => {
    montar(`/oficina/it/${esc.itinerarios[0]}?tarea=todos&filtro=todos`);
    fireEvent.click(screen.getByRole('button', { name: /Cerrar revisión \(provisional\)/ }));
    expect(screen.getByText(/el itinerario no queda apto para la exportación municipal/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Cerrar revisión$/ }));
    const est = useStore.getState().db!.oficinaItinerarios[esc.itinerarios[0]];
    expect(est.estado).toBe('revision-cerrada');
    expect(est.historial[0]).toMatchObject({ accion: 'cerrar-revision', porId: 'p-marta' });
    expect(screen.getAllByText(/no apta para exportación municipal/).length).toBeGreaterThan(0);
    expect(document.querySelector('.ofi-banda-bloqueo')).toHaveTextContent(/No es apto para la exportación municipal/);
    // Reabrir exige motivo
    fireEvent.click(screen.getByRole('button', { name: /Reabrir/ }));
    const reabrir = screen.getAllByRole('button', { name: 'Reabrir' }).at(-1)!;
    expect(reabrir).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motivo de la reapertura'), { target: { value: 'Corregir un número de portal' } });
    fireEvent.click(reabrir);
    expect(useStore.getState().db!.oficinaItinerarios[esc.itinerarios[0]]).toMatchObject({ estado: 'reabierto' });
  });

  it('la validación definitiva se explica como no disponible', () => {
    montar(`/oficina/it/${esc.itinerarios[0]}`);
    fireEvent.click(screen.getByRole('button', { name: /Validación definitiva/ }));
    expect(screen.getByText(/bloque C2/)).toBeInTheDocument();
    expect(useStore.getState().db!.oficinaItinerarios[esc.itinerarios[0]]).toBeUndefined();
  });

  it('escenario 9 · asigna fecha a una observación de cronología incierta', () => {
    const local = Object.values(esc.db.revisiones).find((r) => r.campanaId === C26_SINT)!.localId;
    // Un vacío en papel sin fecha, cuando ya hay una visita fechada (y un cambio fechado)
    let db = registrarVacio(esc.db, { campanaId: C26_SINT, investigadorId: 'p-ana', fecha: '2026-10-05T10:00:00' }, local, 4);
    db = registrarVacio(db, { campanaId: C26_SINT, investigadorId: 'p-ana', fuente: 'papel' }, local, 6);
    act(() => useStore.setState({ db }));
    expect(db.revisiones[kRev(C26_SINT, local)].pendienteComprobacion).toBe(true);
    montar(`/oficina/it/${esc.itinerarios[0]}?tarea=incidencias&filtro=pendientes&sel=${local}`);
    fireEvent.click(screen.getByText('Por establecimientos'));
    fireEvent.click(screen.getByRole('button', { name: /asignar fechas/i }));
    fireEvent.change(screen.getByLabelText('Fecha real del evento'), { target: { value: '2026-09-25T09:30' } });
    fireEvent.click(screen.getByRole('button', { name: /Asignar fecha$/ }));
    const tras = useStore.getState().db!;
    const obs = Object.values(tras.observaciones).filter((o) => o.localId === local && o.campanaId === C26_SINT && o.fuente === 'papel');
    expect(obs[0]).toMatchObject({ fecha: '2026-09-25T09:30:00', fechaAsignada: { porId: 'p-marta' } });
    expect(tras.revisiones[kRev(C26_SINT, local)].pendienteComprobacion).toBe(false);
    // El histórico de 2025 no cambia
    expect(Object.values(tras.observaciones).filter((o) => o.campanaId === C25_SINT)).toEqual(Object.values(esc.db.observaciones).filter((o) => o.campanaId === C25_SINT));
  });

  it('los enlaces antiguos de la bandeja llevan a la vista municipal con la tarea equivalente', () => {
    montar('/oficina?vista=dudosos');
    expect(ruta).toBe('/oficina/municipal?tarea=incidencias&filtro=pendientes');
    expect(screen.getByText('Vista general municipal')).toBeInTheDocument();
  });
});
