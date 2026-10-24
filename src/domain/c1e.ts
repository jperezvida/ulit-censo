import type { BaseDatos } from './db';
import { claveCalle, normalizar } from './text';
import type { DecisionesIncorporacion, MotivoSinLocal, PlanIncorporacion } from './incorporacion';
import { proponer, type DenominacionPendiente } from './conciliacionCalles';
import { claveDenominacion, denominacionCalle, type ResultadoInterpretacion, type ValorOriginal } from './xlsx/interpretacion';
import type { InformeEstructural } from './xlsx/analisis';
import { TIPOS_INCIDENCIA } from './xlsx/reglasInterpretacion';
import type { InformeAgregado } from './xlsx/referencias';
import { INFORME_AGREGADO_MEDINA_2025 } from './xlsx/referencias';
import type { Id } from './types';

/**
 * C1e · Vista previa de la incorporación del censo real: lo que se ve ANTES de confirmar.
 *
 * El diagnóstico agregado se calcula sobre la capa ORIGINAL (los valores tal como vienen en el
 * archivo, sin interpretar) y se compara con el informe agregado facilitado por la Cátedra. No
 * contiene filas, nombres de negocio ni direcciones individuales: solo recuentos.
 */

export { INFORME_AGREGADO_MEDINA_2025 };

const vacia = (o?: ValorOriginal) => !o || o.t === 'vacio' || (o.t === 'texto' && !o.v.trim());
const texto = (o?: ValorOriginal) => (!o || o.t === 'vacio' ? '' : o.t === 'fecha' ? o.v : String(o.v));
const esNum = (o: ValorOriginal | undefined, n: number) => !!o && ((o.t === 'numero' && o.v === n) || (o.t === 'texto' && o.v.trim() === String(n)));

export interface Indicador {
  clave: string;
  etiqueta: string;
  /** Cómo se cuenta (cuando no es evidente). */
  nota?: string;
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

/**
 * Diagnóstico agregado de la capa original. Solo se compara con indicadores ESPERADOS cuando se
 * reciben (perfil de un censo concreto, `referenciaAplicable`): con cualquier otro archivo se muestran
 * los recuentos sin compararlos. Solo se calculan los indicadores de las columnas presentes.
 */
export function diagnosticoAgregado(resultado: ResultadoInterpretacion & { estructura?: InformeEstructural }, esperado?: InformeAgregado): DiagnosticoAgregado {
  const e = <T,>(f: (x: InformeAgregado) => T): T | undefined => (esperado ? f(esperado) : undefined);
  const capa = resultado.original;
  const filas = capa.filas;
  const c = (f: (typeof filas)[number], k: string) => f.celdas[k];
  const ind: Indicador[] = [];
  const add = (clave: string, etiqueta: string, valor: number | string, esp?: number | string, nota?: string) =>
    ind.push({ clave, etiqueta, valor, ...(nota ? { nota } : {}), ...(esp !== undefined ? { esperado: esp, coincide: valor === esp } : {}) });

  add('filas', 'Filas de datos', filas.length, e((x) => x.filas));
  add('columnas', 'Columnas reconocidas del perfil', capa.columnas.length, e((x) => x.columnas));
  add('hoja', 'Hoja de datos', capa.hoja, e((x) => x.hojaDatos));

  const vac = { ocupado: 0, vacio: 0, sinValor: 0, otros: 0 };
  for (const f of filas) {
    const o = c(f, 'vacio');
    if (vacia(o)) vac.sinValor++;
    else if (esNum(o, 0)) vac.ocupado++;
    else if (esNum(o, 1)) vac.vacio++;
    else vac.otros++;
  }
  add('vacio-0', '«Local Vacío» = 0 (ocupado)', vac.ocupado, e((x) => x.localVacio.ocupado));
  add('vacio-1', '«Local Vacío» = 1 (vacío)', vac.vacio, e((x) => x.localVacio.vacio));
  add('vacio-sin', '«Local Vacío» sin valor', vac.sinValor, e((x) => x.localVacio.sinValor));
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
  add('gr-comercio', 'GrActividad: Comercio', gr.comercio, e((x) => x.grActividad.comercio));
  add('gr-servicios', 'GrActividad: Servicios', gr.servicios, e((x) => x.grActividad.servicios));
  add('gr-hosteleria', 'GrActividad: Hostelería y restauración', gr.hosteleria, e((x) => x.grActividad.hosteleria));
  add('gr-hosteleria-variantes', 'Variantes de escritura de Hostelería', variantesHost.size, e((x) => x.grActividad.variantesHosteleria));
  add('gr-vacio', 'GrActividad vacía', gr.vacio, e((x) => x.grActividad.vacio));
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
  add('fechas-2024', 'Fechas de 2024', fe.a2024, e((x) => x.fechas.anio2024));
  add('fechas-2025', 'Fechas de 2025', fe.a2025, e((x) => x.fechas.anio2025));
  add('fechas-texto', 'Fechas en texto o no reconocidas', fe.texto, e((x) => x.fechas.textoInvalido));
  if (fe.vacias) add('fechas-vacias', 'Sin fecha', fe.vacias, 0);
  if (fe.otrosAnios) add('fechas-otros', 'Fechas de otros años', fe.otrosAnios, 0);

  const literales = new Set(filas.map((f) => texto(c(f, 'direccion'))).filter((t) => t.trim()));
  add('calles-literales', 'Denominaciones de calle distintas (literales)', literales.size, e((x) => x.calles.literales));
  add('calles-mayusculas', 'Distintas al igualar mayúsculas y minúsculas', new Set([...literales].map((t) => t.toLocaleLowerCase('es'))).size, e((x) => x.calles.sinMayusculas));

  const cps = new Map<string, number>();
  for (const f of filas) { const t = texto(c(f, 'cp')).trim(); cps.set(t, (cps.get(t) ?? 0) + 1); }
  const cpRef = e((x) => x.cp.valor);
  if (cpRef !== undefined) {
    add('cp', `Filas con CP ${cpRef}`, cps.get(cpRef) ?? 0, e((x) => x.cp.filas));
    if (cps.size > 1) add('cp-otros', 'Filas con otro CP o sin CP', filas.length - (cps.get(cpRef) ?? 0), 0);
  } else add('cp-distintos', 'Códigos postales distintos', [...cps.keys()].filter((k) => k).length);

  add('sin-numero', 'Filas sin número de portal', filas.filter((f) => vacia(c(f, 'numero'))).length, e((x) => x.sinNumero));
  // Portales: la calle se compara NORMALIZADA (sin distinguir mayúsculas ni espacios) y el número tal
  // como figura; los valores originales no se modifican. «S/N» se agrupa textualmente (como en el
  // informe de referencia), pero no identifica un portal numérico: se separa en dos recuentos.
  const grupos = (clave: (f: (typeof filas)[number]) => string | null) => {
    const m = new Map<string, number>();
    for (const f of filas) {
      const k = clave(f);
      if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
    }
    const rep = [...m.entries()].filter(([, n]) => n > 1);
    return { pares: m.size, repetidos: rep.length, registros: rep.reduce((a, [, n]) => a + n, 0), rep };
  };
  const conDireccion = (f: (typeof filas)[number]) => !vacia(c(f, 'direccion')) && !vacia(c(f, 'numero'));
  const numTxt = (f: (typeof filas)[number]) => texto(c(f, 'numero')).trim();
  const norm = grupos((f) => (conDireccion(f) ? `${claveDenominacion(texto(c(f, 'direccion')))}\u0000${numTxt(f)}` : null));
  const literal = grupos((f) => (conDireccion(f) ? `${texto(c(f, 'direccion'))}\u0000${texto(c(f, 'numero'))}` : null));
  const sn = norm.rep.filter(([k]) => /^s\s*\/\s*n\.?$/i.test(k.split('\u0000')[1]));
  const variantes = norm.pares !== literal.pares;
  add('pares', 'Pares calle + número distintos', norm.pares, e((x) => x.direcciones.pares), 'Calle normalizada (sin distinguir mayúsculas ni espacios); número tal como figura, incluido «S/N».');
  add('pares-repetidos', 'Pares que aparecen más de una vez', norm.repetidos, e((x) => x.direcciones.paresRepetidos));
  add('registros-mismo-portal', 'Registros en direcciones compartidas (recuento textual)', norm.registros, e((x) => x.direcciones.registrosEnRepetidos), 'Mismo criterio que el informe de referencia: incluye los «S/N» agrupados por calle.');
  add('registros-sn-agrupados', '· de ellos, «S/N» agrupados por calle (no identifican un portal)', sn.reduce((a, [, n]) => a + n, 0), undefined, sn.length ? `${sn.length} vía(s) con varios «S/N».` : undefined);
  add('registros-portal-numerico', '· de ellos, en portales NUMÉRICOS compartidos (regla de C1b)', resultado.filas.filter((f) => f.grupoDireccion).length, undefined, 'Locales independientes del mismo portal: se conservan todos, no se fusionan.');
  if (variantes) add('pares-literales', 'Pares sin normalizar la calle (solo informativo)', literal.pares, undefined, `Con la calle tal como está escrita: ${literal.registros} registros en direcciones compartidas. La diferencia se debe a grafías de una misma calle que solo difieren en mayúsculas o espacios.`);

  add('vacios-sin-fachada', 'Locales vacíos sin «Long fachada» (m lineales)', filas.filter((f) => esNum(c(f, 'vacio'), 1) && vacia(c(f, 'fachada'))).length, e((x) => x.vaciosSinFachada));
  add('ocupados-sin-actividad', 'Locales ocupados sin «Actividad»', filas.filter((f) => esNum(c(f, 'vacio'), 0) && vacia(c(f, 'actividad'))).length, e((x) => x.ocupadosSinActividad));

  const fr = { ceros: 0, unos: 0, vacios: 0, otros: 0 };
  for (const f of filas) {
    const o = c(f, 'franquicia');
    if (vacia(o)) fr.vacios++;
    else if (esNum(o, 0)) fr.ceros++;
    else if (esNum(o, 1)) fr.unos++;
    else fr.otros++;
  }
  add('franquicia-0', 'Franquicia = 0', fr.ceros, e((x) => x.franquicia.ceros));
  add('franquicia-1', 'Franquicia = 1', fr.unos, e((x) => x.franquicia.unos));
  add('franquicia-vacia', 'Franquicia vacía', fr.vacios, e((x) => x.franquicia.vacios));
  if (fr.otros) add('franquicia-otros', 'Franquicia con otro valor', fr.otros, 0);

  // Solo los indicadores de las columnas que tiene el archivo (un campo ausente no se cuenta como vacío).
  const tiene = (k: string) => capa.columnas.some((col) => col.clave === k);
  const DEPENDE: [RegExp, string[]][] = [
    [/^vacio-/, ['vacio']], [/^gr-/, ['grupoActividad']], [/^fechas-/, ['fecha']], [/^calles-/, ['direccion']], [/^cp/, ['cp']],
    [/^sin-numero$/, ['numero']], [/^(pares|registros-)/, ['direccion', 'numero']], [/^vacios-sin-fachada$/, ['vacio', 'fachada']],
    [/^ocupados-sin-actividad$/, ['vacio', 'actividad']], [/^franquicia-/, ['franquicia']],
  ];
  const presentes = ind.filter((i) => (DEPENDE.find(([re]) => re.test(i.clave))?.[1] ?? []).every(tiene));
  const hojas = (resultado.estructura?.hojas ?? []).map((h) => ({ nombre: h.nombre, rol: h.rol, usada: h.nombre === capa.hoja }));
  return { hoja: capa.hoja, hojas, indicadores: presentes, diferencias: presentes.filter((i) => i.coincide === false) };
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

export type EstadoCalle = 'literal' | 'normalizada' | 'conciliada' | 'ambigua' | 'pendiente' | 'sin-correspondencia' | 'vacia';
export const ESTADO_CALLE_TXT: Record<EstadoCalle, string> = {
  literal: 'Coincidencia exacta (literal)',
  normalizada: 'Coincidencia exacta tras normalizar (mayúsculas, tildes, tipo de vía y artículos)',
  conciliada: 'Conciliada por una persona (decisión trazada)',
  ambigua: 'Ambigua: coincide con varias calles',
  pendiente: 'Pendiente de conciliar: no está en el callejero',
  'sin-correspondencia': 'Sin correspondencia en el callejero (decidido; se conserva sin vínculo)',
  vacia: 'Sin denominación',
};
export const ORDEN_ESTADO_CALLE: EstadoCalle[] = ['pendiente', 'ambigua', 'vacia', 'sin-correspondencia', 'conciliada', 'normalizada', 'literal'];

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
 * se conserva sin vínculo territorial) salvo que una persona lo haya conciliado con una decisión trazada.
 */
export function conciliacionCalles(db: BaseDatos, resultado: ResultadoInterpretacion, municipioId: Id, decisiones: DecisionesIncorporacion = {}): { denominaciones: DenominacionCalle[]; porEstado: Record<EstadoCalle, { denominaciones: number; filas: number }> } {
  const porClave = new Map<string, Id[]>();
  for (const c of Object.values(db.calles)) if (c.municipioId === municipioId) porClave.set(claveCalle(c.nombre), [...(porClave.get(claveCalle(c.nombre)) ?? []), c.id]);
  const decididas = new Map((decisiones.calles ?? []).map((d) => [d.denominacion, d]));
  const m = new Map<string, DenominacionCalle>();
  const interpretadas = new Map(resultado.filas.map((fi) => [fi.fila, fi]));
  for (const f of resultado.original.filas) {
    const lit = denominacionCalle(f, interpretadas.get(f.fila));
    // Dirección completa sin separar: no hay calle que conciliar (el registro queda pendiente de vínculo).
    if (lit === undefined) continue;
    const d = m.get(lit);
    if (d) { d.filas++; continue; }
    if (!lit.trim()) { m.set(lit, { literal: lit, filas: 1, estado: 'vacia' }); continue; }
    const ids = porClave.get(claveCalle(lit)) ?? [];
    const calle = ids.length === 1 ? db.calles[ids[0]] : undefined;
    const dec = !ids.length ? decididas.get(lit) : undefined;
    const conciliada = dec?.accion === 'vincular' && db.calles[dec.calleId]?.municipioId === municipioId ? db.calles[dec.calleId] : undefined;
    const estado: EstadoCalle = ids.length > 1 ? 'ambigua' : calle ? (calle.nombre === lit ? 'literal' : 'normalizada') : conciliada ? 'conciliada' : dec?.accion === 'sin-correspondencia' ? 'sin-correspondencia' : 'pendiente';
    const destino = calle ?? conciliada;
    m.set(lit, { literal: lit, filas: 1, estado, ...(destino ? { calleId: destino.id, calle: destino.nombre } : {}) });
  }
  const denominaciones = [...m.values()].sort((a, b) => ORDEN_ESTADO_CALLE.indexOf(a.estado) - ORDEN_ESTADO_CALLE.indexOf(b.estado) || b.filas - a.filas || a.literal.localeCompare(b.literal, 'es'));
  const porEstado = Object.fromEntries(ORDEN_ESTADO_CALLE.map((e) => [e, { denominaciones: 0, filas: 0 }])) as Record<EstadoCalle, { denominaciones: number; filas: number }>;
  for (const d of denominaciones) { porEstado[d.estado].denominaciones++; porEstado[d.estado].filas += d.filas; }
  return { denominaciones, porEstado };
}

/** Denominaciones por conciliar (o ya decididas), con sus propuestas, de más a menos registros. */
export function denominacionesPorConciliar(db: BaseDatos, resultado: ResultadoInterpretacion, municipioId: Id, decisiones: DecisionesIncorporacion = {}): (DenominacionPendiente & { estado: EstadoCalle; calleId?: Id; calle?: string })[] {
  const calles = Object.values(db.calles).filter((c) => c.municipioId === municipioId);
  return conciliacionCalles(db, resultado, municipioId, decisiones).denominaciones
    .filter((d) => d.estado === 'pendiente' || d.estado === 'conciliada' || d.estado === 'sin-correspondencia')
    .map((d) => ({ ...d, denominacion: d.literal, ...proponer(d.literal, calles) }))
    .sort((a, b) => b.filas - a.filas || a.denominacion.localeCompare(b.denominacion, 'es'));
}

// ───────────── Señales que no eliminan registros ─────────────

/** Lo que hay que señalar (números ausentes, datos incompletos, fachadas sin medir, clasificaciones pendientes). */
export function senales(resultado: ResultadoInterpretacion): { tipo: string; titulo: string; gravedad: string; filas: number }[] {
  const m = new Map<string, Set<number>>();
  for (const i of resultado.incidencias) m.set(i.tipo, (m.get(i.tipo) ?? new Set()).add(i.fila));
  return [...m.entries()].map(([tipo, filas]) => ({ tipo, titulo: TIPOS_INCIDENCIA[tipo as keyof typeof TIPOS_INCIDENCIA]?.titulo ?? tipo, gravedad: TIPOS_INCIDENCIA[tipo as keyof typeof TIPOS_INCIDENCIA]?.gravedad ?? 'info', filas: filas.size }))
    .sort((a, b) => ({ error: 0, aviso: 1, info: 2 } as Record<string, number>)[a.gravedad] - ({ error: 0, aviso: 1, info: 2 } as Record<string, number>)[b.gravedad] || b.filas - a.filas);
}
