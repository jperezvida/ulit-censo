import type { BaseDatos } from './db';
import { ErrorDominio } from './db';
import { aplicarIncorporacion, deshacerIncorporacion, type DecisionesIncorporacion, type DestinoIncorporacion, type PlanIncorporacion, type ResultadoIncorporacion } from './incorporacion';
import { prepararIncorporacion } from './incorporacionXlsx';
import { libroEscenarioMedina, MUNICIPIO_DEMO } from '../data/escenarioIncorporacion';
import { mostrarOriginal, type ResultadoInterpretacion } from './xlsx/interpretacion';
import { TIPOS_INCIDENCIA, REGLAS, type Gravedad, type IdTipoIncidencia } from './xlsx/reglasInterpretacion';
import { CATEGORIA_DIAGNOSTICO, ETIQUETA_DIAGNOSTICO, type DiagnosticoClasificacion } from './xlsx/clasificacionHistorica';
import { DISCREPANCIAS_2026 } from './catalogo2026';
import { rutaActividad, TAXONOMIA_POR_ID } from './taxonomy';
import { normalizar } from './text';
import type { ColeccionIncorporada, Id } from './types';

/**
 * C1d · Incorporación controlada en modo DEMOSTRACIÓN.
 *
 * Límite técnico: la interfaz solo puede incorporar escenarios GENERADOS por la propia
 * aplicación. No hay ninguna vía para pasar un archivo subido por el usuario a la aplicación al
 * modelo: el origen se identifica por un `escenarioId` del registro siguiente y, antes de aplicar,
 * se comprueba que el SHA-256 del plan coincide con el del libro que genera la aplicación y que el
 * destino es el municipio ficticio del escenario. El análisis previo de archivos (C1a/C1b) sigue
 * existiendo, pero es de solo lectura.
 *
 * Reutiliza estrictamente C1c: `prepararIncorporacion`, `planificarIncorporacion` (dentro),
 * `aplicarIncorporacion` y `deshacerIncorporacion`.
 */

export interface EscenarioDemo {
  id: string;
  nombre: string;
  archivo: string;
  municipioId: Id;
  aniosPermitidos: number[];
  descripcion: string;
  generar: () => Promise<Uint8Array>;
}

export const ESCENARIOS_DEMO: Record<string, EscenarioDemo> = {
  'medina-2025-ficticio': {
    id: 'medina-2025-ficticio',
    nombre: 'Censo histórico ficticio de Medina del Campo 2025',
    archivo: 'censo_medina_2025_ficticio_c1d.xlsx',
    municipioId: MUNICIPIO_DEMO.id,
    aniosPermitidos: [2025, 2024, 2023],
    descripcion: '889 registros ficticios en 93 vías («VÍA FICTICIA nnn»), con las anomalías habituales de los censos históricos y una fila de totales. Generado por la aplicación: no procede de ningún archivo real.',
    generar: libroEscenarioMedina,
  },
};

const memoria = new Map<string, Promise<Uint8Array>>();
/** Bytes del escenario, generados UNA vez por sesión y solo en memoria (nunca se guardan). */
function bytesEscenario(id: string): Promise<Uint8Array> {
  const e = ESCENARIOS_DEMO[id];
  if (!e) throw new ErrorDominio('regla', 'Solo se pueden incorporar los escenarios ficticios de demostración.');
  if (!memoria.has(id)) memoria.set(id, e.generar());
  return memoria.get(id)!;
}

async function sha256Archivo(b: Uint8Array): Promise<string> {
  const h = await globalThis.crypto.subtle.digest('SHA-256', b as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function destinoEscenario(escenarioId: string, anio: number, nombre?: string): DestinoIncorporacion {
  const e = ESCENARIOS_DEMO[escenarioId];
  if (!e) throw new ErrorDominio('regla', 'Escenario desconocido.');
  if (!e.aniosPermitidos.includes(anio)) throw new ErrorDominio('regla', `Año no disponible para este escenario: ${anio}.`);
  return { municipioId: e.municipioId, anio, ...(nombre?.trim() ? { nombre: nombre.trim() } : {}) };
}

/** Analiza el escenario (C1a + C1b con las decisiones recibidas) y construye el plan (C1c). */
export async function prepararEscenario(db: BaseDatos, escenarioId: string, anio: number, decisiones: DecisionesIncorporacion, nombre?: string) {
  const e = ESCENARIOS_DEMO[escenarioId];
  if (!e) throw new ErrorDominio('regla', 'Escenario desconocido.');
  if (!db.municipios[e.municipioId]?.escenarioDemo) throw new ErrorDominio('regla', 'Primero hay que preparar el municipio ficticio del escenario.');
  return prepararIncorporacion(db, await bytesEscenario(escenarioId), e.archivo, destinoEscenario(escenarioId, anio, nombre), decisiones);
}

/**
 * Aplica la incorporación del escenario. Comprueba que el archivo del plan es EXACTAMENTE el libro
 * generado por la aplicación (SHA-256) y que el destino es el municipio ficticio; después,
 * `aplicarIncorporacion` recalcula el plan y exige su firma.
 */
export async function aplicarEscenario(
  db: BaseDatos, escenarioId: string, anio: number, resultado: ResultadoInterpretacion, decisiones: DecisionesIncorporacion, plan: PlanIncorporacion, porId: Id, nombre?: string,
): Promise<ResultadoIncorporacion> {
  const e = ESCENARIOS_DEMO[escenarioId];
  if (!e) throw new ErrorDominio('regla', 'Solo se pueden incorporar los escenarios ficticios de demostración.');
  const sha = await sha256Archivo(await bytesEscenario(escenarioId));
  if (plan.archivo.sha256 !== sha || resultado.original.archivo.sha256 !== sha) {
    throw new ErrorDominio('bloqueado', 'Solo se pueden incorporar los escenarios ficticios generados por la aplicación: el archivo no coincide con el del escenario.');
  }
  const destino = destinoEscenario(escenarioId, anio, nombre);
  if (plan.municipio.id !== e.municipioId || !db.municipios[e.municipioId]?.escenarioDemo) {
    throw new ErrorDominio('bloqueado', 'La incorporación de demostración solo puede aplicarse al municipio ficticio del escenario.');
  }
  return aplicarIncorporacion(db, resultado, destino, decisiones, plan, { porId });
}

// ───────────── Revisión por grupos ─────────────

export type EstadoRevision = 'resuelto' | 'revisar' | 'catedra' | 'no-aplica' | 'bloqueante';

export const ESTADO_REVISION_TXT: Record<EstadoRevision, string> = {
  resuelto: 'Resuelto',
  revisar: 'Pendiente de revisar',
  catedra: 'Pendiente de la Cátedra',
  'no-aplica': 'No aplicable',
  bloqueante: 'Bloqueante',
};

/** Motivos de correspondencia del plan, presentados como grupos de revisión. */
export const MOTIVO_TXT: Record<string, { titulo: string; explicacion: string; decidible: boolean }> = {
  // Solo para planes anteriores a la corrección C1c-1 (hoy el mismo portal crea locales distintos).
  'direccion-repetida-en-archivo': { titulo: 'Misma dirección en varias filas (criterio anterior)', explicacion: 'Plan calculado con el criterio anterior a C1c-1: vuelva a analizar el archivo; hoy cada fila es un local físico distinto del mismo portal.', decidible: true },
  'local-existente-en-direccion': { titulo: 'Ya existe un local en esa dirección', explicacion: 'Puede ser el mismo local o no: no se elige automáticamente.', decidible: true },
  'sin-numero': { titulo: 'Dirección «S/N»', explicacion: 'Sin número no hay dirección inequívoca: no se crea local salvo decisión.', decidible: true },
  'numero-desconocido': { titulo: 'Número desconocido', explicacion: 'El registro se conserva sin vínculo para revisarlo más adelante.', decidible: false },
  'calle-sin-correspondencia': { titulo: 'Calle sin correspondencia en el callejero', explicacion: 'No se inventa la calle: el registro se conserva sin vínculo.', decidible: false },
  'calle-ambigua': { titulo: 'Calle ambigua', explicacion: 'El nombre coincide con varias calles: el registro se conserva sin vínculo.', decidible: false },
  'estado-local-desconocido': { titulo: 'No se sabe si el local está vacío', explicacion: '«Local Vacío» falta o no es 0/1: no se deduce y queda pendiente.', decidible: false },
};

export interface ItemRevision {
  clave: string;
  fila: number;
  grupo: string;
  titulo: string;
  categoria: 'valor' | 'correspondencia' | 'clasificacion' | 'fila';
  gravedad: Gravedad | 'pendiente';
  estado: EstadoRevision;
  columna?: string;
  cabecera?: string;
  original?: string;
  interpretacion?: string;
  regla?: string;
  reglaTxt?: string;
  mensaje: string;
  propuesta: string;
  calle?: string;
  numero?: string;
  negocio?: string;
}

const CLASIFICACION = new Set<IdTipoIncidencia>(['clasificacion-incompleta', 'clasificacion-incoherente', 'servicios-actividad-ejemplo', 'servicios-actividad-no-prevista', 'clasificacion-fuera-de-lista']);

function valorTexto(v: unknown): string {
  if (v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (v && typeof v === 'object') {
    const p = v as { tipo: string; numero?: number; sufijo?: string };
    return p.tipo === 'sin-numero' ? 'Sin número (S/N)' : `${p.numero}${p.sufijo ? ` ${p.sufijo}` : ''}`;
  }
  if (v === 'sin-informacion') return 'Sin información';
  return String(v);
}

/**
 * Lista de revisión: incidencias de C1b y filas sin correspondencia segura del plan, con su
 * estado de revisión según las decisiones registradas.
 */
export function itemsRevision(resultado: ResultadoInterpretacion, plan: PlanIncorporacion, decisiones: DecisionesIncorporacion): ItemRevision[] {
  const excluidas = new Set((decisiones.exclusiones ?? []).map((e) => e.fila));
  const decididas = new Set((decisiones.correspondencias ?? []).map((c) => c.fila));
  const equivalencias = new Set((decisiones.equivalenciasClasificacion ?? []).map((q) => claveCombo(q.grupo, q.grupoComercio, q.subgrupo, q.actividad)));
  const porFila = new Map(resultado.filas.map((f) => [f.fila, f]));
  const orig = new Map(resultado.original.filas.map((f) => [f.fila, f]));
  const datosFila = (fila: number) => {
    const c = porFila.get(fila)?.celdas;
    const t = (k: string) => (c?.[k]?.valor !== undefined ? valorTexto(c[k].valor) : orig.get(fila)?.celdas[k] ? mostrarOriginal(orig.get(fila)!.celdas[k]) : undefined);
    return { calle: t('direccion'), numero: t('numero'), negocio: t('nombre') };
  };
  const items: ItemRevision[] = [];
  resultado.incidencias.forEach((i, n) => {
    const tipo = TIPOS_INCIDENCIA[i.tipo];
    const celda = porFila.get(i.fila)?.celdas[i.campo];
    let estado: EstadoRevision;
    const f = porFila.get(i.fila);
    const comboOk = CLASIFICACION.has(i.tipo) && f && equivalencias.has(claveCombo(...comboDe(f)));
    if (excluidas.has(i.fila)) estado = 'no-aplica';
    else if (comboOk) estado = 'resuelto';
    else if (tipo.decision === 'catedra') estado = 'catedra';
    else if (tipo.gravedad === 'info' && tipo.decision === 'informativa') estado = 'no-aplica';
    else estado = 'revisar';
    items.push({
      clave: `inc-${n}`, fila: i.fila, grupo: i.tipo, titulo: tipo.titulo, categoria: CLASIFICACION.has(i.tipo) ? 'clasificacion' : i.tipo === 'posible-fila-de-totales' ? 'fila' : 'valor',
      gravedad: celda?.estado === 'pendiente' ? 'pendiente' : i.gravedad, estado, columna: i.columna, cabecera: i.cabecera, original: i.valorOriginal,
      interpretacion: celda ? `${celda.estado}${celda.valor !== undefined ? ` · ${valorTexto(celda.valor)}` : ''}${celda.propuesta !== undefined ? ` · propuesta: ${valorTexto(celda.propuesta)}` : ''}` : undefined,
      regla: celda?.regla ?? i.regla, reglaTxt: REGLAS[celda?.regla ?? i.regla ?? '']?.descripcion, mensaje: i.mensaje, propuesta: i.propuesta, ...datosFila(i.fila),
    });
  });
  for (const pf of plan.filas) {
    if (!pf.motivo) continue;
    const m = MOTIVO_TXT[pf.motivo];
    items.push({
      clave: `cor-${pf.fila}`, fila: pf.fila, grupo: `correspondencia:${pf.motivo}`, titulo: m.titulo, categoria: 'correspondencia', gravedad: 'aviso',
      estado: excluidas.has(pf.fila) ? 'no-aplica' : decididas.has(pf.fila) ? 'resuelto' : 'revisar',
      mensaje: m.explicacion, propuesta: m.decidible ? 'Decidir en «Correspondencias» o dejar pendiente.' : 'Queda sin vínculo para revisión posterior.', ...datosFila(pf.fila),
    });
  }
  for (const b of plan.bloqueos) items.push({ clave: `bloq-${b.codigo}`, fila: 0, grupo: `bloqueo:${b.codigo}`, titulo: 'Bloqueo del plan', categoria: 'fila', gravedad: 'error', estado: 'bloqueante', mensaje: b.mensaje, propuesta: b.detalles.join(' · ') });
  return items;
}

export interface FiltroRevision {
  gravedades?: (Gravedad | 'pendiente')[];
  estados?: EstadoRevision[];
  grupo?: string;
  texto?: string;
}

export function filtrarRevision(items: ItemRevision[], f: FiltroRevision): ItemRevision[] {
  const q = f.texto ? normalizar(f.texto) : '';
  return items.filter((i) =>
    (!f.gravedades?.length || f.gravedades.includes(i.gravedad))
    && (!f.estados?.length || f.estados.includes(i.estado))
    && (!f.grupo || i.grupo === f.grupo)
    && (!q || String(i.fila) === q || [i.calle, i.numero, i.negocio].some((t) => t && normalizar(t).includes(q))),
  );
}

export interface GrupoRevision {
  grupo: string;
  titulo: string;
  categoria: ItemRevision['categoria'];
  gravedad: ItemRevision['gravedad'];
  total: number;
  porEstado: Record<EstadoRevision, number>;
}

const ORDEN_GRAVEDAD = { error: 0, pendiente: 1, aviso: 2, info: 3 } as const;

export function agruparRevision(items: ItemRevision[]): GrupoRevision[] {
  const m = new Map<string, GrupoRevision>();
  for (const i of items) {
    const g = m.get(i.grupo) ?? { grupo: i.grupo, titulo: i.titulo, categoria: i.categoria, gravedad: i.gravedad, total: 0, porEstado: { resuelto: 0, revisar: 0, catedra: 0, 'no-aplica': 0, bloqueante: 0 } };
    g.total++;
    g.porEstado[i.estado]++;
    if (ORDEN_GRAVEDAD[i.gravedad] < ORDEN_GRAVEDAD[g.gravedad]) g.gravedad = i.gravedad;
    m.set(i.grupo, g);
  }
  return [...m.values()].sort((a, b) => ORDEN_GRAVEDAD[a.gravedad] - ORDEN_GRAVEDAD[b.gravedad] || b.total - a.total);
}

// ───────────── Reglas pendientes (decisiones de la Cátedra) ─────────────

export interface ReglaPendiente {
  regla: string;
  descripcion: string;
  decision?: string;
  celdas: { fila: number; cabecera: string; original: string; propuesta: string; estado: string }[];
}

/** Reglas de clase «propuesta» con celdas afectadas (pendientes o ya transformadas por autorización). */
export function reglasPropuestas(resultado: ResultadoInterpretacion): ReglaPendiente[] {
  const cab = new Map(resultado.original.columnas.map((c) => [c.clave, c.cabecera.trim()]));
  const orig = new Map(resultado.original.filas.map((f) => [f.fila, f.celdas]));
  const out = new Map<string, ReglaPendiente>();
  for (const f of resultado.filas) {
    for (const [k, c] of Object.entries(f.celdas)) {
      const r = REGLAS[c.regla];
      if (r?.clase !== 'propuesta' || c.regla === 'diccionario-sin-informacion' || c.regla === 'fecha-fuera-de-campana' || c.regla === 'cp-distinto-del-fijo') continue;
      const x = out.get(r.id) ?? { regla: r.id, descripcion: r.descripcion, decision: r.decision, celdas: [] };
      x.celdas.push({ fila: f.fila, cabecera: cab.get(k) ?? k, original: mostrarOriginal(orig.get(f.fila)?.[k] ?? { t: 'vacio' }), propuesta: valorTexto(c.estado === 'pendiente' ? c.propuesta : c.valor), estado: c.estado });
      out.set(r.id, x);
    }
  }
  return [...out.values()];
}

/** Textos candidatos a «sin información», cada uno por separado (nunca se aprueba uno por otro). */
export function textosDiccionario(resultado: ResultadoInterpretacion): { texto: string; celdas: { fila: number; cabecera: string }[] }[] {
  const cab = new Map(resultado.original.columnas.map((c) => [c.clave, c.cabecera.trim()]));
  const orig = new Map(resultado.original.filas.map((f) => [f.fila, f.celdas]));
  const out = new Map<string, { texto: string; celdas: { fila: number; cabecera: string }[] }>();
  for (const f of resultado.filas) {
    for (const [k, c] of Object.entries(f.celdas)) {
      if (c.regla !== 'diccionario-sin-informacion') continue;
      const o = orig.get(f.fila)?.[k];
      if (o?.t !== 'texto') continue;
      const t = normalizar(o.v);
      const x = out.get(t) ?? { texto: o.v.trim(), celdas: [] };
      x.celdas.push({ fila: f.fila, cabecera: cab.get(k) ?? k });
      out.set(t, x);
    }
  }
  return [...out.values()];
}

// ───────────── Clasificación histórica ─────────────

export const claveCombo = (g?: string, gc?: string, sg?: string, act?: string) => [g, gc, sg, act].map((x) => normalizar(x ?? '')).join('|');
const txt = (c?: { estado: string; valor?: unknown }) => (c && (c.estado === 'valido' || c.estado === 'transformado') ? String(c.valor) : undefined);
export function comboDe(f: ResultadoInterpretacion['filas'][number]): [string | undefined, string | undefined, string | undefined, string | undefined] {
  return [txt(f.celdas.grupoActividad), txt(f.celdas.grupoComercio), txt(f.celdas.subgrupo), txt(f.celdas.actividad)];
}

export interface ComboHistorico {
  clave: string;
  grupo?: string;
  grupoComercio?: string;
  subgrupo?: string;
  actividad?: string;
  /** Las descripciones se conservan por fila; aquí solo cuántas filas la tienen. */
  conDescripcion: number;
  diagnostico: DiagnosticoClasificacion;
  categoria: string;
  etiqueta: string;
  filas: number[];
}

export function combinacionesHistoricas(resultado: ResultadoInterpretacion): ComboHistorico[] {
  const m = new Map<string, ComboHistorico>();
  for (const f of resultado.filas) {
    if (!f.clasificacion) continue;
    const [g, gc, sg, act] = comboDe(f);
    const clave = claveCombo(g, gc, sg, act);
    const x = m.get(clave) ?? { clave, grupo: g, grupoComercio: gc, subgrupo: sg, actividad: act, conDescripcion: 0, diagnostico: f.clasificacion.diagnostico, categoria: CATEGORIA_DIAGNOSTICO[f.clasificacion.diagnostico], etiqueta: ETIQUETA_DIAGNOSTICO[f.clasificacion.diagnostico], filas: [] };
    x.filas.push(f.fila);
    if (txt(f.celdas.descripcionActividad)) x.conDescripcion++;
    m.set(clave, x);
  }
  return [...m.values()].sort((a, b) => b.filas.length - a.filas.length);
}

/**
 * Discrepancias del catálogo 2026 (D01–D14) y excepciones ICM que afectan a un nodo: mientras la
 * Cátedra no las resuelva, no se registra una equivalencia hacia ese nodo.
 */
const CLAVES_DISCREPANCIA: Record<string, (ruta: string[]) => boolean> = {
  D01: (r) => r.some((n) => normalizar(n) === 'otros equipamientos'),
  D02: (r) => r.some((n) => normalizar(n) === 'grandes almacenes'),
  D03: (r) => r.some((n) => normalizar(n) === 'internacional'),
  D04: (r) => r.some((n) => ['albergue', 'pisos turisticos'].includes(normalizar(n))),
  D05: (r) => r.some((n) => normalizar(n) === 'mascotas'),
  D06: (r) => r.some((n) => normalizar(n) === 'almacenaje y guardamuebles'),
  D07: (r) => r.some((n) => normalizar(n) === 'complementos'),
  D08: (r) => normalizar(r[0] ?? '') === 'hosteleria y restauracion' && normalizar(r[r.length - 1]) === 'otros',
  D09: (r) => r.some((n) => ['iluminacion y electricidad', 'proveedor'].includes(normalizar(n))),
  D10: (r) => r.some((n) => normalizar(n).startsWith('moda infantil')),
  D11: (r) => normalizar(r[0] ?? '') === 'servicios',
  D12: (r) => r.some((n) => ['supermercados', 'hipermercados'].includes(normalizar(n))),
  D13: (r) => r.some((n) => ['farmacias', 'salud'].includes(normalizar(n))),
  D14: (r) => r.some((n) => normalizar(n) === 'productos delicatesen'),
};

export function pendientesDeNodo(nodoId: Id): string[] {
  const ruta = rutaActividad(nodoId).map((n) => n.nombre);
  const out = DISCREPANCIAS_2026.filter((d) => CLAVES_DISCREPANCIA[d.id]?.(ruta)).map((d) => `${d.id} · ${d.tema}`);
  if (rutaActividad(nodoId).some((n) => n.excepcion)) out.push('Excepción ICM pendiente de confirmar');
  if (!TAXONOMIA_POR_ID[nodoId]) out.push('Nodo inexistente');
  return out;
}

// ───────────── Deshacer: vista previa ─────────────

export interface VistaDeshacer {
  importacionId: Id;
  archivo: string;
  campana?: string;
  eliminara: Partial<Record<ColeccionIncorporada, number>>;
  conservara: string[];
  conflictos: string[];
  permitido: boolean;
}

/** Qué eliminaría deshacer y qué trazabilidad quedaría; ensaya el deshacer sin aplicar nada. */
export function previsualizarDeshacer(db: BaseDatos, importacionId: Id, porId: Id): VistaDeshacer {
  const imp = db.importaciones[importacionId];
  const eliminara = Object.fromEntries(Object.entries(imp?.c1?.creadas ?? {}).map(([k, v]) => [k, Object.keys(v ?? {}).length])) as VistaDeshacer['eliminara'];
  const campana = imp?.campanaId ? db.campanas[imp.campanaId] : undefined;
  const conflictos: string[] = [];
  if (!imp?.c1) conflictos.push('No es una incorporación controlada (C1c/C1d).');
  else if (imp.estado !== 'confirmada') conflictos.push('Esta incorporación ya se deshizo.');
  if (campana && (campana.estados.validacion === 'terminado' || campana.estados.revision === 'terminado')) conflictos.push(`La campaña «${campana.nombre}» está revisada o validada: no se modifica.`);
  if (!conflictos.length) {
    try {
      deshacerIncorporacion(db, importacionId, porId);
    } catch (e) {
      conflictos.push(...(e instanceof ErrorDominio ? [e.message, ...e.detalles] : [String(e)]));
    }
  }
  return {
    importacionId, archivo: imp?.archivo ?? '', campana: campana?.nombre, eliminara, conflictos, permitido: conflictos.length === 0,
    conservara: [
      'El registro de la importación, marcado como «deshecha», con quién y cuándo la deshizo, la huella del archivo, el perfil y las decisiones aplicadas.',
      'El contador global de orden no retrocede: ningún número se reutiliza.',
      'Todo lo que no creó esta incorporación queda intacto.',
    ],
  };
}

/** Persona autorizada para registrar decisiones de la Cátedra y confirmar (coordinación o administración). */
export function puedeDecidir(roles: string[]): boolean {
  return roles.includes('coordinador') || roles.includes('administrador');
}
