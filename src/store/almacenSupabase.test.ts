import { describe, expect, it } from 'vitest';
import { baseVacia } from '../domain/db';
import { COLECCIONES, diferencia, ESCALARES, jsonCanonico, partir, reconstruir } from './almacenSupabase';
import { esClavePrivilegiada } from './clienteSupabase';

const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;

describe('AlmacenSupabase (funciones puras)', () => {
  it('separa colecciones y escalares de la base', () => {
    expect(COLECCIONES).toContain('observaciones');
    expect(COLECCIONES).not.toContain('meta');
    expect(ESCALARES).toEqual(expect.arrayContaining(['version', 'secuencia', 'meta', 'colaSync']));
  });
  it('envía solo lo que cambia (por referencia), incluidas las eliminaciones', () => {
    const a = { ...baseVacia(), meta: { espacio: 'ensayo' }, locales: { l1: { id: 'l1' }, l2: { id: 'l2' } } } as never;
    const b = { ...(a as object), locales: { l1: (a as { locales: Record<string, unknown> }).locales.l1, l3: { id: 'l3' } } } as never;
    expect(diferencia(a, b)).toEqual([{ c: 'locales', id: 'l3', v: { id: 'l3' } }, { c: 'locales', id: 'l2', v: null }]);
    expect(diferencia(a, a)).toEqual([]);
    expect(diferencia(null, a).map((x) => `${x.c}/${x.id}`)).toEqual(['_raiz/raiz', 'locales/l1', 'locales/l2']);
  });
  it('reconstruye la base desde las entidades del servidor', () => {
    const db = { ...baseVacia(), secuencia: 7, meta: { espacio: 'ensayo' }, locales: { l1: { id: 'l1' } } } as never;
    const ent: Record<string, Record<string, unknown>> = {};
    for (const x of diferencia(null, db)) (ent[x.c] ??= {})[x.id] = x.v;
    expect(jsonCanonico(reconstruir(ent))).toBe(jsonCanonico(db));
    expect(reconstruir({})).toBeNull();
  });
  it('parte los envíos grandes respetando los límites', () => {
    const cambios = Array.from({ length: 4500 }, (_, i) => ({ c: 'locales', id: `l${i}`, v: { id: `l${i}` } }));
    expect(partir(cambios).map((p) => p.length)).toEqual([2000, 2000, 500]);
    expect(partir([{ c: 'x', id: 'a', v: 'a'.repeat(900_000) }, { c: 'x', id: 'b', v: 'b'.repeat(900_000) }], { entidades: 99, bytes: 1_000_000 })).toHaveLength(2);
  });
  it('JSON canónico independiente del orden de claves', () => {
    expect(jsonCanonico({ b: 1, a: [{ d: 2, c: undefined }] })).toBe(jsonCanonico({ a: [{ d: 2 }], b: 1 }));
  });
  it('nunca acepta una clave privilegiada en el navegador', () => {
    expect(esClavePrivilegiada('sb_secret_abc')).toBe(true);
    expect(esClavePrivilegiada(jwt('service_role'))).toBe(true);
    expect(esClavePrivilegiada(jwt('anon'))).toBe(false);
    expect(esClavePrivilegiada('sb_publishable_abc')).toBe(false);
  });
});
