// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { validarInstantanea } from '../data/instantaneaOsm';
import { ARCHIVO_SINTETICO_C1E, esArchivoSintetico, libroSinteticoC1e } from '../data/xlsxSinteticoC1e';
import { libroEscenarioMedina } from '../data/escenarioIncorporacion';
import { generarDemo } from '../data/semilla';
import { callejeroSimulado, MEDINA } from '../data/callejero';
import { crearBaseEspacio, huellaBase, municipioDeEspacio, verificarEspacio, type TipoEspacio } from './espacios';
import { conciliacionCalles, diagnosticoAgregado, INFORME_AGREGADO_MEDINA_2025, recuentoRegistros, senales } from './c1e';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion, deshacerIncorporacion, type DecisionesIncorporacion } from './incorporacion';
import { comprobarRespaldo, crearRespaldo } from './respaldo';
import { datosCampana } from './panel';
import { posicionesEstablecimientos } from './posiciones';
import { kRev, type BaseDatos } from './db';
import type { Calle } from './types';

/** Callejero REAL (instantánea OSM del proyecto) y archivo SINTÉTICO de C1e. Ningún dato comercial real. */
let calles: Calle[];
let bytes: Uint8Array;
const PERSONA = { nombre: 'Persona de Prueba', roles: ['coordinador' as const] };
const base = (tipo: TipoEspacio = 'ensayo') => crearBaseEspacio(tipo, { persona: PERSONA, calles, detalleCallejero: 'OSM', espacioId: `prueba-${tipo}`, ahora: '2026-10-23T10:00:00.000Z' });
const porId = (db: BaseDatos) => db.meta.espacioCreadoPorId;
/** Decisión autorizada en la solicitud C1e: el censo 2025 incluye visitas de 2024. */
const periodo = (db: BaseDatos): DecisionesIncorporacion => ({ periodoTrabajo: { porId: porId(db), fecha: '2026-10-23', desde: '2024-01-01', hasta: '2025-12-31', motivo: 'El censo 2025 incluye visitas de 2024 (solicitud C1e).' } });
const destino = (tipo: TipoEspacio = 'ensayo') => ({ municipioId: municipioDeEspacio(tipo), anio: 2025 });

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const v = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
  if (!v.ok) throw new Error(v.motivo);
  calles = v.calles;
  bytes = await libroSinteticoC1e(calles);
}, 60000);

describe('C1e · Archivo sintético con las características agregadas del censo real', () => {
  it('reproduce exactamente todos los indicadores del informe agregado y lleva la marca de sintético', async () => {
    const db = base();
    const { resultado } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino(), periodo(db));
    const d = diagnosticoAgregado(resultado);
    expect(d.diferencias).toEqual([]);
    expect(d.indicadores.filter((i) => i.coincide).length).toBeGreaterThanOrEqual(24);
    // Hojas auxiliares presentes y NO usadas como registros
    expect(d.hojas.map((h) => [h.nombre, h.rol, h.usada])).toEqual([['Datos', 'datos', true], ['Tablas Dinámicas', 'resumen', false], ['Hoja1', 'listas', false]]);
    expect(resultado.original.filas).toHaveLength(INFORME_AGREGADO_MEDINA_2025.filas);
    expect(esArchivoSintetico(bytes)).toBe(true);
    // También se reconocen los libros ficticios de la demostración (escenario C1d)
    expect(esArchivoSintetico(await libroEscenarioMedina())).toBe(true);
    // Determinista
    const otra = await libroSinteticoC1e(calles);
    expect(createHash('sha256').update(otra).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});

describe('C1e · Vista previa e incorporación en un espacio aislado', () => {
  it('vista previa: recuentos preparados/vinculados/pendientes/bloqueados, calles exactas y pendientes, mismo portal', async () => {
    const db = base();
    const { resultado, plan } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino(), periodo(db));
    expect(plan.aplicable).toBe(true);
    const r = recuentoRegistros(plan);
    expect(r).toMatchObject({ total: 889, preparados: 889, bloqueados: 0, excluidos: 0 });
    expect(r.vinculados + r.pendientes).toBe(889);
    // Calles: 10 literales + 60 normalizadas (70 existentes) y 23 pendientes; ninguna inventada
    const cc = conciliacionCalles(db, resultado, municipioDeEspacio('ensayo'));
    expect(cc.porEstado.literal.denominaciones).toBe(10);
    expect(cc.porEstado.normalizada.denominaciones).toBe(62);
    expect(cc.porEstado.pendiente.denominaciones).toBe(21);
    expect(cc.porEstado.pendiente.filas).toBe(177);
    expect(cc.porEstado.literal.filas + cc.porEstado.normalizada.filas).toBe(712);
    expect(cc.porEstado.ambigua.denominaciones + cc.porEstado.vacia.denominaciones).toBe(0);
    expect(r.pendientesPorMotivo['calle-sin-correspondencia']).toBe(cc.porEstado.pendiente.filas);
    // Sin número: se conserva el registro, sin local
    expect(r.pendientesPorMotivo['numero-desconocido']).toBeGreaterThan(0);
    // El mismo portal NO es un duplicado: cada fila con calle y número reconocidos tiene su propio local
    expect(plan.mismoPortal.locales).toBeGreaterThan(200);
    expect(plan.filas.filter((f) => f.localNuevo).length).toBe(r.vinculados);
    // Señales sin eliminar registros: número ausente, fachada sin medir, clasificación incompleta, fecha no válida
    const tipos = senales(resultado).map((s) => s.tipo);
    for (const t of ['numero-ausente', 'fecha-no-reconocida', 'local-vacio-ausente']) expect(tipos).toContain(t);
    // Con el periodo decidido, las fechas de 2024 NO quedan fuera de campaña
    expect(tipos).not.toContain('fecha-fuera-de-campana');
  });

  it('sin la decisión de periodo, las fechas de 2024 quedan pendientes (no se cambian ni se usan)', async () => {
    const db = base();
    const { resultado } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino(), {});
    expect(senales(resultado).find((s) => s.tipo === 'fecha-fuera-de-campana')?.filas).toBe(355);
  });

  it('incorpora (atómica), conserva originales y fechas 2024, histórico sin verificar, sin coordenadas; se deshace exactamente', async () => {
    const db0 = base();
    const dec = periodo(db0);
    const { resultado, plan } = await prepararIncorporacion(db0, bytes, ARCHIVO_SINTETICO_C1E, destino(), dec);
    const r = aplicarIncorporacion(db0, resultado, destino(), dec, plan, { porId: porId(db0), ahora: '2026-10-23T11:00:00.000Z' });
    const db = r.db;
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
    expect(Object.keys(db.registros)).toHaveLength(889);
    const camp = db.campanas[r.campanaId];
    expect(camp).toMatchObject({ anio: 2025, tipo: 'historico-importado', periodo: { inicio: '2024-01-01', fin: '2025-12-31' }, estados: { revision: 'pendiente', validacion: 'pendiente' } });
    const obs = Object.values(db.observaciones).filter((o) => o.campanaId === r.campanaId);
    // Cada observación lleva la fecha ORIGINAL de su fila, también las de 2024 (las filas sin calle conservan la suya en el registro)
    expect(obs.filter((o) => o.fecha?.startsWith('2024')).length).toBeGreaterThan(200);
    for (const o of obs) {
      const f = db.registros[o.id.replace(/^obs-/, 'reg-')].original?.fecha;
      if (f?.t === 'fecha') expect(o.fecha).toBe(f.v.slice(0, 10));
    }
    const reg2024 = Object.values(db.registros).filter((x) => x.original?.fecha?.t === 'fecha' && x.original.fecha.v.startsWith('2024'));
    expect(reg2024).toHaveLength(355);
    expect(obs.every((o) => o.verificacion === 'pendiente')).toBe(true);
    expect(Object.values(db.digital).every((d) => d.estado === 'borrador' && Object.values(d.datos).every((x) => x?.origen === 'importado'))).toBe(true);
    expect(Object.values(db.franquicias).every((f) => f.origen === 'importado')).toBe(true);
    expect(Object.keys(db.clasificaciones)).toHaveLength(0); // sin equivalencias aprobadas: texto histórico
    expect(Object.values(db.locales).every((l) => !l.coord)).toBe(true);
    // Valores originales conservados celda a celda (incluida la fecha no válida)
    const conTexto = Object.values(db.registros).find((x) => x.original?.fecha?.t === 'texto');
    expect(conTexto?.original?.fecha).toEqual({ t: 'texto', v: 'FECHA PENDIENTE' });
    // Datos reales: sin ubicaciones simuladas ni coordenadas inventadas
    const d = datosCampana(db, r.campanaId);
    const pos = posicionesEstablecimientos(db, d.municipio, d.unidades);
    expect(pos.posiciones).toHaveLength(0);
    expect(pos.sinPosicion).toBe(d.unidades.filter((u) => u.localId).length);
    // Reimportación del mismo archivo: bloqueada (no se duplica)
    const otra = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino(), dec);
    expect(otra.plan.bloqueos.map((b) => b.codigo)).toEqual(['reimportacion-identica']);
    expect(recuentoRegistros(otra.plan)).toMatchObject({ preparados: 0, bloqueados: 889 });
    // Deshacer: vuelve exactamente a la base anterior (salvo la traza de la importación deshecha)
    const des = deshacerIncorporacion(db, r.importacionId, porId(db0));
    expect({ ...des, importaciones: {}, secuencia: 0 }).toEqual({ ...db0, importaciones: {}, secuencia: 0 });
  }, 60000);

  it('2026 queda intacto: la incorporación de 2025 no completa tareas ni copia resultados', async () => {
    const db0 = base();
    // Campaña 2026 con el itinerario 1: campo terminado; categorización, franquicias, digital y validación pendientes.
    const munId = municipioDeEspacio('ensayo');
    const calle = Object.values(db0.calles)[0];
    db0.campanas['ensayo-camp-2026'] = {
      id: 'ensayo-camp-2026', municipioId: munId, anio: 2026, nombre: 'Censo 2026', tipo: 'actualizacion' as never, periodo: { inicio: '2026-01-01' }, ambitoCalleIds: [calle.id], ampliacionCalleIds: [],
      estados: { planificacion: 'terminado', campo: 'en-curso', revision: 'pendiente', validacion: 'pendiente' }, procedencia: 'manual',
    };
    db0.itinerarios['ensayo-it-1'] = { id: 'ensayo-it-1', campanaId: 'ensayo-camp-2026', codigo: 'IT-1', nombre: 'Itinerario 1', color: '#333', origen: 'app', tramos: [], asignadosIds: [], creado: '2026-02-01' } as never;
    db0.locales['ensayo-loc-2026-1'] = { id: 'ensayo-loc-2026-1', municipioId: munId, direcciones: [{ calleId: calle.id, numero: 999 }], estado: 'activo', procedencia: 'manual' };
    db0.revisiones[kRev('ensayo-camp-2026', 'ensayo-loc-2026-1')] = { campanaId: 'ensayo-camp-2026', localId: 'ensayo-loc-2026-1', campo: 'terminado', categorizacion: 'pendiente', digital: 'pendiente', validacion: 'pendiente' };
    const antes = JSON.stringify([db0.campanas['ensayo-camp-2026'], db0.itinerarios, db0.revisiones]);
    const dec = periodo(db0);
    const { resultado, plan } = await prepararIncorporacion(db0, bytes, ARCHIVO_SINTETICO_C1E, destino(), dec);
    const db = aplicarIncorporacion(db0, resultado, destino(), dec, plan, { porId: porId(db0) }).db;
    expect(JSON.stringify([db.campanas['ensayo-camp-2026'], db.itinerarios, db.revisiones])).toBe(antes);
    for (const col of ['franquicias', 'digital', 'clasificaciones'] as const) expect(Object.values(db[col]).some((x) => x.campanaId === 'ensayo-camp-2026')).toBe(false);
    // No se pueden incorporar datos como si fueran de 2026 (año en curso)
    const p26 = await prepararIncorporacion(db0, bytes, ARCHIVO_SINTETICO_C1E, { municipioId: munId, anio: 2026 }, {});
    expect(p26.plan.aplicable).toBe(false);
  }, 60000);
});

describe('C1e · Separación de espacios y respaldo recuperable', () => {
  it('ensayo, real y demostración no comparten ningún identificador', async () => {
    const demo = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'c1e' });
    const ens = base('ensayo');
    const real = base('real');
    const dec = periodo(ens);
    const { resultado, plan } = await prepararIncorporacion(ens, bytes, ARCHIVO_SINTETICO_C1E, destino('ensayo'), dec);
    const ensCon = aplicarIncorporacion(ens, resultado, destino('ensayo'), dec, plan, { porId: porId(ens) }).db;
    const colecciones = ['municipios', 'calles', 'campanas', 'locales', 'negocios', 'registros', 'observaciones', 'ocupaciones', 'vinculos', 'importaciones', 'personas'] as const;
    for (const col of colecciones) {
      const a = new Set(Object.keys(ensCon[col]));
      for (const k of Object.keys(demo[col])) expect(a.has(k)).toBe(false);
      for (const k of Object.keys(real[col])) expect(a.has(k)).toBe(false);
    }
    expect(verificarEspacio(real, 'real')).toEqual([]);
    expect(verificarEspacio(ensCon, 'real')[0]).toMatch(/espacio «ensayo»/);
    expect(verificarEspacio(demo, 'real')[0]).toMatch(/sin marca de espacio|no lleva marca/);
  }, 60000);

  it('el respaldo se recupera íntegro; se rechaza si está dañado o es de otro espacio', async () => {
    const db0 = base();
    const dec = periodo(db0);
    const { resultado, plan } = await prepararIncorporacion(db0, bytes, ARCHIVO_SINTETICO_C1E, destino(), dec);
    const db = aplicarIncorporacion(db0, resultado, destino(), dec, plan, { porId: porId(db0) }).db;
    const r = crearRespaldo(db, 'ensayo', '2026-10-23T12:00:00.000Z');
    expect(r.nombreArchivo).toBe('ULIT-Censo-ensayo-respaldo-2026-10-23-12-00-00.json');
    expect(r.resumen).toMatchObject({ registros: 889 });
    const c = comprobarRespaldo(r.texto, 'ensayo');
    expect(c.ok).toBe(true);
    if (c.ok) expect(huellaBase(c.db)).toBe(huellaBase(db));
    expect(comprobarRespaldo(r.texto, 'real')).toMatchObject({ ok: false, motivo: expect.stringMatching(/espacio «ensayo»/) });
    const danado = r.texto.replace('"anio":2025', '"anio":2024');
    expect(danado).not.toBe(r.texto);
    expect(comprobarRespaldo(danado, 'ensayo')).toMatchObject({ ok: false, motivo: expect.stringMatching(/huella SHA-256 no coincide/) });
    expect(comprobarRespaldo('{"hola":1}', 'ensayo')).toMatchObject({ ok: false });
    // Una base de demostración no se respalda como espacio
    const demo = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'c1e' });
    expect(() => crearRespaldo(demo, 'real')).toThrow(/verificación del espacio/);
  }, 60000);

  it('no se crea un espacio sin el callejero real', () => {
    expect(() => crearBaseEspacio('real', { persona: PERSONA, calles: callejeroSimulado(MEDINA.id, MEDINA.centro), detalleCallejero: 'sim', espacioId: 'x' })).toThrow(/callejero real/);
  });
});
