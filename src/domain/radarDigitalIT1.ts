import type { BaseDatos } from './db';
import { auditarRevisionGeneral, datoRevisionGeneral } from './revisionGeneral.js';

export const CAMPOS_DIGITALES_EXCEL = [
  { clave: 'web', etiqueta: 'Web' },
  { clave: 'ventaOnline', etiqueta: 'Venta online' },
  { clave: 'googleBusiness', etiqueta: 'Google Business' },
  { clave: 'instagram', etiqueta: 'Instagram' },
  { clave: 'facebook', etiqueta: 'Facebook' },
  { clave: 'twitter', etiqueta: 'X / Twitter' },
] as const;

export type RedRadar = 'instagram' | 'facebook' | 'twitter';
export const REDES_RADAR: RedRadar[] = ['instagram','facebook','twitter'];

export interface NegocioPiloto {
  id: string;
  nombre: string;
  direccion: string;
  numero: string;
  fila: number;
  datosExcel: Record<(typeof CAMPOS_DIGITALES_EXCEL)[number]['clave'], string>;
  /** Franquicia o cadena según la revisión de franquicias (si existe) o el Excel. Solo lectura. */
  cadena?: boolean;
}

/** Solo 10 negocios ocupados de IT1/2026; nunca 2025 ni los vacíos, sin depender del local físico. */
export function negociosPilotoRadar(db: BaseDatos, campanaId: string): NegocioPiloto[] {
  if (db.campanas[campanaId]?.anio !== 2026) return [];
  return auditarRevisionGeneral(db, campanaId).filas
    .filter((f) => f.itinerario === 'IT1' && f.estado === 'ocupado' && !!f.nombre.trim())
    .slice(0,10)
    .map((f) => {
      const datosExcel = Object.fromEntries(CAMPOS_DIGITALES_EXCEL.map((campo) =>
        [campo.clave, datoRevisionGeneral(f.registro, campo.clave, f.correccion?.valores)],
      )) as NegocioPiloto['datosExcel'];
      const revision = db.revisionesFranquiciaRegistros?.[f.id];
      const respuesta = revision?.campanaId === campanaId ? revision.respuesta : undefined;
      const cadena = respuesta ? respuesta === 'si'
        : datoRevisionGeneral(f.registro, 'franquicia', f.correccion?.valores).trim() === '1';
      return {
        id: f.id, nombre: f.nombre, direccion: f.direccion, numero: f.numero,
        fila: f.registro.fila, datosExcel, ...(cadena ? { cadena } : {}),
      };
    });
}

/**
 * Búsquedas manuales preparadas. La AMPLIA (nombre + plataforma, sin calle ni `site:`) va primero:
 * un perfil puede omitir la dirección, X conserva URLs antiguas de twitter.com y los directorios
 * enlazan a la cuenta. La ESPECÍFICA restringe a la plataforma y añade el municipio (homónimos).
 */
export function enlacesBusquedaRadar(negocio: Pick<NegocioPiloto,'nombre'|'direccion'|'numero'>) {
  const nombre = negocio.nombre.trim();
  const g = (texto:string) => 'https://www.google.com/search?q=' + encodeURIComponent(texto);
  return {
    web: g(`${nombre} Medina del Campo`),
    google: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(
      [nombre, negocio.direccion, negocio.numero, 'Medina del Campo'].filter(Boolean).join(' ')),
    instagram: g(`${nombre} instagram`),
    facebook: g(`${nombre} facebook`),
    twitter: g(`${nombre} twitter`),
    especifica: {
      web: g(`"${nombre}" Medina del Campo -site:facebook.com -site:instagram.com -site:x.com -site:twitter.com`),
      instagram: g(`"${nombre}" Medina del Campo site:instagram.com`),
      facebook: g(`"${nombre}" Medina del Campo site:facebook.com`),
      twitter: g(`"${nombre}" (site:twitter.com OR site:x.com)`),
    },
  };
}

/** Evidencias recuperadas de una web aportada por el revisor; NO son datos del censo. */
export interface HallazgoRadar {
  urlFinal: string;
  redes: Partial<Record<RedRadar, string>>;
  indiciosVenta: string[];
  /** Título declarado por la página, solo pista para contrastar el establecimiento. */
  titulo?: string;
  /** Momento de la lectura. La evidencia puede cambiar posteriormente. */
  analizadoEn?: string;
}

const HOSTS_PERFIL: Record<RedRadar,string[]> = {
  instagram:['instagram.com'],
  facebook:['facebook.com','fb.com','fb.me'],
  twitter:['x.com','twitter.com'],
};

/** Una URL manual nunca es evidencia de presencia hasta que el revisor la confirme. */
export function normalizarPerfilRadar(red: RedRadar, texto: string): string | null {
  try {
    const u = new URL(texto.trim());
    const host=u.hostname.toLowerCase().replace(/^www\./,'').replace(/^m\./,'');
    if(u.protocol!=='https:' || u.username || u.password || u.port ||
      !HOSTS_PERFIL[red].includes(host)) return null;
    const path=u.pathname.replace(/^\/+|\/+$/g,'');
    if(!path || /^(?:p|reel|reels|stories|explore|accounts|share|sharer|intent|hashtag|search|home|photo|photos|watch|groups|events|login|dialog|plugins|posts|status|i)(\/|$)/i.test(path))
      return null;
    if(u.searchParams.has('u') || u.searchParams.has('url')) return null;
    // Perfiles de Facebook sin nombre de usuario: el identificador está en ?id=.
    const id=red==='facebook' && /^profile\.php$/i.test(path) ? u.searchParams.get('id') : null;
    if(/^profile\.php$/i.test(path) && !(id && /^\d{5,20}$/.test(id))) return null;
    u.search=id?'?id='+id:'';u.hash='';
    return u.toString();
  } catch { return null; }
}
function enlaceCandidatoRadar(b:BorradorRadar,red:RedRadar): {url:string;origen:'web'|'manual'}|null {
  const manual=b.perfilesManuales?.[red];
  if(manual) {
    const url=normalizarPerfilRadar(red,manual);
    return url ? {url,origen:'manual'}:null;
  }
  if (!b.hallazgo) return null;
  const url=b.hallazgo.redes[red]&&normalizarPerfilRadar(red,b.hallazgo.redes[red]);
  return url ? {url,origen:'web'}:null;
}

export interface BorradorRadar {
  sitioWeb: string;
  hallazgo?: HallazgoRadar;
  webValidada: boolean;
  redesValidadas: Partial<Record<RedRadar, boolean>>;
  /** Candidatos encontrados manualmente, incluso cuando el negocio no tiene web. */
  perfilesManuales?: Partial<Record<RedRadar,string>>;
  ventaOnline: 'pendiente' | 'si' | 'no';
  estado: 'pendiente' | 'revisado';
  actualizado: string;
}

export type BorradoresRadar = Record<string, BorradorRadar>;

export const CLAVE_RADAR = 'ulit-censo-radar-it1-piloto-v1';

/** Borrador del piloto anterior (v1): solo se lee para migrarlo al modelo de evidencias. */
export function leerBorradoresRadar(campanaId: string): BorradoresRadar {
  try {
    const raw = localStorage.getItem(CLAVE_RADAR + ':' + campanaId);
    if (!raw || raw.length > 100_000) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const res: BorradoresRadar = {};
    for (const [id, dato] of Object.entries(parsed)) {
      if (!dato || typeof dato !== 'object' || Array.isArray(dato)) continue;
      const d = dato as Partial<BorradorRadar>;
      if (typeof d.sitioWeb !== 'string' || d.sitioWeb.length > 2500) continue;
      res[id] = {
        sitioWeb: d.sitioWeb,
        webValidada: d.webValidada === true,
        redesValidadas: d.redesValidadas && typeof d.redesValidadas === 'object' ? {
          instagram: d.redesValidadas.instagram === true,
          facebook: d.redesValidadas.facebook === true,
          twitter: d.redesValidadas.twitter === true,
        } : {},
        perfilesManuales: Object.fromEntries(REDES_RADAR.filter(red=>
          typeof d.perfilesManuales?.[red]==='string' &&
          (d.perfilesManuales[red]?.length??0)<500)
          .map(red=>[red,d.perfilesManuales![red]])),
        ventaOnline: ['si','no'].includes(d.ventaOnline ?? '') ? d.ventaOnline as 'si'|'no' : 'pendiente',
        estado: d.estado === 'revisado' ? 'revisado' : 'pendiente',
        actualizado: typeof d.actualizado === 'string' ? d.actualizado : '',
        ...(d.hallazgo && typeof d.hallazgo.urlFinal === 'string' && d.hallazgo.urlFinal.length < 2500 ? {
          hallazgo: {
            urlFinal: d.hallazgo.urlFinal,
            ...(typeof d.hallazgo.titulo==='string'?{titulo:d.hallazgo.titulo.slice(0,200)}:{}),
            ...(typeof d.hallazgo.analizadoEn==='string'?{analizadoEn:d.hallazgo.analizadoEn.slice(0,40)}:{}),
            redes: Object.fromEntries(REDES_RADAR.flatMap((red) => {
              const url=d.hallazgo?.redes?.[red];
              const limpia=typeof url==='string'?normalizarPerfilRadar(red,url):null;
              return limpia?[[red,limpia]]:[];
            })),
            indiciosVenta: Array.isArray(d.hallazgo.indiciosVenta)
              ? d.hallazgo.indiciosVenta.filter((v): v is string => typeof v === 'string').slice(0,5)
              : [],
          },
        } : {}),
      };
      // Los estados conservados solo son válidos si todavía hay una URL de evidencia utilizable.
      for(const red of REDES_RADAR) {
        if(!enlaceCandidatoRadar(res[id],red)) res[id].redesValidadas[red]=false;
      }
      try {
        const web=new URL(res[id].sitioWeb);
        if(web.protocol!=='https:' || web.username || web.password) res[id].webValidada=false;
      } catch { res[id].webValidada=false; }
    }
    return res;
  } catch { return {}; }
}
