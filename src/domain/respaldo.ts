import { VERSION_DATOS, type BaseDatos } from './db';
import { sha256Texto } from './sha256';
import { metaEspacio, verificarEspacio, type TipoEspacio } from './espacios';
import { migrarALaActual } from './migraciones';

/**
 * C1e · RESPALDO EXTERNO recuperable de un espacio aislado (ensayo o datos reales).
 *
 * IndexedDB no es un almacenamiento duradero institucional (el navegador puede borrarlo, depende del
 * perfil y del origen de la URL). Por eso, antes de cada incorporación real se exige un respaldo
 * descargado a un archivo y COMPROBADO (se vuelve a leer y se verifica byte a byte su contenido).
 *
 * Formato: JSON con un sobre que identifica el espacio, la versión de los datos y la huella
 * SHA-256 del contenido. Nunca contiene los bytes del Excel original (solo lo que hay en la base:
 * registros de origen celda a celda, igual que en IndexedDB).
 */

export const FORMATO_RESPALDO = 'ulit-censo/respaldo-espacio';

export interface SobreRespaldo {
  formato: typeof FORMATO_RESPALDO;
  version: 1;
  espacio: TipoEspacio;
  espacioId: string;
  creado: string;
  versionDatos: number;
  /** SHA-256 de `JSON.stringify(datos)`. */
  sha256: string;
  resumen: Record<string, number>;
  datos: BaseDatos;
}

const resumenBase = (db: BaseDatos) => ({
  campanas: Object.keys(db.campanas).length, importaciones: Object.keys(db.importaciones).length, registros: Object.keys(db.registros).length,
  locales: Object.keys(db.locales).length, negocios: Object.keys(db.negocios).length, observaciones: Object.keys(db.observaciones).length, calles: Object.keys(db.calles).length,
});

export interface Respaldo {
  nombreArchivo: string;
  texto: string;
  sha256: string;
  resumen: Record<string, number>;
}

/** Prepara el archivo de respaldo (sin descargarlo: eso lo hace la interfaz). */
export function crearRespaldo(db: BaseDatos, tipo: TipoEspacio, ahora = new Date().toISOString()): Respaldo {
  const problemas = verificarEspacio(db, tipo);
  if (problemas.length) throw new Error(`No se respalda una base que no supera la verificación del espacio: ${problemas[0]}`);
  const m = metaEspacio(db)!;
  const contenido = JSON.stringify(db);
  const sha256 = sha256Texto(contenido);
  const resumen = resumenBase(db);
  const sobre = { formato: FORMATO_RESPALDO, version: 1, espacio: tipo, espacioId: m.espacioId, creado: ahora, versionDatos: db.version, sha256, resumen };
  // El contenido va al final y sin reformatear: así su huella se comprueba sobre el mismo texto.
  const texto = `${JSON.stringify(sobre).slice(0, -1)},"datos":${contenido}}`;
  const fecha = ahora.slice(0, 19).replace(/[:T]/g, '-');
  return { nombreArchivo: `ULIT-Censo-${tipo === 'real' ? 'DATOS-REALES' : 'ensayo'}-respaldo-${fecha}.json`, texto, sha256, resumen };
}

export type ComprobacionRespaldo =
  | { ok: true; db: BaseDatos; sobre: Omit<SobreRespaldo, 'datos'>; migrado: boolean; avisos: string[] }
  | { ok: false; motivo: string };

/**
 * Lee y comprueba un archivo de respaldo SIN aplicar nada: formato, espacio, huella del contenido,
 * versión de datos y separación del espacio. Solo un respaldo del MISMO tipo de espacio es válido.
 */
export function comprobarRespaldo(texto: string, tipo: TipoEspacio): ComprobacionRespaldo {
  let sobre: SobreRespaldo;
  try {
    sobre = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: 'El archivo no es un respaldo de ULIT Censo (JSON no válido).' };
  }
  if (sobre?.formato !== FORMATO_RESPALDO || sobre.version !== 1) return { ok: false, motivo: 'El archivo no es un respaldo de un espacio de ULIT Censo.' };
  if (sobre.espacio !== tipo) return { ok: false, motivo: `Es un respaldo del espacio «${sobre.espacio}»: no se puede usar en el espacio «${tipo}».` };
  // La huella se calcula sobre el texto EXACTO del contenido, tal como está en el archivo.
  const i = texto.indexOf('"datos":');
  if (i < 0 || !texto.endsWith('}')) return { ok: false, motivo: 'Respaldo incompleto: falta el contenido.' };
  const contenido = texto.slice(i + '"datos":'.length, -1);
  if (sha256Texto(contenido) !== sobre.sha256) return { ok: false, motivo: 'La huella SHA-256 no coincide: el respaldo está dañado o se ha modificado. No se usa.' };
  let db = sobre.datos;
  let migrado = false;
  const avisos: string[] = [];
  if (db.version !== VERSION_DATOS) {
    if (db.version === 9 || db.version === 10) {
      const r = migrarALaActual(db);
      db = r.db;
      migrado = true;
      avisos.push(...r.avisos);
    } else return { ok: false, motivo: `Versión de datos no compatible (v${db.version}; la aplicación usa v${VERSION_DATOS}).` };
  }
  const problemas = verificarEspacio(db, tipo);
  if (problemas.length) return { ok: false, motivo: `El respaldo no supera la verificación del espacio: ${problemas.slice(0, 3).join(' · ')}` };
  const { datos: _d, ...cabecera } = sobre;
  return { ok: true, db, sobre: cabecera, migrado, avisos };
}
