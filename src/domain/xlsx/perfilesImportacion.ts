/**
 * Perfiles de ESTRUCTURA de los Excel de la Cátedra (C1a). Describen qué columnas tiene cada
 * formato, con su cabecera ORIGINAL exacta (incluidos espacios y erratas históricas), el tipo
 * esperado y el uso previsto. Son versionados: un formato nuevo o un alias nuevo exige una
 * nueva versión, nunca una coincidencia aproximada.
 *
 * Proceden de los perfiles estructurales sin registros (Medina 2025, Medina 2026) y de la
 * descripción del itinerario 10 de Valladolid 2024. No son el contrato de exportación (C3).
 */

export type TipoEsperado =
  | 'fecha' // número de serie de Excel con formato de fecha
  | 'texto'
  | 'entero'
  | 'decimal'
  | 'binario-01' // 0 / 1
  | 'portal' // número de portal: entero o texto con sufijo («6 B», «S/N»)
  | 'codigo' // código territorial (Distrito, Zona)
  | 'codigo-postal'
  | 'lista'; // valor de una lista histórica (Hoja1)

export interface ColumnaPerfil {
  /** Identificador interno estable (no es una cabecera). */
  clave: string;
  /** Cabecera ORIGINAL exacta en el formato de referencia. */
  cabecera: string;
  /** Otras grafías aceptadas expresamente (exactas tras normalizar espacios y mayúsculas). */
  alias?: string[];
  tipo: TipoEsperado;
  /** Si falta, el archivo no es compatible con el perfil. */
  obligatoria: boolean;
  /** Campo territorial gobernado por la configuración del municipio. */
  territorial?: 'distrito' | 'zona' | 'cp';
  nota?: string;
}

/**
 * Indicadores esperados de un censo CONCRETO (informe agregado facilitado por quien lo elaboró). Solo
 * se comparan cuando el archivo es ese censo (misma huella SHA-256) o la persona lo pide expresamente.
 */
export interface ReferenciaCenso {
  descripcion: string;
  sha256?: string;
  indicadores?: Record<string, unknown>;
}

/**
 * Perfil de importación: DATOS (no código). Dice qué columna del Excel corresponde a cada campo del
 * catálogo común (`camposImportacion.ts`), dónde están los datos y qué columnas adicionales se
 * conservan sin interpretarlas. Es versionado: cambiar una correspondencia crea una versión nueva.
 */
export interface PerfilImportacion {
  /** Marca de formato al exportar o guardar el perfil. */
  formato?: 'ulit-censo/perfil-importacion';
  id: string;
  version: number;
  nombre: string;
  descripcion: string;
  /** «referencia»: incluido en la aplicación; «usuario»: creado con la correspondencia de columnas. */
  origen?: 'referencia' | 'usuario';
  /** Nombres habituales de la hoja de datos (solo orientativos: se detecta por estructura). */
  hojasHabituales: string[];
  /** Hoja y fila de cabecera elegidas al crear el perfil (orientativas para otros archivos). */
  ubicacion?: { hoja?: string; filaCabecera?: number };
  columnas: ColumnaPerfil[];
  /** Cabeceras de columnas que no corresponden a ningún campo: se conservan tal cual, sin interpretar. */
  adicionales?: string[];
  /** Solo en perfiles de un censo concreto: indicadores y huella de referencia (opcionales). */
  referencia?: ReferenciaCenso;
  creado?: { por?: string; fecha: string };
}

const c = (clave: string, cabecera: string, tipo: TipoEsperado, extra: Partial<ColumnaPerfil> = {}): ColumnaPerfil => ({ clave, cabecera, tipo, obligatoria: true, ...extra });

/** Columnas comunes a los dos formatos, desde «Nombre del negocio» hasta «Nº redes». */
const NEGOCIO = (grComercio: string): ColumnaPerfil[] => [
  c('nombre', 'Nombre del negocio', 'texto'),
  c('grupoActividad', 'GrActividad', 'lista'),
  c('grupoComercio', grComercio, 'lista', { nota: 'Solo en Comercio' }),
  c('subgrupo', 'Subgrupo de actividad', 'lista'),
  c('actividad', 'Actividad', 'lista'),
  c('descripcionActividad', 'Descripción', 'texto', { nota: 'Descripción de la ACTIVIDAD clasificada (no del negocio)' }),
  c('franquicia', 'Franquicia', 'binario-01', { nota: 'Variable binaria. No es el nombre de cadena' }),
  c('web', 'web', 'binario-01'),
  c('googleBusiness', 'Google My Bussines', 'binario-01', { alias: ['Google My Business'], nota: 'Grafía histórica «Bussines»' }),
  c('ventaOnline', 'Vende internet', 'binario-01'),
  c('numResenas', 'Nº reseñas Google', 'entero'),
  c('respondeResenas', 'Responde reseñas G', 'binario-01'),
  c('instagram', 'Instagram', 'binario-01'),
  c('seguidoresInstagram', 'segu Insta', 'entero'),
  c('facebook', 'Facebook', 'binario-01'),
  c('seguidoresFacebook', 'Segu F', 'entero'),
  c('twitter', 'Twitter', 'binario-01', { alias: ['Twiter'] }),
  c('seguidoresTwitter', 'Segu T', 'entero'),
  c('numRedes', 'Nº redes', 'entero', { nota: 'Calculado (Instagram + Facebook + Twitter / X)' }),
];

/** Censo municipal histórico de 27 columnas (Medina 2025; Valladolid 2024, itinerario 10). */
export const PERFIL_CENSO_27: PerfilImportacion = {
  id: 'censo-municipal-27',
  version: 1,
  nombre: 'Censo municipal histórico · 27 columnas',
  descripcion: 'Estructura de los censos de Medina del Campo 2025 y del itinerario 10 de Valladolid 2024.',
  hojasHabituales: ['Datos'],
  columnas: [
    c('fecha', 'Fecha censo', 'fecha'),
    c('distrito', 'Distrito', 'codigo', { territorial: 'distrito' }),
    c('zona', 'Zona', 'codigo', { territorial: 'zona' }),
    c('cp', 'CP', 'codigo-postal', { territorial: 'cp' }),
    c('direccion', 'Dirección', 'texto'),
    c('numero', 'Num', 'portal'),
    c('vacio', 'Local Vacío', 'binario-01'),
    c('fachada', 'Long fachada', 'decimal', { nota: 'Metros de fachada (locales vacíos)' }),
    // En el original de Medina 2025 la cabecera lleva 56 espacios finales.
    ...NEGOCIO(`Gr Comercio${' '.repeat(56)}`),
  ],
};

/** Itinerario de Medina 2026 (hoja «Datos 25»): 28 columnas, sin Distrito ni Zona. */
export const PERFIL_ITINERARIO_28: PerfilImportacion = {
  id: 'itinerario-medina-2026-28',
  version: 1,
  nombre: 'Itinerario Medina 2026 · 28 columnas',
  descripcion: 'Estructura de los itinerarios de Medina del Campo 2026: añade Municipio, itinerario y Orden Par; no tiene Distrito ni Zona.',
  hojasHabituales: ['Datos 25', 'Datos'],
  columnas: [
    c('fecha', 'Fecha censo', 'fecha'),
    c('municipio', 'Municipio', 'texto'),
    c('itinerario', 'itinerario', 'entero'),
    c('cp', 'CP', 'codigo-postal', { territorial: 'cp' }),
    c('direccion', 'Dirección', 'texto'),
    c('numero', 'Num', 'portal'),
    c('ordenPar', 'Orden Par', 'entero', { nota: 'Vacía en el perfil conocido' }),
    c('vacio', 'Local Vacío', 'binario-01'),
    c('fachada', 'Long fachada', 'decimal'),
    ...NEGOCIO('Gr Comercio'),
  ],
};

export const PERFILES_IMPORTACION: PerfilImportacion[] = [PERFIL_CENSO_27, PERFIL_ITINERARIO_28];

// ───────────── Comparación de cabeceras ─────────────

/** Normalización TOLERANTE solo a lo irrelevante: espacios (incluidos finales y dobles), NFC y mayúsculas. */
export function normalizarCabecera(t: string): string {
  return t.normalize('NFC').replace(/[\s ]+/g, ' ').trim().toLowerCase();
}
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

/**
 * Cómo coincide una cabecera del archivo con la del perfil:
 *  exacta · espacios (solo difieren espacios) · mayusculas · tildes · alias · null (no coincide).
 * «tildes» se tolera pero se informa para revisión; el resto no altera nada.
 */
export type Coincidencia = 'exacta' | 'espacios' | 'mayusculas' | 'tildes' | 'alias';

export function compararCabecera(archivo: string, col: ColumnaPerfil): Coincidencia | null {
  if (archivo === col.cabecera) return 'exacta';
  const a = normalizarCabecera(archivo);
  const e = normalizarCabecera(col.cabecera);
  if (a === e) {
    const soloEspacios = archivo.replace(/[\s ]+/g, ' ').trim() === col.cabecera.replace(/[\s ]+/g, ' ').trim();
    return soloEspacios ? 'espacios' : 'mayusculas';
  }
  if (sinTildes(a) === sinTildes(e)) return 'tildes';
  if ((col.alias ?? []).some((x) => normalizarCabecera(x) === a)) return 'alias';
  return null;
}
