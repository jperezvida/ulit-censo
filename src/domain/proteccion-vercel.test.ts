// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { comprobarDireccion, esperarProteccion, evaluarConfiguracion, evaluarRespuestaSinSesion, type ComprobacionDireccion } from '../../scripts/vercel/proteccion.mjs';

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


/** Respuestas simuladas de una comprobación de las tres rutas. */
const RUTAS = ['/', '/index.html', '/version.json'];
const intento = (estado: 'protegida' | '404' | 'abierta' | 'mixta'): ComprobacionDireccion => {
  const r = (i: number) => {
    const e = estado === 'mixta' ? (i === 2 ? '404' : 'protegida') : estado;
    return e === 'protegida' ? { url: `x${RUTAS[i]}`, ok: true, motivo: '401', status: 401 }
      : e === '404' ? { url: `x${RUTAS[i]}`, ok: false, motivo: 'responde 404 sin sesión: accesible para cualquiera', status: 404 }
      : { url: `x${RUTAS[i]}`, ok: false, motivo: 'responde 200 sin sesión: accesible para cualquiera', status: 200 };
  };
  const resultados = RUTAS.map((_, i) => r(i));
  return { ok: resultados.every((x) => x.ok), resultados };
};
/** Reloj y espera simulados: cada `dormir` avanza el reloj sin esperar de verdad. */
function simulado(secuencia: ComprobacionDireccion[]) {
  let t = 0;
  let i = 0;
  const esperas: number[] = [];
  return {
    esperas,
    opciones: {
      comprobar: async () => secuencia[Math.min(i++, secuencia.length - 1)],
      dormir: async (ms: number) => { esperas.push(ms); t += ms; },
      ahora: () => t,
    },
    llamadas: () => i,
  };
}

describe('Protección de la vista previa · espera limitada ante 404 (dirección aún no activa)', () => {
  it('un 404 nunca acredita la protección', () => {
    expect(evaluarRespuestaSinSesion({ status: 404, server: 'Vercel', error: 'DEPLOYMENT_NOT_FOUND' })).toEqual({ ok: false, motivo: 'responde 404 sin sesión: accesible para cualquiera (x-vercel-error: DEPLOYMENT_NOT_FOUND)' });
  });

  it('respuesta protegida a la primera: se acepta sin esperar', async () => {
    const s = simulado([intento('protegida')]);
    const r = await esperarProteccion('x', s.opciones);
    expect([r.ok, r.intentos, s.esperas]).toEqual([true, 1, []]);
  });

  it('404 transitorio: se repite cada 5 s y se acepta cuando las TRES rutas están protegidas en el mismo intento', async () => {
    const s = simulado([intento('404'), intento('404'), intento('mixta'), intento('protegida')]);
    const r = await esperarProteccion('x', s.opciones);
    expect([r.ok, r.intentos]).toEqual([true, 4]);
    expect(s.esperas).toEqual([5000, 5000, 5000]);
  });

  it('404 persistente: se rinde a los 60 s (13 intentos) sin aceptar nada', async () => {
    const s = simulado([intento('404')]);
    const r = await esperarProteccion('x', s.opciones);
    expect(r.ok).toBe(false);
    expect(r.intentos).toBe(13);
    expect(s.esperas.reduce((a, b) => a + b, 0)).toBe(60_000);
    expect(r.motivo).toMatch(/404 persistente durante 60 s \(13 intentos\)/);
  });

  it('una respuesta abierta (200) detiene la espera al instante: no se reintenta', async () => {
    const s = simulado([intento('404'), intento('abierta'), intento('protegida')]);
    const r = await esperarProteccion('x', s.opciones);
    expect([r.ok, r.intentos, s.esperas.length]).toEqual([false, 2, 1]);
    expect(r.motivo).toMatch(/no se reintenta/);
  });

  it('con un servidor real: 404 de Vercel durante unos intentos y después la redirección al inicio de sesión', async () => {
    let peticiones = 0;
    const s = createServer((_req, res) => {
      peticiones++;
      if (peticiones <= 6) res.writeHead(404, { server: 'Vercel', 'x-vercel-error': 'DEPLOYMENT_NOT_FOUND' }).end('The deployment could not be found');
      else res.writeHead(302, { server: 'Vercel', location: 'https://vercel.com/sso-api?url=x' }).end();
    });
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
    servidores.push(s);
    const base = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
    const vistos: string[] = [];
    const r = await esperarProteccion(base, { intervaloMs: 10, limiteMs: 1000, informar: (_n, x) => vistos.push(...x.resultados.map((y) => y.motivo)) });
    expect([r.ok, r.intentos, peticiones]).toEqual([true, 3, 9]);
    expect(vistos[0]).toMatch(/404.*DEPLOYMENT_NOT_FOUND/);
    expect(r.resultados.map((x) => x.motivo)).toEqual(Array(3).fill('redirección 302 al inicio de sesión de Vercel (https://vercel.com/sso-api)'));
  });
});
