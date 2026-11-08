import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import type { BaseDatos } from '../../domain/db';
import PendientesSinLocal, { vistaBreveRegistro } from './PendientesSinLocal';

function escenario(): BaseDatos {
  const db = baseVacia();
  db.municipios.medina = { id: 'medina', nombre: 'Medina del Campo', provincia: 'Valladolid', fuenteCallejero: 'osm' };
  for (const [id, anio] of [['c25', 2025], ['c26', 2026]] as const) {
    db.campanas[id] = {
      id, anio, municipioId: 'medina', nombre: 'Censo ' + anio,
      tipo: anio === 2025 ? 'historico-importado' : 'actualizacion',
      periodo: { inicio: anio + '-01-01' }, ambitoCalleIds: [], ampliacionCalleIds: [],
      estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
      procedencia: 'importado',
    };
    db.importaciones['imp-' + id] = {
      id: 'imp-' + id, municipioId: 'medina', campanaId: id, tipo: 'C-excel-itinerario',
      archivo: id + '.xlsx', huella: id, fecha: '2026-11-07', filas: anio === 2026 ? 105 : 1,
      estado: 'confirmada', resumen: {}, procedencia: 'importado',
    };
  }
  db.itinerarios.it1 = { id: 'it1', campanaId: 'c26', codigo: 'IT1', nombre: 'Primero',
    color: '#0044ff', origen: 'excel', tramos: [], asignadosIds: [], creado: '2026-11-07' };
  db.registros.historico = { id: 'historico', importacionId: 'imp-c25', fila: 1, datos: { Negocio: 'Histórico' } };
  for (let i = 1; i <= 105; i++) {
    const id = 'fila-' + i;
    db.registros[id] = { id, importacionId: 'imp-c26', itinerarioId: 'it1', fila: i, datos: { 'Dirección': 'Calle Prueba', Num: String(i), 'Nombre del negocio': 'Negocio ' + i, Actividad: 'Peluquería' } };
    db.vinculos['v-' + i] = {
      id: 'v-' + i, origen: { tipo: 'registro', id }, localId: i <= 14 ? 'local-' + i : null,
      confianza: i <= 14 ? 'confirmada' : 'sin-vinculo', criterio: 'Prueba',
    };
  }
  return db;
}

const db = escenario();

function conG5(): BaseDatos {
  const copia = escenario();
  const imp = copia.importaciones['imp-c26'];
  copia.importaciones['imp-c26'] = { ...imp, c1: {} as NonNullable<typeof imp.c1> };
  copia.calles['calle'] = { id: 'calle', municipioId: 'medina', nombre: 'Calle Prueba', tipoVia: 'calle', segmentos: [], longitudM: 100, procedencia: 'osm', refsFuente: [] };
  copia.locales['local-antiguo'] = { id: 'local-antiguo', municipioId: 'medina', estado: 'activo', procedencia: 'importado', direcciones: [{ calleId: 'calle', numero: 15 }] };
  copia.observaciones['ref25'] = { id: 'ref25', campanaId: 'c25', localId: 'local-antiguo', calleId: 'calle', tipo: 'confirmado', fuente: 'importacion', datos: { numero: 15, nombre: 'Negocio 15', vacio: false }, verificacion: 'pendiente' };
  copia.campanas['c26'] = { ...copia.campanas['c26'], campanaReferenciaId: 'c25' };
  for (let i = 15; i <= 75; i++) {
    const id = 'fila-' + i;
    copia.vinculos['vin-' + id] = { ...copia.vinculos['v-' + i], id: 'vin-' + id };
    delete copia.vinculos['v-' + i];
    copia.observaciones['obs-' + id] = { id: 'obs-' + id, campanaId: 'c26', registroId: id, itinerarioId: 'it1', localId: null, calleId: 'calle', tipo: 'dudoso', fuente: 'importacion', datos: { numero: i, nombre: 'Negocio ' + i, vacio: false }, verificacion: 'pendiente' };
  }
  return copia;
}
function Vista({ campanaId, base = db }: { campanaId: string; base?: BaseDatos }) {
  return (
    <FuenteOficinaContext.Provider value={{
      db: base, campanaId, personaId: 'operador', roles: ['administrador'], soloLectura: true, aplicar: () => false,
    }}>
      <MemoryRouter><PendientesSinLocal /></MemoryRouter>
    </FuenteOficinaContext.Provider>
  );
}

describe('Oficina real: registros originales sin local', () => {
  it('muestra 91 de las 105 filas de IT1 sin tratar el histórico 2025 como campaña activa', () => {
    render(<Vista campanaId="c26" />);
    expect(screen.getByText(/91 registros pendientes de asociación/)).toBeInTheDocument();
    expect(screen.getByText(/91 de 91 filas/)).toBeInTheDocument();
    expect(screen.queryByText('Histórico')).not.toBeInTheDocument();
    expect(screen.queryByText('IT1 · fila 1')).not.toBeInTheDocument();
    expect(screen.getByText('IT1 · fila 15')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de IT1 · fila 15' }));
    expect(screen.getByText('Detalle de la fila 15')).toBeInTheDocument();
    expect(screen.getAllByText('Negocio 15').length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Calle Prueba').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /conciliar|guardar|vincular/i })).not.toBeInTheDocument();
  });

  it('identifica calle, negocio y actividad por cabecera, no por las primeras columnas CP o municipio', () => {
    const r = {
      id: 'r', importacionId: 'imp', fila: 1,
      datos: { CP: '47400', Num: '3', Municipio: 'Medina del Campo', 'Dirección': 'Calle Mayor', 'Nombre del negocio': 'Comercio X', Actividad: 'Moda' },
    };
    expect(vistaBreveRegistro(r)).toEqual({ calle: 'Calle Mayor', numero: '3', negocio: 'Comercio X', actividad: 'Moda' });
  });

  it('reutiliza G5 sin vincular, distingue 61 observaciones y 30 filas sin ellas', () => {
    render(<Vista campanaId="c26" base={conG5()} />);
    expect(screen.getByText(/61 filas con observación para comparar/)).toBeInTheDocument();
    expect(screen.getByText(/30 sin observación asociada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de IT1 · fila 15' }));
    expect(screen.getByText(/Propuestas de conciliación con 2025/)).toBeInTheDocument();
    expect(screen.getAllByText(/Calle Prueba, 15/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mismo portal/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirmar vínculo|guardar conciliación/i })).not.toBeInTheDocument();
  });

  it('no mezcla registros de otras campañas', () => {
    render(<Vista campanaId="c25" />);
    expect(screen.getByText(/1 registros pendientes de asociación/)).toBeInTheDocument();
    expect(screen.queryByText('IT1 · fila 15')).not.toBeInTheDocument();
  });
});
