#!/usr/bin/env tsx
/**
 * Instantánea REPRODUCIBLE del callejero real de Medina del Campo (OpenStreetMap) para la demostración.
 *
 *   npm run callejero                         descarga de Overpass (prueba varias réplicas) y guarda
 *   npm run callejero -- --desde export.json  normaliza un JSON exportado a mano (p. ej., desde overpass-turbo)
 *   npm run callejero -- --comprobar          solo comprueba la instantánea guardada (sin red)
 *
 * Guarda public/data/medina-callejero.json: solo nombre, tipo de vía y geometría de cada vía, con la
 * atribución y la licencia (ODbL 1.0). Una sola petición por ejecución; respeta la política de uso de Overpass.
 * Los establecimientos de la demostración NO salen de aquí: son ficticios y se generan en la aplicación.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { consultaOverpass, CALLES_DESDE_CERO_IT2, MEDINA } from '../src/data/callejero';
import { ATRIBUCION_OSM, LICENCIA_OSM, normalizarOverpass, URL_LICENCIA_OSM, validarInstantanea, type InstantaneaOsm } from '../src/data/instantaneaOsm';
import { claveCalle } from '../src/domain/text';

const DESTINO = 'public/data/medina-callejero.json';
const SERVIDORES = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const args = process.argv.slice(2);
const desde = args.includes('--desde') ? args[args.indexOf('--desde') + 1] : undefined;

function informe(json: unknown) {
  const v = validarInstantanea(json);
  if (!v.ok) {
    console.error(`✗ Instantánea no válida: ${v.motivo}`);
    process.exit(1);
  }
  const nombres = new Set(v.calles.map((c) => claveCalle(c.nombre)));
  const ref = CALLES_DESDE_CERO_IT2.map((n) => `${n}: ${nombres.has(claveCalle(n)) ? 'sí' : 'NO'}`);
  console.log(`✓ ${v.resumen.vias} vías → ${v.resumen.calles} calles con nombre · ${v.resumen.longitudKm} km · ${v.resumen.fueraDeZona} fuera de zona`);
  console.log(`  Datos OSM a ${v.fuente.fechaDatosOsm ?? '¿?'} · descarga ${v.fuente.fecha} · ${v.fuente.atribucion}, ${v.fuente.licencia}`);
  console.log(`  SHA-256 de las vías: ${v.fuente.sha256}`);
  console.log(`  Calles de referencia del documento IT 2: ${ref.join(' · ')}`);
  console.log(`  Ejemplos: ${v.calles.filter((_, i) => i % Math.ceil(v.calles.length / 8) === 0).map((c) => c.nombre).join(' · ')}`);
}

if (args.includes('--comprobar')) {
  const texto = await readFile(DESTINO, 'utf8').catch(() => null);
  if (texto === null) {
    console.error(`✗ No existe ${DESTINO}: genérala con «npm run callejero» desde una red con acceso a OpenStreetMap.`);
    process.exit(1);
  }
  informe(JSON.parse(texto));
  process.exit(0);
}

const consulta = consultaOverpass();
let bruto: { elements?: unknown[]; osm3s?: { timestamp_osm_base?: string } } | undefined;
let servidor = desde ? `archivo local (${desde})` : '';
if (desde) bruto = JSON.parse(await readFile(desde, 'utf8'));
else {
  for (const url of SERVIDORES) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'ULIT-Censo-prototipo/0.2 (Cátedra; demostración)' },
        body: 'data=' + encodeURIComponent(consulta),
        signal: AbortSignal.timeout(90_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      bruto = await r.json();
      servidor = url;
      break;
    } catch (e) {
      console.warn(`  ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }
}
if (!bruto) {
  console.error('✗ Ningún servidor Overpass respondió. Ejecútalo desde una red con acceso, o exporta la consulta en overpass-turbo y usa --desde.');
  console.error(`  Consulta: ${consulta}`);
  process.exit(1);
}

const elements = normalizarOverpass(bruto);
const inst: InstantaneaOsm = {
  __fuente: {
    origen: 'OpenStreetMap vía Overpass API', licencia: LICENCIA_OSM, atribucion: ATRIBUCION_OSM, urlLicencia: URL_LICENCIA_OSM,
    fecha: new Date().toISOString(), fechaDatosOsm: bruto.osm3s?.timestamp_osm_base, servidor, consulta, bbox: MEDINA.bbox,
    sha256: createHash('sha256').update(JSON.stringify(elements)).digest('hex'), vias: elements.length,
  },
  elements,
};
informe(inst);
await mkdir('public/data', { recursive: true });
// Una vía por línea: archivo estable y con diferencias legibles entre instantáneas.
await writeFile(DESTINO, `{"__fuente":${JSON.stringify(inst.__fuente)},\n"elements":[\n${elements.map((e) => JSON.stringify(e)).join(',\n')}\n]}\n`);
console.log(`Guardado ${DESTINO}`);
