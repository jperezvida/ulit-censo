/**
 * Reglas compartidas para detectar archivos que podrían contener datos censales reales.
 * Las usan el script de comprobación, el hook de pre-commit y las pruebas.
 */
export const PATRONES_PROHIBIDOS = [
  /(^|\/)datos-reales\//i,
  /\.(xlsx|xls|xlsm|xlsb|ods)$/i,
  /\.perfil\.json$/i, // los perfiles se revisan y se incorporan a mano, con otro nombre
  /\.informe-estructural\.json$/i, // informes de C1a: se generan junto al Excel, fuera del repositorio
  /\.informe-interpretacion\.json$/i, // informes de C1b: ídem
];

/** Excepciones explícitas (ninguna por ahora: las pruebas generan sus XLSX en memoria). */
export const PERMITIDOS = [];

export function archivosProhibidos(rutas) {
  return rutas.filter((r) => PATRONES_PROHIBIDOS.some((p) => p.test(r)) && !PERMITIDOS.some((p) => p.test(r)));
}
