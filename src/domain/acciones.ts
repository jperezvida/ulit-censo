import type { BaseDatos } from './db';
import { ErrorDominio } from './db';
import { comprobarAlcance, comprobarEditable, enLote, type Alcance } from './bloqueo';
import { actualizarRevisiones, type FilaOficina } from './oficina';
import { clasificarLote } from './clasificacion';
import { DEF_VARIABLE, registrarDatoDigitalLote } from './digital';
import { registrarFranquiciaLote } from './franquicias';
import { partirDe2025, resumenHerencia, type InformeHerencia, type ParteHerencia } from './herencia';
import { RESPUESTA_TXT } from './respuesta';
import { rutaTexto } from './buscador';
import type { Id, Respuesta, VariableDigital } from './types';

/**
 * Acciones masivas de Oficina (B5) sobre varios registros seleccionados.
 *
 *  - Antes de ejecutar se calcula un PLAN: registros afectados, operación y excluidos con motivo.
 *  - La ejecución es ATÓMICA: se aplican todos los cambios previstos o ninguno (el dominio
 *    vuelve a comprobar bloqueo y alcance de cada registro antes de modificar nada).
 *  - Ninguna acción masiva verifica la presencia digital ni aprueba la revisión general.
 *  - Se ejecuta como una sola operación: un único Ctrl+Z la deshace.
 */

export type VariableBinaria = 'franquicia' | VariableDigital;

export type AccionMasiva =
  | { tipo: 'respuesta'; variable: VariableBinaria; respuesta: Respuesta }
  | { tipo: 'incidencia'; motivo: string }
  | { tipo: 'clasificacion'; nodoId: Id; descripcion?: string }
  | { tipo: 'partir2025'; partes?: ParteHerencia[] };

export interface PlanAccion {
  descripcion: string;
  aplicables: FilaOficina[];
  excluidas: { fila: FilaOficina; motivo: string }[];
  /** Solo para «partir de 2025»: lo que se copiaría y lo que se señala. */
  herencia?: InformeHerencia;
}

/** Variables binarias que admiten acción masiva (las numéricas no: necesitan un valor). */
export function variablesBinarias(): VariableBinaria[] {
  return ['franquicia', ...(Object.values(DEF_VARIABLE).filter((d) => d.tipo === 'respuesta').map((d) => d.id))];
}

export function etiquetaVariable(v: VariableBinaria): string {
  return v === 'franquicia' ? 'Franquicia' : DEF_VARIABLE[v].etiqueta;
}

function validarRespuesta(v: VariableBinaria, r: Respuesta) {
  if (v === 'franquicia') {
    if (r === 'na') throw new ErrorDominio('regla', 'Franquicia no admite «no aplicable».');
    return;
  }
  const def = DEF_VARIABLE[v];
  if (!def || def.tipo !== 'respuesta') throw new ErrorDominio('regla', 'Solo se admiten variables Sí/No en una acción masiva.');
  if (r === 'na' && !def.admiteNa && !def.depende) throw new ErrorDominio('regla', `${def.etiqueta} no admite «no aplicable».`);
}

export function describirAccion(a: AccionMasiva): string {
  switch (a.tipo) {
    case 'respuesta': return `${etiquetaVariable(a.variable)} = ${RESPUESTA_TXT[a.respuesta]}`;
    case 'incidencia': return `Marcar «pendiente de comprobación»: ${a.motivo}`;
    case 'clasificacion': return `Clasificar como ${rutaTexto(a.nodoId, a.descripcion)}`;
    case 'partir2025': return 'Preparar datos desde la campaña anterior (borrador sin verificar)';
  }
}

/** Plan de una acción sobre las filas seleccionadas (no modifica nada). */
export function planAccionMasiva(
  db: BaseDatos, campanaId: Id, filas: FilaOficina[], accion: AccionMasiva,
  ctx: { alcance?: Alcance; bloqueado?: boolean; porId: Id },
): PlanAccion {
  const plan: PlanAccion = { descripcion: describirAccion(accion), aplicables: [], excluidas: [] };
  try {
    if (accion.tipo === 'respuesta') validarRespuesta(accion.variable, accion.respuesta);
    if (accion.tipo === 'incidencia' && !accion.motivo.trim()) throw new ErrorDominio('regla', 'Indica el motivo de la incidencia.');
  } catch (e) {
    plan.excluidas = filas.map((fila) => ({ fila, motivo: e instanceof Error ? e.message : String(e) }));
    return plan;
  }
  const negocios = new Set<Id>();
  for (const f of filas) {
    let motivo: string | null = null;
    if (ctx.bloqueado || f.bloqueado) motivo = 'Itinerario con la revisión cerrada: solo lectura';
    else if (ctx.alcance && !f.itinerarioIds.includes(ctx.alcance.itinerarioId)) motivo = 'Fuera del itinerario de trabajo';
    else if (f.situacion === 'pendiente-visita') motivo = 'Pendiente de visitar en campo';
    else if (accion.tipo !== 'incidencia' && (f.vacio || !f.negocioId)) motivo = 'Local vacío: no aplica';
    else if (accion.tipo !== 'incidencia' && accion.tipo !== 'partir2025' && negocios.has(f.negocioId!)) motivo = 'Mismo negocio que otro registro seleccionado';
    if (motivo) plan.excluidas.push({ fila: f, motivo });
    else {
      plan.aplicables.push(f);
      if (f.negocioId) negocios.add(f.negocioId);
    }
  }
  if (accion.tipo === 'partir2025' && plan.aplicables.length) {
    const { informe } = enLote(db, () => partirDe2025(db, campanaId, plan.aplicables.map((f) => f.localId), ctx.porId, { alcance: ctx.alcance, partes: accion.partes }));
    plan.herencia = informe;
    const excl = new Map(informe.excluidas.map((x) => [x.localId, x.motivo]));
    const con = new Set(informe.aplicadas.map((x) => x.localId));
    plan.excluidas.push(...plan.aplicables.filter((f) => excl.has(f.localId)).map((fila) => ({ fila, motivo: excl.get(fila.localId)! })));
    plan.excluidas.push(...plan.aplicables.filter((f) => !excl.has(f.localId) && !con.has(f.localId)).map((fila) => ({ fila, motivo: 'Nada que copiar: ya hay datos en esta campaña o los anteriores no son válidos' })));
    plan.aplicables = plan.aplicables.filter((f) => con.has(f.localId));
    // Los excluidos se cuentan aparte (los del plan incluyen además los que no tienen nada que copiar).
    plan.descripcion = `${describirAccion(accion)} · ${resumenHerencia({ ...informe, excluidas: [] })}`;
  }
  return plan;
}

/**
 * Ejecuta la acción sobre los registros del plan. ATÓMICA: comprueba bloqueo y alcance de todos
 * antes de modificar y, si una operación de dominio falla, lanza (el resultado se descarta).
 */
export function ejecutarAccionMasiva(
  db0: BaseDatos, campanaId: Id, filas: FilaOficina[], accion: AccionMasiva, porId: Id, alcance?: Alcance,
): BaseDatos {
  return enLote(db0, () => ejecutar(db0, campanaId, filas, accion, porId, alcance));
}

function ejecutar(db0: BaseDatos, campanaId: Id, filas: FilaOficina[], accion: AccionMasiva, porId: Id, alcance?: Alcance): BaseDatos {
  if (!filas.length) throw new ErrorDominio('regla', 'No hay registros a los que aplicar la acción.');
  const ids = filas.map((f) => f.localId);
  comprobarAlcance(db0, alcance, ids);
  for (const id of ids) comprobarEditable(db0, campanaId, { localId: id });
  const fecha = new Date().toISOString();
  let db = db0;
  switch (accion.tipo) {
    case 'respuesta': {
      validarRespuesta(accion.variable, accion.respuesta);
      const negocios = [...new Set(filas.map((f) => f.negocioId).filter((x): x is Id => !!x))];
      return accion.variable === 'franquicia'
        ? registrarFranquiciaLote(db, negocios, campanaId, accion.respuesta, porId, { alcance, fecha })
        : registrarDatoDigitalLote(db, negocios, campanaId, accion.variable, { respuesta: accion.respuesta }, porId, { alcance, fecha });
    }
    case 'incidencia':
      if (!accion.motivo.trim()) throw new ErrorDominio('regla', 'Indica el motivo de la incidencia.');
      return actualizarRevisiones(db, campanaId, ids, { pendienteComprobacion: true, motivoComprobacion: accion.motivo.trim() }, alcance);
    case 'clasificacion':
      return clasificarLote(db, [...new Set(filas.map((f) => f.negocioId).filter((x): x is Id => !!x))], campanaId, accion.nodoId, porId, { alcance, descripcion: accion.descripcion, fecha });
    case 'partir2025':
      return partirDe2025(db, campanaId, ids, porId, { alcance, partes: accion.partes }).db;
  }
}
