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
}

export interface BorradorRadar {
  sitioWeb: string;
  hallazgo?: HallazgoRadar;
  webValidada: boolean;
  redesValidadas: Partial<Record<RedRadar, boolean>>;
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
        ventaOnline: ['si','no'].includes(d.ventaOnline ?? '') ? d.ventaOnline as 'si'|'no' : 'pendiente',
        estado: d.estado === 'revisado' ? 'revisado' : 'pendiente',
        actualizado: typeof d.actualizado === 'string' ? d.actualizado : '',
        ...(d.hallazgo && typeof d.hallazgo.urlFinal === 'string' && d.hallazgo.urlFinal.length < 2500 ? {
          hallazgo: {
            urlFinal: d.hallazgo.urlFinal,
            redes: Object.fromEntries(REDES_RADAR.filter((red) =>
              typeof d.hallazgo?.redes?.[red] === 'string' &&
              (d.hallazgo.redes[red]?.length ?? 0) < 2500)
              .map((red) => [red, d.hallazgo!.redes[red]])),
            indiciosVenta: Array.isArray(d.hallazgo.indiciosVenta)
              ? d.hallazgo.indiciosVenta.filter((v): v is string => typeof v === 'string').slice(0,5)
              : [],
          },
        } : {}),
      };
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
