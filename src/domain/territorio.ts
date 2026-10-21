/**
 * Configuración TERRITORIAL por municipio (Distrito, Zona y CP).
 *
 * Son tres datos distintos: ninguno se deduce de otro ni del nombre de la calle. Solo pueden
 * completarse con una correspondencia territorial VERIFICADA (fuente, versión y fecha) o con una
 * asignación manual autorizada y trazada. Si un archivo no los trae, se conservan ausentes.
 *
 * En C1a la configuración solo se usa para INFORMAR sobre lo que trae un archivo; no se guarda en
 * la base de datos ni modifica campañas.
 */

export type UsoCampoTerritorial =
  | 'no-se-usa' // el municipio no utiliza el campo (Medina: Distrito y Zona)
  | 'fijo' // un único valor para todo el municipio (Medina: CP 47400)
  | 'por-direccion' // depende de la dirección (correspondencia verificada o manual)
  | 'tabla-verificada'; // código territorial según una tabla verificada (Valladolid: Distrito, Zona)

export interface ReglaTerritorial {
  uso: UsoCampoTerritorial;
  /** Obligatorio en las campañas ACTUALES del municipio (no en los históricos importados). */
  obligatorio: boolean;
  valorFijo?: string;
}

export interface ConfigTerritorial {
  municipioId: string;
  municipio: string;
  version: number;
  distrito: ReglaTerritorial;
  zona: ReglaTerritorial;
  cp: ReglaTerritorial;
  aceras: 'ambas' | 'por-confirmar';
  resultado: 'excel-unico-municipal' | 'por-confirmar';
  nota: string;
}

export const CONFIG_TERRITORIAL: Record<string, ConfigTerritorial> = {
  'mun-medina': {
    municipioId: 'mun-medina', municipio: 'Medina del Campo', version: 1,
    distrito: { uso: 'no-se-usa', obligatorio: false },
    zona: { uso: 'no-se-usa', obligatorio: false },
    cp: { uso: 'fijo', obligatorio: true, valorFijo: '47400' },
    aceras: 'ambas',
    resultado: 'excel-unico-municipal',
    nota: 'Distrito y Zona vacíos por regla municipal (no es un defecto). Se censan ambas aceras; seguimiento por itinerarios y un único Excel municipal.',
  },
  // Escenario FICTICIO de C1d: mismas reglas territoriales que Medina, en un municipio aislado.
  'mun-demo-medina': {
    municipioId: 'mun-demo-medina', municipio: 'Medina del Campo (escenario ficticio)', version: 1,
    distrito: { uso: 'no-se-usa', obligatorio: false },
    zona: { uso: 'no-se-usa', obligatorio: false },
    cp: { uso: 'fijo', obligatorio: true, valorFijo: '47400' },
    aceras: 'ambas',
    resultado: 'excel-unico-municipal',
    nota: 'Escenario ficticio de demostración con las reglas de Medina del Campo (Distrito y Zona no se usan; CP 47400). No contiene datos reales.',
  },
  'mun-valladolid': {
    municipioId: 'mun-valladolid', municipio: 'Valladolid', version: 1,
    distrito: { uso: 'tabla-verificada', obligatorio: true },
    zona: { uso: 'tabla-verificada', obligatorio: true },
    cp: { uso: 'por-direccion', obligatorio: true },
    aceras: 'por-confirmar',
    resultado: 'por-confirmar',
    nota: 'Distrito, Zona y CP se gestionan en las campañas actuales. Aún no hay una correspondencia territorial verificada: no se completan automáticamente.',
  },
};

export type CampoTerritorial = 'distrito' | 'zona' | 'cp';

export interface EvaluacionTerritorial {
  campo: CampoTerritorial;
  regla: ReglaTerritorial;
  /** conforme · ausente (vacío o sin columna) · difiere (valores que no encajan con la regla) */
  estado: 'conforme' | 'ausente' | 'difiere' | 'informativo';
  mensaje: string;
}

const NOMBRE: Record<CampoTerritorial, string> = { distrito: 'Distrito', zona: 'Zona', cp: 'CP' };

/**
 * Evalúa lo que trae un archivo para un campo territorial, SIN completar nada.
 * `columna`: undefined si el formato no tiene esa columna; si la tiene, celdas con y sin valor y,
 * para el CP, cuántas difieren del valor fijo configurado.
 */
export function evaluarCampoTerritorial(
  campo: CampoTerritorial, regla: ReglaTerritorial,
  columna?: { conValor: number; vacias: number; distintasDelFijo?: number },
): EvaluacionTerritorial {
  const n = NOMBRE[campo];
  const base = { campo, regla };
  if (regla.uso === 'no-se-usa') {
    if (!columna) return { ...base, estado: 'conforme', mensaje: `${n}: el municipio no lo utiliza y el formato no tiene esa columna.` };
    if (!columna.conValor) return { ...base, estado: 'conforme', mensaje: `${n}: vacío en todas las filas, como corresponde (el municipio no lo utiliza). No se rellenará.` };
    return { ...base, estado: 'difiere', mensaje: `${n}: el municipio no lo utiliza, pero ${columna.conValor} fila(s) traen valor. Se conservarán como dato original, sin usarlos.` };
  }
  if (!columna) {
    return { ...base, estado: regla.obligatorio ? 'ausente' : 'informativo', mensaje: `${n}: el formato no tiene esa columna. Se mantendrá ausente${regla.obligatorio ? '; en las campañas donde es obligatorio quedará como incidencia (C1b)' : ''}.` };
  }
  if (regla.uso === 'fijo') {
    if (columna.vacias && !columna.conValor) return { ...base, estado: 'ausente', mensaje: `${n}: vacío en todas las filas. No se rellena automáticamente con ${regla.valorFijo}: se decidirá en C1b.` };
    if (columna.distintasDelFijo) return { ...base, estado: 'difiere', mensaje: `${n}: ${columna.distintasDelFijo} fila(s) con un valor distinto de ${regla.valorFijo}.` };
    return { ...base, estado: columna.vacias ? 'ausente' : 'conforme', mensaje: `${n}: ${columna.conValor} fila(s) con ${regla.valorFijo}${columna.vacias ? ` y ${columna.vacias} vacía(s)` : ''}.` };
  }
  if (!columna.conValor) {
    return { ...base, estado: regla.obligatorio ? 'ausente' : 'informativo', mensaje: `${n}: vacío en todas las filas. Se conservará ausente (no se deduce de la calle ni de otro campo)${regla.obligatorio ? '; es obligatorio en las campañas actuales, por lo que habrá incidencia al incorporarlo (C1b)' : ''}.` };
  }
  return { ...base, estado: columna.vacias ? 'ausente' : 'conforme', mensaje: `${n}: ${columna.conValor} fila(s) con valor${columna.vacias ? ` y ${columna.vacias} vacía(s)` : ''}. Se comprobarán contra una correspondencia verificada cuando exista (C1b).` };
}
