import type { BaseDatos } from './db';
import { crearItinerario, itinerariosDe } from './campanaOperativa';
import { prepararLoteItinerarios, type LotePreparado } from './loteItinerarios';
import { esArchivoSintetico } from '../data/xlsxSinteticoC1e';
import type { Id, RegistroOrigen } from './types';

/** Un itinerario operativo NO requiere otro espacio de trabajo ni campaña. */
export function codigoItinerarioExcel(nombre: string): string | null {
  const base = nombre.replace(/\.xlsx$/i, '');
  const codigos = [...base.matchAll(/(?:^|[^a-z\d])(?:itinerario|it)[\s_.-]*0*(\d{1,3})(?=$|[^a-z\d])/gi)]
    .map((m) => `IT${Number(m[1])}`);
  const unicos = [...new Set(codigos)];
  return unicos.length === 1 && unicos[0] !== 'IT0' ? unicos[0] : null;
}

export function validarDestinoExcel(db: BaseDatos, campanaId: Id, codigo: string, parteAdicional: boolean): {
  itinerarioId: Id | null; codigo: string; yaIncorporado: boolean; error: string | null;
} {
  const valor = codigo.trim().toUpperCase();
  if (!/^IT[1-9]\d{0,2}$/.test(valor)) return { itinerarioId: null, codigo: valor, yaIncorporado: false, error: 'Indique el itinerario como IT2, IT3, IT4…' };
  const campana = db.campanas[campanaId];
  if (!campana || campana.tipo === 'historico-importado' || campana.anio !== 2026)
    return { itinerarioId: null, codigo: valor, yaIncorporado: false, error: 'Seleccione primero la campaña operativa de 2026.' };
  const it = itinerariosDe(db, campanaId).find((i) => i.codigo.toUpperCase() === valor);
  const yaIncorporado = Object.values(db.importaciones).some((imp) =>
    imp.campanaId === campanaId && imp.estado === 'confirmada' && (it
      ? (imp.c1?.itinerario?.id === it.id || Object.values(db.registros).some((r) => r.importacionId === imp.id && r.itinerarioId === it.id))
      : false));
  if (yaIncorporado && !parteAdicional)
    return { itinerarioId: it?.id ?? null, codigo: valor, yaIncorporado, error: `${valor} ya tiene Excel incorporado: active «Parte adicional» solo si es otro archivo de campo, no una versión corregida del mismo.` };
  return { itinerarioId: it?.id ?? null, codigo: valor, yaIncorporado, error: null };
}

export interface PreparacionExcelReal {
  codigo: string;
  itinerarioId: Id;
  creaItinerario: boolean;
  lote: LotePreparado;
  /** Solo registros creados por este análisis; nunca incluye filas antiguas. */
  filasNuevas: RegistroOrigen[];
  huella: string;
}

export async function prepararExcelReal(
  db: BaseDatos, campanaId: Id, personaId: Id,
  nombre: string, bytes: Uint8Array, codigo: string, parteAdicional: boolean,
): Promise<PreparacionExcelReal> {
  if (!/^.+\.xlsx$/i.test(nombre)) throw new Error('Se requiere un Excel .xlsx.');
  if (esArchivoSintetico(bytes)) throw new Error('No se permite incorporar un Excel ficticio en la campaña real.');
  const destino = validarDestinoExcel(db, campanaId, codigo, parteAdicional);
  if (destino.error) throw new Error(destino.error);
  // Itinerario nuevo SOLO sobre una copia en memoria; no crea nada en Supabase.
  const preparado = destino.itinerarioId
    ? { db, itinerarioId: destino.itinerarioId }
    : crearItinerario(db, campanaId, { codigo: destino.codigo, nombre: `Itinerario ${destino.codigo}` }, { prefijo: 'real', porId: personaId });
  const lote = await prepararLoteItinerarios(preparado.db, campanaId,
    [{ nombre, bytes, itinerarioId: preparado.itinerarioId }], personaId, parteAdicional);
  const informe = lote.archivos[0];
  const yaImportado = Object.values(db.importaciones).some((i) =>
    i.campanaId === campanaId && i.estado === 'confirmada' && i.huella === informe?.sha256);
  if (yaImportado) throw new Error('Este Excel ya está incorporado en la campaña (misma huella SHA-256). No se duplican los registros.');
  const importacionesOriginales = new Set(Object.keys(db.importaciones));
  const idsNuevos = new Set(Object.values(lote.dbResultado?.importaciones ?? {})
    .filter((i) => !importacionesOriginales.has(i.id) && i.campanaId === campanaId)
    .map((i) => i.id));
  const filasNuevas = Object.values(lote.dbResultado?.registros ?? {})
    .filter((r) => idsNuevos.has(r.importacionId) && r.itinerarioId === preparado.itinerarioId)
    .sort((a, b) => a.fila - b.fila);
  return { codigo: destino.codigo, itinerarioId: preparado.itinerarioId,
    creaItinerario: !destino.itinerarioId, lote, filasNuevas, huella: informe?.sha256 ?? '' };
}

function original(registro: RegistroOrigen, campo: string): string {
  const clave = Object.keys(registro.datos).find((k) =>
    k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === campo.toLowerCase());
  return clave ? registro.datos[clave] ?? '' : '';
}

/** Vista de datos originales; SIN deducir vínculos, altas o cierres a partir de vacíos. */
export function filaPreviaExcel(r: RegistroOrigen) {
  return {
    fila: r.fila,
    calle: original(r, 'direccion'),
    numero: original(r, 'num'),
    negocio: original(r, 'nombre del negocio'),
    actividad: original(r, 'actividad'),
    vacio: original(r, 'local vacio'),
  };
}
