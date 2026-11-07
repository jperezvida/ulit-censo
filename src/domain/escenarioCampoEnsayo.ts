import { osmVillaSintetica } from '../data/callejeroSintetico';
import { archivoItinerario, libroItinerario } from '../data/xlsxItinerarios';
import { crearBaseEspacio, PREFIJO } from './espacios';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from './municipios';
import { aplicarCarga } from './callejeros';
import { leerOsmMunicipio } from './fuentesCallejero';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion } from './incorporacion';
import { crearItinerario } from './campanaOperativa';
import { direccionVigente } from './consultas';

/**
 * Escenario SINTÉTICO para Campo en el ensayo: censo anterior 2025 (Excel IT1 sintético) y campaña
 * operativa 2026 que lo toma como referencia, con IT1 (Calle del Olmo, impares) asignado a una
 * investigadora. Solo para pruebas.
 */
const P = PREFIJO.ensayo;
export const AHORA = '2026-10-27T10:00:00.000Z';
export const INVESTIGADORA = `${P}-per-investigadora-sintetica`;

/** Censo anterior 2025 (histórico, Excel IT1 sintético) y campaña operativa 2026 que lo toma de referencia, con IT1 asignado a una investigadora. */
export async function escenarioSinCambios() {
  let db = crearBaseEspacio('ensayo', { persona: { nombre: 'Coordinación de Prueba', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'campo-w', ahora: AHORA, incluirMedina: false });
  const coordinadora = db.meta.espacioCreadoPorId!;
  const o = { prefijo: P, porId: coordinadora, ahora: AHORA, anioActual: 2026 };
  const V = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
  const m = altaMunicipio(db, { ...V, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, o); db = m.db;
  const j = osmVillaSintetica(1); const l = leerOsmMunicipio(j, V); if (!l.ok) throw new Error(l.motivo);
  db = aplicarCarga(db, m.municipioId, l, { archivo: 'v.json', contenido: JSON.stringify(j), fuente: 'OpenStreetMap (Overpass API)' }, o).db;
  const h = crearCampana(db, { municipioId: m.municipioId, anio: 2025, nombre: 'Censo 2025', clase: 'historica' }, o); db = h.db;
  const destino = { municipioId: m.municipioId, anio: 2025, campanaId: h.campanaId };
  const p = await prepararIncorporacion(db, await libroItinerario('IT1'), archivoItinerario('IT1'), destino, {});
  db = aplicarIncorporacion(db, p.resultado, destino, {}, p.plan, { porId: coordinadora, ahora: AHORA }).db;
  const c = crearCampana(db, { municipioId: m.municipioId, anio: 2026, nombre: 'Censo 2026', clase: 'operativa', tipoOperativa: 'actualizacion' }, o); db = c.db;
  db = { ...db, campanas: { ...db.campanas, [c.campanaId]: { ...db.campanas[c.campanaId], campanaReferenciaId: h.campanaId } } };
  const it = crearItinerario(db, c.campanaId, { codigo: 'IT1' }, o); db = it.db;
  const otro = crearItinerario(db, c.campanaId, { codigo: 'IT2' }, o); db = otro.db;
  const calle = (n: string) => Object.values(db.calles).find((x) => x.nombre === n)!;
  const olmo = calle('Calle del Olmo');
  db = {
    ...db,
    personas: { ...db.personas, [INVESTIGADORA]: { id: INVESTIGADORA, nombre: 'Investigadora Sintética', iniciales: 'IS', roles: ['investigador'], color: '#0b7a53' } },
    itinerarios: {
      ...db.itinerarios,
      [it.itinerarioId]: { ...db.itinerarios[it.itinerarioId], asignadosIds: [INVESTIGADORA], tramos: [{ calleId: olmo.id, acera: 'impar', orden: 1 }] },
      [otro.itinerarioId]: { ...db.itinerarios[otro.itinerarioId], asignadosIds: [INVESTIGADORA], tramos: [{ calleId: calle('Calle Real').id, acera: 'ambas', orden: 1 }] },
    },
  };
  const localEn = (calleId: string, numero: number) => Object.values(db.locales).find((x) => direccionVigente(x).calleId === calleId && direccionVigente(x).numero === numero && Object.values(db.observaciones).some((ob) => ob.localId === x.id && ob.campanaId === h.campanaId))!;
  return { db, campanaId: c.campanaId, historica: h.campanaId, it: it.itinerarioId, otro: otro.itinerarioId, olmo, real: calle('Calle Real'), coordinadora, local1: localEn(olmo.id, 1), localReal: localEn(calle('Calle Real').id, 2) };
}

