#!/usr/bin/env node
/**
 * Prepara la salida para Vercel (Build Output API v3) a partir de `dist/`, SIN que Vercel compile nada:
 * se publica exactamente lo compilado y comprobado en GitHub Actions.
 *
 * Antes comprueba que:
 *  - no se publica ningún archivo censal ni hoja de cálculo (solo lo previsto);
 *  - cada archivo coincide con la huella registrada en `dist/version.json` (versión íntegra).
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { CABECERAS, SIN_CACHE } from './cabeceras.mjs';
import { archivosProhibidos } from '../datos-reales.mjs';

const DIST = 'dist';
const SALIDA = '.vercel/output';
const PERMITIDOS = [/^index\.html$/, /^version\.json$/, /^assets\/[\w.-]+\.(js|css|woff2?)$/, /^maplibre\/maplibre-gl-(worker|shared)\.mjs$/, /^data\/medina-callejero\.json$/, /^data\/ATRIBUCION-OSM\.md$/];

async function listar(dir) {
  const out = [];
  for (const n of await readdir(dir)) {
    const p = join(dir, n);
    if ((await stat(p)).isDirectory()) out.push(...(await listar(p)));
    else out.push(relative(DIST, p).split('\\').join('/'));
  }
  return out.sort();
}

const archivos = await listar(DIST);
const fuera = archivos.filter((a) => !PERMITIDOS.some((r) => r.test(a)));
const prohibidos = archivosProhibidos(archivos);
if (fuera.length || prohibidos.length) {
  console.error('✗ La compilación contiene archivos no previstos; no se publica nada:');
  for (const a of [...new Set([...fuera, ...prohibidos])]) console.error('   ' + a);
  process.exit(1);
}
const version = JSON.parse(await readFile(join(DIST, 'version.json'), 'utf8'));
for (const a of archivos.filter((x) => x !== 'version.json')) {
  const h = createHash('sha256').update(await readFile(join(DIST, a))).digest('hex');
  if (version.archivos[a] !== h) {
    console.error(`✗ ${a} no coincide con su huella en version.json; no se publica nada.`);
    process.exit(1);
  }
}
if (Object.keys(version.archivos).length !== archivos.length - 1) {
  console.error('✗ version.json no describe exactamente los archivos compilados.');
  process.exit(1);
}

await rm(SALIDA, { recursive: true, force: true });
await mkdir(SALIDA, { recursive: true });
await cp(DIST, join(SALIDA, 'static'), { recursive: true });
const config = {
  version: 3,
  routes: [
    { src: '/(.*)', headers: CABECERAS, continue: true },
    ...SIN_CACHE.map((p) => ({ src: p.replace(/\./g, '\\.'), headers: { 'Cache-Control': 'no-store' }, continue: true })),
    { handle: 'filesystem' },
  ],
};
await writeFile(join(SALIDA, 'config.json'), JSON.stringify(config, null, 2));
console.log(`✓ ${archivos.length} archivos preparados para Vercel · commit ${version.commit} · rama ${version.rama}`);
