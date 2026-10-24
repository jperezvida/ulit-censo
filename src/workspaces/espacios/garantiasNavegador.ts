import { entornoDe, esArchivoVerificable, evaluarCsp, evaluarHuellas, evaluarProteccion, evaluarVersion, type Garantia, type VersionServida } from '../../domain/garantias';

/** Versión incrustada al compilar (vite.config.ts). */
export const VERSION_EMBEBIDA = { commit: import.meta.env.VITE_COMMIT ?? 'desconocido', rama: import.meta.env.VITE_RAMA ?? 'desconocida' };

async function sha256(b: ArrayBuffer): Promise<string> {
  const h = await globalThis.crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface ResultadoGarantias {
  entorno: ReturnType<typeof entornoDe>;
  garantias: Garantia[];
  /** ¿Se puede analizar el Excel real en este sitio? */
  ok: boolean;
}

/**
 * Comprueba en el navegador las garantías de la vista previa (solo peticiones al PROPIO sitio). En el
 * equipo propio (`localhost`) no hacen falta. En cualquier otro sitio que no sea la vista previa de
 * Vercel, el análisis del Excel real no se habilita.
 */
export async function comprobarGarantias(hostname = location.hostname): Promise<ResultadoGarantias> {
  const entorno = entornoDe(hostname);
  if (entorno === 'local') {
    return { entorno, ok: true, garantias: [{ id: 'entorno', ok: true, texto: 'Equipo propio (localhost): el sitio no está expuesto a otras personas.' }] };
  }
  if (entorno === 'otro') {
    return { entorno, ok: false, garantias: [{ id: 'entorno', ok: false, texto: `Sitio no reconocido (${hostname}): el análisis del Excel real solo se habilita en la vista previa protegida o en el equipo propio.` }] };
  }
  const garantias: Garantia[] = [];
  // 1. Protección: la misma petición SIN credenciales (cookies) debe ser rechazada.
  let sinSesion: { status: number; type: string } | null = null;
  try {
    const r = await fetch('./version.json', { credentials: 'omit', cache: 'no-store', redirect: 'manual' });
    sinSesion = { status: r.status, type: r.type };
  } catch {
    sinSesion = null;
  }
  garantias.push(evaluarProteccion(sinSesion));
  // 2. Política de seguridad del documento.
  let csp: string | null = null;
  try {
    const r = await fetch(location.pathname || './', { cache: 'no-store' });
    csp = r.headers.get('content-security-policy');
  } catch {
    csp = null;
  }
  garantias.push(evaluarCsp(csp));
  // 3. Versión y huellas de lo publicado.
  let servida: VersionServida | null = null;
  try {
    const r = await fetch('./version.json', { cache: 'no-store' });
    servida = r.ok ? await r.json() : null;
  } catch {
    servida = null;
  }
  garantias.push(evaluarVersion(VERSION_EMBEBIDA, servida));
  if (servida) {
    const distintos: string[] = [];
    let comprobados = 0;
    let error: string | undefined;
    try {
      for (const [ruta, h] of Object.entries(servida.archivos)) {
        if (!esArchivoVerificable(ruta)) continue;
        const r = await fetch(`./${ruta}`, { cache: 'no-store' });
        if (!r.ok || (await sha256(await r.arrayBuffer())) !== h) distintos.push(ruta);
        comprobados++;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    garantias.push(evaluarHuellas({ comprobados, distintos, error }));
  } else garantias.push(evaluarHuellas({ comprobados: 0, distintos: [], error: 'sin version.json' }));
  return { entorno, garantias, ok: garantias.every((g) => g.ok) };
}
