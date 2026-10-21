import type { BaseDatos } from './db';
import { ErrorDominio, kNC, siguienteOrden } from './db';
import { direccionVigente, anioDe } from './consultas';
import { claveCalle, normalizar } from './text';
import { huella } from '../data/rng';
import { sha256Texto } from './sha256';
import { TAXONOMIA_POR_ID, catalogoDeNodo } from './taxonomy';
import { CONFIG_TERRITORIAL } from './territorio';
import { REGLAS } from './xlsx/reglasInterpretacion';
import type { FilaInterpretada, OpcionesInterpretacion, Portal, ResultadoInterpretacion } from './xlsx/interpretacion';
import type {
  Campana, CeldaOriginal, ColeccionIncorporada, Confianza, DatoDigital, Id, Importacion, LocalFisico, Observacion, Ocupacion, RegistroOrigen,
  RevisionDigital, TrazaIncorporacion, VariableDigital, VinculoHistorico,
} from './types';

/**
 * C1c · Incorporación ATÓMICA y REVERSIBLE de un censo histórico (XLSX interpretado por C1b) al
 * modelo de ULIT Censo.
 *
 * 1. `planificarIncorporacion` construye un PLAN sin tocar nada: destino, registros, entidades
 *    nuevas, correspondencias (inequívocas, ambiguas, sin vínculo), incidencias, candidatas a
 *    excluir, decisiones aplicadas y bloqueos (reimportación, decisiones inválidas…).
 * 2. `aplicarIncorporacion` vuelve a calcular el plan (debe coincidir con el aprobado), aplica todo
 *    sobre una COPIA de trabajo, comprueba la integridad referencial y solo entonces devuelve la
 *    base nueva. Si algo falla, la base original queda intacta.
 * 3. `deshacerIncorporacion` retira exactamente lo creado, salvo que algo se haya modificado o
 *    referenciado después: entonces se bloquea y explica el conflicto.
 *
 * Principios: el histórico es una REFERENCIA. Se crea una campaña histórica propia; no se toca la
 * campaña 2026 ni ninguna otra; nada queda revisado, verificado, validado ni confirmado. Una fila
 * no es un local: solo se crea un local cuando la dirección es inequívoca; en cualquier otro caso
 * se conserva el registro y su observación sin local, con el vínculo pendiente de conciliación.
 * Las decisiones pendientes de la Cátedra no se inventan: solo se aplican las que se reciben
 * resueltas y trazadas (persona y fecha).
 */

// ───────────── Decisiones (resueltas fuera de C1c; C1d las tomará en pantalla) ─────────────

export interface Trazada {
  porId: Id;
  /** aaaa-mm-dd o fecha ISO. */
  fecha: string;
  motivo?: string;
}

export interface DecisionesIncorporacion {
  /** Reglas de clase «propuesta» autorizadas (p. ej. «fachada-con-unidad»). */
  reglasAutorizadas?: (Trazada & { regla: string })[];
  /** Textos aprobados como «sin información» (diccionario de la Cátedra). */
  diccionarioAprobado?: (Trazada & { texto: string })[];
  /** Filas excluidas de la aplicación operativa (su registro de origen se conserva). */
  exclusiones?: (Trazada & { fila: number; motivo: string })[];
  /** Conciliación de direcciones decidida por una persona. */
  correspondencias?: (Trazada & ({ fila: number; accion: 'local-nuevo' } | { fila: number; accion: 'local-existente'; localId: Id }))[];
  /** Equivalencias aprobadas de una combinación histórica a un nodo del catálogo. */
  equivalenciasClasificacion?: (Trazada & { grupo?: string; grupoComercio?: string; subgrupo?: string; actividad?: string; actividadId: Id; descripcion?: string })[];
}

/** Opciones de C1b que corresponden a las decisiones recibidas (nunca otras). */
export function opcionesInterpretacion(municipioId: Id, anio: number, d: DecisionesIncorporacion = {}): OpcionesInterpretacion {
  return {
    territorio: CONFIG_TERRITORIAL[municipioId],
    modo: 'historico',
    periodo: { desde: `${anio}-01-01`, hasta: `${anio}-12-31` },
    reglasAutorizadas: (d.reglasAutorizadas ?? []).map((x) => x.regla),
    diccionarioAprobado: (d.diccionarioAprobado ?? []).map((x) => x.texto),
  };
}

// ───────────── Plan ─────────────

export interface DestinoIncorporacion {
  municipioId: Id;
  anio: number;
  nombre?: string;
  /** Identificadores opcionales (pruebas y trazas reproducibles). */
  campanaId?: Id;
  importacionId?: Id;
}

export type Correspondencia = 'inequivoca' | 'decidida' | 'ambigua' | 'sin-vinculo' | 'excluida';
export type MotivoSinLocal =
  | 'calle-sin-correspondencia'
  | 'calle-ambigua'
  | 'numero-desconocido'
  | 'sin-numero'
  | 'direccion-repetida-en-archivo'
  | 'local-existente-en-direccion'
  | 'estado-local-desconocido';

export interface PlanFila {
  fila: number;
  correspondencia: Correspondencia;
  motivo?: MotivoSinLocal;
  /** Calle reconocida (solo con correspondencia única por nombre). */
  calleId?: Id;
  /** Local que se creará (nuevo) o local existente decidido por una persona. */
  localId?: Id;
  localNuevo: boolean;
  candidatos?: Id[];
  local: FilaInterpretada['local'];
  negocio: boolean;
  observacion: boolean;
  ocupacion: boolean;
  incidencias: number;
}

export interface Bloqueo {
  codigo: 'reimportacion-identica' | 'archivo-distinto' | 'decision-invalida' | 'destino-invalido' | 'interpretacion-incoherente';
  mensaje: string;
  detalles: string[];
}

export interface PlanIncorporacion {
  archivo: { nombre: string; sha256: string };
  perfil: { id: string; version: number };
  hoja: string;
  municipio: { id: Id; nombre: string };
  destino: { campanaId: Id; importacionId: Id; anio: number; nombre: string; nueva: true };
  aplicable: boolean;
  bloqueos: Bloqueo[];
  registros: { previstos: number; excluidos: number; candidatasExcluir: { fila: number; decidida: boolean }[] };
  nuevas: Record<Exclude<ColeccionIncorporada, 'campanas'> | 'campanas', number>;
  correspondencias: Record<Correspondencia, number> & { porMotivo: Partial<Record<MotivoSinLocal, number>> };
  incidencias: { total: number; porGravedad: Record<string, number>; porTipo: Record<string, number> };
  decisiones: { reglasAutorizadas: string[]; diccionarioAprobado: string[]; exclusiones: number; correspondencias: number; equivalenciasClasificacion: number };
  pendientes: string[];
  reimportacion?: { importacionId: Id; campanaId?: Id; filasIguales: number; filasCambiadas: number[]; filasNuevas: number[]; filasDesaparecidas: number[] };
  filas: PlanFila[];
  /** Firma del contenido del plan (sin marcas de tiempo): `aplicarIncorporacion` exige que coincida. */
  firma: string;
}

const esValida = (c?: { estado: string }) => c?.estado === 'valido' || c?.estado === 'transformado';
/**
 * Huellas de INTEGRIDAD. Versión 2 (actual): SHA-256. Versión 1 (incorporaciones anteriores):
 * FNV-1a de 32 bits, que se sigue sabiendo comprobar para no romper datos existentes.
 */
export type AlgoritmoHuella = 'sha256' | 'fnv1a-32';
const resumir = (texto: string, alg: AlgoritmoHuella) => (alg === 'sha256' ? sha256Texto(texto) : huella(texto));
export const algoritmoDe = (traza: Pick<TrazaIncorporacion, 'version' | 'algoritmoHuellas'>): AlgoritmoHuella => traza.algoritmoHuellas ?? (traza.version === 1 ? 'fnv1a-32' : 'sha256');
const huellaFila = (celdas: Record<string, unknown>, alg: AlgoritmoHuella = 'sha256') => resumir(JSON.stringify(Object.keys(celdas).sort().map((k) => [k, celdas[k]])), alg);

function validarDecisiones(db: BaseDatos, d: DecisionesIncorporacion, filas: Set<number>, municipioId: Id, anio: number): string[] {
  const errores: string[] = [];
  const traza = (x: Trazada, que: string) => {
    if (!x.porId || !db.personas[x.porId]) errores.push(`${que}: la persona «${x.porId}» no existe; toda decisión debe estar firmada.`);
    if (!/^\d{4}-\d{2}-\d{2}/.test(x.fecha ?? '')) errores.push(`${que}: falta la fecha de la decisión.`);
  };
  for (const r of d.reglasAutorizadas ?? []) {
    traza(r, `Regla «${r.regla}»`);
    if (REGLAS[r.regla]?.clase !== 'propuesta') errores.push(`Regla «${r.regla}»: no es una regla de clase «propuesta» de C1b.`);
  }
  for (const t of d.diccionarioAprobado ?? []) traza(t, `Diccionario «${t.texto}»`);
  for (const e of d.exclusiones ?? []) {
    traza(e, `Exclusión de la fila ${e.fila}`);
    if (!filas.has(e.fila)) errores.push(`Exclusión de la fila ${e.fila}: la fila no existe en el archivo.`);
    if (!e.motivo?.trim()) errores.push(`Exclusión de la fila ${e.fila}: falta el motivo.`);
  }
  const vistas = new Set<number>();
  for (const c of d.correspondencias ?? []) {
    traza(c, `Correspondencia de la fila ${c.fila}`);
    if (!filas.has(c.fila)) errores.push(`Correspondencia de la fila ${c.fila}: la fila no existe en el archivo.`);
    if (vistas.has(c.fila)) errores.push(`Correspondencia de la fila ${c.fila}: decisión duplicada.`);
    vistas.add(c.fila);
    if (c.accion === 'local-existente') {
      const l = db.locales[c.localId];
      if (!l || l.municipioId !== municipioId) errores.push(`Correspondencia de la fila ${c.fila}: el local «${c.localId}» no existe en el municipio.`);
      // Una ocupación de otra campaña del MISMO año competiría con la histórica (el orden de
      // ocupaciones es por año): se exige conciliarlo antes.
      else if (Object.values(db.ocupaciones).some((o) => o.localId === c.localId && anioDe(db, o.desdeCampanaId) === anio)) {
        errores.push(`Correspondencia de la fila ${c.fila}: el local «${c.localId}» ya tiene una ocupación de otra campaña de ${anio}; hay que conciliarlas primero.`);
      }
    }
  }
  for (const q of d.equivalenciasClasificacion ?? []) {
    traza(q, `Equivalencia de clasificación hacia «${q.actividadId}»`);
    if (!TAXONOMIA_POR_ID[q.actividadId]) errores.push(`Equivalencia de clasificación: el nodo «${q.actividadId}» no existe en ningún catálogo.`);
  }
  return errores;
}

const claveClasif = (g?: string, gc?: string, sg?: string, act?: string) => [g, gc, sg, act].map((x) => normalizar(x ?? '')).join('|');

/**
 * Construye el plan SIN modificar la base. `resultado` debe ser la interpretación de C1b del
 * archivo, hecha con `opcionesInterpretacion(...)` de las mismas decisiones.
 */
export function planificarIncorporacion(db: BaseDatos, resultado: ResultadoInterpretacion, destino: DestinoIncorporacion, decisiones: DecisionesIncorporacion = {}): PlanIncorporacion {
  const capa = resultado.original;
  const sha = capa.archivo.sha256 ?? '';
  const mun = db.municipios[destino.municipioId];
  const bloqueos: Bloqueo[] = [];
  const campanaId = destino.campanaId ?? `camp-hist-${destino.municipioId}-${destino.anio}-${sha.slice(0, 10)}`;
  // Una incorporación deshecha conserva su traza: la siguiente usa otro identificador.
  // Municipio y año forman parte del identificador: el mismo archivo puede incorporarse a ámbitos
  // históricos distintos sin colisionar ni sobrescribir registros.
  const raizImp = `imp-c1-${destino.municipioId}-${destino.anio}-${sha.slice(0, 16)}`;
  let importacionId = destino.importacionId ?? raizImp;
  for (let n = 2; !destino.importacionId && db.importaciones[importacionId]?.estado === 'descartada'; n++) importacionId = `${raizImp}-${n}`;

  if (!mun) bloqueos.push({ codigo: 'destino-invalido', mensaje: `El municipio «${destino.municipioId}» no existe.`, detalles: [] });
  if (!sha) bloqueos.push({ codigo: 'destino-invalido', mensaje: 'Falta la huella SHA-256 del archivo.', detalles: [] });
  const actuales = Object.values(db.campanas).filter((c) => c.municipioId === destino.municipioId && c.tipo !== 'historico-importado' && c.anio >= destino.anio);
  if (destino.anio >= new Date().getFullYear() || actuales.some((c) => c.anio === destino.anio)) {
    bloqueos.push({ codigo: 'destino-invalido', mensaje: `${destino.anio} no es un año histórico para este municipio: no se incorporan históricos sobre campañas en curso.`, detalles: actuales.filter((c) => c.anio === destino.anio).map((c) => c.nombre) });
  }

  // Coherencia entre la interpretación y las decisiones: C1b no puede haber aplicado nada no decidido.
  const op = opcionesInterpretacion(destino.municipioId, destino.anio, decisiones);
  const igualLista = (a: string[] = [], b: string[] = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!igualLista(resultado.opciones.reglasAutorizadas, op.reglasAutorizadas) || !igualLista((resultado.opciones.diccionarioAprobado ?? []).map(normalizar), (op.diccionarioAprobado ?? []).map(normalizar))
    || resultado.opciones.territorio?.municipioId !== op.territorio?.municipioId || resultado.opciones.modo !== 'historico') {
    bloqueos.push({ codigo: 'interpretacion-incoherente', mensaje: 'La interpretación de C1b no se hizo con las mismas reglas, diccionario y municipio que las decisiones recibidas.', detalles: [] });
  }

  const filasSet = new Set(capa.filas.map((f) => f.fila));
  const errores = validarDecisiones(db, decisiones, filasSet, destino.municipioId, destino.anio);
  if (errores.length) bloqueos.push({ codigo: 'decision-invalida', mensaje: `${errores.length} decisión(es) no válida(s): no se aplica nada.`, detalles: errores });

  // Reimportación. ÁMBITO = municipio + año de destino (+ campaña, si se indica) + perfil.
  // IDÉNTICA = mismo ámbito, mismo SHA-256 y misma VERSIÓN del perfil: no se duplica nada.
  // Mismo ámbito con otro archivo u otra versión del perfil: exige una nueva conciliación.
  // El mismo archivo en OTRO año no es la misma incorporación (solo se avisa).
  let reimportacion: PlanIncorporacion['reimportacion'];
  const previas = Object.values(db.importaciones).filter((i) => i.c1 && i.estado === 'confirmada' && i.municipioId === destino.municipioId);
  const enAmbito = previas.filter((i) => i.c1!.anio === destino.anio && i.c1!.perfil.id === capa.perfil.id && (!destino.campanaId || i.campanaId === destino.campanaId));
  const identica = enAmbito.find((i) => i.c1!.sha256 === sha && i.c1!.perfil.version === capa.perfil.version);
  const mismoAmbito = enAmbito.find((i) => i !== identica);
  const enOtroAnio = previas.filter((i) => i.c1!.sha256 === sha && i.c1!.anio !== destino.anio);
  const previa = identica ?? mismoAmbito;
  if (previa) {
    const anteriores = new Map(Object.values(db.registros).filter((r) => r.importacionId === previa.id).map((r) => [r.fila, r.huellaFila]));
    // Se compara con el MISMO algoritmo con que se guardó la incorporación previa.
    const alg = algoritmoDe(previa.c1!);
    const actualesF = new Map(capa.filas.map((f) => [f.fila, huellaFila(f.celdas, alg)]));
    reimportacion = {
      importacionId: previa.id, campanaId: previa.campanaId,
      filasIguales: [...actualesF].filter(([f, h]) => anteriores.get(f) === h).length,
      filasCambiadas: [...actualesF].filter(([f, h]) => anteriores.has(f) && anteriores.get(f) !== h).map(([f]) => f),
      filasNuevas: [...actualesF.keys()].filter((f) => !anteriores.has(f)),
      filasDesaparecidas: [...anteriores.keys()].filter((f) => !actualesF.has(f)),
    };
    if (identica) {
      bloqueos.length = 0;
      bloqueos.push({ codigo: 'reimportacion-identica', mensaje: `Este archivo ya se incorporó (importación «${identica.id}», campaña «${identica.campanaId}»). No se duplica nada.`, detalles: [] });
    } else {
      const r = reimportacion;
      bloqueos.push({
        codigo: 'archivo-distinto',
        mensaje: `Ya hay una incorporación de ${destino.anio} con el mismo perfil y otro archivo u otra versión del perfil (importación «${previa.id}»). Hace falta una nueva conciliación: no se sobrescribe el histórico.`,
        detalles: [...(previa.c1!.sha256 === sha ? [`Mismo archivo, perfil v${previa.c1!.perfil.version} → v${capa.perfil.version}`] : []), `${r.filasIguales} fila(s) iguales`, `${r.filasCambiadas.length} cambiada(s)`, `${r.filasNuevas.length} nueva(s)`, `${r.filasDesaparecidas.length} desaparecida(s)`],
      });
    }
  }

  if (!bloqueos.some((b) => b.codigo === 'reimportacion-identica')) {
    if (db.campanas[campanaId]) bloqueos.push({ codigo: 'destino-invalido', mensaje: `La campaña «${campanaId}» ya existe: la incorporación siempre crea una campaña histórica nueva.`, detalles: [] });
    if (db.importaciones[importacionId]) bloqueos.push({ codigo: 'destino-invalido', mensaje: `La importación «${importacionId}» ya existe.`, detalles: [] });
  }

  // Callejero del municipio: correspondencia SOLO por nombre único (sin aproximaciones).
  const porClave = new Map<string, Id[]>();
  for (const c of Object.values(db.calles)) if (c.municipioId === destino.municipioId) porClave.set(claveCalle(c.nombre), [...(porClave.get(claveCalle(c.nombre)) ?? []), c.id]);
  // Locales existentes por dirección exacta (calle|número|sufijo).
  const existentes = new Map<string, Id[]>();
  for (const l of Object.values(db.locales)) {
    if (l.municipioId !== destino.municipioId) continue;
    const d = direccionVigente(l);
    if (d.numero === null) continue;
    const k = `${d.calleId}|${d.numero}|${(d.sufijo ?? '').toUpperCase()}`;
    existentes.set(k, [...(existentes.get(k) ?? []), l.id]);
  }

  const excluidas = new Map((decisiones.exclusiones ?? []).map((e) => [e.fila, e]));
  const decididas = new Map((decisiones.correspondencias ?? []).map((c) => [c.fila, c]));
  const incPorFila = new Map<number, number>();
  for (const i of resultado.incidencias) incPorFila.set(i.fila, (incPorFila.get(i.fila) ?? 0) + 1);

  // Primera pasada: calle y dirección de cada fila, para detectar direcciones repetidas en el archivo.
  const previo = resultado.filas.map((fi) => {
    const dir = fi.celdas.direccion;
    const num = fi.celdas.numero;
    const claves = esValida(dir) ? porClave.get(claveCalle(String(dir!.valor))) ?? [] : [];
    const portal = esValida(num) ? (num!.valor as Portal) : undefined;
    const calleId = claves.length === 1 ? claves[0] : undefined;
    const kDir = calleId && portal?.tipo === 'numero' ? `${calleId}|${portal.numero}|${(portal.sufijo ?? '').toUpperCase()}` : undefined;
    return { fi, claves, calleId, portal, kDir };
  });
  const repetidas = new Map<string, number>();
  for (const p of previo) if (p.kDir && !excluidas.has(p.fi.fila)) repetidas.set(p.kDir, (repetidas.get(p.kDir) ?? 0) + 1);

  const filas: PlanFila[] = previo.map(({ fi, claves, calleId, portal, kDir }) => {
    const base = { fila: fi.fila, local: fi.local, incidencias: incPorFila.get(fi.fila) ?? 0, calleId };
    if (excluidas.has(fi.fila)) return { ...base, correspondencia: 'excluida', localNuevo: false, negocio: false, observacion: false, ocupacion: false };
    const negocio = !!calleId && fi.local === 'ocupado' && esValida(fi.celdas.nombre) && !!String(fi.celdas.nombre!.valor).trim();
    const observacion = !!calleId && fi.local !== 'desconocido';
    const sinLocal = (correspondencia: Correspondencia, motivo: MotivoSinLocal, candidatos?: Id[]): PlanFila => ({ ...base, correspondencia, motivo, candidatos, localNuevo: false, negocio, observacion, ocupacion: false });
    const ocupacion = (localId: Id, nuevo: boolean): PlanFila => ({ ...base, correspondencia: decididas.has(fi.fila) ? 'decidida' : 'inequivoca', localId, localNuevo: nuevo, negocio, observacion, ocupacion: fi.local === 'vacio' || negocio });

    const dec = decididas.get(fi.fila);
    if (dec && calleId && fi.local !== 'desconocido') {
      if (dec.accion === 'local-existente') return ocupacion(dec.localId, false);
      return ocupacion(`loc-${importacionId}-${fi.fila}`, true);
    }
    if (!claves.length) return sinLocal('sin-vinculo', 'calle-sin-correspondencia');
    if (claves.length > 1) return sinLocal('sin-vinculo', 'calle-ambigua');
    if (!portal) return sinLocal('sin-vinculo', 'numero-desconocido');
    if (portal.tipo === 'sin-numero') return sinLocal('ambigua', 'sin-numero');
    if (fi.local === 'desconocido') return sinLocal('ambigua', 'estado-local-desconocido', existentes.get(kDir!));
    const previos = existentes.get(kDir!);
    if (previos?.length) return sinLocal('ambigua', 'local-existente-en-direccion', previos);
    if ((repetidas.get(kDir!) ?? 0) > 1) return sinLocal('ambigua', 'direccion-repetida-en-archivo');
    return ocupacion(`loc-${importacionId}-${fi.fila}`, true);
  });

  const cuenta = <T extends string>(xs: T[]) => xs.reduce((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {} as Record<T, number>);
  const corr = cuenta(filas.map((f) => f.correspondencia));
  const negocios = filas.filter((f) => f.negocio);
  const equivalencias = new Map((decisiones.equivalenciasClasificacion ?? []).map((q) => [claveClasif(q.grupo, q.grupoComercio, q.subgrupo, q.actividad), q]));
  const filaPorNum = new Map(resultado.filas.map((f) => [f.fila, f]));
  const conClasif = negocios.filter((f) => {
    const c = filaPorNum.get(f.fila)!.celdas;
    const t = (k: string) => (esValida(c[k]) ? String(c[k].valor) : undefined);
    return equivalencias.has(claveClasif(t('grupoActividad'), t('grupoComercio'), t('subgrupo'), t('actividad')));
  }).length;
  const franquicias = negocios.filter((f) => esValida(filaPorNum.get(f.fila)!.celdas.franquicia)).length;
  const digitales = negocios.filter((f) => VARIABLES_IMPORTADAS.some(([k]) => datoDigital(filaPorNum.get(f.fila)!, k))).length;
  const gravedad = cuenta(resultado.incidencias.map((i) => i.gravedad));
  const tipos = cuenta(resultado.incidencias.map((i) => i.tipo as string));
  const candidatas = capa.candidatasExcluir.map((c) => ({ fila: c.fila, decidida: excluidas.has(c.fila) }));
  const pendientes = [
    ...enOtroAnio.map((i) => `El mismo archivo ya se incorporó como histórico de ${i.c1!.anio} (importación «${i.id}»): comprobar que ${destino.anio} es el año correcto`),
    ...Object.values(REGLAS).filter((r) => r.clase === 'propuesta' && !(op.reglasAutorizadas ?? []).includes(r.id) && resultado.filas.some((f) => Object.values(f.celdas).some((c) => c.regla === r.id && c.estado === 'pendiente')))
      .map((r) => `Regla no autorizada: ${r.id} (${r.descripcion})`),
    ...(candidatas.some((c) => !c.decidida) ? [`${candidatas.filter((c) => !c.decidida).length} posible(s) fila(s) de totales sin decidir: se incorporan como registros, sin excluir`] : []),
    ...((corr.ambigua ?? 0) ? [`${corr.ambigua} fila(s) con correspondencia ambigua: registro y observación sin local, pendientes de conciliación`] : []),
    ...((corr['sin-vinculo'] ?? 0) ? [`${corr['sin-vinculo']} fila(s) sin vínculo: solo registro de origen`] : []),
    ...(negocios.length - conClasif ? [`${negocios.length - conClasif} clasificación(es) 2025 sin equivalencia aprobada: se conservan como texto histórico`] : []),
  ];
  const plan: Omit<PlanIncorporacion, 'firma'> = {
    archivo: { nombre: capa.archivo.nombre, sha256: sha }, perfil: capa.perfil, hoja: capa.hoja,
    municipio: { id: destino.municipioId, nombre: mun?.nombre ?? destino.municipioId },
    destino: { campanaId, importacionId, anio: destino.anio, nombre: destino.nombre ?? `Censo ${destino.anio} · histórico importado`, nueva: true },
    aplicable: bloqueos.length === 0, bloqueos,
    registros: { previstos: capa.filas.length, excluidos: excluidas.size, candidatasExcluir: candidatas },
    nuevas: {
      campanas: 1, registros: capa.filas.length, locales: filas.filter((f) => f.localNuevo).length, negocios: negocios.length,
      observaciones: filas.filter((f) => f.observacion).length, ocupaciones: filas.filter((f) => f.ocupacion).length, vinculos: capa.filas.length - excluidas.size,
      franquicias, digital: digitales, clasificaciones: conClasif,
    },
    correspondencias: { ...({ inequivoca: 0, decidida: 0, ambigua: 0, 'sin-vinculo': 0, excluida: 0 } as Record<Correspondencia, number>), ...corr, porMotivo: cuenta(filas.filter((f) => f.motivo).map((f) => f.motivo!)) },
    incidencias: { total: resultado.incidencias.length, porGravedad: gravedad, porTipo: tipos },
    decisiones: {
      reglasAutorizadas: op.reglasAutorizadas ?? [], diccionarioAprobado: op.diccionarioAprobado ?? [], exclusiones: excluidas.size,
      correspondencias: decididas.size, equivalenciasClasificacion: equivalencias.size,
    },
    pendientes, reimportacion, filas,
  };
  return { ...plan, firma: sha256Texto(JSON.stringify(plan)) };
}

// ───────────── Presencia digital y franquicia (solo valores válidos, origen «importado») ─────────────

/** [clave de la columna, variable digital] */
const VARIABLES_IMPORTADAS: [string, VariableDigital][] = [
  ['web', 'web'], ['ventaOnline', 'ventaOnline'], ['googleBusiness', 'googleBusiness'], ['numResenas', 'numResenas'], ['respondeResenas', 'respondeResenas'],
  ['instagram', 'instagram'], ['seguidoresInstagram', 'seguidoresInstagram'], ['facebook', 'facebook'], ['seguidoresFacebook', 'seguidoresFacebook'],
  ['twitter', 'twitter'], ['seguidoresTwitter', 'seguidoresTwitter'],
];

/** Solo se lleva al modelo una celda válida SIN incidencias de revisión; el resto queda en el registro. */
function datoDigital(fi: FilaInterpretada, clave: string): Omit<DatoDigital, 'origen' | 'fecha'> | undefined {
  const c = fi.celdas[clave];
  if (!c || c.revision) return undefined;
  if (c.estado === 'no-aplica' && c.regla === 'no-aplica-red-no') return { respuesta: 'na' };
  if (!esValida(c)) return undefined;
  if (typeof c.valor === 'boolean') return { respuesta: c.valor ? 'si' : 'no' };
  if (typeof c.valor === 'number') return { respuesta: 'si', valor: c.valor };
  return undefined;
}

// ───────────── Aplicación atómica ─────────────

export interface ResultadoIncorporacion {
  db: BaseDatos;
  importacionId: Id;
  campanaId: Id;
  creadas: Record<ColeccionIncorporada, number>;
  /** Reimportación idéntica: no se ha creado nada y `db` es la misma base recibida. */
  sinCambios?: true;
}

/** Solo para pruebas: provoca un fallo a mitad de la aplicación. */
export interface OpcionesAplicacion {
  porId: Id;
  /** Fecha de registro (por defecto, ahora). */
  ahora?: string;
  pruebaFalloTrasFilas?: number;
}

const COLECCIONES: ColeccionIncorporada[] = ['campanas', 'registros', 'locales', 'negocios', 'observaciones', 'ocupaciones', 'vinculos', 'franquicias', 'digital', 'clasificaciones'];

function textoCelda(o: CeldaOriginal): string {
  switch (o.t) {
    case 'vacio': return '';
    case 'fecha': return o.v.slice(0, 10);
    case 'booleano': return o.v ? 'VERDADERO' : 'FALSO';
    default: return String(o.v);
  }
}

export function aplicarIncorporacion(
  db0: BaseDatos, resultado: ResultadoInterpretacion, destino: DestinoIncorporacion, decisiones: DecisionesIncorporacion, planAprobado: PlanIncorporacion, opciones: OpcionesAplicacion,
): ResultadoIncorporacion {
  if (!db0.personas[opciones.porId]) throw new ErrorDominio('regla', 'La incorporación debe hacerla una persona registrada.');
  // 1. Validar: el plan se recalcula sobre la base ACTUAL y debe coincidir con el aprobado.
  const plan = planificarIncorporacion(db0, resultado, destino, decisiones);
  const identica = plan.bloqueos.length === 1 && plan.bloqueos[0].codigo === 'reimportacion-identica' ? plan.reimportacion : undefined;
  if (identica) {
    return { db: db0, importacionId: identica.importacionId, campanaId: identica.campanaId!, creadas: Object.fromEntries(COLECCIONES.map((c) => [c, 0])) as Record<ColeccionIncorporada, number>, sinCambios: true };
  }
  if (!plan.aplicable) throw new ErrorDominio('bloqueado', plan.bloqueos[0].mensaje, plan.bloqueos.flatMap((b) => [b.mensaje, ...b.detalles]));
  if (plan.firma !== planAprobado.firma) throw new ErrorDominio('regla', 'La base o el archivo han cambiado desde que se preparó el plan: hay que revisarlo de nuevo antes de aplicar.');

  // 2. Copia de trabajo: solo se copian las colecciones que se tocan. db0 no se modifica nunca.
  const ahora = opciones.ahora ?? new Date().toISOString();
  const db: BaseDatos = { ...db0 };
  for (const c of COLECCIONES) (db as unknown as Record<string, unknown>)[c] = { ...db0[c] };
  db.importaciones = { ...db0.importaciones };
  const capa = resultado.original;
  const { campanaId, importacionId } = plan.destino;
  const creadas: Record<ColeccionIncorporada, Id[]> = Object.fromEntries(COLECCIONES.map((c) => [c, []])) as unknown as Record<ColeccionIncorporada, Id[]>;
  const crear = <K extends ColeccionIncorporada>(col: K, id: Id, valor: BaseDatos[K][string]) => {
    if ((db0[col] as Record<string, unknown>)[id] !== undefined || (db[col] as Record<string, unknown>)[id] !== undefined) throw new ErrorDominio('regla', `Identificador duplicado en ${col}: «${id}». No se aplica nada.`);
    (db[col] as Record<string, unknown>)[id] = valor;
    creadas[col].push(id);
  };

  const campana: Campana = {
    id: campanaId, municipioId: destino.municipioId, anio: destino.anio, nombre: plan.destino.nombre, tipo: 'historico-importado',
    periodo: { inicio: `${destino.anio}-01-01`, fin: `${destino.anio}-12-31` }, ambitoCalleIds: [], ampliacionCalleIds: [],
    // Nada queda revisado ni validado.
    estados: { planificacion: 'no-aplica', campo: 'terminado', revision: 'pendiente', validacion: 'pendiente' }, procedencia: 'importado',
  };
  crear('campanas', campanaId, campana);

  const porFila = new Map(resultado.filas.map((f) => [f.fila, f]));
  const exclusiones = new Map((decisiones.exclusiones ?? []).map((e) => [e.fila, e]));
  const equivalencias = new Map((decisiones.equivalenciasClasificacion ?? []).map((q) => [claveClasif(q.grupo, q.grupoComercio, q.subgrupo, q.actividad), q]));
  const ambito = new Set<Id>();
  const resumen: Record<string, number> = {};
  const sumar = (k: string) => (resumen[k] = (resumen[k] ?? 0) + 1);
  const incidenciasFila = new Map<number, string[]>();
  for (const x of resultado.incidencias) incidenciasFila.set(x.fila, [...(incidenciasFila.get(x.fila) ?? []), x.tipo]);
  const decisionFila = new Map((decisiones.correspondencias ?? []).map((x) => [x.fila, x]));

  plan.filas.forEach((pf, i) => {
    if (opciones.pruebaFalloTrasFilas !== undefined && i === opciones.pruebaFalloTrasFilas) throw new Error(`Fallo simulado tras ${i} filas (prueba de atomicidad).`);
    const fo = capa.filas[i];
    const fi = porFila.get(pf.fila)!;
    if (fo.fila !== pf.fila) throw new ErrorDominio('regla', 'El plan y la capa original no están alineados.');
    // Registro de origen: SIEMPRE, también si la fila se excluye o tiene celdas inválidas.
    const regId = `reg-${importacionId}-${pf.fila}`;
    const exc = exclusiones.get(pf.fila);
    const registro: RegistroOrigen = {
      id: regId, importacionId, fila: pf.fila,
      datos: Object.fromEntries(capa.columnas.map((c) => [c.cabecera.trim(), textoCelda(fo.celdas[c.clave] ?? { t: 'vacio' })])),
      original: fo.celdas,
      interpretacion: {
        // Solo las celdas NO triviales: una celda «válida» por lectura directa se reconstruye del
        // original con la misma regla (perfil y versión en la traza). Así no se duplica el archivo.
        celdas: Object.fromEntries(Object.entries(fi.celdas).filter(([, c]) => !(c.estado === 'valido' && REGLAS[c.regla]?.clase === 'lectura')).map(([k, c]) => [k, { estado: c.estado, regla: c.regla, ...(c.valor !== undefined ? { valor: c.valor } : {}) }])),
        local: fi.local, redesCalculadas: fi.redesCalculadas,
        ...(fi.clasificacion ? { clasificacion: { diagnostico: fi.clasificacion.diagnostico, confirmada: false as const } } : {}),
        incidencias: incidenciasFila.get(pf.fila) ?? [],
      },
      huellaFila: huellaFila(fo.celdas),
      ...(exc ? { exclusion: { porId: exc.porId, fecha: exc.fecha, motivo: exc.motivo } } : {}),
    };
    crear('registros', regId, registro);
    sumar(`correspondencia ${pf.correspondencia}`);
    if (pf.correspondencia === 'excluida') return;

    const c = fi.celdas;
    const portal = esValida(c.numero) ? (c.numero.valor as Portal) : undefined;
    const numero = portal?.tipo === 'numero' ? portal.numero : null;
    const sufijo = portal?.tipo === 'numero' ? portal.sufijo : undefined;
    const fecha = esValida(c.fecha) ? String(c.fecha.valor) : undefined;
    const metros = esValida(c.fachada) && typeof c.fachada.valor === 'number' ? c.fachada.valor : undefined;

    let localId: Id | null = null;
    if (pf.localId) {
      localId = pf.localId;
      if (pf.localNuevo) {
        const local: LocalFisico = { id: localId, municipioId: destino.municipioId, direcciones: [{ calleId: pf.calleId!, numero, ...(sufijo ? { sufijo } : {}), desdeCampanaId: campanaId }], estado: 'activo', procedencia: 'importado' };
        crear('locales', localId, local);
      }
    }

    let negocioId: Id | null = null;
    if (pf.negocio) {
      negocioId = `neg-${importacionId}-${pf.fila}`;
      // Nombre LITERAL del histórico. «Franquicia» es binaria: nunca se usa como nombre de cadena.
      crear('negocios', negocioId, { id: negocioId, nombre: String(c.nombre.valor), procedencia: 'importado' });
      if (esValida(c.franquicia)) {
        const respuesta = c.franquicia.valor ? 'si' : 'no';
        crear('franquicias', kNC(negocioId, campanaId), { negocioId, campanaId, respuesta, origen: 'importado', ...(fecha ? { fecha } : {}), historial: [{ respuesta, origen: 'importado', fecha: ahora }] });
      }
      const datos: RevisionDigital['datos'] = {};
      for (const [k, v] of VARIABLES_IMPORTADAS) {
        const d = datoDigital(fi, k);
        if (d) datos[v] = { ...d, origen: 'importado', ...(fecha ? { fecha } : {}) };
      }
      // Borrador histórico: nunca «verificada»; la revisión de 2026 sigue pendiente.
      if (Object.keys(datos).length) crear('digital', kNC(negocioId, campanaId), { negocioId, campanaId, datos, estado: 'borrador', historial: [] });
      const t = (k: string) => (esValida(c[k]) ? String(c[k].valor) : undefined);
      const eq = equivalencias.get(claveClasif(t('grupoActividad'), t('grupoComercio'), t('subgrupo'), t('actividad')));
      if (eq) {
        crear('clasificaciones', kNC(negocioId, campanaId), {
          negocioId, campanaId, actividadId: eq.actividadId, ...(eq.descripcion ? { descripcion: eq.descripcion } : {}), catalogoId: catalogoDeNodo(eq.actividadId),
          origen: 'importado', confirmada: false, migracion: { desdeActividadId: '', desdeCatalogo: 'texto-historico', fecha: eq.fecha, criterio: `Equivalencia aprobada por ${eq.porId}${eq.motivo ? `: ${eq.motivo}` : ''}`, estabaConfirmada: false },
        });
      }
    }

    let obsId: Id | undefined;
    if (pf.observacion) {
      obsId = `obs-${importacionId}-${pf.fila}`;
      ambito.add(pf.calleId!);
      const vacio = fi.local === 'vacio';
      const obs: Observacion = {
        id: obsId, campanaId, localId, calleId: pf.calleId!, ...(fecha ? { fecha } : {}), registrado: ahora, fuente: 'importacion', tipo: vacio ? 'vacio' : 'confirmado',
        datos: { numero, ...(sufijo ? { sufijo } : {}), ...(negocioId ? { nombre: String(c.nombre.valor) } : {}), negocioId, vacio, ...(metros !== undefined ? { metrosFachada: metros } : {}) },
        orden: siguienteOrden(db), nota: `Censo histórico importado (fila ${pf.fila}).`,
        // El histórico es referencia: queda pendiente, nunca verificado.
        verificacion: 'pendiente',
      };
      crear('observaciones', obsId, obs);
    }

    if (pf.ocupacion && localId) {
      const ocu: Ocupacion = {
        id: `ocu-${importacionId}-${pf.fila}`, localId, negocioId, ...(metros !== undefined ? { metrosFachada: metros } : {}),
        // Cerrada en la propia campaña histórica: no se extiende a 2026 ni altera su vista.
        desdeCampanaId: campanaId, hastaCampanaId: campanaId, ...(obsId ? { desdeObservacionId: obsId } : {}), ...(fecha ? { desdeFecha: fecha } : {}), orden: siguienteOrden(db),
      };
      crear('ocupaciones', ocu.id, ocu);
    }

    const confianza: Confianza = pf.correspondencia === 'decidida' ? 'confirmada' : pf.correspondencia === 'inequivoca' ? 'probable' : pf.correspondencia === 'ambigua' ? 'dudosa' : 'sin-vinculo';
    const dec = decisionFila.get(pf.fila);
    const criterio = {
      inequivoca: 'Local creado a partir de esta fila: dirección única en el archivo y sin locales previos en esa dirección. Pendiente de conciliar con otras campañas.',
      decidida: `Correspondencia decidida por una persona${dec?.motivo ? `: ${dec.motivo}` : ''}.`,
      ambigua: `Correspondencia ambigua (${pf.motivo}): no se crea ni se elige local; pendiente de conciliación.`,
      'sin-vinculo': `Sin correspondencia segura (${pf.motivo}): se conserva el registro de origen sin inventar calle ni local.`,
      excluida: '',
    }[pf.correspondencia];
    const vinculo: VinculoHistorico = {
      id: `vin-${regId}`, origen: { tipo: 'registro', id: regId }, localId, confianza, criterio,
      ...(dec ? { revisadoPorId: dec.porId } : {}),
      ...(pf.candidatos?.length ? { candidatos: pf.candidatos.map((l) => ({ localId: l, puntuacion: 0.5, motivo: 'misma dirección' })) } : {}),
    };
    crear('vinculos', vinculo.id, vinculo);
  });

  db.campanas[campanaId] = { ...campana, ambitoCalleIds: [...ambito] };

  // 3. Integridad referencial de TODO lo creado; si falla, no se publica nada.
  const errores = comprobarIntegridad(db, creadas, importacionId);
  if (errores.length) throw new ErrorDominio('regla', `La incorporación no supera la comprobación de integridad (${errores.length} error(es)). No se ha aplicado nada.`, errores.slice(0, 20));

  // 4. Traza: huella de cada entidad creada (permite detectar cambios posteriores al deshacer).
  const traza: TrazaIncorporacion = {
    version: 2, algoritmoHuellas: 'sha256', sha256: plan.archivo.sha256, perfil: plan.perfil, hoja: plan.hoja, anio: destino.anio,
    columnas: capa.columnas.map((c) => ({ clave: c.clave, letra: c.letra, cabecera: c.cabecera, tipo: c.tipo })), porId: opciones.porId,
    decisiones: decisiones as Record<string, unknown>, firmaPlan: plan.firma,
    creadas: Object.fromEntries(COLECCIONES.map((col) => [col, Object.fromEntries(creadas[col].map((id) => [id, huellaEntidad(db, col, id)]))])),
    modificadas: {},
  };
  const imp: Importacion = {
    id: importacionId, municipioId: destino.municipioId, campanaId, tipo: 'A-censo-historico', archivo: plan.archivo.nombre, huella: plan.archivo.sha256, fecha: ahora,
    filas: capa.filas.length, estado: 'confirmada', procedencia: 'importado',
    resumen: { ...resumen, 'registros de origen': creadas.registros.length, 'locales creados': creadas.locales.length, 'negocios creados': creadas.negocios.length, 'observaciones': creadas.observaciones.length, 'ocupaciones': creadas.ocupaciones.length },
    nota: 'C1c · Censo histórico incorporado como referencia: nada queda revisado, verificado ni validado. Los bytes del archivo no se guardan.',
    c1: traza,
  };
  db.importaciones[importacionId] = imp;
  return { db, importacionId, campanaId, creadas: Object.fromEntries(COLECCIONES.map((c) => [c, creadas[c].length])) as Record<ColeccionIncorporada, number> };
}

const huellaEntidad = (db: BaseDatos, col: ColeccionIncorporada, id: Id, alg: AlgoritmoHuella = 'sha256') => resumir(JSON.stringify((db[col] as Record<string, unknown>)[id]), alg);

/** Integridad referencial de las entidades creadas (y de lo que referencian). */
export function comprobarIntegridad(db: BaseDatos, creadas: Partial<Record<ColeccionIncorporada, Id[]>>, importacionId: Id): string[] {
  const e: string[] = [];
  for (const id of creadas.registros ?? []) if (db.registros[id].importacionId !== importacionId) e.push(`Registro ${id}: no pertenece a la importación`);
  for (const id of creadas.locales ?? []) {
    const l = db.locales[id];
    if (!db.municipios[l.municipioId]) e.push(`Local ${id}: municipio inexistente`);
    for (const d of l.direcciones) if (!db.calles[d.calleId]) e.push(`Local ${id}: calle inexistente`);
  }
  for (const id of creadas.observaciones ?? []) {
    const o = db.observaciones[id];
    if (!db.campanas[o.campanaId]) e.push(`Observación ${id}: campaña inexistente`);
    if (!db.calles[o.calleId]) e.push(`Observación ${id}: calle inexistente`);
    if (o.localId && !db.locales[o.localId]) e.push(`Observación ${id}: local inexistente`);
    if (o.datos.negocioId && !db.negocios[o.datos.negocioId]) e.push(`Observación ${id}: negocio inexistente`);
  }
  for (const id of creadas.ocupaciones ?? []) {
    const o = db.ocupaciones[id];
    if (!db.locales[o.localId]) e.push(`Ocupación ${id}: local inexistente`);
    if (o.negocioId && !db.negocios[o.negocioId]) e.push(`Ocupación ${id}: negocio inexistente`);
    if (!db.campanas[o.desdeCampanaId] || (o.hastaCampanaId && !db.campanas[o.hastaCampanaId])) e.push(`Ocupación ${id}: campaña inexistente`);
    if (o.desdeObservacionId && !db.observaciones[o.desdeObservacionId]) e.push(`Ocupación ${id}: observación inexistente`);
  }
  for (const id of creadas.vinculos ?? []) {
    const v = db.vinculos[id];
    if (v.origen.tipo === 'registro' && !db.registros[v.origen.id]) e.push(`Vínculo ${id}: registro inexistente`);
    if (v.localId && !db.locales[v.localId]) e.push(`Vínculo ${id}: local inexistente`);
    for (const c of v.candidatos ?? []) if (!db.locales[c.localId]) e.push(`Vínculo ${id}: candidato inexistente`);
  }
  for (const col of ['franquicias', 'digital', 'clasificaciones'] as const) {
    for (const id of creadas[col] ?? []) {
      const x = db[col][id];
      if (!db.negocios[x.negocioId]) e.push(`${col} ${id}: negocio inexistente`);
      if (!db.campanas[x.campanaId]) e.push(`${col} ${id}: campaña inexistente`);
    }
  }
  for (const id of creadas.clasificaciones ?? []) {
    const c = db.clasificaciones[id];
    if (!TAXONOMIA_POR_ID[c.actividadId]) e.push(`Clasificación ${id}: nodo inexistente`);
    if (c.confirmada) e.push(`Clasificación ${id}: una clasificación importada no puede quedar confirmada`);
  }
  for (const id of creadas.digital ?? []) if (db.digital[id].estado !== 'borrador') e.push(`Digital ${id}: un dato histórico no puede quedar verificado`);
  return e;
}

// ───────────── Deshacer ─────────────

/**
 * Retira EXACTAMENTE lo que creó una incorporación. Se bloquea, explicando el motivo, si alguna
 * entidad creada ha cambiado o desaparecido, o si otra entidad posterior la referencia (una
 * observación nueva en un local importado, una clasificación hecha en oficina…): nunca borra ni
 * sobrescribe trabajo posterior. La importación se conserva marcada como deshecha (traza). El
 * contador global `secuencia` no retrocede (véase abajo).
 */
export function deshacerIncorporacion(db0: BaseDatos, importacionId: Id, porId: Id, ahora = new Date().toISOString()): BaseDatos {
  const imp = db0.importaciones[importacionId];
  if (!imp?.c1) throw new ErrorDominio('regla', 'No es una incorporación de C1c.');
  if (imp.estado !== 'confirmada') throw new ErrorDominio('regla', 'Esta incorporación ya se deshizo.');
  if (!db0.personas[porId]) throw new ErrorDominio('regla', 'Deshacer debe hacerlo una persona registrada.');
  const creadas = imp.c1.creadas;
  const alg = algoritmoDe(imp.c1);
  const conflictos: string[] = [];
  const ids = new Map<ColeccionIncorporada, Set<Id>>(COLECCIONES.map((c) => [c, new Set(Object.keys(creadas[c] ?? {}))]));
  for (const col of COLECCIONES) {
    for (const [id, h] of Object.entries(creadas[col] ?? {})) {
      if ((db0[col] as Record<string, unknown>)[id] === undefined) conflictos.push(`${col} «${id}» ya no existe`);
      else if (huellaEntidad(db0, col, id, alg) !== h) conflictos.push(`${col} «${id}» se ha modificado después de la incorporación`);
    }
  }
  const nuestro = (col: ColeccionIncorporada, id: Id) => ids.get(col)!.has(id);
  const campanaId = imp.campanaId!;
  const locales = ids.get('locales')!;
  const negocios = ids.get('negocios')!;
  // Referencias posteriores desde entidades que no son de esta incorporación.
  for (const o of Object.values(db0.observaciones)) if (!nuestro('observaciones', o.id) && (o.campanaId === campanaId || (o.localId && locales.has(o.localId)) || (o.datos.negocioId && negocios.has(o.datos.negocioId)))) conflictos.push(`Observación posterior «${o.id}» sobre datos importados`);
  for (const o of Object.values(db0.ocupaciones)) if (!nuestro('ocupaciones', o.id) && (locales.has(o.localId) || (o.negocioId && negocios.has(o.negocioId)) || o.desdeCampanaId === campanaId || o.hastaCampanaId === campanaId)) conflictos.push(`Ocupación posterior «${o.id}» sobre datos importados`);
  for (const v of Object.values(db0.vinculos)) if (!nuestro('vinculos', v.id) && ((v.localId && locales.has(v.localId)) || (v.candidatos ?? []).some((c) => locales.has(c.localId)) || (v.origen.tipo === 'registro' && ids.get('registros')!.has(v.origen.id)))) conflictos.push(`Vínculo posterior «${v.id}» sobre datos importados`);
  for (const col of ['franquicias', 'digital', 'clasificaciones'] as const) {
    for (const [k, x] of Object.entries(db0[col])) if (!nuestro(col, k) && (negocios.has(x.negocioId) || x.campanaId === campanaId)) conflictos.push(`${col} posterior «${k}» sobre datos importados`);
  }
  for (const r of Object.values(db0.revisiones)) if (r.campanaId === campanaId || locales.has(r.localId)) conflictos.push(`Revisión posterior de «${r.localId}» en datos importados`);
  for (const it of Object.values(db0.itinerarios)) if (it.campanaId === campanaId) conflictos.push(`Itinerario posterior «${it.codigo}» en la campaña histórica`);
  for (const i of Object.values(db0.importaciones)) if (i.id !== importacionId && i.campanaId === campanaId && i.estado === 'confirmada') conflictos.push(`Otra importación «${i.id}» en la misma campaña`);
  for (const k of [...Object.keys(db0.coberturas), ...Object.keys(db0.situacionesPrevias), ...Object.keys(db0.callesRevisadasPlan)]) if (k.startsWith(`${campanaId}|`)) conflictos.push(`Dato de planificación posterior «${k}» en la campaña histórica`);
  for (const c of Object.values(db0.campanas)) if (c.campanaReferenciaId === campanaId) conflictos.push(`La campaña «${c.nombre}» usa la campaña histórica como referencia`);
  if (conflictos.length) {
    throw new ErrorDominio('bloqueado', `No se puede deshacer la incorporación: hay ${conflictos.length} cambio(s) posterior(es) sobre los datos importados. Hay que revisarlos antes; no se ha modificado nada.`, conflictos.slice(0, 30));
  }
  // `db.secuencia` NO retrocede: deshacer restaura las colecciones afectadas, pero el contador global
  // de orden sigue creciendo. Así ningún número de orden se reutiliza (otra copia, la pila de deshacer
  // o la cola de sincronización pueden conservar los ya emitidos) y lo registrado después siempre
  // ordena detrás. El hueco que queda es inocuo: el orden solo desempata cuando la fecha no decide.
  const db: BaseDatos = { ...db0 };
  for (const col of COLECCIONES) {
    const copia = { ...(db0[col] as Record<string, unknown>) };
    for (const id of ids.get(col)!) delete copia[id];
    (db as unknown as Record<string, unknown>)[col] = copia;
  }
  db.importaciones = { ...db0.importaciones, [importacionId]: { ...imp, estado: 'descartada', c1: { ...imp.c1, deshecha: { porId, fecha: ahora } }, nota: `${imp.nota ?? ''} Deshecha por ${porId} el ${ahora.slice(0, 10)}.`.trim() } };
  return db;
}
