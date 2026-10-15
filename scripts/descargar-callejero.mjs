#!/usr/bin/env node
/**
 * Descarga una instantánea del callejero de Medina del Campo desde OpenStreetMap
 * (Overpass API) y la guarda en public/data/medina-callejero.json.
 *
 * Uso: npm run callejero
 * Requiere acceso a overpass-api.de. Una sola petición; respeta la política de uso.
 * Datos © OpenStreetMap contributors, ODbL 1.0.
 */
import { writeFile, mkdir } from 'node:fs/promises';

const bbox = [41.2965, -4.9385, 41.3255, -4.8955];
const tipos = 'primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|trunk|primary_link|secondary_link|tertiary_link';
const query = `[out:json][timeout:25];way["highway"~"^(${tipos})$"]["name"](${bbox.join(',')});out geom;`;

const r = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ULIT-Censo-prototipo/0.1' },
  body: 'data=' + encodeURIComponent(query),
});
if (!r.ok) {
  console.error(`Overpass respondió ${r.status}`);
  process.exit(1);
}
const json = await r.json();
json.__fuente = { origen: 'OpenStreetMap vía Overpass API', licencia: 'ODbL 1.0', atribucion: '© OpenStreetMap contributors', fecha: new Date().toISOString(), consulta: query };
await mkdir('public/data', { recursive: true });
await writeFile('public/data/medina-callejero.json', JSON.stringify(json));
console.log(`Guardadas ${json.elements?.length ?? 0} vías en public/data/medina-callejero.json`);
