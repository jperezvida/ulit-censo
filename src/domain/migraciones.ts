import type { BaseDatos } from './db';
import { migrarClasificacionesCampana, type InformeMigracion } from './clasificacion';
import { ID_CATALOGO_2026 } from './catalogo2026';

/**
 * Migraciones de la base local (datos de demostración guardados en el navegador).
 *
 * v9 → v10: las campañas de 2026 o posteriores pasan a usar el catálogo oficial
 * `clasificacion-2026@v1`. Sus clasificaciones con actividades del catálogo de demostración se
 * convierten en PROPUESTAS sin confirmar (con traza) solo si hay un equivalente de nombre idéntico
 * y único; el resto queda como estaba y se señala en Oficina. Las campañas anteriores (histórico)
 * no se tocan.
 */
export function asignarCatalogos(db: BaseDatos): { db: BaseDatos; informes: InformeMigracion[] } {
  let d: BaseDatos = { ...db, campanas: { ...db.campanas } };
  const informes: InformeMigracion[] = [];
  for (const c of Object.values(db.campanas)) {
    if (c.anio < 2026 || c.catalogoId) continue;
    d.campanas[c.id] = { ...c, catalogoId: ID_CATALOGO_2026 };
    const r = migrarClasificacionesCampana(d, c.id);
    d = r.db;
    informes.push(r.informe);
  }
  return { db: d, informes };
}

export function migrarV9aV10(db: BaseDatos): { db: BaseDatos; informes: InformeMigracion[] } {
  const r = asignarCatalogos(db);
  return { db: { ...r.db, version: 10 }, informes: r.informes };
}
