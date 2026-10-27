// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { verificarEspacio } from './espacios';
import { confirmarSinCambiosEnsayo, investigadoresDe } from './campoEnsayo';
import type { BaseDatos } from './db';

/** Campo en el ensayo · «Sin cambios» de un local del censo anterior (datos SINTÉTICOS). */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});
import { AHORA, escenarioSinCambios, INVESTIGADORA } from './escenarioCampoEnsayo';

const peticion = (e: Awaited<ReturnType<typeof escenarioSinCambios>>, extra: Partial<Parameters<typeof confirmarSinCambiosEnsayo>[1]> = {}) =>
  ({ campanaId: e.campanaId, itinerarioId: e.it, calleId: e.olmo.id, localId: e.local1.id, investigadorId: INVESTIGADORA, fecha: AHORA, ...extra });

describe('Campo en el ensayo · «Sin cambios»', () => {
  it('crea una observación NUEVA de la campaña actual a nombre de la investigadora y deja intacto el censo anterior', async () => {
    const e = await escenarioSinCambios();
    expect(investigadoresDe(e.db, e.it).map((p) => p.id)).toEqual([INVESTIGADORA]);
    const historico = Object.values(e.db.observaciones).filter((o) => o.campanaId === e.historica);
    const db = confirmarSinCambiosEnsayo(e.db, peticion(e));
    const nuevas = Object.values(db.observaciones).filter((o) => o.campanaId === e.campanaId);
    expect(nuevas).toEqual([expect.objectContaining({ localId: e.local1.id, calleId: e.olmo.id, tipo: 'confirmado', investigadorId: INVESTIGADORA, fecha: AHORA, fuente: 'campo-app', verificacion: 'pendiente', sync: 'sincronizada' })]);
    expect(nuevas[0].datos).toMatchObject({ numero: 1, nombre: 'BAR SINTÉTICO EL OLMO', vacio: false });
    expect(Object.values(db.observaciones).filter((o) => o.campanaId === e.historica)).toEqual(historico);
    expect(db.colaSync).toEqual(e.db.colaSync);
    // La ocupación del censo anterior se prolonga a 2026 (sigue el mismo negocio); no se crea ni se borra ninguna
    expect(Object.keys(db.ocupaciones)).toEqual(Object.keys(e.db.ocupaciones));
    const oc = Object.values(db.ocupaciones).find((x) => x.localId === e.local1.id)!;
    expect(oc).toEqual({ ...e.db.ocupaciones[oc.id], hastaCampanaId: e.campanaId });
    expect(verificarEspacio(db, 'ensayo')).toEqual([]);
    // No se repite sobre el mismo local
    expect(() => confirmarSinCambiosEnsayo(db, peticion(e))).toThrow(/ya tiene un registro/);
  });

  it('rechaza sin permisos: la coordinación no registra en nombre de nadie y la investigadora debe estar asignada', async () => {
    const e = await escenarioSinCambios();
    expect(() => confirmarSinCambiosEnsayo(e.db, peticion(e, { investigadorId: e.coordinadora }))).toThrow(/no es investigadora asignada/);
    const sinAsignar = { ...e.db, itinerarios: { ...e.db.itinerarios, [e.it]: { ...e.db.itinerarios[e.it], asignadosIds: [] } } };
    expect(() => confirmarSinCambiosEnsayo(sinAsignar, peticion(e))).toThrow(/no es investigadora asignada/);
  });

  it('rechaza itinerario incorrecto, local ajeno, local fuera de su acera y campaña no operativa', async () => {
    const e = await escenarioSinCambios();
    expect(() => confirmarSinCambiosEnsayo(e.db, peticion(e, { itinerarioId: e.otro }))).toThrow(/no está planificada/);
    expect(() => confirmarSinCambiosEnsayo(e.db, peticion(e, { localId: e.localReal.id }))).toThrow(/no existe en esta calle/);
    expect(() => confirmarSinCambiosEnsayo(e.db, peticion(e, { campanaId: e.historica }))).toThrow(/operativa/);
    // Olmo 3 es impar y está en el alcance; un local par (Olmo 2 no existe) se simula cambiando el tramo a pares
    const pares = { ...e.db, itinerarios: { ...e.db.itinerarios, [e.it]: { ...e.db.itinerarios[e.it], tramos: [{ calleId: e.olmo.id, acera: 'par' as const, orden: 1 }] } } };
    expect(() => confirmarSinCambiosEnsayo(pares, peticion(e))).toThrow(/no pertenecen a IT1/);
  });

  it('rechaza si el itinerario está bloqueado (revisión cerrada)', async () => {
    const e = await escenarioSinCambios();
    const db: BaseDatos = { ...e.db, oficinaItinerarios: { ...e.db.oficinaItinerarios, [e.it]: { itinerarioId: e.it, campanaId: e.campanaId, estado: 'revision-cerrada', historial: [] } } };
    expect(() => confirmarSinCambiosEnsayo(db, peticion(e))).toThrow(/cerrad|bloque/i);
  });
});
