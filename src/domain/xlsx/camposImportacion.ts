import { PERFIL_CENSO_27, PERFIL_ITINERARIO_28, type TipoEsperado } from './perfilesImportacion';

/**
 * G1 · CATÁLOGO COMÚN de campos de ULIT Censo: los datos que la aplicación sabe interpretar,
 * cualquiera que sea el municipio, el año o el formato del Excel. Un perfil de importación solo dice
 * qué columna del archivo corresponde a cada campo; el resto del motor trabaja con estos campos.
 *
 * `sinonimos` sirve para PROPONER la correspondencia automática: se acepta sola únicamente cuando la
 * cabecera coincide exactamente (sin distinguir mayúsculas, tildes ni signos) con un sinónimo y
 * ninguna otra columna compite por el mismo campo. Lo demás se relaciona a mano.
 */

export type GrupoCampo = 'Dirección' | 'Local' | 'Negocio' | 'Clasificación' | 'Presencia digital' | 'Territorio' | 'Itinerario' | 'Censo';

export interface CampoCatalogo {
  clave: string;
  etiqueta: string;
  grupo: GrupoCampo;
  tipo: TipoEsperado;
  /** Sin él no se puede incorporar el censo. */
  obligatorio: boolean;
  /** Recomendable: sin él la importación es posible, pero pierde información relevante. */
  recomendado?: boolean;
  territorial?: 'distrito' | 'zona' | 'cp';
  ayuda?: string;
  sinonimos: string[];
}

const f = (clave: string, etiqueta: string, grupo: GrupoCampo, tipo: TipoEsperado, sinonimos: string[], extra: Partial<CampoCatalogo> = {}): CampoCatalogo => ({ clave, etiqueta, grupo, tipo, obligatorio: false, sinonimos, ...extra });

export const CAMPOS: CampoCatalogo[] = [
  f('direccion', 'Calle o vía', 'Dirección', 'texto', ['direccion', 'calle', 'via', 'nombre de la via', 'nombre de la calle', 'nombre de calle', 'domicilio', 'direccion postal'], { obligatorio: true }),
  f('numero', 'Número de portal', 'Dirección', 'portal', ['num', 'numero', 'n', 'nº', 'portal', 'numero de portal', 'n portal', 'num portal'], { obligatorio: true, ayuda: 'Entero, con sufijo («6 B») o «S/N».' }),
  f('cp', 'Código postal', 'Territorio', 'codigo-postal', ['cp', 'c p', 'codigo postal', 'cod postal'], { territorial: 'cp' }),
  f('distrito', 'Distrito', 'Territorio', 'codigo', ['distrito'], { territorial: 'distrito' }),
  f('zona', 'Zona', 'Territorio', 'codigo', ['zona'], { territorial: 'zona' }),
  f('fecha', 'Fecha del censo', 'Censo', 'fecha', ['fecha', 'fecha censo', 'fecha de censo', 'fecha de visita', 'fecha visita', 'fecha de observacion', 'dia de visita'], { recomendado: true }),
  f('municipio', 'Municipio', 'Itinerario', 'texto', ['municipio', 'localidad']),
  f('itinerario', 'Itinerario', 'Itinerario', 'entero', ['itinerario', 'n itinerario', 'numero de itinerario']),
  f('ordenPar', 'Orden par', 'Itinerario', 'entero', ['orden par']),
  f('vacio', 'Local vacío (0/1)', 'Local', 'binario-01', ['local vacio', 'vacio', 'esta vacio', 'local desocupado'], { recomendado: true, ayuda: '1 = vacío, 0 = ocupado.' }),
  f('fachada', 'Longitud de fachada (m)', 'Local', 'decimal', ['long fachada', 'longitud fachada', 'longitud de fachada', 'metros de fachada', 'fachada m', 'fachada']),
  f('nombre', 'Nombre del negocio', 'Negocio', 'texto', ['nombre del negocio', 'nombre negocio', 'nombre comercial', 'nombre', 'rotulo', 'establecimiento'], { recomendado: true }),
  f('grupoActividad', 'Grupo de actividad', 'Clasificación', 'lista', ['gractividad', 'gr actividad', 'grupo actividad', 'grupo de actividad', 'sector', 'sector de actividad']),
  f('grupoComercio', 'Grupo de comercio', 'Clasificación', 'lista', ['gr comercio', 'grupo comercio', 'grupo de comercio']),
  f('subgrupo', 'Subgrupo de actividad', 'Clasificación', 'lista', ['subgrupo', 'subgrupo de actividad', 'subgrupo actividad']),
  f('actividad', 'Actividad', 'Clasificación', 'lista', ['actividad', 'tipo de actividad', 'actividad principal']),
  f('descripcionActividad', 'Descripción de la actividad', 'Clasificación', 'texto', ['descripcion', 'descripcion actividad', 'descripcion de la actividad']),
  f('franquicia', 'Franquicia (0/1)', 'Negocio', 'binario-01', ['franquicia', 'es franquicia']),
  f('web', 'Web (0/1)', 'Presencia digital', 'binario-01', ['web', 'pagina web', 'tiene web']),
  f('googleBusiness', 'Google Business (0/1)', 'Presencia digital', 'binario-01', ['google my bussines', 'google my business', 'google business', 'ficha de google']),
  f('ventaOnline', 'Vende por internet (0/1)', 'Presencia digital', 'binario-01', ['vende internet', 'venta online', 'vende online', 'comercio electronico']),
  f('numResenas', 'Nº de reseñas en Google', 'Presencia digital', 'entero', ['n resenas google', 'numero de resenas', 'resenas google', 'n resenas']),
  f('respondeResenas', 'Responde reseñas (0/1)', 'Presencia digital', 'binario-01', ['responde resenas g', 'responde resenas']),
  f('instagram', 'Instagram (0/1)', 'Presencia digital', 'binario-01', ['instagram']),
  f('seguidoresInstagram', 'Seguidores de Instagram', 'Presencia digital', 'entero', ['segu insta', 'seguidores instagram', 'seguidores de instagram']),
  f('facebook', 'Facebook (0/1)', 'Presencia digital', 'binario-01', ['facebook']),
  f('seguidoresFacebook', 'Seguidores de Facebook', 'Presencia digital', 'entero', ['segu f', 'seguidores facebook', 'seguidores de facebook']),
  f('twitter', 'Twitter / X (0/1)', 'Presencia digital', 'binario-01', ['twitter', 'twiter', 'twitter x']),
  f('seguidoresTwitter', 'Seguidores de Twitter / X', 'Presencia digital', 'entero', ['segu t', 'seguidores twitter', 'seguidores de twitter']),
  f('numRedes', 'Nº de redes sociales', 'Presencia digital', 'entero', ['n redes', 'numero de redes', 'redes sociales']),
];

export const CAMPO_POR_CLAVE: Record<string, CampoCatalogo> = Object.fromEntries(CAMPOS.map((c) => [c.clave, c]));
export const GRUPOS_CAMPO: GrupoCampo[] = ['Dirección', 'Local', 'Negocio', 'Censo', 'Clasificación', 'Presencia digital', 'Territorio', 'Itinerario'];

/** Normalización para comparar cabeceras con sinónimos: sin mayúsculas, tildes, signos ni espacios dobles. */
export function normalizarTitulo(t: string): string {
  return t
    .normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .toLowerCase()
    .replace(/[º°ª]/g, '')
    .replace(/[¿?¡!()[\]{}.,;:/\\'"`´·_\-–—#*+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Las cabeceras de los perfiles de referencia también son sinónimos (sin tocar el catálogo a mano).
for (const p of [PERFIL_CENSO_27, PERFIL_ITINERARIO_28]) {
  for (const col of p.columnas) {
    const campo = CAMPO_POR_CLAVE[col.clave];
    if (!campo) continue;
    for (const s of [col.cabecera, ...(col.alias ?? [])]) if (!campo.sinonimos.map(normalizarTitulo).includes(normalizarTitulo(s))) campo.sinonimos.push(s);
  }
}
