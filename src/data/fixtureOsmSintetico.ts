import { MEDINA } from './callejero';
import { ATRIBUCION_OSM, LICENCIA_OSM, URL_LICENCIA_OSM, type InstantaneaOsm, type ViaOsm } from './instantaneaOsm';

/**
 * SOLO PARA PRUEBAS. Instantánea SINTÉTICA con la misma forma que la del callejero OSM: vías con nombre,
 * tipo y geometría dentro de la zona de Medina, partidas en varios tramos (algunos en sentido contrario),
 * como ocurre en OpenStreetMap. Nombres y trazados son inventados («Vía sintética de prueba NN»): no son
 * calles reales y no deben usarse fuera de las pruebas.
 */
export function instantaneaSintetica(calles = 32, tramos = 3): InstantaneaOsm {
  const [c0, c1] = [MEDINA.centro[0], MEDINA.centro[1]];
  const elements: ViaOsm[] = [];
  let id = 1000;
  for (let k = 0; k < calles; k++) {
    const vertical = k % 2 === 1;
    const off = (Math.floor(k / 2) - calles / 4) * 0.0011;
    const nombre = `Vía sintética de prueba ${String(k + 1).padStart(2, '0')}`;
    // Recorrido ondulado de ~600 m dividido en `tramos` vías
    const puntos: { lat: number; lon: number }[] = [];
    for (let i = 0; i <= tramos * 4; i++) {
      const t = (i / (tramos * 4) - 0.5) * 0.0072;
      const onda = Math.sin(i * 0.9 + k) * 0.00008;
      puntos.push(vertical ? { lon: c0 + off + onda, lat: c1 + t } : { lon: c0 + t, lat: c1 + off + onda });
    }
    for (let s = 0; s < tramos; s++) {
      let g = puntos.slice(s * 4, s * 4 + 5).map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 }));
      if ((k + s) % 2 === 1) g = [...g].reverse(); // sentidos mezclados, como en OSM
      elements.push({ type: 'way', id: id++, tags: { name: nombre, highway: 'residential' }, geometry: g });
    }
  }
  // Orden de vías arbitrario (no por calle), como en una respuesta real
  elements.sort((a, b) => ((a.id * 7919) % 101) - ((b.id * 7919) % 101) || a.id - b.id);
  return {
    __fuente: {
      origen: 'SINTÉTICO (pruebas): forma de instantánea OSM, sin datos reales', licencia: LICENCIA_OSM, atribucion: `${ATRIBUCION_OSM} (formato)`, urlLicencia: URL_LICENCIA_OSM,
      fecha: '2026-10-23T00:00:00.000Z', fechaDatosOsm: '2026-10-22T00:00:00Z', consulta: 'sintética', bbox: MEDINA.bbox, vias: elements.length,
    },
    elements: elements.sort((a, b) => a.id - b.id),
  };
}
