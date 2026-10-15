import type { BaseDatos } from './db';
import { kMet } from './db';
import { direccionVigente, indiceObservaciones, indiceOcupaciones, observacionEn, ocupacionEn } from './consultas';
import { rutaActividad } from './taxonomy';
import type { Id } from './types';

/** Columnas con la estructura del censo tradicional (provisional hasta recibir el Excel real). */
export const COLUMNAS_TRADICIONALES = [
  'Calle', 'Número', 'Nombre', 'Estado', 'Metros fachada', 'Grupo de actividad', 'Grupo de comercio', 'Subgrupo de actividad',
  'Actividad', 'Cadena', 'Web', 'Venta online', 'Google Business', 'Valoración', 'Reseñas Google', 'Responde reseñas', 'Instagram',
  'Seguidores IG', 'Facebook', 'Digital verificada', 'Fecha comprobación digital', 'Itinerario', 'Fuente', 'Validación',
] as const;

export interface FiltroExport {
  calleIds?: Set<Id>;
  itinerarioId?: Id;
}

export function filasExport(db: BaseDatos, campanaId: Id, filtro: FiltroExport = {}): Record<string, string>[] {
  const camp = db.campanas[campanaId];
  if (!camp) return [];
  const ixO = indiceObservaciones(db);
  const ixOc = indiceOcupaciones(db);
  const itPorCalle = new Map<Id, string>();
  for (const it of Object.values(db.itinerarios)) if (it.campanaId === campanaId) for (const t of it.tramos) itPorCalle.set(t.calleId, it.codigo);
  let calles = filtro.calleIds;
  if (filtro.itinerarioId) calles = new Set(db.itinerarios[filtro.itinerarioId]?.tramos.map((t) => t.calleId) ?? []);
  const out: { orden: [string, number, string]; fila: Record<string, string> }[] = [];
  for (const l of Object.values(db.locales)) {
    if (l.municipioId !== camp.municipioId) continue;
    const o = observacionEn(ixO.get(l.id), campanaId);
    if (!o || o.tipo === 'posible-desaparicion') continue;
    const d = direccionVigente(l);
    if (calles && !calles.has(d.calleId)) continue;
    const oc = ocupacionEn(db, l.id, campanaId, ixOc);
    const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
    const r = rutaActividad(neg?.actividadId);
    const m = neg ? db.metricas[kMet(neg.id, campanaId)] : undefined;
    const rev = db.revisiones[`${campanaId}|${l.id}`];
    const b = (v?: boolean) => (v === undefined ? '' : v ? 'Sí' : 'No');
    const calle = db.calles[d.calleId]?.nombre ?? '';
    out.push({
      orden: [calle, d.numero ?? 9999, d.sufijo ?? ''],
      fila: {
        Calle: calle, 'Número': `${d.numero ?? 's/n'}${d.sufijo ? ' ' + d.sufijo : ''}`, Nombre: neg?.nombre ?? '', Estado: neg ? 'Ocupado' : 'Vacío',
        'Metros fachada': oc?.metrosFachada ? String(oc.metrosFachada) : '', 'Grupo de actividad': r[0]?.nombre ?? '', 'Grupo de comercio': r[1]?.nombre ?? '',
        'Subgrupo de actividad': r[2]?.nombre ?? '', Actividad: r[3]?.nombre ?? '', Cadena: neg?.cadena ?? '',
        Web: m?.web ?? '', 'Venta online': b(m?.ventaOnline), 'Google Business': b(m?.googleBusiness), 'Valoración': m?.valoracion ? String(m.valoracion).replace('.', ',') : '',
        'Reseñas Google': m?.numResenas !== undefined ? String(m.numResenas) : '', 'Responde reseñas': b(m?.respondeResenas), Instagram: m?.instagram ?? '',
        'Seguidores IG': m?.seguidoresInstagram !== undefined ? String(m.seguidoresInstagram) : '', Facebook: m?.facebook ?? '',
        'Digital verificada': m ? (m.verificada ? 'Sí' : 'No') : '', 'Fecha comprobación digital': m?.fechaComprobacion?.slice(0, 10) ?? '',
        Itinerario: itPorCalle.get(d.calleId) ?? '', Fuente: o.fuente, 'Validación': rev?.validacion ?? 'pendiente',
      },
    });
  }
  return out
    .sort((a, b) => a.orden[0].localeCompare(b.orden[0], 'es') || a.orden[1] - b.orden[1] || a.orden[2].localeCompare(b.orden[2]))
    .map((x) => x.fila);
}

/** CSV compatible con Excel en español: separador «;», BOM UTF-8 y comillas cuando hace falta. */
export function aCSV(filas: Record<string, string>[], columnas: readonly string[] = COLUMNAS_TRADICIONALES): string {
  const esc = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + [columnas.join(';'), ...filas.map((f) => columnas.map((c) => esc(f[c] ?? '')).join(';'))].join('\r\n');
}

export function descargar(nombre: string, contenido: string, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
