import type { PlanIncorporacion } from './incorporacion';

/**
 * Contrato de preparación, NO autorización para escribir.
 *
 * El SHA procede de la copia examinada el 05/11/2026 en el equipo de la Cátedra.
 * Sus agregados coinciden con la referencia histórica, pero NO existe prueba de
 * identidad celda a celda con el archivo antiguo de SHA distinto.
 *
 * Esta comprobación del cliente es defensa adicional. La autorización efectiva
 * sigue dependiendo de Supabase (escritura_habilitada), la sesión, el respaldo
 * verificado y CONFIRMACION_REAL_HABILITADA=false hasta aprobación expresa.
 */
export const CANDIDATO_MEDINA_2025 = {
  espacioId: 'real-medina-del-campo-2026',
  municipioId: 'real-mun-medina',
  anio: 2025,
  sha256: '9e367ca51cfecf56d93f124d166f708e374f6555a4cc36d3166afde2f1f7ba82',
  filas: 889,
  columnas: 27,
  periodoDesde: '2024-01-01',
  periodoHasta: '2025-12-31',
} as const;

/**
 * Fallar cerrado: únicamente se prepara el histórico 2025 de Medina con la
 * copia identificada y sin descartar filas. No se extiende implícitamente a
 * los itinerarios de 2026 ni a otras campañas o municipios.
 *
 * No convertir este contrato en permiso de servidor ni aceptar un SHA nuevo
 * solo porque sus recuentos agregados coincidan.
 */
export function comprobarCandidatoMedina2025(
  espacioId: string,
  plan: PlanIncorporacion,
  lectura?: { filas: number; columnas: number },
): string[] {
  const c = CANDIDATO_MEDINA_2025;
  const errores: string[] = [];
  if (espacioId !== c.espacioId) errores.push('El espacio no es el real de Medina autorizado para preparar 2025.');
  if (plan.municipio.id !== c.municipioId) errores.push('El municipio de destino no es Medina del Campo.');
  if (plan.destino.anio !== c.anio || plan.modo !== 'historico' || plan.destino.itinerario) {
    errores.push('El destino debe ser exclusivamente la campaña histórica 2025, nunca un itinerario.');
  }
  if (plan.archivo.sha256.toLowerCase() !== c.sha256) {
    errores.push('La huella del Excel no corresponde a la copia de Medina 2025 revisada.');
  }
  if (!plan.aplicable || plan.bloqueos.length) errores.push('El plan contiene bloqueos.');
  if (plan.registros.previstos !== c.filas || plan.filas.length !== c.filas || plan.nuevas.registros !== c.filas) {
    errores.push('El plan no conserva exactamente los 889 registros de origen.');
  }
  if (plan.registros.excluidos !== 0 || plan.correspondencias.excluida !== 0 || plan.decisiones.exclusiones !== 0) {
    errores.push('No se permite excluir registros del histórico de referencia sin nueva autorización.');
  }
  if (plan.decisiones.periodo?.desde !== c.periodoDesde || plan.decisiones.periodo?.hasta !== c.periodoHasta) {
    errores.push('El periodo del histórico debe abarcar las visitas de 2024 y 2025.');
  }
  if (lectura && (lectura.filas !== c.filas || lectura.columnas !== c.columnas)) {
    errores.push('La lectura del Excel no tiene 889 filas y 27 columnas.');
  }
  return errores;
}
