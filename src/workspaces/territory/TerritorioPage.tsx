import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LngLatBounds, Marker, type GeoJSONSource, type Map as MLMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { Layers, MapPinned, PenLine, Search, Users, X } from 'lucide-react';
import { MapaBase } from '../../components/mapa/MapaBase';
import { useFichaLocal } from '../../store/contexto';
import { useStore } from '../../store/store';
import { useEspacios } from '../../store/espacios';
import { TerritorioDemo, TerritorioEnsayo, useContextoTerritorio } from './contextoTerritorio';
import { itinerariosDe, situacionPrevia } from '../../domain/consultas';
import { claseCampana } from '../../domain/municipios';
import { personaEspacio } from '../../domain/espacios';
import { actualizarTramo, alternarCalle, alternarSegmento, registrarOmision } from '../../domain/itinerarios';
import { geojsonCalles, geojsonLocales, type Capa } from './capas';
import { PanelPlan } from './PanelPlan';
import { InspectorCalle } from './InspectorCalle';
import { EquipoPanel } from './EquipoPanel';
import { Leyenda } from './Leyenda';
import { Segmentado, Sim } from '../../components/ui';
import { centroide, distanciaPuntoLinea } from '../../domain/geo';
import { normalizar } from '../../domain/text';
import type { Acera, Calle, Id, LngLat } from '../../domain/types';
import type { BaseDatos } from '../../domain/db';
import '../../styles/territorio.css';

const ANCHO = ['interpolate', ['linear'], ['zoom'], 13, 1.6, 15, 3.5, 17, 7, 19, 14] as const;

export default function TerritorioPage() {
  return <TerritorioDemo><TerritorioContenido /></TerritorioDemo>;
}

export function TerritorioEnsayoPage({ campanaId, itinerarioId }: { campanaId: Id; itinerarioId: Id }) {
  return <TerritorioEnsayo campanaId={campanaId}><TerritorioContenido itInicial={itinerarioId} /></TerritorioEnsayo>;
}

function TerritorioContenido({ itInicial }: { itInicial?: Id }) {
  const { db, municipio, campana, referencia, ix, aplicar, avisar, puedeEditar, puedePlanificarEnsayo, demo, dbVigente } = useContextoTerritorio();
  const modificarEnsayo = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const [errorEnsayo, setErrorEnsayo] = useState<string | null>(null);
  const [guardadoEnsayo, setGuardadoEnsayo] = useState<string | null>(null);
  const ficha = useFichaLocal();
  const fichaRef = useRef(ficha);
  fichaRef.current = ficha;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  const [capa, setCapa] = useState<Capa>(itInicial ? 'plan' : ((params.get('capa') as Capa) || 'plan'));
  const [tab, setTab] = useState<'plan' | 'equipo'>(itInicial ? 'plan' : ((params.get('tab') as 'equipo') || 'plan'));
  const itSolicitado = params.get('it');
  const itSel = demo ? itSolicitado : params.has('it')
    ? (itSolicitado && db.itinerarios[itSolicitado]?.campanaId === campana?.id ? itSolicitado : null)
    : (itInicial ?? null);
  const setItSel = (id: Id | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('it', id);
    else if (demo) p.delete('it');
    else p.set('it', '');
    setParams(p, { replace: true });
  };
  const [editando, setEditando] = useState(demo && params.get('editar') === '1');
  const [calleSel, setCalleSel] = useState<Id | null>(null);
  const [dividiendo, setDividiendo] = useState(false);
  const [verAnteriores, setVerAnteriores] = useState(false);
  const [resaltar, setResaltar] = useState<Id[] | null>(null);
  const [dibujo, setDibujo] = useState<LngLat[] | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [hover, setHover] = useState<{ x: number; y: number; texto: string } | null>(null);
  const mapa = useRef<MLMap | null>(null);
  const [mapaListo, setMapaListo] = useState(false);
  const marcadores = useRef<Marker[]>([]);

  const itinerarios = useMemo(() => (campana ? itinerariosDe(db, campana.id) : []), [db, campana]);
  const itActual = itSel ? db.itinerarios[itSel] : undefined;
  const sinPrevios = useMemo(() => {
    const s = new Set<Id>();
    if (!campana) return s;
    for (const id of campana.ambitoCalleIds) if (situacionPrevia(db, campana, id, ix.obs) !== 'con-registros') s.add(id);
    return s;
  }, [db, campana, ix.obs]);

  // Estado actual accesible desde los manejadores del mapa
  const estado = useRef({ editando, itSel, dividiendo, calleSel, dibujo, capa, puedeEditar });
  estado.current = { editando, itSel, dividiendo, calleSel, dibujo, capa, puedeEditar };

  const guardarTramoEnsayo = async (itId: Id, calleId: Id, cambio: (actual: BaseDatos, calle: Calle) => BaseDatos, descripcion: string) => {
    if (demo || !puedePlanificarEnsayo || !campana || useEspacios.getState().ocupado) return;
    const r = await modificarEnsayo('Guardando planificación…', (actual) => {
      const c = actual.campanas[campana.id];
      const it = actual.itinerarios[itId];
      const calle = actual.calles[calleId];
      if (!c || c.tipo === 'historico-importado' || c.municipioId !== municipio.id || !it || it.campanaId !== c.id
        || !it.tramos.some((t) => t.calleId === calleId) || !calle || calle.municipioId !== municipio.id)
        throw new Error('El itinerario o la calle han cambiado. Vuelva a abrir el espacio.');
      return cambio(actual, calle);
    });
    setErrorEnsayo(r.ok ? null : r.error ?? 'No se ha guardado el cambio.');
    setGuardadoEnsayo(r.ok ? `${descripcion}. Guardado comprobado.` : null);
  };

  const modificarPlanEnsayo = async (cambio: (actual: BaseDatos) => BaseDatos, descripcion: string, itId?: Id): Promise<boolean> => {
    if (demo || !puedePlanificarEnsayo || !campana || ocupado) return false;
    const r = await modificarEnsayo('Guardando planificación…', (actual) => {
      const c = actual.campanas[campana.id];
      const persona = personaEspacio(actual);
      const it = itId ? actual.itinerarios[itId] : undefined;
      if (!c || c.municipioId !== municipio.id || claseCampana(c) !== 'operativa'
        || !actual.municipios[municipio.id]
        || !persona?.roles.some((rol) => rol === 'coordinador' || rol === 'administrador')
        || (itId && (!it || it.campanaId !== c.id))) {
        throw new Error('La campaña, el itinerario o los permisos han cambiado. Vuelva a abrir el espacio.');
      }
      return cambio(actual);
    });
    setErrorEnsayo(r.ok ? null : r.error ?? 'No se ha guardado el cambio.');
    setGuardadoEnsayo(r.ok ? `${descripcion}. Guardado comprobado.` : null);
    return r.ok;
  };

  const clicCalle = useCallback(
    (calleId: Id, segId: Id) => {
      const st = estado.current;
      if (st.dibujo) return;
      const it = st.itSel ? dbVigente().itinerarios[st.itSel] : undefined;
      if (!demo && puedePlanificarEnsayo && st.dividiendo && st.calleSel === calleId && it?.tramos.some((t) => t.calleId === calleId)) {
        void guardarTramoEnsayo(it.id, calleId, (actual, calle) => {
          if (!calle.segmentos.some((s) => s.id === segId)) throw new Error('El segmento ha cambiado. Vuelva a abrir el espacio.');
          return alternarSegmento(actual, it.id, calle, segId);
        }, 'Segmentos ajustados');
        return;
      }
      if (st.editando && it && st.puedeEditar) {
        if (st.dividiendo && st.calleSel === calleId && it.tramos.some((t) => t.calleId === calleId)) {
          const calle = dbVigente().calles[calleId];
          aplicar((d) => alternarSegmento(d, it.id, calle, segId), 'Tramo ajustado', { silencioso: true });
          return;
        }
        const otros = Object.values(dbVigente().itinerarios).filter((x) => x.campanaId === it.campanaId && x.id !== it.id && x.tramos.some((t) => t.calleId === calleId));
        let anadida = false;
        aplicar((d) => {
          const r = alternarCalle(d, it.id, calleId);
          anadida = r.anadida;
          return r.db;
        }, 'Itinerario actualizado', { silencioso: true });
        const nombre = dbVigente().calles[calleId]?.nombre;
        if (anadida && otros.length) avisar(`${nombre}: añadida a ${it.codigo}, pero ya estaba en ${otros.map((o) => o.codigo).join(', ')} → solape. Usa “Avanzado” para repartir aceras o tramos.`, 'error');
        else avisar(anadida ? `${nombre} añadida a ${it.codigo} (calle completa, ambas aceras)` : `${nombre} quitada de ${it.codigo}`, 'ok', true);
        setCalleSel(calleId);
        return;
      }
      setCalleSel(calleId);
      setDividiendo(false);
      setErrorEnsayo(null);
      setGuardadoEnsayo(null);
    },
    [aplicar, avisar, dbVigente, demo, puedePlanificarEnsayo, guardarTramoEnsayo],
  );
  const clicCalleRef = useRef(clicCalle);
  clicCalleRef.current = clicCalle;

  // ── Instalación de capas ──
  const alListo = useCallback(
    (m: MLMap) => {
      mapa.current = m;
      // Acceso para pruebas automatizadas
      (window as unknown as { __mapaTerritorio: MLMap }).__mapaTerritorio = m;
      m.addSource('calles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('locales', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('anteriores', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('dibujo', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      const L = (spec: Parameters<MLMap['addLayer']>[0]) => m.addLayer(spec);
      const linea = { 'line-cap': 'round', 'line-join': 'round' } as const;
      L({ id: 'c-fuera', type: 'line', source: 'calles', filter: ['==', ['get', 'ambito'], 0], layout: linea, paint: { 'line-color': '#aab4c3', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 17, 3], 'line-opacity': 0.75 } });
      L({ id: 'ant', type: 'line', source: 'anteriores', layout: linea, paint: { 'line-color': '#7c3aed', 'line-width': 9, 'line-opacity': 0.18 } });
      // Planificación
      L({ id: 'p-halo', type: 'line', source: 'calles', filter: ['==', ['get', 'enSel'], 1], layout: linea, paint: { 'line-color': '#0065fe', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 7, 17, 18], 'line-opacity': 0.18, 'line-blur': 1 } });
      L({ id: 'p-sin', type: 'line', source: 'calles', filter: ['all', ['==', ['get', 'ambito'], 1], ['==', ['get', 'asignado'], 0]], layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#5f6f86', 'line-width': ANCHO as never, 'line-dasharray': [1.4, 1.1] } });
      L({ id: 'p-asig', type: 'line', source: 'calles', filter: ['>=', ['get', 'asignado'], 1], layout: linea, paint: { 'line-color': ['get', 'colorPlan'], 'line-width': ANCHO as never, 'line-opacity': ['case', ['==', ['get', 'enSel'], 1], 1, 0.82] } });
      L({ id: 'p-solape', type: 'line', source: 'calles', filter: ['==', ['get', 'solape'], 1], layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [1, 1.5] } });
      // Cobertura
      const cob = (id: string, filtro: unknown[], color: string, dash?: number[]) =>
        L({ id, type: 'line', source: 'calles', filter: ['all', ['==', ['get', 'ambito'], 1], filtro] as never, layout: dash ? { 'line-cap': 'butt' } : linea, paint: { 'line-color': color, 'line-width': ANCHO as never, ...(dash ? { 'line-dasharray': dash } : {}) } });
      cob('k-pend', ['==', ['get', 'cob'], 'pendiente'], '#8a97ab', [1.4, 1.1]);
      cob('k-curso', ['==', ['get', 'cob'], 'en-curso'], '#f59f00');
      cob('k-con', ['==', ['get', 'cob'], 'completada-con-locales'], '#12a873');
      cob('k-sin', ['==', ['get', 'cob'], 'completada-sin-locales'], '#0b9aa8', [0.6, 0.6]);
      cob('k-parcial', ['==', ['get', 'cob'], 'parcial-incidencias'], '#f0563a', [3, 0.8]);
      // Actividad
      L({ id: 'a-calles', type: 'line', source: 'calles', filter: ['==', ['get', 'ambito'], 1], layout: linea, paint: { 'line-color': '#c3ccd8', 'line-width': ANCHO as never } });
      L({ id: 'a-locales', type: 'circle', source: 'locales', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 17, 6, 19, 9],
        'circle-color': ['case', ['==', ['get', 'vacio'], 1], '#ffffff', ['get', 'color']],
        'circle-stroke-color': ['case', ['==', ['get', 'vacio'], 1], '#5c6b80', ['==', ['get', 'dudoso'], 1], '#ae3ec9', '#ffffff'],
        'circle-stroke-width': ['case', ['==', ['get', 'vacio'], 1], 1.6, ['==', ['get', 'dudoso'], 1], 2.5, 1],
        'circle-opacity': ['case', ['==', ['get', 'actualizado'], 1], 1, 0.55],
      } });
      // Marcas comunes
      L({ id: 'sin-previos', type: 'line', source: 'calles', filter: ['all', ['==', ['get', 'ambito'], 1], ['==', ['get', 'sinPrevios'], 1]], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 17, 2.2], 'line-dasharray': [0.2, 2.4] } });
      L({ id: 'resaltar', type: 'line', source: 'calles', filter: ['in', ['get', 'calleId'], ['literal', []]], layout: linea, paint: { 'line-color': '#ffd43b', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 8, 17, 20], 'line-opacity': 0.55 } });
      L({ id: 'hover', type: 'line', source: 'calles', filter: ['==', ['get', 'calleId'], ''], layout: linea, paint: { 'line-color': '#021e4a', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 4, 17, 11], 'line-opacity': 0.22 } });
      L({ id: 'sel', type: 'line', source: 'calles', filter: ['==', ['get', 'calleId'], ''], layout: linea, paint: { 'line-color': '#021e4a', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 4], 'line-gap-width': ['interpolate', ['linear'], ['zoom'], 13, 3, 17, 8] } });
      L({ id: 'dibujo-l', type: 'line', source: 'dibujo', paint: { 'line-color': '#0065fe', 'line-width': 3, 'line-dasharray': [2, 1] } });
      L({ id: 'dibujo-p', type: 'circle', source: 'dibujo', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#0065fe', 'circle-stroke-width': 2 } });
      L({ id: 'hit', type: 'line', source: 'calles', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 } });

      m.on('mousemove', 'hit', (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        m.getCanvas().style.cursor = 'pointer';
        m.setFilter('hover', ['==', ['get', 'calleId'], f.properties.calleId]);
        setHover({ x: e.point.x, y: e.point.y, texto: f.properties.nombre });
      });
      m.on('mouseleave', 'hit', () => {
        m.getCanvas().style.cursor = '';
        m.setFilter('hover', ['==', ['get', 'calleId'], '']);
        setHover(null);
      });
      m.on('click', (e) => {
        const st = estado.current;
        if (st.dibujo) {
          setDibujo([...st.dibujo, [e.lngLat.lng, e.lngLat.lat]]);
          return;
        }
        if (st.capa === 'actividad') {
          const loc = m.queryRenderedFeatures(e.point, { layers: ['a-locales'] })[0];
          if (loc) {
            fichaRef.current.abrir(loc.properties.localId);
            return;
          }
        }
        const f = m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['hit'] })[0];
        if (f) clicCalleRef.current(f.properties.calleId, f.properties.segId);
        else if (!st.editando) setCalleSel(null);
      });
      setMapaListo(true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Ajuste inicial a la extensión del ámbito
  const ajustado = useRef(false);
  useEffect(() => {
    const m = mapa.current;
    if (!m || !mapaListo || ajustado.current || !campana) return;
    const pts = campana.ambitoCalleIds.flatMap((id) => db.calles[id]?.segmentos.flatMap((s) => s.coords) ?? []);
    if (pts.length) {
      const b = pts.reduce((bb, p) => bb.extend(p), new LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding: { top: 70, bottom: 40, left: 40, right: 40 }, duration: 0 });
      ajustado.current = true;
    }
  }, [mapaListo, campana, db.calles]);

  // Datos de calles
  useEffect(() => {
    const m = mapa.current;
    if (!m || !mapaListo) return;
    (m.getSource('calles') as GeoJSONSource).setData(geojsonCalles(db, municipio.id, campana, itinerarios, itSel, sinPrevios));
  }, [db, municipio.id, campana, itinerarios, itSel, sinPrevios, mapaListo]);

  // Locales (solo capa de actividad)
  useEffect(() => {
    const m = mapa.current;
    if (!m || !mapaListo) return;
    (m.getSource('locales') as GeoJSONSource).setData(capa === 'actividad' ? geojsonLocales(db, municipio.id, campana, ix) : { type: 'FeatureCollection', features: [] });
  }, [db, municipio.id, campana, ix, capa, mapaListo]);

  // Itinerarios de la campaña de referencia
  useEffect(() => {
    const m = mapa.current;
    if (!m || !mapaListo) return;
    const ants = verAnteriores && referencia ? itinerariosDe(db, referencia.id) : [];
    (m.getSource('anteriores') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: ants.flatMap((it) => it.tramos.flatMap((t) => (db.calles[t.calleId]?.segmentos ?? []).map((s) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: s.coords }, properties: { codigo: it.codigo } })))),
    });
  }, [verAnteriores, referencia, db, mapaListo]);

  // Visibilidad por capa
  useEffect(() => {
    const m = mapa.current;
    if (!m || !mapaListo) return;
    const vis = (ids: string[], on: boolean) => ids.forEach((id) => m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    vis(['p-halo', 'p-sin', 'p-asig', 'p-solape'], capa === 'plan');
    vis(['k-pend', 'k-curso', 'k-con', 'k-sin', 'k-parcial'], capa === 'cobertura');
    vis(['a-calles', 'a-locales'], capa === 'actividad');
    vis(['sin-previos'], capa !== 'actividad');
  }, [capa, mapaListo]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !mapaListo) return;
    m.setFilter('sel', ['==', ['get', 'calleId'], calleSel ?? '']);
    m.setFilter('resaltar', ['in', ['get', 'calleId'], ['literal', resaltar ?? []]]);
  }, [calleSel, resaltar, mapaListo]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !mapaListo) return;
    const feats: GeoJSON.Feature[] = [];
    if (dibujo?.length) {
      feats.push(...dibujo.map((p) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: p }, properties: {} })));
      if (dibujo.length > 1) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: dibujo }, properties: {} });
    }
    (m.getSource('dibujo') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats });
    m.getCanvas().style.cursor = dibujo ? 'crosshair' : '';
  }, [dibujo, mapaListo]);

  // Números del itinerario seleccionado (marcadores HTML: no dependen de fuentes remotas)
  useEffect(() => {
    marcadores.current.forEach((mk) => mk.remove());
    marcadores.current = [];
    const m = mapa.current;
    if (!m || !mapaListo || !itActual || capa === 'actividad') return;
    for (const t of itActual.tramos) {
      const c = db.calles[t.calleId];
      if (!c?.segmentos.length) continue;
      const segs = t.segmentoIds?.length ? c.segmentos.filter((s) => t.segmentoIds!.includes(s.id)) : c.segmentos;
      const largo = [...segs].sort((a, b) => b.longitudM - a.longitudM)[0];
      const p = largo.coords[Math.floor(largo.coords.length / 2)];
      const q = largo.coords.length > 1 ? centroide([largo.coords[Math.floor((largo.coords.length - 1) / 2)], largo.coords[Math.ceil((largo.coords.length - 1) / 2) || 1]]) : p;
      const el = document.createElement('div');
      el.className = 'num-tramo';
      el.style.setProperty('--c', itActual.color);
      el.textContent = String(t.orden);
      el.title = `${t.orden}. ${c.nombre}`;
      el.onclick = (ev) => {
        ev.stopPropagation();
        setCalleSel(c.id);
      };
      marcadores.current.push(new Marker({ element: el }).setLngLat(q).addTo(m));
    }
  }, [itActual, db.calles, mapaListo, capa]);

  const enfocarCalles = useCallback(
    (ids: Id[]) => {
      const m = mapa.current;
      const pts = ids.flatMap((id) => db.calles[id]?.segmentos.flatMap((s) => s.coords) ?? []);
      if (!m || !pts.length) return;
      const b = pts.reduce((bb, p) => bb.extend(p), new LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding: { top: 90, bottom: 60, left: 40, right: window.innerWidth > 900 ? 380 : 40 }, maxZoom: 17.5, duration: 600 });
    },
    [db.calles, calleSel],
  );

  const resultadosBusqueda = useMemo(() => {
    const q = normalizar(busqueda);
    if (q.length < 2) return [];
    return Object.values(db.calles).filter((c) => c.municipioId === municipio.id && normalizar(c.nombre).includes(q)).slice(0, 8);
  }, [busqueda, db.calles, municipio.id]);

  const guardarCalleEnsayo = async () => {
    if (demo || !puedePlanificarEnsayo || !campana || !itActual || itActual.campanaId !== campana.id || !calleSel || ocupado) return;
    const calle = db.calles[calleSel];
    if (!calle || calle.municipioId !== municipio.id) return;
    const quitar = itActual.tramos.some((t) => t.calleId === calleSel);
    const r = await modificarEnsayo('Guardando planificación…', (actual) => {
      const c = actual.campanas[campana.id];
      const i = actual.itinerarios[itActual.id];
      if (!c || !i || i.campanaId !== c.id || c.tipo === 'historico-importado' || c.municipioId !== municipio.id || actual.calles[calleSel]?.municipioId !== municipio.id)
        throw new Error('El itinerario o la calle han cambiado. Vuelva a abrir el espacio.');
      return alternarCalle(actual, i.id, calleSel).db;
    });
    setErrorEnsayo(r.ok ? null : r.error ?? 'No se ha guardado el cambio.');
    setGuardadoEnsayo(r.ok ? `${calle.nombre} ${quitar ? 'retirada' : 'añadida'} a ${itActual.codigo}. Guardado comprobado.` : null);
  };

  if (municipio.fuenteCallejero === 'sin-geometria') {
    return (
      <div className="pagina">
        <div className="vacio-estado tarjeta">
          <MapPinned size={32} />
          <h2 style={{ margin: 0, color: 'var(--tinta)' }}>{municipio.nombre} no tiene callejero cartográfico en el prototipo</h2>
          <p style={{ maxWidth: 520 }}>Es un municipio de demostración de volumen (≈5.000 locales ficticios) pensado para probar la Oficina y el Análisis. La planificación cartográfica se prueba en Medina del Campo.</p>
          {demo && <button className="btn primario" onClick={() => useStore.getState().setPrefs({ municipioId: 'mun-medina', campanaId: 'camp-medina-2026' })}>Ir a Medina del Campo</button>}
        </div>
      </div>
    );
  }

  const fuenteCallejero = db.meta.fuenteCallejero;

  return (
    <div className={`territorio ${calleSel ? 'con-inspector' : ''}`}>
      <aside className="t-panel scroll-fino">
        <div className="t-panel-tabs">
          {demo ? (
          <Segmentado
            valor={tab}
            onCambio={(v) => setTab(v)}
            opciones={[
              { v: 'plan', t: <><Layers size={14} /> Itinerarios</> },
              { v: 'equipo', t: <><Users size={14} /> Equipo y progreso</> },
            ]}
          />
          ) : <div className="rotulo">Planificación · {municipio.nombre}</div>}
        </div>
        {!demo && errorEnsayo && <div className="t-info error" role="alert">{errorEnsayo}</div>}
        {!demo && guardadoEnsayo && <div className="t-info ok" role="status">{guardadoEnsayo}</div>}
        {tab === 'plan' ? (
          <PanelPlan
            itinerarios={itinerarios}
            itSel={itSel}
            setItSel={(id) => {
              setItSel(id);
              setCalleSel(null);
              setDividiendo(false);
              if (id) enfocarCalles(db.itinerarios[id]?.tramos.map((t) => t.calleId) ?? []);
            }}
            editando={editando}
            setEditando={setEditando}
            puedeEditar={puedeEditar}
            modificarEnsayo={!demo && puedePlanificarEnsayo ? modificarPlanEnsayo : undefined}
            ocupadoEnsayo={ocupado}
            onCalle={(id) => {
              setCalleSel(id);
              enfocarCalles([id]);
            }}
            resaltar={(ids) => {
              setResaltar(ids);
              if (ids?.length) enfocarCalles(ids);
            }}
            resaltando={resaltar}
            onImprimir={(id) => { if (demo) nav(`/imprimir/${id}`); }}
            sinPrevios={sinPrevios}
          />
        ) : (
          <EquipoPanel
            itinerarios={itinerarios}
            onIt={(id) => {
              setTab('plan');
              setItSel(id);
              enfocarCalles(db.itinerarios[id]?.tramos.map((t) => t.calleId) ?? []);
            }}
          />
        )}
      </aside>

      <section className="t-mapa">
        <MapaBase centro={municipio.centro ?? Object.values(db.calles).find((c) => c.municipioId === municipio.id && c.segmentos.length)?.segmentos[0].coords[0] ?? [-4.91, 41.31]} zoom={15} onListo={alListo} />

        <div className="t-barra panel-flotante">
          <div className="t-busca">
            <Search size={15} />
            <input placeholder="Buscar calle…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar calle" />
            {busqueda && (
              <button className="btn fantasma s icono" onClick={() => setBusqueda('')} aria-label="Limpiar">
                <X size={14} />
              </button>
            )}
            {resultadosBusqueda.length > 0 && (
              <div className="t-busca-res panel-flotante">
                {resultadosBusqueda.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setBusqueda('');
                      setCalleSel(c.id);
                      enfocarCalles([c.id]);
                    }}
                  >
                    {c.nombre}
                    <span className="muted mono">{c.segmentos.length} seg.</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {demo && <Segmentado
            valor={capa}
            onCambio={setCapa}
            opciones={[
              { v: 'plan', t: 'Planificación' },
              { v: 'cobertura', t: 'Cobertura' },
              { v: 'actividad', t: 'Actividad' },
            ]}
          />}
          <label className="t-check" title={referencia ? `Superponer itinerarios de ${referencia.nombre}` : 'Sin campaña de referencia'}>
            <input type="checkbox" checked={verAnteriores} disabled={!referencia} onChange={(e) => {
              setVerAnteriores(e.target.checked);
              if (e.target.checked && referencia && !itinerariosDe(db, referencia.id).length) avisar(`${referencia.nombre} no tenía itinerarios formalizados: no hay trazados anteriores que superponer.`, 'info');
            }} />
            Itinerarios anteriores
          </label>
          {puedeEditar && (
            <button className={`btn s ${dibujo ? 'activo' : ''}`} onClick={() => setDibujo(dibujo ? null : [])} title="Registrar una calle que falta en el callejero">
              <PenLine size={14} /> Omisión
            </button>
          )}
        </div>

        {editando && itActual && (
          <div className="t-modo" style={{ ['--c' as string]: itActual.color }}>
            <b>Editando {itActual.codigo}</b>
            <span>
              {dividiendo ? 'Pulsa segmentos de la calle seleccionada para incluirlos o excluirlos' : 'Pulsa calles para añadirlas completas (ambas aceras) o quitarlas'}
            </span>
            <button className="btn s" onClick={() => { setEditando(false); setDividiendo(false); }}>Terminar</button>
          </div>
        )}
        {dibujo && (
          <Dibujo
            puntos={dibujo}
            onCancelar={() => setDibujo(null)}
            onGuardar={(nombre) => {
              let id = '';
              aplicar((d) => {
                const r = registrarOmision(d, municipio.id, nombre, dibujo);
                id = r.id;
                return r.db;
              }, `Omisión registrada: ${nombre}`);
              setDibujo(null);
              setCalleSel(id);
            }}
          />
        )}

        <div className="t-sellos">
          {fuenteCallejero === 'simulado' ? (
            <Sim texto="Callejero simulado · geometría inventada" title="No se pudo obtener el callejero real de OSM; ver README" />
          ) : (
            <span className="chip real" title={`${db.meta.detalleCallejero} · Datos © colaboradores de OpenStreetMap, licencia ODbL (openstreetmap.org/copyright)`}>Callejero real · © OSM (ODbL)</span>
          )}
          {demo ? <Sim texto={fuenteCallejero === 'simulado' ? 'Itinerarios y locales de demostración' : 'Locales, números de portal e itinerarios ficticios'} title={fuenteCallejero === 'simulado' ? undefined : 'Las calles son reales; los locales, sus números de portal y sus ubicaciones son de demostración: no son direcciones comprobadas.'} /> : <span className="chip aviso">Espacio de ensayo · datos sintéticos</span>}
        </div>

        <Leyenda capa={capa} />

        {hover && !dibujo && (
          <div className="t-tooltip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
            {hover.texto}
          </div>
        )}
      </section>
      {calleSel && db.calles[calleSel] && (
        <InspectorCalle
          calleId={calleSel}
          itActual={itActual}
          editando={editando && puedeEditar}
          dividiendo={dividiendo}
          setDividiendo={setDividiendo}
          onCerrar={() => {
            setCalleSel(null);
            setDividiendo(false);
          }}
          onIt={(id) => setItSel(id)}
          onAlternarEnsayo={!demo && puedePlanificarEnsayo ? guardarCalleEnsayo : undefined}
          onAcerasEnsayo={!demo && puedePlanificarEnsayo && itActual ? (acera: Acera) => guardarTramoEnsayo(itActual.id, calleSel, (actual) => actualizarTramo(actual, itActual.id, calleSel, { acera }), 'Aceras actualizadas') : undefined}
          onRestablecerEnsayo={!demo && puedePlanificarEnsayo && itActual ? () => guardarTramoEnsayo(itActual.id, calleSel, (actual) => actualizarTramo(actual, itActual.id, calleSel, { segmentoIds: undefined }), 'Calle completa') : undefined}
          onEtiquetaEnsayo={!demo && puedePlanificarEnsayo && itActual ? (etiqueta: string) => guardarTramoEnsayo(itActual.id, calleSel, (actual) => actualizarTramo(actual, itActual.id, calleSel, { etiqueta: etiqueta || undefined }), 'Etiqueta actualizada') : undefined}
          ocupadoEnsayo={ocupado}
          errorEnsayo={errorEnsayo}
          guardadoEnsayo={guardadoEnsayo}
        />
      )}
    </div>
  );
}

function Dibujo({ puntos, onCancelar, onGuardar }: { puntos: LngLat[]; onCancelar: () => void; onGuardar: (nombre: string) => void }) {
  const [nombre, setNombre] = useState('');
  return (
    <div className="t-modo dibujo">
      <b>Registrar omisión del callejero</b>
      <span>{puntos.length < 2 ? 'Pulsa en el mapa para trazar la calle (mínimo 2 puntos).' : `${puntos.length} puntos · ${Math.round(puntos.slice(1).reduce((a, p, i) => a + distanciaPuntoLinea(p, [puntos[i]]), 0))} m`}</span>
      <input className="input" style={{ height: 30, width: 200 }} placeholder="Nombre de la calle" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      <button className="btn s primario" disabled={puntos.length < 2 || !nombre.trim()} onClick={() => onGuardar(nombre.trim())}>Guardar</button>
      <button className="btn s" onClick={onCancelar}>Cancelar</button>
    </div>
  );
}
