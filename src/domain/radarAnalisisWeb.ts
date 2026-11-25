import { normalizarPerfilRadar, type HallazgoRadar, type RedRadar } from './radarDigitalIT1';

/** Extrae indicios de HTML público. Nada se confirma como dato del comercio sin revisión humana. */
export function extraerEnlacesPublicos(html: string, pagina: string): HallazgoRadar {
  const redes: Partial<Record<RedRadar,string>> = {};
  const contenidos: string[] = [];
  // Primero enlaces publicados en la propia web; no rastrea páginas externas ni buscadores.
  const etiquetas = html.match(/<a\b[^>]*>/gi) ?? [];
  for (const etiqueta of etiquetas.slice(0,2500)) {
    const m = etiqueta.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (m) contenidos.push(m[1] ?? m[2] ?? m[3]);
  }
  // Algunos sitios declaran cuentas oficiales mediante JSON-LD schema.org/sameAs.
  for (const m of html.matchAll(/"sameAs"\s*:\s*(\[[^\]]*\]|"[^"]*")/gi)) {
    for (const url of m[1].match(/https?:\\?\/\\?\/[^"\s,\\]+/gi) ?? []) contenidos.push(url.replace(/\\\//g,'/'));
  }

  for (const raw of contenidos) {
    if (Object.keys(redes).length === 3) break;
    let u: URL;
    try { u = new URL(raw.replace(/&amp;/gi,'&').trim(), pagina); }
    catch { continue; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
    const dominio = u.hostname.toLowerCase().replace(/^www\./,'').replace(/^m\./,'');
    let red: RedRadar | undefined;
    if (dominio === 'instagram.com') red = 'instagram';
    else if (dominio === 'facebook.com' || dominio === 'fb.com' || dominio === 'fb.me') red = 'facebook';
    else if (dominio === 'x.com' || dominio === 'twitter.com') red = 'twitter';
    if (!red || redes[red]) continue;
    const path = u.pathname.replace(/^\/+|\/+$/g,'').toLowerCase();
    if (!path || /^(?:p|reel|reels|stories|explore|accounts|share|sharer|intent|hashtag|search|home|photo|photos|watch|groups|events|login|dialog|plugins|posts|status|i)(\/|$)/.test(path)) continue;
    if (u.searchParams.has('u') || u.searchParams.has('url')) continue;
    u.search = ''; u.hash = '';
    const perfil=normalizarPerfilRadar(red,u.toString());
    if(perfil) redes[red] = perfil;
  }
  const señales: string[] = [];
  const texto = html.slice(0,300000);
  if (/woocommerce|wc-add-to-cart|add-to-cart=/i.test(texto)) señales.push('Tecnología de tienda (WooCommerce)');
  if (/cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(texto)) señales.push('Tecnología de tienda (Shopify)');
  if (/\b(?:href|action)=["'][^"']*\/(?:cart|carrito|checkout|finalizar-compra)(?:\/|\?|["'])/i.test(texto))
    señales.push('Enlace a carrito o pago');
  if (/"@type"\s*:\s*"Product"|itemtype=["']https?:\/\/schema\.org\/Product/i.test(texto))
    señales.push('Datos estructurados de producto');
  const tituloRaw = html.match(/<title\\b[^>]*>([\\s\\S]{1,250}?)<\\/title>/i)?.[1];
  const titulo=tituloRaw?.replace(/<[^>]*>/g,' ').replace(/&(?:amp|nbsp|quot);/gi,' ').replace(/\\s+/g,' ').trim().slice(0,180);
  return {
    urlFinal: pagina, redes, indiciosVenta: señales,
    ...(titulo ? {titulo} : {}),
    analizadoEn:new Date().toISOString(),
  };
}
