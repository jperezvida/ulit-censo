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

/**
 * v10 → v11 (B5): franquicias por negocio y campaña. Se añade el almacén vacío: NO se deduce
 * ninguna franquicia del nombre de cadena (pertenecer a una cadena no implica ser franquicia).
 * La revisión de franquicias queda pendiente en todos los registros; las aprobaciones
 * existentes no se tocan y se informan para revisarlas.
 */
export function migrarV10aV11(db: BaseDatos): { db: BaseDatos; aprobadasSinFranquicia: number } {
  const activas = new Set(Object.values(db.campanas).filter((c) => c.tipo !== 'historico-importado' && c.estados.validacion !== 'terminado').map((c) => c.id));
  const aprobadasSinFranquicia = Object.values(db.revisiones).filter((r) => activas.has(r.campanaId) && r.validacion === 'aprobada' && !r.franquicia).length;
  return { db: { ...db, franquicias: db.franquicias ?? {}, version: 11 }, aprobadasSinFranquicia };
}

/** Lleva cualquier versión soportada (9, 10) a la actual. */
export function migrarALaActual(db: BaseDatos): { db: BaseDatos; avisos: string[] } {
  const avisos: string[] = [];
  let d = db;
  if (d.version === 9) {
    const r = migrarV9aV10(d);
    d = r.db;
    const p = r.informes.reduce((a, i) => a + i.propuestas.length, 0);
    const s = r.informes.reduce((a, i) => a + i.sinEquivalencia.length, 0);
    if (p || s) avisos.push(`Catálogo 2026 aplicado: ${p} clasificación(es) convertidas en propuestas sin confirmar · ${s} sin equivalente (revisar en Oficina)`);
  }
  if (d.version === 10) {
    const r = migrarV10aV11(d);
    d = r.db;
    if (r.aprobadasSinFranquicia) avisos.push(`Franquicias: ${r.aprobadasSinFranquicia} registro(s) aprobados antes de B5 tienen la franquicia pendiente de revisar`);
  }
  return { db: d, avisos };
}
