import type { BaseDatos } from './db';
import { auditarRevisionGeneral, datoRevisionGeneral } from './revisionGeneral';

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
      return {
        id: f.id, nombre: f.nombre, direccion: f.direccion, numero: f.numero,
        fila: f.registro.fila, datosExcel,
      };
    });
}

export function interpretarPresenciaExcel(valor: string): 'si' | 'no' | 'sin-dato' {
  return valor.trim() === '1' ? 'si' : valor.trim() === '0' ? 'no' : 'sin-dato';
}

export function enlacesBusquedaRadar(negocio: Pick<NegocioPiloto,'nombre'|'direccion'|'numero'>) {
  const consulta = [negocio.nombre, negocio.direccion, negocio.numero, 'Medina del Campo'].filter(Boolean).join(' ');
  const crear = (base:string, texto:string) => base + encodeURIComponent(texto);
  return {
    web: crear('https://www.google.com/search?q=', consulta + ' sitio web oficial'),
    google: crear('https://www.google.com/maps/search/?api=1&query=', consulta),
    instagram: crear('https://www.google.com/search?q=', consulta + ' site:instagram.com'),
    facebook: crear('https://www.google.com/search?q=', consulta + ' site:facebook.com'),
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
    u.search='';u.hash='';
    return u.toString();
  } catch { return null; }
}
export function enlaceCandidatoRadar(b:BorradorRadar,red:RedRadar): {url:string;origen:'web'|'manual'}|null {
  const manual=b.perfilesManuales?.[red];
  if(manual) {
    const url=normalizarPerfilRadar(red,manual);
    return url ? {url,origen:'manual'}:null;
  }
  if (!b.hallazgo) return null;
  const url=b.hallazgo.redes[red]&&normalizarPerfilRadar(red,b.hallazgo.redes[red]);
  return url ? {url,origen:'web'}:null;
}

/** Una confirmación agrupada es un acto humano explícito, no una clasificación automática. */
export function validarHallazgosRadar(b:BorradorRadar): Partial<BorradorRadar> {
  const redesValidadas={...b.redesValidadas};
  for(const red of REDES_RADAR) if(enlaceCandidatoRadar(b,red)) redesValidadas[red]=true;
  return {
    webValidada:!!b.hallazgo && !!b.sitioWeb.trim(),
    redesValidadas,estado:'pendiente',
  };
}
/** El título de la página es una pista, nunca prueba suficiente por sí sola. */
export function nombreCompatibleRadar(nombre:string,titulo:string|undefined): boolean|null {
  if(!titulo?.trim()) return null;
  const limpiar=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const n=limpiar(nombre);
  const t=limpiar(titulo);
  const tokens=n.split(' ').filter(w=>w.length>=4 && !['calle','tienda','comercio','grupo','centro','local','santa','santo','medina','campo'].includes(w));
  if(!tokens.length) return null;
  return tokens.filter(w=>t.split(' ').includes(w)).length>=Math.min(2,tokens.length);
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

/** Solo lectura del navegador actual, nunca se trata como decisión confirmada por Supabase. */
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

export function guardarBorradoresRadar(campanaId: string, data: BorradoresRadar): boolean {
  try {
    localStorage.setItem(CLAVE_RADAR + ':' + campanaId, JSON.stringify(data));
    return true;
  } catch { return false; }
}

/** El piloto no envía ni guarda automáticamente estas decisiones en el censo oficial. */
export function resumenPilotoRadar(negocios: NegocioPiloto[], data: BorradoresRadar) {
  const finalizados = negocios.filter((n) => data[n.id]?.estado === 'revisado').length;
  const conWeb = negocios.filter((n) => data[n.id]?.webValidada).length;
  return { total: negocios.length, finalizados, conWeb, pendientes: negocios.length-finalizados };
}
