import type { BaseDatos } from './db';
import { claveCalle, normalizar } from './text';
import type { MotivoSinLocal, PlanIncorporacion } from './incorporacion';
import type { ResultadoInterpretacion, ValorOriginal } from './xlsx/interpretacion';
import type { InformeEstructural } from './xlsx/analisis';
import { TIPOS_INCIDENCIA } from './xlsx/reglasInterpretacion';
import type { Id } from './types';

/**
 * C1e · Vista previa de la incorporación del censo real: lo que se ve ANTES de confirmar.
 *
 * El diagnóstico agregado se calcula sobre la capa ORIGINAL (los valores tal como vienen en el
 * archivo, sin interpretar) y se compara con el informe agregado facilitado por la Cátedra. No
 * contiene filas, nombres de negocio ni direcciones individuales: solo recuentos.
 */

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

const vacia = (o?: ValorOriginal) => !o || o.t === 'vacio' || (o.t === 'texto' && !o.v.trim());
const texto = (o?: ValorOriginal) => (!o || o.t === 'vacio' ? '' : o.t === 'fecha' ? o.v : String(o.v));
const esNum = (o: ValorOriginal | undefined, n: number) => !!o && ((o.t === 'numero' && o.v === n) || (o.t === 'texto' && o.v.trim() === String(n)));

export interface Indicador {
  clave: string;
  etiqueta: string;
  valor: number | string;
  esperado?: number | string;
  coincide?: boolean;
}

export interface DiagnosticoAgregado {
  hoja: string;
  hojas: { nombre: string; rol: string; usada: boolean }[];
  indicadores: Indicador[];
  diferencias: Indicador[];
}

/** Año de una fecha ORIGINAL (fecha de Excel o número de serie); `null` si es texto u otra cosa. */
function anioOriginal(o?: ValorOriginal): number | null {
  if (!o) return null;
  if (o.t === 'fecha') return Number(o.v.slice(0, 4));
  if (o.t === 'numero' && o.v > 0 && o.v < 2958466) return new Date(Date.UTC(1899, 11, 30) + Math.floor(o.v) * 86400000).getUTCFullYear();
  return null;
}

/** Diagnóstico agregado de la capa original, comparado con el informe de la Cátedra. */
export function diagnosticoAgregado(resultado: ResultadoInterpretacion & { estructura?: InformeEstructural }, esperado = INFORME_AGREGADO_MEDINA_2025): DiagnosticoAgregado {
  const capa = resultado.original;
  const filas = capa.filas;
  const c = (f: (typeof filas)[number], k: string) => f.celdas[k];
  const ind: Indicador[] = [];
  const add = (clave: string, etiqueta: string, valor: number | string, esp?: number | string) =>
    ind.push({ clave, etiqueta, valor, ...(esp !== undefined ? { esperado: esp, coincide: valor === esp } : {}) });

  add('filas', 'Filas de datos', filas.length, esperado.filas);
  add('columnas', 'Columnas reconocidas del perfil', capa.columnas.length, esperado.columnas);
  add('hoja', 'Hoja de datos', capa.hoja, esperado.hojaDatos);

  const vac = { ocupado: 0, vacio: 0, sinValor: 0, otros: 0 };
  for (const f of filas) {
    const o = c(f, 'vacio');
    if (vacia(o)) vac.sinValor++;
    else if (esNum(o, 0)) vac.ocupado++;
    else if (esNum(o, 1)) vac.vacio++;
    else vac.otros++;
  }
  add('vacio-0', '«Local Vacío» = 0 (ocupado)', vac.ocupado, esperado.localVacio.ocupado);
  add('vacio-1', '«Local Vacío» = 1 (vacío)', vac.vacio, esperado.localVacio.vacio);
  add('vacio-sin', '«Local Vacío» sin valor', vac.sinValor, esperado.localVacio.sinValor);
  if (vac.otros) add('vacio-otros', '«Local Vacío» con otro valor', vac.otros, 0);

  const gr = { comercio: 0, servicios: 0, hosteleria: 0, vacio: 0, otros: 0 };
  const variantesHost = new Set<string>();
  for (const f of filas) {
    const t = texto(c(f, 'grupoActividad')).trim();
    const n = normalizar(t);
    if (!t) gr.vacio++;
    else if (n === 'comercio') gr.comercio++;
    else if (n === 'servicios') gr.servicios++;
    else if (n.startsWith('hosteleria')) { gr.hosteleria++; variantesHost.add(t); }
    else gr.otros++;
  }
  add('gr-comercio', 'GrActividad: Comercio', gr.comercio, esperado.grActividad.comercio);
  add('gr-servicios', 'GrActividad: Servicios', gr.servicios, esperado.grActividad.servicios);
  add('gr-hosteleria', 'GrActividad: Hostelería y restauración', gr.hosteleria, esperado.grActividad.hosteleria);
  add('gr-hosteleria-variantes', 'Variantes de escritura de Hostelería', variantesHost.size, esperado.grActividad.variantesHosteleria);
  add('gr-vacio', 'GrActividad vacía', gr.vacio, esperado.grActividad.vacio);
  if (gr.otros) add('gr-otros', 'GrActividad con otro valor', gr.otros, 0);

  const fe = { a2024: 0, a2025: 0, otrosAnios: 0, texto: 0, vacias: 0 };
  for (const f of filas) {
    const o = c(f, 'fecha');
    const a = anioOriginal(o);
    if (vacia(o)) fe.vacias++;
    else if (a === 2024) fe.a2024++;
    else if (a === 2025) fe.a2025++;
    else if (a !== null) fe.otrosAnios++;
    else fe.texto++;
  }
  add('fechas-2024', 'Fechas de 2024', fe.a2024, esperado.fechas.anio2024);
  add('fechas-2025', 'Fechas de 2025', fe.a2025, esperado.fechas.anio2025);
  add('fechas-texto', 'Fechas en texto o no reconocidas', fe.texto, esperado.fechas.textoInvalido);
  if (fe.vacias) add('fechas-vacias', 'Sin fecha', fe.vacias, 0);
  if (fe.otrosAnios) add('fechas-otros', 'Fechas de otros años', fe.otrosAnios, 0);

  const literales = new Set(filas.map((f) => texto(c(f, 'direccion'))).filter((t) => t.trim()));
  add('calles-literales', 'Denominaciones de calle distintas (literales)', literales.size, esperado.calles.literales);
  add('calles-mayusculas', 'Distintas al igualar mayúsculas y minúsculas', new Set([...literales].map((t) => t.toLocaleLowerCase('es'))).size, esperado.calles.sinMayusculas);

  const cps = new Map<string, number>();
  for (const f of filas) { const t = texto(c(f, 'cp')).trim(); cps.set(t, (cps.get(t) ?? 0) + 1); }
  add('cp', `Filas con CP ${esperado.cp.valor}`, cps.get(esperado.cp.valor) ?? 0, esperado.cp.filas);
  if (cps.size > 1) add('cp-otros', 'Filas con otro CP o sin CP', filas.length - (cps.get(esperado.cp.valor) ?? 0), 0);

  add('sin-numero', 'Filas sin número de portal', filas.filter((f) => vacia(c(f, 'numero'))).length, esperado.sinNumero);
  const pares = new Map<string, number>();
  for (const f of filas) {
    if (vacia(c(f, 'direccion')) || vacia(c(f, 'numero'))) continue;
    const k = `${texto(c(f, 'direccion'))}\u0000${texto(c(f, 'numero'))}`;
    pares.set(k, (pares.get(k) ?? 0) + 1);
  }
  const rep = [...pares.values()].filter((n) => n > 1);
  add('pares', 'Pares calle + número distintos', pares.size, esperado.direcciones.pares);
  add('pares-repetidos', 'Pares que aparecen más de una vez', rep.length, esperado.direcciones.paresRepetidos);
  add('registros-mismo-portal', 'Registros en portales compartidos (locales independientes)', rep.reduce((a, n) => a + n, 0), esperado.direcciones.registrosEnRepetidos);

  add('vacios-sin-fachada', 'Locales vacíos sin «Long fachada» (m lineales)', filas.filter((f) => esNum(c(f, 'vacio'), 1) && vacia(c(f, 'fachada'))).length, esperado.vaciosSinFachada);
  add('ocupados-sin-actividad', 'Locales ocupados sin «Actividad»', filas.filter((f) => esNum(c(f, 'vacio'), 0) && vacia(c(f, 'actividad'))).length, esperado.ocupadosSinActividad);

  const fr = { ceros: 0, unos: 0, vacios: 0, otros: 0 };
  for (const f of filas) {
    const o = c(f, 'franquicia');
    if (vacia(o)) fr.vacios++;
    else if (esNum(o, 0)) fr.ceros++;
    else if (esNum(o, 1)) fr.unos++;
    else fr.otros++;
  }
  add('franquicia-0', 'Franquicia = 0', fr.ceros, esperado.franquicia.ceros);
  add('franquicia-1', 'Franquicia = 1', fr.unos, esperado.franquicia.unos);
  add('franquicia-vacia', 'Franquicia vacía', fr.vacios, esperado.franquicia.vacios);
  if (fr.otros) add('franquicia-otros', 'Franquicia con otro valor', fr.otros, 0);

  const hojas = (resultado.estructura?.hojas ?? []).map((h) => ({ nombre: h.nombre, rol: h.rol, usada: h.nombre === capa.hoja }));
  return { hoja: capa.hoja, hojas, indicadores: ind, diferencias: ind.filter((i) => i.coincide === false) };
}

// ───────────── Recuento de registros antes de confirmar ─────────────

export interface RecuentoRegistros {
  total: number;
  /** Registros que se incorporarán (todas las filas; 0 si el plan está bloqueado). */
  preparados: number;
  /** Con local físico (dirección inequívoca o decisión registrada). */
  vinculados: number;
  /** Conservados sin local, pendientes de conciliar (calle sin correspondencia, sin número…). */
  pendientes: number;
  pendientesPorMotivo: Partial<Record<MotivoSinLocal, number>>;
  /** Excluidos de la aplicación operativa por decisión (el registro se conserva igualmente). */
  excluidos: number;
  /** Filas que NO se pueden incorporar porque el plan está bloqueado (todas o ninguna). */
  bloqueados: number;
  motivosBloqueo: string[];
}

export function recuentoRegistros(plan: PlanIncorporacion): RecuentoRegistros {
  const c = plan.correspondencias;
  const total = plan.registros.previstos;
  return {
    total,
    preparados: plan.aplicable ? total : 0,
    vinculados: (c.inequivoca ?? 0) + (c.decidida ?? 0),
    pendientes: (c.ambigua ?? 0) + (c['sin-vinculo'] ?? 0),
    pendientesPorMotivo: c.porMotivo,
    excluidos: c.excluida ?? 0,
    bloqueados: plan.aplicable ? 0 : total,
    motivosBloqueo: plan.bloqueos.flatMap((b) => [b.mensaje, ...b.detalles]),
  };
}

// ───────────── Conciliación de denominaciones de calle ─────────────

export type EstadoCalle = 'literal' | 'normalizada' | 'ambigua' | 'pendiente' | 'vacia';
export const ESTADO_CALLE_TXT: Record<EstadoCalle, string> = {
  literal: 'Coincidencia exacta (literal)',
  normalizada: 'Coincidencia exacta tras normalizar (mayúsculas, tildes, tipo de vía y artículos)',
  ambigua: 'Ambigua: coincide con varias calles',
  pendiente: 'Pendiente de conciliar: no está en el callejero',
  vacia: 'Sin denominación',
};

export interface DenominacionCalle {
  literal: string;
  filas: number;
  estado: EstadoCalle;
  calleId?: Id;
  calle?: string;
}

/**
 * Cada denominación LITERAL del archivo frente al callejero del municipio. No se inventa ni se
 * aproxima ninguna correspondencia: lo que no coincide queda pendiente de conciliar (el registro
 * se conserva sin vínculo territorial).
 */
export function conciliacionCalles(db: BaseDatos, resultado: ResultadoInterpretacion, municipioId: Id): { denominaciones: DenominacionCalle[]; porEstado: Record<EstadoCalle, { denominaciones: number; filas: number }> } {
  const porClave = new Map<string, Id[]>();
  for (const c of Object.values(db.calles)) if (c.municipioId === municipioId) porClave.set(claveCalle(c.nombre), [...(porClave.get(claveCalle(c.nombre)) ?? []), c.id]);
  const m = new Map<string, DenominacionCalle>();
  for (const f of resultado.original.filas) {
    const lit = texto(f.celdas.direccion);
    const d = m.get(lit);
    if (d) { d.filas++; continue; }
    if (!lit.trim()) { m.set(lit, { literal: lit, filas: 1, estado: 'vacia' }); continue; }
    const ids = porClave.get(claveCalle(lit)) ?? [];
    const calle = ids.length === 1 ? db.calles[ids[0]] : undefined;
    const estado: EstadoCalle = ids.length > 1 ? 'ambigua' : !calle ? 'pendiente' : calle.nombre === lit ? 'literal' : 'normalizada';
    m.set(lit, { literal: lit, filas: 1, estado, ...(calle ? { calleId: calle.id, calle: calle.nombre } : {}) });
  }
  const denominaciones = [...m.values()].sort((a, b) => ['pendiente', 'ambigua', 'vacia', 'normalizada', 'literal'].indexOf(a.estado) - ['pendiente', 'ambigua', 'vacia', 'normalizada', 'literal'].indexOf(b.estado) || b.filas - a.filas || a.literal.localeCompare(b.literal, 'es'));
  const porEstado = Object.fromEntries((['literal', 'normalizada', 'ambigua', 'pendiente', 'vacia'] as EstadoCalle[]).map((e) => [e, { denominaciones: 0, filas: 0 }])) as Record<EstadoCalle, { denominaciones: number; filas: number }>;
  for (const d of denominaciones) { porEstado[d.estado].denominaciones++; porEstado[d.estado].filas += d.filas; }
  return { denominaciones, porEstado };
}

// ───────────── Señales que no eliminan registros ─────────────

/** Lo que hay que señalar (números ausentes, datos incompletos, fachadas sin medir, clasificaciones pendientes). */
export function senales(resultado: ResultadoInterpretacion): { tipo: string; titulo: string; gravedad: string; filas: number }[] {
  const m = new Map<string, Set<number>>();
  for (const i of resultado.incidencias) m.set(i.tipo, (m.get(i.tipo) ?? new Set()).add(i.fila));
  return [...m.entries()].map(([tipo, filas]) => ({ tipo, titulo: TIPOS_INCIDENCIA[tipo as keyof typeof TIPOS_INCIDENCIA]?.titulo ?? tipo, gravedad: TIPOS_INCIDENCIA[tipo as keyof typeof TIPOS_INCIDENCIA]?.gravedad ?? 'info', filas: filas.size }))
    .sort((a, b) => ({ error: 0, aviso: 1, info: 2 } as Record<string, number>)[a.gravedad] - ({ error: 0, aviso: 1, info: 2 } as Record<string, number>)[b.gravedad] || b.filas - a.filas);
}
