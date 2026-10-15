import type { StyleSpecification } from 'maplibre-gl';

/**
 * Estilo base propio, desaturado («cartografía técnica»), sobre teselas vectoriales
 * OpenMapTiles servidas por OpenFreeMap (gratuito, sin clave, uso permitido con atribución).
 *
 * ⚠️ Para el modo sin conexión de la versión definitiva NO se descargarán teselas de
 * servidores públicos: se usará un proveedor o paquetes propios (p. ej. PMTiles) con licencia adecuada.
 */
export const ATRIBUCION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · Datos © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">colaboradores de OpenStreetMap</a> (ODbL)';

export function estiloBase(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: ATRIBUCION },
    },
    layers: [
      { id: 'fondo', type: 'background', paint: { 'background-color': '#eef1f5' } },
      {
        id: 'uso-suelo', type: 'fill', source: 'omt', 'source-layer': 'landuse',
        paint: { 'fill-color': ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood'], '#e9edf2', 'commercial', '#e7ebf3', 'industrial', '#e5e8ee', '#eceff3'], 'fill-opacity': 0.8 },
      },
      { id: 'verde', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#e1ebe2' } },
      {
        id: 'cubierta', type: 'fill', source: 'omt', 'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['grass', 'wood', 'farmland']]],
        paint: { 'fill-color': '#e6ece4', 'fill-opacity': 0.6 },
      },
      { id: 'agua', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#d3e2f1' } },
      { id: 'rios', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#c6d9ee', 'line-width': 1.4 } },
      {
        id: 'edificios', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-color': '#dfe3ea', 'fill-outline-color': '#cfd5df' },
      },
      {
        id: 'vias-borde', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'minor', 'service', 'trunk', 'motorway']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#d4dae4', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 7, 19, 22] },
      },
      {
        id: 'vias', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['primary', 'secondary', 'tertiary', 'minor', 'service', 'trunk', 'motorway']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 5, 19, 18] },
      },
      {
        id: 'peatonal', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['path', 'pedestrian']]],
        paint: { 'line-color': '#f7f8fa', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 18, 6] },
      },
      {
        id: 'ferrocarril', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        paint: { 'line-color': '#b8c0cc', 'line-width': 1.2, 'line-dasharray': [3, 2] },
      },
      {
        id: 'nombres-lugar', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 15,
        filter: ['in', ['get', 'class'], ['literal', ['town', 'village', 'suburb', 'neighbourhood']]],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.12 },
        paint: { 'text-color': '#8b97a8', 'text-halo-color': '#eef1f5', 'text-halo-width': 1.5 },
      },
    ],
  };
}
