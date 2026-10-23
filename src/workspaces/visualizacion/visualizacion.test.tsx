import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import VisualizacionPage from './VisualizacionPage';
import { useStore } from '../../store/store';
import { generarDemo } from '../../data/semilla';
import { callejeroSimulado, MEDINA } from '../../data/callejero';
import { MUNICIPIO_DEMO, prepararMunicipioDemo } from '../../data/escenarioIncorporacion';
import { aplicarEscenario, prepararEscenario } from '../../domain/incorporacionDemo';
import { validarInstantanea } from '../../data/instantaneaOsm';
import { instantaneaSintetica } from '../../data/fixtureOsmSintetico';
import type { Calle } from '../../domain/types';

/** Datos FICTICIOS: demostración + escenario generado por la aplicación. */
beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const demo = prepararMunicipioDemo(generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'vz' }));
  const p = await prepararEscenario(demo, 'medina-2025-ficticio', 2025, {});
  const r = await aplicarEscenario(demo, 'medina-2025-ficticio', 2025, p.resultado, {}, p.plan, 'p-elena');
  useStore.setState({ db: r.db, prefs: { ...useStore.getState().prefs, municipioId: 'mun-medina', campanaId: 'camp-medina-2026' } });
}, 120000);

const montar = () => render(<MemoryRouter><VisualizacionPage /></MemoryRouter>);
/** Contador de la barra de filtros («N de M establecimientos observados»). */
const contador = () => within(screen.getByRole('group', { name: 'Filtros' })).getByText(/de \d+ establecimientos observados/).textContent ?? '';

describe('C1d-B · Dashboard', () => {
  it('ámbito, año y emblema neutro; tipos de ámbito sin datos deshabilitados', () => {
    montar();
    expect(screen.getByRole('img', { name: /Identificador neutro de Medina del Campo \(sin escudo verificado\)/ })).toBeInTheDocument();
    const tipos = screen.getByLabelText('Tipo de ámbito') as HTMLSelectElement;
    expect([...tipos.options].filter((o) => o.disabled).map((o) => o.textContent)).toEqual(['Barrio (sin datos)', 'Eje comercial (sin datos)', 'Zona de estudio (sin datos)', 'Mercado municipal (sin datos)']);
    expect(screen.getByRole('tablist', { name: 'Año y campaña' })).toHaveTextContent(/2026.*en curso.*2025.*histórico/);
    // Sin CP en el origen: el filtro está deshabilitado (no se deduce)
    expect(screen.getByLabelText('Filtro de código postal')).toBeDisabled();
  });

  it('histórico importado: aviso de referencia, cifras separadas y filtros vinculados', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    const aviso = screen.getByLabelText('Origen de los datos');
    expect(aviso).toHaveTextContent(/Histórico importado · 2025/);
    expect(aviso).toHaveTextContent(/620 con el texto original de 2025 \(sin convertir al catálogo 2026\)/);
    expect(aviso).toHaveTextContent(/Datos de demostración/);
    // Cinco indicadores principales en una tira
    const kpis = screen.getByRole('group', { name: 'Indicadores principales' });
    expect(kpis).toHaveTextContent('Establecimientos860846 locales · 14 sin local');
    expect(kpis).toHaveTextContent(/Tasa de ocupación72,1 %620 de 860/);
    expect(kpis).toHaveTextContent(/Locales vacíos240.*Negocios620.*Franquicias \(Sí\)9,4 %58 de 619 Sí\/No/);
    expect(kpis.children).toHaveLength(5);
    // Composición: la leyenda es un control de filtro por sector (y se desactiva al repetir)
    const comp = screen.getByRole('region', { name: 'Composición de los establecimientos observados' });
    const btnCom = within(comp).getByRole('button', { name: /^Comercio/ });
    fireEvent.click(btnCom);
    expect((screen.getByLabelText('Filtro de sector') as HTMLSelectElement).value).toBe('Comercio');
    fireEvent.click(within(screen.getByRole('region', { name: 'Composición de los establecimientos observados' })).getByRole('button', { name: /^Comercio/ }));
    expect((screen.getByLabelText('Filtro de sector') as HTMLSelectElement).value).toBe('');
    // Registros censales y correspondencias se explican en «Cómo leer estas cifras» y en Cobertura
    expect(screen.getByLabelText('Cómo leer estas cifras')).toHaveTextContent(/Registros censales890 filas importadas; 30 sin establecimiento observado/);
    // Filtro vinculado: pulsar un sector filtra todo
    fireEvent.click(within(screen.getByLabelText('Distribución por sector')).getByRole('row', { name: /^Servicios 203/ }));
    expect((screen.getByLabelText('Filtro de sector') as HTMLSelectElement).value).toBe('Servicios');
    expect(contador()).toMatch(/^\d+ de 860/);
    fireEvent.change(screen.getByLabelText('Filtro de sector'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filtro de franquicia'), { target: { value: 'si' } });
    expect(contador()).toMatch(/^58 de 860/);
  });

  it('pestañas de vacíos, digitalización (estado importado, sin coordenadas inventadas) y comparar con avisos de cobertura', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    fireEvent.click(screen.getByRole('tab', { name: 'Locales vacíos' }));
    expect(screen.getByText('CP con más vacíos').parentElement).toHaveTextContent('47400');
    fireEvent.click(screen.getByRole('tab', { name: 'Digitalización 1' }));
    expect(screen.getAllByLabelText('Estado de la revisión digital')[0]).toHaveTextContent(/Verificada 0 .*Borrador o importada 620 100 %/);
    expect(screen.getByText(/no tienen geometría fiable/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mapa de calor por calle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Digitalización 2' }));
    expect(screen.getByText(/Solo se calcula con los seis respondidos/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Comparar' }));
    fireEvent.change(screen.getByLabelText('Campaña con la que comparar'), { target: { value: 'camp-medina-2025' } });
    expect(screen.getAllByRole('note').some((n) => /Las diferencias no son aperturas ni cierres confirmados/.test(n.textContent ?? ''))).toBe(true);
    // Ámbitos distintos: comparación descriptiva, sin diferencias aritméticas
    expect(screen.getByLabelText('Ámbitos territoriales distintos')).toHaveTextContent(/no se calculan diferencias/);
    expect(within(screen.getByRole('table', { name: 'Comparación' })).queryByRole('columnheader', { name: 'Diferencia' })).toBeNull();
    expect(screen.queryByText(/diferencia de cifras:/)).toBeNull();
  });

  it('una campaña con geometría muestra el mapa por calle', () => {
    montar();
    fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Digitalización 1' }));
    expect(screen.getByRole('img', { name: 'Mapa por calle' })).toBeInTheDocument();
  });

  it('comparar: al cambiar el año principal, la campaña secundaria nunca es la misma y se avisa del cambio', () => {
    montar();
    fireEvent.click(screen.getByRole('tab', { name: 'Comparar' }));
    const sel = () => screen.getByLabelText('Campaña con la que comparar') as HTMLSelectElement;
    fireEvent.change(sel(), { target: { value: 'camp-medina-2025' } });
    expect(sel().value).toBe('camp-medina-2025');
    expect(screen.queryByLabelText('Selección de comparación cambiada')).toBeNull();
    // Con la pestaña Comparar abierta, el año principal pasa a ser 2025 (la campaña elegida).
    fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
    expect(sel().value).not.toBe('camp-medina-2025');
    expect([...sel().options].map((o) => o.value)).not.toContain('camp-medina-2025');
    expect([...sel().options].map((o) => o.value)).toContain(sel().value);
    expect(screen.getByLabelText('Selección de comparación cambiada')).toHaveTextContent(/es ahora la campaña principal: una campaña no se compara consigo misma/);
    const cab = within(screen.getByRole('table', { name: 'Comparación' })).getAllByRole('columnheader').map((h) => h.textContent);
    expect(cab[1]).not.toBe(cab[2]);
    // Elegir de nuevo explícitamente quita el aviso.
    fireEvent.change(sel(), { target: { value: 'camp-medina-2026' } });
    expect(screen.queryByLabelText('Selección de comparación cambiada')).toBeNull();
  });

  it('locales vacíos: los filtros de sector y franquicia no producen un cero engañoso; se explica y se pueden quitar', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    fireEvent.change(screen.getByLabelText('Filtro de sector'), { target: { value: 'Comercio' } });
    fireEvent.change(screen.getByLabelText('Filtro de franquicia'), { target: { value: 'no' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Locales vacíos' }));
    expect(screen.getByLabelText('Filtros no aplicados')).toHaveTextContent(/no se aplica el filtro de sector «Comercio» ni el de franquicia «No»/);
    expect(screen.getByText('Locales vacíos', { selector: '.vz-kpi-etq' }).parentElement).toHaveTextContent(/Locales vacíos240/);
    expect(contador()).toMatch(/^860 de 860/);
    // Los filtros siguen activos en las demás pestañas
    fireEvent.click(screen.getByRole('tab', { name: 'Resumen' }));
    expect(contador()).not.toMatch(/^860 de/);
    fireEvent.click(screen.getByRole('tab', { name: 'Locales vacíos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar estos filtros' }));
    expect(screen.queryByLabelText('Filtros no aplicados')).toBeNull();
    expect((screen.getByLabelText('Filtro de sector') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Filtro de franquicia') as HTMLSelectElement).value).toBe('');
  });

  it('rediseño: ranking con criterio, pestaña sectorial con comparación, filtro de calle y trazabilidad de calidad', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    // Resumen: distribución sectorial en una sola tabla (sin gráficos repetidos)
    expect(screen.getByRole('table', { name: 'Distribución sectorial (tabla)' })).toHaveTextContent(/Comercio29234 %47,1 %/);
    expect(screen.queryByRole('img', { name: 'Distribución por grandes grupos' })).toBeNull();
    // Comercio: indicadores con su denominador y comparación con los otros sectores
    fireEvent.click(screen.getByRole('tab', { name: 'Comercio' }));
    expect(screen.getByLabelText('Indicadores de Comercio')).toHaveTextContent(/Peso en ocupados47,1 %292 de 620 ocupados/);
    expect(screen.getByRole('table', { name: 'Comparación con los otros sectores' })).toHaveTextContent(/Establecimientos292203125/);
    // Filtro de calle desde el selector y «Limpiar filtros»
    const calle = screen.getByLabelText('Filtro de calle') as HTMLSelectElement;
    fireEvent.change(calle, { target: { value: calle.options[1].value } });
    expect(contador()).not.toMatch(/^292 de/);
    fireEvent.click(screen.getByRole('button', { name: /Limpiar filtros/ }));
    expect(calle.value).toBe('');
    // Cobertura y calidad: del registro al establecimiento, sin restas
    fireEvent.click(screen.getByRole('tab', { name: 'Cobertura y calidad' }));
    expect(screen.getByLabelText('Indicadores de cobertura y calidad')).toHaveTextContent(/Sin establecimiento30/);
    expect(screen.getByLabelText('Trazabilidad: del registro al establecimiento')).toHaveTextContent(/890Filas importadas.*860Con establecimiento observado.*14Sin local identificado/);
  });

  it('avisos de origen calculados: un histórico con clasificaciones confirmadas no se presenta como «sin convertir»', () => {
    montar();
    // Medina 2025 (demostración): campaña de tipo histórico importado, con clasificaciones confirmadas en el modelo
    fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
    const aviso = screen.getByLabelText('Origen de los datos');
    expect(aviso).toHaveTextContent(/Histórico importado · 2025/);
    expect(aviso).toHaveTextContent(/474 confirmadas en el modelo/);
    expect(aviso).not.toHaveTextContent(/sin convertir/);
    expect(aviso).toHaveTextContent(/se refieren a la campaña de 2025, no son comprobaciones de 2026/);
    expect(aviso).toHaveTextContent(/Datos de demostración: los estados «confirmada» y «verificada» son ficticios/);
    // Mismo municipio: la comparación sí calcula diferencias
    fireEvent.click(screen.getByRole('tab', { name: 'Comparar' }));
    fireEvent.change(screen.getByLabelText('Campaña con la que comparar'), { target: { value: 'camp-medina-2026' } });
    expect(screen.queryByLabelText('Ámbitos territoriales distintos')).toBeNull();
    expect(within(screen.getByRole('table', { name: 'Comparación' })).getByRole('columnheader', { name: 'Diferencia' })).toBeInTheDocument();
  });

  it('Resumen sin geometría: matriz calle × sector y cuatro rankings simultáneos, con selección vinculada', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    expect(screen.queryByRole('img', { name: /^Mapa/ })).toBeNull();
    const matriz = screen.getByRole('table', { name: 'Matriz territorial: calles × sector' });
    const rankings = screen.getByRole('region', { name: 'Rankings de calles' });
    for (const t of ['comercio', 'servicios', 'hostelería y restauración', 'locales vacíos']) expect(within(rankings).getByLabelText(`Calles con más ${t}`).querySelectorAll('li')).toHaveLength(5);
    // Pulsar una calle en la matriz la fija también en los rankings donde aparece
    const fila = within(matriz).getAllByRole('row')[1];
    const calle = within(fila).getByRole('button').textContent!;
    fireEvent.click(within(fila).getByRole('button'));
    expect(fila).toHaveClass('fijada');
    const enRankings = within(rankings).queryAllByRole('button', { name: calle });
    for (const b of enRankings) expect(b.closest('li')).toHaveClass('fijada');
    // Con filtro de sector, el mapa y los rankings siguen comparando los cuatro grupos y lo dicen
    fireEvent.change(screen.getByLabelText('Filtro de sector'), { target: { value: 'Comercio' } });
    expect(screen.getByText(/no se aplican al mapa ni a los rankings/)).toBeInTheDocument();
    expect(within(rankings).getByLabelText('Calles con más locales vacíos').querySelectorAll('li')).toHaveLength(5);
  });

  it('Resumen con geometría: mapa agregado por calle con capas, escala por cuantiles y selección desde los rankings', () => {
    montar();
    fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
    expect(screen.getByRole('img', { name: 'Mapa por calle: Ocupación' })).toBeInTheDocument();
    expect(screen.getByLabelText('Escala: Ocupación').querySelectorAll('i').length).toBeGreaterThan(2);
    fireEvent.click(within(screen.getByRole('group', { name: 'Capa del mapa' })).getByRole('button', { name: 'Vacíos' }));
    expect(screen.getByRole('img', { name: 'Mapa por calle: Locales vacíos' })).toBeInTheDocument();
    // Seleccionar desde el ranking: ficha de la calle junto al mapa y opción de filtrar todo el cuadro
    const boton = within(screen.getByLabelText('Calles con más comercio')).getAllByRole('button')[0];
    fireEvent.click(boton);
    const ficha = screen.getByLabelText('Calle seleccionada');
    expect(ficha).toHaveTextContent(boton.textContent!);
    fireEvent.click(within(ficha).getByRole('button', { name: 'Filtrar por esta calle' }));
    expect((screen.getByLabelText('Filtro de calle') as HTMLSelectElement).selectedOptions[0].textContent).toContain(boton.textContent!);
  });

  it('selector de vista: «Por calles» conserva el sistema actual aunque haya coordenadas; «Por establecimientos» dibuja un punto por local', () => {
    const antes = useStore.getState().db!;
    const ids = Object.values(antes.locales).filter((l) => l.municipioId === 'mun-medina' && l.coord).slice(0, 12).map((l) => l.id);
    const locales = { ...antes.locales };
    for (const id of ids) locales[id] = { ...locales[id], coordVerificada: { fuente: 'gps-campo', fecha: '2026-09-10' } };
    useStore.setState({ db: { ...antes, locales } });
    try {
      montar();
      fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
      const vistas = screen.getByRole('group', { name: 'Vista del mapa' });
      // Por defecto, por calles con sus cinco capas, aunque una parte tenga coordenadas verificadas
      expect(within(vistas).getByRole('button', { name: 'Por calles' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('img', { name: 'Mapa por calle: Ocupación' }).querySelectorAll('circle.vz-punto')).toHaveLength(0);
      expect(within(screen.getByRole('group', { name: 'Capa del mapa' })).getAllByRole('button')).toHaveLength(5);
      fireEvent.click(within(vistas).getByRole('button', { name: 'Por establecimientos' }));
      expect(screen.queryByRole('group', { name: 'Capa del mapa' })).toBeNull();
      const mapa = screen.getByRole('img', { name: 'Mapa por establecimientos (ubicaciones simuladas)' });
      const puntos = mapa.querySelectorAll('circle.vz-punto');
      const n25 = Number(/^(\d+) de/.exec(contador())![1]);
      expect(puntos.length).toBeGreaterThan(0);
      expect(puntos.length).toBeLessThanOrEqual(n25);
      expect(new Set([...puntos].map((c) => c.getAttribute('data-clave'))).size).toBe(puntos.length);
      // Las verificadas prevalecen; el resto (ficticio) es simulado y se dice de forma inequívoca
      expect([...puntos].filter((c) => c.getAttribute('data-tipo') === 'verificada').length).toBeGreaterThan(0);
      expect(screen.getByRole('note', { name: 'Ubicaciones simuladas' })).toHaveTextContent('No son coordenadas');
      expect(screen.getByText(/con ubicación simulada · \d+ con coordenadas verificadas/)).toBeInTheDocument();
      // Leyenda por categoría (comercio, servicios, hostelería, vacíos) que oculta y muestra
      const ley = screen.getByRole('group', { name: 'Leyenda: categorías de establecimiento' });
      const vac = within(ley).getByRole('button', { name: /^Vacíos/ });
      const nVac = Number(vac.textContent!.replace(/\D/g, ''));
      fireEvent.click(vac);
      expect(screen.getByRole('img', { name: /^Mapa por establecimientos/ }).querySelectorAll('circle.vz-punto')).toHaveLength(puntos.length - nVac);
      fireEvent.click(vac);
      // Volver a «Por calles» recupera exactamente el mapa agregado
      fireEvent.click(within(vistas).getByRole('button', { name: 'Por calles' }));
      expect(screen.getByRole('img', { name: 'Mapa por calle: Ocupación' })).toBeInTheDocument();
      // Nada se ha guardado: los locales no verificados siguen sin verificar
      expect(Object.values(useStore.getState().db!.locales).filter((l) => l.coordVerificada)).toHaveLength(ids.length);
    } finally {
      useStore.setState({ db: antes });
    }
  });

  it('ficha del establecimiento al pulsar un punto, y locales del mismo portal como puntos independientes', () => {
    const antes = useStore.getState().db!;
    // Dos locales ficticios en el mismo portal (misma calle y número): siguen siendo dos locales
    const obs = Object.values(antes.observaciones).filter((o) => o.campanaId === 'camp-medina-2025' && o.localId && !o.datos.vacio && o.datos.negocioId);
    const a = obs[0];
    const b = obs.find((o) => o.calleId === a.calleId && o.localId !== a.localId && o.datos.negocioId)!;
    const locales = { ...antes.locales };
    const dir = antes.locales[a.localId!].direcciones;
    locales[b.localId!] = { ...locales[b.localId!], direcciones: [{ ...dir[dir.length - 1] }] };
    const observaciones = { ...antes.observaciones, [b.id]: { ...b, datos: { ...b.datos, numero: a.datos.numero, sufijo: a.datos.sufijo } } };
    useStore.setState({ db: { ...antes, locales, observaciones } });
    try {
      montar();
      fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
      fireEvent.click(within(screen.getByRole('group', { name: 'Vista del mapa' })).getByRole('button', { name: 'Por establecimientos' }));
      const mapa = screen.getByRole('img', { name: /^Mapa por establecimientos/ });
      const pa = mapa.querySelector(`circle[data-clave="${a.localId}"]`)!;
      const pb = mapa.querySelector(`circle[data-clave="${b.localId}"]`)!;
      expect(pa).toBeTruthy();
      expect(pb).toBeTruthy();
      // Expandidos: dos puntos en posiciones de dibujo distintas, unidos a su portal
      expect(`${pa.getAttribute('cx')},${pa.getAttribute('cy')}`).not.toBe(`${pb.getAttribute('cx')},${pb.getAttribute('cy')}`);
      expect(mapa.querySelectorAll('.vz-grupo line').length).toBeGreaterThanOrEqual(2);
      fireEvent.click(pa);
      const ficha = screen.getByLabelText('Establecimiento seleccionado');
      const nombre = antes.negocios[a.datos.negocioId!].nombre;
      expect(ficha).toHaveTextContent(nombre);
      expect(ficha).toHaveTextContent(`${antes.calles[a.calleId].nombre}, ${a.datos.numero}`);
      expect(ficha).toHaveTextContent(/EstadoOcupado/);
      expect(ficha).toHaveTextContent(/Sector ?(Comercio|Servicios|Hostelería y Restauración)/);
      expect(ficha).toHaveTextContent('Ubicación simulada a partir del callejero · no es una coordenada');
      // El otro local del portal aparece aparte y se puede abrir
      expect(ficha).toHaveTextContent('Mismo portal: 2 locales independientes');
      fireEvent.click(within(ficha).getByRole('button', { name: antes.negocios[b.datos.negocioId!].nombre }));
      expect(screen.getByLabelText('Establecimiento seleccionado')).toHaveTextContent(antes.negocios[b.datos.negocioId!].nombre);
      fireEvent.click(screen.getByRole('button', { name: 'Cerrar la ficha' }));
      expect(screen.queryByLabelText('Establecimiento seleccionado')).toBeNull();
    } finally {
      useStore.setState({ db: antes });
    }
  });

  it('sin geometría (escenario ficticio C1d) la vista por establecimientos no está disponible y lo explica', () => {
    montar();
    fireEvent.change(screen.getByLabelText('Ámbito'), { target: { value: MUNICIPIO_DEMO.id } });
    const b = within(screen.getByRole('group', { name: 'Vista del mapa' })).getByRole('button', { name: 'Por establecimientos' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('title', expect.stringMatching(/no tienen geometría/));
    expect(screen.getByRole('table', { name: 'Matriz territorial: calles × sector' })).toBeInTheDocument();
    expect(screen.queryByRole('note', { name: 'Ubicaciones simuladas' })).toBeNull();
  });

  it('callejero con forma OSM: calles atribuidas (ODbL) y negocios, portales y ubicaciones señalados como ficticios', () => {
    const antes = useStore.getState();
    const calles = (validarInstantanea(instantaneaSintetica()) as { calles: Calle[] }).calles;
    useStore.setState({ db: generarDemo({ calles, fuente: 'instantanea-osm', detalleFuente: 'prueba' }), prefs: { ...antes.prefs, municipioId: 'mun-medina', campanaId: 'camp-medina-2026' } });
    try {
      montar();
      fireEvent.click(screen.getByRole('tab', { name: '2025 Censo 2025 histórico' }));
      expect(screen.getByText(/Callejero © colaboradores de OpenStreetMap \(ODbL\)/)).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole('group', { name: 'Vista del mapa' })).getByRole('button', { name: 'Por establecimientos' }));
      expect(screen.getByRole('note', { name: 'Ubicaciones simuladas' })).toHaveTextContent('Calles reales de OpenStreetMap; los negocios, sus números de portal y sus ubicaciones son ficticios. No son direcciones comprobadas.');
      fireEvent.click(screen.getByRole('img', { name: /^Mapa por establecimientos/ }).querySelector('circle.vz-punto')!);
      expect(screen.getByLabelText('Establecimiento seleccionado')).toHaveTextContent('nº ficticio');
    } finally {
      useStore.setState({ db: antes.db, prefs: antes.prefs });
    }
  });
});
