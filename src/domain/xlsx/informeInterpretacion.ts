import { CATEGORIA_DIAGNOSTICO, type DiagnosticoClasificacion } from './clasificacionHistorica';
import type { EstadoValor, Incidencia, ResultadoInterpretacion } from './interpretacion';
import { REGLAS, TIPOS_INCIDENCIA, type Decision, type Gravedad, type IdTipoIncidencia, type Regla } from './reglasInterpretacion';

/**
 * C1b · Informe AGREGADO de una interpretación. Pensado para compartirse: no incluye nombres de
 * negocio, direcciones ni descripciones (sus valores originales se omiten en las incidencias y en
 * el registro de transformaciones). Conserva archivo, hoja, fila y columna de cada incidencia.
 */

const IDENTIFICATIVOS = new Set(['nombre', 'direccion', 'descripcionActividad']);
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
  filas: { registros: number; excluidas: { fila: number; motivo: string }[]; locales: { vacio: number; ocupado: number; desconocido: number } };
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
    lista: (Omit<Incidencia, 'valorOriginal'> & { valorOriginal?: string })[];
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
        transformaciones.push({ fila: fi.fila, columna: col.letra, regla: c.regla, original: ident ? undefined : o?.t === 'texto' ? o.v : mostrar(o && 'v' in o ? o.v : undefined), resultado: ident ? undefined : mostrar(c.valor) });
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
    filas: { registros: filas.length, excluidas: capa.excluidas, locales },
    celdas: { total, porEstado, sinRevision: total - revision, requierenRevision: revision },
    columnas,
    incidencias: {
      total: incidencias.length, porGravedad, porDecision,
      porTipo: [...tipos].map(([tipo, x]) => ({ tipo, ...TIPOS_INCIDENCIA[tipo], n: x.n, columnas: [...x.columnas] })).sort((a, b) => b.n - a.n),
      lista: incidencias.map(({ valorOriginal, ...i }) => (IDENTIFICATIVOS.has(i.campo) ? i : { ...i, valorOriginal })),
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
      'El informe no contiene nombres de negocio, direcciones ni descripciones.',
    ],
  };
}
