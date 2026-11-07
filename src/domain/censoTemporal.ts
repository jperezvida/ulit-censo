import type { BaseDatos } from './db';
import type { PlanIncorporacion } from './incorporacion';
import type { ResultadoInterpretacion } from './xlsx/interpretacion';
import type { CeldaOriginal, Id } from './types';

/**
 * C1e-B · Censo analizado SIN GUARDAR, preparado para verlo en el mapa. Todo sale de la interpretación
 * y del plan temporales (en memoria): no se incorpora nada ni se consulta la demostración.
 *
 * Localización: el Excel no trae coordenadas de portal y no se inventan. Cada registro se sitúa como
 * mucho en su CALLE (agregado por calle); los que no tienen calle reconocida quedan «sin localización
 * fiable». Los textos (calle, nombre, actividad) se muestran tal como están en el archivo: no se corrigen.
 */
export type Localizacion = 'calle-y-portal' | 'solo-calle' | 'sin-localizacion';
export const LOCALIZACION_TXT: Record<Localizacion, string> = {
  'calle-y-portal': 'Calle reconocida y número de portal (posición del portal desconocida)',
  'solo-calle': 'Calle reconocida, sin número de portal',
  'sin-localizacion': 'Sin localización fiable (calle no reconocida)',
};

export interface RegistroTemporal {
  fila: number;
  calleId?: Id;
  /** Texto de la calle tal como figura en el archivo. */
  calleTexto: string;
  numero: string;
  nombre: string;
  estado: 'ocupado' | 'vacio' | 'desconocido';
  /** Actividad tal como figura en el archivo (sin corregir). */
  actividad: string;
  localizacion: Localizacion;
  incidencias: number;
}

export interface CensoTemporal {
  registros: RegistroTemporal[];
  resumen: { registros: number; ocupados: number; vacios: number; desconocidos: number; actividades: number; conCalle: number; sinLocalizacion: number; soloCalle: number; incidencias: number };
}

const texto = (c?: CeldaOriginal) => (!c || c.t === 'vacio' ? '' : String((c as { v: unknown }).v));

export function censoTemporal(resultado: ResultadoInterpretacion, plan: PlanIncorporacion): CensoTemporal {
  const original = new Map(resultado.original.filas.map((f) => [f.fila, f.celdas]));
  const registros: RegistroTemporal[] = plan.filas.map((p) => {
    const c = original.get(p.fila) ?? {};
    const calleTexto = texto(c.direccion) || texto(c.direccionCompleta);
    const numero = texto(c.numero);
    const tieneNumero = /\d/.test(numero);
    return {
      fila: p.fila, ...(p.calleId ? { calleId: p.calleId } : {}), calleTexto, numero, nombre: texto(c.nombre),
      estado: p.local, actividad: texto(c.actividad) || texto(c.subgrupo) || texto(c.grupoActividad),
      localizacion: !p.calleId ? 'sin-localizacion' : tieneNumero ? 'calle-y-portal' : 'solo-calle', incidencias: p.incidencias,
    };
  });
  const n = (f: (r: RegistroTemporal) => boolean) => registros.filter(f).length;
  return {
    registros,
    resumen: {
      registros: registros.length, ocupados: n((r) => r.estado === 'ocupado'), vacios: n((r) => r.estado === 'vacio'), desconocidos: n((r) => r.estado === 'desconocido'),
      actividades: new Set(registros.map((r) => r.actividad).filter(Boolean)).size,
      conCalle: n((r) => r.localizacion !== 'sin-localizacion'), soloCalle: n((r) => r.localizacion === 'solo-calle'), sinLocalizacion: n((r) => r.localizacion === 'sin-localizacion'),
      incidencias: resultado.incidencias.length,
    },
  };
}

export interface FiltrosCenso { calleId?: Id; estado?: RegistroTemporal['estado']; actividad?: string; localizacion?: Localizacion }
export const filtrar = (rs: RegistroTemporal[], f: FiltrosCenso) =>
  rs.filter((r) => (!f.calleId || r.calleId === f.calleId) && (!f.estado || r.estado === f.estado) && (f.actividad === undefined || r.actividad === f.actividad) && (!f.localizacion || r.localizacion === f.localizacion));

/** Agregado por calle (solo calles reconocidas), con su geometría del callejero para el mapa. */
export function porCalle(db: Pick<BaseDatos, 'calles'>, rs: RegistroTemporal[]) {
  const m = new Map<Id, RegistroTemporal[]>();
  for (const r of rs) if (r.calleId) m.set(r.calleId, [...(m.get(r.calleId) ?? []), r]);
  return [...m].map(([calleId, xs]) => ({
    calleId, nombre: db.calles[calleId]?.nombre ?? calleId, registros: xs.length,
    ocupados: xs.filter((x) => x.estado === 'ocupado').length, vacios: xs.filter((x) => x.estado === 'vacio').length,
    soloCalle: xs.filter((x) => x.localizacion === 'solo-calle').length,
    segmentos: db.calles[calleId]?.segmentos.map((s) => s.coords) ?? [],
  })).sort((a, b) => b.registros - a.registros || a.nombre.localeCompare(b.nombre, 'es'));
}
