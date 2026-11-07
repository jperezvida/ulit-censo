#!/usr/bin/env node
/**
 * ULIT Censo · COPIA EXTERNA de los archivos de Supabase Storage (los bytes; el volcado 9200 solo tiene sus metadatos).
 * Solo LEE: lista los buckets y descarga cada objeto (GET). No crea, mueve ni borra nada.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co  SUPABASE_SERVICE_ROLE_KEY=…  DESTINO=/ruta/institucional  node 20261104_9202_respaldo_storage.mjs
 *
 * - La clave de servicio es PRIVILEGIADA: solo en el entorno local de la persona responsable (nunca en el
 *   navegador, el repositorio, el chat ni GitHub). Hace falta para leer los buckets privados.
 * - Integridad: cada archivo se compara con los metadatos que guarda Storage (tamaño y eTag = MD5 cuando la
 *   subida no fue por partes) y se registra su SHA-256 en un manifiesto. Todo queda con permisos 600.
 * - Por pantalla solo se muestran recuentos por bucket (sin nombres de archivo).
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const URL_BASE = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const CLAVE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DESTINO = process.env.DESTINO ?? '';
if (!URL_BASE || !CLAVE || !DESTINO) { console.error('✗ Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o DESTINO.'); process.exit(96); }
process.umask(0o077);
const cab = { apikey: CLAVE, Authorization: `Bearer ${CLAVE}` };
async function api(ruta, opciones = {}) {
  const r = await fetch(`${URL_BASE}/storage/v1/${ruta}`, { ...opciones, headers: { ...cab, ...(opciones.headers ?? {}) } });
  if (!r.ok) throw new Error(`Storage respondió ${r.status} en ${ruta.split('/')[0]}`);
  return r;
}
/** Lista recursiva de objetos de un bucket (las «carpetas» vienen con id null). */
async function listar(bucket, prefijo = '') {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await api(`object/list/${encodeURIComponent(bucket)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: prefijo, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }) });
    const xs = await r.json();
    for (const x of xs) {
      const ruta = prefijo ? `${prefijo}/${x.name}` : x.name;
      if (x.id === null) out.push(...await listar(bucket, ruta));
      else out.push({ ruta, tamano: Number(x.metadata?.size ?? NaN), etag: String(x.metadata?.eTag ?? '').replace(/"/g, '') });
    }
    if (xs.length < 1000) return out;
  }
}

const raiz = resolve(DESTINO, `storage-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`);
mkdirSync(raiz, { recursive: true, mode: 0o700 });
const manifiesto = [];
const resumen = [];
let fallos = 0;
const buckets = await (await api('bucket')).json();
for (const b of buckets.sort((x, y) => x.name.localeCompare(y.name))) {
  const objetos = await listar(b.name);
  let ok = 0;
  for (const o of objetos) {
    const bytes = Buffer.from(await (await api(`object/${encodeURIComponent(b.name)}/${o.ruta.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer());
    const md5 = createHash('md5').update(bytes).digest('hex');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const tamanoOk = bytes.length === o.tamano;
    const etagComprobable = /^[0-9a-f]{32}$/.test(o.etag);
    const etagOk = !etagComprobable || md5 === o.etag;
    const f = join(raiz, b.name, o.ruta);
    mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
    writeFileSync(f, bytes, { mode: 0o600 });
    manifiesto.push({ bucket: b.name, publico: !!b.public, ruta: o.ruta, bytes: bytes.length, sha256, md5, etag: o.etag, tamanoOk, etagOk, etagComprobable });
    if (tamanoOk && etagOk) ok++; else fallos++;
  }
  resumen.push(`${b.name} (${b.public ? 'público' : 'privado'}): ${objetos.length} objeto(s), ${ok} verificado(s)`);
}
writeFileSync(join(raiz, 'manifiesto.json'), JSON.stringify(manifiesto, null, 1), { mode: 0o600 });
const total = manifiesto.length;
const sinEtag = manifiesto.filter((m) => !m.etagComprobable).length;
writeFileSync(join(raiz, 'resumen.txt'), `${resumen.join('\n')}\nTotal: ${total} objeto(s) · ${fallos} con diferencias · ${sinEtag} sin MD5 comprobable (subida por partes: verificado por tamaño)\n`, { mode: 0o600 });
chmodSync(raiz, 0o700);
console.log(resumen.join('\n'));
console.log(`${fallos ? '✗' : '✓'} Storage: ${buckets.length} bucket(s), ${total} objeto(s) copiados en ${raiz} · ${fallos} con diferencias · ${sinEtag} sin MD5 comprobable`);
process.exit(fallos ? 97 : 0);
