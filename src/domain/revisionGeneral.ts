import type { BaseDatos } from './db';
import type { CorreccionRegistro, RegistroOrigen } from './types';
import { PERFIL_CENSO_27, PERFIL_ITINERARIO_28 } from './xlsx/perfilesImportacion';

/**
 * Fase 1 · auditoría no destructiva de las FILAS ORIGINALES de los Excel de la campaña.
 * No se infiere ocupación a partir del nombre ni se concilian locales en esta fase.
 * Se conservan todas las celdas originales y cada aviso apunta a su importación y fila.
 */
export type TipoIncidenciaGeneral =
  | 'estado-ausente' | 'estado-invalido' | 'vacio-con-nombre'
  | 'vacio-sin-fachada' | 'vacio-con-clasificacion' | 'vacio-con-franquicia'
  | 'vacio-con-digital' | 'ocupado-sin-nombre' | 'ocupado-con-fachada';

export interface IncidenciaGeneral {
  tipo: TipoIncidenciaGeneral;
  titulo: string;
  detalle: string;
}
export interface FilaRevisionGeneral {
  id: string;
  registro: RegistroOrigen;
  archivo: string;
  itinerario: string;
  direccion: string;
  numero: string;
  nombre: string;
  estado: 'vacio' | 'ocupado' | 'desconocido';
  correccion?: CorreccionRegistro;
  incidencias: IncidenciaGeneral[];
}
export interface ResultadoRevisionGeneral {
  filas: FilaRevisionGeneral[];
  examinadas: number;
  conIncidencias: number;
  sinIncidencias: number;
  incidenciasPorTipo: Partial<Record<TipoIncidenciaGeneral, number>>;
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const ALIAS = new Map<string, string[]>();
for (const perfil of [PERFIL_CENSO_27, PERFIL_ITINERARIO_28]) {
  for (const c of perfil.columnas) {
    const actual = ALIAS.get(c.clave) ?? [];
    for (const cabecera of [c.cabecera, ...(c.alias ?? [])]) {
      if (!actual.includes(normalizar(cabecera))) actual.push(normalizar(cabecera));
    }
    ALIAS.set(c.clave, actual);
  }
}

/** Accede al contenido original cuando existe, con compatibilidad con importaciones antiguas. */
export function datoRevisionGeneral(r: RegistroOrigen, clave: string, valores?: Record<string, string>): string {
  if (valores && Object.prototype.hasOwnProperty.call(valores, clave)) return valores[clave];
  const original = r.original?.[clave];
  if (original) {
    switch (original.t) {
      case 'vacio': return '';
      case 'booleano': return original.v ? '1' : '0';
      case 'numero': return String(original.v);
      case 'texto':
      case 'fecha':
      case 'error': return original.v.trim();
    }
  }
  const alias = ALIAS.get(clave) ?? [];
  const entrada = Object.entries(r.datos).find(([k]) => k === clave || alias.includes(normalizar(k)));
  return (entrada?.[1] ?? '').trim();
}

const CLASIFICACION = ['grupoActividad', 'grupoComercio', 'subgrupo', 'actividad', 'descripcionActividad'];
const DIGITAL = [
  'web', 'googleBusiness', 'ventaOnline', 'numResenas', 'respondeResenas',
  'instagram', 'seguidoresInstagram', 'facebook', 'seguidoresFacebook',
  'twitter', 'seguidoresTwitter', 'numRedes',
];

/** Ceros y respuestas negativas no implican presencia real; sí los valores positivos o textos no vacíos. */
function indicioPositivo(valor: string): boolean {
  const v = normalizar(valor);
  return !!v && !['0', '0.0', '0,0', 'no', 'n', 'false', 'falso', '-'].includes(v);
}

export function revisarRegistroGeneral(r: RegistroOrigen, valores?: Record<string, string>): { estado: FilaRevisionGeneral['estado']; incidencias: IncidenciaGeneral[] } {
  const dato = (clave: string) => datoRevisionGeneral(r, clave, valores);
  const vacio = dato('vacio');
  const nombre = dato('nombre');
  const fachada = dato('fachada');
  const incidencias: IncidenciaGeneral[] = [];
  const aviso = (tipo: TipoIncidenciaGeneral, titulo: string, detalle: string) => incidencias.push({ tipo, titulo, detalle });

  // No inventar estado ante celdas ausentes, ambiguas o incorrectas.
  if (!vacio) {
    aviso('estado-ausente', 'Falta indicar si el local está vacío', 'La columna «Local Vacío» debe contener 1 (vacío) o 0 (ocupado).');
    return { estado: 'desconocido', incidencias };
  }
  if (vacio !== '0' && vacio !== '1') {
    aviso('estado-invalido', 'Valor incorrecto en «Local Vacío»', `El valor «${vacio}» no es 0 ni 1. Comprobarlo en el registro original.`);
    return { estado: 'desconocido', incidencias };
  }

  if (vacio === '1') {
    if (nombre) aviso('vacio-con-nombre', 'Local vacío con nombre de negocio', 'Confirmar si sigue ocupado o si se ha conservado el nombre anterior.');
    const metros = Number(fachada.replace(',', '.'));
    if (!fachada || !Number.isFinite(metros) || metros <= 0) {
      aviso('vacio-sin-fachada', 'Faltan metros válidos de fachada', 'Un local vacío necesita una longitud de fachada mayor que cero.');
    }
    const rellenos = CLASIFICACION.filter((k) => !!dato(k));
    if (rellenos.length) {
      aviso('vacio-con-clasificacion', 'Local vacío con categorización', `Hay ${rellenos.length} campo(s) de actividad o descripción rellenados. Revisar sin borrar automáticamente.`);
    }
    if (indicioPositivo(dato('franquicia'))) {
      aviso('vacio-con-franquicia', 'Local vacío marcado como franquicia', 'La condición de franquicia corresponde a un negocio, no a un local vacío.');
    }
    const digitales = DIGITAL.filter((k) => indicioPositivo(dato(k)));
    if (digitales.length) {
      aviso('vacio-con-digital', 'Local vacío con presencia digital', `Hay ${digitales.length} dato(s) positivos de web, Google o redes. Comprobar si pertenecen al ocupante anterior.`);
    }
    return { estado: 'vacio', incidencias };
  }

  if (!nombre) aviso('ocupado-sin-nombre', 'Local ocupado sin nombre', 'Completar el nombre del establecimiento o comprobar que su estado sea correcto.');
  if (fachada) aviso('ocupado-con-fachada', 'Local ocupado con metros de fachada', 'La columna «Long fachada» se utiliza para los locales vacíos; comprobar si se ha conservado por error.');
  return { estado: 'ocupado', incidencias };
}

/** Sólo las importaciones CONFIRMADAS de la campaña activa; sin cruzar con 2025 ni otras campañas. */
export function auditarRevisionGeneral(db: BaseDatos, campanaId: string): ResultadoRevisionGeneral {
  const importaciones = new Map(Object.values(db.importaciones)
    .filter((i) => i.campanaId === campanaId && i.estado === 'confirmada' && (i.tipo === 'C-excel-itinerario' || i.tipo === 'D-actualizacion'))
    .map((i) => [i.id, i]));
  const filas = Object.values(db.registros)
    .filter((r) => importaciones.has(r.importacionId) && !r.exclusion)
    .sort((a, b) => (db.itinerarios[a.itinerarioId ?? '']?.codigo ?? '').localeCompare(db.itinerarios[b.itinerarioId ?? '']?.codigo ?? '', 'es', { numeric: true }) || a.importacionId.localeCompare(b.importacionId) || a.fila - b.fila)
    .map((registro): FilaRevisionGeneral => {
      const correccion = db.correccionesRegistros?.[registro.id];
      const vigente = correccion?.campanaId === campanaId ? correccion : undefined;
      const valores = vigente?.valores;
      const { estado, incidencias } = revisarRegistroGeneral(registro, valores);
      return {
        id: registro.id, registro,
        archivo: importaciones.get(registro.importacionId)?.archivo ?? 'Excel importado',
        itinerario: db.itinerarios[registro.itinerarioId ?? '']?.codigo ?? 'Sin itinerario',
        direccion: datoRevisionGeneral(registro, 'direccion', valores) || 'Sin calle consignada',
        numero: datoRevisionGeneral(registro, 'numero', valores) || 's/n',
        nombre: datoRevisionGeneral(registro, 'nombre', valores),
        estado, incidencias, correccion: vigente,
      };
    });
  const incidenciasPorTipo: ResultadoRevisionGeneral['incidenciasPorTipo'] = {};
  for (const f of filas) for (const inc of f.incidencias) {
    incidenciasPorTipo[inc.tipo] = (incidenciasPorTipo[inc.tipo] ?? 0) + 1;
  }
  const conIncidencias = filas.filter((f) => f.incidencias.length > 0).length;
  return { filas, examinadas: filas.length, conIncidencias, sinIncidencias: filas.length - conIncidencias, incidenciasPorTipo };
}
