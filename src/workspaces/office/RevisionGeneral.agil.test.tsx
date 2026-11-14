import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import type { BaseDatos } from '../../domain/db';
import type { CambioRevisionGeneralReal } from '../../store/revisionGeneralReal';
import { guardarCorreccionRevisionGeneral } from '../../store/revisionGeneralReal';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import RevisionGeneral from './RevisionGeneral';

vi.mock('../../store/revisionGeneralReal', () => ({
  capacidadRevisionGeneral: vi.fn(async () => ({ habilitada: true, alcance: 'revision-vacios-completa' })),
  guardarCorreccionRevisionGeneral: vi.fn(),
}));

const CAMPANA = 'c26';
function datos(): BaseDatos {
  const db = baseVacia();
  db.municipios.medina = {
    id: 'medina', nombre: 'Medina del Campo', provincia: 'Valladolid', fuenteCallejero: 'osm',
  };
  db.campanas.c26 = { id: CAMPANA, municipioId: 'medina', anio: 2026, nombre: 'Censo 2026',
    tipo: 'actualizacion', periodo: { inicio: '2026-01-01' }, ambitoCalleIds: [], ampliacionCalleIds: [],
    estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
    procedencia: 'importado' };
  db.importaciones.imp = { id: 'imp', municipioId: 'medina', campanaId: CAMPANA,
    tipo: 'C-excel-itinerario', archivo: 'IT1.xlsx', huella: 'abc', fecha: '2026-11-10',
    filas: 3, estado: 'confirmada', resumen: {}, procedencia: 'importado' };
  db.itinerarios.it1 = { id: 'it1', campanaId: CAMPANA, codigo: 'IT1', nombre: 'Primero',
    origen: 'excel', color: '#009', tramos: [], asignadosIds: [], creado: '2026-11-10' };
  for (let i = 1; i <= 3; i++) db.registros[`r${i}`] = {
    id: `r${i}`, importacionId: 'imp', itinerarioId: 'it1', fila: i,
    datos: { Dirección: `Calle ${String.fromCharCode(64 + i)}`, Num: '2',
      'Local Vacío': '1', 'Nombre del negocio': '', 'Long fachada': '' },
  };
  return db;
}

function VistaContinua() {
  const [db, setDb] = useState(datos);
  const [version, setVersion] = useState(9);
  const aplicarCorreccionReal = (cambio: CambioRevisionGeneralReal) => {
    setDb((prev) => ({
      ...prev,
      correccionesRegistros: {
        ...(prev.correccionesRegistros ?? {}),
        [cambio.registroId]: cambio.correccion,
      },
    }));
    setVersion(cambio.version);
  };
  return <FuenteOficinaContext.Provider value={{
    db, campanaId: CAMPANA, personaId: 'admin', roles: ['administrador'],
    soloLectura: true, aplicar: () => false, versionReal: version, aplicarCorreccionReal,
  }}>
    <MemoryRouter><RevisionGeneral /></MemoryRouter>
  </FuenteOficinaContext.Provider>;
}

describe('Oficina · flujo continuo de revisión', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(guardarCorreccionRevisionGeneral).mockImplementation(async (registroId, version, valores) => ({
      version: version + 1, registroId,
      correccion: {
        id: registroId, registroId, campanaId: CAMPANA, valores,
        porId: 'admin', fecha: '2026-11-13T20:00:00Z', motivo: 'Medición', historial: [],
      },
    }));
  });

  it('muestra editor desde el primer registro; guardar avanza y anterior recupera el corregido', async () => {
    render(<VistaContinua />);
    expect(screen.queryByRole('button', { name: 'Preparar corrección' })).not.toBeInTheDocument();
    const detalle = screen.getByRole('region', { name: 'Detalle de la revisión' });
    expect(within(detalle).getByText('Calle A, 2')).toBeInTheDocument();
    const entrada = within(detalle).getByLabelText('Metros de fachada (solo vacíos)');
    await waitFor(() => expect(within(detalle).getByRole('button',{name:'Confirmar vacío y limpiar · Siguiente'})).toBeDisabled());
    fireEvent.change(entrada, {target: {value:'5'}});
    await waitFor(() => expect(within(detalle).getByRole('button',{name:'Confirmar vacío y limpiar · Siguiente'})).toBeEnabled());
    fireEvent.click(within(detalle).getByRole('button',{name:'Confirmar vacío y limpiar · Siguiente'}));

    await waitFor(() => expect(within(detalle).getByText('Calle B, 2')).toBeInTheDocument());
    expect(within(detalle).getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText(/2 pendientes · 1 revisadas/)).toBeInTheDocument();
    expect(screen.getByText(/Guardado correctamente/)).toBeInTheDocument();
    expect(guardarCorreccionRevisionGeneral).toHaveBeenCalledTimes(1);

    fireEvent.click(within(detalle).getByRole('button',{name:'Registro anterior'}));
    expect(within(detalle).getByText('1 / 3')).toBeInTheDocument();
    expect(within(detalle).getByText('Calle A, 2')).toBeInTheDocument();
    expect(within(detalle).getByLabelText('Metros de fachada (solo vacíos)')).toHaveValue('5');
    expect(within(detalle).getByText('No se han detectado contradicciones en esta fila.')).toBeInTheDocument();
    fireEvent.click(within(detalle).getByRole('button',{name:'Registro siguiente'}));
    expect(within(detalle).getByText('Calle B, 2')).toBeInTheDocument();
    expect(guardarCorreccionRevisionGeneral).toHaveBeenCalledTimes(1);
  });
});
