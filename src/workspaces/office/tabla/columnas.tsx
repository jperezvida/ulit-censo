import type { ReactNode } from 'react';
import { kNC, type BaseDatos } from '../../../domain/db';
import { actualizarRevisiones, editarNegocio, type FilaOficina } from '../../../domain/oficina';
import { clasificar } from '../../../domain/clasificacion';
import { DEF_VARIABLE, VARIABLES_DIGITALES, esExigible, registrarDatoDigital } from '../../../domain/digital';
import { TIPO_OBS_TXT } from '../../../domain/campo';
import { nivelesDe } from '../../../domain/taxonomy';
import { resolverTexto, rutaTexto, textoClasificacion } from '../../../domain/buscador';
import { catalogoDeCampana } from '../../../domain/clasificacion';
import { normalizar } from '../../../domain/text';
import type { Alcance } from '../../../domain/bloqueo';
import type { Id, Respuesta, VariableDigital } from '../../../domain/types';
import type { Tarea } from '../tareas';

/**
 * Columnas de la tabla de revisión rápida.
 *
 * Cada columna sabe mostrarse, copiarse (texto plano), interpretar lo que se teclea o se pega
 * y aplicarlo con una operación de DOMINIO (que comprueba bloqueo y alcance). Las respuestas
 * rápidas 1/0 y las acciones masivas de B5, o el catálogo y el autocompletado de B4, se añaden
 * como nuevos tipos de editor o columnas sin cambiar la tabla.
 */

export interface CtxCelda {
  db: BaseDatos;
  campanaId: Id;
  personaId: Id;
  alcance?: Alcance;
  bloqueado: boolean;
}

export type TipoEditor = 'texto' | 'numero' | 'respuesta' | 'actividad' | 'booleano';

export interface Columna {
  id: string;
  titulo: string;
  ancho: number;
  /** Calle, número y negocio quedan fijados por defecto. */
  fijaPorDefecto?: boolean;
  editor?: TipoEditor;
  /** Texto de la celda (lo que se muestra y lo que se copia). */
  texto: (f: FilaOficina, c: CtxCelda) => string;
  /** Presentación enriquecida opcional. */
  render?: (f: FilaOficina, c: CtxCelda) => ReactNode;
  /** null = editable; si no, el motivo por el que no lo es. */
  bloqueo?: (f: FilaOficina, c: CtxCelda) => string | null;
  /** Interpreta lo tecleado o pegado. Lanza Error con un mensaje claro si no es válido. */
  parse?: (t: string, f: FilaOficina, c: CtxCelda) => unknown;
  /** Aplica el valor con una operación de dominio (pura). */
  aplicar?: (db: BaseDatos, f: FilaOficina, valor: unknown, c: CtxCelda) => BaseDatos;
  /** Atenuar la celda (p. ej. variable digital no exigible con las respuestas actuales). */
  atenuada?: (f: FilaOficina, c: CtxCelda) => boolean;
  /** Ordenación por esta columna. */
  orden?: (a: FilaOficina, b: FilaOficina, c: CtxCelda) => number;
}

// ───────────── Reglas comunes de edición ─────────────

function bloqueoBase(f: FilaOficina, c: CtxCelda): string | null {
  if (c.bloqueado || f.bloqueado) return 'Itinerario con la revisión cerrada: solo lectura';
  if (f.situacion === 'pendiente-visita') return 'Pendiente de visitar en campo';
  return null;
}
const bloqueoNegocio = (f: FilaOficina, c: CtxCelda) => bloqueoBase(f, c) ?? (f.vacio || !f.negocioId ? 'Local vacío: no aplica' : null);

// ───────────── Intérpretes ─────────────

export function parseRespuesta(t: string): Respuesta {
  const s = normalizar(t).replace(/\s+/g, '');
  if (['', '·', 'pendiente', '-'].includes(s)) return 'pendiente';
  if (['si', 's', '1', '1.0', '1,0', 'x', 'true'].includes(s)) return 'si';
  if (['no', 'n', '0', '0.0', '0,0', 'false'].includes(s)) return 'no';
  if (['na', 'n/a', 'noaplica', 'noaplicable'].includes(s)) return 'na';
  if (['?', '¿?', 'sininfo', 'sininformacion', 'sin-info'].includes(s)) return 'sin-info';
  throw new Error(`«${t}» no es una respuesta válida (sí, no, N/A, ¿?, vacío)`);
}

const RESP_CORTA: Record<Respuesta, string> = { si: 'Sí', no: 'No', na: 'N/A', 'sin-info': '¿?', pendiente: '' };

export function parseNumeroDigital(t: string): { respuesta: Respuesta; valor?: number } {
  const crudo = t.trim().replace(/\s+/g, '');
  if (crudo === '') return { respuesta: 'pendiente' };
  // «1.250» y «1.250,5» (miles con punto) · «4,5» y «4.5» (decimales)
  const s = crudo.includes(',') ? crudo.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(crudo) ? crudo.replace(/\./g, '') : crudo;
  const r = normalizar(t).replace(/\s+/g, '');
  if (['na', 'n/a', 'noaplica'].includes(r)) return { respuesta: 'na' };
  if (['?', '¿?', 'sininfo'].includes(r)) return { respuesta: 'sin-info' };
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`«${t}» no es un número`);
  return { respuesta: 'si', valor: n };
}

/**
 * Interpreta una actividad tecleada o pegada en el catálogo de la campaña: nombre único, ruta
 * completa o «… · descripción». Si es ambigua o no existe, se rechaza (nunca se elige al azar).
 */
export function parseActividad(t: string, c: CtxCelda): { nodoId: Id; descripcion?: string } {
  return resolverTexto(catalogoDeCampana(c.db, c.campanaId), t);
}

function parseBooleano(t: string): boolean {
  const s = normalizar(t);
  if (['si', 's', '1', 'x', 'true'].includes(s)) return true;
  if (['no', 'n', '0', '', 'false'].includes(s)) return false;
  throw new Error(`«${t}» no es sí/no`);
}

// ───────────── Columnas ─────────────

const porTexto = (col: Columna) => (a: FilaOficina, b: FilaOficina, c: CtxCelda) => col.texto(a, c).localeCompare(col.texto(b, c), 'es', { numeric: true });

const COL_CALLE: Columna = {
  id: 'calle', titulo: 'Calle', ancho: 170, fijaPorDefecto: true, texto: (f) => f.calle,
  orden: (a, b) => a.calle.localeCompare(b.calle, 'es') || (a.numero ?? 9999) - (b.numero ?? 9999) || (a.sufijo ?? '').localeCompare(b.sufijo ?? ''),
};
const COL_NUMERO: Columna = {
  id: 'numero', titulo: 'Nº', ancho: 58, fijaPorDefecto: true, texto: (f) => `${f.numero ?? 's/n'}${f.sufijo ? ` ${f.sufijo}` : ''}`,
  orden: (a, b) => (a.numero ?? 9999) - (b.numero ?? 9999) || (a.sufijo ?? '').localeCompare(b.sufijo ?? '') || a.calle.localeCompare(b.calle, 'es'),
};
const COL_NOMBRE: Columna = {
  id: 'nombre', titulo: 'Establecimiento', ancho: 210, fijaPorDefecto: true, editor: 'texto',
  texto: (f) => (f.vacio ? '' : f.nombre),
  render: (f) => (f.vacio ? <span className="muted">Vacío{f.metros ? ` · ${f.metros} m` : ''}</span> : f.nombre),
  bloqueo: bloqueoNegocio,
  parse: (t) => {
    if (!t.trim()) throw new Error('El nombre comercial no puede quedar vacío');
    return t.trim();
  },
  aplicar: (db, f, v, c) => editarNegocio(db, c.campanaId, f.negocioId!, { nombre: v as string }, c.alcance),
};
const COL_SITUACION: Columna = {
  id: 'situacion', titulo: 'Campo', ancho: 120,
  texto: (f) => (f.situacion === 'pendiente-visita' ? 'Sin visitar' : f.obs ? TIPO_OBS_TXT[f.obs.tipo] : 'Registrado'),
  render: (f) => (f.situacion === 'pendiente-visita' ? <span className="chip">Sin visitar</span> : f.obs ? <span className={`of-obs t-${f.obs.tipo}`}>{TIPO_OBS_TXT[f.obs.tipo]}</span> : 'Registrado'),
};
const COL_ACTIVIDAD: Columna = {
  id: 'actividad', titulo: 'Actividad', ancho: 220, editor: 'actividad',
  // Texto ÚNICO (nombre o ruta si hay homónimos, « · descripción» si la hay) para que copiar y
  // pegar entre filas reproduzca la clasificación completa sin ambigüedad.
  texto: (f) => (f.vacio ? '' : textoClasificacion(f.actividadId, f.descripcion)),
  render: (f) =>
    f.vacio ? <span className="muted">—</span> : f.actividad ? (
      <span className={f.clasificacion && !f.clasificacion.confirmada ? 'tab-sin-confirmar' : ''} title={`${rutaTexto(f.actividadId!, f.descripcion)}${f.clasificacion && !f.clasificacion.confirmada ? ` · ${f.clasificacion.origen}: sin confirmar (Enter para confirmar)` : ''}`}>
        {f.actividad}{f.descripcion ? <span className="muted"> · {f.descripcion}</span> : null}{f.clasificacion && !f.clasificacion.confirmada ? ' *' : ''}
      </span>
    ) : <span className="tag naranja">sin clasificar</span>,
  bloqueo: bloqueoNegocio,
  parse: (t, _f, c) => parseActividad(t, c),
  aplicar: (db, f, v, c) => {
    const { nodoId, descripcion } = v as { nodoId: Id; descripcion?: string };
    // La descripción existente solo se conserva si se mantiene el mismo nodo.
    const desc = descripcion ?? (nodoId === f.actividadId ? f.descripcion : undefined);
    return clasificar(db, f.negocioId!, c.campanaId, nodoId, c.personaId, { alcance: c.alcance, descripcion: desc });
  },
};
const COL_GRUPO: Columna = { id: 'grupo', titulo: 'Grupo', ancho: 140, texto: (f) => (f.vacio ? '' : f.grupo ?? '') };
const COL_GRUPO_COMERCIO: Columna = { id: 'grupoComercio', titulo: 'Grupo de comercio', ancho: 150, texto: (f) => (f.vacio ? '' : nivelesDe(f.actividadId).grupoComercio?.nombre ?? '') };
const COL_SUBGRUPO: Columna = { id: 'subgrupo', titulo: 'Subgrupo', ancho: 170, texto: (f) => (f.vacio ? '' : nivelesDe(f.actividadId).subgrupo?.nombre ?? '') };
const COL_DESCRIPCION: Columna = {
  id: 'descripcion', titulo: 'Descripción', ancho: 180, editor: 'texto', texto: (f) => f.descripcion ?? '',
  bloqueo: (f, c) => bloqueoNegocio(f, c) ?? (!f.actividadId ? 'Asigna antes una actividad o un subgrupo' : null),
  parse: (t) => t.trim(),
  aplicar: (db, f, v, c) => clasificar(db, f.negocioId!, c.campanaId, f.actividadId!, c.personaId, { alcance: c.alcance, descripcion: (v as string) || undefined }),
};
const COL_CATEGORIZACION: Columna = {
  id: 'categorizacion', titulo: 'Categorización', ancho: 120,
  texto: (f) => (f.vacio ? 'No aplica' : f.rev.categorizacion === 'revisado' ? 'Revisada' : 'Pendiente'),
  render: (f) => (f.vacio ? <span className="muted">no aplica</span> : f.rev.categorizacion === 'revisado' ? <span className="chip ok">revisada</span> : <span className="chip aviso">pendiente</span>),
};
const COL_CADENA: Columna = {
  id: 'cadena', titulo: 'Cadena / franquicia', ancho: 180, editor: 'texto', texto: (f) => f.cadena ?? '',
  render: (f) => (f.vacio ? <span className="muted">—</span> : f.cadena ?? <span className="muted">Independiente</span>),
  bloqueo: bloqueoNegocio, parse: (t) => t.trim(),
  aplicar: (db, f, v, c) => editarNegocio(db, c.campanaId, f.negocioId!, { cadena: (v as string) || undefined }, c.alcance),
};
const COL_DIGITAL: Columna = {
  id: 'digitalEstado', titulo: 'Digital', ancho: 110,
  texto: (f) => ({ verificada: 'Verificada', borrador: 'Borrador', 'solo-historico': 'Solo histórico', 'sin-datos': 'Sin datos', 'no-aplica': 'No aplica' })[f.digital],
  render: (f) =>
    f.digital === 'verificada' ? <span className="chip ok">verificada</span> : f.digital === 'borrador' ? <span className="chip aviso">borrador</span> : f.digital === 'solo-historico' ? <span className="chip" title="Datos de una campaña anterior: solo referencia">solo histórico</span> : <span className="muted">{f.digital === 'no-aplica' ? '—' : 'sin datos'}</span>,
};
const COL_INCIDENCIAS: Columna = {
  id: 'incidencias', titulo: 'Incidencias', ancho: 240,
  texto: (f) => [...f.errores, ...f.incidencias].join(' · '),
  render: (f) => (
    <span className="tab-incid">
      {f.errores.map((e) => <span key={e} className="tag rojo">{e}</span>)}
      {f.incidencias.map((e) => <span key={e} className="tag morado">{e}</span>)}
    </span>
  ),
};
const COL_COMPROBAR: Columna = {
  id: 'comprobar', titulo: 'Pendiente de comprobar', ancho: 110, editor: 'booleano',
  texto: (f) => (f.rev.pendienteComprobacion ? 'Sí' : 'No'),
  bloqueo: (f, c) => (c.bloqueado || f.bloqueado ? 'Itinerario con la revisión cerrada: solo lectura' : f.cronologiaIncierta.length ? 'Asigna antes la fecha de los eventos inciertos' : null),
  parse: (t) => parseBooleano(t),
  aplicar: (db, f, v, c) => actualizarRevisiones(db, c.campanaId, [f.localId], { pendienteComprobacion: v as boolean }, c.alcance),
};
const COL_ITINERARIO: Columna = { id: 'itinerario', titulo: 'Itinerario', ancho: 90, texto: (f) => f.itinerario ?? '' };

function columnaDigital(v: VariableDigital): Columna {
  const def = DEF_VARIABLE[v];
  const dato = (f: FilaOficina, c: CtxCelda) => (f.negocioId ? c.db.digital[kNC(f.negocioId, c.campanaId)]?.datos[v] : undefined);
  return {
    id: `dig.${v}`, titulo: def.etiqueta, ancho: def.tipo === 'numero' ? 104 : 92, editor: def.tipo === 'numero' ? 'numero' : 'respuesta',
    texto: (f, c) => {
      const d = dato(f, c);
      if (!d) return '';
      if (def.tipo === 'numero' && d.respuesta === 'si') return d.valor === undefined ? '' : String(d.valor);
      return RESP_CORTA[d.respuesta];
    },
    render: (f, c) => {
      if (f.vacio) return <span className="muted">—</span>;
      const d = dato(f, c);
      const txt = d ? (def.tipo === 'numero' && d.respuesta === 'si' ? (d.valor ?? '').toLocaleString('es-ES') : RESP_CORTA[d.respuesta]) : '';
      return <span className={`tab-resp r-${d?.respuesta ?? 'pendiente'} ${d?.origen === 'heredado' ? 'heredado' : ''}`} title={d?.origen === 'heredado' ? 'Heredado sin confirmar' : undefined}>{txt || '·'}</span>;
    },
    atenuada: (f, c) => !f.vacio && !!f.negocioId && !esExigible(c.db.digital[kNC(f.negocioId, c.campanaId)], v),
    bloqueo: bloqueoNegocio,
    parse: (t) => {
      if (def.tipo === 'numero') return parseNumeroDigital(t);
      const r = parseRespuesta(t);
      if (r === 'na' && !def.admiteNa && !def.depende) throw new Error(`${def.etiqueta} no admite «no aplicable»`);
      return { respuesta: r };
    },
    aplicar: (db, f, val, c) => registrarDatoDigital(db, f.negocioId!, c.campanaId, v, val as { respuesta: Respuesta; valor?: number }, c.personaId, { alcance: c.alcance }),
  };
}

export const COLUMNAS: Columna[] = [
  COL_CALLE, COL_NUMERO, COL_NOMBRE, COL_SITUACION, COL_ACTIVIDAD, COL_DESCRIPCION, COL_GRUPO, COL_GRUPO_COMERCIO, COL_SUBGRUPO, COL_CATEGORIZACION,
  COL_CADENA, COL_DIGITAL, ...VARIABLES_DIGITALES.map((d) => columnaDigital(d.id)), COL_INCIDENCIAS, COL_COMPROBAR, COL_ITINERARIO,
];
for (const c of COLUMNAS) c.orden ??= porTexto(c);
export const COLUMNA_POR_ID: Record<string, Columna> = Object.fromEntries(COLUMNAS.map((c) => [c.id, c]));

/** Columnas por defecto de cada tarea (el usuario puede mostrar, ocultar y fijar). */
export const COLUMNAS_TAREA: Record<Tarea, string[]> = {
  categorizacion: ['calle', 'numero', 'nombre', 'actividad', 'descripcion', 'grupo', 'grupoComercio', 'subgrupo', 'categorizacion', 'incidencias'],
  franquicias: ['calle', 'numero', 'nombre', 'cadena', 'actividad', 'incidencias'],
  digital: ['calle', 'numero', 'nombre', 'digitalEstado', ...VARIABLES_DIGITALES.map((d) => `dig.${d.id}`)],
  incidencias: ['calle', 'numero', 'nombre', 'situacion', 'incidencias', 'comprobar', 'actividad', 'itinerario'],
  todos: ['calle', 'numero', 'nombre', 'situacion', 'actividad', 'categorizacion', 'cadena', 'digitalEstado', 'incidencias', 'itinerario'],
};

/** ¿Se puede editar la celda? Devuelve el motivo si no. */
export function motivoNoEditable(col: Columna, f: FilaOficina, c: CtxCelda): string | null {
  if (!col.editor || !col.aplicar) return 'Columna de solo lectura';
  return col.bloqueo?.(f, c) ?? null;
}

export interface CambioCelda {
  fila: FilaOficina;
  col: Columna;
  texto: string;
}

export class ErrorCeldas extends Error {
  constructor(mensaje: string, public celdas: { localId: Id; colId: string; motivo: string }[]) {
    super(mensaje);
  }
}

const ref = (f: FilaOficina, col: Columna) => `${f.calle} ${f.numero ?? 's/n'}${f.sufijo ? ` ${f.sufijo}` : ''} · ${col.titulo}`;

/**
 * Aplica un conjunto de cambios de celda de forma ATÓMICA: primero valida todas las celdas
 * (editable y valor interpretable); si alguna falla, no se aplica ninguna y se indica cuáles.
 * Después aplica las operaciones de dominio en orden; si el dominio rechaza una (bloqueo,
 * alcance, regla), se lanza y el resultado intermedio se descarta.
 */
export function aplicarCambiosCeldas(db: BaseDatos, cambios: CambioCelda[], c: CtxCelda): BaseDatos {
  const problemas: { localId: Id; colId: string; motivo: string }[] = [];
  const valores: unknown[] = [];
  for (const ch of cambios) {
    const motivo = motivoNoEditable(ch.col, ch.fila, c);
    if (motivo) {
      problemas.push({ localId: ch.fila.localId, colId: ch.col.id, motivo });
      continue;
    }
    try {
      valores.push(ch.col.parse ? ch.col.parse(ch.texto, ch.fila, c) : ch.texto);
    } catch (e) {
      problemas.push({ localId: ch.fila.localId, colId: ch.col.id, motivo: e instanceof Error ? e.message : String(e) });
    }
  }
  if (problemas.length) {
    const p = problemas[0];
    const ch = cambios.find((x) => x.fila.localId === p.localId && x.col.id === p.colId)!;
    throw new ErrorCeldas(
      `${problemas.length} celda(s) no válidas (${ref(ch.fila, ch.col)}: ${p.motivo}). No se ha aplicado ningún cambio${cambios.length > 1 ? ` de los ${cambios.length}` : ''}.`,
      problemas,
    );
  }
  let d = db;
  cambios.forEach((ch, i) => {
    try {
      d = ch.col.aplicar!(d, ch.fila, valores[i], { ...c, db: d });
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      throw new ErrorCeldas(`${ref(ch.fila, ch.col)}: ${motivo}. No se ha aplicado ningún cambio${cambios.length > 1 ? ` de los ${cambios.length}` : ''}.`, [{ localId: ch.fila.localId, colId: ch.col.id, motivo }]);
    }
  });
  return d;
}

/** Interpreta texto del portapapeles (TSV de Excel u hoja de cálculo) como matriz. */
export function parseTSV(t: string): string[][] {
  const limpio = t.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return limpio.split('\n').map((l) => l.split('\t'));
}

export function aTSV(m: string[][]): string {
  return m.map((r) => r.map((x) => x.replace(/[\t\n]/g, ' ')).join('\t')).join('\n');
}

