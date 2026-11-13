import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FilaRevisionGeneral } from '../../domain/revisionGeneral';
import { revisarRegistroGeneral } from '../../domain/revisionGeneral';
import { guardarCorreccionRevisionGeneral } from '../../store/revisionGeneralReal';
import CorregirRevisionGeneral from './CorregirRevisionGeneral';

vi.mock('../../store/revisionGeneralReal', () => ({
  guardarCorreccionRevisionGeneral: vi.fn(),
}));

function fila(nombre: string, fachada=''): FilaRevisionGeneral {
  const registro = {
    id: 'reg-prueba-27', importacionId: 'it1', itinerarioId: 'it1', fila: 27,
    datos: { 'Local Vacío': '1', 'Nombre del negocio': nombre, 'Long fachada': fachada },
  };
  return {
    id: registro.id, registro, archivo: 'IT1.xlsx', itinerario: 'IT1',
    direccion: 'Calle Ramón y Cajal', numero: '11', nombre, estado: 'vacio',
    incidencias: revisarRegistroGeneral(registro).incidencias,
  };
}

describe('Oficina · transición supervisada vacío a ocupado', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('Asesoría Nuria Mate: seleccionar ocupado retira LV y metros sin modificar nombre', async () => {
    const onGuardada = vi.fn();
    const cambio = {
      registroId: 'reg-prueba-27', version: 10,
      correccion: { id: 'reg-prueba-27', registroId: 'reg-prueba-27',
        campanaId: 'real-camp-medina-2026-censo-medina-del-campo-2026',
        valores: { vacio: '0' }, fecha: '2026-11-13T12:00:00Z',
        motivo: 'Ocupación', porId: 'coordinacion', historial: [] },
    };
    vi.mocked(guardarCorreccionRevisionGeneral).mockResolvedValue(cambio);
    render(<CorregirRevisionGeneral
      fila={fila('Asesoría Nuria Mate')} habilitada version={9}
      onGuardada={onGuardada} onCancelar={vi.fn()} />);
    expect(screen.getByText(/Local vacío con nombre de negocio|Indica la situación actual/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Estado del local'), { target: { value: '0' } });
    expect(screen.getByLabelText('Metros de fachada')).toHaveValue('');
    expect(screen.getByLabelText('Metros de fachada')).toBeDisabled();
    expect(screen.getByLabelText('Nombre del negocio')).toHaveValue('Asesoría Nuria Mate');
    expect(screen.getByText(/sin incoherencias detectadas/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar local ocupado' }));
    await waitFor(() => expect(onGuardada).toHaveBeenCalledWith(cambio));
    expect(guardarCorreccionRevisionGeneral).toHaveBeenCalledWith(
      'reg-prueba-27',9,{ vacio: '0', fachada: '' },expect.any(String),
    );
  });

  it('si hay una fachada antigua, al marcar ocupado no envía sus metros', async () => {
    const onGuardada = vi.fn();
    vi.mocked(guardarCorreccionRevisionGeneral).mockResolvedValue({
      registroId:'reg-prueba-27',version:10,
      correccion: {id:'reg-prueba-27',registroId:'reg-prueba-27',
        campanaId:'real-camp-medina-2026-censo-medina-del-campo-2026',
        valores:{vacio:'0',fachada:''},fecha:'2026-11-13',porId:'coordinacion',motivo:'Ocupación',historial:[]},
    });
    render(<CorregirRevisionGeneral fila={fila('Asesoría Nuria Mate','5')}
      habilitada version={9} onGuardada={onGuardada} onCancelar={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Estado del local'), { target:{value:'0'} });
    expect(screen.getByLabelText('Metros de fachada')).toHaveValue('');
    expect(screen.getByText(/se retirarán el 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Confirmar local ocupado'}));
    await waitFor(()=>expect(onGuardada).toHaveBeenCalledTimes(1));
    expect(guardarCorreccionRevisionGeneral).toHaveBeenCalledWith(
      'reg-prueba-27',9,{vacio:'0',fachada:''},expect.any(String),
    );
  });

  it('no permite declarar ocupado un registro sin nombre de negocio', () => {
    render(<CorregirRevisionGeneral fila={fila('')} habilitada version={9}
      onGuardada={vi.fn()} onCancelar={vi.fn()} />);
    expect(screen.getByLabelText('Estado del local')).toBeDisabled();
    expect(screen.getByRole('button',{name:'Guardar metros'})).toBeDisabled();
  });

  it('sigue permitiendo registrar únicamente metros en un local vacío', async () => {
    const onGuardada=vi.fn();
    vi.mocked(guardarCorreccionRevisionGeneral).mockResolvedValue({
      registroId:'reg-prueba-27',version:10,
      correccion:{id:'reg-prueba-27',registroId:'reg-prueba-27',
        campanaId:'real-camp-medina-2026-censo-medina-del-campo-2026',
        valores:{fachada:'5'},fecha:'2026-11-13',porId:'coordinacion',motivo:'Medición',historial:[]},
    });
    render(<CorregirRevisionGeneral fila={fila('')} habilitada version={9}
      onGuardada={onGuardada} onCancelar={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Metros de fachada'),{target:{value:'5'}});
    fireEvent.click(screen.getByRole('button',{name:'Guardar metros'}));
    await waitFor(()=>expect(onGuardada).toHaveBeenCalledTimes(1));
    expect(guardarCorreccionRevisionGeneral).toHaveBeenCalledWith('reg-prueba-27',9,{fachada:'5'},expect.any(String));
  });
});
