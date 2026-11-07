// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CSP, CABECERAS } from '../../scripts/vercel/cabeceras.mjs';
import { entornoDe, evaluarCsp, evaluarHuellas, evaluarProteccion, evaluarVersion, RAMA_REVISADA } from './garantias';

describe('Garantías de la vista previa (C1e-B en la web)', () => {
  it('reconoce el entorno: equipo propio, vista previa de Vercel u otro sitio', () => {
    expect(entornoDe('localhost')).toBe('local');
    expect(entornoDe('127.0.0.1')).toBe('local');
    expect(entornoDe('ulit-censo-pruebas-vista.vercel.app')).toBe('vista-previa');
    expect(entornoDe('ejemplo.com')).toBe('otro');
    expect(entornoDe('vercel.app.ejemplo.com')).toBe('otro');
  });

  it('la CSP que se publica impide la salida de datos; cualquier relajación se detecta', () => {
    expect(evaluarCsp(CSP).ok).toBe(true);
    expect(CABECERAS['Content-Security-Policy']).toBe(CSP);
    expect(evaluarCsp(null).ok).toBe(false);
    expect(evaluarCsp(CSP.replace("connect-src 'self'", "connect-src 'self' https://analitica.ejemplo")).texto).toMatch(/connect-src admite https:\/\/analitica\.ejemplo/);
    expect(evaluarCsp(CSP.replace("connect-src 'self' https://tiles.openfreemap.org", 'connect-src *')).ok).toBe(false);
    expect(evaluarCsp(CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")).ok).toBe(false);
    expect(evaluarCsp(CSP.replace("script-src 'self'", "script-src 'self' https://vercel.live")).ok).toBe(false);
    expect(evaluarCsp(CSP.replace("form-action 'none'", "form-action 'self'")).ok).toBe(false);
    // Sin connect-src explícito vale default-src
    expect(evaluarCsp("default-src 'self'; form-action 'none'; object-src 'none'").ok).toBe(true);
    expect(evaluarCsp("default-src *; form-action 'none'; object-src 'none'").ok).toBe(false);
  });

  it('protección: sin sesión debe rechazarse (401/403 o redirección a la autenticación)', () => {
    expect(evaluarProteccion({ status: 401, type: 'basic' }).ok).toBe(true);
    expect(evaluarProteccion({ status: 403, type: 'basic' }).ok).toBe(true);
    expect(evaluarProteccion({ status: 0, type: 'opaqueredirect' }).ok).toBe(true);
    expect(evaluarProteccion({ status: 200, type: 'basic' })).toMatchObject({ ok: false, texto: expect.stringMatching(/NO protegido/) });
    expect(evaluarProteccion(null).ok).toBe(false);
  });

  it('versión: mismo commit que el código en ejecución y rama revisada; huellas de todos los archivos', () => {
    const servida = { formato: 'ulit-censo/version', commit: 'a'.repeat(40), rama: RAMA_REVISADA, archivos: {} };
    expect(evaluarVersion({ commit: 'a'.repeat(40), rama: RAMA_REVISADA }, servida).ok).toBe(true);
    expect(evaluarVersion({ commit: 'b'.repeat(40), rama: RAMA_REVISADA }, servida).texto).toMatch(/recargue/);
    expect(evaluarVersion({ commit: 'a'.repeat(40), rama: 'otra' }, { ...servida, rama: 'claude/otra-rama' }).ok).toBe(false);
    expect(evaluarVersion({ commit: 'a'.repeat(40), rama: RAMA_REVISADA }, null).ok).toBe(false);
    expect(evaluarHuellas({ comprobados: 12, distintos: [] }).ok).toBe(true);
    expect(evaluarHuellas({ comprobados: 12, distintos: ['assets/index.js'] }).ok).toBe(false);
    expect(evaluarHuellas({ comprobados: 0, distintos: [] }).ok).toBe(false);
  });
});
