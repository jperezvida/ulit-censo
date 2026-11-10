import type { Importacion, RegistroOrigen, VinculoHistorico } from './types';

/** La existencia del vínculo no equivale a tener un local ni a que esté confirmado. */
export function resumenVinculosImportacion(registros: RegistroOrigen[], vinculos: VinculoHistorico[]) {
  const porRegistro = new Map(vinculos.filter((v) => v.origen.tipo === 'registro')
    .map((v) => [v.origen.id, v]));
  let conLocal = 0;
  let sinLocal = 0;
  let confirmados = 0;
  for (const r of registros) {
    const vinculo = porRegistro.get(r.id);
    if (vinculo?.localId) conLocal++;
    else sinLocal++;
    if (vinculo?.localId && vinculo.confianza === 'confirmada') confirmados++;
  }
  return { conLocal, sinLocal, confirmados, noConfirmados: registros.length - confirmados, porRegistro };
}

/** La lectura operativa primero; todas las columnas originales siguen disponibles. */
export function columnasVistaImportacion(registros: RegistroOrigen[], todas = false): string[] {
  const claves = Object.keys(registros[0]?.datos ?? {});
  if (todas) return claves;
  const preferidas = [
    'Dirección', 'Num', 'Nombre del negocio', 'Local Vacío', 'Actividad', 'Descripción',
  ];
  const presentes = preferidas.filter((nombre) => claves.some((k) => k === nombre));
  return presentes.length ? presentes : claves.slice(0, 7);
}

export function notaVisibleImportacion(imp: Importacion): string | undefined {
  if (imp.tipo === 'C-excel-itinerario' &&
      imp.nota?.startsWith('C1c · Censo histórico incorporado como referencia')) {
    return 'Excel de itinerario incorporado en la campaña operativa. Se conservan sus filas y celdas de origen, sin guardar los bytes del XLSX. Las clasificaciones y la presencia digital siguen pendientes de revisión por Oficina.';
  }
  return imp.nota;
}
