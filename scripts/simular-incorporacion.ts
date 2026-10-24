/**
 * C1c · SIMULACIÓN en memoria de la incorporación de un XLSX ficticio (no es un importador).
 *
 *   npm run simular-incorporacion -- archivo.xlsx [--anio=2025] [--calles=90]
 *
 * Genera la base de demostración en memoria, le añade un callejero FICTICIO («VÍA FICTICIA 001» a
 * «VÍA FICTICIA nnn») y muestra el plan, el resultado de aplicarlo, la reimportación y el deshacer.
 * No guarda nada: ni la base, ni el archivo, ni el informe. Solo imprime recuentos (sin nombres ni
 * direcciones).
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { generarDemo } from '../src/data/semilla';
import { callejeroSimulado, MEDINA } from '../src/data/callejero';
import { conCallesFicticias, viasFicticias } from '../src/data/escenarioIncorporacion';
import { prepararIncorporacion } from '../src/domain/incorporacionXlsx';
import { aplicarIncorporacion, deshacerIncorporacion } from '../src/domain/incorporacion';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const ruta = args.find((a) => !a.startsWith('--'));
if (!ruta) {
  console.error('Uso: npm run simular-incorporacion -- <archivo.xlsx> [--anio=2025] [--calles=90]');
  process.exit(1);
}
const anio = Number(opt('anio') ?? 2025);
const calles = Number(opt('calles') ?? 90);
const destino = { municipioId: 'mun-medina', anio };
const demo = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'simulación C1c' });
const db = conCallesFicticias(demo, 'mun-medina', viasFicticias(1, calles));
const bytes = new Uint8Array(await readFile(ruta));

const t0 = performance.now();
const { resultado, plan } = await prepararIncorporacion(db, bytes, basename(ruta), destino);
const t1 = performance.now();
console.log(`\nPLAN · ${plan.archivo.nombre} · SHA-256 ${plan.archivo.sha256.slice(0, 16)}… · perfil ${plan.perfil.id} v${plan.perfil.version} · hoja «${plan.hoja}» · ${plan.municipio.nombre} (${Math.round(t1 - t0)} ms)`);
console.log(`  Destino: campaña histórica nueva «${plan.destino.nombre}» (${plan.destino.campanaId}) · aplicable: ${plan.aplicable ? 'sí' : 'no'}`);
for (const b of plan.bloqueos) console.log(`  ✗ ${b.codigo}: ${b.mensaje}`);
console.log(`  Registros previstos: ${plan.registros.previstos} · excluidos por decisión: ${plan.registros.excluidos} · candidatas a excluir: ${plan.registros.candidatasExcluir.length}`);
console.log(`  Entidades nuevas: ${Object.entries(plan.nuevas).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
const c = plan.correspondencias;
console.log(`  Correspondencias: inequívocas ${c.inequivoca} · decididas ${c.decidida} · ambiguas ${c.ambigua} · sin vínculo ${c['sin-vinculo']} · excluidas ${c.excluida}`);
console.log(`    Motivos: ${Object.entries(c.porMotivo).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
console.log(`    Mismo portal (locales distintos, C1c-1): ${plan.mismoPortal.portales} portal(es) con ${plan.mismoPortal.locales} locales`);
console.log(`  Incidencias pendientes: ${plan.incidencias.total} (${Object.entries(plan.incidencias.porGravedad).map(([k, v]) => `${k} ${v}`).join(', ')})`);
console.log(`  Decisiones aplicadas: reglas ${plan.decisiones.reglasAutorizadas.length} · diccionario ${plan.decisiones.diccionarioAprobado.length} · exclusiones ${plan.decisiones.exclusiones} · correspondencias ${plan.decisiones.correspondencias} · equivalencias ${plan.decisiones.equivalenciasClasificacion}`);
for (const p of plan.pendientes) console.log(`  · Pendiente: ${p}`);
if (!plan.aplicable) process.exit(0);

const r = aplicarIncorporacion(db, resultado, destino, {}, plan, { porId: 'p-elena' });
const t2 = performance.now();
console.log(`\nAPLICADA (${Math.round(t2 - t1)} ms) · importación ${r.importacionId} · campaña ${r.campanaId}`);
console.log(`  Creadas: ${Object.entries(r.creadas).map(([k, v]) => `${k} ${v}`).join(' · ')} · modificadas: ninguna`);
const c26 = (d: typeof db) => JSON.stringify([d.campanas['camp-medina-2026'], Object.values(d.observaciones).filter((o) => o.campanaId === 'camp-medina-2026').length]);
console.log(`  Campaña 2026 intacta: ${c26(db) === c26(r.db) ? 'sí' : 'NO'}`);

const again = await prepararIncorporacion(r.db, bytes, basename(ruta), destino);
const r2 = aplicarIncorporacion(r.db, again.resultado, destino, {}, again.plan, { porId: 'p-elena' });
console.log(`\nREIMPORTACIÓN idéntica: ${again.plan.bloqueos.map((b) => b.codigo).join(', ')} · sin cambios: ${r2.sinCambios ? 'sí' : 'no'} · filas iguales ${again.plan.reimportacion?.filasIguales}`);

const u = deshacerIncorporacion(r.db, r.importacionId, 'p-elena');
const iguales = (['registros', 'locales', 'negocios', 'observaciones', 'ocupaciones', 'vinculos', 'franquicias', 'digital', 'clasificaciones', 'campanas'] as const).every((k) => Object.keys(u[k]).length === Object.keys(db[k]).length);
console.log(`DESHACER: ${iguales ? 'todas las colecciones vuelven a su estado anterior' : 'DIFERENCIAS'} · importación marcada «${u.importaciones[r.importacionId].estado}»`);
console.log('\nSimulación en memoria: no se ha guardado nada.');
