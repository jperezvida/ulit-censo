import type { BaseDatos } from './db';
import { claseCampana } from './municipios';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion } from './incorporacion';
import { itinerariosDe } from './campanaOperativa';
import type { Id } from './types';

/**
 * Prepara TODOS los Excel operativos en memoria, usando el mismo importador de
 * siempre para cada archivo. Solo se devuelve la base final si TODOS los planes
 * son aplicables; la función nunca escribe en Supabase ni IndexedDB.
 */
export interface ExcelLote {
  nombre: string;
  bytes: Uint8Array;
  itinerarioId: Id;
}
export interface ArchivoPreparadoLote {
  nombre: string;
  itinerario: string;
  filas: number;
  vinculados: number;
  pendientes: number;
  cruces: number;
  detallesCruces?: { fila: number; tipo: string; itinerario: string; detalle: string }[];
  sha256: string;
  aplicable: boolean;
  avisos: string[];
}
export interface LotePreparado {
  aplicable: boolean;
  archivos: ArchivoPreparadoLote[];
  totalFilas: number;
  totalPendientes: number;
  /** Solo para ensayo o futura ruta operativa autorizada: nunca escribir desde el análisis. */
  dbResultado: BaseDatos | null;
}

/** Solo propone una asignación cuando hay un ÚNICO código de itinerario en el nombre. */
export function itinerarioDesdeNombre(nombre: string, codigos: { id: Id; codigo: string }[]): Id | null {
  const base = nombre.replace(/\.xlsx$/i, '');
  const encontrados = [...base.matchAll(/(?:^|[^a-z0-9])(?:it|itinerario)[\s_.-]*0*(\d{1,4})(?=$|[^a-z0-9])/gi)]
    .map((m) => 'IT' + Number(m[1]));
  const unicos = [...new Set(encontrados)];
  if (unicos.length !== 1) return null;
  const opciones = codigos.filter((c) => c.codigo.trim().toUpperCase() === unicos[0]);
  return opciones.length === 1 ? opciones[0].id : null;
}

export async function prepararLoteItinerarios(
  inicial: BaseDatos,
  campanaId: Id,
  archivos: ExcelLote[],
  porId: Id,
  permitirPartes: boolean,
): Promise<LotePreparado> {
  const campana = inicial.campanas[campanaId];
  if (!campana || claseCampana(campana) !== 'operativa') throw new Error('Seleccione una campaña operativa existente.');
  if (!inicial.personas[porId]) throw new Error('La persona que incorpora el lote no está registrada.');
  if (archivos.length < 1 || archivos.length > 30) throw new Error('Seleccione entre 1 y 30 Excel por lote.');
  const disponibles = new Set(itinerariosDe(inicial, campanaId).map((i) => i.id));
  let trabajo = inicial;
  const informes: ArchivoPreparadoLote[] = [];
  let bloqueado = false;
  const shaVistos = new Set<string>();
  for (const archivo of archivos) {
    if (!disponibles.has(archivo.itinerarioId) || !/^.+\.xlsx$/i.test(archivo.nombre)) {
      informes.push({ nombre: archivo.nombre, itinerario: '—', filas: 0, vinculados: 0, pendientes: 0, cruces: 0,
        sha256: '', aplicable: false, avisos: ['El archivo debe ser un XLSX y estar asignado a un itinerario de esta campaña.'] });
      bloqueado = true;
      continue;
    }
    const itinerario = inicial.itinerarios[archivo.itinerarioId];
    const yaIncorporado = Object.values(trabajo.importaciones).some(
      (imp) => imp.estado === 'confirmada' && imp.campanaId === campanaId && imp.c1?.itinerario?.id === archivo.itinerarioId,
    );
    const destino = { municipioId: campana.municipioId, anio: campana.anio, campanaId,
      itinerarioId: archivo.itinerarioId, ...(yaIncorporado && permitirPartes ? { continuacionItinerario: true } : {}) };
    try {
      const { resultado, plan } = await prepararIncorporacion(trabajo, archivo.bytes, archivo.nombre, destino);
      const bloqueos = plan.bloqueos.map((b) => b.mensaje);
      if (shaVistos.has(plan.archivo.sha256)) bloqueos.push('El mismo Excel aparece dos veces en este lote.');
      shaVistos.add(plan.archivo.sha256);
      const aceptable = plan.aplicable && !bloqueos.length;
      informes.push({
        nombre: archivo.nombre, itinerario: itinerario.codigo, filas: plan.registros.previstos,
        vinculados: plan.correspondencias.inequivoca + plan.correspondencias.decidida,
        pendientes: plan.correspondencias.ambigua + plan.correspondencias['sin-vinculo'],
        cruces: plan.cruces?.length ?? 0, detallesCruces: plan.cruces ?? [], sha256: plan.archivo.sha256, aplicable: aceptable,
        avisos: [...bloqueos, ...plan.pendientes, ...(yaIncorporado && permitirPartes ? ['Parte adicional del mismo itinerario: no se sobrescribe el archivo anterior.'] : [])],
      });
      if (!aceptable) { bloqueado = true; continue; }
      // Simulación SECUENCIAL: IT2 se calcula contra el resultado de IT1 y
      // señala solapamientos sin fusionarlos. Ningún resultado se persiste.
      trabajo = aplicarIncorporacion(trabajo, resultado, destino, {}, plan, { porId }).db;
    } catch (e) {
      bloqueado = true;
      informes.push({
        nombre: archivo.nombre, itinerario: itinerario.codigo, filas: 0, vinculados: 0,
        pendientes: 0, cruces: 0, sha256: '', aplicable: false,
        avisos: [e instanceof Error ? e.message : String(e)],
      });
    }
  }
  return {
    aplicable: !bloqueado && informes.length === archivos.length,
    archivos: informes, totalFilas: informes.reduce((n, p) => n + p.filas, 0),
    totalPendientes: informes.reduce((n, p) => n + p.pendientes, 0),
    dbResultado: bloqueado ? null : trabajo,
  };
}
