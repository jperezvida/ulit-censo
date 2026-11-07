// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generarDemo } from '../data/semilla';
import { callejeroSimulado, MEDINA } from '../data/callejero';
import { libroFicticio } from '../data/xlsxFicticio';
import { ANOMALIAS_ESCENARIO, libroEscenarioMedina, MUNICIPIO_DEMO, prepararMunicipioDemo, reiniciarEscenarioDemo } from '../data/escenarioIncorporacion';
import {
  agruparRevision, aplicarEscenario, filtrarRevision, itemsRevision, pendientesDeNodo, prepararEscenario, previsualizarDeshacer, reglasPropuestas, textosDiccionario,
} from './incorporacionDemo';
import { prepararIncorporacion } from './incorporacionXlsx';
import { deshacerIncorporacion, type DecisionesIncorporacion } from './incorporacion';
import { informeInterpretacion } from './xlsx/informeInterpretacion';
import { filasOficina } from './oficina';
import { indiceObservaciones, indiceOcupaciones } from './consultas';
import { TAXONOMIA } from './taxonomy';
import { ID_CATALOGO_2026 } from './catalogo2026';
import type { BaseDatos } from './db';

/** Escenario FICTICIO generado por la aplicación: ningún dato real. */
const ESC = 'medina-2025-ficticio';
let demo: BaseDatos;
let base: BaseDatos;
const F = { porId: 'p-elena', fecha: '2026-10-21' };

beforeAll(() => {
  demo = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'c1d' });
  base = prepararMunicipioDemo(demo);
});

const vista2026 = (db: BaseDatos) => {
  const ix = { obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) };
  const deMedina = <T extends { municipioId: string }>(r: Record<string, T>) => Object.values(r).filter((x) => x.municipioId === 'mun-medina');
  return JSON.stringify([db.campanas['camp-medina-2026'], filasOficina(db, 'camp-medina-2026', ix), filasOficina(db, 'camp-medina-2025', ix), deMedina(db.calles), deMedina(db.locales)]);
};

describe('C1d · Escenario ficticio aislado y reproducible', () => {
  it('el libro del escenario es determinista (mismo SHA-256 en cada generación)', async () => {
    const a = await libroEscenarioMedina();
    const b = await libroEscenarioMedina();
    expect(createHash('sha256').update(a).digest('hex')).toBe(createHash('sha256').update(b).digest('hex'));
  });

  it('resultados esperados de C1b y C1c para el escenario (documentados)', async () => {
    const { resultado, plan } = await prepararEscenario(base, ESC, 2025, {});
    const inf = informeInterpretacion(resultado);
    expect(inf.filas.registros).toBe(890); // 889 registros + 1 posible fila de totales, que se conserva
    expect(inf.filas.locales).toEqual({ vacio: 246, ocupado: 641, desconocido: 3 });
    expect(inf.celdas.total).toBe(24030);
    expect(inf.incidencias.total).toBe(298);
    expect(inf.incidencias.porGravedad).toEqual({ error: 15, aviso: 145, info: 138 });
    expect(plan.registros.candidatasExcluir).toEqual([{ fila: 891, decidida: false }]);
    // C1c-1: las 4 filas de los 2 portales repetidos son locales distintos (antes: 842 inequívocas y 16 ambiguas)
    expect(plan.correspondencias).toMatchObject({ inequivoca: 846, ambigua: 12, 'sin-vinculo': 32, decidida: 0, excluida: 0 });
    expect(plan.correspondencias.porMotivo).toEqual({ 'sin-numero': 6, 'local-existente-en-direccion': 4, 'numero-desconocido': 4, 'estado-local-desconocido': 2, 'calle-sin-correspondencia': 28 });
    expect(plan.mismoPortal).toEqual({ portales: 2, locales: 4 });
    expect(plan.nuevas).toMatchObject({ registros: 890, locales: 846, negocios: 620, observaciones: 860, ocupaciones: 845, clasificaciones: 0 });
    // Las anomalías deliberadas aparecen donde se documentan
    const tipoEn = (fila: number) => resultado.incidencias.filter((i) => i.fila === fila).map((i) => i.tipo);
    expect(tipoEn(ANOMALIAS_ESCENARIO.web4)).toContain('binario-invalido');
    expect(tipoEn(ANOMALIAS_ESCENARIO.fechaPendiente)).toContain('fecha-no-reconocida');
    expect(tipoEn(ANOMALIAS_ESCENARIO.numRedes380)).toContain('redes-discrepa');
    expect(tipoEn(ANOMALIAS_ESCENARIO.vacioConNombre)).toContain('vacio-con-datos-negocio');
  });

  it('preparar el escenario no toca nada ajeno y reiniciarlo deja la base exactamente como estaba', async () => {
    for (const k of ['campanas', 'locales', 'negocios', 'observaciones', 'ocupaciones', 'registros', 'importaciones'] as const) {
      for (const [id, x] of Object.entries(demo[k])) expect(base[k][id]).toBe(x);
    }
    const { resultado, plan } = await prepararEscenario(base, ESC, 2025, {});
    const r = await aplicarEscenario(base, ESC, 2025, resultado, {}, plan, 'p-elena');
    expect(vista2026(r.db)).toBe(vista2026(demo));
    const limpio = reiniciarEscenarioDemo(r.db);
    const { secuencia: _a, ...x } = limpio;
    const { secuencia: _b, ...y } = demo;
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
  });

  it('el reinicio se niega si algo de otro municipio depende del escenario', async () => {
    const { resultado, plan } = await prepararEscenario(base, ESC, 2025, {});
    const r = await aplicarEscenario(base, ESC, 2025, resultado, {}, plan, 'p-elena');
    const loc = Object.keys(r.db.locales).find((k) => r.db.locales[k].municipioId === MUNICIPIO_DEMO.id)!;
    const ajeno: BaseDatos = { ...r.db, vinculos: { ...r.db.vinculos, 'vin-ajeno': { id: 'vin-ajeno', origen: { tipo: 'observacion', id: 'obs-x' }, localId: null, confianza: 'dudosa', criterio: 'x', candidatos: [{ localId: loc, puntuacion: 0.5, motivo: 'x' }] } } };
    expect(() => reiniciarEscenarioDemo(ajeno)).toThrow(/dependen de él/);
  });
});

describe('C1d · Límite técnico: solo escenarios generados por la aplicación', () => {
  it('rechaza un plan de cualquier otro archivo, aunque vaya al municipio ficticio', async () => {
    const otro = await libroFicticio({ filas: 30 });
    const p = await prepararIncorporacion(base, otro, 'escenario-ficticio.xlsx', { municipioId: MUNICIPIO_DEMO.id, anio: 2025 });
    await expect(aplicarEscenario(base, ESC, 2025, p.resultado, {}, p.plan, 'p-elena')).rejects.toThrow(/Solo se pueden incorporar los escenarios ficticios generados por la aplicación/);
  });

  it('rechaza un plan manipulado (otro SHA-256) y un escenario desconocido', async () => {
    const { resultado, plan } = await prepararEscenario(base, ESC, 2025, {});
    await expect(aplicarEscenario(base, ESC, 2025, resultado, {}, { ...plan, archivo: { ...plan.archivo, sha256: '0'.repeat(64) } }, 'p-elena')).rejects.toThrow(/no coincide/);
    await expect(aplicarEscenario(base, 'censo-real', 2025, resultado, {}, plan, 'p-elena')).rejects.toThrow(/Solo se pueden incorporar/);
  });

  it('sin el municipio ficticio preparado no se puede ni analizar', async () => {
    await expect(prepararEscenario(demo, ESC, 2025, {})).rejects.toThrow(/preparar el municipio ficticio/);
  });
});

describe('C1d · Revisión por grupos y decisiones', () => {
  it('estados de revisión: Cátedra, revisar, no aplicable, resuelto y bloqueante', async () => {
    const { resultado, plan } = await prepararEscenario(base, ESC, 2025, {});
    const items = itemsRevision(resultado, plan, {});
    const de = (pred: (i: (typeof items)[number]) => boolean) => items.find(pred)!;
    expect(de((i) => i.grupo === 'fachada-con-unidad').estado).toBe('catedra');
    expect(de((i) => i.grupo === 'binario-invalido').estado).toBe('revisar');
    expect(de((i) => i.grupo === 'clasificacion-fuera-de-lista').estado).toBe('no-aplica');
    // C1c-1: el mismo portal ya no es una correspondencia pendiente; la incidencia de C1b es informativa
    expect(items.some((i) => i.grupo === 'correspondencia:direccion-repetida-en-archivo')).toBe(false);
    expect(de((i) => i.grupo === 'direccion-repetida').estado).toBe('no-aplica');
    const sn = ANOMALIAS_ESCENARIO.sn[0];
    const dec: DecisionesIncorporacion = { correspondencias: [{ fila: sn, accion: 'local-nuevo', ...F, motivo: 'Comprobado' }], exclusiones: [{ fila: 891, ...F, motivo: 'Totales' }] };
    const items2 = itemsRevision(resultado, plan, dec);
    expect(items2.find((i) => i.clave === `cor-${sn}`)!.estado).toBe('resuelto');
    expect(items2.filter((i) => i.fila === 891).every((i) => i.estado === 'no-aplica')).toBe(true);
    // Un plan bloqueado aparece como bloqueante
    const r = await aplicarEscenario(base, ESC, 2025, resultado, {}, plan, 'p-elena');
    const again = await prepararEscenario(r.db, ESC, 2025, {});
    expect(itemsRevision(again.resultado, again.plan, {}).find((i) => i.estado === 'bloqueante')?.mensaje).toMatch(/ya se incorporó/);
  });

  it('filtros por gravedad, estado, grupo y búsqueda por calle, número, negocio y fila; grupos ordenados por gravedad', async () => {
    const { resultado, plan } = await prepararEscenario(base, ESC, 2025, {});
    const items = itemsRevision(resultado, plan, {});
    expect(filtrarRevision(items, { gravedades: ['error'] }).every((i) => i.gravedad === 'error')).toBe(true);
    expect(filtrarRevision(items, { texto: String(ANOMALIAS_ESCENARIO.numRedes380) }).map((i) => i.grupo)).toContain('redes-discrepa');
    expect(filtrarRevision(items, { texto: 'vía ficticia 091' }).every((i) => i.calle?.includes('091'))).toBe(true);
    expect(filtrarRevision(items, { texto: 'comercio ficticio anterior' })[0].fila).toBe(ANOMALIAS_ESCENARIO.vacioConNombre);
    expect(filtrarRevision(items, { estados: ['catedra'] }).every((i) => i.estado === 'catedra')).toBe(true);
    const grupos = agruparRevision(items);
    expect(grupos[0].gravedad).toBe('error');
    expect(grupos.reduce((a, g) => a + g.total, 0)).toBe(items.length);
    // Cada fila muestra original, interpretación y regla
    const fachada = items.find((i) => i.grupo === 'fachada-con-unidad')!;
    expect(fachada).toMatchObject({ original: '«3,5 m»', regla: 'fachada-con-unidad' });
    expect(fachada.interpretacion).toMatch(/pendiente · propuesta: 3.5/);
  });

  it('autorizar una regla nunca autoriza otra distinta', async () => {
    const dec: DecisionesIncorporacion = { reglasAutorizadas: [{ regla: 'fachada-con-unidad', ...F, motivo: 'Acuerdo ficticio' }] };
    const { resultado } = await prepararEscenario(base, ESC, 2025, dec);
    const reglas = reglasPropuestas(resultado);
    expect(reglas.find((r) => r.regla === 'fachada-con-unidad')!.celdas.every((c) => c.estado === 'transformado')).toBe(true);
    // El diccionario y cada texto siguen pendientes, por separado
    const textos = textosDiccionario(resultado);
    expect(textos.map((t) => t.texto).sort()).toEqual(['s/i', 'sin dato']);
    const d2: DecisionesIncorporacion = { ...dec, diccionarioAprobado: [{ texto: 'sin dato', ...F, motivo: 'Acuerdo ficticio' }] };
    const r2 = await prepararEscenario(base, ESC, 2025, d2);
    const fila = (n: number) => r2.resultado.filas.find((f) => f.fila === n)!;
    expect(fila(ANOMALIAS_ESCENARIO.sinDato).celdas.seguidoresInstagram.estado).toBe('vacio');
    expect(fila(ANOMALIAS_ESCENARIO.sI).celdas.seguidoresFacebook.estado).toBe('pendiente');
  });

  it('equivalencias: los nodos afectados por D01–D14 o por excepciones ICM quedan pendientes de la Cátedra', () => {
    const nodo = (nombre: string, padre?: string) => TAXONOMIA.find((n) => n.catalogo === ID_CATALOGO_2026 && n.nombre === nombre && (!padre || TAXONOMIA.find((p) => p.id === n.padreId)?.nombre === padre))!.id;
    expect(pendientesDeNodo(nodo('Panadería'))).toEqual([]);
    expect(pendientesDeNodo(nodo('Peluquerías')).join()).toMatch(/D11/);
    expect(pendientesDeNodo(nodo('Grandes Almacenes')).join()).toMatch(/D02/);
    expect(pendientesDeNodo(nodo('Internacional')).join()).toMatch(/D03/);
    expect(pendientesDeNodo(nodo('Estancos', 'Estancos')).join()).toMatch(/D01|ICM/);
  });
});

describe('C1d · Deshacer desde la interfaz: vista previa y protección', () => {
  it('muestra qué se eliminará y qué se conserva, y bloquea con cambios posteriores o campaña validada', async () => {
    const { resultado, plan } = await prepararEscenario(base, ESC, 2025, {});
    const r = await aplicarEscenario(base, ESC, 2025, resultado, {}, plan, 'p-elena');
    const v = previsualizarDeshacer(r.db, r.importacionId, 'p-elena');
    expect(v.permitido).toBe(true);
    expect(v.eliminara).toMatchObject({ registros: 890, locales: 846, campanas: 1 });
    expect(v.conservara.join()).toMatch(/marcado como «deshecha»/);
    expect(JSON.stringify(previsualizarDeshacer(r.db, r.importacionId, 'p-elena'))).toBe(JSON.stringify(v)); // ensayo sin efectos
    const neg = Object.keys(r.db.negocios).find((k) => k.includes(r.importacionId))!;
    const cambiado: BaseDatos = { ...r.db, negocios: { ...r.db.negocios, [neg]: { ...r.db.negocios[neg], nombre: 'Corregido' } } };
    const b = previsualizarDeshacer(cambiado, r.importacionId, 'p-elena');
    expect(b.permitido).toBe(false);
    expect(b.conflictos.join('\n')).toMatch(/se ha modificado después/);
    const validada: BaseDatos = { ...r.db, campanas: { ...r.db.campanas, [r.campanaId]: { ...r.db.campanas[r.campanaId], estados: { ...r.db.campanas[r.campanaId].estados, validacion: 'terminado' } } } };
    expect(previsualizarDeshacer(validada, r.importacionId, 'p-elena').conflictos[0]).toMatch(/revisada o validada/);
    const u = deshacerIncorporacion(r.db, r.importacionId, 'p-elena');
    expect(previsualizarDeshacer(u, r.importacionId, 'p-elena').conflictos).toEqual(['Esta incorporación ya se deshizo.']);
  });
});
