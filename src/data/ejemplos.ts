import type { BaseDatos } from '../domain/db';
import { direccionVigente, localesPrevios, ocupacionEn } from '../domain/consultas';
import { rutaActividad } from '../domain/taxonomy';
import type { Id, Itinerario } from '../domain/types';
import { crearRng } from './rng';
import { nombreNegocio } from './nombres';

/** Cabeceras con la forma del censo original de Medina (indicador de vacío 0.0/1.0). */
const CAB = ['Calle', 'Número', 'Nombre del negocio', 'Local Vacío', 'Long fachada', 'GrActividad', 'Gr Comercio', 'Subgrupo de actividad', 'Actividad'];
const linea = (v: string[]): string =>
  v
    .map((x, i) => (i === 3 ? (x === 'Vacío' ? '1.0' : '0.0') : x))
    .map((x) => (/[;"]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x))
    .join(';');

/**
 * CSV de EJEMPLO (simulado) de un Excel de itinerario pasado a limpio:
 * incluye filas sin cambios, cambios, altas, una calle ajena al itinerario,
 * una calle inexistente y un duplicado. La calle solo aparece en la primera fila
 * de cada bloque, como en el Excel tradicional.
 */
export function csvEjemploItinerario(db: BaseDatos, it: Itinerario): string {
  const rng = crearRng('csv-ejemplo-' + it.id);
  const camp = db.campanas[it.campanaId];
  const filas: string[][] = [];
  for (const t of it.tramos.slice(0, 4)) {
    const calle = db.calles[t.calleId];
    const previos = localesPrevios(db, camp.campanaReferenciaId, t.calleId).slice(0, 6);
    let primera = true;
    for (const l of previos) {
      const d = direccionVigente(l);
      const oc = ocupacionEn(db, l.id, camp.campanaReferenciaId!);
      const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
      const r = rng.next();
      let nombre = neg?.nombre ?? '';
      let vacio = !neg;
      if (r > 0.75) {
        nombre = nombreNegocio(rng, 'Cafetería');
        vacio = false;
      } else if (r > 0.6) {
        nombre = '';
        vacio = true;
      }
      const ruta = rutaActividad(neg?.actividadId);
      filas.push([primera ? calle.nombre : '', `${d.numero ?? ''}${d.sufijo ? ' ' + d.sufijo : ''}`, nombre, vacio ? 'Vacío' : 'Ocupado', vacio ? String(rng.int(3, 9)) : '', ...(vacio || r > 0.75 ? ['', '', '', ''] : ruta.map((x) => x.nombre))]);
      primera = false;
    }
    filas.push([primera ? calle.nombre : '', String((previos.length ? Math.max(...previos.map((l) => direccionVigente(l).numero ?? 0)) : 0) + 2), nombreNegocio(rng, 'Floristería'), 'Ocupado', '', 'Comercio', 'Otro comercio', 'Cultura y ocio', 'Floristería']);
  }
  if (filas.length > 2) filas.push([...filas[filas.length - 2]].map((v, i) => (i === 0 ? db.calles[it.tramos[Math.min(3, it.tramos.length - 1)].calleId].nombre : v)));
  const ajena = Object.values(db.itinerarios).find((x) => x.campanaId === it.campanaId && x.id !== it.id)?.tramos[0];
  if (ajena) filas.push([db.calles[ajena.calleId].nombre, '1', 'Comercio de otra calle', 'Ocupado', '', '', '', '', '']);
  filas.push(['C/ Inexistente del Ejemplo', '4', 'Bar Desconocido', 'Ocupado', '', '', '', '', '']);
  return '﻿' + [CAB.join(';'), ...filas.map(linea)].join('\r\n');
}

/** CSV de EJEMPLO (simulado) con la forma de un censo histórico completo. */
export function csvEjemploHistorico(db: BaseDatos, municipioId: Id): string {
  const rng = crearRng('csv-historico-' + municipioId);
  const calles = Object.values(db.calles).filter((c) => c.municipioId === municipioId && c.segmentos.length).slice(0, 8);
  const filas: string[][] = [];
  for (const c of calles) {
    let n = rng.int(1, 3);
    for (let k = 0; k < rng.int(3, 7); k++) {
      const vacio = rng.chance(0.2);
      filas.push([k === 0 ? c.nombre : '', String(n), vacio ? '' : nombreNegocio(rng, rng.pick(['Bar', 'Peluquería', 'Farmacia', 'Zapatería', 'Panadería'])), vacio ? 'Vacío' : 'Ocupado', vacio ? String(rng.int(3, 10)) : '', '', '', '', '']);
      n += rng.int(1, 2) * 2;
    }
  }
  filas.push(['Pza. Inventada', '2', 'Tienda sin calle reconocida', 'Ocupado', '', '', '', '', '']);
  return '﻿' + [CAB.join(';'), ...filas.map(linea)].join('\r\n');
}
