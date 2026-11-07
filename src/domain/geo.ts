import type { LngLat } from './types';

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanciaM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function longitudLinea(coords: LngLat[]): number {
  let l = 0;
  for (let i = 1; i < coords.length; i++) l += distanciaM(coords[i - 1], coords[i]);
  return l;
}

/** Punto a una fracción t (0..1) de la longitud de la línea, con el rumbo local. */
export function puntoEnLinea(coords: LngLat[], t: number): { p: LngLat; dir: LngLat } {
  if (coords.length === 1) return { p: coords[0], dir: [1, 0] };
  const total = longitudLinea(coords);
  let objetivo = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < coords.length; i++) {
    const d = distanciaM(coords[i - 1], coords[i]);
    if (objetivo <= d || i === coords.length - 1) {
      const f = d === 0 ? 0 : Math.min(1, objetivo / d);
      const a = coords[i - 1];
      const b = coords[i];
      return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], dir: [b[0] - a[0], b[1] - a[1]] };
    }
    objetivo -= d;
  }
  return { p: coords[coords.length - 1], dir: [1, 0] };
}

/** Desplaza un punto perpendicularmente al rumbo (metros, + izquierda / - derecha). */
export function desplazarPerpendicular(p: LngLat, dir: LngLat, metros: number): LngLat {
  const kx = 111320 * Math.cos(rad(p[1]));
  const ky = 110540;
  const vx = dir[0] * kx;
  const vy = dir[1] * ky;
  const n = Math.hypot(vx, vy) || 1;
  const nx = -vy / n;
  const ny = vx / n;
  return [p[0] + (nx * metros) / kx, p[1] + (ny * metros) / ky];
}

export function bbox(puntos: LngLat[]): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of puntos) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function centroide(puntos: LngLat[]): LngLat {
  const s = puntos.reduce((a, p) => [a[0] + p[0], a[1] + p[1]] as LngLat, [0, 0] as LngLat);
  return [s[0] / (puntos.length || 1), s[1] / (puntos.length || 1)];
}

/** Distancia mínima aproximada de un punto a una polilínea (metros). */
export function distanciaPuntoLinea(p: LngLat, coords: LngLat[]): number {
  let min = Infinity;
  const kx = 111320 * Math.cos(rad(p[1]));
  const ky = 110540;
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1][0] - p[0]) * kx;
    const ay = (coords[i - 1][1] - p[1]) * ky;
    const bx = (coords[i][0] - p[0]) * kx;
    const by = (coords[i][1] - p[1]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < min) min = d;
  }
  if (coords.length === 1) min = distanciaM(p, coords[0]);
  return min;
}

export function formatoDistancia(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 2 })} km` : `${Math.round(m)} m`;
}
