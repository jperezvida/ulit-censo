import { useEffect, useRef, useState } from 'react';
import { LngLatBounds, type GeoJSONSource, type Map as MLMap, type MapLayerMouseEvent } from 'maplibre-gl';
import { MapaBase } from '../../components/mapa/MapaBase';
import type { Id, LngLat } from '../../domain/types';

/** Calle preparada para el mapa: color y grosor ya calculados por la capa activa. */
export interface CalleMapa { id: Id; nombre: string; segmentos: LngLat[][]; color: string; ancho: number; conDatos: boolean }
/** Establecimiento con coordenadas VERIFICADAS (las únicas que se dibujan como punto). */
export interface PuntoMapa { id: string; calleId: Id; coord: LngLat; color: string; opacidad: number }

const vacia = { type: 'FeatureCollection' as const, features: [] };
const lineas = (cs: CalleMapa[]) => ({
  type: 'FeatureCollection' as const,
  features: cs.map((c) => ({ type: 'Feature' as const, properties: { calleId: c.id, nombre: c.nombre, color: c.color, ancho: c.ancho, datos: c.conDatos ? 1 : 0 }, geometry: { type: 'MultiLineString' as const, coordinates: c.segmentos } })),
});
const puntosGeo = (ps: PuntoMapa[]) => ({
  type: 'FeatureCollection' as const,
  features: ps.map((p) => ({ type: 'Feature' as const, properties: { calleId: p.calleId, color: p.color, opacidad: p.opacidad }, geometry: { type: 'Point' as const, coordinates: p.coord } })),
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
export function LienzoGL({ centro, calles, puntos, sobre, fijada, onSobre, onFijar, onTip }: {
  centro: LngLat; calles: CalleMapa[]; puntos: PuntoMapa[]; sobre: Id | null; fijada: Id | null;
  onSobre: (id: Id | null) => void; onFijar: (id: Id | null) => void; onTip: (t: { x: number; y: number; id: Id } | null) => void;
}) {
  const mapa = useRef<MLMap | null>(null);
  const [listo, setListo] = useState(false);
  const cb = useRef({ onSobre, onFijar, onTip, fijada });
  cb.current = { onSobre, onFijar, onTip, fijada };

  const alListo = (m: MLMap) => {
    mapa.current = m;
    m.addSource('vz-calles', { type: 'geojson', data: vacia });
    m.addSource('vz-puntos', { type: 'geojson', data: vacia });
    const linea = { 'line-cap': 'round', 'line-join': 'round' } as const;
    // MapLibre exige la interpolación por zoom en el nivel superior: el grosor de cada paso es «base × factor».
    const porZoom = (base: unknown, extra = 0) => ['interpolate', ['linear'], ['zoom'], 13, ['+', ['*', base, 0.55], extra * 0.55], 15, ['+', base, extra], 17, ['+', ['*', base, 1.8], extra * 1.8]] as never;
    m.addLayer({ id: 'vz-fondo', type: 'line', source: 'vz-calles', filter: ['==', ['get', 'datos'], 0], layout: linea, paint: { 'line-color': '#c3cbd6', 'line-width': porZoom(1.2) } });
    m.addLayer({ id: 'vz-hover', type: 'line', source: 'vz-calles', filter: ['==', ['get', 'calleId'], ''], layout: linea, paint: { 'line-color': '#021e4a', 'line-opacity': 0.28, 'line-width': porZoom(['get', 'ancho'], 7) } });
    m.addLayer({ id: 'vz-datos', type: 'line', source: 'vz-calles', filter: ['==', ['get', 'datos'], 1], layout: linea, paint: { 'line-color': ['get', 'color'], 'line-width': porZoom(['get', 'ancho']) } });
    m.addLayer({ id: 'vz-sel', type: 'line', source: 'vz-calles', filter: ['==', ['get', 'calleId'], ''], layout: linea, paint: { 'line-color': '#021e4a', 'line-width': porZoom(2.2), 'line-gap-width': porZoom(['get', 'ancho']) } });
    m.addLayer({ id: 'vz-puntos', type: 'circle', source: 'vz-puntos', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 16, 5, 18, 8], 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'opacidad'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2 } });
    m.addLayer({ id: 'vz-hit', type: 'line', source: 'vz-calles', paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 16 } });
    m.on('mousemove', 'vz-hit', (e: MapLayerMouseEvent) => {
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
    (m.getSource('vz-puntos') as GeoJSONSource).setData(puntosGeo(puntos));
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
  }, [sobre, fijada, listo]);

  return <MapaBase centro={centro} zoom={15} onListo={alListo} className="vz-mapa-gl" />;
}
