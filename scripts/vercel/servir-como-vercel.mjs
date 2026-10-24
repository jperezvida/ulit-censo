#!/usr/bin/env node
/**
 * SOLO PARA COMPROBACIONES LOCALES: sirve `.vercel/output/static` con las MISMAS cabeceras que la vista
 * previa de Vercel y emula su protección (sin la cookie de sesión → 401). Permite verificar en un
 * navegador de pruebas la CSP y las garantías de C1e-B antes de desplegar.
 *
 *   node scripts/vercel/servir-como-vercel.mjs <puerto> <cert.pem> <clave.pem> [--sin-proteccion] [--alterar=<ruta>]
 */
import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { CABECERAS, SIN_CACHE } from './cabeceras.mjs';

const [puerto, cert, clave] = process.argv.slice(2);
const sinProteccion = process.argv.includes('--sin-proteccion');
const alterar = process.argv.find((a) => a.startsWith('--alterar='))?.slice(10);
const RAIZ = '.vercel/output/static';
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.md': 'text/markdown' };

createServer({ cert: readFileSync(cert), key: readFileSync(clave) }, async (req, res) => {
  const ruta = decodeURIComponent(new URL(req.url, 'https://x').pathname);
  const cabeceras = { ...CABECERAS, ...(SIN_CACHE.includes(ruta) ? { 'Cache-Control': 'no-store' } : {}) };
  if (!sinProteccion && !(req.headers.cookie ?? '').includes('_vercel_jwt=prueba')) {
    res.writeHead(401, { ...cabeceras, 'Content-Type': 'text/html' });
    return res.end('<h1>Authentication Required</h1>');
  }
  const rel = ruta === '/' ? 'index.html' : normalize(ruta).replace(/^[/\\]+/, '');
  try {
    let cuerpo = await readFile(join(RAIZ, rel));
    if (alterar && rel === alterar) cuerpo = Buffer.concat([cuerpo, Buffer.from('\n/* alterado */')]);
    res.writeHead(200, { ...cabeceras, 'Content-Type': TIPOS[extname(rel)] ?? 'application/octet-stream' });
    res.end(cuerpo);
  } catch {
    res.writeHead(404, cabeceras);
    res.end('no encontrado');
  }
}).listen(Number(puerto), '127.0.0.1', () => console.log(`https://127.0.0.1:${puerto} ${sinProteccion ? '(SIN protección)' : '(protegido)'}${alterar ? ` alterando ${alterar}` : ''}`));
