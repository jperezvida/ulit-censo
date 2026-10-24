// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { comprobarDireccion, evaluarConfiguracion, evaluarRespuestaSinSesion } from '../../scripts/vercel/proteccion.mjs';

/** Servidores que imitan las respuestas posibles de un despliegue SIN sesión. */
type Modo = 'protegido-401' | 'redireccion-sso' | 'redireccion-ajena' | 'abierto' | 'sin-server' | 'abierto-con-401';
const modos = new Map<number, Modo>();
const servidores: Server[] = [];
async function servidor(modo: Modo): Promise<string> {
  const s = createServer((_req, res) => {
    const m = modos.get((s.address() as { port: number }).port)!;
    if (m === 'protegido-401') res.writeHead(401, { server: 'Vercel', 'content-type': 'text/html' }).end('<title>Authentication Required</title>');
    else if (m === 'redireccion-sso') res.writeHead(307, { server: 'Vercel', location: 'https://vercel.com/sso-api?url=x&nonce=y' }).end();
    else if (m === 'redireccion-ajena') res.writeHead(302, { server: 'Vercel', location: 'https://vercel.com.evil.example/sso-api' }).end();
    else if (m === 'sin-server') res.writeHead(401).end('no');
    else if (m === 'abierto-con-401') res.writeHead(401, { server: 'Vercel' }).end('{"formato":"ulit-censo/version"}');
    else res.writeHead(200, { server: 'Vercel', 'content-type': 'text/html' }).end('<script src="./assets/index-abc.js"></script>');
  });
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const puerto = (s.address() as { port: number }).port;
  modos.set(puerto, modo);
  servidores.push(s);
  return `http://127.0.0.1:${puerto}`;
}
afterAll(() => servidores.forEach((s) => s.close()));

describe('Protección de la vista previa · evaluación de respuestas sin sesión', () => {
  it('acepta 401/403 de Vercel y la redirección al inicio de sesión de Vercel; nada más', () => {
    const v = (r: Parameters<typeof evaluarRespuestaSinSesion>[0]) => evaluarRespuestaSinSesion(r).ok;
    expect(v({ status: 401, server: 'Vercel', cuerpo: 'Authentication Required' })).toBe(true);
    expect(v({ status: 403, server: 'Vercel' })).toBe(true);
    expect(v({ status: 307, server: 'Vercel', location: 'https://vercel.com/sso-api?url=a' })).toBe(true);
    expect(v({ status: 302, server: 'Vercel', location: 'https://vercel.com/login?next=a' })).toBe(true);
    // Redirecciones que NO son el inicio de sesión de Vercel
    for (const location of [
      'https://vercel.com.evil.example/sso-api',
      'https://evil.example/?u=https://vercel.com/sso-api',
      'http://vercel.com/sso-api',
      'https://vercel.com:8443/sso-api',
      'https://user@vercel.com/sso-api',
      'https://vercel.com/sso-apix',
      'https://vercel.com/',
      'https://ulit-censo-pruebas-vista.vercel.app/',
      '/sso-api',
      null,
    ]) expect(v({ status: 302, server: 'Vercel', location }), String(location)).toBe(false);
    // Respuestas abiertas, ajenas a Vercel o que filtran la aplicación
    expect(v({ status: 200, server: 'Vercel', cuerpo: 'x' })).toBe(false);
    expect(v({ status: 404, server: 'Vercel' })).toBe(false);
    expect(v({ status: 401, server: null })).toBe(false);
    expect(v({ status: 401, server: 'nginx' })).toBe(false);
    expect(v({ status: 401, server: 'Vercel', cuerpo: '{"formato":"ulit-censo/version"}' })).toBe(false);
    expect(v({ status: 403, server: 'Vercel', cuerpo: '<script src="./assets/index-a.js">' })).toBe(false);
  });

  it('configuración del proyecto: exige Vercel Authentication con un ámbito que cubra las previews', () => {
    expect(evaluarConfiguracion({ ssoProtection: { deploymentType: 'prod_deployment_urls_and_all_previews' } }).ok).toBe(true);
    expect(evaluarConfiguracion({ ssoProtection: { deploymentType: 'all_except_custom_domains' } }).ok).toBe(true);
    expect(evaluarConfiguracion({ ssoProtection: null }).ok).toBe(false);
    expect(evaluarConfiguracion({}).ok).toBe(false);
    expect(evaluarConfiguracion(null).ok).toBe(false);
    expect(evaluarConfiguracion({ ssoProtection: { deploymentType: 'otro' } }).ok).toBe(false);
  });

  it('comprueba por HTTP todas las rutas de una dirección (sin cookies, sin seguir redirecciones)', async () => {
    expect((await comprobarDireccion(await servidor('protegido-401'))).ok).toBe(true);
    expect((await comprobarDireccion(await servidor('redireccion-sso'))).ok).toBe(true);
    for (const m of ['redireccion-ajena', 'abierto', 'sin-server', 'abierto-con-401'] as const) {
      expect((await comprobarDireccion(await servidor(m))).ok, m).toBe(false);
    }
    expect((await comprobarDireccion('http://127.0.0.1:1')).ok).toBe(false);
  });
});

