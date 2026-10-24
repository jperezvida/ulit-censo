import { useCallback, useEffect, useRef, useState } from 'react';
import { LngLatBounds, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { MapaBase } from '../../components/mapa/MapaBase';
import { useStore } from '../../store/store';
import { estadoTramo } from '../../domain/planificacion';
import type { Id, Itinerario } from '../../domain/types';

const COLOR: Record<string, string> = {
  pendiente: '#8a97ab', 'en-curso': '#f59f00', 'completada-con-locales': '#12a873', 'completada-sin-locales': '#0b9aa8', 'parcial-incidencias': '#f0563a',
};

/** Mapa compacto del itinerario en el móvil: calles coloreadas por cobertura. */
export function MiniMapa({ it, onCalle }: { it: Itinerario; onCalle: (id: Id) => void }) {
  const db = useStore((s) => s.db!);
  const mapa = useRef<MLMap | null>(null);
  const [listo, setListo] = useState(false);
  const cb = useRef(onCalle);
  cb.current = onCalle;
  const municipio = db.municipios[db.campanas[it.campanaId].municipioId];

  const alListo = useCallback((m: MLMap) => {
    mapa.current = m;
    m.addSource('it', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'it-l', type: 'line', source: 'it', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
    m.addLayer({ id: 'it-hit', type: 'line', source: 'it', paint: { 'line-opacity': 0, 'line-width': 22 } });
    m.on('click', 'it-hit', (e) => e.features?.[0] && cb.current(e.features[0].properties.calleId));
    setListo(true);
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    const feats = it.tramos.flatMap((t) => {
      const c = db.calles[t.calleId];
      const color = COLOR[estadoTramo(db, it.campanaId, t)];
      const segs = t.segmentoIds?.length ? c?.segmentos.filter((s) => t.segmentoIds!.includes(s.id)) : c?.segmentos;
      return (segs ?? []).map((s) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: s.coords }, properties: { calleId: t.calleId, color } }));
    });
    (m.getSource('it') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats });
    const pts = feats.flatMap((f) => f.geometry.coordinates);
    if (pts.length) m.fitBounds(pts.reduce((b, p) => b.extend(p as [number, number]), new LngLatBounds(pts[0] as [number, number], pts[0] as [number, number])), { padding: 24, duration: 0 });
  }, [db, it, listo]);

  if (!municipio || municipio.fuenteCallejero === 'sin-geometria') return null;
  return (
    <div className="m-minimapa">
      <MapaBase centro={municipio.centro!} zoom={15} onListo={alListo} />
    </div>
  );
}
