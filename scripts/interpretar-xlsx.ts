/**
 * C1b · Interpretación de valores e incidencias de un libro Excel (ejecución local, solo lectura).
 *
 *   npm run interpretar -- archivo.xlsx [--municipio=mun-medina|mun-valladolid] [--anio=2025]
 *                                       [--modo=historico|campana-actual]
 *
 * Genera «<archivo>.informe-interpretacion.json» junto al archivo (ignorado por git) y muestra un
 * resumen. No importa nada, no modifica el Excel y el informe no incluye nombres de negocio,
 * direcciones ni descripciones. Las reglas pendientes de la Cátedra NO se aplican.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { interpretarXlsx } from '../src/domain/xlsx/interpretacion';
import { informeInterpretacion } from '../src/domain/xlsx/informeInterpretacion';
import { CONFIG_TERRITORIAL } from '../src/domain/territorio';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const archivos = args.filter((a) => !a.startsWith('--'));
const mun = opt('municipio');
const anio = opt('anio');
const modo = opt('modo') as 'historico' | 'campana-actual' | undefined;
if (!archivos.length || (mun && !CONFIG_TERRITORIAL[mun]) || (anio && !/^\d{4}$/.test(anio)) || (modo && !['historico', 'campana-actual'].includes(modo))) {
  console.error('Uso: npm run interpretar -- <archivo.xlsx> [--municipio=mun-medina|mun-valladolid] [--anio=2025] [--modo=historico|campana-actual]');
  process.exit(1);
}
const pct = (n: number, t: number) => `${((100 * n) / (t || 1)).toFixed(2).replace('.', ',')} %`;
for (const ruta of archivos) {
  const t0 = performance.now();
  const res = await interpretarXlsx(new Uint8Array(await readFile(ruta)), basename(ruta), {
    territorio: mun ? CONFIG_TERRITORIAL[mun] : undefined, modo,
    periodo: anio ? { desde: `${anio}-01-01`, hasta: `${anio}-12-31` } : undefined,
  });
  const inf = informeInterpretacion(res, mun ? CONFIG_TERRITORIAL[mun].municipio : undefined);
  const salida = `${ruta}.informe-interpretacion.json`;
  await writeFile(salida, JSON.stringify(inf, null, 2));
  const c = inf.celdas;
  console.log(`\n${inf.archivo.nombre} · hoja «${inf.hoja}» · perfil ${inf.perfil.id} v${inf.perfil.version} · ${Math.round(performance.now() - t0)} ms`);
  console.log(`  Registros: ${inf.filas.registros} (vacíos ${inf.filas.locales.vacio}, ocupados ${inf.filas.locales.ocupado}, desconocidos ${inf.filas.locales.desconocido})${inf.filas.candidatasExcluir.length ? ` · ${inf.filas.candidatasExcluir.length} posible(s) fila(s) de totales conservada(s), pendiente(s) de confirmación` : ''}`);
  console.log(`  Celdas: ${c.total} · sin revisión ${c.sinRevision} (${pct(c.sinRevision, c.total)}) · requieren revisión ${c.requierenRevision} (${pct(c.requierenRevision, c.total)})`);
  console.log(`  Estados: ${Object.entries(c.porEstado).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  Incidencias: ${inf.incidencias.total} (error ${inf.incidencias.porGravedad.error}, aviso ${inf.incidencias.porGravedad.aviso}, info ${inf.incidencias.porGravedad.info}) · decide la Cátedra ${inf.incidencias.porDecision.catedra}, revisión ${inf.incidencias.porDecision.revision}`);
  for (const t of inf.incidencias.porTipo) console.log(`    ${String(t.n).padStart(5)}  ${t.titulo} [${t.gravedad}] · ${t.columnas.join(', ')}`);
  console.log(`  Nº redes: ${inf.redes.coinciden} coinciden · ${inf.redes.discrepan} discrepan · ${inf.redes.noCalculables} no calculables`);
  console.log(`  Clasificación histórica (sin confirmar): ${Object.entries(inf.clasificacion.porCategoria).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  Direcciones repetidas: ${inf.direccionesRepetidas.grupos} grupo(s), ${inf.direccionesRepetidas.filas} filas (se conservan todas)`);
  for (const d of inf.decisionesPendientes) console.log(`  Pendiente de decisión ${d.decision}: ${d.descripcion} · ${d.celdas} celda(s)`);
  console.log(`  → ${salida}`);
}
console.log('\nSolo lectura: no se ha importado nada ni modificado ningún archivo.');
