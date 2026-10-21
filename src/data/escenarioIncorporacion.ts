import type { BaseDatos } from '../domain/db';
import { claveCalle } from '../domain/text';
import type { Calle, Id } from '../domain/types';

/**
 * Callejero FICTICIO para simular C1c: añade al municipio calles con los nombres ficticios de los
 * libros de prueba («VÍA FICTICIA 001»…), sin geometría. Solo para pruebas y simulaciones en
 * memoria; no se usa en la aplicación.
 */
export function conCallesFicticias(db: BaseDatos, municipioId: Id, nombres: string[]): BaseDatos {
  const calles: Record<Id, Calle> = { ...db.calles };
  for (const nombre of nombres) {
    const id = `calle-ficticia-${claveCalle(nombre).replace(/[^a-z0-9]+/g, '-')}`;
    calles[id] = { id, municipioId, nombre, tipoVia: 'vía', segmentos: [], longitudM: 0, procedencia: 'simulado', refsFuente: ['escenario-incorporacion'] };
  }
  return { ...db, calles };
}

/** «VÍA FICTICIA 001» … «VÍA FICTICIA n». */
export const viasFicticias = (desde: number, hasta: number) => Array.from({ length: hasta - desde + 1 }, (_, i) => `VÍA FICTICIA ${String(desde + i).padStart(3, '0')}`);
