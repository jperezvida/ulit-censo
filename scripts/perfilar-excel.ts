/**
 * Inspector estructural de libros Excel (ejecución local).
 *
 *   npm run perfilar -- "CENSO COMPLETO MEDINA 2025.xlsx" "ITINERARIO 1 MEDINA.xlsx"
 *
 * Genera, junto a cada archivo, «<archivo>.perfil.json» con hojas, cabeceras exactas, tipos,
 * formatos, rellenos (amarillo), validaciones y valores SOLO de las columnas autorizadas (categorías, códigos y respuestas 0/1).
 * No incluye nombres de negocio, direcciones ni otros datos identificativos.
 * El archivo Excel no se modifica ni se envía a ningún sitio.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { perfilarXlsx } from '../src/domain/xlsx/perfil';

const archivos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!archivos.length) {
  console.error('Uso: npm run perfilar -- <archivo.xlsx> [otro.xlsx …]');
  process.exit(1);
}
for (const ruta of archivos) {
  const datos = new Uint8Array(await readFile(ruta));
  const perfil = await perfilarXlsx(datos, basename(ruta));
  const salida = `${ruta}.perfil.json`;
  await writeFile(salida, JSON.stringify(perfil, null, 2));
  console.log(`\n${basename(ruta)} → ${salida}`);
  for (const h of perfil.hojas) {
    console.log(`  Hoja «${h.nombre}»: ${h.filasConDatos} filas, ${h.columnas.length} columnas (cabecera en fila ${h.filaCabecera ?? '—'})`);
    const amarillas = h.columnas.reduce((a, c) => a + c.rellenos.amarillo, 0);
    if (amarillas) console.log(`    celdas amarillas: ${amarillas}`);
    if (h.tuplasActividad) console.log(`    combinaciones de actividad (4 niveles): ${h.tuplasActividad.tuplas.length}`);
  }
  for (const a of perfil.avisos) console.log(`  ! ${a}`);
}
console.log('\nRevisa el JSON antes de compartirlo. Solo las columnas autorizadas incluyen valores; el resto, únicamente estructura y recuentos.');
