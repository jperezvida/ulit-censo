#!/usr/bin/env tsx
/**
 * C1e · Genera el archivo XLSX SINTÉTICO que reproduce las características agregadas del censo real de
 * Medina del Campo 2025, para probar el procedimiento en el espacio de ENSAYO.
 *
 *   npm run sintetico-c1e            → sinteticos/CENSO_MEDINA_2025_SINTETICO_C1E.xlsx
 *
 * Usa el callejero real (instantánea OSM del proyecto) para los nombres de calle; los negocios, números
 * de portal y demás datos son inventados. La carpeta `sinteticos/` y los .xlsx no se suben a git.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validarInstantanea } from '../src/data/instantaneaOsm';
import { ARCHIVO_SINTETICO_C1E, libroSinteticoC1e } from '../src/data/xlsxSinteticoC1e';
import { crearBaseEspacio, municipioDeEspacio } from '../src/domain/espacios';
import { prepararIncorporacion } from '../src/domain/incorporacionXlsx';
import { diagnosticoAgregado } from '../src/domain/c1e';

const v = validarInstantanea(JSON.parse(await readFile('public/data/medina-callejero.json', 'utf8')));
if (!v.ok) throw new Error(v.motivo);
const bytes = await libroSinteticoC1e(v.calles);
await mkdir('sinteticos', { recursive: true });
const ruta = `sinteticos/${ARCHIVO_SINTETICO_C1E}`;
await writeFile(ruta, bytes);
console.log(`Guardado ${ruta} (${bytes.length} bytes) · SHA-256 ${createHash('sha256').update(bytes).digest('hex')}`);
const db = crearBaseEspacio('ensayo', { persona: { nombre: 'Script', roles: ['coordinador'] }, calles: v.calles, detalleCallejero: 'OSM', espacioId: 'script' });
const { resultado } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, { municipioId: municipioDeEspacio('ensayo'), anio: 2025 }, {});
const d = diagnosticoAgregado(resultado);
for (const i of d.indicadores) console.log(`  ${i.coincide === false ? '≠' : '✓'} ${i.etiqueta}: ${i.valor}${i.esperado !== undefined ? ` (informe: ${i.esperado})` : ''}`);
console.log(d.diferencias.length ? `✗ ${d.diferencias.length} diferencia(s) con el informe agregado` : '✓ Coincide con el informe agregado en todos los indicadores');
