import { useEffect, useRef, useState } from 'react';
import { LngLatBounds, type GeoJSONSource, type Map as MLMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { MapaBase } from '../../components/mapa/MapaBase';
import type { Id, LngLat } from '../../domain/types';
import { desplazamientoGrupo, type TipoPosicion } from '../../domain/posiciones';

/** Calle preparada para el mapa: color y grosor ya calculados por la capa activa. */
export interface CalleMapa { id: Id; nombre: string; segmentos: LngLat[][]; color: string; ancho: number; conDatos: boolean }
/**
 * Establecimiento (local físico) en el modo «Por establecimientos». `coord` es su posición (verificada,
 * aproximada o simulada); si varios comparten posición (mismo portal), se dibujan en corona a su alrededor.
 */
export interface PuntoMapa { id: string; calleId: Id; coord: LngLat; color: string; opacidad: number; tipo: TipoPosicion; enGrupo: number; indiceEnGrupo: number }
export type TipMapa = { x: number; y: number; id: Id; punto?: string };

const vacia = { type: 'FeatureCollection' as const, features: [] };
const lineas = (cs: CalleMapa[]) => ({
  type: 'FeatureCollection' as const,
  features: cs.map((c) => ({ type: 'Feature' as const, properties: { calleId: c.id, nombre: c.nombre, color: c.color, ancho: c.ancho, datos: c.conDatos ? 1 : 0 }, geometry: { type: 'MultiLineString' as const, coordinates: c.segmentos } })),
});
/** Metros por píxel de pantalla a un zoom y latitud (teselas de 512 px). */
const mpp = (zoom: number, lat: number) => (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
/** Posición de DIBUJO de un punto: la suya o, si comparte posición, en corona a unos píxeles fijos (expansión). */
const dibujo = (p: PuntoMapa, zoom: number): LngLat => {
  const [dx, dy] = desplazamientoGrupo(p.enGrupo, p.indiceEnGrupo);
  if (!dx && !dy) return p.coord;
  const m = mpp(zoom, p.coord[1]);
  return [p.coord[0] + (dx * m) / (111320 * Math.cos((p.coord[1] * Math.PI) / 180)), p.coord[1] - (dy * m) / 110540];
};
const puntosGeo = (ps: PuntoMapa[], zoom: number) => ({
  type: 'FeatureCollection' as const,
  features: ps.map((p) => ({ type: 'Feature' as const, properties: { clave: p.id, calleId: p.calleId, color: p.color, opacidad: p.opacidad, tipo: p.tipo }, geometry: { type: 'Point' as const, coordinates: dibujo(p, zoom) } })),
});
/** Anclas y radios de los grupos expandidos: muestran que esos puntos comparten posición (p. ej., portal). */
const gruposGeo = (ps: PuntoMapa[], zoom: number) => ({
  type: 'FeatureCollection' as const,
  features: ps.filter((p) => p.enGrupo > 1).flatMap((p) => [
    { type: 'Feature' as const, properties: { k: 'radio' }, geometry: { type: 'LineString' as const, coordinates: [p.coord, dibujo(p, zoom)] } },
    ...(p.indiceEnGrupo === 0 ? [{ type: 'Feature' as const, properties: { k: 'ancla' }, geometry: { type: 'Point' as const, coordinates: p.coord } }] : []),
  ]),
});

/** ¿Puede el navegador dibujar MapLibre (WebGL)? En jsdom y navegadores sin WebGL se usa el mapa SVG. */
export function webglDisponible() {
  try {
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false;
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Lienzo del mapa territorial sobre el mapa base cartográfico de la aplicación (MapLibre, el mismo de
 * Territorio): las calles se colorean con el agregado de la capa y, si existen, los puntos verificados.
 * Sin teselas (sin red), las capas del censo se siguen dibujando sobre el fondo neutro.
 */
export function LienzoGL({ centro, calles, puntos, sobre, fijada, puntoSel = null, onSobre, onFijar, onTip, onPunto }: {
  centro: LngLat; calles: CalleMapa[]; puntos: PuntoMapa[]; sobre: Id | null; fijada: Id | null; puntoSel?: string | null;
  onSobre: (id: Id | null) => void; onFijar: (id: Id | null) => void; onTip: (t: TipMapa | null) => void; onPunto?: (clave: string | null) => void;
}) {
  const mapa = useRef<MLMap | null>(null);
  const [listo, setListo] = useState(false);
  const cb = useRef({ onSobre, onFijar, onTip, onPunto, fijada, puntos });
  cb.current = { onSobre, onFijar, onTip, onPunto, fijada, puntos };

  const alListo = (m: MLMap) => {
    mapa.current = m;
    m.addSource('vz-calles', { type: 'geojson', data: vacia });
    m.addSource('vz-puntos', { type: 'geojson', data: vacia });
    m.addSource('vz-grupos', { type: 'geojson', data: vacia });
    const linea = { 'line-cap': 'round', 'line-join': 'round' } as const;
    // MapLibre exige la interpolación por zoom en el nivel superior: el grosor de cada paso es «base × factor».
    const porZoom = (base: unknown, extra = 0) => ['interpolate', ['linear'], ['zoom'], 13, ['+', ['*', base, 0.55], extra * 0.55], 15, ['+', base, extra], 17, ['+', ['*', base, 1.8], extra * 1.8]] as never;
    m.addLayer({ id: 'vz-fondo', type: 'line', source: 'vz-calles', filter: ['==', ['get', 'datos'], 0], layout: linea, paint: { 'line-color': '#c3cbd6', 'line-width': porZoom(1.2) } });
    m.addLayer({ id: 'vz-hover', type: 'line', source: 'vz-calles', filter: ['==', ['get', 'calleId'], ''], layout: linea, paint: { 'line-color': '#021e4a', 'line-opacity': 0.28, 'line-width': porZoom(['get', 'ancho'], 7) } });
    m.addLayer({ id: 'vz-datos', type: 'line', source: 'vz-calles', filter: ['==', ['get', 'datos'], 1], layout: linea, paint: { 'line-color': ['get', 'color'], 'line-width': porZoom(['get', 'ancho']) } });
    m.addLayer({ id: 'vz-sel', type: 'line', source: 'vz-calles', filter: ['==', ['get', 'calleId'], ''], layout: linea, paint: { 'line-color': '#021e4a', 'line-width': porZoom(2.2), 'line-gap-width': porZoom(['get', 'ancho']) } });
    m.addLayer({ id: 'vz-hit', type: 'line', source: 'vz-calles', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 } });
    m.addLayer({ id: 'vz-radios', type: 'line', source: 'vz-grupos', filter: ['==', ['get', 'k'], 'radio'], paint: { 'line-color': '#021e4a', 'line-opacity': 0.45, 'line-width': 1 } });
    m.addLayer({ id: 'vz-anclas', type: 'circle', source: 'vz-grupos', filter: ['==', ['get', 'k'], 'ancla'], paint: { 'circle-radius': 2, 'circle-color': '#021e4a' } });
    // Aproximadas (pendientes de validación): anillo hueco; verificadas y simuladas: punto relleno.
    const aprox = ['==', ['get', 'tipo'], 'aproximada'];
    m.addLayer({ id: 'vz-puntos', type: 'circle', source: 'vz-puntos', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.6, 15, 4, 17, 6.5, 19, 9],
      'circle-color': ['case', aprox, '#ffffff', ['get', 'color']] as never,
      'circle-opacity': ['get', 'opacidad'], 'circle-stroke-opacity': ['get', 'opacidad'],
      'circle-stroke-color': ['case', aprox, ['get', 'color'], '#ffffff'] as never,
      'circle-stroke-width': ['case', aprox, 2, 1] as never,
    } });
    m.addLayer({ id: 'vz-punto-sel', type: 'circle', source: 'vz-puntos', filter: ['==', ['get', 'clave'], ''], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 6, 17, 11] as never, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#021e4a', 'circle-stroke-width': 2.5 } });
    const sobrePunto = (e: MapLayerMouseEvent) => m.queryRenderedFeatures(e.point, { layers: ['vz-puntos'] }).length > 0;
    m.on('mousemove', 'vz-puntos', (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]?.properties;
      if (!f) return;
      m.getCanvas().style.cursor = 'pointer';
      cb.current.onSobre(f.calleId as Id);
      cb.current.onTip({ x: e.point.x, y: e.point.y, id: f.calleId as Id, punto: f.clave as string });
    });
    m.on('mouseleave', 'vz-puntos', () => {
      m.getCanvas().style.cursor = '';
      cb.current.onSobre(null);
      cb.current.onTip(null);
    });
    m.on('click', 'vz-puntos', (e: MapLayerMouseEvent) => {
      const clave = e.features?.[0]?.properties?.clave as string | undefined;
      if (clave) cb.current.onPunto?.(clave);
    });
    // Al cambiar el zoom se recalcula la expansión (los puntos agrupados conservan su separación en pantalla).
    m.on('zoomend', () => {
      const ps = cb.current.puntos;
      if (!ps.some((p) => p.enGrupo > 1)) return;
      (m.getSource('vz-puntos') as GeoJSONSource).setData(puntosGeo(ps, m.getZoom()));
      (m.getSource('vz-grupos') as GeoJSONSource).setData(gruposGeo(ps, m.getZoom()));
    });
    m.on('mousemove', 'vz-hit', (e: MapLayerMouseEvent) => {
      if (sobrePunto(e)) return;
      const id = e.features?.[0]?.properties?.calleId as Id | undefined;
      if (!id) return;
      m.getCanvas().style.cursor = 'pointer';
      cb.current.onSobre(id);
      cb.current.onTip({ x: e.point.x, y: e.point.y, id });
    });
    m.on('mouseleave', 'vz-hit', () => {
      m.getCanvas().style.cursor = '';
      cb.current.onSobre(null);
      cb.current.onTip(null);
    });
    m.on('click', 'vz-hit', (e: MapLayerMouseEvent) => {
      if (sobrePunto(e)) return;
      const id = e.features?.[0]?.properties?.calleId as Id | undefined;
      if (id) cb.current.onFijar(cb.current.fijada === id ? null : id);
    });
    setListo(true);
  };

  // Datos de la capa activa
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    (m.getSource('vz-calles') as GeoJSONSource).setData(lineas(calles));
    (m.getSource('vz-puntos') as GeoJSONSource).setData(puntosGeo(puntos, m.getZoom()));
    (m.getSource('vz-grupos') as GeoJSONSource).setData(gruposGeo(puntos, m.getZoom()));
  }, [calles, puntos, listo]);

  // Encuadre: la extensión de las calles con datos (o de todo el callejero)
  const clave = calles.filter((c) => c.conDatos).map((c) => c.id).join('|');
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    const con = calles.filter((c) => c.conDatos);
    const pts = (con.length ? con : calles).flatMap((c) => c.segmentos.flat());
    if (!pts.length) return;
    const b = pts.reduce((bb, p) => bb.extend(p), new LngLatBounds(pts[0], pts[0]));
    m.fitBounds(b, { padding: 28, maxZoom: 17.5, duration: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, listo]);

  // Resaltado vinculado con los rankings
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    m.setFilter('vz-hover', ['==', ['get', 'calleId'], sobre ?? '']);
    m.setFilter('vz-sel', ['==', ['get', 'calleId'], fijada ?? '']);
    m.setFilter('vz-punto-sel', ['==', ['get', 'clave'], puntoSel ?? '']);
  }, [sobre, fijada, puntoSel, listo]);

  return <MapaBase centro={centro} zoom={15} onListo={alListo} className="vz-mapa-gl" />;
}
