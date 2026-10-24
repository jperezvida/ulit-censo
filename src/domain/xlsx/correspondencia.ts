import { CAMPOS, CAMPO_POR_CLAVE, normalizarTitulo, type CampoCatalogo } from './camposImportacion';
import { compararCabecera, type ColumnaPerfil, type PerfilImportacion } from './perfilesImportacion';

/**
 * G1 · Correspondencia entre las columnas de un Excel y los campos del catálogo común.
 *
 * Automática SOLO cuando es fiable:
 *  - la cabecera coincide con la de un perfil elegido o de referencia (exacta, salvo espacios,
 *    mayúsculas, tildes o un alias declarado), o
 *  - coincide exactamente (sin mayúsculas, tildes ni signos) con un sinónimo del catálogo y ninguna
 *    otra columna compite por ese campo.
 * Si dos columnas pueden ser el mismo campo, o una columna puede ser dos campos, queda AMBIGUA y no se
 * asigna: lo decide la persona. Las columnas sin campo se conservan como ADICIONALES (sin interpretar).
 * Nunca se inventan valores para un campo sin columna.
 */

export type EstadoColumna = 'perfil' | 'automatica' | 'manual' | 'ambigua' | 'adicional';

export const ESTADO_COLUMNA_TXT: Record<EstadoColumna, string> = {
  perfil: 'Reconocida por el perfil',
  automatica: 'Reconocida',
  manual: 'Elegida a mano',
  ambigua: 'Dudosa: elija el campo',
  adicional: 'Adicional (se conserva)',
};

export interface ColumnaArchivo {
  indice: number;
  letra: string;
  cabecera: string;
}

export interface ColumnaCorrespondencia extends ColumnaArchivo {
  clave: string | null;
  estado: EstadoColumna;
  /** Campos posibles cuando la columna es dudosa (o una sugerencia que no se aplica sola). */
  candidatos?: string[];
}

const PALABRAS_MINIMAS = 4;

/** Campos que corresponden EXACTAMENTE a una cabecera (por sinónimo) y los que solo la contienen. */
function coincidencias(cabecera: string, campos: CampoCatalogo[]): { exactos: string[]; parciales: string[] } {
  const n = normalizarTitulo(cabecera);
  const palabras = new Set(n.split(' '));
  const exactos: string[] = [];
  const parciales: string[] = [];
  for (const c of campos) {
    const sin = c.sinonimos.map(normalizarTitulo);
    if (sin.includes(n)) exactos.push(c.clave);
    else if (sin.some((s) => s.length >= PALABRAS_MINIMAS && s.split(' ').every((w) => palabras.has(w)))) parciales.push(c.clave);
  }
  return { exactos, parciales };
}

/**
 * Propone la correspondencia de todas las columnas. Con `perfil`, sus columnas se reconocen primero;
 * el resto se compara con el catálogo.
 */
export function proponerCorrespondencia(columnas: ColumnaArchivo[], perfil?: PerfilImportacion): ColumnaCorrespondencia[] {
  const res = new Map<number, ColumnaCorrespondencia>();
  const usados = new Set<string>();
  // 1. Perfil (coincidencia de cabecera exacta, o con diferencias irrelevantes declaradas).
  if (perfil) {
    for (const col of columnas) {
      const c = perfil.columnas.find((p) => compararCabecera(col.cabecera, p));
      if (c && !usados.has(c.clave)) {
        usados.add(c.clave);
        res.set(col.indice, { ...col, clave: c.clave, estado: 'perfil' });
      }
    }
    for (const col of columnas) {
      if (res.has(col.indice)) continue;
      if ((perfil.adicionales ?? []).some((a) => a.trim() === col.cabecera.trim())) res.set(col.indice, { ...col, clave: null, estado: 'adicional' });
    }
  }
  // 2. Catálogo: exactos y parciales de las columnas que quedan.
  const libres = CAMPOS.filter((c) => !usados.has(c.clave));
  const resto = columnas.filter((c) => !res.has(c.indice)).map((c) => ({ col: c, ...coincidencias(c.cabecera, libres) }));
  const exactosPorCampo = new Map<string, number>();
  const parcialesPorCampo = new Map<string, number>();
  for (const r of resto) {
    for (const k of r.exactos) exactosPorCampo.set(k, (exactosPorCampo.get(k) ?? 0) + 1);
    // Una columna que ya es exactamente otro campo no compite por los demás.
    if (r.exactos.length !== 1) for (const k of r.parciales) parcialesPorCampo.set(k, (parcialesPorCampo.get(k) ?? 0) + 1);
  }
  for (const r of resto) {
    const col = r.col;
    if (r.exactos.length === 1) {
      const k = r.exactos[0];
      if ((exactosPorCampo.get(k) ?? 0) === 1 && !(parcialesPorCampo.get(k) ?? 0)) res.set(col.indice, { ...col, clave: k, estado: 'automatica' });
      else res.set(col.indice, { ...col, clave: null, estado: 'ambigua', candidatos: [k] });
    } else if (r.exactos.length > 1) {
      res.set(col.indice, { ...col, clave: null, estado: 'ambigua', candidatos: r.exactos });
    } else if (r.parciales.length && r.parciales.some((k) => exactosPorCampo.has(k) || (parcialesPorCampo.get(k) ?? 0) > 1)) {
      // Compite con otra columna por el mismo campo: dudosa (p. ej. «Dirección fiscal» frente a «Dirección»).
      res.set(col.indice, { ...col, clave: null, estado: 'ambigua', candidatos: r.parciales });
    } else {
      res.set(col.indice, { ...col, clave: null, estado: 'adicional', ...(r.parciales.length ? { candidatos: r.parciales } : {}) });
    }
  }
  return columnas.map((c) => res.get(c.indice)!);
}

/** Asignación manual de una columna (null = adicional, se conserva sin interpretar). Un campo solo puede tener una columna. */
export function asignarColumna(corr: ColumnaCorrespondencia[], indice: number, clave: string | null): ColumnaCorrespondencia[] {
  if (clave && !CAMPO_POR_CLAVE[clave]) throw new Error(`Campo desconocido: ${clave}`);
  if (clave && corr.some((c) => c.clave === clave && c.indice !== indice)) throw new Error(`El campo «${CAMPO_POR_CLAVE[clave].etiqueta}» ya está asignado a otra columna.`);
  return corr.map((c) => (c.indice !== indice ? c : { indice: c.indice, letra: c.letra, cabecera: c.cabecera, clave, estado: clave ? 'manual' : 'adicional' }));
}

export interface EvaluacionCorrespondencia {
  /** Se puede usar: obligatorios asignados, sin dudas pendientes ni campos repetidos. */
  lista: boolean;
  obligatoriosFaltan: CampoCatalogo[];
  recomendadosFaltan: CampoCatalogo[];
  dudosas: ColumnaCorrespondencia[];
  repetidos: string[];
  asignadas: number;
  adicionales: number;
}

export function evaluarCorrespondencia(corr: ColumnaCorrespondencia[]): EvaluacionCorrespondencia {
  const claves = corr.map((c) => c.clave).filter((k): k is string => !!k);
  const repetidos = [...new Set(claves.filter((k, i) => claves.indexOf(k) !== i))];
  const obligatoriosFaltan = CAMPOS.filter((c) => c.obligatorio && !claves.includes(c.clave));
  const recomendadosFaltan = CAMPOS.filter((c) => c.recomendado && !claves.includes(c.clave));
  const dudosas = corr.filter((c) => c.estado === 'ambigua');
  return {
    lista: !obligatoriosFaltan.length && !dudosas.length && !repetidos.length,
    obligatoriosFaltan, recomendadosFaltan, dudosas, repetidos, asignadas: claves.length, adicionales: corr.filter((c) => !c.clave).length,
  };
}

const slug = (t: string) => normalizarTitulo(t).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 48) || 'perfil';

/** Perfil (datos) a partir de una correspondencia completa. Las columnas guardan su cabecera EXACTA. */
export function perfilDesdeCorrespondencia(
  corr: ColumnaCorrespondencia[], meta: { nombre: string; descripcion?: string; hoja: string; filaCabecera: number; id?: string; version?: number; por?: string; fecha?: string },
): PerfilImportacion {
  const ev = evaluarCorrespondencia(corr);
  if (!ev.lista) throw new Error('La correspondencia no está completa: faltan campos obligatorios o quedan columnas dudosas.');
  const columnas: ColumnaPerfil[] = corr.filter((c) => c.clave).map((c) => {
    const campo = CAMPO_POR_CLAVE[c.clave!];
    return { clave: campo.clave, cabecera: c.cabecera, tipo: campo.tipo, obligatoria: campo.obligatorio, ...(campo.territorial ? { territorial: campo.territorial } : {}) };
  });
  return {
    formato: 'ulit-censo/perfil-importacion',
    id: meta.id ?? `usuario-${slug(meta.nombre)}`,
    version: meta.version ?? 1,
    nombre: meta.nombre.trim(),
    descripcion: meta.descripcion?.trim() || `Perfil creado con la correspondencia de columnas (${columnas.length} campos, ${ev.adicionales} adicionales).`,
    origen: 'usuario',
    hojasHabituales: [meta.hoja],
    ubicacion: { hoja: meta.hoja, filaCabecera: meta.filaCabecera },
    columnas,
    adicionales: corr.filter((c) => !c.clave).map((c) => c.cabecera),
    creado: { ...(meta.por ? { por: meta.por } : {}), fecha: meta.fecha ?? new Date().toISOString().slice(0, 10) },
  };
}

/** ¿Es un perfil válido? (para cargar uno guardado o exportado). */
export function validarPerfil(x: unknown): { ok: true; perfil: PerfilImportacion } | { ok: false; motivo: string } {
  const p = x as PerfilImportacion;
  if (!p || typeof p !== 'object') return { ok: false, motivo: 'No es un perfil.' };
  if (typeof p.id !== 'string' || !p.id || typeof p.nombre !== 'string' || !Number.isInteger(p.version) || p.version < 1) return { ok: false, motivo: 'Faltan el identificador, el nombre o la versión.' };
  if (!Array.isArray(p.columnas) || !p.columnas.length) return { ok: false, motivo: 'El perfil no tiene columnas.' };
  const vistas = new Set<string>();
  for (const c of p.columnas) {
    if (!CAMPO_POR_CLAVE[c.clave]) return { ok: false, motivo: `Campo desconocido: «${c.clave}».` };
    if (vistas.has(c.clave)) return { ok: false, motivo: `Campo repetido: «${c.clave}».` };
    if (typeof c.cabecera !== 'string' || !c.cabecera.trim()) return { ok: false, motivo: `Cabecera vacía para «${c.clave}».` };
    vistas.add(c.clave);
  }
  for (const k of CAMPOS.filter((c) => c.obligatorio).map((c) => c.clave)) if (!vistas.has(k)) return { ok: false, motivo: `Falta el campo obligatorio «${CAMPO_POR_CLAVE[k].etiqueta}».` };
  return { ok: true, perfil: { ...p, hojasHabituales: p.hojasHabituales ?? [], columnas: p.columnas.map((c) => ({ ...c, tipo: CAMPO_POR_CLAVE[c.clave].tipo })) } };
}

/** Contenido que identifica una versión (para saber si al guardar hay que subir la versión). */
export const firmaPerfil = (p: PerfilImportacion) => JSON.stringify([p.columnas.map((c) => [c.clave, c.cabecera]), [...(p.adicionales ?? [])].sort(), p.ubicacion ?? null]);
