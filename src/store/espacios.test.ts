import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createStore, get as idbGet, set as idbSet, clear as idbClear } from 'idb-keyval';
import { CONFIRMACION_REAL_HABILITADA, requisitosIncorporacion, useEspacios } from './espacios';
import { useStore } from './store';
import { validarInstantanea } from '../data/instantaneaOsm';
import { ARCHIVO_SINTETICO_C1E, libroSinteticoC1e } from '../data/xlsxSinteticoC1e';
import { prepararIncorporacion } from '../domain/incorporacionXlsx';
import { huellaBase, municipioDeEspacio, type TipoEspacio } from '../domain/espacios';
import type { DecisionesIncorporacion } from '../domain/incorporacion';
import type { BaseDatos } from '../domain/db';

/** IndexedDB simulada (fake-indexeddb), callejero REAL de OSM y archivo SINTÉTICO de C1e. */
const snapshot = readFileSync('public/data/medina-callejero.json', 'utf8');
let bytes: Uint8Array;
const PERSONA = { nombre: 'Coordinación de Prueba', roles: ['coordinador' as const] };
const respuesta = (texto: string) => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => JSON.parse(texto) }) as unknown as Response;

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const v = validarInstantanea(JSON.parse(snapshot));
  if (!v.ok) throw new Error(v.motivo);
  bytes = await libroSinteticoC1e(v.calles);
}, 60000);

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => respuesta(snapshot)));
  for (const t of ['ensayo', 'real'] as TipoEspacio[]) await idbClear(createStore(`ulit-censo-${t}`, 'datos'));
  useEspacios.getState().cerrar();
});
afterEach(() => vi.unstubAllGlobals());

const decisiones = (db: BaseDatos): DecisionesIncorporacion => ({ periodoTrabajo: { porId: db.meta.espacioCreadoPorId, fecha: '2026-10-23', desde: '2024-01-01', hasta: '2025-12-31', motivo: 'Visitas de 2024 (solicitud C1e).' } });

async function abrirYCrear(tipo: TipoEspacio) {
  await useEspacios.getState().abrir(tipo);
  expect(useEspacios.getState().fase).toBe('sin-crear');
  expect(await useEspacios.getState().crear(PERSONA)).toEqual({ ok: true });
  return useEspacios.getState().db!;
}

async function preparar(tipo: TipoEspacio, db: BaseDatos) {
  const destino = { municipioId: municipioDeEspacio(tipo), anio: 2025 };
  const dec = decisiones(db);
  const { resultado, plan } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino, dec);
  return { destino, dec, resultado, plan };
}

const requisitos = (tipo: TipoEspacio, plan: Awaited<ReturnType<typeof preparar>>['plan'], sintetico = true) => {
  const s = useEspacios.getState();
  return requisitosIncorporacion({ tipo, db: s.db!, huella: s.huella, respaldoVerificado: s.respaldoVerificado, almacenamiento: s.almacenamiento, plan, vistaPreviaRevisada: true, sintetico });
};

async function respaldarYComprobar() {
  const r = useEspacios.getState().prepararRespaldo();
  return useEspacios.getState().verificarRespaldo(r.texto, r.nombreArchivo).then((v) => ({ ...v, r }));
}

describe('C1e · Almacén de espacios aislados', () => {
  it('crea el espacio en su propia base de IndexedDB, sin sobrescribir y sin tocar la demostración', async () => {
    const db = await abrirYCrear('ensayo');
    expect(db.meta.espacio).toBe('ensayo');
    expect(Object.values(db.calles).every((c) => c.procedencia === 'osm' && c.id.startsWith('ensayo-'))).toBe(true);
    // Persistido y verificado en «ulit-censo-ensayo»
    const guardada = await idbGet<BaseDatos>('db', createStore('ulit-censo-ensayo', 'datos'));
    expect(huellaBase(guardada!)).toBe(useEspacios.getState().huella);
    // Nada en la demostración ni en el espacio real
    expect(await idbGet('ulit-censo:demo-db')).toBeUndefined();
    expect(await idbGet('db', createStore('ulit-censo-real', 'datos'))).toBeUndefined();
    // Volver a crear: no se sobrescribe
    expect(await useEspacios.getState().crear(PERSONA)).toMatchObject({ ok: false, error: expect.stringMatching(/ya existe/) });
    // Reabrir: misma base
    await useEspacios.getState().abrir('ensayo');
    expect(useEspacios.getState().db!.meta.espacioId).toBe(db.meta.espacioId);
  }, 60000);

  it('incorporar exige un respaldo externo comprobado del estado actual; tras incorporar, hace falta otro', async () => {
    const db = await abrirYCrear('ensayo');
    const p = await preparar('ensayo', db);
    const sinRespaldo = requisitos('ensayo', p.plan);
    expect(sinRespaldo.find((r) => r.id === 'respaldo')?.ok).toBe(false);
    expect(await useEspacios.getState().incorporar({ ...p, decisiones: p.dec, requisitos: sinRespaldo })).toMatchObject({ ok: false, error: expect.stringMatching(/respaldo/) });
    expect(Object.keys(useEspacios.getState().db!.registros)).toHaveLength(0);

    expect(await respaldarYComprobar()).toMatchObject({ ok: true, coincide: true });
    const req = requisitos('ensayo', p.plan);
    expect(req.filter((r) => !r.ok)).toEqual([]);
    const r = await useEspacios.getState().incorporar({ ...p, decisiones: p.dec, requisitos: req });
    expect(r).toMatchObject({ ok: true, creadas: { registros: 889 } });
    const guardada = await idbGet<BaseDatos>('db', createStore('ulit-censo-ensayo', 'datos'));
    expect(Object.keys(guardada!.registros)).toHaveLength(889);
    // El respaldo comprobado ya no corresponde al estado actual
    expect(requisitos('ensayo', p.plan).find((x) => x.id === 'respaldo')?.ok).toBe(false);
    // Deshacer: exacto y guardado
    expect(await useEspacios.getState().deshacer(r.importacionId!)).toEqual({ ok: true });
    expect(Object.keys((await idbGet<BaseDatos>('db', createStore('ulit-censo-ensayo', 'datos')))!.registros)).toHaveLength(0);
  }, 90000);

  it('espacio REAL: no admite archivos sintéticos y la confirmación está bloqueada (C1e-B)', async () => {
    expect(CONFIRMACION_REAL_HABILITADA).toBe(false);
    const db = await abrirYCrear('real');
    const p = await preparar('real', db);
    await respaldarYComprobar();
    const req = requisitos('real', p.plan, true);
    expect(req.find((r) => r.id === 'archivo')).toMatchObject({ ok: false, texto: expect.stringMatching(/SINTÉTICO/) });
    expect(req.find((r) => r.id === 'confirmacion-real')).toMatchObject({ ok: false, texto: expect.stringMatching(/BLOQUEADA/) });
    // Aunque la interfaz pasase requisitos falsos, el almacén se niega
    const todoOk = req.map((r) => ({ ...r, ok: true }));
    expect(await useEspacios.getState().incorporar({ ...p, decisiones: p.dec, requisitos: todoOk })).toMatchObject({ ok: false, error: expect.stringMatching(/C1e-B/) });
    expect(Object.keys((await idbGet<BaseDatos>('db', createStore('ulit-censo-real', 'datos')))!.registros)).toHaveLength(0);
  }, 90000);

  it('si otra pestaña cambió el espacio, no se escribe nada', async () => {
    const db = await abrirYCrear('ensayo');
    const p = await preparar('ensayo', db);
    await respaldarYComprobar();
    const req = requisitos('ensayo', p.plan);
    const st = createStore('ulit-censo-ensayo', 'datos');
    const otra = { ...db, meta: { ...db.meta, nota: 'cambio en otra pestaña' } };
    await idbSet('db', otra, st);
    const r = await useEspacios.getState().incorporar({ ...p, decisiones: p.dec, requisitos: req });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/otra pestaña/) });
    expect((await idbGet<BaseDatos>('db', st))!.meta.nota).toBe('cambio en otra pestaña');
  }, 90000);

  it('restaura un respaldo comprobado; rechaza los dañados, los de otro tipo y los de otro espacio', async () => {
    const db = await abrirYCrear('ensayo');
    const { r } = await respaldarYComprobar();
    const p = await preparar('ensayo', db);
    await useEspacios.getState().incorporar({ ...p, decisiones: p.dec, requisitos: requisitos('ensayo', p.plan) });
    expect(Object.keys(useEspacios.getState().db!.registros)).toHaveLength(889);
    const danado = r.texto.replace('"nombre":"Coordinación de Prueba"', '"nombre":"Otra persona"');
    expect(danado).not.toBe(r.texto);
    expect(await useEspacios.getState().restaurar(danado)).toMatchObject({ ok: false, error: expect.stringMatching(/SHA-256/) });
    expect(await useEspacios.getState().restaurar(r.texto)).toEqual({ ok: true });
    expect(Object.keys(useEspacios.getState().db!.registros)).toHaveLength(0);
    expect(huellaBase(useEspacios.getState().db!)).toBe(huellaBase(db));
    // Copia interna previa a la restauración
    const interna = await idbGet<{ db: BaseDatos }>('respaldo-interno', createStore('ulit-censo-ensayo', 'datos'));
    expect(Object.keys(interna!.db.registros)).toHaveLength(889);
    // Un respaldo del ensayo no sirve para el espacio real
    await abrirYCrear('real');
    expect(await useEspacios.getState().restaurar(r.texto)).toMatchObject({ ok: false, error: expect.stringMatching(/espacio «ensayo»/) });
  }, 120000);

  it('la demostración no abre ni guarda una base de un espacio aislado', async () => {
    const db = await abrirYCrear('real');
    await idbSet('ulit-censo:demo-db', db);
    useStore.setState({ db: null, carga: { fase: 'inicio', mensaje: '' } });
    await useStore.getState().inicializar();
    expect(useStore.getState().carga).toMatchObject({ fase: 'error', mensaje: expect.stringMatching(/espacio aislado/) });
    await idbSet('ulit-censo:demo-db', undefined);
  }, 60000);
});
