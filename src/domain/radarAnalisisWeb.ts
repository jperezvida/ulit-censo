import { normalizarPerfilRadar, type RedRadar } from './radarDigitalIT1.js';
import { mencionesEnTexto, webSegura, type ContextoNegocio, type PaginaRadar } from './radarInvestigacion.js';

const RUTA_NO_PERFIL = /^(?:p|reel|reels|stories|explore|accounts|share|sharer|intent|hashtag|search|home|photo|photos|watch|groups|events|login|dialog|plugins|posts|status|i)(\/|$)/;

/** Enlace a una ficha de Google Maps (no un mapa incrustado ni una búsqueda genérica). */
export function esEnlaceFichaGoogle(u: URL): boolean {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'maps.app.goo.gl' || host === 'g.page') return u.pathname.length > 1;
  if (host === 'goo.gl') return u.pathname.startsWith('/maps/');
  if (/^google\.[a-z.]+$/.test(host)) return /^\/maps\/(?:place|search)\//.test(u.pathname) || (u.pathname === '/maps' && u.searchParams.has('cid'));
  if (/^maps\.google\.[a-z.]+$/.test(host)) return u.searchParams.has('cid');
  return false;
}

/** Quita bloques <etiqueta>…</etiqueta> en tiempo lineal (sin regex con retroceso ante HTML hostil). */
function quitarBloques(html: string, etiqueta: string, conservar?: RegExp): string {
  const bajo = html.toLowerCase();
  let res = '';
  let i = 0;
  for (let ini = bajo.indexOf('<' + etiqueta, i); ini >= 0; ini = bajo.indexOf('<' + etiqueta, i)) {
    const finApertura = bajo.indexOf('>', ini);
    const cierre = bajo.indexOf('</' + etiqueta, finApertura < 0 ? ini : finApertura);
    const fin = cierre < 0 ? html.length : (bajo.indexOf('>', cierre) + 1 || html.length);
    const bloque = html.slice(ini, fin);
    res += html.slice(i, ini) + (conservar?.test(bloque.slice(0, Math.max(0, finApertura - ini + 1))) ? bloque : ' ');
    i = fin;
  }
  return res + html.slice(i);
}

/** Texto visible + datos estructurados (JSON-LD), sin scripts ni estilos. */
export function textoVisible(html: string): string {
  let t = quitarBloques(html.slice(0, 300_000), 'script', /application\/ld\+json/i);
  for (const e of ['style', 'noscript', 'svg']) t = quitarBloques(t, e);
  return t
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|#39|apos);/gi, ' ')
    .replace(/\\u00([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Analiza el HTML público de UNA página. Solo extrae enlaces que la propia web publica
 * (no rastrea redes ni buscadores) y comprueba si menciona el nombre, la calle y el municipio.
 * Nada se confirma como dato del comercio sin revisión humana.
 */
export function analizarPagina(html: string, pagina: string, ctx: ContextoNegocio, solicitada?: string): PaginaRadar & { solicitada?: string } {
  const redes: Partial<Record<RedRadar, string>> = {};
  let fichaGoogle: string | undefined;
  const contenidos: string[] = [];
  for (const etiqueta of (html.match(/<a\b[^>]*>/gi) ?? []).slice(0, 2500)) {
    const m = etiqueta.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (m) contenidos.push(m[1] ?? m[2] ?? m[3]);
  }
  // Cuentas oficiales declaradas en schema.org (sameAs) y enlace al mapa (hasMap).
  for (const m of html.matchAll(/"(?:sameAs|hasMap)"\s*:\s*(\[[^\]]{0,3000}\]|"[^"]{0,600}")/gi)) {
    for (const url of m[1].replace(/\\\//g, '/').match(/https?:\/\/[^"\s,\\]+/gi) ?? []) contenidos.push(url);
  }
  for (const raw of contenidos) {
    let u: URL;
    try { u = new URL(raw.replace(/&amp;/gi, '&').trim(), pagina); } catch { continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    if (!fichaGoogle && esEnlaceFichaGoogle(u)) {
      fichaGoogle = webSegura(u.toString()) ?? undefined;
      continue;
    }
    const dominio = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    const red: RedRadar | undefined = dominio === 'instagram.com' ? 'instagram'
      : ['facebook.com', 'fb.com', 'fb.me'].includes(dominio) ? 'facebook'
      : ['x.com', 'twitter.com'].includes(dominio) ? 'twitter' : undefined;
    if (!red || redes[red]) continue;
    const path = u.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!path || RUTA_NO_PERFIL.test(path) || u.searchParams.has('u') || u.searchParams.has('url')) continue;
    const perfil = normalizarPerfilRadar(red, u.toString().replace(/^http:/, 'https:'));
    if (perfil) redes[red] = perfil;
  }
  const indiciosVenta: string[] = [];
  const texto = html.slice(0, 300_000);
  if (/woocommerce|wc-add-to-cart|add-to-cart=/i.test(texto)) indiciosVenta.push('Tecnología de tienda (WooCommerce)');
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(texto)) indiciosVenta.push('Tecnología de tienda (Shopify)');
  if (/\b(?:href|action)=["'][^"']*\/(?:cart|carrito|checkout|finalizar-compra)(?:\/|\?|["'])/i.test(texto))
    indiciosVenta.push('Enlace a carrito o pago');
  if (/"@type"\s*:\s*"Product"|itemtype=["']https?:\/\/schema\.org\/Product/i.test(texto))
    indiciosVenta.push('Datos estructurados de producto');
  const tituloRaw = html.match(/<title\b[^>]*>([\s\S]{1,250}?)<\/title>/i)?.[1];
  const titulo = tituloRaw?.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|nbsp|quot);/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
  return {
    url: pagina, ...(solicitada ? { solicitada } : {}), ...(titulo ? { titulo } : {}),
    menciones: mencionesEnTexto(textoVisible(html), ctx),
    redes, ...(fichaGoogle ? { fichaGoogle } : {}), indiciosVenta,
  };
}
