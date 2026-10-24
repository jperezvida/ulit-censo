// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

/**
 * Ejecución completa de desplegar-preview.sh con una CLI de Vercel y una API simuladas (sin red ni token
 * real): comprueba el ORDEN (protección del despliegue antes de la dirección fija) y la retirada segura.
 */
describe('desplegar-preview.sh · orden y fallo seguro', () => {
  const SCRIPT = resolve('scripts/vercel/desplegar-preview.sh');
  let bin: string;
  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), 'ulit-vc-bin-'));
    // npx simulado: registra cada orden de la CLI de Vercel
    writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash
shift 2  # --yes vercel@x
echo "vc $*" >> "$REGISTRO"
case "$1 $2" in
  "project inspect") [ -n "$PROYECTO_EXISTE" ] ;;
  "link --yes") mkdir -p .vercel && echo '{"projectId":"prj_1","orgId":"team_1"}' > .vercel/project.json ;;
  "deploy --prebuilt") echo "$URL_DESPLIEGUE" ;;
  *) true ;;
esac
`);
    // curl simulado SOLO para la API de Vercel (la comprobación de protección usa fetch de Node)
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
echo "curl $*" | sed 's/Bearer [^ ]*/Bearer ***/' >> "$REGISTRO"
case " $* " in *" -X PATCH "*) exit 0 ;; esac
echo "$PROYECTO_JSON"
`);
    chmodSync(join(bin, 'npx'), 0o755);
    chmodSync(join(bin, 'curl'), 0o755);
  });

  async function ejecutar(o: { despliegue: Modo; fija: Modo; proyecto?: unknown; rama?: string; token?: string }) {
    const dir = mkdtempSync(join(tmpdir(), 'ulit-vc-'));
    const registro = join(dir, 'registro.txt');
    writeFileSync(registro, '');
    const env = {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: dir,
      REGISTRO: registro,
      PROYECTO: 'ulit-censo-pruebas',
      DIRECCION_FIJA: 'ulit-censo-pruebas-vista.vercel.app',
      VERCEL_CLI: 'vercel@63.1.0',
      RAMA_PERMITIDA: 'claude/fase2-oficina-itinerarios',
      GITHUB_REF_NAME: o.rama ?? 'claude/fase2-oficina-itinerarios',
      VERCEL_TOKEN: o.token ?? 'token-de-prueba',
      PROYECTO_EXISTE: '1',
      PROYECTO_JSON: JSON.stringify(o.proyecto ?? { ssoProtection: { deploymentType: 'prod_deployment_urls_and_all_previews' } }),
      URL_DESPLIEGUE: await servidor(o.despliegue),
      URL_FIJA: await servidor(o.fija),
    };
    const codigo = await new Promise<number>((ok) => {
      const p = spawn('bash', [SCRIPT], { cwd: dir, env, stdio: 'ignore' });
      p.on('close', (c) => ok(c ?? -1));
    });
    const ordenes = readFileSync(registro, 'utf8').split('\n').filter(Boolean);
    return { codigo, ordenes, i: (re: RegExp) => ordenes.findIndex((l) => re.test(l)) };
  }

  it('todo protegido: confirma la configuración, despliega preview, comprueba y SOLO entonces asigna la dirección fija', async () => {
    const r = await ejecutar({ despliegue: 'redireccion-sso', fija: 'protegido-401' });
    expect(r.codigo).toBe(0);
    expect(r.i(/vc deploy --prebuilt --target preview/)).toBeGreaterThan(r.i(/curl -fsS https:\/\/api\.vercel\.com\/v9\/projects\/prj_1\?teamId=team_1/));
    expect(r.i(/vc alias set/)).toBeGreaterThan(r.i(/vc deploy/));
    expect(r.ordenes.join('\n')).not.toMatch(/--prod|alias rm|vc remove|token-de-prueba/);
  }, 60000);

  it('despliegue sin proteger (o con redirección ajena): lo retira y NO asigna la dirección fija', async () => {
    for (const despliegue of ['abierto', 'redireccion-ajena', 'sin-server'] as const) {
      const r = await ejecutar({ despliegue, fija: 'protegido-401' });
      expect(r.codigo, despliegue).toBe(1);
      expect(r.i(/vc alias set/), despliegue).toBe(-1);
      expect(r.i(/vc remove/), despliegue).toBeGreaterThan(r.i(/vc deploy/));
    }
  }, 60000);

  it('dirección fija sin proteger: la retira, retira el despliegue y falla', async () => {
    const r = await ejecutar({ despliegue: 'protegido-401', fija: 'abierto' });
    expect(r.codigo).toBe(1);
    expect(r.i(/vc alias rm ulit-censo-pruebas-vista\.vercel\.app/)).toBeGreaterThan(r.i(/vc alias set/));
    expect(r.i(/vc remove/)).toBeGreaterThan(r.i(/vc alias rm/));
  }, 60000);

  it('sin Vercel Authentication confirmada por la API: no despliega nada', async () => {
    const r = await ejecutar({ despliegue: 'protegido-401', fija: 'protegido-401', proyecto: { ssoProtection: null } });
    expect(r.codigo).toBe(1);
    expect(r.i(/vc deploy/)).toBe(-1);
  }, 60000);

  it('otra rama: no hace nada y falla; sin token: no hace nada y lo avisa', async () => {
    const otra = await ejecutar({ despliegue: 'protegido-401', fija: 'protegido-401', rama: 'claude/otra' });
    expect(otra.codigo).toBe(1);
    expect(otra.ordenes).toEqual([]);
    const sin = await ejecutar({ despliegue: 'protegido-401', fija: 'protegido-401', token: '' });
    expect(sin.codigo).toBe(0);
    expect(sin.ordenes).toEqual([]);
    expect(existsSync(SCRIPT)).toBe(true);
  }, 60000);
});
