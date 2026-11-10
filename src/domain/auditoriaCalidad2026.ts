import type { BaseDatos } from './db';
import type { RegistroOrigen } from './types';

/** Reglas de coherencia del trabajo de campo 2026, sobre la fuente Excel intacta.
 * No depende del estado de conciliación con 2025 ni del localId físico.
 * Cada registro se contabiliza una sola vez aunque tenga varias incidencias.
 */
export type CodigoIncidenciaCalidad =
  | 'vacio-con-nombre' | 'vacio-sin-fachada' | 'vacio-con-actividad'
  | 'vacio-con-digital' | 'ocupado-sin-nombre' | 'ocupado-con-fachada'
  | 'lv-invalido';
export type SeveridadCalidad = 'error' | 'revisar';
export interface IncidenciaCalidad {
  codigo: CodigoIncidenciaCalidad;
  texto: string;
  severidad: SeveridadCalidad;
  campos: string[];
}
export interface FilaCalidad {
  id: string;
  registro: RegistroOrigen;
  itinerario: string;
  nombre: string;
  calle: string;
  numero: string;
  lv: string;
  fachada: string;
  incidencias: IncidenciaCalidad[];
}
export interface InformeCalidad {
  total: number;
  conformes: number;
  vacios: number;
  ocupados: number;
  filas: FilaCalidad[];
}

const CLASIFICACION = ['Actividad', 'GrActividad', 'Subgrupo de actividad', 'Gr Comercio', 'Descripción', 'Franquicia'];
const DIGITAL = ['web', 'Google My Bussines', 'Vende internet', 'Nº reseñas Google', 'Responde reseñas G',
  'Facebook', 'Instagram', 'Twitter', 'Nº redes', 'Segu F', 'Segu T', 'segu Insta'];
const limpio = (v: unknown) => String(v ?? '').trim();
const datos = (r: RegistroOrigen, campos: string[]) =>
  campos.filter((campo) => limpio(r.datos[campo]) !== '');

export function incidenciasRegistro2026(registro: RegistroOrigen): IncidenciaCalidad[] {
  const d = registro.datos;
  const nombre = limpio(d['Nombre del negocio']);
  const lv = limpio(d['Local Vacío']);
  const fachada = limpio(d['Long fachada']);
  const salida: IncidenciaCalidad[] = [];
  const add = (codigo: CodigoIncidenciaCalidad, texto: string, severidad: SeveridadCalidad, campos: string[]) =>
    salida.push({ codigo, texto, severidad, campos });

  if (lv === '1') {
    if (nombre) add('vacio-con-nombre',
      nombre.toLowerCase() === 'lv'
        ? 'Figura como vacío, pero el nombre contiene «LV». Confirma que no se haya usado como nombre comercial.'
        : 'Figura como vacío, pero tiene nombre comercial.', 'error', ['Nombre del negocio', 'Local Vacío']);
    if (!fachada) add('vacio-sin-fachada',
      'El local vacío no tiene longitud de fachada.', 'revisar', ['Long fachada']);
    const clas = datos(registro, CLASIFICACION);
    if (clas.length) add('vacio-con-actividad',
      'El local vacío conserva actividad, descripción o franquicia.', 'revisar', clas);
    const digital = datos(registro, DIGITAL);
    if (digital.length) add('vacio-con-digital',
      'El local vacío conserva datos digitales o de redes sociales.', 'revisar', digital);
  } else if (lv === '0') {
    if (!nombre) add('ocupado-sin-nombre',
      'Figura como ocupado, pero no tiene nombre comercial.', 'error', ['Nombre del negocio', 'Local Vacío']);
    if (fachada) add('ocupado-con-fachada',
      'El local ocupado tiene metros de fachada consignados. Comprueba si corresponde a vuestro protocolo.', 'revisar', ['Long fachada']);
  } else {
    add('lv-invalido', 'El campo Local Vacío debe contener 0 (ocupado) o 1 (vacío).',
      'error', ['Local Vacío']);
  }
  return salida;
}

export function auditarCalidad2026(db: BaseDatos, campanaId: string): InformeCalidad {
  const confirmadas = new Set(Object.values(db.importaciones)
    .filter((i) => i.campanaId === campanaId && i.estado === 'confirmada').map((i) => i.id));
  const registros = Object.values(db.registros)
    .filter((r) => confirmadas.has(r.importacionId) && !!r.itinerarioId && !r.exclusion)
    .sort((a, b) => (db.itinerarios[a.itinerarioId ?? '']?.codigo ?? '').localeCompare(
      db.itinerarios[b.itinerarioId ?? '']?.codigo ?? '') || a.fila - b.fila);
  const filas: FilaCalidad[] = [];
  let vacios = 0;
  let ocupados = 0;
  for (const r of registros) {
    const lv = limpio(r.datos['Local Vacío']);
    if (lv === '1') vacios++;
    if (lv === '0') ocupados++;
    const incidencias = incidenciasRegistro2026(r);
    if (!incidencias.length) continue;
    filas.push({
      id: r.id, registro: r,
      itinerario: db.itinerarios[r.itinerarioId ?? '']?.codigo ?? 'Sin itinerario',
      nombre: limpio(r.datos['Nombre del negocio']),
      calle: limpio(r.datos['Dirección']),
      numero: limpio(r.datos.Num),
      lv, fachada: limpio(r.datos['Long fachada']), incidencias,
    });
  }
  return { total: registros.length, conformes: registros.length - filas.length, vacios, ocupados, filas };
}

export const ETIQUETAS_CALIDAD: Record<CodigoIncidenciaCalidad, string> = {
  'vacio-con-nombre': 'Vacío con nombre',
  'vacio-sin-fachada': 'Vacío sin fachada',
  'vacio-con-actividad': 'Vacío con categorización',
  'vacio-con-digital': 'Vacío con datos digitales',
  'ocupado-sin-nombre': 'Ocupado sin nombre',
  'ocupado-con-fachada': 'Ocupado con fachada',
  'lv-invalido': 'Estado vacío/ocupado incorrecto',
};
