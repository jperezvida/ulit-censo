import type {
  Calle, Campana, Cobertura, Id, Importacion, Itinerario, LocalFisico, MetricaDigital, Municipio, Negocio,
  Observacion, Ocupacion, PendienteSync, Persona, RegistroOrigen, Revision, SituacionPrevia, VinculoHistorico,
} from './types';

export const VERSION_DATOS = 3;

/** "Base de datos" del prototipo: normalizada, serializable y persistida en el navegador. */
export interface BaseDatos {
  version: number;
  generado: string;
  municipios: Record<Id, Municipio>;
  calles: Record<Id, Calle>;
  campanas: Record<Id, Campana>;
  itinerarios: Record<Id, Itinerario>;
  /** clave: campana|calle|acera */
  coberturas: Record<string, Cobertura>;
  /** Situación previa fijada manualmente. clave: campana|calle */
  situacionesPrevias: Record<string, SituacionPrevia>;
  /** Calles revisadas en planificación (p. ej. "sin locales previos: comprobada"). clave campana|calle */
  callesRevisadasPlan: Record<string, { porId: Id; fecha: string; nota?: string }>;
  locales: Record<Id, LocalFisico>;
  negocios: Record<Id, Negocio>;
  ocupaciones: Record<Id, Ocupacion>;
  observaciones: Record<Id, Observacion>;
  registros: Record<Id, RegistroOrigen>;
  vinculos: Record<Id, VinculoHistorico>;
  importaciones: Record<Id, Importacion>;
  /** clave: campana|local */
  revisiones: Record<string, Revision>;
  /** clave: negocio|campana */
  metricas: Record<string, MetricaDigital>;
  personas: Record<Id, Persona>;
  colaSync: PendienteSync[];
  /** Metadatos de la demostración (fuente del callejero, ids de escenarios…). */
  meta: Record<string, string>;
}

export const kCob = (campanaId: Id, calleId: Id, acera: string) => `${campanaId}|${calleId}|${acera}`;
export const kCC = (campanaId: Id, calleId: Id) => `${campanaId}|${calleId}`;
export const kRev = (campanaId: Id, localId: Id) => `${campanaId}|${localId}`;
export const kMet = (negocioId: Id, campanaId: Id) => `${negocioId}|${campanaId}`;

export function baseVacia(): BaseDatos {
  return {
    version: VERSION_DATOS,
    generado: new Date().toISOString(),
    municipios: {}, calles: {}, campanas: {}, itinerarios: {}, coberturas: {}, situacionesPrevias: {},
    callesRevisadasPlan: {}, locales: {}, negocios: {}, ocupaciones: {}, observaciones: {}, registros: {},
    vinculos: {}, importaciones: {}, revisiones: {}, metricas: {}, personas: {}, colaSync: [], meta: {},
  };
}

let contador = 0;
export function nuevoId(prefijo: string): Id {
  contador = (contador + 1) % 1e6;
  return `${prefijo}-${Date.now().toString(36)}${contador.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}
