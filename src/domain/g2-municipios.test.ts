// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CASOS_GENERALIDAD } from '../data/xlsxGeneralidad';
import { validarInstantanea } from '../data/instantaneaOsm';
import { crearBaseEspacio, municipioDeEspacio, PREFIJO, verificarEspacio } from './espacios';
import { altaMunicipio, callejeroDe, contenidoCampana, crearCampana, motivoNoDestino, TERRITORIO_INICIAL, validarCampana, validarMunicipio, verificarSeparacionMunicipios, type DatosMunicipio } from './municipios';
import { configTerritorialDe } from './territorio';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion, deshacerIncorporacion } from './incorporacion';
import { analizarXlsx } from './xlsx/analisis';
import { asignarColumna, perfilDesdeCorrespondencia } from './xlsx/correspondencia';
import { comprobarRespaldo, crearRespaldo } from './respaldo';
import type { BaseDatos } from './db';

/**
 * G2 · Municipios y campañas como datos, con municipios y censos SINTÉTICOS: alta sin callejero,
 * configuración territorial guardada en el municipio, varias campañas (también del mismo año),
 * incorporación en la campaña elegida, separación entre municipios y perfiles reutilizados.
 */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

const caso = (id: string) => CASOS_GENERALIDAD.find((c) => c.id === id)!;
const P = PREFIJO.ensayo;
const ANIO = 2026;
const AHORA = '2026-10-25T10:00:00.000Z';
const MEDINA = municipioDeEspacio('ensayo');
// Calles reales del callejero de Medina del Campo (las usan también los censos sintéticos).
const CALLES_MEDINA = ['Calle de las Angustias', 'Calle de las Farolas'];

function baseEnsayo(): BaseDatos {
  const v = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
  if (!v.ok) throw new Error(v.motivo);
  return crearBaseEspacio('ensayo', { persona: { nombre: 'Persona de Prueba', roles: ['coordinador'] }, calles: v.calles, detalleCallejero: 'OSM', espacioId: 'g2', ahora: AHORA });
}
const quien = (db: BaseDatos) => ({ prefijo: P, porId: db.meta.espacioCreadoPorId!, ahora: AHORA, anioActual: ANIO });
const datosMun = (nombre: string, extra: Partial<DatosMunicipio> = {}): DatosMunicipio => ({ nombre, provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL, ...extra });

function conMunicipio(db: BaseDatos, nombre: string, extra: Partial<DatosMunicipio> = {}) {
  const r = altaMunicipio(db, datosMun(nombre, extra), quien(db));
  return { db: r.db, id: r.municipioId };
}
function conCampana(db: BaseDatos, municipioId: string, anio: number, nombre = `Censo ${anio} · histórico`, clase: 'historica' | 'operativa' = 'historica') {
  const r = crearCampana(db, { municipioId, anio, nombre, clase }, quien(db));
  return { db: r.db, id: r.campanaId };
}
async function incorporar(db: BaseDatos, bytes: Uint8Array, archivo: string, municipioId: string, campanaId: string, eleccion = {}) {
  const c = db.campanas[campanaId];
  const destino = { municipioId, anio: c.anio, campanaId };
  const { resultado, plan } = await prepararIncorporacion(db, bytes, archivo, destino, {}, eleccion);
  return { resultado, plan, destino, aplicar: () => aplicarIncorporacion(db, resultado, destino, {}, plan, { porId: db.meta.espacioCreadoPorId!, ahora: AHORA }) };
}

describe('G2 · Alta de municipios (datos, no código)', () => {
  it('se da de alta SIN callejero, con el prefijo del espacio, y el espacio sigue verificado', () => {
    const db0 = baseEnsayo();
    const { db, id } = conMunicipio(db0, 'Villa Sintética de Arriba', { ine: '99001' });
    expect(id).toBe(`${P}-mun-villa-sintetica-de-arriba-99001`);
    expect(db.municipios[id]).toMatchObject({ nombre: 'Villa Sintética de Arriba', ine: '99001', fuenteCallejero: 'sin-geometria', callejero: { estado: 'sin-callejero' }, alta: { porId: db0.meta.espacioCreadoPorId, fecha: AHORA } });
    expect(db.municipios[id].centro).toBeUndefined();
    expect(callejeroDe(db, id)).toMatchObject({ disponible: false, calles: 0 });
    expect(Object.values(db.calles).some((c) => c.municipioId === id)).toBe(false);
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
    // La base de partida no cambia.
    expect(db0.municipios[id]).toBeUndefined();
  });

  it('valida los datos: nombre, provincia, INE de 5 cifras, duplicados y reglas territoriales', () => {
    const { db } = conMunicipio(baseEnsayo(), 'Pueblo Sintético del Río', { ine: '99002' });
    expect(validarMunicipio(db, datosMun(''))).toContain('Indique el nombre del municipio.');
    expect(validarMunicipio(db, { ...datosMun('Otro'), provincia: '' })).toContain('Indique la provincia.');
    expect(validarMunicipio(db, datosMun('Otro', { ine: '123' }))[0]).toMatch(/5 cifras/);
    expect(validarMunicipio(db, datosMun('pueblo sintetico del rio'))[0]).toMatch(/Ya existe el municipio/);
    expect(validarMunicipio(db, datosMun('Otro', { ine: '99002' }))[0]).toMatch(/ya es de «Pueblo Sintético del Río»/);
    expect(validarMunicipio(db, datosMun('Medina del Campo', { provincia: 'Valladolid' }))[0]).toMatch(/Ya existe/);
    expect(validarMunicipio(db, datosMun('Otro', { territorio: { ...TERRITORIO_INICIAL, cp: { uso: 'fijo', obligatorio: true } } }))[0]).toMatch(/CP: indique el valor único/);
    expect(validarMunicipio(db, datosMun('Otro', { territorio: { ...TERRITORIO_INICIAL, cp: { uso: 'fijo', obligatorio: true, valorFijo: '479' } } }))[0]).toMatch(/5 cifras/);
    expect(validarMunicipio(db, datosMun('Mismo nombre', { provincia: 'Otra provincia' }))).toEqual([]);
  });

  it('la configuración territorial se guarda con el municipio y es la que usa la interpretación', async () => {
    const territorio = { ...TERRITORIO_INICIAL, cp: { uso: 'fijo' as const, obligatorio: true, valorFijo: '47999' } };
    let { db, id } = conMunicipio(baseEnsayo(), 'Pueblo Sintético del Río', { territorio });
    expect(configTerritorialDe(db, id)).toMatchObject({ municipioId: id, municipio: 'Pueblo Sintético del Río', cp: { uso: 'fijo', valorFijo: '47999' } });
    ({ db } = { db: conCampana(db, id, 2024).db });
    const campanaId = Object.keys(db.campanas)[0];
    const c = caso('B');
    const { resultado } = await incorporar(db, await c.generar(), c.archivo, id, campanaId);
    expect(resultado.opciones.territorio).toMatchObject({ municipioId: id, cp: { valorFijo: '47999' } });
    // Medina: su configuración (CP 47400) también es un dato del municipio en un espacio nuevo…
    expect(db.municipios[MEDINA].territorio?.cp).toMatchObject({ uso: 'fijo', valorFijo: '47400' });
    // …y en una base anterior a G2 (sin el dato) se usa la de referencia, sin cambiar la base.
    const antigua = { ...db, municipios: { ...db.municipios, [MEDINA]: { ...db.municipios[MEDINA], territorio: undefined } } };
    expect(configTerritorialDe(antigua, MEDINA)).toMatchObject({ cp: { uso: 'fijo', valorFijo: '47400' } });
  });

  it('Medina del Campo no cambia al dar de alta otros municipios ni al crear campañas', () => {
    const db0 = baseEnsayo();
    const medina = structuredClone(db0.municipios[MEDINA]);
    const callesMedina = Object.keys(db0.calles).length;
    let { db, id } = conMunicipio(db0, 'Aldea Sintética');
    db = conCampana(db, id, 2022).db;
    db = conCampana(db, MEDINA, 2025).db;
    expect(db.municipios[MEDINA]).toEqual(medina);
    expect(Object.keys(db.calles)).toHaveLength(callesMedina);
    expect(Object.values(db.calles).every((c) => c.municipioId === MEDINA)).toBe(true);
    expect(Object.values(db.campanas).some((c) => c.anio === 2026)).toBe(false);
  });
});

describe('G2 · Campañas históricas y operativas de distintos años', () => {
  it('varias campañas por municipio, también del mismo año con nombres distintos', () => {
    let { db, id } = conMunicipio(baseEnsayo(), 'Pueblo Sintético del Río');
    for (const [anio, nombre] of [[2022, 'Censo 2022'], [2024, 'Censo 2024 · centro'], [2024, 'Censo 2024 · polígono']] as const) db = conCampana(db, id, anio, nombre).db;
    db = conCampana(db, id, 2027, 'Censo 2027', 'operativa').db;
    const cs = Object.values(db.campanas).filter((c) => c.municipioId === id);
    expect(cs.map((c) => [c.anio, c.nombre, c.tipo]).sort()).toEqual([
      [2022, 'Censo 2022', 'historico-importado'], [2024, 'Censo 2024 · centro', 'historico-importado'], [2024, 'Censo 2024 · polígono', 'historico-importado'], [2027, 'Censo 2027', 'actualizacion'],
    ]);
    expect(new Set(cs.map((c) => c.id)).size).toBe(4);
    expect(cs.every((c) => c.id.startsWith(`${P}-camp-`) && c.procedencia === 'manual' && c.creada?.fecha === AHORA)).toBe(true);
    expect(cs.find((c) => c.anio === 2022)).toMatchObject({ periodo: { inicio: '2022-01-01', fin: '2022-12-31' }, estados: { planificacion: 'no-aplica', campo: 'pendiente' } });
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
  });

  it('rechaza nombres repetidos en el mismo año, históricos del año en curso y sobre una campaña operativa', () => {
    let { db, id } = conMunicipio(baseEnsayo(), 'Aldea Sintética');
    db = conCampana(db, id, 2024, 'Censo 2024').db;
    db = conCampana(db, id, 2023, 'Censo 2023 · campo', 'operativa').db;
    expect(validarCampana(db, { municipioId: id, anio: 2024, nombre: 'censo 2024', clase: 'historica' }, ANIO)[0]).toMatch(/Ya hay una campaña «censo 2024» de 2024/);
    expect(validarCampana(db, { municipioId: id, anio: 2026, nombre: 'Censo 2026', clase: 'historica' }, ANIO)[0]).toMatch(/anterior a 2026/);
    expect(validarCampana(db, { municipioId: id, anio: 2023, nombre: 'Censo 2023', clase: 'historica' }, ANIO)[0]).toMatch(/tiene una campaña operativa/);
    expect(validarCampana(db, { municipioId: 'no-existe', anio: 2020, nombre: 'Censo', clase: 'historica' }, ANIO)).toEqual(['Elija el municipio.']);
    expect(() => crearCampana(db, { municipioId: id, anio: 2024, nombre: 'Censo 2024', clase: 'historica' }, quien(db))).toThrow(/Ya hay una campaña/);
  });
});

describe('G2 · Incorporación en la campaña elegida', () => {
  it('censo de un municipio SIN callejero: se conservan todos los registros y la conciliación queda pendiente', async () => {
    let { db, id } = conMunicipio(baseEnsayo(), 'Villa Sintética de Arriba');
    const camp = conCampana(db, id, 2023);
    db = camp.db;
    const preparada = structuredClone(db.campanas[camp.id]);
    const c = caso('A');
    const inc = await incorporar(db, await c.generar(), c.archivo, id, camp.id);
    expect(inc.plan.aplicable).toBe(true);
    expect(inc.plan.destino).toMatchObject({ campanaId: camp.id, nueva: false, nombre: 'Censo 2023 · histórico', anio: 2023 });
    expect(inc.plan.filas.every((f) => f.correspondencia === 'sin-vinculo' && f.motivo === 'calle-sin-correspondencia')).toBe(true);
    const r = inc.aplicar();
    expect(r.campanaId).toBe(camp.id);
    expect(Object.values(r.db.registros)).toHaveLength(40);
    expect(Object.keys(r.db.locales)).toHaveLength(0);
    // La campaña conserva su identificación y quién la creó; queda con su incorporación.
    expect(r.db.campanas[camp.id]).toMatchObject({ id: camp.id, nombre: preparada.nombre, creada: preparada.creada, estados: { campo: 'terminado', revision: 'pendiente', validacion: 'pendiente' } });
    expect(r.db.importaciones[r.importacionId]).toMatchObject({ municipioId: id, campanaId: camp.id });
    expect(r.db.importaciones[r.importacionId].c1?.campanaPrevia?.valor).toEqual(preparada);
    expect(contenidoCampana(r.db, camp.id)).toMatchObject({ registros: 40, vacia: false });
    expect(verificarEspacio(r.db, 'ensayo')).toEqual([]);
    // Ya no puede recibir otra incorporación…
    expect(motivoNoDestino(r.db, camp.id, id, 2023)).toMatch(/ya tiene datos/);
    // …y al deshacer vuelve a quedar EXACTAMENTE como estaba, vacía.
    const d = deshacerIncorporacion(r.db, r.importacionId, db.meta.espacioCreadoPorId!, AHORA);
    expect(d.campanas[camp.id]).toEqual(preparada);
    expect(Object.keys(d.registros)).toHaveLength(0);
    expect(motivoNoDestino(d, camp.id, id, 2023)).toBeNull();
  });

  it('no se incorpora en una campaña operativa, de otro año o de otro municipio', async () => {
    let { db, id } = conMunicipio(baseEnsayo(), 'Aldea Sintética');
    const otra = conMunicipio(db, 'Pueblo Sintético del Río');
    db = otra.db;
    const ajena = conCampana(db, otra.id, 2022);
    db = ajena.db;
    const op = conCampana(db, id, 2027, 'Censo 2027', 'operativa');
    db = op.db;
    const c = caso('C');
    const bytes = await c.generar();
    const eleccion = await perfilC(bytes);
    for (const [campanaId, anio, motivo] of [[ajena.id, 2022, /es de otro municipio/], [op.id, 2027, /campaña operativa/]] as const) {
      const { plan } = await prepararIncorporacion(db, bytes, c.archivo, { municipioId: id, anio, campanaId }, {}, eleccion);
      expect(plan.aplicable).toBe(false);
      expect(plan.bloqueos.map((b) => b.mensaje).join(' ')).toMatch(motivo);
    }
    const h = conCampana(db, id, 2021);
    const { plan } = await prepararIncorporacion(h.db, bytes, c.archivo, { municipioId: id, anio: 2022, campanaId: h.id }, {}, eleccion);
    expect(plan.bloqueos.map((b) => b.mensaje).join(' ')).toMatch(/es de 2021, no de 2022/);
  });

  it('el mismo archivo en dos campañas del mismo año se permite, pero se avisa', async () => {
    let { db, id } = conMunicipio(baseEnsayo(), 'Pueblo Sintético del Río');
    const a = conCampana(db, id, 2024, 'Censo 2024 · centro');
    const b = conCampana(a.db, id, 2024, 'Censo 2024 · polígono');
    db = b.db;
    const c = caso('B');
    const bytes = await c.generar();
    const primera = await incorporar(db, bytes, c.archivo, id, a.id);
    const db2 = primera.aplicar().db;
    const segunda = await incorporar(db2, bytes, c.archivo, id, b.id);
    expect(segunda.plan.aplicable).toBe(true);
    expect(segunda.plan.pendientes.some((p) => /El mismo archivo ya se incorporó en otra campaña de 2024 \(«Censo 2024 · centro»\)/.test(p))).toBe(true);
  });
});

/** Perfil del caso C (Aldea Sintética), creado con la correspondencia de columnas de G1. */
async function perfilC(bytes: Uint8Array) {
  const inf = await analizarXlsx(bytes, 'aldea.xlsx');
  let corr = inf.correspondencia;
  const idx = (h: string) => corr.find((x) => x.cabecera === h)!.indice;
  corr = asignarColumna(corr, idx('Nombre comercial'), 'nombre');
  corr = asignarColumna(corr, idx('Dirección'), 'direccion');
  corr = asignarColumna(corr, idx('Nombre del local'), null);
  corr = asignarColumna(corr, idx('Dirección fiscal'), null);
  return { perfil: perfilDesdeCorrespondencia(corr, { nombre: 'Formato de la Aldea', hoja: 'Datos', filaCabecera: 1, fecha: '2026-10-25' }) };
}

describe('G2 · Separación entre municipios', () => {
  it('las mismas calles en un municipio sin callejero NO se asocian con las de Medina del Campo', async () => {
    let { db, id } = conMunicipio(baseEnsayo(), 'Aldea Sintética');
    const camp = conCampana(db, id, 2022);
    const medina22 = conCampana(camp.db, MEDINA, 2022, 'Censo 2022 · histórico de prueba');
    db = medina22.db;
    const c = caso('C');
    // El mismo archivo, con nombres de calles REALES de Medina, en los dos municipios.
    const bytes = await c.generar(CALLES_MEDINA);
    const eleccion = await perfilC(bytes);
    const enAldea = await incorporar(db, bytes, c.archivo, id, camp.id, eleccion);
    expect(enAldea.plan.filas.every((f) => !f.calleId && !f.localNuevo)).toBe(true);
    db = enAldea.aplicar().db;
    const enMedina = await incorporar(db, bytes, c.archivo, MEDINA, medina22.id, eleccion);
    expect(enMedina.plan.filas.every((f) => !!f.calleId && f.localNuevo)).toBe(true);
    db = enMedina.aplicar().db;
    const locales = Object.values(db.locales);
    expect(locales).toHaveLength(12);
    expect(locales.every((l) => l.municipioId === MEDINA && l.direcciones.every((d) => db.calles[d.calleId].municipioId === MEDINA))).toBe(true);
    expect(Object.values(db.observaciones).every((o) => db.campanas[o.campanaId].municipioId === MEDINA)).toBe(true);
    expect(verificarSeparacionMunicipios(db)).toEqual([]);
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
  });

  it('cualquier asociación entre municipios distintos se detecta y el espacio deja de verificarse', () => {
    let { db, id } = conMunicipio(baseEnsayo(), 'Aldea Sintética');
    const camp = conCampana(db, id, 2022);
    db = camp.db;
    const calleMedina = Object.values(db.calles)[0];
    const mal: BaseDatos = {
      ...db,
      locales: { 'ensayo-loc-x': { id: 'ensayo-loc-x', municipioId: id, direcciones: [{ calleId: calleMedina.id, numero: 3, desdeCampanaId: camp.id }], estado: 'activo', procedencia: 'importado' } },
    };
    expect(verificarSeparacionMunicipios(mal)[0]).toMatch(/calle de otro municipio/);
    expect(verificarEspacio(mal, 'ensayo').join(' ')).toMatch(/calle de otro municipio/);
    const ambito: BaseDatos = { ...db, campanas: { ...db.campanas, [camp.id]: { ...db.campanas[camp.id], ambitoCalleIds: [calleMedina.id] } } };
    expect(verificarSeparacionMunicipios(ambito)[0]).toMatch(/calle de otro municipio en su ámbito/);
    const ajeno: BaseDatos = { ...db, municipios: { ...db.municipios, 'mun-medina': { ...db.municipios[MEDINA], id: 'mun-medina' } } };
    expect(verificarEspacio(ajeno, 'ensayo')[0]).toMatch(/Municipio ajeno al espacio: «mun-medina»/);
  });

  it('el respaldo del espacio conserva todos los municipios y campañas', async () => {
    let { db, id } = conMunicipio(baseEnsayo(), 'Villa Sintética de Arriba');
    db = conCampana(db, id, 2023).db;
    const r = crearRespaldo(db, 'ensayo', AHORA);
    const c = comprobarRespaldo(r.texto, 'ensayo');
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(Object.keys(c.db.municipios).sort()).toEqual([MEDINA, id].sort());
      expect(Object.keys(c.db.campanas)).toHaveLength(1);
    }
  });
});

describe('G2 · Perfiles de importación reutilizados entre municipios', () => {
  it('el perfil creado para un municipio sirve para otro con el mismo formato', async () => {
    let { db, id } = conMunicipio(baseEnsayo(), 'Aldea Sintética');
    const a = conCampana(db, id, 2022);
    const m = conCampana(a.db, MEDINA, 2021, 'Censo 2021 · histórico de prueba');
    db = m.db;
    const c = caso('C');
    const eleccion = await perfilC(await c.generar());
    // Mismo formato, otro municipio, otro año y otras calles.
    const otro = await incorporar(db, await c.generar(CALLES_MEDINA), 'otro_municipio_2021.xlsx', MEDINA, m.id, eleccion);
    expect(otro.plan.aplicable).toBe(true);
    expect(otro.plan.perfil).toEqual({ id: 'usuario-formato-de-la-aldea', version: 1 });
    expect(otro.resultado.original.adicionales?.map((x) => x.cabecera)).toEqual(['Nombre del local', 'Dirección fiscal']);
    const propio = await incorporar(db, await c.generar(), c.archivo, id, a.id, eleccion);
    expect(propio.plan.aplicable).toBe(true);
    expect(propio.plan.perfil.id).toBe('usuario-formato-de-la-aldea');
  });
});
