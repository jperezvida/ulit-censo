#!/usr/bin/env node
/**
 * Falla si el repositorio (o lo preparado para commit) contiene archivos que podrían ser
 * datos censales reales: libros Excel, perfiles sin revisar o la carpeta datos-reales/.
 */
import { execFileSync } from 'node:child_process';
import { archivosProhibidos } from './datos-reales.mjs';

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);
const rutas = [...new Set([...git(['ls-files']), ...git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])])];
const malos = archivosProhibidos(rutas);
if (malos.length) {
  console.error('✗ Posibles datos censales reales en el repositorio:');
  for (const m of malos) console.error('   ' + m);
  console.error('Retíralos con «git rm --cached <archivo>» y guárdalos fuera del control de versiones.');
  process.exit(1);
}
console.log(`✓ Sin archivos censales en el repositorio (${rutas.length} rutas comprobadas).`);
