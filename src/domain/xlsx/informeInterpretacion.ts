import { CATEGORIA_DIAGNOSTICO, type DiagnosticoClasificacion } from './clasificacionHistorica';
import type { EstadoValor, ResultadoInterpretacion, ValorOriginal } from './interpretacion';
import { REGLAS, TIPOS_INCIDENCIA, type Decision, type Gravedad, type IdTipoIncidencia, type Regla } from './reglasInterpretacion';

/**
 * C1b · Informe AGREGADO y EXPORTABLE de una interpretación.
 *
 * Privacidad: no reproduce NINGÚN texto libre de las celdas, en ninguna columna (un nombre puede
 * estar por error en cualquier columna). Cada incidencia se exporta con su tipo, columna y
 * referencia de fila; el mensaje se construye con el título fijo del tipo y un detalle que solo
 * contiene números validados, fechas, cabeceras del perfil, números de fila y códigos. Del valor
 * original solo se exporta su clase (texto, número…) y, si es un número corto o una fecha, el valor.
 * Los valores íntegros siguen en la capa original, que no se exporta.
 */

const IDENTIFICATIVOS = new Set(['nombre', 'direccion', 'descripcionActividad']);

/** Incidencia tal como se exporta: sin mensaje interno ni valor original textual. */
export interface IncidenciaExportable {
  archivo: string;
  hoja: string;
  fila: number;
  columna: string;
  cabecera: string;
  campo: string;
  tipo: IdTipoIncidencia;
  gravedad: Gravedad;
  decision: Decision;
  /** Título fijo del tipo + detalle seguro. */
  mensaje: string;
  propuesta: string;
  regla?: string;
  relacionadas?: string[];
  /** Clase del valor original; `valor` solo para números cortos, fechas, booleanos y códigos de error. */
  original: { clase: ValorOriginal['t']; valor?: number | string | boolean };
}

/** Un número de hasta 5 cifras enteras no identifica a nadie; uno más largo podría ser un teléfono. */
function originalExportable(o: ValorOriginal | undefined, campo: string): IncidenciaExportable['original'] {
  if (!o) return { clase: 'vacio' };
  if (IDENTIFICATIVOS.has(campo)) return { clase: o.t };
  switch (o.t) {
    case 'numero': return Math.abs(o.v) < 100000 ? { clase: 'numero', valor: o.v } : { clase: 'numero' };
    case 'fecha': return { clase: 'fecha', valor: o.v.slice(0, 10) };
    case 'booleano': return { clase: 'booleano', valor: o.v };
    case 'error': return /^#[A-Z0-9/!?¡¿.]{1,10}$/i.test(o.v) ? { clase: 'error', valor: o.v } : { clase: 'error' };
    default: return { clase: o.t };
  }
}

/**
 * Reglas de transformación cuyo original solo puede ser un patrón estricto (dígitos, «16 B»,
 * fechas…): su original sí puede exportarse. Cualquier otra transformación se exporta sin él.
 */
const ORIGINAL_ESTRICTO = new Set(['binario-texto-01', 'entero-texto', 'decimal-texto', 'portal-texto-entero', 'portal-sufijo', 'fecha-texto-dma', 'fecha-texto-iso', 'fachada-con-unidad', 'fecha-serial-sin-formato', 'fecha-anio-dos-cifras', 'cp-cuatro-cifras']);
const ESTADOS: EstadoValor[] = ['valido', 'transformado', 'vacio', 'no-aplica', 'pendiente', 'invalido'];
const vacioEstados = (): Record<EstadoValor, number> => Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<EstadoValor, number>;

export interface InformeInterpretacion {
  formato: 'ulit-censo/informe-interpretacion';
  version: 1;
  generado: string;
  archivo: { nombre: string; sha256?: string };
  hoja: string;
  perfil: { id: string; version: number };
  opciones: { municipio?: string; modo: 'historico' | 'campana-actual'; periodo?: { desde: string; hasta: string }; diccionarioAprobado: string[]; reglasAutorizadas: string[] };
  /** Todas las filas se conservan; las candidatas a excluir (posibles totales) están incluidas en `registros`. */
  filas: { registros: number; candidatasExcluir: { fila: number; motivo: string; confirmada: false }[]; locales: { vacio: number; ocupado: number; desconocido: number } };
  celdas: {
    total: number;
    porEstado: Record<EstadoValor, number>;
    /** Interpretadas sin necesidad de revisión (válidas, transformadas por regla explícita, vacías o no aplicables sin incidencia). */
    sinRevision: number;
    /** Inválidas, pendientes o con alguna incidencia de error o aviso. */
    requierenRevision: number;
  };
  columnas: { letra: string; cabecera: string; clave: string; porEstado: Record<EstadoValor, number>; revision: number; reglas: Record<string, number> }[];
  incidencias: {
    total: number;
    porGravedad: Record<Gravedad, number>;
    porDecision: Record<Decision, number>;
    porTipo: { tipo: IdTipoIncidencia; titulo: string; gravedad: Gravedad; decision: Decision; propuesta: string; n: number; columnas: string[] }[];
    lista: IncidenciaExportable[];
  };
  reglas: (Regla & { aplicaciones: number })[];
  transformaciones: { fila: number; columna: string; regla: string; original?: string; resultado?: string }[];
  clasificacion: { diagnosticadas: number; porCategoria: Record<string, number>; porDiagnostico: Partial<Record<DiagnosticoClasificacion, number>>; confirmadas: 0 };
  redes: { calculables: number; coinciden: number; discrepan: number; noCalculables: number };
  direccionesRepetidas: { grupos: number; filas: number };
  decisionesPendientes: { decision: string; descripcion: string; celdas: number }[];
  garantias: string[];
}

const mostrar = (v: unknown) => (v === undefined ? undefined : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function informeInterpretacion(res: ResultadoInterpretacion, municipio?: string): InformeInterpretacion {
  const { original: capa, filas, incidencias, opciones } = res;
  const porFila = new Map(capa.filas.map((f) => [f.fila, f]));
  const porEstado = vacioEstados();
  const columnas = capa.columnas.map((c) => ({ letra: c.letra, cabecera: c.cabecera, clave: c.clave, porEstado: vacioEstados(), revision: 0, reglas: {} as Record<string, number> }));
  const aplicaciones: Record<string, number> = {};
  const transformaciones: InformeInterpretacion['transformaciones'] = [];
  let total = 0;
  let revision = 0;
  const locales = { vacio: 0, ocupado: 0, desconocido: 0 };
  const redes = { calculables: 0, coinciden: 0, discrepan: 0, noCalculables: 0 };
  const porDiagnostico: Partial<Record<DiagnosticoClasificacion, number>> = {};
  const porCategoria: Record<string, number> = {};
  const grupos = new Set<number>();
  let filasRepetidas = 0;

  filas.forEach((fi, i) => {
    locales[fi.local]++;
    capa.columnas.forEach((col, j) => {
      const c = fi.celdas[col.clave];
      if (!c) return;
      total++;
      porEstado[c.estado]++;
      columnas[j].porEstado[c.estado]++;
      columnas[j].reglas[c.regla] = (columnas[j].reglas[c.regla] ?? 0) + 1;
      aplicaciones[c.regla] = (aplicaciones[c.regla] ?? 0) + 1;
      if (c.revision) {
        revision++;
        columnas[j].revision++;
      }
      if (c.estado === 'transformado') {
        const o = capa.filas[i].celdas[col.clave];
        const ident = IDENTIFICATIVOS.has(col.clave);
        const exportable = !ident && ORIGINAL_ESTRICTO.has(c.regla);
        transformaciones.push({ fila: fi.fila, columna: col.letra, regla: c.regla, original: exportable ? (o?.t === 'texto' ? o.v : mostrar(o && 'v' in o ? o.v : undefined)) : undefined, resultado: exportable ? mostrar(c.valor) : undefined });
      }
    });
    if (fi.celdas.numRedes && fi.local !== 'vacio') {
      if (fi.redesCalculadas === null) redes.noCalculables++;
      else {
        redes.calculables++;
        if (fi.celdas.numRedes.regla === 'redes-coincide') redes.coinciden++;
        if (fi.celdas.numRedes.regla === 'redes-discrepa') redes.discrepan++;
      }
    }
    if (fi.clasificacion) {
      porDiagnostico[fi.clasificacion.diagnostico] = (porDiagnostico[fi.clasificacion.diagnostico] ?? 0) + 1;
      const cat = CATEGORIA_DIAGNOSTICO[fi.clasificacion.diagnostico];
      porCategoria[cat] = (porCategoria[cat] ?? 0) + 1;
    }
    if (fi.grupoDireccion) {
      grupos.add(fi.grupoDireccion);
      filasRepetidas++;
    }
  });

  const porGravedad: Record<Gravedad, number> = { error: 0, aviso: 0, info: 0 };
  const porDecision: Record<Decision, number> = { catedra: 0, revision: 0, informativa: 0 };
  const tipos = new Map<IdTipoIncidencia, { n: number; columnas: Set<string> }>();
  for (const i of incidencias) {
    porGravedad[i.gravedad]++;
    porDecision[i.decision]++;
    const t = tipos.get(i.tipo) ?? { n: 0, columnas: new Set() };
    t.n++;
    t.columnas.add(i.cabecera);
    tipos.set(i.tipo, t);
  }

  const decisiones = new Map<string, number>();
  for (const [id, n] of Object.entries(aplicaciones)) {
    const reg = REGLAS[id];
    if (reg?.decision) decisiones.set(reg.decision, (decisiones.get(reg.decision) ?? 0) + n);
  }
  const fachadaOcupado = incidencias.filter((i) => i.tipo === 'fachada-en-ocupado').length;
  if (fachadaOcupado) decisiones.set('2', (decisiones.get('2') ?? 0) + fachadaOcupado);
  const servicios = incidencias.filter((i) => i.tipo === 'servicios-actividad-ejemplo' || i.tipo === 'servicios-actividad-no-prevista').length;
  if (servicios) decisiones.set('3', servicios);
  const DESC: Record<string, string> = {
    '1': 'Diccionario de equivalencias («sin dato», «s/i»…)',
    '2': 'Medidas con unidad («3,5 m») y fachada en locales ocupados',
    '3': 'Correspondencias de clasificación 2025 → 2026 (Servicios y valores fuera de lista)',
    'informática 2': 'Tipo y dominio de los códigos territoriales y postales',
  };

  return {
    formato: 'ulit-censo/informe-interpretacion', version: 1, generado: new Date().toISOString(),
    archivo: capa.archivo, hoja: capa.hoja, perfil: capa.perfil,
    opciones: { municipio, modo: opciones.modo ?? 'historico', periodo: opciones.periodo, diccionarioAprobado: opciones.diccionarioAprobado ?? [], reglasAutorizadas: opciones.reglasAutorizadas ?? [] },
    filas: { registros: filas.length, candidatasExcluir: capa.candidatasExcluir.map(({ fila, motivo }) => ({ fila, motivo, confirmada: false as const })), locales },
    celdas: { total, porEstado, sinRevision: total - revision, requierenRevision: revision },
    columnas,
    incidencias: {
      total: incidencias.length, porGravedad, porDecision,
      porTipo: [...tipos].map(([tipo, x]) => ({ tipo, ...TIPOS_INCIDENCIA[tipo], n: x.n, columnas: [...x.columnas] })).sort((a, b) => b.n - a.n),
      lista: incidencias.map((i) => ({
        archivo: i.archivo, hoja: i.hoja, fila: i.fila, columna: i.columna, cabecera: i.cabecera, campo: i.campo, tipo: i.tipo, gravedad: i.gravedad, decision: i.decision,
        mensaje: i.detalle ? `${TIPOS_INCIDENCIA[i.tipo].titulo}: ${i.detalle}` : TIPOS_INCIDENCIA[i.tipo].titulo,
        propuesta: i.propuesta, ...(i.regla ? { regla: i.regla } : {}), ...(i.relacionadas ? { relacionadas: i.relacionadas } : {}),
        original: originalExportable(porFila.get(i.fila)?.celdas[i.campo], i.campo),
      })),
    },
    reglas: Object.entries(aplicaciones).map(([id, n]) => ({ ...(REGLAS[id] ?? { id, clase: 'estado' as const, descripcion: id, respaldo: 'especificacion-c1b' as const }), aplicaciones: n })).sort((a, b) => b.aplicaciones - a.aplicaciones),
    transformaciones,
    clasificacion: { diagnosticadas: filas.filter((f) => f.clasificacion).length, porCategoria, porDiagnostico, confirmadas: 0 },
    redes,
    direccionesRepetidas: { grupos: grupos.size, filas: filasRepetidas },
    decisionesPendientes: [...decisiones].map(([decision, celdas]) => ({ decision, descripcion: DESC[decision] ?? decision, celdas })),
    garantias: [
      'Solo lectura: no se ha importado ningún registro, no se han creado locales ni modificado campañas, y el archivo no se ha guardado.',
      'Ningún valor original se ha perdido ni modificado: la capa original se conserva aparte de la interpretada.',
      'La ausencia de información no se ha convertido en No, en 0 ni en una fecha inventada.',
      'Las reglas pendientes de la Cátedra no se han aplicado salvo autorización expresa en las opciones.',
      'La franquicia y la presencia digital importadas de 2025 no verifican las de 2026; ninguna clasificación histórica se ha confirmado ni reasignado al catálogo 2026.',
      'Las direcciones repetidas se conservan como filas distintas; no se ha fusionado ni creado ningún local.',
      'El informe no reproduce ningún texto libre de las celdas (en ninguna columna): solo tipos de incidencia, columnas, números de fila, números validados y fechas.',
      'Las posibles filas de totales se conservan íntegras; su exclusión queda pendiente de una decisión humana explícita y trazada.',
    ],
  };
}
