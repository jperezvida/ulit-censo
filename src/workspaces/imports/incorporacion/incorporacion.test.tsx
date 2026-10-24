import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import IncorporacionPage from './IncorporacionPage';
import { useAsistente } from './estadoAsistente';
import { useStore } from '../../../store/store';
import { generarDemo } from '../../../data/semilla';
import { callejeroSimulado, MEDINA } from '../../../data/callejero';
import { ANOMALIAS_ESCENARIO, MUNICIPIO_DEMO, prepararMunicipioDemo } from '../../../data/escenarioIncorporacion';
import { filasOficina } from '../../../domain/oficina';
import { indiceObservaciones, indiceOcupaciones } from '../../../domain/consultas';
import type { BaseDatos } from '../../../domain/db';

/** Escenario FICTICIO generado por la aplicación. */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

const vista2026 = (db: BaseDatos) => {
  const ix = { obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) };
  return JSON.stringify([db.campanas['camp-medina-2026'], filasOficina(db, 'camp-medina-2026', ix)]);
};

function montar() {
  return render(
    <MemoryRouter initialEntries={['/datos/incorporar']}>
      <Routes>
        <Route path="/datos/incorporar" element={<IncorporacionPage />} />
        <Route path="/datos" element={<div>Página de Datos</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const esperar = <T,>(fn: () => T) => waitFor(fn, { timeout: 60000 });

describe('C1d-A · Asistente de incorporación con el escenario ficticio de Medina', () => {
  it('recorre las cinco etapas, registra decisiones trazadas, incorpora, protege 2026 y deshace', async () => {
    const db0 = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'c1d-ui' });
    useStore.setState({ db: db0, pilaDeshacer: [], pilaRehacer: [], prefs: { ...useStore.getState().prefs, personaId: 'p-elena', roles: ['coordinador', 'revisor'] } });
    useAsistente.getState().reiniciar();
    const antes2026 = vista2026(db0);
    montar();

    // ── Etapa 1: origen y destino. Ninguna forma de subir un archivo para incorporarlo.
    expect(document.querySelector('input[type=file]')).toBeNull();
    const mun = screen.getByLabelText('Municipio') as HTMLSelectElement;
    expect([...mun.options].filter((o) => !o.disabled).map((o) => o.value)).toEqual([MUNICIPIO_DEMO.id]);
    expect(screen.getByLabelText('Histórico frente a campaña actual')).toHaveTextContent(/no se toca 2026/);
    expect(screen.getByRole('button', { name: /Analizar el archivo/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Preparar escenario ficticio/ }));
    await esperar(() => screen.getByText('Escenario preparado'));
    fireEvent.click(screen.getByRole('button', { name: /Analizar el archivo/ }));

    // ── Etapa 2: diagnóstico y revisión por grupos
    const diag = await esperar(() => screen.getByLabelText('Diagnóstico'));
    expect(diag).toHaveTextContent('890');
    expect(diag).toHaveTextContent('641 ocupados · 246 vacíos');
    expect(diag).toHaveTextContent('298');
    const rev = screen.getByLabelText('Revisión por grupos');
    fireEvent.change(within(rev).getByLabelText('Buscar en la revisión'), { target: { value: String(ANOMALIAS_ESCENARIO.numRedes380) } });
    expect(within(rev).getByText('redes-discrepa')).toBeInTheDocument();
    fireEvent.change(within(rev).getByLabelText('Buscar en la revisión'), { target: { value: '' } });
    fireEvent.click(within(rev).getByRole('button', { name: 'Grupo Long fachada con unidad' }));
    expect(within(rev).getByText('«3,5 m»')).toBeInTheDocument();
    expect(within(rev).getAllByText('Pendiente de la Cátedra').length).toBeGreaterThan(0);

    // ── Etapa 3: decisiones (se abre en «Calles»; las interpretaciones están en su pestaña)
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Decisiones/ }));
    expect(screen.getByLabelText('Conciliación de calles')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Interpretaciones' }));
    // Sin el rol adecuado no se pueden registrar decisiones
    act(() => useStore.setState({ prefs: { ...useStore.getState().prefs, roles: ['revisor'] } }));
    expect(screen.getAllByText(/requiere el rol de coordinación o administración/).length).toBeGreaterThan(0);
    act(() => useStore.setState({ prefs: { ...useStore.getState().prefs, roles: ['coordinador'] } }));
    // Autorizar SOLO la regla «3,5 m»: el diccionario sigue pendiente, texto por texto
    fireEvent.click(screen.getByRole('button', { name: /Registrar autorización de la Cátedra/ }));
    fireEvent.change(screen.getByLabelText('Referencia del acuerdo de la Cátedra (obligatoria)'), { target: { value: 'Acta ficticia 1/2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await esperar(() => expect(useAsistente.getState().cargando).toBeNull());
    await esperar(() => expect(useAsistente.getState().preparado!.resultado.opciones.reglasAutorizadas).toEqual(['fachada-con-unidad']));
    expect(useAsistente.getState().decisiones.reglasAutorizadas![0]).toMatchObject({ regla: 'fachada-con-unidad', porId: 'p-elena', motivo: 'Acta ficticia 1/2026' });
    expect(screen.getAllByRole('button', { name: /Registrar aprobación del texto/ })).toHaveLength(2);

    // Correspondencia: una dirección S/N pasa a local nuevo, con motivo
    fireEvent.click(screen.getByRole('tab', { name: 'Correspondencias' }));
    const sn = ANOMALIAS_ESCENARIO.sn[0];
    fireEvent.change(screen.getByLabelText(`Correspondencia de la fila ${sn}`), { target: { value: 'nuevo' } });
    fireEvent.change(screen.getByLabelText(`Motivo de la fila ${sn}`), { target: { value: 'Comprobado en campo (ficticio)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await esperar(() => screen.getByText('Crear un local para esta fila', { selector: 'b' }));

    // Exclusión de la posible fila de totales
    fireEvent.click(screen.getByRole('tab', { name: 'Exclusiones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir esta fila' }));
    fireEvent.change(screen.getByLabelText('Motivo de la exclusión (obligatorio)'), { target: { value: 'Fila de totales' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await esperar(() => expect(useAsistente.getState().preparado!.plan.registros.excluidos).toBe(1));

    // Volver atrás no pierde nada
    fireEvent.click(screen.getByRole('button', { name: /Anterior/ }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Decisiones/ }));
    expect(useAsistente.getState().decisiones).toMatchObject({ reglasAutorizadas: [{ regla: 'fachada-con-unidad' }], correspondencias: [{ fila: sn }], exclusiones: [{ fila: 891 }] });

    // Clasificación histórica: se distingue conservar de confirmar
    fireEvent.click(screen.getByRole('tab', { name: 'Clasificación histórica' }));
    expect(screen.getByText(/Conservar no es confirmar/)).toBeInTheDocument();

    // ── Etapa 4: confirmación (el plan se recalcula al entrar)
    fireEvent.click(screen.getByRole('button', { name: /Siguiente: Confirmación/ }));
    await esperar(() => expect(useAsistente.getState().cargando).toBeNull());
    const crear = await esperar(() => screen.getByLabelText('Entidades que se crearán'));
    expect(within(crear).getByText('Locales físicos nuevos').nextSibling).toHaveTextContent('847');
    expect(screen.getByLabelText('Cambios en datos existentes')).toHaveTextContent('Ninguna entidad existente se modifica');
    const boton = screen.getByRole('button', { name: /Incorporar al modelo/ });
    expect(boton).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Confirmo la incorporación'));
    expect(boton).toBeEnabled();
    fireEvent.click(boton);

    // ── Etapa 5: resultado
    const res = await esperar(() => screen.getByLabelText('Resultado'));
    expect(res).toHaveTextContent('Registros incorporados890');
    expect(res).toHaveTextContent('Locales creados847');
    expect(res).toHaveTextContent('Guardado en el almacenamiento de este navegador');
    const imp = useAsistente.getState().aplicado!.importacionId;
    const db1 = useStore.getState().db!;
    expect(db1.importaciones[imp]).toMatchObject({ estado: 'confirmada', c1: { porId: 'p-elena', algoritmoHuellas: 'sha256' } });
    expect(db1.registros[`reg-${imp}-891`].exclusion).toMatchObject({ motivo: 'Fila de totales' });
    expect(vista2026(db1)).toBe(antes2026);
    expect(useStore.getState().pilaDeshacer).toEqual([]);

    // ── Deshacer: vista previa y confirmación
    fireEvent.click(screen.getByRole('button', { name: /Deshacer la incorporación…/ }));
    const prev = screen.getByLabelText('Vista previa del deshacer');
    expect(prev).toHaveTextContent('Registros de origen (filas)890');
    expect(prev).toHaveTextContent(/marcado como «deshecha»/);
    fireEvent.click(screen.getByLabelText('Confirmo que quiero deshacer'));
    fireEvent.click(screen.getByRole('button', { name: /^Deshacer la incorporación$/ }));
    await esperar(() => expect(useStore.getState().db!.importaciones[imp].estado).toBe('descartada'));
    const db2 = useStore.getState().db!;
    expect(Object.values(db2.registros).some((r) => r.importacionId === imp)).toBe(false);
    expect(Object.values(db2.campanas).filter((c) => c.municipioId === MUNICIPIO_DEMO.id)).toEqual([]);
    expect(vista2026(db2)).toBe(antes2026);
    await esperar(() => screen.getByText(/Esta incorporación se ha deshecho/));
  }, 240000);

  it('reinicio con guardado fallido: el cuadro sigue abierto, no se anuncia como guardado y se reintenta sin repetir la operación', async () => {
    const db0 = prepararMunicipioDemo(generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'c1d-reinicio' }));
    const original = { aplicarConGuardado: useStore.getState().aplicarConGuardado, reintentarGuardado: useStore.getState().reintentarGuardado };
    let operaciones = 0;
    let reintentos = 0;
    let falla = true;
    // Simula un almacenamiento del navegador que falla: la operación se aplica en memoria, el guardado no.
    useStore.setState({
      db: db0, pilaDeshacer: [], pilaRehacer: [], prefs: { ...useStore.getState().prefs, personaId: 'p-elena', roles: ['coordinador'] },
      aplicarConGuardado: async (fn) => {
        operaciones++;
        useStore.setState({ db: fn(useStore.getState().db!), guardado: { estado: 'error' } });
        return { aplicado: true, guardado: false, error: 'No se ha podido guardar (simulado).' };
      },
      reintentarGuardado: async () => {
        reintentos++;
        return falla ? { guardado: false, error: 'Sigue sin poder guardarse (simulado).' } : { guardado: true };
      },
    });
    useAsistente.getState().reiniciar();
    try {
      montar();
      fireEvent.click(screen.getByRole('button', { name: /Reiniciar escenario/ }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reiniciar' }));
      const aviso = await esperar(() => within(screen.getByRole('dialog')).getByLabelText('Guardado fallido'));
      expect(aviso).toHaveTextContent(/no se ha guardado.*No se ha podido guardar \(simulado\)/);
      expect(useStore.getState().db!.municipios[MUNICIPIO_DEMO.id]).toBeUndefined();
      // Sin «Reiniciar» de nuevo: solo se puede reintentar el guardado
      expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Reiniciar' })).toBeNull();
      fireEvent.click(within(aviso).getByRole('button', { name: /Reintentar guardado/ }));
      await esperar(() => expect(within(screen.getByRole('dialog')).getByLabelText('Guardado fallido')).toHaveTextContent(/Sigue sin poder guardarse/));
      falla = false;
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Reintentar guardado/ }));
      await esperar(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(operaciones).toBe(1);
      expect(reintentos).toBe(2);
    } finally {
      useStore.setState(original);
    }
  });
});
