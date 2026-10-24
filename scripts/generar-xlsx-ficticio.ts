/**
 * Genera libros XLSX FICTICIOS (estructura de los Excel de la Cátedra, datos inventados) para
 * probar el análisis previo de C1a. Los .xlsx están excluidos del repositorio.
 *
 *   npm run xlsx-ficticio -- <carpeta-destino>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { conPrefijo, libroFicticio } from '../src/data/xlsxFicticio';

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: npm run xlsx-ficticio -- <carpeta-destino>');
  process.exit(1);
}
await mkdir(dir, { recursive: true });
const libros: [string, Uint8Array][] = [
  ['ficticio-censo-27.xlsx', await libroFicticio({ filas: 120, anomalias: true })],
  ['ficticio-censo-27-con-prefijo.xlsx', conPrefijo(await libroFicticio({ filas: 120, anomalias: true }))],
  ['ficticio-itinerario-28.xlsx', await libroFicticio({ perfil: 'itinerario-28', filas: 60 })],
  ['ficticio-estilo-valladolid.xlsx', await libroFicticio({ filas: 80, cpVacio: true, repetidas: 4, anomalias: true, hojaDatos: 'Datos', posicionDatos: 2 })],
];
for (const [n, b] of libros) {
  await writeFile(join(dir, n), b);
  console.log(`${join(dir, n)} (${b.byteLength} bytes)`);
}
