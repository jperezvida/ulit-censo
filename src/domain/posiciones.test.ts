// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { generarDemo } from '../data/semilla';
import { callejeroSimulado, MEDINA } from '../data/callejero';
import { MUNICIPIO_DEMO, prepararMunicipioDemo } from '../data/escenarioIncorporacion';
import { aplicarEscenario, prepararEscenario } from './incorporacionDemo';
import { datosCampana } from './panel';
import { clavePortal, desplazamientoGrupo, posicionesEstablecimientos } from './posiciones';
import { distanciaPuntoLinea } from './geo';
import type { BaseDatos } from './db';

/** Datos FICTICIOS: la demostración (Medina, callejero simulado) y el escenario C1d sin geometría. */
let demo: BaseDatos;
let conEscenario: BaseDatos;
let campanaEsc: string;

beforeAll(async () => {
  demo = prepararMunicipioDemo(generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'pos' }));
  const p = await prepararEscenario(demo, 'medina-2025-ficticio', 2025, {});
  const r = await aplicarEscenario(demo, 'medina-2025-ficticio', 2025, p.resultado, {}, p.plan, 'p-elena');
  conEscenario = r.db;
  campanaEsc = r.campanaId;
});

const pos = (db: BaseDatos, campanaId: string) => {
  const d = datosCampana(db, campanaId);
  return { d, r: posicionesEstablecimientos(db, d.municipio, d.unidades) };
};

describe('Mapa por establecimientos · posiciones', () => {
  it('datos ficticios con geometría: un punto simulado por local físico, sobre su calle, reproducible y sin guardarse', () => {
    const copia = JSON.stringify(demo.locales);
    const { d, r } = pos(demo, 'camp-medina-2025');
    const locales = d.unidades.filter((u) => u.localId).length;
    expect(r.porTipo).toEqual({ verificada: 0, aproximada: 0, simulada: locales });
    expect(r.posiciones).toHaveLength(locales);
    expect(new Set(r.posiciones.map((p) => p.localId)).size).toBe(locales);
    // Cada punto queda junto a SU calle (a la distancia de la acera), nunca en otro sitio.
    for (const p of r.posiciones.slice(0, 80)) {
      const calle = demo.calles[p.calleId];
      const dist = Math.min(...calle.segmentos.filter((s) => s.coords.length > 1).map((s) => distanciaPuntoLinea(p.coord, s.coords)));
      expect(dist).toBeLessThan(9);
    }
    // Reproducible: mismo resultado en un segundo cálculo
    expect(pos(demo, 'camp-medina-2025').r.posiciones).toEqual(r.posiciones);
    // No se escribe nada en los locales: ni coordenadas ni verificación
    expect(JSON.stringify(demo.locales)).toBe(copia);
    expect(Object.values(demo.locales).some((l) => l.coordVerificada)).toBe(false);
  });

  it('nunca usa las coordenadas interpoladas de un dato ficticio como reales ni las «confirma»', () => {
    const { d, r } = pos(demo, 'camp-medina-2025');
    const u = d.unidades.find((x) => x.localId && demo.locales[x.localId].coord)!;
    const p = r.posiciones.find((x) => x.localId === u.localId)!;
    expect(p.tipo).toBe('simulada');
    expect(u.coord).toBeUndefined();
  });

  it('las coordenadas verificadas prevalecen; los datos reales sin verificar quedan como aproximados', () => {
    const ids = datosCampana(demo, 'camp-medina-2025').unidades.filter((u) => u.localId && demo.locales[u.localId].coord).map((u) => u.localId!);
    const [v, a] = [ids[0], ids[1]];
    const locales = { ...demo.locales };
    locales[v] = { ...locales[v], coordVerificada: { fuente: 'gps-campo', fecha: '2026-09-10' } };
    // Un local «real» (importado), con posición sin verificar
    locales[a] = { ...locales[a], procedencia: 'importado' };
    const db: BaseDatos = { ...demo, locales };
    const d = datosCampana(db, 'camp-medina-2025');
    // El local importado solo es «real» si su unidad lo es: se fuerza también en la unidad
    const unidades = d.unidades.map((u) => (u.localId === a ? { ...u, procedencia: 'importado' as const } : u));
    const r = posicionesEstablecimientos(db, d.municipio, unidades);
    const pv = r.posiciones.find((p) => p.localId === v)!;
    const pa = r.posiciones.find((p) => p.localId === a)!;
    expect(pv.tipo).toBe('verificada');
    expect(pv.coord).toEqual(db.locales[v].coord);
    expect(pa.tipo).toBe('aproximada');
    expect(pa.coord).toEqual(db.locales[a].coord);
    expect(db.locales[a].coordVerificada).toBeUndefined();
    expect(r.porTipo).toMatchObject({ verificada: 1, aproximada: 1 });
  });

  it('varios locales en el mismo portal: puntos independientes, misma posición base y expansión al dibujar', () => {
    const { d, r } = pos(demo, 'camp-medina-2025');
    // Se fuerza un portal compartido: tres locales de la misma calle con el mismo número
    const calleId = r.posiciones[0].calleId;
    const tres = d.unidades.filter((u) => u.localId && u.calleId === calleId).slice(0, 3);
    expect(tres).toHaveLength(3);
    const unidades = d.unidades.map((u) => (tres.includes(u) ? { ...u, numero: 7, sufijo: undefined } : u));
    const r2 = posicionesEstablecimientos(demo, d.municipio, unidades);
    const ps = r2.posiciones.filter((p) => tres.some((t) => t.localId === p.localId));
    expect(ps).toHaveLength(3);
    expect(new Set(ps.map((p) => p.localId)).size).toBe(3);
    expect(new Set(ps.map((p) => p.portal))).toEqual(new Set([clavePortal({ ...tres[0], numero: 7, sufijo: undefined })]));
    expect(new Set(ps.map((p) => p.coord.join(','))).size).toBe(1);
    expect(ps.every((p) => p.enGrupo === 3)).toBe(true);
    expect(ps.map((p) => p.indiceEnGrupo).sort()).toEqual([0, 1, 2]);
    expect(r2.enPortalCompartido).toBeGreaterThanOrEqual(3);
    expect(r2.posiciones).toHaveLength(r.posiciones.length);
    // La expansión separa los puntos en pantalla
    const offs = [0, 1, 2].map((i) => desplazamientoGrupo(3, i).map((x) => x.toFixed(2)).join(','));
    expect(new Set(offs).size).toBe(3);
    expect(desplazamientoGrupo(1, 0)).toEqual([0, 0]);
  });

  it('sin geometría (escenario C1d) no se simula nada; las observaciones sin local no son puntos', () => {
    const { d, r } = pos(conEscenario, campanaEsc);
    expect(d.municipio.id).toBe(MUNICIPIO_DEMO.id);
    expect(r.posiciones).toHaveLength(0);
    expect(r.sinPosicion).toBe(d.unidades.filter((u) => u.localId).length);
    expect(r.sinLocal).toBe(d.unidades.filter((u) => !u.localId).length);
    expect(r.sinLocal).toBeGreaterThan(0);
  });
});
