import { describe, expect, it } from 'vitest';
import { C26_SINT, escenarioOficina } from '../data/escenarioOficina';
import { kNC, type BaseDatos } from './db';
import { DEF_VARIABLE, VARIABLES_ADICIONALES, esExigible, numeroRedes, problemasDigitales, registrarDatoDigital, verificarDigital } from './digital';
import { codificarRespuesta } from './respuesta';
import { parseNumeroDigital } from '../workspaces/office/tabla/columnas';
import type { Id, Respuesta, RevisionDigital, VariableDigital } from './types';

/** Negocio vigente en 2026 dentro del escenario sintético. */
function preparar(): { db: BaseDatos; neg: Id } {
  const esc = escenarioOficina({ calles: 4, localesPorCalle: 6 });
  const rev = Object.values(esc.db.revisiones).find((r) => r.campanaId === C26_SINT && esc.db.ocupaciones[`ocu-${r.localId}`]?.negocioId)!;
  return { db: esc.db, neg: esc.db.ocupaciones[`ocu-${rev.localId}`].negocioId! };
}
const reg = (db: BaseDatos, neg: Id, v: VariableDigital, r: Respuesta, valor?: number) => registrarDatoDigital(db, neg, C26_SINT, v, { respuesta: r, valor }, 'p-marta');
const rev = (db: BaseDatos, neg: Id) => db.digital[kNC(neg, C26_SINT)];
/** Todo lo obligatorio contestado con «No» (sin presencia): punto de partida verificable. */
function base(db: BaseDatos, neg: Id) {
  for (const v of ['web', 'ventaOnline', 'googleBusiness', 'instagram', 'facebook', 'twitter'] as VariableDigital[]) db = reg(db, neg, v, 'no');
  return db;
}
const variables = (r: RevisionDigital) => problemasDigitales(r).map((p) => p.variable);

describe('Procedimiento 2026 · Twitter / X', () => {
  it('es obligatorio comprobarlo: pendiente bloquea la verificación', () => {
    const { db: d0, neg } = preparar();
    let db = d0;
    for (const v of ['web', 'ventaOnline', 'googleBusiness', 'instagram', 'facebook'] as VariableDigital[]) db = reg(db, neg, v, 'no');
    expect(variables(rev(db, neg))).toEqual(['twitter']);
    expect(() => verificarDigital(db, neg, C26_SINT, 'p-marta')).toThrow(/No se puede verificar/);
  });

  it('hay que registrar Sí o No: «sin información» no permite verificar', () => {
    const { db: d0, neg } = preparar();
    const db = reg(base(d0, neg), neg, 'twitter', 'sin-info');
    expect(problemasDigitales(rev(db, neg))).toEqual([expect.objectContaining({ variable: 'twitter', mensaje: 'Twitter / X: hay que registrar Sí o No' })]);
    expect(() => verificarDigital(db, neg, C26_SINT, 'p-marta')).toThrow();
    expect(verificarDigital(reg(db, neg, 'twitter', 'no'), neg, C26_SINT, 'p-marta').digital[kNC(neg, C26_SINT)].estado).toBe('verificada');
  });

  it('si existe se piden los seguidores; si no pueden obtenerse se admite «sin información» sin inventar un cero', () => {
    const { db: d0, neg } = preparar();
    let db = reg(base(d0, neg), neg, 'twitter', 'si');
    expect(esExigible(rev(db, neg), 'seguidoresTwitter')).toBe(true);
    expect(variables(rev(db, neg))).toEqual(['seguidoresTwitter']);
    db = reg(db, neg, 'seguidoresTwitter', 'sin-info');
    expect(rev(db, neg).datos.seguidoresTwitter).toMatchObject({ respuesta: 'sin-info' });
    expect(rev(db, neg).datos.seguidoresTwitter?.valor).toBeUndefined();
    expect(codificarRespuesta(rev(db, neg).datos.seguidoresTwitter?.respuesta, { si: 1, no: 0 })).toBeNull();
    expect(verificarDigital(db, neg, C26_SINT, 'p-marta').digital[kNC(neg, C26_SINT)].estado).toBe('verificada');
    // Lo vacío nunca se convierte en 0
    expect(parseNumeroDigital('')).toEqual({ respuesta: 'pendiente' });
    expect(parseNumeroDigital('?')).toEqual({ respuesta: 'sin-info' });
    expect(parseNumeroDigital('0')).toEqual({ respuesta: 'si', valor: 0 });
  });

  it('sin Twitter / X no se piden seguidores', () => {
    const { db: d0, neg } = preparar();
    const db = base(d0, neg);
    expect(esExigible(rev(db, neg), 'seguidoresTwitter')).toBe(false);
  });
});

describe('Procedimiento 2026 · Facebook (mismo criterio condicional)', () => {
  it('Sí o No obligatorio; si existe, seguidores (o «sin información»)', () => {
    const { db: d0, neg } = preparar();
    let db = reg(base(d0, neg), neg, 'facebook', 'sin-info');
    expect(problemasDigitales(rev(db, neg)).map((p) => p.mensaje)).toEqual(['Facebook: hay que registrar Sí o No']);
    db = reg(db, neg, 'facebook', 'si');
    expect(variables(rev(db, neg))).toEqual(['seguidoresFacebook']);
    db = reg(db, neg, 'seguidoresFacebook', 'si', 1250);
    expect(problemasDigitales(rev(db, neg))).toEqual([]);
    db = reg(db, neg, 'seguidoresFacebook', 'sin-info');
    expect(problemasDigitales(rev(db, neg))).toEqual([]);
    expect(DEF_VARIABLE.facebook.exigeSiNo && DEF_VARIABLE.twitter.exigeSiNo).toBe(true);
  });
});

describe('Campos adicionales opcionales', () => {
  it('la valoración media de Google no es obligatoria para verificar', () => {
    const { db: d0, neg } = preparar();
    let db = reg(base(d0, neg), neg, 'googleBusiness', 'si');
    db = reg(db, neg, 'numResenas', 'si', 12);
    db = reg(db, neg, 'respondeResenas', 'no');
    expect(esExigible(rev(db, neg), 'valoracion')).toBe(false);
    expect(rev(db, neg).datos.valoracion).toBeUndefined();
    expect(verificarDigital(db, neg, C26_SINT, 'p-marta').digital[kNC(neg, C26_SINT)].estado).toBe('verificada');
  });

  it('«Otras redes» pendiente no bloquea la verificación', () => {
    const { db: d0, neg } = preparar();
    const db = base(d0, neg);
    expect(rev(db, neg).datos.otrasRedes).toBeUndefined();
    expect(() => verificarDigital(db, neg, C26_SINT, 'p-marta')).not.toThrow();
  });

  it('los adicionales son exactamente valoración media y otras redes', () => {
    expect(VARIABLES_ADICIONALES.sort()).toEqual(['otrasRedes', 'valoracion']);
    expect(VARIABLES_ADICIONALES.every((v) => !DEF_VARIABLE[v].obligatoria)).toBe(true);
  });
});

describe('Nº de redes = Instagram + Facebook + Twitter / X', () => {
  const r = (datos: Partial<Record<VariableDigital, Respuesta>>): RevisionDigital => ({
    negocioId: 'n', campanaId: 'c', estado: 'borrador', historial: [],
    datos: Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, { respuesta: v, origen: 'manual' }])),
  });

  it('suma solo las tres redes contestadas con Sí o No', () => {
    expect(numeroRedes(r({ instagram: 'si', facebook: 'no', twitter: 'si' }))).toBe(2);
    expect(numeroRedes(r({ instagram: 'no', facebook: 'no', twitter: 'no' }))).toBe(0);
    // «Otras redes» no cuenta
    expect(numeroRedes(r({ instagram: 'si', facebook: 'si', twitter: 'si', otrasRedes: 'si' }))).toBe(3);
  });

  it('no da un total definitivo si alguna está pendiente o es desconocida («sin información» no es «No»)', () => {
    expect(numeroRedes(r({ instagram: 'si', facebook: 'no' }))).toBeNull();
    expect(numeroRedes(r({ instagram: 'si', facebook: 'no', twitter: 'pendiente' }))).toBeNull();
    expect(numeroRedes(r({ instagram: 'si', facebook: 'sin-info', twitter: 'no' }))).toBeNull();
    expect(numeroRedes(r({ instagram: 'na', facebook: 'no', twitter: 'no' }))).toBeNull();
    expect(numeroRedes(undefined)).toBeNull();
  });
});
