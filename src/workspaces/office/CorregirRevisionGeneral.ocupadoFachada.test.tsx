import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { revisarRegistroGeneral, type FilaRevisionGeneral } from '../../domain/revisionGeneral';
import { guardarCorreccionRevisionGeneral } from '../../store/revisionGeneralReal';
import CorregirRevisionGeneral from './CorregirRevisionGeneral';

vi.mock('../../store/revisionGeneralReal', () => ({
  guardarCorreccionRevisionGeneral: vi.fn(),
  deshacerLimpiezaVacio: vi.fn(),
}));

function filaOcupada(): FilaRevisionGeneral {
  const registro = {
    id: 'it5-fila-26-sintetico',
    importacionId: 'importacion-it5', itinerarioId: 'it5', fila: 26,
    datos: {
      'Local Vacío': '0', 'Nombre del negocio': 'Salón del Reino de los Testigos de Jehová',
      'Long fachada': '8', 'Actividad': 'Salón de reuniones',
      Dirección: 'Calle Duque de Ahumada', Num: '9',
    },
  };
  const resultado = revisarRegistroGeneral(registro);
  return {
    id: registro.id, registro, archivo: 'ITINERARIO 5 MEDINA.xlsx',
    itinerario: 'IT5', direccion: 'Calle Duque de Ahumada',
    numero: '9', nombre: 'Salón del Reino de los Testigos de Jehová',
    estado: resultado.estado, incidencias: resultado.incidencias,
  };
}

describe('Fase 1 · IT5 fila 26: ocupado con metros indebidos', () => {
  beforeEach(() => vi.clearAllMocks());
  it('habilita Quitar metros y siguiente sin cambiar nombre ni estado', async () => {
    const fila = filaOcupada();
    const original = structuredClone(fila.registro);
    const cambio = {
      registroId: fila.id, version: 12, accion: 'limpiar-fachada' as const,
      correccion: {
        id: fila.id, registroId: fila.id,
        campanaId: 'real-camp-medina-2026-censo-medina-del-campo-2026',
        valores: { fachada: '' }, fecha: '2026-11-14T12:00:00Z', porId: 'coordinacion',
        motivo: 'Retirar fachada de ocupado', tipoRevision: 'fachada' as const,
        historial: [],
      },
    };
    vi.mocked(guardarCorreccionRevisionGeneral).mockResolvedValueOnce(cambio);
    const onGuardada = vi.fn();
    render(<CorregirRevisionGeneral fila={fila} habilitada version={11}
      onGuardada={onGuardada} onCancelar={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Local ocupado' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Nombre del negocio'))
      .toHaveValue('Salón del Reino de los Testigos de Jehová');
    expect(screen.getByLabelText('Metros de fachada (solo vacíos)')).toBeDisabled();
    expect(screen.getByText(/Se quitarán únicamente los metros/)).toBeInTheDocument();
    const guardar = screen.getByRole('button', { name: 'Quitar metros y siguiente' });
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);
    await waitFor(() => expect(onGuardada).toHaveBeenCalledWith(cambio));
    expect(guardarCorreccionRevisionGeneral).toHaveBeenCalledWith(
      fila.id, 11, { fachada: '' }, expect.any(String),
    );
    expect(fila.registro).toEqual(original);
    expect(revisarRegistroGeneral(fila.registro, { fachada: '' }).incidencias).toEqual([]);
  });

  it('si el local ocupado ya no tiene metros, no permite otro guardado', () => {
    const fila = filaOcupada();
    fila.registro.datos['Long fachada'] = '';
    fila.incidencias = revisarRegistroGeneral(fila.registro).incidencias;
    render(<CorregirRevisionGeneral fila={fila} habilitada version={11}
      onGuardada={vi.fn()} onCancelar={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Confirmar ocupado · Siguiente' })).toBeDisabled();
  });
});
