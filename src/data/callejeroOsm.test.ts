// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { cargarCallejeroMedina, CALLES_DESDE_CERO_IT2, callejeroSimulado, MEDINA } from './callejero';
import { normalizarOverpass, validarInstantanea } from './instantaneaOsm';
import { instantaneaSintetica } from './fixtureOsmSintetico';
import { generarDemo } from './semilla';
import { datosCampana, resumen } from '../domain/panel';
import { clavePortal, posicionesEstablecimientos, recorridoCalle } from '../domain/posiciones';
import { distanciaM, distanciaPuntoLinea } from '../domain/geo';
import { claveCalle } from '../domain/text';
import type { Calle } from '../domain/types';

const respuesta = (json: unknown, ok = true) => ({ ok, headers: new Headers({ 'content-type': 'application/json' }), json: async () => json }) as unknown as Response;

afterEach(() => vi.unstubAllGlobals());

describe('Callejero OSM · instantánea reproducible', () => {
  it('normaliza una respuesta de Overpass: solo vías con nombre y tipo admitido, etiquetas mínimas, orden estable', () => {
    const inst = instantaneaSintetica();
    const ruido = [
      { type: 'node', id: 1, lat: 41.31, lon: -4.91 },
      { type: 'way', id: 2, tags: { highway: 'residential' }, geometry: [{ lat: 41.31, lon: -4.91 }, { lat: 41.311, lon: -4.911 }] },
      { type: 'way', id: 3, tags: { name: 'Camino', highway: 'track' }, geometry: [{ lat: 41.31, lon: -4.91 }, { lat: 41.311, lon: -4.911 }] },
      { ...inst.elements[0], tags: { ...inst.elements[0].tags, surface: 'asphalt', 'addr:street': 'x' } as never },
    ];
    const n = normalizarOverpass({ elements: [...[...inst.elements].reverse(), ...ruido] });
    expect(n).toEqual(normalizarOverpass({ elements: inst.elements }));
    expect(n.every((v) => Object.keys(v.tags).sort().join() === 'highway,name')).toBe(true);
  });

  it('valida licencia ODbL, atribución, cobertura y zona; agrupa las vías de cada calle', () => {
    const inst = instantaneaSintetica();
    const v = validarInstantanea(inst);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.calles).toHaveLength(32);
    expect(v.calles.every((c) => c.segmentos.length === 3 && c.procedencia === 'osm' && c.refsFuente.every((r) => r.startsWith('osm:way/')))).toBe(true);
    expect(validarInstantanea({ ...inst, __fuente: undefined })).toMatchObject({ ok: false, motivo: expect.stringMatching(/atribución y la licencia/) });
    expect(validarInstantanea({ ...inst, __fuente: { ...inst.__fuente, licencia: 'CC-BY' } })).toMatchObject({ ok: false, motivo: expect.stringMatching(/ODbL/) });
    expect(validarInstantanea({ ...inst, elements: inst.elements.slice(0, 20) })).toMatchObject({ ok: false, motivo: expect.stringMatching(/no cubre el municipio/) });
    // Otra ciudad (desplazada a Valladolid): no corresponde a Medina
    const lejos = { ...inst, elements: inst.elements.map((e) => ({ ...e, geometry: e.geometry.map((g) => ({ lat: g.lat + 0.34, lon: g.lon + 0.19 })) })) };
    expect(validarInstantanea(lejos)).toMatchObject({ ok: false, motivo: expect.stringMatching(/fuera de la zona/) });
  });

  it('la aplicación usa la instantánea del proyecto y NO consulta Overpass; sin instantánea válida y sin red, el simulado', async () => {
    const llamadas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { llamadas.push(String(url)); return respuesta(instantaneaSintetica()); }));
    const r = await cargarCallejeroMedina(() => undefined);
    expect(r.fuente).toBe('instantanea-osm');
    expect(r.detalle).toMatch(/32 calles reales · instantánea OSM del proyecto \(datos a 2026-10-22\) · © colaboradores de OpenStreetMap, ODbL 1.0/);
    expect(llamadas).toEqual(['./data/medina-callejero.json']);
    // Instantánea sin licencia: se avisa y no se usa
    const avisos: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => respuesta({ ...instantaneaSintetica(), __fuente: undefined })));
    const s = await cargarCallejeroMedina((m) => avisos.push(m), { permitirRed: false });
    expect(s.fuente).toBe('simulado');
    expect(avisos.some((a) => /no válida/.test(a))).toBe(true);
  });
});

describe('Demostración sobre trazados con forma OSM · negocios ficticios', () => {
  const calles = (validarInstantanea(instantaneaSintetica()) as { calles: Calle[] }).calles;
  const db = generarDemo({ calles, fuente: 'instantanea-osm', detalleFuente: 'prueba' });

  it('recorre cada calle como un trazado continuo aunque sus vías vengan desordenadas e invertidas', () => {
    for (const c of calles) {
      const r = recorridoCalle(c);
      for (let i = 1; i < r.length; i++) expect(distanciaM(r[i - 1][r[i - 1].length - 1], r[i][0])).toBeLessThan(1);
    }
  });

  it('todos los locales están en calles del callejero cargado; negocios simulados; mismo portal = locales independientes', () => {
    const ids = new Set(calles.map((c) => c.id));
    const locMedina = Object.values(db.locales).filter((l) => l.municipioId === MEDINA.id);
    expect(locMedina.length).toBeGreaterThan(100);
    expect(locMedina.every((l) => ids.has(l.direcciones[l.direcciones.length - 1].calleId))).toBe(true);
    expect(locMedina.every((l) => !l.coordVerificada)).toBe(true);
    expect(db.municipios[MEDINA.id].fuenteCallejero).toBe('osm');
    const d = datosCampana(db, 'camp-medina-2025');
    expect(d.unidades.every((u) => u.procedencia === 'simulado')).toBe(true);
    const r = posicionesEstablecimientos(db, d.municipio, d.unidades);
    // Un punto por local; por portal, tantos puntos como locales censados en él
    expect(r.posiciones).toHaveLength(d.unidades.filter((u) => u.localId).length);
    expect(r.porTipo).toEqual({ verificada: 0, aproximada: 0, simulada: r.posiciones.length });
    const porPortalU = new Map<string, number>();
    for (const u of d.unidades) porPortalU.set(clavePortal(u), (porPortalU.get(clavePortal(u)) ?? 0) + 1);
    const porPortalP = new Map<string, number>();
    for (const p of r.posiciones) porPortalP.set(p.portal, (porPortalP.get(p.portal) ?? 0) + 1);
    expect(porPortalP).toEqual(porPortalU);
  });

  it('cada ubicación simulada queda junto a su propia calle y los indicadores cuadran', () => {
    const d = datosCampana(db, 'camp-medina-2025');
    const r = posicionesEstablecimientos(db, d.municipio, d.unidades);
    for (const p of r.posiciones) {
      const c = db.calles[p.calleId];
      expect(Math.min(...c.segmentos.map((s) => distanciaPuntoLinea(p.coord, s.coords)))).toBeLessThan(8);
    }
    const s = resumen(d.unidades);
    expect(s.establecimientos).toBe(d.unidades.length);
    expect(s.ocupados + s.vacios).toBe(s.establecimientos);
    expect(s.locales).toBe(new Set(d.unidades.map((u) => u.localId)).size);
  });

  it('la campaña 2025 y sus ubicaciones se generan igual con el mismo callejero (reproducible)', () => {
    const otra = generarDemo({ calles, fuente: 'instantanea-osm', detalleFuente: 'prueba' });
    // (Las altas simuladas de campo 2026 llevan identificadores con la hora; la campaña 2025, no.)
    const med25 = (x: typeof db) => Object.keys(x.locales).filter((k) => k.startsWith('loc-med-')).sort();
    expect(med25(otra)).toEqual(med25(db));
    const d1 = datosCampana(db, 'camp-medina-2025');
    const d2 = datosCampana(otra, 'camp-medina-2025');
    expect(posicionesEstablecimientos(otra, d2.municipio, d2.unidades).posiciones).toEqual(posicionesEstablecimientos(db, d1.municipio, d1.unidades).posiciones);
  });
});

/**
 * Comprobación de la instantánea REAL incluida en el proyecto. Se ejecuta solo si el archivo existe (se
 * genera con `npm run callejero` desde una red con acceso a OpenStreetMap).
 */
const RUTA = 'public/data/medina-callejero.json';
describe.skipIf(!existsSync(RUTA))('Instantánea real de Medina del Campo (public/data)', () => {
  const json = existsSync(RUTA) ? JSON.parse(readFileSync(RUTA, 'utf8')) : null;
  const v = json ? validarInstantanea(json) : null;

  it('es válida, atribuida (ODbL) y dentro de Medina del Campo', () => {
    expect(v?.ok).toBe(true);
    if (!v?.ok) return;
    expect(v.fuente.licencia).toMatch(/ODbL/);
    expect(v.fuente.atribucion).toMatch(/OpenStreetMap/);
    expect(v.resumen.fueraDeZona).toBe(0);
    expect(v.calles.length).toBeGreaterThan(150);
  });

  it('contiene las calles del documento real IT 2 y la demostración funciona sobre ella', () => {
    if (!v?.ok) return;
    // Las denominaciones del documento IT 2 se concilian, no se fuerzan: en OSM 23-10-2026 «López Flores»
    // coincide; «San Francisco» figura como «Callejón de San Francisco» y «Los Mostenes» no es una vía
    // con nombre. Al menos una coincide exactamente; las demás quedan pendientes de conciliar.
    const nombres = new Set(v.calles.map((c) => claveCalle(c.nombre)));
    expect(CALLES_DESDE_CERO_IT2.filter((n) => nombres.has(claveCalle(n))).length).toBeGreaterThan(0);
    const db = generarDemo({ calles: v.calles, fuente: 'instantanea-osm', detalleFuente: 'real' });
    const d = datosCampana(db, 'camp-medina-2025');
    const r = posicionesEstablecimientos(db, d.municipio, d.unidades);
    expect(r.posiciones.length).toBe(d.unidades.filter((u) => u.localId).length);
    for (const p of r.posiciones.slice(0, 200)) expect(Math.min(...db.calles[p.calleId].segmentos.map((s) => distanciaPuntoLinea(p.coord, s.coords)))).toBeLessThan(8);
  });
});

it('el callejero simulado sigue disponible y se identifica como tal (pruebas de importación sin cambios)', () => {
  const s = callejeroSimulado(MEDINA.id, MEDINA.centro);
  expect(s.every((c) => c.procedencia === 'simulado')).toBe(true);
});
