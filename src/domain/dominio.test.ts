import { beforeAll, describe, expect, it } from 'vitest';
import { callejeroSimulado, callesDesdeOverpass, MEDINA } from '../data/callejero';
import { generarDemo } from '../data/semilla';
import type { BaseDatos } from './db';
import { kMet } from './db';
import { coberturaCalle, itinerariosDe, localesPrevios, ocupacionEn, situacionPrevia } from './consultas';
import { asignacionDelAmbito, detectarSolapes, estaCubierta, seSolapan } from './planificacion';
import { alternarCalle, alternarSegmento, actualizarTramo, crearItinerario } from './itinerarios';
import {
  confirmarSinCambios, finalizarCalle, marcarPosibleDesaparicion, registrarLocalNuevo, registrarNuevoNegocio, validarFinalizacion, type Contexto,
} from './campo';
import { resolverVinculo } from './conciliacion';
import { compararCampanas } from './estadisticas';
import { casarTrazosKML, compararImportacion, interpretarFilas, mapearCabecera, parsearCSV, parsearKML } from './importacion';
import { aprobar, filasOficina, partirDeAnterior } from './oficina';
import { aCSV } from './exportacion';
import { distanciaPuntoLinea } from './geo';
import { indiceObservaciones, indiceOcupaciones } from './consultas';
import type { Calle, TramoPlan } from './types';

let base: BaseDatos;
const C26 = 'camp-medina-2026';
const ctx = (extra: Partial<Contexto> = {}): Contexto => ({ campanaId: C26, investigadorId: 'p-ana', fecha: '2026-10-01T10:00:00', ...extra });

beforeAll(() => {
  base = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'test' });
});

/** Una calle del ámbito 2026 con locales anteriores y sin observar todavía en 2026. */
function callePendienteConLocales(db: BaseDatos) {
  const camp = db.campanas[C26];
  return camp.ambitoCalleIds.find((id) => localesPrevios(db, camp.campanaReferenciaId, id).length >= 3 && !Object.values(db.observaciones).some((o) => o.campanaId === C26 && o.calleId === id))!;
}

describe('planificación', () => {
  const t = (p: Partial<TramoPlan>): TramoPlan => ({ calleId: 'c1', acera: 'ambas', orden: 1, ...p });

  it('detecta solapes por acera y por segmentos', () => {
    expect(seSolapan(t({}), t({ acera: 'par' }))).toBe(true);
    expect(seSolapan(t({ acera: 'par' }), t({ acera: 'impar' }))).toBe(false);
    expect(seSolapan(t({ segmentoIds: ['a'] }), t({ segmentoIds: ['b'] }))).toBe(false);
    expect(seSolapan(t({ segmentoIds: ['a', 'b'] }), t({ segmentoIds: ['b'] }))).toBe(true);
  });

  it('una calle repartida por aceras entre dos itinerarios queda cubierta y sin solape', () => {
    const calle = { id: 'c1', segmentos: [{ id: 's1' }, { id: 's2' }] } as unknown as Calle;
    expect(estaCubierta([t({ acera: 'par' }), t({ acera: 'impar' })], calle)).toBe(true);
    expect(estaCubierta([t({ acera: 'par' })], calle)).toBe(false);
    expect(estaCubierta([t({ segmentoIds: ['s1'] })], calle)).toBe(false);
  });

  it('añadir una calle la incluye completa y, si es nueva, como ampliación', () => {
    const camp = base.campanas[C26];
    const fuera = Object.values(base.calles).find((c) => c.municipioId === MEDINA.id && !camp.ambitoCalleIds.includes(c.id))!;
    const r0 = crearItinerario(base, C26, { codigo: 'IT-T', nombre: 'Test', color: '#000' });
    const { db, anadida } = alternarCalle(r0.db, r0.id, fuera.id);
    expect(anadida).toBe(true);
    const tramo = db.itinerarios[r0.id].tramos[0];
    expect(tramo.segmentoIds).toBeUndefined();
    expect(tramo.acera).toBe('ambas');
    expect(db.campanas[C26].ambitoCalleIds).toContain(fuera.id);
    expect(db.campanas[C26].ampliacionCalleIds).toContain(fuera.id);
    // los locales y el histórico no cambian al planificar
    expect(db.locales).toBe(base.locales);
    expect(db.observaciones).toBe(base.observaciones);
  });

  it('la división por segmentos nunca deja un tramo vacío y vuelve a «calle completa»', () => {
    const calle = Object.values(base.calles).find((c) => c.municipioId === MEDINA.id && c.segmentos.length >= 2)!;
    const r0 = crearItinerario(base, C26, { codigo: 'IT-T', nombre: 'Test', color: '#000' });
    let db = alternarCalle(r0.db, r0.id, calle.id).db;
    db = alternarSegmento(db, r0.id, calle, calle.segmentos[0].id);
    expect(db.itinerarios[r0.id].tramos[0].segmentoIds).toHaveLength(calle.segmentos.length - 1);
    db = alternarSegmento(db, r0.id, calle, calle.segmentos[0].id);
    expect(db.itinerarios[r0.id].tramos[0].segmentoIds).toBeUndefined();
  });

  it('señala solapes entre itinerarios y calles sin asignar', () => {
    const its = itinerariosDe(base, C26);
    const calle = its[0].tramos[0].calleId;
    let db = alternarCalle(base, its[1].id, calle).db;
    expect(detectarSolapes(itinerariosDe(db, C26)).some((s) => s.calleId === calle)).toBe(true);
    db = actualizarTramo(db, its[0].id, calle, { acera: 'par' });
    db = actualizarTramo(db, its[1].id, calle, { acera: 'impar' });
    expect(detectarSolapes(itinerariosDe(db, C26)).some((s) => s.calleId === calle)).toBe(false);
    const asig = asignacionDelAmbito(db.campanas[C26], itinerariosDe(db, C26), db.calles);
    expect(asig.sinAsignar.length).toBeGreaterThan(0);
  });

  it('no deduce «sin locales» de la ausencia de filas en un censo importado', () => {
    const camp = base.campanas[C26];
    const ampl = camp.ampliacionCalleIds[0];
    expect(situacionPrevia(base, camp, ampl)).toBe('sin-informacion');
  });
});

describe('trabajo de campo', () => {
  it('confirmar sin cambios no pide datos y deja la calle en curso', () => {
    const calle = callePendienteConLocales(base);
    const l = localesPrevios(base, 'camp-medina-2025', calle)[0];
    const db = confirmarSinCambios(base, ctx(), l.id);
    const obs = Object.values(db.observaciones).find((o) => o.campanaId === C26 && o.localId === l.id)!;
    expect(obs.tipo).toBe('confirmado');
    expect(coberturaCalle(db, C26, calle).estado).toBe('en-curso');
  });

  it('un negocio nuevo en el local no hereda los perfiles digitales del anterior', () => {
    const conMetrica = Object.values(base.ocupaciones).find((o) => o.negocioId && !o.hastaCampanaId && base.metricas[kMet(o.negocioId, 'camp-medina-2025')] && !Object.values(base.observaciones).some((x) => x.campanaId === C26 && x.localId === o.localId))!;
    const db = registrarNuevoNegocio(base, ctx(), conMetrica.localId, 'Peluquería Prueba');
    const nueva = ocupacionEn(db, conMetrica.localId, C26)!;
    expect(nueva.negocioId).not.toBe(conMetrica.negocioId);
    expect(Object.values(db.metricas).some((m) => m.negocioId === nueva.negocioId)).toBe(false);
    // el histórico conserva el negocio anterior en 2025
    expect(ocupacionEn(db, conMetrica.localId, 'camp-medina-2025')!.negocioId).toBe(conMetrica.negocioId);
  });

  it('una posible desaparición no cierra la ocupación (no es un cierre)', () => {
    const calle = callePendienteConLocales(base);
    const l = localesPrevios(base, 'camp-medina-2025', calle)[0];
    const antes = ocupacionEn(base, l.id, C26);
    const db = marcarPosibleDesaparicion(base, ctx(), l.id);
    expect(db.locales[l.id].estado).toBe('posible-desaparicion');
    expect(ocupacionEn(db, l.id, C26)).toEqual(antes);
  });

  it('finalizar exige aceras y no admite «sin locales» si hay locales registrados', () => {
    const calle = callePendienteConLocales(base);
    expect(validarFinalizacion(base, C26, calle, { par: true, impar: false, resultado: 'completada-con-locales' }).ok).toBe(false);
    let db = base;
    for (const l of localesPrevios(base, 'camp-medina-2025', calle)) db = confirmarSinCambios(db, ctx(), l.id);
    expect(validarFinalizacion(db, C26, calle, { par: true, impar: true, resultado: 'completada-sin-locales' }).ok).toBe(false);
    db = finalizarCalle(db, ctx(), calle, { par: true, impar: true, resultado: 'completada-con-locales' });
    expect(coberturaCalle(db, C26, calle).estado).toBe('completada-con-locales');
    expect(validarFinalizacion(base, C26, calle, { par: true, impar: false, resultado: 'parcial-incidencias' }).ok).toBe(true);
  });

  it('una calle sin locales anteriores puede cerrarse como «sin locales»', () => {
    const ampl = base.campanas[C26].ampliacionCalleIds.find((id) => !Object.values(base.observaciones).some((o) => o.campanaId === C26 && o.calleId === id))!;
    const db = finalizarCalle(base, ctx(), ampl, { par: true, impar: true, resultado: 'completada-sin-locales' });
    expect(coberturaCalle(db, C26, ampl).estado).toBe('completada-sin-locales');
  });

  it('sin conexión, las altas quedan en la cola de sincronización', () => {
    const calle = callePendienteConLocales(base);
    const { db } = registrarLocalNuevo(base, ctx({ sinConexion: true }), { calleId: calle, numero: 301, vacio: true, metrosFachada: 5 });
    expect(db.colaSync.length).toBe(base.colaSync.length + 1);
  });
});

describe('conciliación histórica', () => {
  it('un alta con el mismo número propone candidatos y solo se vincula por decisión humana', () => {
    const calle = callePendienteConLocales(base);
    const previo = localesPrevios(base, 'camp-medina-2025', calle)[1];
    const num = previo.direcciones[0].numero;
    const r = registrarLocalNuevo(base, ctx(), { calleId: calle, numero: num, vacio: false, nombre: 'Negocio Distinto' });
    expect(r.candidatos).toBeGreaterThan(0);
    const v = Object.values(r.db.vinculos).find((x) => x.localId === r.localId)!;
    expect(v.confianza).toBe('dudosa');
    const db = resolverVinculo(r.db, v.id, { tipo: 'mismo-local', localAnteriorId: previo.id }, 'p-marta');
    expect(db.locales[r.localId]).toBeUndefined();
    expect(db.vinculos[v.id].confianza).toBe('confirmada');
    expect(Object.values(db.observaciones).filter((o) => o.localId === previo.id).length).toBe(2);
    const ind = resolverVinculo(r.db, v.id, { tipo: 'indeterminado' }, 'p-marta');
    expect(ind.vinculos[v.id].confianza).toBe('sin-vinculo');
  });
});

describe('estadísticas', () => {
  it('separa ámbito comparable y ampliación; lo no observado es indeterminado, no cierre', () => {
    const c = compararCampanas(base, 'camp-vll-2024', 'camp-vll-2025');
    expect(c.ampliacion.length).toBe(40);
    expect(c.posteriorAmpliacion.locales).toBeGreaterThan(0);
    expect(c.indeterminados.noObservados).toBeGreaterThan(0);
    expect(c.cierres).toBeGreaterThan(0);
    expect(c.anterior.locales).toBeLessThan(c.posteriorComparable.locales + c.posteriorAmpliacion.locales);
  });

  it('en una campaña en curso los locales no visitados no cuentan como cierres', () => {
    const c = compararCampanas(base, 'camp-medina-2025', C26);
    expect(c.indeterminados.noObservados).toBeGreaterThan(c.cierres);
  });
});

describe('importaciones', () => {
  it('lee CSV con «;», comillas y la calle solo en la primera fila del bloque', () => {
    const calles = Object.values(base.calles).filter((c) => c.municipioId === MEDINA.id);
    const csv = `﻿Calle;Número;Nombre;Estado;Metros fachada\n${calles[0].nombre};2;"Bar ""El Arco""";Ocupado;\n;4;;Vacío;6\nCalle Inexistente;1;X;Ocupado;`;
    const p = parsearCSV(csv);
    expect(p.separador).toBe(';');
    const mapa = mapearCabecera(p.cabecera);
    const filas = interpretarFilas(p.cabecera, p.filas, mapa, calles);
    expect(filas[0].nombre).toBe('Bar "El Arco"');
    expect(filas[1].calleId).toBe(calles[0].id);
    expect(filas[1].vacio).toBe(true);
    expect(filas[1].metros).toBe(6);
    expect(filas[2].calleId).toBeUndefined();
  });

  it('un Excel de itinerario no modifica calles ajenas al itinerario', () => {
    const its = itinerariosDe(base, C26);
    const propia = its[1].tramos[0].calleId;
    const ajena = its[0].tramos[0].calleId;
    const filas = interpretarFilas(['Calle', 'Número', 'Nombre'], [[base.calles[propia].nombre, '999', 'Nuevo'], [base.calles[ajena].nombre, '998', 'Otro']], { calle: 0, numero: 1, nombre: 2 }, Object.values(base.calles));
    const diff = compararImportacion(base, C26, filas, new Set(its[1].tramos.map((t) => t.calleId)));
    expect(diff[0].clase).toBe('nuevo');
    expect(diff[1].clase).toBe('fuera-ambito');
  });

  it('casa trazos KML por nombre y por geometría', () => {
    const [a, b] = Object.values(base.calles).filter((c) => c.municipioId === MEDINA.id && c.segmentos.length);
    const coords = (c: Calle) => c.segmentos.flatMap((s) => s.coords).map((p) => `${p[0]},${p[1]},0`).join(' ');
    const kml = `<kml><Document><Placemark><name>${a.nombre}</name><LineString><coordinates>${coords(a)}</coordinates></LineString></Placemark><Placemark><name>Tramo 2</name><LineString><coordinates>${coords(b)}</coordinates></LineString></Placemark></Document></kml>`;
    const res = casarTrazosKML(parsearKML(kml), Object.values(base.calles), distanciaPuntoLinea);
    expect(res[0].metodo).toBe('nombre');
    expect(res[1].metodo).toBe('geometria');
    expect(res[1].calleIds).toContain(b.id);
  });

  it('agrupa las vías de OSM por nombre: una calle con varios segmentos', () => {
    const json = { elements: [
      { type: 'way' as const, id: 1, tags: { name: 'Calle de Padilla', highway: 'residential' }, geometry: [{ lat: 41.31, lon: -4.91 }, { lat: 41.311, lon: -4.91 }] },
      { type: 'way' as const, id: 2, tags: { name: 'Calle de Padilla', highway: 'residential' }, geometry: [{ lat: 41.311, lon: -4.91 }, { lat: 41.312, lon: -4.91 }] },
      { type: 'way' as const, id: 3, tags: { name: 'Plaza Mayor', highway: 'pedestrian' }, geometry: [{ lat: 41.31, lon: -4.912 }, { lat: 41.3105, lon: -4.912 }] },
    ] };
    const calles = callesDesdeOverpass(json, 'm');
    expect(calles).toHaveLength(2);
    expect(calles.find((c) => c.nombre === 'Calle de Padilla')!.segmentos).toHaveLength(2);
    expect(calles.every((c) => c.procedencia === 'osm')).toBe(true);
  });
});

describe('oficina y exportación', () => {
  it('no aprueba sin categorización y presencia digital revisadas', () => {
    const ix = { obs: indiceObservaciones(base), ocu: indiceOcupaciones(base) };
    const filas = filasOficina(base, C26, ix).filter((f) => !f.vacio).slice(0, 5);
    const r = aprobar(base, C26, filas);
    expect(r.aprobados).toBe(0);
    expect(r.omitidos.length).toBe(filas.length);
  });

  it('copiar la medición digital de 2025 crea un borrador sin verificar', () => {
    const m = Object.values(base.metricas).find((x) => x.campanaId === 'camp-medina-2025')!;
    const db = partirDeAnterior(base, m.negocioId, C26, m);
    const nueva = db.metricas[kMet(m.negocioId, C26)];
    expect(nueva.verificada).toBe(false);
    expect(nueva.fechaComprobacion).toBeUndefined();
    expect(nueva.instagram).toBe(m.instagram);
  });

  it('el CSV es compatible con Excel en español', () => {
    const csv = aCSV([{ Calle: 'Real', Nombre: 'Bar "Uno"; dos' }], ['Calle', 'Nombre']);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"Bar ""Uno""; dos"');
  });
});
