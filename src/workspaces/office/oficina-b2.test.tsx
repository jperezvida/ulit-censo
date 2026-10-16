import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from '../../store/store';
import { C25_SINT, C26_SINT, MUN_SINT, escenarioOficina } from '../../data/escenarioOficina';
import { registrarVacio } from '../../domain/campo';
import { kRev } from '../../domain/db';
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
  it('muestra primero los itinerarios con su progreso independiente', () => {
    montar('/oficina');
    const it1 = screen.getByRole('article', { name: 'Itinerario IT-1' });
    expect(within(it1).getByRole('button', { name: /Trabajo de campo: \d+ registrados, 0 pendientes/ })).toBeInTheDocument();
    expect(within(it1).getByText(/pendiente de B5/)).toBeInTheDocument();
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
    expect(screen.getByRole('status')).toHaveTextContent(/No es apto para la exportación municipal/);
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
    fireEvent.click(screen.getByRole('button', { name: /Asignar fechas/ }));
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
