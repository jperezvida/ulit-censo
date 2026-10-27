import { kNC, kRev, type BaseDatos } from '../domain/db';
import type { Id, Respuesta } from '../domain/types';

/** Número estable a partir de un identificador (sin alterar los generadores aleatorios). */
function huella(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Franquicias FICTICIAS de una campaña histórica (referencia para 2026). A propósito, no se
 * deducen del nombre de cadena: hay cadenas que no son franquicia, franquicias sin cadena
 * registrada, algún «sin información» y negocios sin dato.
 */
export function franquiciasHistoricas(db: BaseDatos, campanaId: Id): BaseDatos {
  const franquicias = { ...db.franquicias };
  const revisiones = { ...db.revisiones };
  const fecha = `${db.campanas[campanaId]?.anio ?? 2025}-10-15T10:00:00`;
  const localDe = new Map<Id, Id>();
  for (const o of Object.values(db.ocupaciones)) if (o.negocioId && o.desdeCampanaId === campanaId) localDe.set(o.negocioId, o.localId);
  for (const c of Object.values(db.clasificaciones)) {
    if (c.campanaId !== campanaId) continue;
    const h = huella(c.negocioId) % 20;
    if (h === 0) continue; // sin dato
    const cadena = !!db.negocios[c.negocioId]?.cadena;
    const respuesta: Respuesta = h === 1 ? 'sin-info' : cadena ? (h % 4 === 0 ? 'no' : 'si') : h === 2 || h === 3 ? 'si' : 'no';
    franquicias[kNC(c.negocioId, campanaId)] = { negocioId: c.negocioId, campanaId, respuesta, origen: 'importado', fecha, historial: [{ respuesta, origen: 'importado', fecha }] };
    const l = localDe.get(c.negocioId);
    const kr = l ? kRev(campanaId, l) : undefined;
    if (kr && revisiones[kr]) revisiones[kr] = { ...revisiones[kr], franquicia: 'revisado' };
  }
  return { ...db, franquicias, revisiones };
}
