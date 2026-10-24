#!/usr/bin/env node
// Despliegue de PREVIEW (nunca producción) de ULIT Censo en el proyecto propio de Vercel, con dirección fija.
//
// Por qué no basta con `--target preview`: la CLI de Vercel (63.1.0) convierte «preview» en «sin target»
// al llamar a la API, y Vercel asigna a PRODUCCIÓN el primer despliegue de un proyecto que no indica
// target. Por eso este script NO se fía de la CLI: verifica por la API el tipo real de cada despliegue.
//
// Orden (cada paso solo se ejecuta si el anterior se ha CONFIRMADO; si algo falla, no se asigna alias):
//   1. Rama permitida y token presentes.
//   2. Proyecto propio $PROYECTO (se crea si no existe) y enlace. No se toca ningún otro proyecto.
//   3. Vercel Authentication activada y confirmada por la API.
//   4. El proyecto ya tiene despliegues (si no, Vercel asignaría a producción el primero): si no, NO despliega.
//   5. Los despliegues de producción que se van a retirar ($RETIRAR_PRODUCCION) se validan antes de nada.
//   6. Despliegue con la CLI; se lee su respuesta JSON y se consulta el despliegue en la API:
//      debe ser de este proyecto, READY y de tipo PREVIEW. Si Vercel lo hubiera creado como producción,
//      se ELIMINA de inmediato y se falla.
//   7. Protección comprobada SIN sesión sobre el despliegue (scripts/vercel/proteccion.mjs).
//   8. Retirada de los despliegues de producción indicados (solo los de la lista, de este proyecto y de
//      tipo producción): primero sus alias y después el despliegue. Comprobación POR LA API de que ninguno
//      de sus alias (los detectados y los de $ALIAS_PRODUCCION) apunta ya a él, de que el proyecto no
//      tiene ningún despliegue de producción ni un destino de producción activo, y de que su dominio de
//      producción no sirve la aplicación.
//   9. Solo entonces se asigna la dirección fija; se verifica por la API que apunta a este despliegue y,
//      sin sesión, que está protegida. Si no, se retira la dirección y el despliegue, y se falla.
// El token se lee de VERCEL_TOKEN (secreto del entorno «preview» de GitHub) y nunca se imprime.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { comprobarDireccion, evaluarConfiguracion, evaluarRespuestaSinSesion } from './proteccion.mjs';

/**
 * Interpreta la salida estándar de `vercel deploy`. Con `--non-interactive` es un JSON
 * ({ status, deployment: { id, url, target, … } }); sin él, una dirección. Devuelve el identificador o
 * la dirección para consultarlo en la API (nunca se usa la salida como dirección sin validarla).
 */
export function extraerDespliegue(salida) {
  const texto = String(salida ?? '').trim();
  if (texto.startsWith('{')) {
    let json;
    try {
      json = JSON.parse(texto);
    } catch {
      throw new Error('la respuesta JSON de la CLI no se puede interpretar');
    }
    if (json.status !== 'ok') throw new Error(`la CLI no confirma el despliegue (status: ${json.status ?? 'ausente'})`);
    const d = json.deployment ?? {};
    if (typeof d.id !== 'string' || !/^dpl_[A-Za-z0-9]+$/.test(d.id)) throw new Error('la respuesta de la CLI no contiene un identificador de despliegue válido');
    return { id: d.id, url: typeof d.url === 'string' ? d.url : null, targetCli: d.target ?? null };
  }
  const ultima = texto.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  if (/^https:\/\/[a-z0-9.-]+\.vercel\.app$/i.test(ultima)) return { id: new URL(ultima).hostname, url: ultima, targetCli: null };
  throw new Error('la salida de la CLI no contiene ni JSON ni una dirección de despliegue');
}

/** Despliegue recién creado (respuesta de GET /v13/deployments/:id): solo vale PREVIEW de este proyecto. */
export function evaluarDespliegueCreado(dep, projectId) {
  if (!dep || typeof dep.id !== 'string') return { ok: false, motivo: 'la API no devuelve el despliegue' };
  if (dep.projectId !== projectId) return { ok: false, motivo: `el despliegue ${dep.id} no pertenece al proyecto ${projectId}` };
  if (dep.target === 'production') return { ok: false, produccion: true, motivo: `Vercel ha creado ${dep.id} como PRODUCCIÓN (target: production)` };
  if (dep.target !== null && dep.target !== undefined && dep.target !== 'preview') return { ok: false, motivo: `el despliegue ${dep.id} no es una preview (target: ${dep.target})` };
  if (dep.readyState !== 'READY') return { ok: false, motivo: `el despliegue ${dep.id} no está listo (readyState: ${dep.readyState})` };
  return { ok: true, motivo: `${dep.id} es una PREVIEW de este proyecto (target: ${dep.target ?? 'null'}) y está lista` };
}

/** Solo se retira un despliegue indicado explícitamente, de este proyecto y de tipo producción. */
export function evaluarRetirable(dep, { id, projectId }) {
  if (!dep) return { ok: false, motivo: `no se ha podido leer ${id}` };
  if (dep.id !== id) return { ok: false, motivo: `la API devuelve ${dep.id} en lugar de ${id}` };
  if (dep.projectId !== projectId) return { ok: false, motivo: `${id} no pertenece al proyecto ${projectId}: no se toca` };
  if (dep.target !== 'production') return { ok: false, motivo: `${id} no es de producción (target: ${dep.target ?? 'null'}): no se toca` };
  return { ok: true, motivo: `${id} es de producción y de este proyecto` };
}

/**
 * Alias tras la retirada (respuesta de GET /v4/aliases/:alias). Solo vale que ya no exista (404) o que
 * apunte a OTRO despliegue (que además se comprueba que no sea de producción). Una respuesta HTTP de
 * autenticación en el dominio no demuestra nada: esto se decide solo con la API.
 */
export function evaluarAliasRetirado(r, retirados) {
  if (r.status === 404) return { ok: true, motivo: 'ya no existe' };
  if (r.status !== 200 || !r.json) return { ok: false, motivo: `no se puede confirmar (API ${r.status})` };
  const destino = r.json.deploymentId;
  if (!destino) return { ok: false, motivo: 'la API no indica a qué despliegue apunta' };
  if (retirados.includes(destino)) return { ok: false, motivo: `sigue apuntando al despliegue retirado ${destino}` };
  return { ok: true, otro: destino, motivo: `apunta a otro despliegue (${destino})` };
}

/** El dominio de producción no debe servir la aplicación (404 tras la retirada, o protegido). */
export function evaluarDominioProduccion(r) {
  if (r.status === 404) return { ok: true, motivo: '404: no sirve ningún despliegue' };
  return evaluarRespuestaSinSesion(r);
}

// ───────────────────────────── Ejecución ─────────────────────────────

const env = process.env;
const resumen = (t) => {
  console.log(t);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${t}\n`);
};
class Fallo extends Error {}
const fallar = (m) => {
  throw new Fallo(m);
};

function vc(args, { capturar = false, tolerar = false } = {}) {
  try {
    return execFileSync('npx', ['--yes', env.VERCEL_CLI, ...args, '--non-interactive'], {
      encoding: 'utf8',
      stdio: ['ignore', capturar ? 'pipe' : 'inherit', 'inherit'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    if (tolerar) return null;
    throw e;
  }
}

function crearApi(base, token, equipo) {
  return async (metodo, ruta, cuerpo) => {
    const u = new URL(ruta, base);
    if (equipo) u.searchParams.set('teamId', equipo);
    const r = await fetch(u, {
      method: metodo,
      headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const texto = await r.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      /* respuesta no JSON */
    }
    return { status: r.status, json };
  };
}

async function principal() {
  for (const v of ['PROYECTO', 'DIRECCION_FIJA', 'VERCEL_CLI', 'RAMA_PERMITIDA']) if (!env[v]) fallar(`Falta la variable ${v}.`);
  if (env.GITHUB_REF_NAME !== env.RAMA_PERMITIDA) fallar(`Rama «${env.GITHUB_REF_NAME ?? 'desconocida'}»: solo se despliega desde «${env.RAMA_PERMITIDA}».`);
  if (!env.VERCEL_TOKEN) {
    resumen('⚠️ **No se ha desplegado**: falta el secreto `VERCEL_TOKEN` en el entorno `preview` (Settings → Environments → preview).');
    console.log('::warning::Falta el secreto VERCEL_TOKEN en el entorno preview: no se despliega la vista previa.');
    return 0;
  }
  const retirar = (env.RETIRAR_PRODUCCION ?? '').split(/[\s,]+/).filter(Boolean);
  for (const id of retirar) if (!/^dpl_[A-Za-z0-9]+$/.test(id)) fallar(`Identificador de despliegue no válido en RETIRAR_PRODUCCION: ${id}`);
  const aliasProduccion = (env.ALIAS_PRODUCCION ?? '').split(/[\s,]+/).filter(Boolean);
  for (const a of aliasProduccion) if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/.test(a)) fallar(`Alias no válido en ALIAS_PRODUCCION: ${a}`);

  // 2. Proyecto propio y enlace.
  if (vc(['project', 'inspect', env.PROYECTO], { capturar: true, tolerar: true }) === null) {
    vc(['project', 'create', env.PROYECTO]);
    resumen(`🆕 Proyecto de Vercel creado: \`${env.PROYECTO}\`.`);
  }
  vc(['link', '--yes', '--project', env.PROYECTO]);
  const enlace = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
  const ID = enlace.projectId;
  const api = crearApi(env.VERCEL_API ?? 'https://api.vercel.com', env.VERCEL_TOKEN, String(enlace.orgId ?? '').startsWith('team_') ? enlace.orgId : null);
  const proyecto = await api('GET', `/v9/projects/${ID}`);
  if (proyecto.status !== 200 || proyecto.json?.name !== env.PROYECTO) fallar(`El proyecto enlazado no es ${env.PROYECTO}. No se hace nada.`);

  // Sin barra de herramientas de Vercel (inyectaría scripts de terceros en la página).
  const barra = await api('PATCH', `/v9/projects/${ID}`, { enablePreviewFeedback: false, enableProductionFeedback: false });
  if (barra.status === 200) console.log(`Barra de herramientas de Vercel desactivada en ${env.PROYECTO}`);
  else console.log('::warning::No se ha podido desactivar la barra de herramientas de Vercel; la aplicación lo detectará (huellas) y no habilitará el análisis del Excel real.');

  // 3. Vercel Authentication, confirmada por la API antes de desplegar.
  vc(['project', 'protection', 'enable', env.PROYECTO, '--sso'], { capturar: true, tolerar: true });
  const config = evaluarConfiguracion((await api('GET', `/v9/projects/${ID}`)).json);
  console.log(`${config.ok ? '✔' : '✘'} ${config.motivo}`);
  if (!config.ok) fallar('No se puede confirmar que Vercel Authentication esté activada. No se ha desplegado nada.');

  // 4. Un proyecto sin despliegues recibiría el primero como PRODUCCIÓN: no se despliega.
  const previos = await api('GET', `/v6/deployments?projectId=${ID}&limit=1`);
  if (previos.status !== 200 || !Array.isArray(previos.json?.deployments)) fallar('No se puede consultar la lista de despliegues del proyecto. No se ha desplegado nada.');
  if (previos.json.deployments.length === 0) {
    fallar('El proyecto no tiene ningún despliegue: Vercel asignaría el primero a PRODUCCIÓN. No se ha desplegado nada (ver docs/fase2/PREVIEW-VERCEL.md).');
  }

  // 5. Validación previa de lo que se va a retirar (nada que no sea de este proyecto y de producción).
  const pendientes = [];
  for (const id of retirar) {
    const r = await api('GET', `/v13/deployments/${id}`);
    if (r.status === 404) {
      console.log(`✔ ${id} ya no existe`);
      continue;
    }
    const v = evaluarRetirable(r.status === 200 ? r.json : null, { id, projectId: ID });
    console.log(`${v.ok ? '✔' : '✘'} Retirada prevista: ${v.motivo}`);
    if (!v.ok) fallar(`No se puede retirar ${id} con seguridad: ${v.motivo}. No se ha desplegado nada.`);
    pendientes.push(id);
  }

  const eliminar = async (id) => {
    const r = await api('DELETE', `/v13/deployments/${id}`);
    const despues = await api('GET', `/v13/deployments/${id}`);
    const ok = (r.status === 200 || r.status === 404) && despues.status === 404;
    console.log(`${ok ? '✔' : '✘'} Retirada de ${id}: DELETE ${r.status}, consulta posterior ${despues.status}`);
    return ok;
  };

  // 6. Despliegue con la CLI y verificación del TIPO por la API.
  const extraido = extraerDespliegue(vc(['deploy', '--prebuilt', '--target', 'preview', '--yes'], { capturar: true }));
  const leido = await api('GET', `/v13/deployments/${extraido.id}`);
  const dep = leido.status === 200 ? leido.json : null;
  const tipo = evaluarDespliegueCreado(dep, ID);
  console.log(`${tipo.ok ? '✔' : '✘'} ${tipo.motivo}`);
  if (!tipo.ok) {
    const propio = dep && dep.projectId === ID ? await eliminar(dep.id) : false;
    fallar(`${tipo.motivo}. ${propio ? 'Se ha eliminado' : `NO se ha podido eliminar: retírelo a mano (${extraido.id})`}; no se ha asignado la dirección fija.`);
  }
  const urlDespliegue = env.URL_DESPLIEGUE ?? `https://${dep.url}`;
  resumen(`- Despliegue \`${dep.id}\`: **preview** confirmada por la API.`);

  // 7. Protección del despliegue, sin sesión.
  const prot = await comprobarDireccion(urlDespliegue);
  for (const x of prot.resultados) console.log(`${x.ok ? '✔' : '✘'} ${x.url} → ${x.motivo}`);
  if (!prot.ok) {
    await eliminar(dep.id);
    fallar('El despliegue no está protegido (o no se ha podido confirmar). Se ha eliminado y NO se ha asignado la dirección fija.');
  }

  // 8. Retirada de los despliegues de producción indicados: primero sus alias (solo los que apuntan a ese
  //    despliegue), después el despliegue. Luego, verificación por la API del estado final.
  const aliasVigilados = new Set(aliasProduccion);
  for (const id of pendientes) {
    const suyos = await api('GET', `/v2/deployments/${id}/aliases`);
    if (suyos.status !== 200 || !Array.isArray(suyos.json?.aliases)) fallar(`No se pueden leer los alias de ${id}. No se ha retirado nada ni asignado la dirección fija.`);
    for (const a of suyos.json.aliases) {
      aliasVigilados.add(a.alias);
      const quitado = await api('DELETE', `/v2/aliases/${a.uid ?? a.alias}`);
      console.log(`${quitado.status === 200 || quitado.status === 404 ? '✔' : '✘'} Alias ${a.alias} de ${id}: DELETE ${quitado.status}`);
    }
    if (!(await eliminar(id))) fallar(`No se ha podido confirmar la retirada de ${id}. No se ha asignado la dirección fija.`);
  }
  for (const a of aliasVigilados) {
    const r = await api('GET', `/v4/aliases/${a}`);
    let v = evaluarAliasRetirado(r, retirar);
    if (v.ok && v.otro) {
      const otro = await api('GET', `/v13/deployments/${v.otro}`);
      if (otro.status !== 200 || otro.json?.target === 'production') v = { ok: false, motivo: `apunta a ${v.otro}, que es de producción o no se puede comprobar` };
    }
    console.log(`${v.ok ? '✔' : '✘'} Alias ${a} → ${v.motivo}`);
    if (!v.ok) fallar(`El alias ${a} no está retirado (${v.motivo}). Se detiene sin asignar la dirección fija.`);
  }
  const prod = await api('GET', `/v6/deployments?projectId=${ID}&target=production&limit=100`);
  if (prod.status !== 200 || !Array.isArray(prod.json?.deployments)) fallar('No se puede comprobar que el proyecto no tenga despliegues de producción. No se ha asignado la dirección fija.');
  // (se filtra también aquí por si la API ignorase el filtro; los recién retirados ya dan 404 en la consulta directa)
  const restantes = prod.json.deployments.map((d) => d.uid ?? d.id).filter((id, i) => prod.json.deployments[i].target === 'production' && !pendientes.includes(id));
  if (restantes.length) {
    fallar(`El proyecto tiene despliegues de PRODUCCIÓN no previstos (${restantes.join(', ')}); no se tocan. No se ha asignado la dirección fija.`);
  }
  // Destino de producción del proyecto: no debe quedar ninguno activo.
  const destinoProd = (await api('GET', `/v9/projects/${ID}`)).json?.targets?.production;
  const idDestino = destinoProd?.id ?? destinoProd?.uid;
  if (idDestino) {
    const d = await api('GET', `/v13/deployments/${idDestino}`);
    if (d.status !== 404) fallar(`El proyecto conserva un destino de producción activo (${idDestino}, API ${d.status}). No se ha asignado la dirección fija.`);
  }
  const dominioProd = env.URL_PRODUCCION ?? `https://${env.PROYECTO}.vercel.app`;
  let respProd;
  try {
    const r = await fetch(`${dominioProd}/version.json`, { redirect: 'manual', cache: 'no-store' });
    respProd = evaluarDominioProduccion({ status: r.status, location: r.headers.get('location'), server: r.headers.get('server'), cuerpo: r.status < 300 || r.status >= 400 ? await r.text() : '' });
  } catch (e) {
    respProd = { ok: false, motivo: `no se ha podido comprobar (${e instanceof Error ? e.message : e})` };
  }
  console.log(`${respProd.ok ? '✔' : '✘'} ${dominioProd} → ${respProd.motivo}`);
  if (!respProd.ok) fallar(`El dominio de producción ${dominioProd} sigue sirviendo contenido. No se ha asignado la dirección fija.`);
  resumen(`- Retirados: ${pendientes.length ? pendientes.map((i) => `\`${i}\``).join(', ') : 'nada pendiente'}. Alias verificados por la API: ${[...aliasVigilados].map((a) => `\`${a}\``).join(', ') || '—'}.`);
  resumen('- Proyecto **sin ningún despliegue de producción activo** (comprobado por la API).');

  // 9. Dirección fija, verificada por la API y sin sesión.
  const urlFija = env.URL_FIJA ?? `https://${env.DIRECCION_FIJA}`;
  const quitar = async () => {
    await api('DELETE', `/v2/aliases/${env.DIRECCION_FIJA}`);
    await eliminar(dep.id);
  };
  const asignado = await api('POST', `/v2/deployments/${dep.id}/aliases`, { alias: env.DIRECCION_FIJA });
  const alias = await api('GET', `/v4/aliases/${env.DIRECCION_FIJA}`);
  if (asignado.status !== 200 || alias.status !== 200 || alias.json?.deploymentId !== dep.id) {
    await quitar();
    fallar('No se puede confirmar que la dirección fija apunte a esta preview. Se ha retirado.');
  }
  const fija = await comprobarDireccion(urlFija);
  for (const x of fija.resultados) console.log(`${x.ok ? '✔' : '✘'} ${x.url} → ${x.motivo}`);
  if (!fija.ok) {
    await quitar();
    fallar(`La dirección fija ${urlFija} no está protegida (o no se ha podido confirmar). Se ha retirado. No use esta vista previa.`);
  }

  resumen('✅ **Vista previa protegida** (preview confirmada por la API; sin sesión: solo 401/403 de Vercel o redirección a su inicio de sesión).');
  resumen('');
  resumen(`- Dirección fija: ${urlFija}`);
  resumen(`- Commit: \`${env.GITHUB_SHA ?? '?'}\` · rama \`${env.GITHUB_REF_NAME ?? '?'}\``);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  principal().then(
    (c) => process.exit(c),
    (e) => {
      const m = e instanceof Fallo ? e.message : `Error inesperado: ${e instanceof Error ? e.message : e}`;
      resumen(`❌ **${m}**`);
      console.log(`::error::${m}`);
      process.exit(1);
    },
  );
}
