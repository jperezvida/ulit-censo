/**
 * Modelo de dominio del prototipo ULIT Censo.
 *
 * Principio rector: calle, itinerario, local físico, negocio, ocupación y observación
 * son entidades distintas. Una fila de Excel importada (RegistroOrigen) nunca es el local:
 * el vínculo entre ambos es una entidad propia con su nivel de confianza.
 */

export type Id = string;
export type LngLat = [number, number];

/** Procedencia de un dato: imprescindible para distinguir lo real de lo simulado. */
export type Procedencia = 'osm' | 'simulado' | 'importado' | 'manual';

// ───────────────────────── Territorio ─────────────────────────

export interface Municipio {
  id: Id;
  nombre: string;
  provincia: string;
  centro: LngLat;
  /** Fuente del callejero cargado para este municipio. */
  fuenteCallejero: 'osm' | 'simulado' | 'sin-geometria';
  nota?: string;
}

/** Segmento cartográfico (p. ej. una "way" de OSM). Una calle suele tener varios. */
export interface Segmento {
  id: Id;
  coords: LngLat[];
  longitudM: number;
}

export interface Calle {
  id: Id;
  municipioId: Id;
  nombre: string;
  tipoVia: string;
  segmentos: Segmento[];
  longitudM: number;
  procedencia: Procedencia;
  /** Identificadores en la fuente (OSM way ids…), para trazabilidad. */
  refsFuente: string[];
}

export type Acera = 'ambas' | 'par' | 'impar';

/**
 * Tramo planificable de una calle. Por defecto cada calle es un único tramo
 * con todos sus segmentos y ambas aceras. Dividir es una operación avanzada.
 */
export interface TramoPlan {
  calleId: Id;
  /** Vacío o ausente = calle completa (todos los segmentos). */
  segmentoIds?: Id[];
  acera: Acera;
  orden: number;
  /** Responsable concreto de esta calle dentro del itinerario (opcional). */
  responsableId?: Id;
  /** Etiqueta libre de planificación ("censar desde cero", "ojo obras"…). */
  etiqueta?: string;
}

// ───────────────────────── Campañas ─────────────────────────

export type TipoCampana = 'nuevo' | 'actualizacion' | 'mixto' | 'historico-importado';
export type FaseEstado = 'pendiente' | 'en-curso' | 'terminado' | 'no-aplica';

export interface Campana {
  id: Id;
  municipioId: Id;
  anio: number;
  nombre: string;
  tipo: TipoCampana;
  encargo?: string;
  periodo: { inicio: string; fin?: string };
  /** Calles que forman el ámbito territorial de esta campaña. */
  ambitoCalleIds: Id[];
  /** Calles añadidas respecto a la campaña de referencia (ampliación territorial). */
  ampliacionCalleIds: Id[];
  campanaReferenciaId?: Id;
  itinerariosPrevistos?: number;
  estados: { planificacion: FaseEstado; campo: FaseEstado; revision: FaseEstado; validacion: FaseEstado };
  procedencia: Procedencia;
}

export interface Itinerario {
  id: Id;
  campanaId: Id;
  codigo: string;
  nombre: string;
  color: string;
  origen: 'app' | 'kml' | 'papel';
  tramos: TramoPlan[];
  asignadosIds: Id[];
  notas?: string;
  /** Marca explícita para escenarios inventados del prototipo. */
  escenarioDemo?: string;
  creado: string;
}

// ───────────────────────── Cobertura ─────────────────────────

export type EstadoCobertura =
  | 'pendiente'
  | 'en-curso'
  | 'completada-con-locales'
  | 'completada-sin-locales'
  | 'parcial-incidencias';

/** Cobertura de una calle (y acera) en una campaña. No se deduce del nº de locales. */
export interface Cobertura {
  campanaId: Id;
  calleId: Id;
  acera: Acera;
  estado: EstadoCobertura;
  porId?: Id;
  fecha?: string;
  aceraParRecorrida?: boolean;
  aceraImparRecorrida?: boolean;
  nota?: string;
}

/** Situación histórica de una calle sin registros previos: NO son equivalentes. */
export type SituacionPrevia =
  | 'con-registros'
  | 'no-censada'
  | 'censada-sin-locales'
  | 'sin-informacion'
  | 'pendiente-relacionar';

// ───────────────────────── Locales y negocios ─────────────────────────

export interface Direccion {
  calleId: Id;
  numero: number | null;
  sufijo?: string; // "B", "dup.", "esq."…
  desdeCampanaId?: Id; // cuándo empezó a valer esta numeración
}

/** Espacio comercial concreto. Identidad propia, independiente de filas e itinerarios. */
export interface LocalFisico {
  id: Id;
  municipioId: Id;
  direcciones: Direccion[]; // la última es la vigente; conserva cambios de numeración
  coord?: LngLat;
  estado: 'activo' | 'posible-desaparicion' | 'desaparecido' | 'dividido' | 'fusionado';
  relaciones?: { tipo: 'dividido-en' | 'fusionado-en' | 'procede-de'; localIds: Id[] }[];
  procedencia: Procedencia;
}

/** Negocio / establecimiento. Los perfiles digitales le pertenecen a él, no al local. */
export interface Negocio {
  id: Id;
  nombre: string;
  actividadId?: Id;
  cadena?: string;
  descripcion?: string;
  procedencia: Procedencia;
}

/** Qué negocio ocupa un local en un periodo (o si está vacío). */
export interface Ocupacion {
  id: Id;
  localId: Id;
  negocioId: Id | null; // null = vacío
  metrosFachada?: number;
  desdeCampanaId: Id;
  hastaCampanaId?: Id;
}

export type FuenteObservacion = 'campo-app' | 'papel' | 'importacion' | 'oficina';
export type TipoObservacion =
  | 'confirmado'
  | 'modificado'
  | 'vacio'
  | 'nuevo-negocio'
  | 'nuevo-local'
  | 'posible-desaparicion'
  | 'dudoso'
  | 'incidencia';

/** Lo comprobado en una visita o revisión. */
export interface Observacion {
  id: Id;
  campanaId: Id;
  localId: Id | null; // null = todavía sin vincular a un local físico
  calleId: Id;
  fecha: string;
  fuente: FuenteObservacion;
  investigadorId?: Id;
  tipo: TipoObservacion;
  datos: { numero: number | null; sufijo?: string; nombre?: string; vacio: boolean; metrosFachada?: number };
  nota?: string;
  verificacion: 'pendiente' | 'verificada' | 'devuelta';
  sync?: 'local' | 'sincronizada' | 'conflicto';
}

/** Fila original importada. Inmutable; conserva la procedencia. */
export interface RegistroOrigen {
  id: Id;
  importacionId: Id;
  fila: number;
  datos: Record<string, string>;
}

export type Confianza = 'confirmada' | 'probable' | 'dudosa' | 'sin-vinculo';

/** Correspondencia entre un registro/observación y un local físico. */
export interface VinculoHistorico {
  id: Id;
  origen: { tipo: 'registro'; id: Id } | { tipo: 'observacion'; id: Id };
  localId: Id | null;
  confianza: Confianza;
  criterio: string;
  revisadoPorId?: Id;
  /** Candidatos alternativos propuestos por el sistema (no aplicados). */
  candidatos?: { localId: Id; puntuacion: number; motivo: string }[];
}

export interface Importacion {
  id: Id;
  municipioId: Id;
  campanaId?: Id;
  tipo: 'A-censo-historico' | 'B-itinerarios-kml' | 'C-excel-itinerario' | 'D-actualizacion' | 'E-conciliacion';
  archivo: string;
  huella: string;
  fecha: string;
  filas: number;
  estado: 'preparacion' | 'confirmada' | 'descartada';
  resumen: Record<string, number>;
  procedencia: Procedencia;
  nota?: string;
}

// ───────────────────────── Revisión de oficina ─────────────────────────

export type Revisado = 'pendiente' | 'revisado';

/** Estado de revisión de un local dentro de una campaña. Cuatro ejes independientes. */
export interface Revision {
  campanaId: Id;
  localId: Id;
  campo: 'pendiente' | 'terminado';
  categorizacion: Revisado;
  digital: Revisado;
  validacion: 'pendiente' | 'aprobada' | 'devuelta';
  motivoDevolucion?: string;
  pendienteComprobacion?: boolean;
}

/** Medición digital de un NEGOCIO en una campaña concreta. */
export interface MetricaDigital {
  negocioId: Id;
  campanaId: Id;
  fechaComprobacion?: string;
  verificada: boolean;
  web?: string;
  ventaOnline?: boolean;
  googleBusiness?: boolean;
  valoracion?: number;
  numResenas?: number;
  respondeResenas?: boolean;
  instagram?: string;
  seguidoresInstagram?: number;
  facebook?: string;
  otrasRedes?: string;
}

// ───────────────────────── Personas y actividad ─────────────────────────

export type Rol = 'administrador' | 'coordinador' | 'investigador' | 'revisor';

export interface Persona {
  id: Id;
  nombre: string;
  iniciales: string;
  roles: Rol[];
  color: string;
}

/** Clasificación comercial de cuatro niveles (estructura del censo real). */
export interface NodoActividad {
  id: Id;
  nivel: 1 | 2 | 3 | 4; // 1 grupo de actividad · 2 grupo de comercio · 3 subgrupo · 4 actividad
  nombre: string;
  padreId?: Id;
}

// ───────────────────────── Sincronización (SIMULADA) ─────────────────────────

export interface PendienteSync {
  id: Id;
  descripcion: string;
  observacionId?: Id;
  creado: string;
  estado: 'en-cola' | 'conflicto' | 'error';
  conflicto?: { con: string; detalle: string };
}
