import { HOJA1_ACTIVIDADES, HOJA1_SUBGRUPOS, VARIANTES_NOMBRE } from '../catalogo2026';
import { raiz } from '../buscador';
import { hijosDe, NODOS_2026, rutaActividad } from '../taxonomy';
import { normalizar } from '../text';
import type { NodoActividad } from '../types';

/**
 * C1b · Diagnóstico de COHERENCIA de una clasificación histórica (2025).
 *
 * La clasificación histórica se conserva como texto en sus cinco columnas (GrActividad,
 * Gr Comercio, Subgrupo de actividad, Actividad y Descripción). Este módulo solo la DIAGNOSTICA
 * usando la estructura del catálogo 2026 como referencia: nunca asigna nodos 2026, nunca
 * confirma la clasificación y nunca reasigna una combinación incoherente. El paso a 2026 sigue
 * siendo «Partir de 2025» (B5) con una equivalencia aprobada por la Cátedra o una elección humana.
 *
 * Servicios tiene una estructura distinta: en 2026 su «actividad» es una descripción del
 * subgrupo y el documento solo da ejemplos. Una «Actividad» 2025 de Servicios que coincide con
 * un ejemplo no es un error, sino una diferencia de estructura pendiente de la Cátedra.
 */

export interface ClasificacionHistorica {
  grupo?: string;
  grupoComercio?: string;
  subgrupo?: string;
  actividad?: string;
  descripcion?: string;
}

export type DiagnosticoClasificacion =
  | 'coherente' // la combinación existe en la estructura 2026 (no por ello se confirma)
  | 'coherente-subgrupo-sin-actividades' // subgrupo que no tiene actividades (p. ej. Discotecas)
  | 'coherente-con-descripcion' // subgrupo con actividades, sin actividad, pero con descripción
  | 'servicios-actividad-ejemplo' // Servicios: la actividad 2025 es un ejemplo del documento 2026
  | 'servicios-actividad-no-prevista' // Servicios: la actividad 2025 no figura entre los ejemplos
  | 'comercio-sin-grupo-comercio' // válida salvo que falta «Gr Comercio»
  | 'grupo-comercio-fuera-de-comercio' // «Gr Comercio» relleno en Hostelería o Servicios
  | 'grupo-desconocido'
  | 'sin-grupo'
  | 'sin-subgrupo'
  | 'subgrupo-inexistente-2026'
  | 'subgrupo-de-otro-grupo' // p. ej. «Servicios › Bares y Cafeterías»
  | 'grupo-comercio-no-corresponde'
  | 'actividad-no-pertenece' // p. ej. «Bares y Cafeterías › Bancos»
  | 'incompleta-sin-actividad'; // subgrupo con actividades, sin actividad ni descripción

export const CATEGORIA_DIAGNOSTICO: Record<DiagnosticoClasificacion, 'coherente' | 'estructura-servicios' | 'incompleta' | 'incoherente'> = {
  coherente: 'coherente',
  'coherente-subgrupo-sin-actividades': 'coherente',
  'coherente-con-descripcion': 'coherente',
  'servicios-actividad-ejemplo': 'estructura-servicios',
  'servicios-actividad-no-prevista': 'estructura-servicios',
  'comercio-sin-grupo-comercio': 'incompleta',
  'sin-grupo': 'incompleta',
  'sin-subgrupo': 'incompleta',
  'incompleta-sin-actividad': 'incompleta',
  'grupo-comercio-fuera-de-comercio': 'incoherente',
  'grupo-desconocido': 'incoherente',
  'subgrupo-inexistente-2026': 'incoherente',
  'subgrupo-de-otro-grupo': 'incoherente',
  'grupo-comercio-no-corresponde': 'incoherente',
  'actividad-no-pertenece': 'incoherente',
};

export interface ResultadoClasificacion {
  diagnostico: DiagnosticoClasificacion;
  mensaje: string;
  /** Valores no presentes en las listas históricas de Hoja1 (solo vocabulario; no es error). */
  fueraDeLista: ('subgrupo' | 'actividad')[];
}

/** Igualdad tolerante a mayúsculas, tildes y plural simple («Peluquerias» = «Peluquerías»). */
const igual = (a?: string, b?: string) => !!a && !!b && (normalizar(a) === normalizar(b) || raiz(a) === raiz(b));

const SUBGRUPOS_2026 = NODOS_2026.filter((n) => n.nivel === 3);
const GRUPOS = NODOS_2026.filter((n) => n.nivel === 1);
const H1_SUB = new Set(HOJA1_SUBGRUPOS.map(normalizar));
const H1_ACT = new Set(HOJA1_ACTIVIDADES.map(normalizar));

function nombreCanonico(t: string): string {
  for (const [canon, vars] of Object.entries(VARIANTES_NOMBRE)) if (igual(t, canon) || vars.some((v) => igual(t, v))) return canon;
  return t;
}

const ruta = (n: NodoActividad) => rutaActividad(n.id).map((x) => x.nombre).join(' › ');

const CACHE = new Map<string, ResultadoClasificacion>();

/** Diagnóstico (memorizado por combinación: los censos repiten mucho las mismas). */
export function diagnosticarClasificacion(c: ClasificacionHistorica): ResultadoClasificacion {
  const k = JSON.stringify([c.grupo, c.grupoComercio, c.subgrupo, c.actividad, !!c.descripcion]);
  let r = CACHE.get(k);
  if (!r) {
    if (CACHE.size > 5000) CACHE.clear();
    CACHE.set(k, (r = diagnosticar(c)));
  }
  return { ...r, fueraDeLista: [...r.fueraDeLista] };
}

function diagnosticar(c: ClasificacionHistorica): ResultadoClasificacion {
  const fueraDeLista: ResultadoClasificacion['fueraDeLista'] = [];
  if (c.subgrupo && !H1_SUB.has(normalizar(c.subgrupo))) fueraDeLista.push('subgrupo');
  if (c.actividad && !H1_ACT.has(normalizar(c.actividad))) fueraDeLista.push('actividad');
  const r = (diagnostico: DiagnosticoClasificacion, mensaje: string): ResultadoClasificacion => ({ diagnostico, mensaje, fueraDeLista });

  if (!c.grupo) return r('sin-grupo', 'Ocupado sin GrActividad.');
  const grupo = GRUPOS.find((g) => igual(nombreCanonico(c.grupo!), g.nombre));
  if (!grupo) return r('grupo-desconocido', `GrActividad «${c.grupo}» no es Comercio, Hostelería y Restauración ni Servicios.`);
  const esComercio = grupo.codigo === 'C';
  if (!esComercio && c.grupoComercio) return r('grupo-comercio-fuera-de-comercio', `«Gr Comercio» relleno («${c.grupoComercio}») en ${grupo.nombre}: solo corresponde a Comercio.`);
  if (!c.subgrupo) return r('sin-subgrupo', 'Sin «Subgrupo de actividad».');

  const candidatos = SUBGRUPOS_2026.filter((s) => igual(c.subgrupo, s.nombre));
  if (!candidatos.length) return r('subgrupo-inexistente-2026', `El subgrupo «${c.subgrupo}» no existe en la estructura 2026.`);
  const enGrupo = candidatos.filter((s) => rutaActividad(s.id)[0].id === grupo.id);
  if (!enGrupo.length) return r('subgrupo-de-otro-grupo', `El subgrupo «${c.subgrupo}» pertenece a ${ruta(candidatos[0]).split(' › ')[0]}, no a ${grupo.nombre}.`);
  let sub = enGrupo[0];
  if (esComercio && c.grupoComercio) {
    const gc = nombreCanonico(c.grupoComercio);
    const conGc = enGrupo.find((s) => igual(gc, rutaActividad(s.id)[1]?.nombre));
    if (!conGc) return r('grupo-comercio-no-corresponde', `«Gr Comercio» «${c.grupoComercio}» no corresponde al subgrupo «${c.subgrupo}» (${ruta(enGrupo[0])}).`);
    sub = conGc;
  }

  const hijos = hijosDe(sub.id);
  if (!c.actividad) {
    if (!hijos.length) return esComercio && !c.grupoComercio ? r('comercio-sin-grupo-comercio', 'Falta «Gr Comercio».') : r('coherente-subgrupo-sin-actividades', 'Subgrupo sin actividades en 2026.');
    if (c.descripcion) return esComercio && !c.grupoComercio ? r('comercio-sin-grupo-comercio', 'Falta «Gr Comercio».') : r('coherente-con-descripcion', 'Sin actividad, con descripción dentro del subgrupo.');
    return r('incompleta-sin-actividad', `El subgrupo «${c.subgrupo}» tiene actividades, pero no hay actividad ni descripción.`);
  }
  if (hijos.some((h) => igual(c.actividad, h.nombre))) {
    return esComercio && !c.grupoComercio ? r('comercio-sin-grupo-comercio', 'Combinación válida, pero falta «Gr Comercio».') : r('coherente', 'Combinación presente en la estructura 2026.');
  }
  if (!hijos.length && grupo.codigo === 'S') {
    const ejemplo = (sub.ejemplos ?? []).some((e) => igual(c.actividad, e) || normalizar(e).includes(normalizar(c.actividad!)));
    return ejemplo
      ? r('servicios-actividad-ejemplo', `Servicios: «${c.actividad}» es un ejemplo de «${sub.nombre}» en 2026 (allí es descripción, no actividad).`)
      : r('servicios-actividad-no-prevista', `Servicios: «${c.actividad}» no figura entre los ejemplos de «${sub.nombre}» en 2026.`);
  }
  if (!hijos.length) return r('actividad-no-pertenece', `El subgrupo «${c.subgrupo}» no tiene actividades en 2026, pero figura «${c.actividad}».`);
  return r('actividad-no-pertenece', `La actividad «${c.actividad}» no pertenece al subgrupo «${c.subgrupo}».`);
}
