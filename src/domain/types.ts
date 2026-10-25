import type { ReglaTerritorial } from './territorio';

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
  /** Centro aproximado para los mapas. Ausente en los municipios dados de alta sin coordenadas (G2): no se inventan. */
  centro?: LngLat;
  /** Fuente del callejero cargado para este municipio. */
  fuenteCallejero: 'osm' | 'simulado' | 'sin-geometria';
  /** G2 · Código INE del municipio (5 cifras), si se conoce. */
  ine?: string;
  /** G2 · Configuración territorial guardada como DATO del municipio (Distrito, Zona, CP, aceras). */
  territorio?: ConfigTerritorialMunicipio;
  /** G2 · Estado del callejero del municipio (G3 gestionará sus fuentes y versiones). */
  callejero?: EstadoCallejero;
  /** G2 · Quién y cuándo dio de alta el municipio en el espacio. */
  alta?: { porId: Id; fecha: string };
  nota?: string;
  /**
   * Tipo de ámbito de estudio (ausente = municipio). Barrios, ejes comerciales, zonas de estudio y
   * mercados municipales son ámbitos distintos y no se mezclan en las comparaciones.
   */
  ambito?: TipoAmbito;
  /** Escenario FICTICIO de demostración al que pertenece (aislado: se puede reiniciar). */
  escenarioDemo?: string;
}

export type TipoAmbito = 'municipio' | 'barrio' | 'eje-comercial' | 'zona-estudio' | 'mercado';

/** G2 · Reglas territoriales de un municipio, guardadas como datos (mismo significado que `ConfigTerritorial`). */
export interface ConfigTerritorialMunicipio {
  version: number;
  distrito: ReglaTerritorial;
  zona: ReglaTerritorial;
  cp: ReglaTerritorial;
  aceras: 'ambas' | 'por-confirmar';
  nota?: string;
}

/**
 * G2 · Estado del callejero de un municipio. Sin callejero, la conciliación territorial queda PENDIENTE:
 * nunca se crea un callejero ficticio para un municipio real. G3 añadirá la gestión de fuentes, versiones
 * y cargas (de ahí `fuente` y `version`, que hoy solo describen la instantánea OSM de Medina del Campo).
 */
export interface EstadoCallejero {
  estado: 'sin-callejero' | 'disponible';
  fuente?: 'osm-instantanea' | 'osm' | 'oficial' | 'manual';
  version?: string;
  detalle?: string;
  actualizado?: string;
  /** G3 · Cargas aplicadas (fuente, fecha, versión, procedencia y resumen), de la más antigua a la más reciente. */
  cargas?: CargaCallejero[];
  /**
   * G3 · Límite administrativo verificado de la última carga OSM: rectángulo envolvente [sur, oeste, norte, este]
   * y, desde el cierre de G3, el PERÍMETRO auténtico (anillos exteriores, varios si el municipio tiene varias
   * partes, e interiores = huecos). Sin perímetro, la pertenencia de una geometría no se puede verificar.
   */
  limite?: { bbox: [number, number, number, number]; fuente: string; ine?: string; nombre?: string; poligono?: { exteriores: LngLat[][]; interiores: LngLat[][] } };
  /**
   * G3 · Referencias de denominación (p. ej. «Plaza Mayor» → «Plaza Mayor de la Hispanidad»). Orientan la
   * conciliación; nunca vinculan solas. `undefined` = el municipio aún no tiene la lista guardada.
   */
  referencias?: ReferenciaDenominacion[];
}

export interface CargaCallejero {
  id: Id;
  tipo: 'osm' | 'oficial';
  /** Origen declarado: «OpenStreetMap (Overpass)», «Ayuntamiento de…», URL… */
  fuente: string;
  archivo: string;
  sha256: string;
  /** Fecha de los datos según la fuente (aaaa-mm-dd o ISO). */
  fechaDatos?: string;
  version?: string;
  licencia?: string;
  porId: Id;
  fecha: string;
  resumen: Record<string, number>;
}

export interface ReferenciaDenominacion {
  denominacion: string;
  oficial: string;
  nota: string;
  fuente: string;
  /** Respaldo documental de la referencia: pendiente (aportada, sin documentación que la acredite) o documentado. */
  respaldo?: 'pendiente' | 'documentado';
  porId?: Id;
  fecha: string;
  retirada?: { porId: Id; fecha: string };
}

/** Segmento cartográfico (p. ej. una "way" de OSM). Una calle suele tener varios. */
export interface Segmento {
  /**
   * Identificador ESTABLE del segmento (p. ej. `w123` para la vía 123 de OSM). Se conserva al actualizar
   * el callejero: los futuros itinerarios sobre mapa seleccionarán calles y tramos por este identificador.
   */
  id: Id;
  coords: LngLat[];
  longitudM: number;
  /** G3 · Forma del segmento: tramo lineal (por defecto), contorno de un área (plaza) o un punto. */
  tipo?: 'linea' | 'area' | 'punto';
  /** G3 · Elemento de la fuente del que procede («osm:way/123», «geojson:4», «manual»). */
  fuente?: string;
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
  /** G3 · Forma con la que figura (deducida de sus segmentos). Sin geometría no significa que no exista. */
  forma?: FormaVia;
  /** G3 · Código de la vía en el callejero oficial, si lo trae. */
  codigoVia?: string;
  /** G3 · Cargas del callejero que la incluyeron (de la más antigua a la más reciente). */
  cargas?: Id[];
  /** G3 · Nombres históricos, denominaciones alternativas y alias (datos, no código). */
  alias?: AliasCalle[];
  /** G3 · Alta manual SUPERVISADA: fuente documental, quién la propone y quién la valida. */
  alta?: AltaCalle;
  /** G3 · Cambios registrados (correcciones, validación, alias…), para auditar. */
  historial?: CambioCalle[];
}

export type FormaVia = 'linea' | 'area' | 'punto' | 'mixta' | 'sin-geometria';

export interface AliasCalle {
  nombre: string;
  tipo: 'historico' | 'alternativo' | 'alias';
  fuente: string;
  porId: Id;
  fecha: string;
  /** Vigencia del nombre, si se conoce (p. ej. un nombre histórico hasta 1980). */
  desde?: string;
  hasta?: string;
  nota?: string;
  /** Retirado (se conserva para la auditoría). */
  retirado?: { porId: Id; fecha: string; motivo?: string };
}

export interface AltaCalle {
  estado: 'propuesta' | 'validada' | 'rechazada';
  fuenteDocumental: string;
  /**
   * Pertenencia de la geometría manual al municipio: comprobada contra el perímetro administrativo, o NO
   * verificada (el municipio no tiene perímetro cargado). Ausente si no hay geometría, o en altas anteriores.
   */
  pertenencia?: 'verificada' | 'no-verificada';
  porId: Id;
  fecha: string;
  validacion?: { porId: Id; fecha: string; nota?: string };
  nota?: string;
}

export interface CambioCalle {
  fecha: string;
  porId: Id;
  accion: 'alta' | 'validacion' | 'rechazo' | 'correccion' | 'alias' | 'alias-retirado' | 'carga';
  detalle: string;
  /** Valores anteriores de lo que se corrigió. */
  antes?: Record<string, unknown>;
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
  /** Catálogo de clasificación de la campaña (ausente = catálogo de demostración). */
  catalogoId?: string;
  itinerariosPrevistos?: number;
  estados: { planificacion: FaseEstado; campo: FaseEstado; revision: FaseEstado; validacion: FaseEstado };
  procedencia: Procedencia;
  /** G2 · Campaña creada a mano (quién y cuándo). Una histórica creada así espera su incorporación. */
  creada?: { porId: Id; fecha: string };
  /** G5 · Resoluciones del estado de locales con observaciones contradictorias en esta campaña. */
  resolucionesEstado?: ResolucionEstado[];
}

export interface Itinerario {
  id: Id;
  campanaId: Id;
  codigo: string;
  nombre: string;
  color: string;
  /** «excel» (G4): itinerario de una campaña operativa cuyos datos llegan en un Excel de campo. */
  origen: 'app' | 'kml' | 'papel' | 'excel';
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
  /**
   * Verificación de `coord` (opcional, sin migración). Solo con ella la posición del local cuenta como
   * verificada en el cuadro de mando; sin ella, una `coord` es aproximada (pendiente de validación). Las
   * ubicaciones simuladas de datos ficticios se calculan al dibujar y nunca se guardan aquí.
   */
  coordVerificada?: { fuente: 'gps-campo' | 'catastro' | 'comprobacion-manual'; fecha: string; porId?: Id };
  estado: 'activo' | 'posible-desaparicion' | 'desaparecido' | 'dividido' | 'fusionado';
  relaciones?: { tipo: 'dividido-en' | 'fusionado-en' | 'procede-de'; localIds: Id[] }[];
  procedencia: Procedencia;
}

/**
 * Negocio / establecimiento. Los perfiles digitales le pertenecen a él, no al local.
 * La clasificación NO vive aquí: se guarda por campaña (ClasificacionCampana) para que
 * corregir 2026 no reescriba 2025.
 */
export interface Negocio {
  id: Id;
  nombre: string;
  cadena?: string;
  descripcion?: string;
  procedencia: Procedencia;
}

/**
 * Qué negocio ocupa un local (o si está vacío) entre dos observaciones.
 * Una campaña puede contener varias ocupaciones sucesivas del mismo local: nunca se
 * borra una intermedia; se cierra con la observación que la sustituye.
 */
export interface Ocupacion {
  id: Id;
  localId: Id;
  negocioId: Id | null; // null = vacío
  metrosFachada?: number;
  desdeCampanaId: Id;
  /** Campaña en la que se vio por última vez antes de cerrarse (puede ser la misma de inicio). */
  hastaCampanaId?: Id;
  /** Observación que la abrió / la cerró (si constan). */
  desdeObservacionId?: Id;
  hastaObservacionId?: Id;
  /** Fecha real del evento que la abrió (si consta). Es la que ordena la cronología. */
  desdeFecha?: string;
  /** Orden global de registro: solo desempata cuando las fechas no deciden. */
  orden: number;
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
  /** Fecha real de la comprobación. Ausente si la fuente no la aporta: nunca se inventa. */
  fecha?: string;
  /** Momento en que se incorporó al sistema (importación, transcripción…). */
  registrado?: string;
  fuente: FuenteObservacion;
  investigadorId?: Id;
  tipo: TipoObservacion;
  /** G4 · Itinerario y registro de origen (incorporación de un Excel de itinerario en una campaña operativa). */
  itinerarioId?: Id;
  registroId?: Id;
  /** Instantánea de lo observado EN ESE MOMENTO (no se recalcula después). */
  datos: { numero: number | null; sufijo?: string; nombre?: string; negocioId?: Id | null; vacio: boolean; metrosFachada?: number };
  /** Orden global de registro (las fechas pueden faltar). NO es la cronología del censo. */
  orden?: number;
  /**
   * «incierta»: no se pudo situar el evento respecto a otros cambios de la misma campaña
   * (falta la fecha o coincide el día). Queda registrado pero no altera las ocupaciones
   * hasta que la oficina le asigne fecha (`ubicarEnCronologia`).
   */
  cronologia?: 'incierta';
  /** Quién y cuándo fijó en oficina la fecha de un evento de cronología incierta. */
  fechaAsignada?: { porId: Id; registrado: string };
  nota?: string;
  verificacion: 'pendiente' | 'verificada' | 'devuelta';
  sync?: 'local' | 'sincronizada' | 'conflicto';
}

/**
 * Celda original tal como se leyó del XLSX (C1b): tipo, valor y formato. Serializable.
 * Ampliación compatible de `RegistroOrigen.datos`, que solo guarda texto.
 */
export type CeldaOriginal = (
  | { t: 'vacio' }
  | { t: 'numero'; v: number; formato?: string }
  | { t: 'fecha'; v: string; formato?: string }
  | { t: 'texto'; v: string }
  | { t: 'booleano'; v: boolean }
  | { t: 'error'; v: string }
) & { formula?: true };

/** Interpretación (C1b) de una celda, guardada junto al original para trazabilidad. */
export type PortalRegistro = { tipo: 'numero'; numero: number; sufijo?: string } | { tipo: 'sin-numero' };

export interface CeldaInterpretadaRegistro {
  estado: 'valido' | 'vacio' | 'no-aplica' | 'invalido' | 'transformado' | 'pendiente';
  valor?: boolean | number | string | PortalRegistro | { tipo: 'direccion'; calle: string; portal: PortalRegistro };
  regla: string;
}

/** Fila original importada. Inmutable; conserva la procedencia. */
export interface RegistroOrigen {
  id: Id;
  importacionId: Id;
  fila: number;
  /** G4 · Itinerario de la campaña operativa al que pertenece la fila (Excel de itinerario). */
  itinerarioId?: Id;
  /**
   * Representación TEXTUAL por cabecera (compatibilidad con importaciones anteriores). No conserva
   * tipos ni formatos: en las importaciones de C1c el original fiel está en `original`.
   */
  datos: Record<string, string>;
  /** C1c: celdas originales con su tipo, valor y formato, por clave de columna del perfil. */
  original?: Record<string, CeldaOriginal>;
  /** G1 · Columnas ADICIONALES del archivo (sin campo de ULIT), por su cabecera exacta: se conservan sin interpretar. */
  adicionales?: Record<string, CeldaOriginal>;
  /**
   * C1c: interpretación de C1b, sin confirmar nada. `celdas` solo contiene las celdas no triviales
   * (vacías, no aplicables, inválidas, transformadas o pendientes); las válidas por lectura directa
   * se deducen del original.
   */
  interpretacion?: {
    celdas: Record<string, CeldaInterpretadaRegistro>;
    local: 'vacio' | 'ocupado' | 'desconocido';
    redesCalculadas: number | null;
    /** Clasificación histórica: los cinco textos se conservan en `original`; aquí, su diagnóstico. */
    clasificacion?: { diagnostico: string; confirmada: false };
    incidencias: string[];
  };
  /** C1c: huella del contenido original de la fila (detecta cambios al reimportar). */
  huellaFila?: string;
  /** C1c: exclusión de la aplicación operativa decidida por una persona (la fila se conserva). */
  exclusion?: { porId: Id; fecha: string; motivo: string };
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
  /** G5 · Conciliación POSTERIOR a la importación: decisiones supervisadas, de la más antigua a la más reciente. */
  conciliaciones?: ConciliacionPosterior[];
}

/**
 * G5 · Decisión de conciliación posterior sobre una fila importada (vínculo registro → local). Guarda lo
 * que había antes y lo que creó, para poder deshacerla sin tocar nada más.
 */
export interface ConciliacionPosterior {
  accion: 'vincular' | 'local-nuevo' | 'mantener-pendiente';
  localId?: Id;
  porId: Id;
  fecha: string;
  /** Justificación (obligatoria para crear un local distinto) o nota. */
  motivo?: string;
  campanaId: Id;
  itinerarioId?: Id;
  antes: { localId: Id | null; confianza: Confianza; revisadoPorId?: Id; observacionLocalId?: Id | null };
  creadas: { locales: Id[]; ocupaciones: Id[] };
  deshecha?: { porId: Id; fecha: string };
}

/**
 * G5 · Resolución supervisada del estado de un local en una campaña cuando sus observaciones no coinciden
 * (vacío según una, ocupado según otra). No borra ni cambia ninguna observación.
 */
export interface ResolucionEstado {
  localId: Id;
  /** «vacio»/«ocupado»: estado actual confirmado por una persona según una observación concreta; «dudoso»: queda así. */
  estado: 'vacio' | 'ocupado' | 'dudoso';
  observacionId?: Id;
  porId: Id;
  fecha: string;
  motivo?: string;
  retirada?: { porId: Id; fecha: string };
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
  /** C1c: trazabilidad completa de una incorporación desde XLSX (ausente en las anteriores). */
  c1?: TrazaIncorporacion;
}

/** Colecciones de la base en las que C1c crea entidades. */
export type ColeccionIncorporada = 'campanas' | 'registros' | 'locales' | 'negocios' | 'observaciones' | 'ocupaciones' | 'vinculos' | 'franquicias' | 'digital' | 'clasificaciones';

export interface TrazaIncorporacion {
  /** 1: huellas FNV-1a de 32 bits (primeras incorporaciones de C1c). 2: huellas SHA-256. */
  version: 1 | 2;
  /** Algoritmo de las huellas de integridad (ausente en la versión 1 = FNV-1a de 32 bits). */
  algoritmoHuellas?: 'sha256';
  /** SHA-256 del archivo (también en `huella`). Los bytes del archivo NO se guardan. */
  sha256: string;
  perfil: { id: string; version: number };
  hoja: string;
  anio: number;
  /** G4 · Itinerario de la campaña operativa en el que se incorporó el archivo. */
  itinerario?: { id: Id; codigo: string };
  /** Columnas del perfil con su cabecera EXACTA en el archivo. */
  columnas: { clave: string; letra: string; cabecera: string; tipo: string }[];
  porId: Id;
  /** Reglas y decisiones con las que se interpretó y aplicó (todas trazadas). */
  decisiones: Record<string, unknown>;
  /** Firma del plan aprobado. */
  firmaPlan: string;
  /** Entidades creadas, por colección, con la huella de su contenido en el momento de crearlas. */
  creadas: Partial<Record<ColeccionIncorporada, Record<Id, string>>>;
  /** Entidades existentes modificadas (C1c no modifica ninguna; se registra por completitud). */
  modificadas: Partial<Record<ColeccionIncorporada, Id[]>>;
  /**
   * G2 · La campaña de destino ya existía (preparada vacía): su contenido ANTES de incorporar y la huella
   * DESPUÉS. Deshacer la restaura tal como estaba (si nadie la ha cambiado entretanto).
   */
  campanaPrevia?: { valor: Campana; huellaDespues: string };
  /**
   * G5 · Al deshacer: quién y cuándo, y una traza MÍNIMA de las conciliaciones posteriores que se hicieron
   * (y se deshicieron) sobre sus filas antes de deshacer la incorporación. Sin motivos ni datos de la fila.
   */
  deshecha?: { porId: Id; fecha: string; conciliaciones?: TrazaConciliacionDeshecha[] };
}

export interface TrazaConciliacionDeshecha {
  fila: number;
  accion: ConciliacionPosterior['accion'];
  porId: Id;
  fecha: string;
  deshecha?: { porId: Id; fecha: string };
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
  /**
   * Revisión de franquicias (B5): eje propio, independiente de categorización y digital.
   * Ausente = pendiente. Solo un Sí o No registrado por una persona la deja «revisado».
   */
  franquicia?: Revisado;
  franquiciaPor?: Id;
  franquiciaEn?: string;
  /** Última vez que una aprobación general volvió a pendiente porque cambió un dato revisado. */
  aprobacionReabierta?: { porId: Id; fecha: string; motivo: string };
  pendienteComprobacion?: boolean;
  /** Motivo de la comprobación pendiente (p. ej. «cronología incierta»). */
  motivoComprobacion?: string;
}

/**
 * Respuesta de una variable de comprobación. «pendiente» NO equivale a «no».
 *  si / no        → comprobado (1 / 0)
 *  pendiente      → todavía no se ha mirado
 *  na             → no aplicable a este establecimiento
 *  sin-info       → se buscó y no hay información disponible
 */
export type Respuesta = 'si' | 'no' | 'pendiente' | 'na' | 'sin-info';

export type VariableDigital =
  | 'web' | 'ventaOnline' | 'googleBusiness' | 'valoracion' | 'numResenas' | 'respondeResenas'
  | 'instagram' | 'seguidoresInstagram' | 'facebook' | 'seguidoresFacebook' | 'twitter' | 'seguidoresTwitter' | 'otrasRedes';

/** Una variable digital de un negocio en una campaña, con su trazabilidad. */
export interface DatoDigital {
  respuesta: Respuesta;
  /** Solo para variables numéricas (valoración, nº de reseñas, seguidores). */
  valor?: number;
  origen: 'manual' | 'heredado' | 'importado' | 'google-maps-manual';
  porId?: Id;
  fecha?: string;
}

/** Revisión de la presencia digital de un NEGOCIO en una campaña. */
export interface RevisionDigital {
  negocioId: Id;
  campanaId: Id;
  datos: Partial<Record<VariableDigital, DatoDigital>>;
  estado: 'borrador' | 'verificada';
  verificadaPor?: Id;
  verificadaEn?: string;
  historial: { accion: 'verificar' | 'reabrir' | 'partir-de-anterior'; porId?: Id; fecha: string; motivo?: string }[];
}

/**
 * Franquicia de un NEGOCIO en una campaña (variable binaria del procedimiento 2026).
 * Distinta del nombre de cadena (`Negocio.cadena`, dato descriptivo): pertenecer a una cadena no
 * implica ser franquicia y no tener cadena no significa «No».
 */
export interface FranquiciaCampana {
  negocioId: Id;
  campanaId: Id;
  /** si / no · sin-info (se buscó y no consta) · pendiente. «No aplicable» no se admite. */
  respuesta: Respuesta;
  /** manual: comprobado en esta campaña · heredado: copiado como borrador · importado: tal como venía. */
  origen: 'manual' | 'heredado' | 'importado';
  porId?: Id;
  fecha?: string;
  /** Campaña de la que se copió (origen «heredado»). */
  desdeCampanaId?: Id;
  historial: { respuesta: Respuesta; origen: FranquiciaCampana['origen']; porId?: Id; fecha: string; desdeCampanaId?: Id }[];
}

/** Clasificación de un negocio en una campaña concreta. */
export interface ClasificacionCampana {
  negocioId: Id;
  campanaId: Id;
  /** Nodo del catálogo elegido: no siempre es el cuarto nivel (véase el procedimiento 2026). */
  actividadId: Id;
  /** Breve descripción cuando la actividad no encaja en una predefinida (o para un subgrupo de Servicios). */
  descripcion?: string;
  /** Catálogo del nodo elegido (ausente = catálogo de demostración). */
  catalogoId?: string;
  /**
   * Traza de una migración de catálogo: de dónde viene la propuesta. Una clasificación migrada
   * NUNCA queda confirmada automáticamente: requiere confirmación humana.
   */
  migracion?: { desdeActividadId: Id; desdeCatalogo: string; fecha: string; criterio: string; estabaConfirmada: boolean };
  /** importado: tal como venía · heredado: copiado de otra campaña como borrador · manual: decidido en oficina */
  origen: 'importado' | 'heredado' | 'manual' | 'migrado';
  /** Solo una clasificación confirmada por una persona cuenta como «categorización revisada». */
  confirmada: boolean;
  porId?: Id;
  fecha?: string;
}

/** Estado de oficina de un itinerario (cada itinerario pertenece a una sola campaña). */
export interface EstadoOficinaItinerario {
  itinerarioId: Id;
  campanaId: Id;
  /**
   * en-revision · revision-cerrada (cierre PROVISIONAL: bloquea la edición y registra quién y
   * cuándo hizo la revisión final, pero NO habilita la exportación municipal) · validado
   * (definitivo: solo tras superar los controles del bloque C) · reabierto.
   */
  estado: 'en-revision' | 'revision-cerrada' | 'validado' | 'reabierto';
  historial: { accion: 'cerrar-revision' | 'validar' | 'reabrir'; porId: Id; fecha: string; motivo?: string }[];
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
  /** Catálogo al que pertenece: 'demo' (ficticio) o 'clasificacion-2026@v1'. */
  catalogo?: string;
  /** Código del documento (C, H, S · A, EH, EP, OE). */
  codigo?: string;
  /** Texto de la columna «Descripción» del documento (orientativo). */
  descripcion?: string;
  /** Palabras clave AUTORIZADAS para buscar (descripción del documento y excepciones ICM). */
  claves?: string[];
  /** Ejemplos del documento que pueden usarse como descripción de la actividad. */
  ejemplos?: string[];
  /** Nota sobre excepciones del ICM asignadas a este nodo. */
  excepcion?: string;
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
