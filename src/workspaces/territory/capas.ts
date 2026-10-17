import type { FeatureCollection, LineString, Point } from 'geojson';
import type { BaseDatos } from '../../domain/db';
import {
  coberturaCalle, direccionVigente, observacionEn, ocupacionEn, type IndiceObservaciones, type IndiceOcupaciones,
} from '../../domain/consultas';
import type { Campana, Id, Itinerario } from '../../domain/types';
import { COLOR_GRUPO, grupoActividad } from '../../domain/taxonomy';
import { clasificacionEn } from '../../domain/clasificacion';

export type Capa = 'plan' | 'cobertura' | 'actividad';

/** Una entidad por segmento cartográfico, con todo lo necesario para estilizar cada capa. */
export function geojsonCalles(
  db: BaseDatos, municipioId: Id, campana: Campana | undefined, itinerarios: Itinerario[], itSelId: Id | null,
  sinPrevios: Set<Id>,
): FeatureCollection<LineString> {
  const ambito = new Set(campana?.ambitoCalleIds ?? []);
  const ampliacion = new Set(campana?.ampliacionCalleIds ?? []);
  // asignaciones por segmento
  const asig = new Map<string, Itinerario[]>();
  for (const it of itinerarios) {
    for (const t of it.tramos) {
      const c = db.calles[t.calleId];
      if (!c) continue;
      const segs = t.segmentoIds?.length ? t.segmentoIds : c.segmentos.map((s) => s.id);
      for (const s of segs) {
        const k = `${c.id}|${s}`;
        asig.set(k, [...(asig.get(k) ?? []), it]);
      }
    }
  }
  const features: FeatureCollection<LineString>['features'] = [];
  for (const c of Object.values(db.calles)) {
    if (c.municipioId !== municipioId || !c.segmentos.length) continue;
    const cob = campana ? coberturaCalle(db, campana.id, c.id).estado : 'pendiente';
    for (const s of c.segmentos) {
      const its = asig.get(`${c.id}|${s.id}`) ?? [];
      const distintos = [...new Set(its.map((i) => i.id))];
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.coords },
        properties: {
          calleId: c.id,
          segId: s.id,
          nombre: c.nombre,
          ambito: ambito.has(c.id) ? 1 : 0,
          ampliacion: ampliacion.has(c.id) ? 1 : 0,
          asignado: Math.min(2, its.length),
          solape: its.length > 1 ? 1 : 0,
          colorPlan: distintos.length === 1 ? its[0].color : distintos.length > 1 ? '#e03131' : '#8a97ab',
          enSel: itSelId && its.some((i) => i.id === itSelId) ? 1 : 0,
          cob,
          sinPrevios: sinPrevios.has(c.id) ? 1 : 0,
        },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

export function geojsonLocales(
  db: BaseDatos, municipioId: Id, campana: Campana | undefined, ix: { obs: IndiceObservaciones; ocu: IndiceOcupaciones },
): FeatureCollection<Point> {
  const features: FeatureCollection<Point>['features'] = [];
  if (!campana) return { type: 'FeatureCollection', features };
  const ref = campana.campanaReferenciaId;
  for (const l of Object.values(db.locales)) {
    if (l.municipioId !== municipioId || !l.coord) continue;
    const obs = ix.obs.get(l.id);
    const actual = observacionEn(obs, campana.id);
    const previa = ref ? observacionEn(obs, ref) : undefined;
    if (!actual && !previa) continue;
    const campDatos = actual ? campana.id : ref!;
    const oc = ocupacionEn(db, l.id, campDatos, ix.ocu);
    const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
    const g = grupoActividad(clasificacionEn(db, neg?.id, campDatos)?.actividadId);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: l.coord },
      properties: {
        localId: l.id,
        nombre: neg?.nombre ?? 'Vacío',
        vacio: neg ? 0 : 1,
        color: g ? COLOR_GRUPO[g.id] ?? '#5c6b80' : '#5c6b80',
        actualizado: actual ? 1 : 0,
        dudoso: actual && (actual.tipo === 'dudoso' || actual.tipo === 'posible-desaparicion') ? 1 : 0,
        numero: direccionVigente(l).numero ?? '',
      },
    });
  }
  return { type: 'FeatureCollection', features };
}
