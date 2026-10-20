import type {
  Calle, Campana, ClasificacionCampana, Cobertura, EstadoOficinaItinerario, FranquiciaCampana, Id, Importacion, Itinerario, LocalFisico,
  Municipio, Negocio, Observacion, Ocupacion, PendienteSync, Persona, RegistroOrigen, Revision, RevisionDigital,
  SituacionPrevia, VinculoHistorico,
} from './types';

export const VERSION_DATOS = 11;

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
  /** Revisión digital de un negocio en una campaña. clave: negocio|campana */
  digital: Record<string, RevisionDigital>;
  /** Clasificación de un negocio en una campaña. clave: negocio|campana */
  clasificaciones: Record<string, ClasificacionCampana>;
  /** Franquicia (Sí/No) de un negocio en una campaña. clave: negocio|campana */
  franquicias: Record<string, FranquiciaCampana>;
  /** Estado de oficina por itinerario. clave: itinerarioId */
  oficinaItinerarios: Record<Id, EstadoOficinaItinerario>;
  /** Contador de orden de registro (ocupaciones y observaciones). */
  secuencia: number;
  personas: Record<Id, Persona>;
  colaSync: PendienteSync[];
  /** Metadatos de la demostración (fuente del callejero, ids de escenarios…). */
  meta: Record<string, string>;
}

export const kCob = (campanaId: Id, calleId: Id, acera: string) => `${campanaId}|${calleId}|${acera}`;
export const kCC = (campanaId: Id, calleId: Id) => `${campanaId}|${calleId}`;
export const kRev = (campanaId: Id, localId: Id) => `${campanaId}|${localId}`;
export const kNC = (negocioId: Id, campanaId: Id) => `${negocioId}|${campanaId}`;
/** Alias histórico */
export const kMet = kNC;

export function baseVacia(): BaseDatos {
  return {
    version: VERSION_DATOS,
    generado: new Date().toISOString(),
    municipios: {}, calles: {}, campanas: {}, itinerarios: {}, coberturas: {}, situacionesPrevias: {},
    callesRevisadasPlan: {}, locales: {}, negocios: {}, ocupaciones: {}, observaciones: {}, registros: {},
    vinculos: {}, importaciones: {}, revisiones: {}, digital: {}, clasificaciones: {}, franquicias: {}, oficinaItinerarios: {}, secuencia: 0,
    personas: {}, colaSync: [], meta: {},
  };
}

let contador = 0;
export function nuevoId(prefijo: string): Id {
  contador = (contador + 1) % 1e6;
  return `${prefijo}-${Date.now().toString(36)}${contador.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Siguiente número de orden de registro (muta la copia de trabajo `db`). */
export function siguienteOrden(db: BaseDatos): number {
  db.secuencia = (db.secuencia ?? 0) + 1;
  return db.secuencia;
}

/** Error de regla de negocio: se muestra al usuario y no altera los datos. */
export class ErrorDominio extends Error {
  constructor(public codigo: 'bloqueado' | 'fuera-de-alcance' | 'verificacion-incompleta' | 'regla', mensaje: string, public detalles: string[] = []) {
    super(mensaje);
    this.name = 'ErrorDominio';
  }
}
