// Comprobación de la protección «Vercel Authentication» de la vista previa, SIN sesión (sin cookies).
// La usa scripts/vercel/desplegar-preview.mjs antes y después de asignar la dirección fija.
//
// Solo se da por protegida una respuesta que:
//   - procede de Vercel (cabecera `server: Vercel`), y
//   - es 401/403 sin contenido de la aplicación, o una redirección al inicio de sesión de Vercel
//     (https://vercel.com/sso-api… o https://vercel.com/login…). Cualquier otra redirección NO vale.
// Uso:
//   node scripts/vercel/proteccion.mjs urls <url> [<url>…]   → comprueba /, /index.html y /version.json
//   node scripts/vercel/proteccion.mjs configuracion < proyecto.json   → ssoProtection del proyecto
// Sale con código 1 si algo no se puede confirmar.

/** Únicos destinos de redirección admitidos: el inicio de sesión de Vercel. */
export const INICIO_SESION_VERCEL = { host: 'vercel.com', rutas: ['/sso-api', '/login'] };
/** Rutas que se comprueban en cada dirección. */
export const RUTAS_COMPROBADAS = ['/', '/index.html', '/version.json'];
/** Indicios de que la respuesta contiene la aplicación o su versión (no debe verse sin sesión). */
const CONTENIDO_APP = ['ulit-censo/version', 'assets/index-'];
/** Ámbitos de ssoProtection que cubren los despliegues de preview. */
export const AMBITOS_VALIDOS = ['all', 'preview', 'prod_deployment_urls_and_all_previews', 'all_except_custom_domains'];

/**
 * @param {{ status: number, location?: string | null, server?: string | null, cuerpo?: string }} r
 * @returns {{ ok: boolean, motivo: string }}
 */
export function evaluarRespuestaSinSesion(r) {
  if ((r.server ?? '').trim().toLowerCase() !== 'vercel') {
    return { ok: false, motivo: `la respuesta no procede de Vercel (server: ${r.server ?? 'ausente'})` };
  }
  if (r.status === 401 || r.status === 403) {
    const filtrado = CONTENIDO_APP.find((m) => (r.cuerpo ?? '').includes(m));
    return filtrado
      ? { ok: false, motivo: `responde ${r.status} pero el cuerpo contiene la aplicación («${filtrado}»)` }
      : { ok: true, motivo: `${r.status} (se exige iniciar sesión)` };
  }
  if (r.status >= 300 && r.status < 400) {
    if (!r.location) return { ok: false, motivo: `redirección ${r.status} sin destino` };
    let destino;
    try {
      destino = new URL(r.location);
    } catch {
      return { ok: false, motivo: `redirección ${r.status} a un destino no absoluto (${r.location.slice(0, 80)})` };
    }
    const legitima =
      destino.protocol === 'https:' &&
      destino.hostname === INICIO_SESION_VERCEL.host &&
      !destino.port &&
      !destino.username &&
      INICIO_SESION_VERCEL.rutas.some((p) => destino.pathname === p || destino.pathname.startsWith(`${p}/`));
    return legitima
      ? { ok: true, motivo: `redirección ${r.status} al inicio de sesión de Vercel (${destino.origin}${destino.pathname})` }
      : { ok: false, motivo: `redirección ${r.status} a un destino que no es el inicio de sesión de Vercel (${destino.origin}${destino.pathname})` };
  }
  return { ok: false, motivo: `responde ${r.status} sin sesión: accesible para cualquiera` };
}

/** Pide una ruta SIN cookies ni seguir redirecciones y la evalúa. */
export async function comprobarRuta(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', cache: 'no-store', headers: { 'user-agent': 'ulit-censo-comprobacion-proteccion' } });
    const cuerpo = res.status >= 300 && res.status < 400 ? '' : (await res.text()).slice(0, 200_000);
    return evaluarRespuestaSinSesion({ status: res.status, location: res.headers.get('location'), server: res.headers.get('server'), cuerpo });
  } catch (e) {
    return { ok: false, motivo: `no se ha podido comprobar (${e instanceof Error ? e.message : String(e)})` };
  }
}

/** Comprueba todas las rutas de una dirección; protegida solo si lo están TODAS. */
export async function comprobarDireccion(base) {
  const raiz = base.replace(/\/+$/, '');
  const resultados = [];
  for (const ruta of RUTAS_COMPROBADAS) resultados.push({ url: `${raiz}${ruta}`, ...(await comprobarRuta(`${raiz}${ruta}`)) });
  return { ok: resultados.every((r) => r.ok), resultados };
}

/** Comprueba la configuración del proyecto (respuesta de GET /v9/projects/:id). */
export function evaluarConfiguracion(proyecto) {
  const sso = proyecto?.ssoProtection;
  if (!sso) return { ok: false, motivo: 'Vercel Authentication no está activada en el proyecto (ssoProtection vacío)' };
  if (!AMBITOS_VALIDOS.includes(sso.deploymentType)) return { ok: false, motivo: `Vercel Authentication con un ámbito que no cubre las previews (${sso.deploymentType})` };
  return { ok: true, motivo: `Vercel Authentication activada (ámbito: ${sso.deploymentType})` };
}

async function principal(argv) {
  const [orden, ...resto] = argv;
  if (orden === 'configuracion') {
    let texto = '';
    for await (const trozo of process.stdin) texto += trozo;
    let proyecto = null;
    try {
      proyecto = JSON.parse(texto);
    } catch {
      /* se trata como configuración desconocida */
    }
    const r = evaluarConfiguracion(proyecto);
    console.log(`${r.ok ? '✔' : '✘'} ${r.motivo}`);
    return r.ok ? 0 : 1;
  }
  if (orden === 'urls' && resto.length) {
    let ok = true;
    for (const base of resto) {
      const r = await comprobarDireccion(base);
      for (const x of r.resultados) console.log(`${x.ok ? '✔' : '✘'} ${x.url} → ${x.motivo}`);
      ok &&= r.ok;
    }
    return ok ? 0 : 1;
  }
  console.error('Uso: proteccion.mjs urls <url>… | proteccion.mjs configuracion < proyecto.json');
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal(process.argv.slice(2)).then((c) => process.exit(c));
}
