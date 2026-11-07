/**
 * C1a · Informe estructural previo de un libro Excel (ejecución local, solo lectura).
 *
 *   npm run analizar -- archivo.xlsx [--municipio=mun-medina|mun-valladolid]
 *
 * Genera «<archivo>.informe-estructural.json» junto al archivo (ignorado por git) y muestra un
 * resumen. No importa nada, no modifica el Excel y no incluye nombres de negocio ni direcciones.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { analizarXlsx } from '../src/domain/xlsx/analisis';
import { CONFIG_TERRITORIAL } from '../src/domain/territorio';

const args = process.argv.slice(2);
const archivos = args.filter((a) => !a.startsWith('--'));
const mun = args.find((a) => a.startsWith('--municipio='))?.split('=')[1];
if (!archivos.length) {
  console.error('Uso: npm run analizar -- <archivo.xlsx> [--municipio=mun-medina|mun-valladolid]');
  process.exit(1);
}
if (mun && !CONFIG_TERRITORIAL[mun]) {
  console.error(`Municipio desconocido: ${mun}. Opciones: ${Object.keys(CONFIG_TERRITORIAL).join(', ')}`);
  process.exit(1);
}
for (const ruta of archivos) {
  const inf = await analizarXlsx(new Uint8Array(await readFile(ruta)), basename(ruta), { territorio: mun ? CONFIG_TERRITORIAL[mun] : undefined });
  const salida = `${ruta}.informe-estructural.json`;
  await writeFile(salida, JSON.stringify(inf, null, 2));
  const p = inf.perfiles.find((x) => x.perfilId === inf.perfilPropuesto);
  console.log(`\n${inf.archivo.nombre} (${inf.archivo.bytes} bytes, SHA-256 ${inf.archivo.sha256.slice(0, 16)}…)`);
  console.log(`  Lector: ${inf.lector.motor}${inf.lector.adaptaciones.length ? ` · ${inf.lector.adaptaciones.length} parte(s) adaptadas en memoria` : ''}`);
  for (const h of inf.hojas) console.log(`  Hoja ${h.posicion} «${h.nombre}»: ${h.rol} · ${h.filas} filas × ${h.columnas} columnas · ${h.motivo}`);
  console.log(`  Hoja de datos: ${inf.hojaDatos ?? '—'} (${inf.eleccionHoja}) · ${inf.filas.conDatos} filas · cabecera en fila ${inf.filas.filaCabecera ?? '—'}`);
  console.log(`  Perfil compatible: ${p ? `${p.nombre} v${p.version} (${p.encontradas}/${p.total})` : 'ninguno'}`);
  for (const x of inf.perfiles.filter((y) => y !== p)) console.log(`    · ${x.nombre}: ${x.encontradas}/${x.total}; faltan ${x.faltan.length}, sobran ${x.sobran.length}`);
  for (const c of inf.territorio?.campos ?? []) console.log(`  Territorio · ${c.mensaje}`);
  if (inf.direccionesRepetidas) console.log(`  Direcciones repetidas: ${inf.direccionesRepetidas.grupos} grupo(s) en ${inf.direccionesRepetidas.filas} filas (se conservan todas; conciliación pendiente si no es inequívoca)`);
  for (const a of inf.avisos) console.log(`  ! ${a}`);
  console.log(`  → ${salida}`);
}
console.log('\nSolo lectura: no se ha importado nada ni modificado ningún archivo.');
