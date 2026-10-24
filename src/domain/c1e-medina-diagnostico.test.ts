// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { validarInstantanea } from '../data/instantaneaOsm';
import { ARCHIVO_SINTETICO_C1E, CALLE_SN, libroSinteticoC1e, PORTALES_VARIANTE } from '../data/xlsxSinteticoC1e';
import { crearBaseEspacio, municipioDeEspacio } from './espacios';
import { conciliacionCalles, denominacionesPorConciliar, diagnosticoAgregado, INFORME_AGREGADO_MEDINA_2025, senales } from './c1e';
import { FUENTE_TXT, proponer } from './conciliacionCalles';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion, planificarIncorporacion, type DecisionesIncorporacion } from './incorporacion';
import { gruposEnBloque, itemsRevision, resumenClases } from './incorporacionDemo';
import { mostrarOriginal } from './xlsx/interpretacion';
import { claveCalle } from './text';
import type { BaseDatos } from './db';
import type { Calle } from './types';

/**
 * Casos del análisis del Excel AUTÉNTICO de Medina 2025, reproducidos con el archivo SINTÉTICO (ningún
 * dato real): dos grafías de una calle en cinco portales, tres «S/N» en la misma vía, 21 denominaciones
 * sin correspondencia (177 registros) y la revisión de incidencias por clases.
 */
let calles: Calle[];
let bytes: Uint8Array;
const PERSONA = { nombre: 'Persona de Prueba', roles: ['coordinador' as const] };
const base = () => crearBaseEspacio('ensayo', { persona: PERSONA, calles, detalleCallejero: 'OSM (instantánea del proyecto)', espacioId: 'prueba-md', ahora: '2026-10-24T10:00:00.000Z' });
const destino = { municipioId: municipioDeEspacio('ensayo'), anio: 2025 };
const firma = (db: BaseDatos) => ({ porId: db.meta.espacioCreadoPorId!, fecha: '2026-10-24' });
const periodo = (db: BaseDatos): DecisionesIncorporacion => ({ periodoTrabajo: { ...firma(db), desde: '2024-01-01', hasta: '2025-12-31', motivo: 'El censo 2025 incluye visitas de 2024.' } });
const calleId = (db: BaseDatos, nombre: string) => Object.values(db.calles).find((c) => c.nombre === nombre)!.id;

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const v = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
  if (!v.ok) throw new Error(v.motivo);
  calles = v.calles;
  bytes = await libroSinteticoC1e(calles);
}, 60000);

describe('Diagnóstico corregido · calles normalizadas y «S/N»', () => {
  it('pares y portales compartidos con la calle normalizada coinciden con la referencia (625 / 445); sin normalizar serían 630 / 440', async () => {
    const db = base();
    const { resultado } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino, {});
    const d = diagnosticoAgregado(resultado, INFORME_AGREGADO_MEDINA_2025);
    const v = (k: string) => d.indicadores.find((i) => i.clave === k);
    expect(d.diferencias).toEqual([]);
    expect(v('pares')).toMatchObject({ valor: 625, esperado: 625, coincide: true });
    expect(v('pares-repetidos')).toMatchObject({ valor: 186, coincide: true });
    expect(v('registros-mismo-portal')).toMatchObject({ valor: 445, esperado: 445, coincide: true });
    // Conceptos distintos, cada uno con su cifra
    expect(v('registros-sn-agrupados')?.valor).toBe(3);
    expect(v('registros-portal-numerico')?.valor).toBe(442);
    expect(v('pares-literales')?.valor).toBe(630);
    expect(v('pares-literales')?.nota).toMatch(/440 registros/);
    expect(v('calles-literales')).toMatchObject({ valor: 93, coincide: true });
    expect(v('calles-mayusculas')).toMatchObject({ valor: 92, coincide: true });
    // La regla informativa de C1b cuenta solo portales NUMÉRICOS
    const s = senales(resultado).find((x) => x.tipo === 'direccion-repetida')!;
    expect(s.filas).toBe(442);
    expect(s.titulo).toMatch(/portal numérico/);
  });

  it('los valores originales se conservan: las dos grafías, los «S/N», las 889 filas y sus fechas', async () => {
    const db = base();
    const { resultado } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino, {});
    const filas = resultado.original.filas;
    expect(filas).toHaveLength(889);
    const lit = (f: (typeof filas)[number]) => (f.celdas.direccion?.t === 'texto' ? f.celdas.direccion.v : '');
    for (const n of PORTALES_VARIANTE) {
      const enPortal = filas.filter((f) => lit(f).toLowerCase() === 'calle de las angustias' && f.celdas.numero?.t === 'numero' && f.celdas.numero.v === n);
      expect(enPortal.map(lit).sort()).toEqual(['Calle de las Angustias', 'Calle de las Angustias', 'Calle de las angustias']);
      // Cada registro es un local independiente del mismo portal (C1b los agrupa sin fusionarlos)
      const grupos = new Set(enPortal.map((f) => resultado.filas.find((x) => x.fila === f.fila)!.grupoDireccion));
      expect(grupos.size).toBe(1);
      expect([...grupos][0]).toBeDefined();
    }
    const sn = filas.filter((f) => lit(f) === CALLE_SN && f.celdas.numero?.t === 'texto' && f.celdas.numero.v === 'S/N');
    expect(sn).toHaveLength(3);
    expect(sn.every((f) => resultado.filas.find((x) => x.fila === f.fila)!.grupoDireccion === undefined)).toBe(true);
    const anios = filas.map((f) => (f.celdas.fecha?.t === 'fecha' ? f.celdas.fecha.v.slice(0, 4) : null));
    expect(anios.filter((a) => a === '2024')).toHaveLength(355);
    expect(anios.filter((a) => a === '2025')).toHaveLength(533);
  });
});

describe('Conciliación supervisada de calles', () => {
  it('21 denominaciones sin correspondencia (177 registros); las prioritarias con su propuesta y su fuente', async () => {
    const db = base();
    const { resultado, plan } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino, periodo(db));
    const cc = conciliacionCalles(db, resultado, destino.municipioId);
    expect(cc.porEstado.pendiente).toEqual({ denominaciones: 21, filas: 177 });
    expect(cc.porEstado.literal.filas + cc.porEstado.normalizada.filas).toBe(712);
    // Nada se aplica sin decisión: las 177 filas siguen sin vínculo
    expect(plan.correspondencias.porMotivo['calle-sin-correspondencia']).toBe(177);
    const lista = denominacionesPorConciliar(db, resultado, destino.municipioId);
    expect(lista.slice(0, 4).map((d) => [d.denominacion, d.filas])).toEqual([
      ['Plaza Mayor', 45], ['Calle de las Farolas Antigua Ángel Molina', 42], ['Rda. de Gracia', 19], ['Rda. de las Flores', 13],
    ]);
    const [plaza, farolas, gracia, flores] = lista;
    expect(plaza.propuestas).toEqual([]);
    expect(plaza.ausente?.oficial).toBe('Plaza Mayor de la Hispanidad');
    expect(plaza.ausente?.nota).toMatch(/NO figura en el callejero OSM actual.*ni se inventa su geometría/);
    expect(farolas.propuestas.map((p) => [p.calle, p.fuente])).toEqual([['Calle de las Farolas', 'denominacion-actual-y-antigua']]);
    expect(gracia.propuestas.map((p) => [p.calle, p.fuente])).toEqual([['Ronda de Gracia', 'abreviatura-tipo-via']]);
    expect(flores.propuestas.map((p) => [p.calle, p.fuente])).toEqual([['Ronda de las Flores', 'abreviatura-tipo-via']]);
    expect(lista.slice(4).every((d) => d.propuestas.length === 0)).toBe(true);
  });

  it('«Plaza Mayor de la Hispanidad» no está en el callejero OSM actual (ni con otro tipo de vía)', () => {
    const clave = claveCalle('Plaza Mayor de la Hispanidad');
    expect(calles.some((c) => claveCalle(c.nombre) === clave)).toBe(false);
    expect(calles.some((c) => /hispanidad/i.test(c.nombre))).toBe(false);
    expect(calles.some((c) => /^plaza mayor/i.test(c.nombre))).toBe(false);
  });

  it('la similitud textual sola se propone como tal y nunca vincula nada sin decisión', () => {
    const p = proponer('Calle de las Farolaz', calles);
    expect(p.propuestas[0]).toMatchObject({ calle: 'Calle de las Farolas', fuente: 'similitud-textual' });
    expect(FUENTE_TXT['similitud-textual'].solida).toBe(false);
    expect(proponer('VÍA SINTÉTICA SIN CALLEJERO 01', calles).propuestas).toEqual([]);
  });

  it('una decisión trazada vincula TODOS los registros de la denominación; el original no cambia; «sin correspondencia» no inventa nada', async () => {
    const db = base();
    const callesAntes = Object.keys(db.calles).length;
    const farolas = calleId(db, 'Calle de las Farolas');
    const dec: DecisionesIncorporacion = {
      ...periodo(db),
      calles: [
        { denominacion: 'Calle de las Farolas Antigua Ángel Molina', accion: 'vincular', calleId: farolas, fuente: 'denominacion-actual-y-antigua', ...firma(db), motivo: 'Nomenclátor municipal: la calle de Ángel Molina pasó a llamarse de las Farolas.' },
        { denominacion: 'Plaza Mayor', accion: 'sin-correspondencia', ...firma(db), motivo: 'Plaza Mayor de la Hispanidad no está en el callejero OSM actual.' },
      ],
    };
    const { resultado, plan } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino, dec);
    expect(plan.aplicable).toBe(true);
    expect(plan.correspondencias.porMotivo['calle-sin-correspondencia']).toBe(177 - 42);
    const filasFarolas = resultado.original.filas.filter((f) => f.celdas.direccion?.t === 'texto' && f.celdas.direccion.v === 'Calle de las Farolas Antigua Ángel Molina').map((f) => f.fila);
    expect(filasFarolas).toHaveLength(42);
    const pf = plan.filas.filter((f) => filasFarolas.includes(f.fila));
    expect(pf.every((f) => f.calleId === farolas && f.calleDecidida)).toBe(true);
    expect(pf.filter((f) => f.localNuevo).every((f) => f.correspondencia === 'decidida')).toBe(true);
    const cc = conciliacionCalles(db, resultado, destino.municipioId, dec);
    expect(cc.porEstado.conciliada).toEqual({ denominaciones: 1, filas: 42 });
    expect(cc.porEstado['sin-correspondencia']).toEqual({ denominaciones: 1, filas: 45 });
    expect(cc.porEstado.pendiente).toEqual({ denominaciones: 19, filas: 90 });

    // Aplicación: originales literales, decisión en la traza, sin calles ni coordenadas nuevas
    const r = aplicarIncorporacion(db, resultado, destino, dec, plan, { porId: firma(db).porId, ahora: '2026-10-24T11:00:00.000Z' });
    expect(Object.keys(r.db.registros)).toHaveLength(889);
    expect(Object.keys(r.db.calles)).toHaveLength(callesAntes);
    expect(Object.values(r.db.locales).every((l) => !l.coord)).toBe(true);
    const reg = Object.values(r.db.registros).find((x) => x.fila === filasFarolas[0])!;
    expect(mostrarOriginal(reg.original!.direccion)).toMatch(/Calle de las Farolas Antigua Ángel Molina/);
    expect((r.db.importaciones[r.importacionId].c1!.decisiones as DecisionesIncorporacion).calles).toEqual(dec.calles);
    const localesFarolas = Object.values(r.db.locales).filter((l) => l.direcciones[0].calleId === farolas);
    expect(localesFarolas.length).toBe(pf.filter((f) => f.localNuevo).length);
  });

  it('decisiones de calle no válidas bloquean el plan (sin firma, calle ajena, denominación inexistente); la justificación es opcional', async () => {
    const db = base();
    const { resultado } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino, periodo(db));
    const farolas = calleId(db, 'Calle de las Farolas');
    const casos: DecisionesIncorporacion['calles'][] = [
      [{ denominacion: 'Plaza Mayor', accion: 'sin-correspondencia', porId: 'nadie', fecha: '2026-10-24', motivo: 'x' }],
      [{ denominacion: 'Rda. de Gracia', accion: 'vincular', calleId: 'calle-de-otro-municipio', fuente: 'abreviatura-tipo-via', ...firma(db), motivo: 'x' }],
      [{ denominacion: 'Calle Inventada', accion: 'vincular', calleId: farolas, fuente: 'eleccion-manual', ...firma(db), motivo: 'x' }],
    ];
    for (const calles of casos) {
      const p = planificarIncorporacion(db, resultado, destino, { ...periodo(db), calles });
      expect(p.aplicable).toBe(false);
      expect(p.bloqueos.map((b) => b.codigo)).toContain('decision-invalida');
    }
  });
});

describe('Revisión de incidencias por clases y en bloque', () => {
  it('separa errores efectivos, pendientes de comprobar e informativos; la clasificación 2025 no exige equivalencia 2026', async () => {
    const db = base();
    const dec = periodo(db);
    const { resultado, plan } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino, dec);
    const items = itemsRevision(resultado, plan, dec);
    const r = resumenClases(items);
    expect(r.error.total + r.comprobar.total + r.informativo.total).toBe(items.length);
    expect(r.error.total).toBeGreaterThan(0);
    expect(r.comprobar.total).toBeGreaterThan(0);
    const de = (g: string) => items.filter((i) => i.grupo === g);
    expect(de('fecha-no-reconocida').every((i) => i.clase === 'error')).toBe(true);
    expect(de('local-vacio-ausente').every((i) => i.clase === 'error')).toBe(true);
    expect(de('direccion-repetida').every((i) => i.clase === 'informativo' && i.estado === 'no-aplica')).toBe(true);
    expect(de('direccion-repetida')).toHaveLength(442);
    expect(de('correspondencia:calle-sin-correspondencia').every((i) => i.clase === 'comprobar')).toBe(true);
    const historicas = items.filter((i) => i.categoria === 'clasificacion');
    expect(historicas.every((i) => i.clase === 'informativo' && i.estado === 'no-aplica')).toBe(true);
  });

  it('revisión en bloque: solo grupos de revisión humana, sin justificación obligatoria; no cambia ningún dato', async () => {
    const db = base();
    const dec = periodo(db);
    const { resultado, plan } = await prepararIncorporacion(db, bytes, ARCHIVO_SINTETICO_C1E, destino, dec);
    const grupos = gruposEnBloque(itemsRevision(resultado, plan, dec));
    expect(grupos.length).toBeGreaterThan(0);
    expect(grupos.some((g) => ['posible-fila-de-totales', 'fila-duplicada-exacta', 'direccion-repetida'].includes(g.tipo))).toBe(false);
    const g = grupos.find((x) => x.tipo === 'local-vacio-ausente')!;
    expect(g.filas).toHaveLength(1);
    // Sin justificación: basta con quién y cuándo
    const conBloque: DecisionesIncorporacion = { ...dec, revisionesBloque: [{ tipo: g.tipo, filas: g.filas, ...firma(db) }] };
    const p2 = planificarIncorporacion(db, resultado, destino, conBloque);
    expect(p2.aplicable).toBe(true);
    expect(p2.filas).toEqual(plan.filas);
    expect(p2.decisiones.revisionesBloque).toBe(1);
    const items2 = itemsRevision(resultado, p2, conBloque);
    expect(items2.filter((i) => i.grupo === g.tipo).every((i) => i.estado === 'resuelto')).toBe(true);
    // Sin persona, sobre algo que depende de la Cátedra o con filas inexistentes: no válido
    for (const rb of [
      { tipo: g.tipo, filas: g.filas, porId: 'nadie', fecha: '2026-10-24' },
      { tipo: 'fachada-con-unidad', filas: g.filas, ...firma(db) },
      { tipo: g.tipo, filas: [99999], ...firma(db) },
    ]) {
      expect(planificarIncorporacion(db, resultado, destino, { ...dec, revisionesBloque: [rb] }).bloqueos.map((b) => b.codigo)).toContain('decision-invalida');
    }
  });
});
