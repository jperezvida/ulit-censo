import { PERFIL_CENSO_27, PERFIL_ITINERARIO_28, PERFILES_IMPORTACION, type PerfilImportacion } from './perfilesImportacion';

/**
 * Perfiles de REFERENCIA incluidos en la aplicación. Los de formato (27 y 28 columnas) sirven para
 * cualquier censo con esa estructura. El de «Medina del Campo 2025» es un CASO DE REFERENCIA: mismas
 * columnas que el formato de 27, más su informe agregado y su huella. Sus indicadores solo se comparan
 * con ese censo concreto (o si la persona lo pide), nunca con cualquier archivo.
 */

/** Huella SHA-256 del archivo auténtico de Medina 2025 (no revela su contenido). */
export const SHA256_ORIGINAL_MEDINA_2025 = '645179a850474ab92bc54c9ed4e6e2f300790f62081fb0ea02d3999e3c4cb67a';

/** Indicadores del informe agregado de la Cátedra (Medina 2025, sin datos comerciales). */
export const INFORME_AGREGADO_MEDINA_2025 = {
  filas: 889,
  columnas: 27,
  hojaDatos: 'Datos',
  hojasAuxiliares: ['Tablas Dinámicas', 'Hoja1'],
  localVacio: { ocupado: 608, vacio: 280, sinValor: 1 },
  grActividad: { comercio: 242, servicios: 277, hosteleria: 90, vacio: 280, variantesHosteleria: 2 },
  fechas: { anio2024: 355, anio2025: 533, textoInvalido: 1 },
  calles: { literales: 93, sinMayusculas: 92 },
  cp: { valor: '47400', filas: 889 },
  sinNumero: 5,
  direcciones: { pares: 625, paresRepetidos: 186, registrosEnRepetidos: 445 },
  vaciosSinFachada: 12,
  ocupadosSinActividad: 108,
  franquicia: { ceros: 529, unos: 79, vacios: 281 },
} as const;
export type InformeAgregado = typeof INFORME_AGREGADO_MEDINA_2025;

export const PERFIL_MEDINA_2025: PerfilImportacion = {
  ...PERFIL_CENSO_27,
  id: 'medina-2025-referencia',
  nombre: 'Medina del Campo 2025 · censo de referencia',
  descripcion: 'Formato de 27 columnas con el informe agregado y la huella del censo auténtico de Medina del Campo 2025.',
  origen: 'referencia',
  referencia: { descripcion: 'Informe agregado de la Cátedra (889 registros)', sha256: SHA256_ORIGINAL_MEDINA_2025, indicadores: INFORME_AGREGADO_MEDINA_2025 },
};

/** Todos los perfiles de referencia (los de formato se proponen solos; el de Medina 2025, al elegirlo o por su huella). */
export const PERFILES_REFERENCIA: PerfilImportacion[] = [
  ...PERFILES_IMPORTACION.map((p) => ({ ...p, origen: 'referencia' as const })),
  PERFIL_MEDINA_2025,
];
export { PERFIL_CENSO_27, PERFIL_ITINERARIO_28 };

/** ¿Se deben comparar los indicadores de referencia? Solo si el perfil los tiene y es ese censo o se pide expresamente. */
export function referenciaAplicable(perfil: PerfilImportacion | undefined, sha256: string | undefined, pedido?: boolean): InformeAgregado | undefined {
  const ref = perfil?.referencia;
  if (!ref?.indicadores) return undefined;
  if (pedido === false) return undefined;
  if (pedido || (ref.sha256 && ref.sha256 === sha256)) return ref.indicadores as InformeAgregado;
  return undefined;
}
