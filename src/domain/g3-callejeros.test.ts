// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CSV_PUEBLO_SINTETICO, geojsonAldeaSintetica, osmPuebloSintetico, osmVillaSintetica } from '../data/callejeroSintetico';
import { CASOS_GENERALIDAD } from '../data/xlsxGeneralidad';
import { validarInstantanea } from '../data/instantaneaOsm';
import { crearBaseEspacio, municipioDeEspacio, PREFIJO, verificarEspacio } from './espacios';
import { altaMunicipio, callejeroDe, crearCampana, TERRITORIO_INICIAL } from './municipios';
import {
  altaCalle, anadirAlias, anadirReferencia, aplicarCarga, callesDe, callesVigentes, corregirCalle, huellaCalle, planificarCarga, rechazarCalle, referenciasDe,
  resumenCallejero, retirarAlias, retirarReferencia, validarAltaCalle, validarCalle,
} from './callejeros';
import { consultaOverpassMunicipio, leerCallejeroCsv, leerCallejeroGeoJson, leerFuenteCallejero, leerGeometriaManual, leerOsmMunicipio } from './fuentesCallejero';
import { proponer } from './conciliacionCalles';
import { conciliacionCalles, denominacionesPorConciliar } from './c1e';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion } from './incorporacion';
import type { BaseDatos } from './db';
import type { Itinerario } from './types';

/**
 * G3 · Callejeros municipales con municipios y callejeros SINTÉTICOS: carga desde OSM (con límite
 * administrativo) y desde un callejero oficial, actualización, duplicados, plazas, altas supervisadas sin
 * geometría, alias y nombres históricos, referencias como datos, separación entre municipios y
 * conservación de identificadores y vínculos.
 */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

const P = PREFIJO.ensayo;
const AHORA = '2026-10-25T10:00:00.000Z';
const MEDINA = municipioDeEspacio('ensayo');
const VILLA = { nombre: 'Villa Sintética de Arriba', ine: '99001' };
const PUEBLO = { nombre: 'Pueblo Sintético del Río', ine: '99002' };

function baseConMedina(): BaseDatos {
  const v = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
  if (!v.ok) throw new Error(v.motivo);
  return crearBaseEspacio('ensayo', { persona: { nombre: 'Persona de Prueba', roles: ['coordinador'] }, calles: v.calles, detalleCallejero: 'OSM', espacioId: 'g3', ahora: AHORA });
}
const ctx = (db: BaseDatos) => ({ prefijo: P, porId: db.meta.espacioCreadoPorId!, ahora: AHORA });
function conMunicipio(db: BaseDatos, m: { nombre: string; ine?: string }) {
  const r = altaMunicipio(db, { ...m, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, ctx(db));
  return { db: r.db, id: r.municipioId };
}
function cargar(db: BaseDatos, municipioId: string, json: unknown, archivo = 'villa.json', extra: { fuente?: string; version?: string } = {}) {
  const texto = JSON.stringify(json);
  const l = leerOsmMunicipio(json, VILLA);
  if (!l.ok) throw new Error(l.motivo);
  return aplicarCarga(db, municipioId, l, { archivo, contenido: texto, fuente: extra.fuente ?? 'OpenStreetMap (Overpass API)', version: extra.version, licencia: 'ODbL 1.0' }, ctx(db));
}
const calle = (db: BaseDatos, municipioId: string, nombre: string) => callesDe(db, municipioId).find((c) => c.nombre === nombre)!;

describe('G3 · Lectura de fuentes verificables', () => {
  it('OSM: calles, peatonales y plazas (área, multipolígono y punto) dentro del límite administrativo', () => {
    const l = leerOsmMunicipio(osmVillaSintetica(1), VILLA);
    if (!l.ok) throw new Error(l.motivo);
    const por = Object.fromEntries(l.vias.map((v) => [v.nombre, v]));
    expect(Object.keys(por).sort()).toEqual(['Calle del Olmo', 'Calle Peatonal Mayor', 'Calle Real', 'Paseo del Río', 'Plaza Chica', 'Plaza de la Fuente', 'Plaza del Mercado'].sort());
    // Dos tramos con el mismo nombre forman una vía, con los identificadores de OSM
    expect(por['Calle del Olmo'].segmentos.map((s) => s.id)).toEqual(['w1001', 'w1002']);
    expect(l.agrupados).toBe(1);
    expect(por['Plaza de la Fuente'].segmentos[0]).toMatchObject({ id: 'w1004', tipo: 'area', fuente: 'osm:way/1004' });
    expect(por['Plaza del Mercado'].segmentos[0]).toMatchObject({ id: 'r2001', tipo: 'area' });
    expect(por['Plaza Chica'].segmentos[0]).toMatchObject({ id: 'n3001', tipo: 'punto', longitudM: 0 });
    expect(por['Paseo del Río'].segmentos[0].tipo).toBe('area');
    expect(por['Calle Peatonal Mayor'].segmentos[0].tipo).toBe('linea');
    expect(l.descartes).toMatchObject({ sinNombre: 1, fueraDelLimite: 1, tipoNoAdmitido: 1 });
    expect(l.limite).toMatchObject({ fuente: 'osm:relation/9001', ine: '99001', nombre: 'Villa Sintética de Arriba' });
    expect(l.fechaDatos).toBe('2026-09-30T00:00:00Z');
  });

  it('OSM: rechaza otro municipio, la falta de límite, límites homónimos y límites sin geometría', () => {
    expect(leerOsmMunicipio(osmPuebloSintetico(), VILLA)).toMatchObject({ ok: false, motivo: expect.stringMatching(/código INE 99002.*no del 99001/) });
    const sinLimite = { elements: osmVillaSintetica(1).elements.filter((e) => e.type !== 'relation' || e.id !== 9001) };
    expect(leerOsmMunicipio(sinLimite, VILLA)).toMatchObject({ ok: false, motivo: expect.stringMatching(/no incluye el límite administrativo/) });
    const dos = { elements: [...osmVillaSintetica(1).elements, osmPuebloSintetico().elements[0]] };
    expect(leerOsmMunicipio(dos, { nombre: 'Villa Sintética de Arriba' })).toMatchObject({ ok: false, motivo: expect.stringMatching(/2 límites municipales/) });
    const sinGeo = { elements: osmVillaSintetica(1).elements.map((e) => (e.id === 9001 ? { ...e, members: [] } : e)) };
    expect(leerOsmMunicipio(sinGeo, VILLA)).toMatchObject({ ok: false, motivo: expect.stringMatching(/no tiene geometría completa/) });
    expect(leerOsmMunicipio(osmVillaSintetica(1), { nombre: 'Otro Nombre' })).toMatchObject({ ok: false, motivo: expect.stringMatching(/no de «Otro Nombre»/) });
    expect(leerFuenteCallejero('no es json', 'x.json', 'osm', VILLA)).toMatchObject({ ok: false });
  });

  it('la consulta de Overpass usa el límite administrativo (por INE si se conoce) y no se ejecuta desde ULIT', () => {
    expect(consultaOverpassMunicipio(VILLA)).toMatch(/rel\["boundary"="administrative"\]\["admin_level"="8"\]\["ine:municipio"="99001"\]/);
    expect(consultaOverpassMunicipio(VILLA)).toMatch(/place"="square"/);
    expect(consultaOverpassMunicipio({ nombre: 'Aldea Sintética' })).toMatch(/\["name"="Aldea Sintética"\]/);
  });

  it('callejero oficial en CSV: tipos abreviados, filas repetidas agrupadas, otro municipio descartado, vías sin geometría', () => {
    const l = leerCallejeroCsv(CSV_PUEBLO_SINTETICO, PUEBLO);
    if (!l.ok) throw new Error(l.motivo);
    expect(l.vias.map((v) => [v.nombre, v.codigo, v.segmentos.length])).toEqual([['Calle Mayor', '001', 0], ['Paseo del Molino', '006', 0], ['Plaza de España', '002', 0]]);
    expect(l.agrupados).toBe(1);
    expect(l.descartes).toMatchObject({ otroMunicipio: 1, sinNombre: 1 });
  });

  it('callejero oficial en GeoJSON: línea, plaza como polígono, plaza como punto y vía sin geometría', () => {
    const l = leerCallejeroGeoJson(geojsonAldeaSintetica(), { nombre: 'Aldea Sintética' });
    if (!l.ok) throw new Error(l.motivo);
    const forma = Object.fromEntries(l.vias.map((v) => [v.nombre, v.segmentos.map((s) => s.tipo).join(',') || 'sin']));
    expect(forma).toEqual({ 'Calle de la Iglesia': 'linea', 'Plaza Mayor': 'area', 'Plaza del Pozo': 'punto', 'Travesía de las Eras': 'sin' });
  });

  it('la geometría manual se lee tal cual o se deja vacía (nunca se inventa)', () => {
    expect(leerGeometriaManual('')).toEqual({ ok: true });
    expect(leerGeometriaManual('41.3108, -4.9142')).toMatchObject({ ok: true, segmento: { tipo: 'punto', coords: [[-4.9142, 41.3108]] } });
    expect(leerGeometriaManual('{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[0,0]]]}')).toMatchObject({ ok: true, segmento: { tipo: 'area' } });
    expect(leerGeometriaManual('Plaza Mayor')).toMatchObject({ ok: false });
    expect(leerGeometriaManual('95, 10')).toMatchObject({ ok: false });
  });
});

describe('G3 · Carga y actualización del callejero', () => {
  it('carga inicial: crea las vías con su procedencia y registra fuente, fecha, versión y huella', () => {
    let { db, id } = conMunicipio(baseConMedina(), VILLA);
    expect(callejeroDe(db, id).disponible).toBe(false);
    const r = cargar(db, id, osmVillaSintetica(1), 'villa-v1.json', { version: '2026-09' });
    db = r.db;
    expect(r.plan.resumen).toMatchObject({ nuevas: 7, actualizadas: 0, conflictos: 0, plazas: 4, agrupadas: 1, descartadas: 3 });
    const vias = callesDe(db, id);
    expect(vias).toHaveLength(7);
    expect(vias.every((c) => c.id.startsWith(`${P}-c-villa-sintetica-de-arriba-99001-`) && c.procedencia === 'osm' && c.cargas?.[0] === r.carga.id)).toBe(true);
    expect(calle(db, id, 'Plaza del Mercado').forma).toBe('area');
    expect(calle(db, id, 'Plaza Chica').forma).toBe('punto');
    expect(db.municipios[id].callejero).toMatchObject({ estado: 'disponible', fuente: 'osm', limite: { ine: '99001' } });
    expect(db.municipios[id].callejero!.cargas![0]).toMatchObject({ tipo: 'osm', fuente: 'OpenStreetMap (Overpass API)', archivo: 'villa-v1.json', fechaDatos: '2026-09-30T00:00:00Z', version: '2026-09', licencia: 'ODbL 1.0', porId: db.meta.espacioCreadoPorId });
    expect(db.municipios[id].callejero!.cargas![0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(resumenCallejero(db, id)).toMatchObject({ vias: 7, plazas: 4, segmentos: 8 });
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
    // El mismo archivo otra vez no se vuelve a aplicar
    expect(() => cargar(db, id, osmVillaSintetica(1), 'villa-v1.json')).toThrow(/ya se cargó/);
  });

  it('actualización: conserva identificadores, vínculos y segmentos en uso; no borra ni renombra', async () => {
    let { db, id } = conMunicipio(baseConMedina(), VILLA);
    db = cargar(db, id, osmVillaSintetica(1)).db;
    const ids = Object.fromEntries(callesDe(db, id).map((c) => [c.nombre, c.id]));
    // Un censo histórico vincula locales a las calles cargadas
    const camp = crearCampana(db, { municipioId: id, anio: 2023, nombre: 'Censo 2023', clase: 'historica' }, { ...ctx(db), anioActual: 2026 });
    db = camp.db;
    const c = CASOS_GENERALIDAD.find((x) => x.id === 'A')!;
    const destino = { municipioId: id, anio: 2023, campanaId: camp.campanaId };
    const { resultado, plan } = await prepararIncorporacion(db, await c.generar(['Calle del Olmo', 'Calle Real', 'Calle Peatonal Mayor']), c.archivo, destino);
    db = aplicarIncorporacion(db, resultado, destino, {}, plan, { porId: db.meta.espacioCreadoPorId!, ahora: AHORA }).db;
    const locales = Object.values(db.locales);
    expect(locales.length).toBeGreaterThan(0);
    // Un itinerario usa el tramo w1002 de la Calle del Olmo (que la fuente retira en la versión 2)
    const it: Itinerario = { id: `${P}-it-1`, campanaId: camp.campanaId, codigo: 'IT1', nombre: 'Itinerario de prueba', color: '#000', origen: 'app', tramos: [{ calleId: ids['Calle del Olmo'], segmentoIds: ['w1002'], acera: 'ambas', orden: 1 }], asignadosIds: [], creado: AHORA };
    db = { ...db, itinerarios: { [it.id]: it } };
    const huellaReal = huellaCalle(calle(db, id, 'Calle Real'));

    const r = cargar(db, id, osmVillaSintetica(2), 'villa-v2.json');
    expect(r.plan.resumen).toMatchObject({ nuevas: 1, actualizadas: 1, conflictos: 1, ausentes: 2 });
    expect(r.plan.vias.find((v) => v.accion === 'conflicto')?.motivo).toMatch(/«Calle Peatonal del Rey».*«Calle Peatonal Mayor».*No se renombra sola/);
    db = r.db;
    // Mismos identificadores; nada se borra
    for (const [nombre, cid] of Object.entries(ids)) expect(db.calles[cid]?.nombre, nombre).toBe(nombre);
    expect(calle(db, id, 'Calle Nueva')).toBeDefined();
    expect(calle(db, id, 'Plaza Chica')).toBeDefined();
    expect(huellaCalle(calle(db, id, 'Calle Real'))).toBe(huellaReal);
    // Segmentos: el 1001 se actualiza, el 1010 se añade y el 1002 se conserva porque lo usa un itinerario
    expect(calle(db, id, 'Calle del Olmo').segmentos.map((s) => s.id)).toEqual(['w1001', 'w1002', 'w1010']);
    expect(r.plan.vias.find((v) => v.nombre === 'Calle del Olmo')).toMatchObject({ accion: 'actualizada', conservados: 1 });
    // Los locales siguen apuntando a calles existentes del mismo municipio
    expect(Object.values(db.locales).every((l) => l.direcciones.every((d) => db.calles[d.calleId]?.municipioId === id))).toBe(true);
    expect(db.municipios[id].callejero!.cargas).toHaveLength(2);
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
  });

  it('una vía que ya existe no se duplica al cargar otra fuente (el callejero oficial completa su código)', () => {
    let { db, id } = conMunicipio(baseConMedina(), PUEBLO);
    const l = leerCallejeroCsv(CSV_PUEBLO_SINTETICO, PUEBLO);
    if (!l.ok) throw new Error(l.motivo);
    db = aplicarCarga(db, id, l, { archivo: 'pueblo.csv', contenido: CSV_PUEBLO_SINTETICO, fuente: 'Ayuntamiento de Pueblo Sintético (callejero municipal)', fechaDatos: '2026-01-15', version: '3' }, ctx(db)).db;
    expect(callesDe(db, id).map((c) => [c.nombre, c.procedencia, c.forma, c.codigoVia])).toEqual(expect.arrayContaining([['Calle Mayor', 'importado', 'sin-geometria', '001']]));
    const osm = { ...osmPuebloSintetico() };
    const lo = leerOsmMunicipio(osm, PUEBLO);
    if (!lo.ok) throw new Error(lo.motivo);
    const r = aplicarCarga(db, id, lo, { archivo: 'pueblo-osm.json', contenido: JSON.stringify(osm), fuente: 'OpenStreetMap (Overpass API)' }, ctx(db));
    expect(r.plan.resumen).toMatchObject({ nuevas: 1, actualizadas: 1 });
    const mayor = callesDe(r.db, id).filter((c) => c.nombre === 'Calle Mayor');
    expect(mayor).toHaveLength(1);
    expect(mayor[0]).toMatchObject({ codigoVia: '001', forma: 'linea', refsFuente: expect.arrayContaining(['oficial:001', 'osm:way/4002']) });
  });
});

describe('G3 · Altas manuales supervisadas, plazas sin geometría y referencias como datos', () => {
  it('«Plaza Mayor de la Hispanidad» en Medina: propuesta sin geometría → validada → la referencia la propone', () => {
    let db = baseConMedina();
    // La referencia es un DATO del callejero de Medina (con su fuente), no código
    expect(db.municipios[MEDINA].callejero?.referencias).toEqual([expect.objectContaining({ denominacion: 'Plaza Mayor', oficial: 'Plaza Mayor de la Hispanidad', fuente: expect.stringMatching(/Cátedra/) })]);
    const antes = proponer('Plaza Mayor', callesDe(db, MEDINA), referenciasDe(db, MEDINA));
    expect(antes.ausente?.oficial).toBe('Plaza Mayor de la Hispanidad');
    const datos = { municipioId: MEDINA, nombre: 'Mayor de la Hispanidad', tipoVia: 'Plaza', fuenteDocumental: 'Nomenclátor municipal (prueba)', geometria: '' };
    const a = altaCalle(db, datos, ctx(db));
    db = a.db;
    const c = db.calles[a.calleId];
    expect(c).toMatchObject({ nombre: 'Plaza Mayor de la Hispanidad', tipoVia: 'Plaza', procedencia: 'manual', forma: 'sin-geometria', segmentos: [], alta: { estado: 'propuesta', fuenteDocumental: 'Nomenclátor municipal (prueba)', porId: db.meta.espacioCreadoPorId, fecha: AHORA } });
    // Sin validar no cuenta
    expect(callesVigentes(db, MEDINA).some((x) => x.id === c.id)).toBe(false);
    expect(proponer('Plaza Mayor', callesDe(db, MEDINA), referenciasDe(db, MEDINA)).propuestas).toEqual([]);
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
    // Duplicado: no se puede proponer dos veces
    expect(validarAltaCalle(db, datos).errores[0]).toMatch(/Ya existe.*propuesta pendiente de validar/);
    db = validarCalle(db, c.id, { porId: db.meta.espacioCreadoPorId!, ahora: AHORA, nota: 'Comprobado en el nomenclátor' });
    expect(db.calles[c.id].alta).toMatchObject({ estado: 'validada', validacion: { porId: db.meta.espacioCreadoPorId, nota: 'Comprobado en el nomenclátor' } });
    const despues = proponer('Plaza Mayor', callesDe(db, MEDINA), referenciasDe(db, MEDINA));
    expect(despues.ausente).toBeUndefined();
    expect(despues.propuestas).toEqual([expect.objectContaining({ calleId: c.id, fuente: 'referencia-catedra', explicacion: expect.stringMatching(/fuente de la referencia: Cátedra/) })]);
    expect(db.calles[c.id].historial!.map((h) => h.accion)).toEqual(['alta', 'validacion']);
  });

  it('alta con geometría opcional, dentro del límite; corrección auditada y rechazo con motivo', () => {
    let { db, id } = conMunicipio(baseConMedina(), VILLA);
    db = cargar(db, id, osmVillaSintetica(1)).db;
    const fuera = { municipioId: id, nombre: 'del Pozo', tipoVia: 'Plaza', fuenteDocumental: 'Visita de campo (prueba)', geometria: '41.31, -4.91' };
    expect(validarAltaCalle(db, fuera).errores[0]).toMatch(/fuera del límite/);
    const a = altaCalle(db, { ...fuera, geometria: '10.011, -29.989' }, ctx(db));
    db = a.db;
    expect(db.calles[a.calleId]).toMatchObject({ forma: 'punto', segmentos: [{ id: `${a.calleId}-g1`, tipo: 'punto', fuente: 'manual' }] });
    db = corregirCalle(db, a.calleId, { nombre: 'Plaza del Pozo Viejo' }, { porId: db.meta.espacioCreadoPorId!, ahora: AHORA, motivo: 'Errata' });
    expect(db.calles[a.calleId].nombre).toBe('Plaza del Pozo Viejo');
    expect(db.calles[a.calleId].historial!.at(-1)).toMatchObject({ accion: 'correccion', antes: { nombre: 'Plaza del Pozo' } });
    expect(() => rechazarCalle(db, a.calleId, { porId: db.meta.espacioCreadoPorId!, motivo: '' })).toThrow(/motivo/);
    db = rechazarCalle(db, a.calleId, { porId: db.meta.espacioCreadoPorId!, ahora: AHORA, motivo: 'No existe: confusión con la Plaza Chica' });
    expect(db.calles[a.calleId].alta!.estado).toBe('rechazada');
    expect(callesVigentes(db, id).some((x) => x.id === a.calleId)).toBe(false);
    // Las vías de una fuente no se corrigen a mano
    expect(() => corregirCalle(db, calle(db, id, 'Calle Real').id, { nombre: 'Calle Regia' }, { porId: db.meta.espacioCreadoPorId! })).toThrow(/no se corrigen a mano/);
  });

  it('las referencias se gestionan como datos: bases antiguas usan las de partida; se pueden añadir y retirar', () => {
    let db = baseConMedina();
    const antigua = { ...db, municipios: { ...db.municipios, [MEDINA]: { ...db.municipios[MEDINA], callejero: { ...db.municipios[MEDINA].callejero!, referencias: undefined } } } };
    expect(referenciasDe(antigua, MEDINA).map((r) => r.oficial)).toEqual(['Plaza Mayor de la Hispanidad']);
    db = anadirReferencia(db, MEDINA, { denominacion: 'Pza. del Mercado', oficial: 'Plaza del Mercado Viejo', nota: 'Prueba', fuente: 'Archivo municipal (prueba)' }, ctx(db));
    expect(referenciasDe(db, MEDINA)).toHaveLength(2);
    expect(() => anadirReferencia(db, MEDINA, { denominacion: 'Plaza Mayor', oficial: 'Otra', nota: '', fuente: 'Prueba' }, ctx(db))).toThrow(/Ya hay una referencia/);
    db = retirarReferencia(db, MEDINA, 'Plaza Mayor', ctx(db));
    expect(referenciasDe(db, MEDINA).map((r) => r.denominacion)).toEqual(['Pza. del Mercado']);
    expect(proponer('Plaza Mayor', callesDe(db, MEDINA), referenciasDe(db, MEDINA)).ausente).toBeUndefined();
    // La retirada se conserva para la auditoría
    expect(db.municipios[MEDINA].callejero!.referencias!.find((r) => r.denominacion === 'Plaza Mayor')!.retirada).toMatchObject({ porId: db.meta.espacioCreadoPorId });
  });
});

describe('G3 · Alias y nombres históricos', () => {
  it('un nombre histórico se propone (con su fuente) pero no vincula solo; se puede retirar', async () => {
    let { db, id } = conMunicipio(baseConMedina(), VILLA);
    db = cargar(db, id, osmVillaSintetica(1)).db;
    const real = calle(db, id, 'Calle Real');
    db = anadirAlias(db, real.id, { nombre: 'Calle del Generalísimo', tipo: 'historico', fuente: 'Callejero de 1970 (prueba)', hasta: '1979' }, ctx(db));
    expect(db.calles[real.id].alias![0]).toMatchObject({ nombre: 'Calle del Generalísimo', tipo: 'historico', hasta: '1979', porId: db.meta.espacioCreadoPorId });
    const p = proponer('Calle del Generalisimo', callesDe(db, id));
    expect(p.propuestas).toEqual([expect.objectContaining({ calleId: real.id, fuente: 'alias-callejero', explicacion: expect.stringMatching(/nombre histórico de «Calle Real».*Callejero de 1970/) })]);
    // Ambigüedad: un alias no puede ser el nombre de otra vía
    expect(() => anadirAlias(db, real.id, { nombre: 'Calle del Olmo', tipo: 'alias', fuente: 'Prueba' }, ctx(db))).toThrow(/ya identifica a «Calle del Olmo»/);
    // No vincula solo: la denominación histórica sigue pendiente de conciliar
    const camp = crearCampana(db, { municipioId: id, anio: 2023, nombre: 'Censo 2023', clase: 'historica' }, { ...ctx(db), anioActual: 2026 });
    db = camp.db;
    const c = CASOS_GENERALIDAD.find((x) => x.id === 'A')!;
    const destino = { municipioId: id, anio: 2023, campanaId: camp.campanaId };
    const { resultado } = await prepararIncorporacion(db, await c.generar(['Calle del Generalísimo']), c.archivo, destino);
    expect(conciliacionCalles(db, resultado, id).porEstado.pendiente.filas).toBe(40);
    expect(denominacionesPorConciliar(db, resultado, id)[0].propuestas[0]).toMatchObject({ calleId: real.id, fuente: 'alias-callejero' });
    db = retirarAlias(db, real.id, 'Calle del Generalísimo', { ...ctx(db), motivo: 'Prueba' });
    expect(proponer('Calle del Generalísimo', callesDe(db, id)).propuestas).toEqual([]);
    expect(db.calles[real.id].alias![0].retirado).toBeDefined();
  });
});

describe('G3 · Separación entre municipios y datos existentes', () => {
  it('cargar el callejero de un municipio no toca el de otro (ni Medina) y las mismas calles no se cruzan', () => {
    const db0 = baseConMedina();
    const huellasMedina = callesDe(db0, MEDINA).map(huellaCalle);
    let { db, id } = conMunicipio(db0, VILLA);
    const pueblo = conMunicipio(db, PUEBLO);
    db = pueblo.db;
    db = cargar(db, id, osmVillaSintetica(1)).db;
    const lp = leerOsmMunicipio(osmPuebloSintetico(), PUEBLO);
    if (!lp.ok) throw new Error(lp.motivo);
    db = aplicarCarga(db, pueblo.id, lp, { archivo: 'pueblo.json', contenido: JSON.stringify(osmPuebloSintetico()), fuente: 'OpenStreetMap (Overpass API)' }, ctx(db)).db;
    // «Calle del Olmo» existe en los dos municipios: dos vías distintas, cada una en el suyo
    const olmos = Object.values(db.calles).filter((c) => c.nombre === 'Calle del Olmo');
    expect(olmos.map((c) => c.municipioId).sort()).toEqual([id, pueblo.id].sort());
    expect(new Set(olmos.map((c) => c.id)).size).toBe(2);
    expect(callesDe(db, MEDINA).map(huellaCalle)).toEqual(huellasMedina);
    expect(db.municipios[MEDINA]).toEqual(db0.municipios[MEDINA]);
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
    // El archivo de Pueblo no se acepta para Villa
    expect(leerOsmMunicipio(osmPuebloSintetico(), VILLA).ok).toBe(false);
  });

  it('un espacio puede crearse sin Medina del Campo (Medina es un caso de prueba, no la base obligatoria)', () => {
    const db = crearBaseEspacio('ensayo', { persona: { nombre: 'Persona de Prueba', roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'g3-vacio', ahora: AHORA, incluirMedina: false });
    expect(Object.keys(db.municipios)).toHaveLength(0);
    expect(Object.keys(db.calles)).toHaveLength(0);
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
    const { db: d2, id } = conMunicipio(db, VILLA);
    const r = cargar(d2, id, osmVillaSintetica(1));
    expect(callesDe(r.db, id)).toHaveLength(7);
    expect(verificarEspacio(r.db, 'ensayo')).toEqual([]);
  });

  it('el plan de una carga no cambia la base', () => {
    const { db, id } = conMunicipio(baseConMedina(), VILLA);
    const l = leerOsmMunicipio(osmVillaSintetica(1), VILLA);
    if (!l.ok) throw new Error(l.motivo);
    const antes = JSON.stringify(db);
    planificarCarga(db, id, l, { contenido: JSON.stringify(osmVillaSintetica(1)) });
    expect(JSON.stringify(db)).toBe(antes);
  });
});
