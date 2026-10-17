import { esDudosa, type FilaOficina } from '../../domain/oficina';

/**
 * Tareas de Oficina. Las dos formas de trabajar (por tareas y por establecimiento) usan
 * EXACTAMENTE los mismos registros y estados: aquí solo se decide qué se ve y en qué orden.
 */
export type Tarea = 'categorizacion' | 'franquicias' | 'digital' | 'incidencias' | 'todos';

export type Filtro = 'pendientes' | 'errores' | 'incidencias' | 'revisados' | 'sin-visitar' | 'todos';

export interface DefTarea {
  id: Tarea;
  titulo: string;
  descripcion: string;
  /** Registros a los que se aplica la tarea. */
  aplica: (f: FilaOficina) => boolean;
  /** ¿Está pendiente esta tarea para el registro? null = la tarea no tiene estado propio todavía. */
  pendiente: ((f: FilaOficina) => boolean) | null;
  /** Aviso cuando la tarea no tiene todavía estado de verificación propio. */
  aviso?: string;
}

const registradoOcupado = (f: FilaOficina) => f.situacion === 'registrado' && !f.vacio;

export const TAREAS: DefTarea[] = [
  {
    id: 'categorizacion', titulo: 'Categorización', descripcion: 'Actividad de cada establecimiento ocupado',
    aplica: registradoOcupado, pendiente: (f) => f.rev.categorizacion !== 'revisado',
  },
  {
    id: 'franquicias', titulo: 'Franquicias', descripcion: 'Cadena o franquicia del establecimiento',
    aplica: registradoOcupado, pendiente: null,
    aviso: 'La verificación independiente de franquicias se incorporará en B5: por ahora se puede consultar y corregir la cadena, pero no se muestra progreso de verificación.',
  },
  {
    id: 'digital', titulo: 'Presencia digital', descripcion: 'Web, Google, reseñas y redes de esta campaña',
    aplica: registradoOcupado, pendiente: (f) => f.rev.digital !== 'revisado',
  },
  {
    id: 'incidencias', titulo: 'Incidencias y contradicciones', descripcion: 'Conciliación, dudosos, cronología incierta, duplicados, errores',
    aplica: (f) => f.incidencias.length > 0 || f.errores.length > 0 || esDudosa(f), pendiente: (f) => f.incidencias.length > 0 || f.errores.length > 0 || esDudosa(f),
  },
  {
    id: 'todos', titulo: 'Todos los registros', descripcion: 'Registrados y pendientes de visita',
    aplica: () => true, pendiente: (f) => tareasPendientes(f).length > 0,
  },
];

export const TAREA_POR_ID = Object.fromEntries(TAREAS.map((t) => [t.id, t])) as Record<Tarea, DefTarea>;

/** Tareas pendientes de un registro (para el modo por establecimiento y «siguiente pendiente»). */
export function tareasPendientes(f: FilaOficina): Tarea[] {
  if (f.situacion === 'pendiente-visita') return [];
  return (['categorizacion', 'digital', 'incidencias'] as Tarea[]).filter((t) => TAREA_POR_ID[t].aplica(f) && TAREA_POR_ID[t].pendiente?.(f));
}

export const FILTROS: { id: Filtro; titulo: string }[] = [
  { id: 'pendientes', titulo: 'Pendientes' },
  { id: 'errores', titulo: 'Con errores' },
  { id: 'incidencias', titulo: 'Con incidencias' },
  { id: 'revisados', titulo: 'Revisados' },
  { id: 'sin-visitar', titulo: 'Sin visitar' },
  { id: 'todos', titulo: 'Todos' },
];

export function aplicaFiltro(t: DefTarea, filtro: Filtro, f: FilaOficina): boolean {
  switch (filtro) {
    case 'pendientes':
      return t.pendiente ? t.pendiente(f) : true;
    case 'revisados':
      return t.pendiente ? !t.pendiente(f) : false;
    case 'errores':
      return f.errores.length > 0;
    case 'incidencias':
      return f.incidencias.length > 0;
    case 'sin-visitar':
      return f.situacion === 'pendiente-visita';
    default:
      return true;
  }
}

/** Filas de una tarea con un filtro (sin búsqueda). */
export function filasDeTarea(filas: FilaOficina[], tarea: Tarea, filtro: Filtro): FilaOficina[] {
  const t = TAREA_POR_ID[tarea];
  return filas.filter((f) => t.aplica(f) && aplicaFiltro(t, filtro, f));
}

/**
 * Siguiente registro (después de `desde`, dando la vuelta) que tiene pendiente la tarea activa;
 * en «Todos» o tareas sin estado propio, cualquier tarea pendiente. undefined si no queda ninguno.
 */
export function siguientePendiente(filas: FilaOficina[], desde: number, tarea: Tarea): FilaOficina | undefined {
  const t = TAREA_POR_ID[tarea];
  const pendiente = (f: FilaOficina) => (tarea !== 'todos' && t.pendiente ? t.aplica(f) && t.pendiente(f) : tareasPendientes(f).length > 0);
  for (let k = 1; k <= filas.length; k++) {
    const f = filas[(Math.max(desde, -1) + k + filas.length) % filas.length];
    if (f && pendiente(f) && (filas.length === 1 || filas.indexOf(f) !== desde)) return f;
  }
  return undefined;
}
