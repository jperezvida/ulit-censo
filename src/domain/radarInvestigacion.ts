import { claveCalle, normalizar } from './text.js';
import {
  leerBorradoresRadar, normalizarPerfilRadar, REDES_RADAR, type NegocioPiloto, type RedRadar,
} from './radarDigitalIT1.js';

/**
 * Radar Digital · modelo de investigación por evidencias.
 *
 * - Una EVIDENCIA es una posible fuente (web, perfil, ficha, tienda) con su procedencia verificable
 *   (enlace al objeto de OpenStreetMap, a la entidad de Wikidata o a la página analizada) y los
 *   CRITERIOS que cumple. No hay puntuaciones: el nivel se deduce de reglas legibles.
 * - Encontrado: hay una coincidencia. Probablemente relacionado: coincide el nombre y además la calle
 *   o la web menciona el municipio. Confirmado / descartado: solo por decisión humana.
 * - «No encontrado» nunca se convierte en «No»: solo una persona puede decidir que no existe.
 * - Nada de esto modifica el Excel ni los datos oficiales del censo.
 */

export type CampoRadar = 'web' | 'googleBusiness' | 'instagram' | 'facebook' | 'twitter' | 'ventaOnline';
/** El orden fija los atajos 1–6. `excel` es la clave del campo binario del Excel 2026. */
export const CAMPOS_RADAR: readonly { clave: CampoRadar; etiqueta: string }[] = [
  { clave: 'web', etiqueta: 'Web oficial' },
  { clave: 'googleBusiness', etiqueta: 'Ficha de Google' },
  { clave: 'instagram', etiqueta: 'Instagram' },
  { clave: 'facebook', etiqueta: 'Facebook' },
  { clave: 'twitter', etiqueta: 'X / Twitter' },
  { clave: 'ventaOnline', etiqueta: 'Venta online' },
];

export type FuenteRadar = 'osm' | 'wikidata' | 'web' | 'dominio' | 'manual';
export const TEXTO_FUENTE: Record<FuenteRadar, string> = {
  osm: 'OpenStreetMap',
  wikidata: 'Wikidata (marca)',
  web: 'Web analizada',
  dominio: 'Dominio deducido del nombre',
  manual: 'Aportado por ti',
};

export type CriterioRadar = 'nombre' | 'calle' | 'numero' | 'otro-numero' | 'municipio' | 'enlazado' | 'osm' | 'marca' | 'tienda';
export const TEXTO_CRITERIO: Record<CriterioRadar, string> = {
  nombre: 'Mismo nombre',
  calle: 'Misma calle',
  numero: 'Mismo número',
  'otro-numero': 'Otro número de portal',
  municipio: 'Menciona el municipio',
  enlazado: 'Enlazado desde la web',
  osm: 'Declarado en OpenStreetMap',
  marca: 'Cuenta de la marca o cadena',
  tienda: 'Carrito o pago en la web',
};
const CRITERIOS = Object.keys(TEXTO_CRITERIO) as CriterioRadar[];
const FUENTES = Object.keys(TEXTO_FUENTE) as FuenteRadar[];

export interface ProcedenciaRadar { fuente: FuenteRadar; origen: string }
export interface EvidenciaRadar {
  campo: CampoRadar;
  /** Valor propuesto: dirección de la web, del perfil, de la ficha o de la página con tienda. */
  url: string;
  procedencias: ProcedenciaRadar[];
  criterios: CriterioRadar[];
  detalle?: string;
}
export type NivelRadar = 'encontrado' | 'relacionado';

/**
 * Regla única y comprensible: nombre + (calle o municipio), salvo cuentas de marca o cadena,
 * venta online y homónimos en otro número de portal, que siempre requieren una persona.
 */
export function nivelEvidencia(e: EvidenciaRadar): NivelRadar {
  const c = new Set(e.criterios);
  if (e.campo === 'ventaOnline' || c.has('marca') || c.has('otro-numero')) return 'encontrado';
  return c.has('nombre') && (c.has('calle') || c.has('municipio')) ? 'relacionado' : 'encontrado';
}
export const claveEvidencia = (e: Pick<EvidenciaRadar, 'campo' | 'url'>) => `${e.campo}|${e.url}`;

// ───────────────────────── Coincidencias de texto ─────────────────────────

const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'con', 'por', 'sl', 'sa', 'slu', 'cb', 'sc']);
export function tokensTexto(texto: string): string[] {
  return normalizar(texto).replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !VACIAS.has(w));
}
/** El nombre más corto está contenido completo en el otro («Talleres García» ⊂ «Talleres Hermanos García»). */
export function nombresEquivalentes(a: string, b: string): boolean {
  const A = tokensTexto(a);
  const B = tokensTexto(b);
  if (!A.length || !B.length) return false;
  const [corto, largo] = A.length <= B.length ? [A, B] : [B, A];
  const conjunto = new Set(largo);
  return corto.every((t) => conjunto.has(t));
}
function nombreCalle(direccion: string): string[] {
  return tokensTexto(claveCalle(direccion).split(' ').slice(1).join(' '));
}
export function mismaCalle(a: string, b: string): boolean {
  return !!a.trim() && !!b.trim() && claveCalle(a) === claveCalle(b);
}
const numeroDe = (n: string) => n.match(/\d+/)?.[0] ?? '';

export interface ContextoNegocio { nombre: string; calle: string; municipio: string }
/** Qué datos del establecimiento aparecen en el texto público de una página. */
export function mencionesEnTexto(texto: string, ctx: ContextoNegocio): CriterioRadar[] {
  const tokens = new Set(tokensTexto(texto));
  const contiene = (ts: string[]) => ts.length > 0 && ts.every((t) => tokens.has(t));
  const plano = ` ${tokensTexto(texto).join(' ')} `;
  const municipio = tokensTexto(ctx.municipio).join(' ');
  const res: CriterioRadar[] = [];
  if (contiene(tokensTexto(ctx.nombre))) res.push('nombre');
  if (contiene(nombreCalle(ctx.calle))) res.push('calle');
  if (municipio && plano.includes(` ${municipio} `)) res.push('municipio');
  return res;
}

// ───────────────────────── OpenStreetMap ─────────────────────────

export interface LugarOSM {
  /** «node/123», «way/45»… */
  id: string;
  nombre: string;
  marca?: string;
  /** Identificador Wikidata de la marca (brand:wikidata), p. ej. «Q123». */
  marcaWd?: string;
  calle?: string;
  numero?: string;
  web?: string;
  instagram?: string;
  facebook?: string;
  twitter?: string;
}
const HOSTS_RED: Record<RedRadar, string> = {
  instagram: 'https://www.instagram.com/', facebook: 'https://www.facebook.com/', twitter: 'https://x.com/',
};
/**
 * Acepta URL o usuario («@tienda», «tienda») y devuelve un perfil CANÓNICO (mismo host, sin barra
 * final) o null: así la misma cuenta encontrada en dos fuentes se reconoce como una sola.
 */
export function perfilDesdeValor(red: RedRadar, valor: string | undefined): string | null {
  const v = valor?.trim();
  if (!v || v.length > 300) return null;
  let url: string | null;
  if (/^https?:\/\//i.test(v)) url = normalizarPerfilRadar(red, v.replace(/^http:/i, 'https:'));
  else {
    const usuario = v.replace(/^@/, '');
    url = /^[A-Za-z0-9._-]{2,80}$/.test(usuario) ? normalizarPerfilRadar(red, HOSTS_RED[red] + usuario) : null;
  }
  if (!url) return null;
  const u = new URL(url);
  return HOSTS_RED[red] + u.pathname.replace(/^\/+|\/+$/g, '') + u.search;
}
/** Solo webs públicas HTTPS (se mejora http→https); nunca credenciales, puertos ni IP. */
export function webSegura(valor: string | undefined): string | null {
  const v = valor?.trim();
  if (!v || v.length > 500) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v.replace(/^http:/i, 'https:') : `https://${v}`);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.')
      || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(':')) return null;
    u.hash = '';
    return u.toString();
  } catch { return null; }
}

/**
 * Lugares de OpenStreetMap a partir de la búsqueda de Nominatim (una consulta por negocio, con
 * `extratags` y `addressdetails`). Solo se conservan los del municipio indicado.
 */
export function lugaresDesdeNominatim(json: unknown, municipio: string): LugarOSM[] {
  if (!Array.isArray(json)) return [];
  const m = normalizar(municipio);
  return lugaresDesdeEtiquetas({ elements: json.slice(0, 20).flatMap((r) => {
    const x = r as { osm_type?: unknown; osm_id?: unknown; name?: unknown; address?: Record<string, unknown>; extratags?: Record<string, unknown> };
    const a = x.address ?? {};
    const localidad = [a.town, a.city, a.village, a.municipality].find((v) => typeof v === 'string') as string | undefined;
    if (!localidad || normalizar(localidad) !== m) return [];
    return [{ type: x.osm_type, id: x.osm_id, tags: {
      ...(x.extratags ?? {}), name: x.name, 'addr:street': a.road ?? a.pedestrian ?? a.square, 'addr:housenumber': a.house_number,
    } }];
  }) });
}

/** Política de uso de Nominatim: como máximo 1 consulta por segundo (con margen). Ajustable en pruebas. */
export const RITMO_RADAR = { nominatimMs: 1100 };
/** Devuelve una función que, encadenada, deja al menos `ms` entre turnos consecutivos. */
export function turnosEspaciados(ms = RITMO_RADAR.nominatimMs): () => Promise<void> {
  let turno = Promise.resolve();
  let primero = true;
  return () => (turno = turno.then(() => {
    if (primero) { primero = false; return; }
    return new Promise<void>((r) => setTimeout(r, ms));
  }));
}

/** Convierte elementos con etiquetas OSM en una lista compacta y validada. */
export function lugaresDesdeEtiquetas(json: unknown): LugarOSM[] {
  const elementos = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elementos)) return [];
  const res: LugarOSM[] = [];
  for (const el of elementos.slice(0, 6000)) {
    const e = el as { type?: unknown; id?: unknown; tags?: Record<string, unknown> };
    const t = e.tags ?? {};
    const txt = (k: string) => typeof t[k] === 'string' ? (t[k] as string).slice(0, 300) : undefined;
    const nombre = txt('name');
    if (!nombre || !['node', 'way', 'relation'].includes(String(e.type)) || !Number.isInteger(e.id)) continue;
    const lugar: LugarOSM = { id: `${e.type}/${e.id}`, nombre };
    const marcaWd = txt('brand:wikidata');
    const opcional: Partial<LugarOSM> = {
      marca: txt('brand'),
      marcaWd: marcaWd && /^Q\d{1,10}$/.test(marcaWd) ? marcaWd : undefined,
      calle: txt('addr:street'),
      numero: txt('addr:housenumber'),
      web: webSegura(txt('website') ?? txt('contact:website') ?? txt('url')) ?? undefined,
      instagram: perfilDesdeValor('instagram', txt('contact:instagram') ?? txt('instagram')) ?? undefined,
      facebook: perfilDesdeValor('facebook', txt('contact:facebook') ?? txt('facebook')) ?? undefined,
      twitter: perfilDesdeValor('twitter', txt('contact:twitter') ?? txt('twitter')) ?? undefined,
    };
    for (const [k, v] of Object.entries(opcional)) if (v) (lugar as unknown as Record<string, string>)[k] = v;
    res.push(lugar);
  }
  return res;
}

export interface CoincidenciaOSM { lugar: LugarOSM; criterios: CriterioRadar[] }
/** Lugares con el mismo nombre (o marca); primero los de la misma calle. Nunca decide por sí solo. */
export function emparejarOSM(n: Pick<NegocioPiloto, 'nombre' | 'direccion' | 'numero'>, lugares: LugarOSM[]): CoincidenciaOSM[] {
  const res: CoincidenciaOSM[] = [];
  for (const lugar of lugares) {
    if (!nombresEquivalentes(n.nombre, lugar.nombre) && !(lugar.marca && nombresEquivalentes(n.nombre, lugar.marca))) continue;
    const criterios: CriterioRadar[] = ['osm', 'nombre'];
    if (lugar.calle && mismaCalle(n.direccion, lugar.calle)) {
      criterios.push('calle');
      const a = numeroDe(n.numero);
      const b = numeroDe(lugar.numero ?? '');
      // Mismo nombre y calle pero otro portal: puede ser otro establecimiento (sucursal u homónimo).
      if (a && b) criterios.push(a === b ? 'numero' : 'otro-numero');
    }
    res.push({ lugar, criterios });
  }
  // shortcut: con más de 2 homónimos se muestran los 2 mejores; si hiciera falta, buscar a mano.
  const peso = (c: CoincidenciaOSM) => c.criterios.length - (c.criterios.includes('otro-numero') ? 3 : 0);
  return res.sort((a, b) => peso(b) - peso(a)).slice(0, 2);
}
export const origenOSM = (id: string) => `https://www.openstreetmap.org/${id}`;

export function evidenciasOSM(c: CoincidenciaOSM): EvidenciaRadar[] {
  const p = [{ fuente: 'osm' as const, origen: origenOSM(c.lugar.id) }];
  const ev: EvidenciaRadar[] = [];
  if (c.lugar.web) ev.push({ campo: 'web', url: c.lugar.web, procedencias: p, criterios: c.criterios });
  for (const red of REDES_RADAR) {
    const url = c.lugar[red];
    if (url) ev.push({ campo: red, url, procedencias: p, criterios: c.criterios });
  }
  return ev;
}

// ───────────────────────── Wikidata (marcas y cadenas) ─────────────────────────

export interface MarcaWikidata { id: string; web?: string; instagram?: string; facebook?: string; twitter?: string }
/** Propiedades oficiales: P856 web, P2003 Instagram, P2013 Facebook, P2002 X. */
export function marcaDesdeWikidata(id: string, entidad: unknown): MarcaWikidata | null {
  if (!/^Q\d{1,10}$/.test(id)) return null;
  const claims = (entidad as { claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> })?.claims;
  if (!claims || typeof claims !== 'object') return { id };
  const valor = (p: string) => {
    const v = claims[p]?.[0]?.mainsnak?.datavalue?.value;
    return typeof v === 'string' ? v : undefined;
  };
  const m: MarcaWikidata = { id };
  const web = webSegura(valor('P856'));
  if (web) m.web = web;
  for (const [red, p] of [['instagram', 'P2003'], ['facebook', 'P2013'], ['twitter', 'P2002']] as const) {
    const perfil = perfilDesdeValor(red, valor(p));
    if (perfil) m[red] = perfil;
  }
  return m;
}
export function evidenciasMarca(m: MarcaWikidata): EvidenciaRadar[] {
  const p = [{ fuente: 'wikidata' as const, origen: `https://www.wikidata.org/wiki/${m.id}` }];
  return (['web', ...REDES_RADAR] as const).flatMap((campo) => {
    const url = m[campo];
    return url ? [{ campo, url, procedencias: p, criterios: ['marca'] as CriterioRadar[] }] : [];
  });
}

// ───────────────────────── Webs analizadas ─────────────────────────

/** Resultado del análisis de UNA página pública (lo devuelve /api/radar-web). */
export interface PaginaRadar {
  /** URL final tras las redirecciones. */
  url: string;
  /** URL que se pidió analizar (para saber de qué fuente procede). */
  solicitada?: string;
  titulo?: string;
  menciones: CriterioRadar[];
  redes: Partial<Record<RedRadar, string>>;
  /** Enlace a la ficha de Google Maps publicado en la propia web. */
  fichaGoogle?: string;
  indiciosVenta: string[];
}
/** Dos dominios probables a partir del nombre («Óptica Visión» → opticavision.es / .com). */
export function dominiosProbables(nombre: string): string[] {
  const slug = normalizar(nombre).replace(/[^a-z0-9]+/g, '');
  if (slug.length < 5 || slug.length > 40) return [];
  return [`https://www.${slug}.es/`, `https://www.${slug}.com/`];
}

export function evidenciasPagina(p: PaginaRadar, fuente: FuenteRadar, origenFuente?: string): EvidenciaRadar[] {
  const menciones = p.menciones.filter((c) => c === 'nombre' || c === 'calle' || c === 'municipio');
  const propia: ProcedenciaRadar = { fuente: 'web', origen: p.url };
  const procedencias = fuente === 'web' ? [propia] : [{ fuente, origen: origenFuente ?? p.url }, propia];
  const ev: EvidenciaRadar[] = [{ campo: 'web', url: p.url, procedencias, criterios: menciones }];
  const enlazado: CriterioRadar[] = ['enlazado', ...menciones];
  for (const red of REDES_RADAR) {
    const url = perfilDesdeValor(red, p.redes[red]);
    if (url) ev.push({ campo: red, url, procedencias: [propia], criterios: enlazado });
  }
  if (p.fichaGoogle) ev.push({ campo: 'googleBusiness', url: p.fichaGoogle, procedencias: [propia], criterios: enlazado });
  if (p.indiciosVenta.length) ev.push({
    campo: 'ventaOnline', url: p.url, procedencias: [propia], criterios: ['tienda', ...menciones],
    detalle: p.indiciosVenta.join(' · '),
  });
  return ev;
}

/** Une evidencias del mismo campo y valor: suma procedencias y criterios (sin duplicar). */
export function unirEvidencias(lista: EvidenciaRadar[]): EvidenciaRadar[] {
  const mapa = new Map<string, EvidenciaRadar>();
  for (const e of lista) {
    const k = claveEvidencia(e);
    const previa = mapa.get(k);
    if (!previa) { mapa.set(k, { ...e, procedencias: [...e.procedencias], criterios: [...e.criterios] }); continue; }
    for (const p of e.procedencias) {
      if (!previa.procedencias.some((x) => x.fuente === p.fuente && x.origen === p.origen)) previa.procedencias.push(p);
    }
    previa.criterios = CRITERIOS.filter((c) => previa.criterios.includes(c) || e.criterios.includes(c));
    if (e.detalle && !previa.detalle) previa.detalle = e.detalle;
  }
  return [...mapa.values()];
}

// ───────────────────────── Investigación automática ─────────────────────────

export interface ServiciosRadar {
  /** Lugares de OpenStreetMap con ese nombre en el municipio (Nominatim). */
  lugares(nombre: string): Promise<LugarOSM[]>;
  /** Cuentas oficiales de marcas por identificador Wikidata. */
  marcas(ids: string[]): Promise<MarcaWikidata[]>;
  /** Análisis de hasta 4 webs públicas; las que fallan se devuelven en `fallos`. */
  paginas(urls: string[], ctx: ContextoNegocio): Promise<{ paginas: PaginaRadar[]; fallos: { url: string; error: string }[] }>;
}
export interface ResultadoAuto {
  huella: string; fecha: string; evidencias: EvidenciaRadar[]; avisos: string[];
  /**
   * Fuentes que NO se pudieron consultar. «Sin evidencias» solo vale si está vacío: no haber podido
   * consultar una fuente no es lo mismo que no haber encontrado nada.
   */
  incompleto?: string[];
  /** Webs ya solicitadas (para reintentar una fuente sin repetir las demás). */
  analizadas?: string[];
}
export type ResultadosAuto = Record<string, ResultadoAuto>;

/** Si cambian nombre o dirección, la investigación anterior deja de valer. */
export function huellaNegocio(n: Pick<NegocioPiloto, 'nombre' | 'direccion' | 'numero'>): string {
  return [normalizar(n.nombre), claveCalle(n.direccion), numeroDe(n.numero)].join('|');
}
export const DIAS_VIGENCIA = 30;
export function resultadoVigente(r: ResultadoAuto | undefined, n: NegocioPiloto, ahora = Date.now()): boolean {
  return !!r && !r.incompleto?.length && r.huella === huellaNegocio(n) && ahora - Date.parse(r.fecha) < DIAS_VIGENCIA * 86_400_000;
}

/**
 * Investiga un negocio: OpenStreetMap (nombre y dirección) → marca (Wikidata) → webs candidatas
 * (declaradas, aportadas o deducidas del nombre) → enlaces publicados en esas webs.
 * Un dominio deducido solo se conserva si la página contiene el nombre y la calle o el municipio.
 */
export async function investigarNegocio(
  n: NegocioPiloto, municipio: string, lugares: LugarOSM[], marcas: Map<string, MarcaWikidata>,
  servicios: Pick<ServiciosRadar, 'paginas'>, webManual?: string, fuentesFallidas: string[] = [],
  yaAnalizadas: string[] = [],
): Promise<ResultadoAuto> {
  const coincidencias = emparejarOSM(n, lugares);
  // Cadena o franquicia: por el Excel/la revisión de franquicias o por la marca en OpenStreetMap.
  const cadena = !!n.cadena || coincidencias.some((c) => c.lugar.marca || c.lugar.marcaWd);
  const ev: EvidenciaRadar[] = coincidencias.flatMap(evidenciasOSM);
  for (const c of coincidencias) {
    const m = c.lugar.marcaWd && marcas.get(c.lugar.marcaWd);
    if (m) ev.push(...evidenciasMarca(m));
  }
  const fuenteDe = new Map<string, { fuente: FuenteRadar; origen?: string }>();
  for (const e of ev) if (e.campo === 'web' && e.procedencias[0].fuente === 'osm') {
    fuenteDe.set(e.url, { fuente: 'osm', origen: e.procedencias[0].origen });
  }
  const manual = webSegura(webManual);
  if (manual && !fuenteDe.has(manual)) fuenteDe.set(manual, { fuente: 'manual' });
  // Solo se deducen dominios si ninguna fuente declara una web: ahorra peticiones y falsos positivos.
  if (!fuenteDe.size) for (const d of dominiosProbables(n.nombre)) fuenteDe.set(d, { fuente: 'dominio' });
  const urls = [...fuenteDe.keys()].slice(0, 4).filter((u) => !yaAnalizadas.includes(u));
  const avisos: string[] = [];
  const incompleto = [...fuentesFallidas];
  if (urls.length) {
    let r: Awaited<ReturnType<ServiciosRadar['paginas']>>;
    try { r = await servicios.paginas(urls, { nombre: n.nombre, calle: n.direccion, municipio }); }
    catch (e) {
      // Si falla el análisis de webs, se conserva lo obtenido de las demás fuentes.
      r = { paginas: [], fallos: urls.map((url) => ({ url, error: e instanceof Error ? e.message : 'sin respuesta' })) };
    }
    // Un dominio deducido que no existe es lo esperable: no es un aviso para la persona.
    for (const f of r.fallos) if (fuenteDe.get(f.url)?.fuente !== 'dominio') {
      avisos.push(`${f.url}: ${f.error}`.slice(0, 200));
      if (!incompleto.includes('Web declarada')) incompleto.push('Web declarada');
    }
    for (const p of r.paginas) {
      const pedida = p.solicitada ?? p.url;
      const f = fuenteDe.get(pedida) ?? [...fuenteDe.entries()].find(([u]) => sinBarra(u) === sinBarra(pedida))?.[1]
        ?? { fuente: 'web' as const };
      // Un dominio deducido solo vale si la página es de ESTE local: nombre + (calle o municipio).
      // Medido en Medina: con solo el nombre eran homónimos de otras localidades (ruido para revisar).
      if (f.fuente === 'dominio' && !(p.menciones.includes('nombre')
        && (p.menciones.includes('calle') || p.menciones.includes('municipio')))) continue;
      const delaPagina = evidenciasPagina(p, f.fuente, f.origen);
      // En una cadena, una página que no menciona la calle del local (portada, localizador) y sus
      // redes son corporativas: se marcan como «marca» y nunca se proponen como del establecimiento.
      if (cadena && !p.menciones.includes('calle')) for (const e of delaPagina) e.criterios = [...e.criterios, 'marca'];
      ev.push(...delaPagina);
    }
  }
  // En una cadena, los perfiles sociales declarados en OpenStreetMap suelen ser los de la marca.
  if (cadena) for (const e of ev) {
    if (['instagram', 'facebook', 'twitter'].includes(e.campo) && !e.criterios.includes('marca')) e.criterios = [...e.criterios, 'marca'];
  }
  return {
    huella: huellaNegocio(n), fecha: new Date().toISOString(), evidencias: unirEvidencias(ev), avisos,
    ...(incompleto.length ? { incompleto } : {}),
    analizadas: [...new Set([...yaAnalizadas, ...urls])].slice(0, 12),
  };
}

export const esFalloOSM = (x: string) => x.startsWith('OpenStreetMap');
/**
 * Reintento AISLADO de OpenStreetMap: conserva las evidencias ya obtenidas (webs, Wikidata) y
 * solo analiza una web nueva si OSM la declara. Las decisiones humanas no se tocan (van aparte).
 */
export async function completarConOSM(
  r: ResultadoAuto, n: NegocioPiloto, municipio: string, lugares: LugarOSM[], marcas: Map<string, MarcaWikidata>,
  servicios: Pick<ServiciosRadar, 'paginas'>,
): Promise<ResultadoAuto> {
  const nuevo = await investigarNegocio(n, municipio, lugares, marcas, servicios, undefined,
    (r.incompleto ?? []).filter((x) => !esFalloOSM(x) && x !== 'Web declarada'), r.analizadas ?? []);
  return {
    ...nuevo,
    evidencias: unirEvidencias([...r.evidencias, ...nuevo.evidencias]),
    avisos: [...new Set([...r.avisos, ...nuevo.avisos])].slice(0, 8),
  };
}
/** «Continuar sin OSM»: se deja constancia de que no se consultó y deja de contar como incompleta. */
export function continuarSinOSM(r: ResultadoAuto): ResultadoAuto {
  const incompleto = (r.incompleto ?? []).filter((x) => !esFalloOSM(x));
  const { incompleto: _, ...resto } = r;
  return { ...resto, ...(incompleto.length ? { incompleto } : {}),
    avisos: [...new Set([...r.avisos, 'OpenStreetMap no consultado: se continuó con búsqueda manual.'])] };
}

/** Causa legible de un fallo de fuente, solo con lo que el servidor sabe (nunca se inventa). */
export function causaFallo(e: unknown): string {
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? e.message : '';
  const prov = msg.match(/\((\d{3})\)/)?.[1];
  if (status === 503 && /desactivad/i.test(msg)) return 'desactivado en este despliegue';
  if (prov === '429' || status === 429) return 'límite de uso del proveedor (429)';
  if (/tiempo|timeout|abort/i.test(msg)) return 'tiempo de espera agotado';
  if (prov && prov.startsWith('5')) return `servidor no disponible (${prov})`;
  if (status === 401 || status === 403) return 'sin autorización';
  if (status === 500) return 'fallo interno del servidor del Radar (500), no de OpenStreetMap';
  if (status && status >= 500) return `servicio no disponible (${status})`;
  return 'causa no identificada';
}
const sinBarra = (u: string) => u.replace(/\/+$/, '').replace(/^https:\/\/www\./, 'https://');

// ───────────────────────── Decisiones humanas ─────────────────────────

export interface DecisionRadar { valor: 'si' | 'no'; url?: string; fecha: string; manual?: boolean }
export interface TrabajoRadar {
  decisiones: Partial<Record<CampoRadar, DecisionRadar>>;
  /** Claves «campo|url» de coincidencias que NO corresponden al establecimiento. */
  descartadas: string[];
  /** Webs o perfiles aportados que aún no se han confirmado (p. ej. del piloto anterior). */
  manuales: Partial<Record<CampoRadar, string>>;
  estado: 'pendiente' | 'revisado';
  actualizado: string;
}
export type TrabajosRadar = Record<string, TrabajoRadar>;
export const trabajoVacio = (): TrabajoRadar => ({ decisiones: {}, descartadas: [], manuales: {}, estado: 'pendiente', actualizado: '' });

export type EstadoCampo = 'confirmado' | 'relacionado' | 'encontrado' | 'descartado' | 'pendiente';
export const TEXTO_ESTADO: Record<EstadoCampo, string> = {
  confirmado: 'Confirmado',
  relacionado: 'Probablemente relacionado',
  encontrado: 'Encontrado · comprobar',
  descartado: 'Descartado',
  pendiente: 'Pendiente de comprobación',
};
export interface VistaCampo {
  campo: CampoRadar;
  estado: EstadoCampo;
  decision?: DecisionRadar;
  propuesta?: EvidenciaRadar;
  alternativas: EvidenciaRadar[];
}
// Lo que la persona pega va primero (es lo que quiere comprobar); después, lo relacionado.
const peso = (e: EvidenciaRadar) => (e.procedencias.some((p) => p.fuente === 'manual') ? 2 : 0)
  + (nivelEvidencia(e) === 'relacionado' ? 1 : 0);
export function vistaCampo(campo: CampoRadar, evidencias: EvidenciaRadar[], t: TrabajoRadar): VistaCampo {
  const propias = evidencias.filter((e) => e.campo === campo);
  const manual = t.manuales[campo];
  if (manual && !propias.some((e) => e.url === manual)) {
    propias.push({ campo, url: manual, procedencias: [{ fuente: 'manual', origen: manual }], criterios: [] });
  }
  const vivas = propias.filter((e) => !t.descartadas.includes(claveEvidencia(e)))
    .sort((a, b) => peso(b) - peso(a) || b.criterios.length - a.criterios.length);
  const decision = t.decisiones[campo];
  const [propuesta, ...alternativas] = vivas;
  const estado: EstadoCampo = decision ? 'confirmado'
    : propuesta ? nivelEvidencia(propuesta)
    : propias.length ? 'descartado' : 'pendiente';
  return { campo, estado, decision, propuesta, alternativas };
}

export type BandejaRadar = 'sin-investigar' | 'incompleta' | 'listo' | 'intervencion' | 'sin-evidencias' | 'revisado';
export const TEXTO_BANDEJA: Record<BandejaRadar, string> = {
  'sin-investigar': 'Sin investigar',
  incompleta: 'Investigación incompleta',
  listo: 'Listos para confirmar',
  intervencion: 'Requieren intervención',
  'sin-evidencias': 'Sin evidencias automáticas',
  revisado: 'Revisados',
};
/**
 * Discrepancia con el Excel: dice No y aparece algo relacionado (o confirmado), o dice Sí y se
 * decide No. «Sí en el Excel sin evidencia» no es discrepancia: falta comprobarlo, nada más.
 */
export function discrepaExcel(v: VistaCampo, excel: string): boolean {
  const x = excel.trim();
  if (v.estado === 'confirmado') return (x === '1' && v.decision?.valor === 'no') || (x === '0' && v.decision?.valor === 'si');
  return x === '0' && v.estado === 'relacionado';
}
export function bandejaDe(n: NegocioPiloto, r: ResultadoAuto | undefined, t: TrabajoRadar): BandejaRadar {
  if (t.estado === 'revisado') return 'revisado';
  if (!r) return 'sin-investigar';
  const vistas = CAMPOS_RADAR.map((c) => vistaCampo(c.clave, r.evidencias, t));
  if (vistas.some((v) => v.estado === 'encontrado' || discrepaExcel(v, n.datosExcel[v.campo]))) return 'intervencion';
  if (vistas.some((v) => v.estado === 'relacionado')) return 'listo';
  return r.incompleto?.length ? 'incompleta' : 'sin-evidencias';
}

/**
 * Medición real del piloto, campo a campo: cuántos reciben propuesta automática y, tras la
 * revisión humana, cuántas eran correctas (aceptadas tal cual) o incorrectas (descartadas o
 * sustituidas por otra decisión). Las propuestas sin revisar no cuentan como acierto ni error.
 */
export function medirPiloto(items: { r?: ResultadoAuto; t: TrabajoRadar }[]) {
  const m = { campos: 0, conPropuesta: 0, relacionadas: 0, correctas: 0, incorrectas: 0, sinRevisar: 0, negociosIncompletos: 0 };
  for (const { r, t } of items) {
    if (r?.incompleto?.length) m.negociosIncompletos++;
    for (const { clave } of CAMPOS_RADAR) {
      m.campos++;
      const auto = (r?.evidencias ?? []).filter((e) => e.campo === clave);
      if (!auto.length) continue;
      m.conPropuesta++;
      if (auto.some((e) => nivelEvidencia(e) === 'relacionado')) m.relacionadas++;
      const d = t.decisiones[clave];
      if (d?.valor === 'si' && auto.some((e) => e.url === d.url)) m.correctas++;
      else if (d || auto.every((e) => t.descartadas.includes(claveEvidencia(e)))) m.incorrectas++;
      else m.sinRevisar++;
    }
  }
  return m;
}

/** Confirmación agrupada: SOLO las propuestas «probablemente relacionadas» aún sin decidir. */
export function confirmarRelacionadas(r: ResultadoAuto | undefined, t: TrabajoRadar, fecha: string): TrabajoRadar['decisiones'] {
  const decisiones = { ...t.decisiones };
  if (!r) return decisiones;
  for (const { clave } of CAMPOS_RADAR) {
    const v = vistaCampo(clave, r.evidencias, t);
    if (!v.decision && v.estado === 'relacionado' && v.propuesta) {
      decisiones[clave] = { valor: 'si', url: v.propuesta.url, fecha };
    }
  }
  return decisiones;
}

/** Un enlace pegado se asigna al campo que le corresponde por su dominio. */
export function campoDeEnlace(texto: string): { campo: CampoRadar; url: string } | null {
  const v = texto.trim();
  if (!/^https?:\/\//i.test(v) || v.length > 2000 || /\s/.test(v)) return null;
  for (const red of REDES_RADAR) {
    const url = perfilDesdeValor(red, v);
    if (url) return { campo: red, url };
  }
  const web = webSegura(v);
  if (!web) return null;
  const u = new URL(web);
  const host = u.hostname.replace(/^www\./, '');
  if (/^(?:maps\.app\.goo\.gl|g\.page|goo\.gl)$/.test(host) || (/^google\.[a-z.]+$/.test(host) && u.pathname.startsWith('/maps'))
    || /^maps\.google\.[a-z.]+$/.test(host)) return { campo: 'googleBusiness', url: web };
  if (/(^|\.)(instagram|facebook|fb|x|twitter|google)\.[a-z.]+$/.test(host)) return null;
  return { campo: 'web', url: web };
}

// ───────────────────────── Persistencia local (borrador) ─────────────────────────

const CLAVE_TRABAJO = 'ulit-censo-radar-trabajo-v2';
const CLAVE_AUTO = 'ulit-censo-radar-auto-v1';
const ahoraISO = () => new Date().toISOString();
const esCampo = (c: unknown): c is CampoRadar => CAMPOS_RADAR.some((x) => x.clave === c);
const fechaValida = (f: unknown) => typeof f === 'string' && f.length <= 40 && !Number.isNaN(Date.parse(f));

/** Valor seguro para un campo: perfiles canónicos en redes, HTTPS público en el resto. */
export function urlCampo(campo: CampoRadar, url: unknown): string | null {
  if (typeof url !== 'string') return null;
  return campo === 'instagram' || campo === 'facebook' || campo === 'twitter'
    ? perfilDesdeValor(campo, url) : webSegura(url);
}

function trabajoValido(dato: unknown): TrabajoRadar | null {
  if (!dato || typeof dato !== 'object' || Array.isArray(dato)) return null;
  const d = dato as Partial<TrabajoRadar>;
  const t = trabajoVacio();
  for (const [campo, dec] of Object.entries(d.decisiones ?? {})) {
    if (!esCampo(campo) || !dec || typeof dec !== 'object') continue;
    const x = dec as DecisionRadar;
    if (x.valor !== 'si' && x.valor !== 'no') continue;
    const url = x.url === undefined ? undefined : urlCampo(campo, x.url);
    if (x.url !== undefined && !url) continue;
    t.decisiones[campo] = { valor: x.valor, ...(url ? { url } : {}), fecha: fechaValida(x.fecha) ? x.fecha : '', ...(x.manual ? { manual: true } : {}) };
  }
  if (Array.isArray(d.descartadas)) {
    t.descartadas = d.descartadas.filter((k): k is string => typeof k === 'string' && k.length < 600
      && esCampo(k.split('|')[0])).slice(0, 200);
  }
  for (const [campo, url] of Object.entries(d.manuales ?? {})) {
    const limpia = esCampo(campo) ? urlCampo(campo, url) : null;
    if (limpia && esCampo(campo)) t.manuales[campo] = limpia;
  }
  t.estado = d.estado === 'revisado' ? 'revisado' : 'pendiente';
  t.actualizado = fechaValida(d.actualizado) ? d.actualizado! : '';
  return t;
}
export function trabajosDesdeTexto(raw: string | null): TrabajosRadar {
  if (!raw || raw.length > 1_000_000) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const res: TrabajosRadar = {};
    for (const [id, dato] of Object.entries(parsed).slice(0, 2000)) {
      const t = trabajoValido(dato);
      if (t && id.length < 200) res[id] = t;
    }
    return res;
  } catch { return {}; }
}

/** Convierte el borrador del piloto anterior: lo validado pasa a decisión; lo aportado, a pendiente. */
export function migrarBorradoresV1(campanaId: string): TrabajosRadar {
  const res: TrabajosRadar = {};
  for (const [id, b] of Object.entries(leerBorradoresRadar(campanaId))) {
    const t = trabajoVacio();
    const fecha = b.actualizado || ahoraISO();
    const web = webSegura(b.hallazgo?.urlFinal ?? b.sitioWeb);
    if (b.webValidada && web) t.decisiones.web = { valor: 'si', url: web, fecha };
    else if (web) t.manuales.web = web;
    for (const red of REDES_RADAR) {
      const url = perfilDesdeValor(red, b.perfilesManuales?.[red] || b.hallazgo?.redes[red]);
      if (!url) continue;
      if (b.redesValidadas[red]) t.decisiones[red] = { valor: 'si', url, fecha };
      else t.manuales[red] = url;
    }
    if (b.ventaOnline !== 'pendiente') {
      t.decisiones.ventaOnline = { valor: b.ventaOnline, ...(b.ventaOnline === 'si' && web ? { url: web } : {}), fecha };
    }
    t.estado = b.estado;
    t.actualizado = b.actualizado;
    res[id] = t;
  }
  return res;
}

export function leerTrabajos(campanaId: string): TrabajosRadar {
  try {
    const raw = localStorage.getItem(`${CLAVE_TRABAJO}:${campanaId}`);
    return raw ? trabajosDesdeTexto(raw) : migrarBorradoresV1(campanaId);
  } catch { return {}; }
}
export function guardarTrabajos(campanaId: string, t: TrabajosRadar): boolean {
  try { localStorage.setItem(`${CLAVE_TRABAJO}:${campanaId}`, JSON.stringify(t)); return true; } catch { return false; }
}
/** Importación desde otro navegador: por cada negocio prevalece el trabajo más reciente. */
export function fusionarTrabajos(actuales: TrabajosRadar, importados: TrabajosRadar): TrabajosRadar {
  const res = { ...actuales };
  for (const [id, t] of Object.entries(importados)) {
    if (!res[id] || (Date.parse(t.actualizado) || 0) > (Date.parse(res[id].actualizado) || 0)) res[id] = t;
  }
  return res;
}

function evidenciaValida(dato: unknown): EvidenciaRadar | null {
  const e = dato as Partial<EvidenciaRadar> | null;
  if (!e || !esCampo(e.campo)) return null;
  const url = urlCampo(e.campo, e.url);
  if (!url || !Array.isArray(e.procedencias) || !Array.isArray(e.criterios)) return null;
  const procedencias = e.procedencias.filter((p): p is ProcedenciaRadar => !!p && FUENTES.includes(p.fuente)
    && !!webSegura(p.origen)).slice(0, 6).map((p) => ({ fuente: p.fuente, origen: webSegura(p.origen)! }));
  if (!procedencias.length) return null;
  return {
    campo: e.campo, url, procedencias,
    criterios: CRITERIOS.filter((c) => e.criterios!.includes(c)),
    ...(typeof e.detalle === 'string' ? { detalle: e.detalle.slice(0, 200) } : {}),
  };
}
/** Revalida un resultado (recibido del servidor o leído del navegador) antes de usarlo. */
export function sanearResultado(r: Partial<ResultadoAuto> | null | undefined): ResultadoAuto | null {
  if (!r || typeof r.huella !== 'string' || !fechaValida(r.fecha) || !Array.isArray(r.evidencias)) return null;
  return {
    huella: r.huella.slice(0, 600), fecha: r.fecha!,
    evidencias: r.evidencias.map(evidenciaValida).filter((e): e is EvidenciaRadar => !!e).slice(0, 60),
    avisos: Array.isArray(r.avisos) ? r.avisos.filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 200)).slice(0, 8) : [],
    ...(Array.isArray(r.analizadas) ? { analizadas: r.analizadas.flatMap((u) => { const w = webSegura(u as string); return w ? [w] : []; }).slice(0, 12) } : {}),
    ...(Array.isArray(r.incompleto) && r.incompleto.length
      ? { incompleto: r.incompleto.filter((a): a is string => typeof a === 'string').map((a) => a.slice(0, 120)).slice(0, 5) } : {}),
  };
}
export function leerResultadosAuto(campanaId: string): ResultadosAuto {
  try {
    const raw = localStorage.getItem(`${CLAVE_AUTO}:${campanaId}`);
    if (!raw || raw.length > 3_000_000) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<ResultadoAuto>>;
    const res: ResultadosAuto = {};
    for (const [id, r] of Object.entries(parsed ?? {})) {
      const limpio = sanearResultado(r);
      if (limpio) res[id] = limpio;
    }
    return res;
  } catch { return {}; }
}
export function guardarResultadosAuto(campanaId: string, r: ResultadosAuto): boolean {
  try { localStorage.setItem(`${CLAVE_AUTO}:${campanaId}`, JSON.stringify(r)); return true; } catch { return false; }
}

// ───────────────────────── Exportación ─────────────────────────

const celda = (v: string) => {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV para revisar o integrar después: valor del Excel, propuesta confirmada y evidencia. */
export function csvRadar(negocios: NegocioPiloto[], trabajos: TrabajosRadar): string {
  const cab = ['Fila', 'Nombre', 'Dirección', 'Investigación',
    ...CAMPOS_RADAR.flatMap((c) => [`${c.etiqueta} · Excel`, `${c.etiqueta} · Radar`, `${c.etiqueta} · Evidencia`])];
  const sn = (v: string) => v.trim() === '1' ? 'Sí' : v.trim() === '0' ? 'No' : '';
  const filas = negocios.map((n) => {
    const t = trabajos[n.id] ?? trabajoVacio();
    return [String(n.fila), n.nombre, `${n.direccion}, ${n.numero}`, t.estado === 'revisado' ? 'Revisada' : 'Pendiente',
      ...CAMPOS_RADAR.flatMap((c) => {
        const d = t.decisiones[c.clave];
        return [sn(n.datosExcel[c.clave]), d ? (d.valor === 'si' ? 'Sí' : 'No') : 'Sin comprobar', d?.url ?? ''];
      })];
  });
  return '﻿' + [cab, ...filas].map((f) => f.map(celda).join(';')).join('\r\n');
}
