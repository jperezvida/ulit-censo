#!/usr/bin/env tsx
/**
 * Genera, con datos SINTÉTICOS, las operaciones que guardaría ULIT Censo en `ulit_censo_aplicar`:
 * carga inicial del censo 2025 sintético (C1e, cifras agregadas de Medina) + IT1 2026 sintético +
 * conciliación y revisión de Oficina operación a operación. Escribe una operación por línea (NDJSON).
 *
 *   npx tsx docs/persistencia/pruebas/medir-almacenamiento.ts <salida.ndjson>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { validarInstantanea } from '../../../src/data/instantaneaOsm';
import { ARCHIVO_SINTETICO_C1E, libroSinteticoC1e } from '../../../src/data/xlsxSinteticoC1e';
import { libroConFilas } from '../../../src/data/xlsxItinerarios';
import { crearBaseEspacio, municipioDeEspacio, PREFIJO } from '../../../src/domain/espacios';
import { prepararIncorporacion } from '../../../src/domain/incorporacionXlsx';
import { aplicarIncorporacion } from '../../../src/domain/incorporacion';
import { crearCampana } from '../../../src/domain/municipios';
import { crearItinerario } from '../../../src/domain/campanaOperativa';
import { pendientesCampana, vincularALocal } from '../../../src/domain/conciliacionPosterior';
import { clasificar } from '../../../src/domain/clasificacion';
import { registrarDatoDigital, verificarDigital } from '../../../src/domain/digital';
import { direccionVigente } from '../../../src/domain/consultas';
import type { BaseDatos } from '../../../src/domain/db';

const salida = process.argv[2];
if (!salida) throw new Error('Indique el archivo de salida');
const AHORA = '2026-11-04T10:00:00.000Z';
const ESCALARES = ['version', 'generado', 'secuencia', 'colaSync', 'meta'] as const;
const COLS = ['municipios', 'calles', 'campanas', 'itinerarios', 'coberturas', 'situacionesPrevias', 'callesRevisadasPlan', 'locales', 'negocios', 'ocupaciones', 'observaciones', 'registros', 'vinculos', 'importaciones', 'revisiones', 'digital', 'clasificaciones', 'franquicias', 'oficinaItinerarios', 'personas'] as const;
type Cambio = { c: string; id: string; v: unknown };
const raiz = (d: BaseDatos) => Object.fromEntries(ESCALARES.map((k) => [k, (d as any)[k]]));
/** Diferencia por referencia (el dominio comparte estructura): solo las entidades que han cambiado. */
function diferencia(a: BaseDatos | null, b: BaseDatos): Cambio[] {
  const out: Cambio[] = [];
  if (!a || ESCALARES.some((k) => JSON.stringify((a as any)[k]) !== JSON.stringify((b as any)[k]))) out.push({ c: '_raiz', id: 'raiz', v: raiz(b) });
  for (const c of COLS) {
    const x = (a as any)?.[c] ?? {}, y = (b as any)[c] ?? {};
    if (x === y) continue;
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[k] !== y[k]) out.push({ c, id: k, v: y[k] ?? null });
  }
  return out;
}
const ops: { etiqueta: string; cambios: Cambio[] }[] = [];
let prev: BaseDatos | null = null;
const anotar = (etiqueta: string, d: BaseDatos) => { const c = diferencia(prev, d); if (c.length) ops.push({ etiqueta, cambios: c }); prev = d; };

const v = validarInstantanea(JSON.parse(await readFile('public/data/medina-callejero.json', 'utf8')));
if (!v.ok) throw new Error(v.motivo);
let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Script', roles: ['coordinador'] }, calles: v.calles, detalleCallejero: 'OSM', espacioId: 'medida', ahora: AHORA });
const porId = db.meta.espacioCreadoPorId!;
const o = { prefijo: PREFIJO.ensayo, porId, ahora: AHORA, anioActual: 2026 };
const mun = municipioDeEspacio('ensayo');
const h = crearCampana(db, { municipioId: mun, anio: 2025, nombre: 'Censo 2025 (sintético)', clase: 'historica' }, o); db = h.db;
const d25 = { municipioId: mun, anio: 2025, campanaId: h.campanaId };
const p = await prepararIncorporacion(db, await libroSinteticoC1e(v.calles), ARCHIVO_SINTETICO_C1E, d25, {});
db = aplicarIncorporacion(db, p.resultado, d25, {}, p.plan, { porId, ahora: AHORA }).db;
anotar('Carga inicial: censo 2025 sintético', db);
const obs25 = Object.values(db.observaciones).filter((x) => x.campanaId === h.campanaId && x.localId).slice(0, 95);
const filas = obs25.map((x) => { const d = direccionVigente(db.locales[x.localId!]); return { calle: db.calles[d.calleId].nombre, num: d.numero ?? 'S/N', nombre: x.datos.vacio ? undefined : x.datos.nombre, vacio: x.datos.vacio, fecha: '2026-03-02' }; });
for (let i = 0; i < 10; i++) filas.push({ calle: filas[i].calle, num: 900 + i, nombre: `ALTA SINTÉTICA ${i}`, vacio: false, fecha: '2026-03-03' });
const c26 = crearCampana(db, { municipioId: mun, anio: 2026, nombre: 'Censo 2026 (sintético)', clase: 'operativa', tipoOperativa: 'actualizacion', campanaReferenciaId: h.campanaId }, o); db = c26.db;
anotar('Campaña 2026', db);
const it = crearItinerario(db, c26.campanaId, { codigo: 'IT1' }, o); db = it.db;
anotar('Itinerario IT1', db);
const d26 = { municipioId: mun, anio: 2026, campanaId: c26.campanaId, itinerarioId: it.itinerarioId };
const p26 = await prepararIncorporacion(db, await libroConFilas('IT1', filas as any), 'IT1_SINTETICO.xlsx', d26, {});
db = aplicarIncorporacion(db, p26.resultado, d26, {}, p26.plan, { porId, ahora: AHORA }).db;
anotar('Incorporación de IT1', db);
for (const pe of pendientesCampana(db, c26.campanaId).filter((q) => q.claridad === 'clara')) {
  try { db = vincularALocal(db, c26.campanaId, pe.registroId, pe.candidatos[0].localId, { porId, ahora: AHORA }); anotar(`Conciliación fila ${pe.fila}`, db); } catch { /* no aplicable */ }
}
const al = { itinerarioId: it.itinerarioId };
for (const n of new Set(Object.values(db.ocupaciones).filter((q) => q.desdeCampanaId === c26.campanaId && q.negocioId).map((q) => q.negocioId!))) {
  try {
    db = clasificar(db, n, c26.campanaId, 'a1-hosteleria.restauracion.bares-y-cafeterias.bar', porId, { alcance: al }); anotar('Clasificación', db);
    for (const vv of ['web', 'ventaOnline', 'googleBusiness', 'instagram', 'facebook', 'twitter'] as const) { db = registrarDatoDigital(db, n, c26.campanaId, vv, { respuesta: 'no' }, porId, { alcance: al }); anotar(`Digital ${vv}`, db); }
    db = verificarDigital(db, n, c26.campanaId, porId, { alcance: al }); anotar('Verificación digital', db);
  } catch { /* no aplicable */ }
}
await writeFile(salida, ops.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(`${ops.length} operaciones · primera: ${ops[0].cambios.length} entidades · resto: media ${(ops.slice(1).reduce((a, b) => a + b.cambios.length, 0) / (ops.length - 1)).toFixed(1)} entidades`);
