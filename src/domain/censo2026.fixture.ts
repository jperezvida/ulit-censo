import { osmVillaSintetica } from '../data/callejeroSintetico';
import { libroConFilas } from '../data/xlsxItinerarios';
import { crearBaseEspacio, PREFIJO } from './espacios';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from './municipios';
import { aplicarCarga } from './callejeros';
import { leerOsmMunicipio } from './fuentesCallejero';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion } from './incorporacion';
import { crearItinerario } from './campanaOperativa';
import type { BaseDatos } from './db';
import type { FilaSintetica } from '../data/xlsxItinerarios';

/** Censo 2025 SINTÉTICO: sin Olmo 1 (será alta en 2026), Olmo 7 con otro nombre, y Real 8, que IT1 de 2026 no recoge. */
export const FILAS_2025: FilaSintetica[] = [
  { calle: 'Calle del Olmo', num: 3, nombre: 'PANADERÍA SINTÉTICA', fecha: '2025-03-02' },
  { calle: 'Calle del Olmo', num: 3, nombre: 'PELUQUERÍA SINTÉTICA', fecha: '2025-03-02' },
  { calle: 'Calle del Olmo', num: 5, vacio: true, fachada: 6.5, fecha: '2025-03-03' },
  { calle: 'Calle del Olmo', num: 7, nombre: 'DROGUERÍA SINTÉTICA', fecha: '2025-03-03' },
  { calle: 'Calle Real', num: 2, nombre: 'ESTANCO SINTÉTICO', fecha: '2025-03-04' },
  { calle: 'Calle Real', num: 8, nombre: 'ZAPATERÍA SINTÉTICA', fecha: '2025-03-04' },
];

const P = PREFIJO.ensayo;
export const AHORA = '2026-10-28T10:00:00.000Z';

/** Espacio de ensayo SINTÉTICO: municipio, callejero, censo 2025 incorporado y campaña operativa 2026 con IT1 e IT2. */
export async function escenario() {
  let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Coordinación de Prueba', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'c26', ahora: AHORA, incluirMedina: false });
  const o = { prefijo: P, porId: db.meta.espacioCreadoPorId!, ahora: AHORA, anioActual: 2026 };
  const V = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
  const m = altaMunicipio(db, { ...V, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, o); db = m.db;
  const j = osmVillaSintetica(1); const l = leerOsmMunicipio(j, V); if (!l.ok) throw new Error(l.motivo);
  db = aplicarCarga(db, m.municipioId, l, { archivo: 'v.json', contenido: JSON.stringify(j), fuente: 'OpenStreetMap (Overpass API)' }, o).db;
  const h = crearCampana(db, { municipioId: m.municipioId, anio: 2025, nombre: 'Censo 2025', clase: 'historica' }, o); db = h.db;
  const d25 = { municipioId: m.municipioId, anio: 2025, campanaId: h.campanaId };
  const p25 = await prepararIncorporacion(db, await libroConFilas('IT1', FILAS_2025), 'censo_2025_SINTETICO.xlsx', d25, {});
  db = aplicarIncorporacion(db, p25.resultado, d25, {}, p25.plan, { porId: o.porId, ahora: AHORA }).db;
  const c = crearCampana(db, { municipioId: m.municipioId, anio: 2026, nombre: 'Censo 2026', clase: 'operativa', tipoOperativa: 'actualizacion', campanaReferenciaId: h.campanaId }, o); db = c.db;
  const its: Record<string, string> = {};
  for (const k of ['IT1', 'IT2']) { const r = crearItinerario(db, c.campanaId, { codigo: k }, o); db = r.db; its[k] = r.itinerarioId; }
  return { db, o, munId: m.municipioId, historica: h.campanaId, campanaId: c.campanaId, its };
}
export async function importar(db: BaseDatos, e: Awaited<ReturnType<typeof escenario>>, it: 'IT1' | 'IT2', bytes: Uint8Array, archivo: string) {
  const destino = { municipioId: e.munId, anio: 2026, campanaId: e.campanaId, itinerarioId: e.its[it] };
  const p = await prepararIncorporacion(db, bytes, archivo, destino, {});
  return { plan: p.plan, aplicar: () => aplicarIncorporacion(db, p.resultado, destino, {}, p.plan, { porId: e.o.porId, ahora: AHORA }) };
}

export const historico = (db: BaseDatos, campanaId: string) => JSON.stringify([
  Object.values(db.observaciones).filter((o) => o.campanaId === campanaId),
  Object.values(db.ocupaciones).filter((o) => o.desdeCampanaId === campanaId),
  Object.values(db.locales).filter((l) => Object.values(db.observaciones).some((o) => o.localId === l.id && o.campanaId === campanaId)),
]);

