/**
 * Garantías para analizar el Excel REAL en la vista previa web (C1e-B), evaluadas en el navegador.
 *
 * En la vista previa (Vercel) el análisis del archivo auténtico solo se habilita si se cumplen TODAS:
 *  1. **Protección:** sin sesión, el sitio no es accesible (401/403 o redirección a la autenticación).
 *  2. **Sin transmisión:** la Content-Security-Policy servida impide conectar con nada que no sea el
 *     propio sitio o las teselas del mapa base, y no admite scripts de terceros, `eval` ni formularios.
 *  3. **Versión revisada:** el código que se ejecuta procede de la rama revisada y coincide (commit y
 *     huella SHA-256 de cada archivo) con el `version.json` de la compilación.
 * Si alguna no se puede verificar, la función no se habilita y se muestra el motivo concreto.
 * En `localhost` (equipo propio) no hacen falta: el sitio no está expuesto.
 */

export type Entorno = 'local' | 'vista-previa' | 'otro';

export function entornoDe(hostname: string): Entorno {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1') return 'local';
  if (hostname.endsWith('.vercel.app')) return 'vista-previa';
  return 'otro';
}

/** Única rama cuya compilación puede analizar el Excel real en la vista previa. */
export const RAMA_REVISADA = 'claude/fase2-oficina-itinerarios';
/** Únicos orígenes externos admitidos (teselas del mapa base: solo coordenadas, nunca datos del censo). */
export const EXTERNOS_PERMITIDOS = ['https://tiles.openfreemap.org'];

export interface Garantia {
  id: 'proteccion' | 'csp' | 'version' | 'huellas' | 'entorno';
  ok: boolean;
  texto: string;
}

/** Directivas de una CSP → conjunto de fuentes por directiva. */
export function directivasCsp(csp: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const parte of csp.split(';')) {
    const [d, ...fuentes] = parte.trim().split(/\s+/).filter(Boolean);
    if (d) m.set(d.toLowerCase(), fuentes);
  }
  return m;
}

export function evaluarCsp(csp: string | null): Garantia {
  if (!csp) return { id: 'csp', ok: false, texto: 'El sitio no envía una Content-Security-Policy: no se puede garantizar que los datos no salgan a servicios externos.' };
  const d = directivasCsp(csp);
  const problemas: string[] = [];
  const solo = (dir: string, admitidas: string[]) => {
    const f = d.get(dir) ?? d.get('default-src');
    if (!f) return problemas.push(`falta ${dir}`);
    const ajenas = f.filter((x) => !admitidas.includes(x));
    if (ajenas.length) problemas.push(`${dir} admite ${ajenas.join(' ')}`);
  };
  if ((d.get('default-src') ?? []).join(' ') !== "'self'") problemas.push("default-src no es 'self'");
  solo('script-src', ["'self'"]);
  solo('connect-src', ["'self'", ...EXTERNOS_PERMITIDOS]);
  solo('img-src', ["'self'", 'data:', 'blob:', ...EXTERNOS_PERMITIDOS]);
  solo('worker-src', ["'self'", 'blob:']);
  solo('font-src', ["'self'", 'data:']);
  if ((d.get('form-action') ?? []).join(' ') !== "'none'") problemas.push("form-action no es 'none'");
  if ((d.get('object-src') ?? []).join(' ') !== "'none'") problemas.push("object-src no es 'none'");
  return problemas.length
    ? { id: 'csp', ok: false, texto: `La política de seguridad no impide la salida de datos: ${problemas.join('; ')}.` }
    : { id: 'csp', ok: true, texto: `El navegador solo permite conectar con este sitio y con las teselas del mapa base (${EXTERNOS_PERMITIDOS.join(', ')}); sin scripts de terceros, eval ni formularios.` };
}

export function evaluarProteccion(sinSesion: { status: number; type: string } | null): Garantia {
  if (!sinSesion) return { id: 'proteccion', ok: false, texto: 'No se ha podido comprobar la protección del sitio.' };
  const ok = sinSesion.type === 'opaqueredirect' || sinSesion.status === 401 || sinSesion.status === 403;
  return ok
    ? { id: 'proteccion', ok: true, texto: `Protegido: sin sesión, el sitio responde ${sinSesion.type === 'opaqueredirect' ? 'con una redirección a la autenticación' : sinSesion.status}.` }
    : { id: 'proteccion', ok: false, texto: `NO protegido: sin sesión, el sitio responde ${sinSesion.status}. Cualquiera con la dirección podría abrirlo.` };
}

export interface VersionServida {
  formato: string;
  commit: string;
  rama: string;
  archivos: Record<string, string>;
}

export function evaluarVersion(embebida: { commit: string; rama: string }, servida: VersionServida | null): Garantia {
  if (!servida || servida.formato !== 'ulit-censo/version') return { id: 'version', ok: false, texto: 'No se ha podido leer version.json del sitio.' };
  if (servida.commit !== embebida.commit) return { id: 'version', ok: false, texto: `El código en ejecución (${embebida.commit.slice(0, 7)}) no coincide con la versión publicada (${servida.commit.slice(0, 7)}): recargue la página.` };
  if (servida.rama !== RAMA_REVISADA) return { id: 'version', ok: false, texto: `Compilación de la rama «${servida.rama}», no de la rama revisada «${RAMA_REVISADA}».` };
  return { id: 'version', ok: true, texto: `Versión ${servida.commit.slice(0, 7)} de la rama revisada «${RAMA_REVISADA}».` };
}

export function evaluarHuellas(r: { comprobados: number; distintos: string[]; error?: string }): Garantia {
  if (r.error) return { id: 'huellas', ok: false, texto: `No se han podido comprobar los archivos publicados: ${r.error}` };
  if (r.distintos.length) return { id: 'huellas', ok: false, texto: `${r.distintos.length} archivo(s) publicados no coinciden con la compilación: ${r.distintos.slice(0, 3).join(', ')}.` };
  if (!r.comprobados) return { id: 'huellas', ok: false, texto: 'No hay archivos que comprobar.' };
  return { id: 'huellas', ok: true, texto: `Los ${r.comprobados} archivos de código y datos publicados coinciden, uno a uno, con las huellas SHA-256 de la compilación.` };
}

/** Archivos cuya huella se comprueba (código y datos; las fuentes tipográficas no pueden transmitir nada). */
export const esArchivoVerificable = (ruta: string) => /\.(js|mjs|css|html|json)$/.test(ruta);
