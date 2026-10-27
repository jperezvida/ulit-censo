// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { evaluarAliasRetirado, evaluarDespliegueCreado, evaluarDominioProduccion, evaluarRetirable, extraerDespliegue } from '../../scripts/vercel/desplegar-preview.mjs';

/** Respuesta JSON REAL de `vercel deploy --prebuilt --target preview --non-interactive` (CLI 63.1.0) del despliegue erróneo. */
const CLI_REAL = readFileSync(resolve('src/domain/fixtures/vercel-cli-63-deploy-produccion.json'), 'utf8');
const PROD_ERRONEO = 'dpl_5wBBNu998QbWfURDUtHgy5FSKgJV';
const ID = 'prj_4jaGUwOyzt4Kt3J7wzoDHJgZtAvE';
/** Alias reales del despliegue erróneo (comprobados en Vercel). */
const ALIAS_PROD = ['ulit-censo-pruebas.vercel.app', 'ulit-censo-pruebas-jaimes-projects-e2a33d1a.vercel.app'];

describe('Respuesta de la CLI de Vercel y tipo real del despliegue', () => {
  it('lee el identificador de la respuesta JSON real (no la usa como dirección)', () => {
    expect(extraerDespliegue(CLI_REAL)).toEqual({
      id: PROD_ERRONEO,
      url: 'https://ulit-censo-pruebas-8t37jarwt-jaimes-projects-e2a33d1a.vercel.app',
      targetCli: 'production',
    });
    expect(extraerDespliegue(`${CLI_REAL}\n`).id).toBe(PROD_ERRONEO);
    // Salida clásica (sin --non-interactive): una dirección
    expect(extraerDespliegue('https://ulit-censo-pruebas-abc-equipo.vercel.app\n').id).toBe('ulit-censo-pruebas-abc-equipo.vercel.app');
    // Respuestas que no se aceptan
    expect(() => extraerDespliegue('{"status":"error","reason":"x"}')).toThrow(/no confirma/);
    expect(() => extraerDespliegue('{"status":"ok","deployment":{"id":"../x"}}')).toThrow(/identificador/);
    expect(() => extraerDespliegue('{ roto')).toThrow(/no se puede interpretar/);
    expect(() => extraerDespliegue('https://evil.example')).toThrow();
    expect(() => extraerDespliegue('')).toThrow();
  });

  it('solo acepta una PREVIEW lista de este proyecto; el despliegue marcado como production se rechaza', () => {
    const base = { id: 'dpl_A', projectId: ID, readyState: 'READY', url: 'x.vercel.app' };
    expect(evaluarDespliegueCreado({ ...base, target: null }, ID).ok).toBe(true);
    expect(evaluarDespliegueCreado({ ...base, target: 'preview' }, ID).ok).toBe(true);
    const prod = evaluarDespliegueCreado({ ...base, target: 'production' }, ID);
    expect(prod).toMatchObject({ ok: false, produccion: true });
    expect(prod.motivo).toMatch(/PRODUCCIÓN/);
    expect(evaluarDespliegueCreado({ ...base, target: 'staging' }, ID).ok).toBe(false);
    expect(evaluarDespliegueCreado({ ...base, target: null, projectId: 'prj_otro' }, ID).ok).toBe(false);
    expect(evaluarDespliegueCreado({ ...base, target: null, readyState: 'ERROR' }, ID).ok).toBe(false);
    expect(evaluarDespliegueCreado(null, ID).ok).toBe(false);
  });

  it('retirada: solo el despliegue indicado, de este proyecto y de producción', () => {
    const d = { id: PROD_ERRONEO, projectId: ID, target: 'production' };
    expect(evaluarRetirable(d, { id: PROD_ERRONEO, projectId: ID }).ok).toBe(true);
    expect(evaluarRetirable({ ...d, projectId: 'prj_otro' }, { id: PROD_ERRONEO, projectId: ID }).ok).toBe(false);
    expect(evaluarRetirable({ ...d, target: null }, { id: PROD_ERRONEO, projectId: ID }).ok).toBe(false);
    expect(evaluarRetirable({ ...d, id: 'dpl_otro' }, { id: PROD_ERRONEO, projectId: ID }).ok).toBe(false);
    // Alias: solo cuenta la API (no basta con que el dominio pida autenticación)
    expect(evaluarAliasRetirado({ status: 404, json: null }, [PROD_ERRONEO]).ok).toBe(true);
    expect(evaluarAliasRetirado({ status: 200, json: { deploymentId: 'dpl_Otro' } }, [PROD_ERRONEO])).toMatchObject({ ok: true, otro: 'dpl_Otro' });
    expect(evaluarAliasRetirado({ status: 200, json: { deploymentId: PROD_ERRONEO } }, [PROD_ERRONEO]).ok).toBe(false);
    expect(evaluarAliasRetirado({ status: 200, json: {} }, [PROD_ERRONEO]).ok).toBe(false);
    expect(evaluarAliasRetirado({ status: 401, json: null }, [PROD_ERRONEO]).ok).toBe(false);
    expect(evaluarAliasRetirado({ status: 500, json: null }, [PROD_ERRONEO]).ok).toBe(false);
    expect(evaluarDominioProduccion({ status: 404, server: 'Vercel' }).ok).toBe(true);
    expect(evaluarDominioProduccion({ status: 401, server: 'Vercel' }).ok).toBe(true);
    expect(evaluarDominioProduccion({ status: 200, server: 'Vercel', cuerpo: '{"formato":"ulit-censo/version"}' }).ok).toBe(false);
  });
});

// ─────────────── Ejecución completa con una CLI y una API de Vercel simuladas ───────────────

type ModoHttp = 'protegido-401' | 'redireccion-sso' | 'abierto' | 'no-encontrado';
const servidores: Server[] = [];
async function escuchar(manejar: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const s = createServer(manejar);
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  servidores.push(s);
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
afterAll(() => servidores.forEach((s) => s.close()));

/** Sitio servido SIN sesión (despliegue, dirección fija o dominio de producción). */
const sitio = (modo: ModoHttp) =>
  escuchar((_req, res) => {
    if (modo === 'protegido-401') res.writeHead(401, { server: 'Vercel' }).end('Authentication Required');
    else if (modo === 'redireccion-sso') res.writeHead(307, { server: 'Vercel', location: 'https://vercel.com/sso-api?url=x' }).end();
    else if (modo === 'no-encontrado') res.writeHead(404, { server: 'Vercel' }).end('DEPLOYMENT_NOT_FOUND');
    else res.writeHead(200, { server: 'Vercel' }).end('{"formato":"ulit-censo/version"}');
  });

interface Dep { id: string; projectId: string; target: string | null; readyState: string; url: string }
interface Escenario {
  /** Tipo que Vercel asigna al nuevo despliegue (lo decide Vercel, no la CLI). */
  creaComo?: 'production' | null;
  previos?: Dep[];
  sso?: unknown;
  despliegue?: ModoHttp;
  fija?: ModoHttp;
  produccion?: ModoHttp;
  retirar?: string;
  rama?: string;
  token?: string;
  /** La API acepta el DELETE del alias pero no lo retira. */
  aliasNoSeBorra?: boolean;
  /** Alias que apunta al despliegue erróneo pero que la API NO lista entre sus alias. */
  aliasOculto?: string;
}

/** API de Vercel simulada: registra cada llamada y mantiene despliegues y alias. */
async function apiSimulada(e: Escenario) {
  const deps = new Map<string, Dep>((e.previos ?? []).map((d) => [d.id, d]));
  const alias = new Map<string, string>();
  // Alias reales del despliegue erróneo. Al eliminar un despliegue NO se borran sus alias (peor caso).
  if (deps.get(PROD_ERRONEO)?.target === 'production') for (const a of ALIAS_PROD) alias.set(a, PROD_ERRONEO);
  if (e.aliasOculto) alias.set(e.aliasOculto, PROD_ERRONEO);
  const destinoProd = deps.get(PROD_ERRONEO)?.target === 'production' ? { id: PROD_ERRONEO } : undefined;
  const llamadas: string[] = [];
  let n = 0;
  const base = await escuchar((req, res) => {
    const u = new URL(req.url!, 'http://x');
    const json = (status: number, cuerpo: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo));
    let cuerpo = '';
    req.on('data', (c) => (cuerpo += c));
    req.on('end', () => {
      if (u.pathname === '/__crear') {
        // Lo que hace Vercel al recibir el despliegue de la CLI
        const id = `dpl_Nuevo${++n}`;
        deps.set(id, { id, projectId: ID, target: e.creaComo ?? null, readyState: 'READY', url: `ulit-censo-pruebas-nuevo${n}.vercel.app` });
        const cli = JSON.parse(CLI_REAL);
        Object.assign(cli.deployment, { id, url: `https://ulit-censo-pruebas-nuevo${n}.vercel.app`, target: e.creaComo ?? null });
        llamadas.push(`CREAR ${id} target=${e.creaComo ?? null}`);
        return res.end(JSON.stringify(cli, null, 2));
      }
      if (req.headers.authorization !== 'Bearer token-de-prueba' || u.searchParams.get('teamId') !== 'team_1') return json(403, { error: 'forbidden' });
      llamadas.push(`${req.method} ${u.pathname}${u.searchParams.get('target') ? `?target=${u.searchParams.get('target')}` : ''}`);
      const m = (re: RegExp) => u.pathname.match(re);
      if (m(/^\/v9\/projects\/[^/]+$/)) return json(200, { id: ID, name: 'ulit-censo-pruebas', ssoProtection: 'sso' in e ? e.sso : { deploymentType: 'prod_deployment_urls_and_all_previews' }, targets: destinoProd ? { production: destinoProd } : {} });
      if (u.pathname === '/v6/deployments') {
        const t = u.searchParams.get('target');
        return json(200, { deployments: [...deps.values()].filter((d) => !t || d.target === t).map((d) => ({ uid: d.id, target: d.target, url: d.url })) });
      }
      let r = m(/^\/v13\/deployments\/([^/]+)$/);
      if (r && req.method === 'GET') return deps.has(r[1]) ? json(200, deps.get(r[1])) : json(404, { error: { code: 'not_found' } });
      if (r && req.method === 'DELETE') return deps.delete(r[1]) ? json(200, { uid: r[1], state: 'DELETED' }) : json(404, {});
      r = m(/^\/v2\/deployments\/([^/]+)\/aliases$/);
      if (r && req.method === 'GET') {
        const id = r[1];
        return json(200, { aliases: [...alias].filter(([a, d]) => d === id && a !== e.aliasOculto).map(([a]) => ({ uid: `ali_${a}`, alias: a })) });
      }
      if (r) return alias.set(JSON.parse(cuerpo).alias, r[1]), json(200, { alias: JSON.parse(cuerpo).alias });
      r = m(/^\/v4\/aliases\/([^/]+)$/);
      if (r) return alias.has(r[1]) ? json(200, { alias: r[1], deploymentId: alias.get(r[1]) }) : json(404, {});
      r = m(/^\/v2\/aliases\/([^/]+)$/);
      if (r) {
        if (!e.aliasNoSeBorra) alias.delete(r[1].replace(/^ali_/, ''));
        return json(200, { status: 'SUCCESS' });
      }
      json(404, { error: 'ruta no simulada' });
    });
  });
  return { base, deps, alias, llamadas };
}

const SCRIPT = resolve('scripts/vercel/desplegar-preview.mjs');
let bin: string;
beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), 'ulit-vc-bin-'));
  // npx simulado = CLI de Vercel: registra las órdenes; «deploy» pide a la API simulada que cree el despliegue
  writeFileSync(
    join(bin, 'npx'),
    `#!/usr/bin/env bash
shift 2  # --yes vercel@x
echo "vc $*" >> "$REGISTRO"
case "$1 $2" in
  "project inspect") exit 0 ;;
  "link --yes") mkdir -p .vercel && echo '{"projectId":"${ID}","orgId":"team_1"}' > .vercel/project.json ;;
  "deploy --prebuilt") node -e 'fetch(process.env.VERCEL_API + "/__crear").then((r) => r.text()).then((t) => process.stdout.write(t))' ;;
  *) true ;;
esac
`,
  );
  chmodSync(join(bin, 'npx'), 0o755);
});

const previoProd = (): Dep => ({ id: PROD_ERRONEO, projectId: ID, target: 'production', readyState: 'READY', url: 'ulit-censo-pruebas-8t37jarwt-jaimes-projects-e2a33d1a.vercel.app' });

async function ejecutar(e: Escenario) {
  const api = await apiSimulada(e);
  const dir = mkdtempSync(join(tmpdir(), 'ulit-vc-'));
  const registro = join(dir, 'registro.txt');
  const resumen = join(dir, 'resumen.md');
  writeFileSync(registro, '');
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: dir,
    REGISTRO: registro,
    GITHUB_STEP_SUMMARY: resumen,
    PROYECTO: 'ulit-censo-pruebas',
    DIRECCION_FIJA: 'ulit-censo-pruebas-vista.vercel.app',
    VERCEL_CLI: 'vercel@63.1.0',
    RAMA_PERMITIDA: 'claude/fase2-oficina-itinerarios',
    GITHUB_REF_NAME: e.rama ?? 'claude/fase2-oficina-itinerarios',
    VERCEL_TOKEN: e.token ?? 'token-de-prueba',
    RETIRAR_PRODUCCION: e.retirar ?? PROD_ERRONEO,
    ALIAS_PRODUCCION: ALIAS_PROD.join(' '),
    VERCEL_API: api.base,
    URL_DESPLIEGUE: await sitio(e.despliegue ?? 'redireccion-sso'),
    URL_FIJA: await sitio(e.fija ?? 'protegido-401'),
    URL_PRODUCCION: await sitio(e.produccion ?? 'no-encontrado'),
  };
  let salida = '';
  const codigo = await new Promise<number>((ok) => {
    const p = spawn('node', [SCRIPT], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (c) => (salida += c));
    p.stderr.on('data', (c) => (salida += c));
    p.on('close', (c) => ok(c ?? -1));
  });
  const cli = readFileSync(registro, 'utf8').split('\n').filter(Boolean);
  const i = (re: RegExp) => api.llamadas.findIndex((l) => re.test(l));
  return { codigo, salida, cli, ...api, i };
}

describe('desplegar-preview.mjs · solo PREVIEW verificada por la API, retirada segura y fallo seguro', () => {
  it('caso normal: preview confirmada y protegida → retira el despliegue de producción erróneo → SOLO entonces asigna la dirección fija', async () => {
    const r = await ejecutar({ previos: [previoProd()] });
    expect(r.codigo, r.salida).toBe(0);
    expect(r.deps.has(PROD_ERRONEO)).toBe(false);
    expect([...r.deps.values()].map((d) => d.target)).toEqual([null]);
    expect(r.alias.get('ulit-censo-pruebas-vista.vercel.app')).toBe('dpl_Nuevo1');
    // Los dos alias del despliegue erróneo, retirados y VERIFICADOS por la API antes de la dirección fija
    for (const a of ALIAS_PROD) {
      expect(r.alias.has(a), a).toBe(false);
      expect(r.i(new RegExp(`DELETE /v2/aliases/ali_${a.replace(/\./g, '\\.')}`)), a).toBeLessThan(r.i(/DELETE \/v13\/deployments\/dpl_5wBB/));
      expect(r.i(new RegExp(`GET /v4/aliases/${a.replace(/\./g, '\\.')}`)), a).toBeGreaterThan(r.i(/DELETE \/v13\/deployments\/dpl_5wBB/));
      expect(r.i(new RegExp(`GET /v4/aliases/${a.replace(/\./g, '\\.')}`)), a).toBeLessThan(r.i(/POST \/v2\/deployments\/dpl_Nuevo1\/aliases/));
    }
    // Orden: tipo por la API → retirada → comprobación sin producción → alias
    expect(r.i(/GET \/v13\/deployments\/dpl_Nuevo1/)).toBeGreaterThan(r.i(/CREAR/));
    expect(r.i(/DELETE \/v13\/deployments\/dpl_5wBB/)).toBeGreaterThan(r.i(/GET \/v13\/deployments\/dpl_Nuevo1/));
    expect(r.i(/GET \/v6\/deployments\?target=production/)).toBeGreaterThan(r.i(/DELETE \/v13\/deployments\/dpl_5wBB/));
    expect(r.i(/POST \/v2\/deployments\/dpl_Nuevo1\/aliases/)).toBeGreaterThan(r.i(/GET \/v6\/deployments\?target=production/));
    expect(r.cli.join('\n')).toMatch(/vc deploy --prebuilt --target preview --yes --non-interactive/);
    expect(r.cli.join('\n')).not.toMatch(/--prod|alias|remove/);
    expect(r.salida).not.toContain('token-de-prueba');
  }, 60000);

  it('REGRESIÓN: si Vercel crea el despliegue como production (respuesta real de la CLI), lo elimina, no asigna alias y no toca nada más', async () => {
    const r = await ejecutar({ previos: [previoProd()], creaComo: 'production' });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/Vercel ha creado dpl_Nuevo1 como PRODUCCIÓN/);
    expect(r.deps.has('dpl_Nuevo1')).toBe(false);
    expect(r.i(/POST \/v2\/deployments\/[^/]+\/aliases/)).toBe(-1);
    // El despliegue erróneo anterior no se retira en una ejecución fallida (se retira cuando hay preview válida)
    expect(r.deps.has(PROD_ERRONEO)).toBe(true);
  }, 60000);

  it('alias del despliegue erróneo que no se retira (DELETE aceptado sin efecto): se detiene sin asignar la dirección fija', async () => {
    const r = await ejecutar({ previos: [previoProd()], aliasNoSeBorra: true });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/sigue apuntando al despliegue retirado dpl_5wBB/);
    expect(r.i(/POST \/v2\/deployments\/dpl_Nuevo1\/aliases/)).toBe(-1);
    expect(r.alias.has('ulit-censo-pruebas-vista.vercel.app')).toBe(false);
  }, 60000);

  it('alias que la API no lista entre los del despliegue pero sigue apuntando a él: se detecta y se detiene', async () => {
    const r = await ejecutar({ previos: [previoProd()], aliasOculto: ALIAS_PROD[1] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(new RegExp(`El alias ${ALIAS_PROD[1].replace(/\./g, '\\.')} no está retirado`));
    expect(r.i(/POST \/v2\/deployments\/dpl_Nuevo1\/aliases/)).toBe(-1);
  }, 60000);

  it('proyecto sin ningún despliegue: no despliega (Vercel asignaría el primero a producción)', async () => {
    const r = await ejecutar({ previos: [], retirar: '' });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/asignaría el primero a PRODUCCIÓN/);
    expect(r.cli.some((l) => l.startsWith('vc deploy'))).toBe(false);
  }, 60000);

  it('retirada no segura (otro proyecto o no es producción): no despliega ni borra nada', async () => {
    for (const previo of [{ ...previoProd(), projectId: 'prj_otro' }, { ...previoProd(), target: null }]) {
      const r = await ejecutar({ previos: [previo] });
      expect(r.codigo).toBe(1);
      expect(r.cli.some((l) => l.startsWith('vc deploy'))).toBe(false);
      expect(r.i(/DELETE/)).toBe(-1);
    }
  }, 60000);

  it('despliegue sin proteger: lo elimina, no retira nada más ni asigna alias', async () => {
    const r = await ejecutar({ previos: [previoProd()], despliegue: 'abierto' });
    expect(r.codigo).toBe(1);
    expect(r.deps.has('dpl_Nuevo1')).toBe(false);
    expect(r.deps.has(PROD_ERRONEO)).toBe(true);
    expect(r.i(/POST \/v2\/deployments\/[^/]+\/aliases/)).toBe(-1);
  }, 60000);

  it('otro despliegue de producción no previsto: no lo toca y no asigna alias', async () => {
    const otro = { ...previoProd(), id: 'dpl_OtroProd' };
    const r = await ejecutar({ previos: [previoProd(), otro] });
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no previstos \(dpl_OtroProd\)/);
    expect(r.deps.has('dpl_OtroProd')).toBe(true);
    expect(r.i(/POST \/v2\/deployments\/[^/]+\/aliases/)).toBe(-1);
  }, 60000);

  it('dominio de producción todavía sirviendo la aplicación: no asigna alias', async () => {
    const r = await ejecutar({ previos: [previoProd()], produccion: 'abierto' });
    expect(r.codigo).toBe(1);
    expect(r.i(/POST \/v2\/deployments\/[^/]+\/aliases/)).toBe(-1);
  }, 60000);

  it('dirección fija sin proteger: la retira y elimina el despliegue', async () => {
    const r = await ejecutar({ previos: [previoProd()], fija: 'abierto' });
    expect(r.codigo).toBe(1);
    expect(r.alias.size).toBe(0);
    expect(r.deps.has('dpl_Nuevo1')).toBe(false);
    expect(r.i(/DELETE \/v2\/aliases\/ulit-censo-pruebas-vista\.vercel\.app/)).toBeGreaterThan(r.i(/POST \/v2\/deployments\/dpl_Nuevo1\/aliases/));
  }, 60000);

  it('sin Vercel Authentication confirmada, desde otra rama o sin token: no despliega', async () => {
    const sinSso = await ejecutar({ previos: [previoProd()], sso: null });
    expect(sinSso.codigo).toBe(1);
    expect(sinSso.cli.some((l) => l.startsWith('vc deploy'))).toBe(false);
    const otra = await ejecutar({ previos: [previoProd()], rama: 'claude/otra' });
    expect(otra.codigo).toBe(1);
    expect(otra.cli).toEqual([]);
    const sin = await ejecutar({ previos: [previoProd()], token: '' });
    expect(sin.codigo).toBe(0);
    expect(sin.cli).toEqual([]);
  }, 60000);
});
