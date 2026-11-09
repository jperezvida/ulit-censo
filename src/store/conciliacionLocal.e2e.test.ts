// @vitest-environment node
/**
 * Auth / PostgREST / RPC real contra SUPABASE LOCAL DESECHABLE exclusivamente.
 * Guardas de red: si API o PostgreSQL no son loopback, la prueba aborta antes de operar.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { conciliacionDisponible, guardarDecisionIt1 } from './conciliacionReal';

const URL = process.env.ULIT_CENSO_SUPABASE_LOCAL_URL ?? '';
const PUB = process.env.ULIT_CENSO_SUPABASE_LOCAL_PUBLICA ?? '';
const SEC = process.env.ULIT_CENSO_SUPABASE_LOCAL_SECRETA ?? '';
const DB = process.env.ULIT_CENSO_SUPABASE_LOCAL_PSQL ?? '';
const ESPACIO = 'real-medina-del-campo-2026';
const CAMP26 = 'real-camp-medina-2026-censo-medina-del-campo-2026';
const CAMP25 = 'camp-hist-real-mun-medina-2025-9e367ca51c';
const SHA = '7a6d4230a68370cc0bb0245ce68e8c56648be4d89e76531cc0edbd9ab341da61';
const PASSWORD = 'Local-sintetico-seguro-2026';
const local = (s: string) => {
  try { return ['localhost','127.0.0.1','::1'].includes(new globalThis.URL(s).hostname); }
  catch { return false; }
};
function sql(q: string): string {
  if (!local(URL) || !local(DB)) throw new Error('Se rechaza ejecutar SQL fuera del Supabase LOCAL');
  return execFileSync('psql',[DB,'-v','ON_ERROR_STOP=1','-At','-c',q],{encoding:'utf8'}).trim();
}
async function registrar(tipo: string) {
  const email = `censo-${tipo}-auth-local-${Date.now()}@ejemplo.invalid`;
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method:'POST', headers:{apikey:SEC,Authorization:`Bearer ${SEC}`,'Content-Type':'application/json'},
    body:JSON.stringify({email,password:PASSWORD,email_confirm:true}),
  });
  const j = await r.json() as {id?: string;msg?: string;message?: string};
  if (!r.ok || !j.id || !/^[a-f\d-]{36}$/i.test(j.id)) throw new Error(`No se creó cuenta sintética: ${j.message ?? j.msg ?? r.status}`);
  const client = createClient(URL,PUB,{auth:{persistSession:false,autoRefreshToken:false}});
  const login = await client.auth.signInWithPassword({email,password:PASSWORD});
  if (login.error || !login.data.user) throw new Error(`Supabase Auth no inició sesión: ${login.error?.message}`);
  return {id:j.id,client};
}
function sembrar(ids: {admin:string;revisor:string;otroRevisor:string;lector:string;investigador:string}) {
  sql(`
  insert into ulit_censo.espacio (id,tipo,nombre,version,escritura_habilitada,preparacion_habilitada)
  values ('${ESPACIO}','real','Medina local desechable',4,false,false);
  insert into ulit_censo.miembro(espacio_id,usuario_id,rol,persona_id) values
   ('${ESPACIO}','${ids.admin}','administrador','local-admin'),
   ('${ESPACIO}','${ids.revisor}','revisor','local-revisor'),
   ('${ESPACIO}','${ids.otroRevisor}','revisor','local-revisor'),
   ('${ESPACIO}','${ids.lector}','lector','local-lector'),
   ('${ESPACIO}','${ids.investigador}','investigador','local-investigador');
  insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version) values
   ('${ESPACIO}','_raiz','raiz',
    '{"secuencia":2000,"meta":{"espacio":"real","espacioId":"${ESPACIO}"},"version":12}',4),
   ('${ESPACIO}','campanas','${CAMP25}',
    '{"id":"${CAMP25}","anio":2025,"tipo":"historico-importado"}',4),
   ('${ESPACIO}','campanas','${CAMP26}',
    '{"id":"${CAMP26}","anio":2026,"tipo":"actualizacion","campanaReferenciaId":"${CAMP25}"}',4),
   ('${ESPACIO}','importaciones','imp25',
    '{"id":"imp25","campanaId":"${CAMP25}","estado":"confirmada","tipo":"A-censo-historico"}',4),
   ('${ESPACIO}','importaciones','imp26',
    '{"id":"imp26","campanaId":"${CAMP26}","tipo":"C-excel-itinerario","huella":"${SHA}","estado":"confirmada"}',4),
   ('${ESPACIO}','itinerarios','it1',
    '{"id":"it1","campanaId":"${CAMP26}","codigo":"IT1"}',4),
   ('${ESPACIO}','calles','calle1',
    '{"id":"calle1","nombre":"Calle sintética","municipioId":"real-mun-medina"}',4),
   ('${ESPACIO}','locales','hist-1',
    '{"id":"hist-1","municipioId":"real-mun-medina","direcciones":[{"calleId":"calle1","numero":2}],"estado":"activo","procedencia":"importado"}',4),
   ('${ESPACIO}','observaciones','obs25',
    '{"id":"obs25","campanaId":"${CAMP25}","localId":"hist-1","calleId":"calle1","datos":{"numero":2,"vacio":false,"nombre":"Tienda sintética"}}',4),
   ('${ESPACIO}','negocios','negocio-sintetico',
    '{"id":"negocio-sintetico","nombre":"Negocio sintético","procedencia":"importado"}',4);
  insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
    select '${ESPACIO}','registros','r25-'||n,
      jsonb_build_object('id','r25-'||n,'importacionId','imp25','fila',n),4 from generate_series(1,889) n;
  insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
    select '${ESPACIO}','registros','r26-'||n,
      jsonb_build_object('id','r26-'||n,'importacionId','imp26','itinerarioId','it1','fila',n),4 from generate_series(2,106) n;
  insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
    select '${ESPACIO}','vinculos','vin-r26-'||n,
      jsonb_build_object('id','vin-r26-'||n,
       'origen',jsonb_build_object('tipo','registro','id','r26-'||n),
       'localId',case when n<=92 then 'null'::jsonb else to_jsonb('local26-'||n) end,
       'confianza',case when n<=92 then 'sin-vinculo' else 'confirmada' end,'criterio','IT1'),4
       from generate_series(2,106) n;
  insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version)
    select '${ESPACIO}','observaciones','obs26-'||n,
      jsonb_build_object('id','obs26-'||n,'campanaId','${CAMP26}',
       'itinerarioId','it1','registroId','r26-'||n,
       'localId',null,'calleId','calle1',
       'datos',jsonb_build_object('numero',case when n>60 then null else n end,
          'vacio',false,'negocioId','negocio-sintetico','nombre','Sintética '||n)),4 from generate_series(2,62) n;
  `);
}
describe.skipIf(!URL)('IT1 RPC con Supabase Auth + PostgREST (solo datos sintéticos locales)', () => {
  const clients: Record<string, SupabaseClient> = {};
  beforeAll(async () => {
    if (!local(URL) || !local(DB) || !PUB || !SEC) throw new Error('Auth E2E: se exige Supabase LOCAL con claves locales');
    const entries = await Promise.all(['admin','revisor','otroRevisor','lector','investigador','noMiembro'].map(async k => [k,await registrar(k)] as const));
    const ids: Record<string,string> = {};
    for (const [k,obj] of entries) { ids[k]=obj.id; clients[k]=obj.client; }
    sembrar({admin:ids.admin,revisor:ids.revisor,otroRevisor:ids.otroRevisor,lector:ids.lector,investigador:ids.investigador});
  },90000);

  it('autorización real: solo miembros revisor/coordinador/admin tienen RPC; anónimo y lector no', async () => {
    const anon=createClient(URL,PUB,{auth:{persistSession:false}});
    const deniedAnon=await anon.rpc('ulit_censo_conciliar_it1_2026',{
      p_espacio:ESPACIO,p_version_esperada:4,p_registro_id:'',p_accion:'estado',
    });
    expect(deniedAnon.error).toBeTruthy();
    for (const k of ['lector','investigador','noMiembro']) {
      const denied=await clients[k].rpc('ulit_censo_conciliar_it1_2026',{
        p_espacio:ESPACIO,p_version_esperada:4,p_registro_id:'',p_accion:'estado',
      });
      expect(denied.error?.code).toBe('42501');
    }
    expect(await conciliacionDisponible(clients.revisor,4)).toBe(true);
    expect(await conciliacionDisponible(clients.admin,4)).toBe(true);
    expect((await clients.revisor.schema('ulit_censo' as never).from('entidad').select('id')).error).toBeTruthy();
  });

  it('después de sesión auténtica: historial, copia, bloqueo general y versión PT409', async () => {
    await expect(guardarDecisionIt1(clients.revisor,{
      versionEsperada:4,registroId:'r25-2',accion:'mantener-pendiente',motivo:'Sin vínculo en histórico'})).rejects.toThrow();
    await expect(guardarDecisionIt1(clients.revisor,{
      versionEsperada:3,registroId:'r26-2',accion:'mantener-pendiente',motivo:'Pendiente por revisar'})).rejects.toThrow();
    const first=await guardarDecisionIt1(clients.revisor,{
      versionEsperada:4,registroId:'r26-2',accion:'vincular',localId:'hist-1',motivo:'Mismo local comprobado personalmente'});
    expect(first.version).toBe(5);
    await expect(guardarDecisionIt1(clients.revisor,{
      versionEsperada:4,registroId:'r26-3',accion:'mantener-pendiente',motivo:'Revisión por completar'})).rejects.toThrow(/Otra pestaña/);
    const info=sql(`select version||':'||escritura_habilitada from ulit_censo.espacio where id='${ESPACIO}'`);
    expect(info).toBe('5:false');
    expect(sql("select count(*) from ulit_censo.entidad where coleccion='registros'")).toBe('994');
    expect(sql("select count(*) from ulit_censo.copia where version=4")).toBe('1');
    expect(sql("select count(*) from ulit_censo.entidad_historial h where h.coleccion='observaciones' and h.id='obs25'")).toBe('0');
    const forbidden=await clients.revisor.rpc('ulit_censo_aplicar',{
      p_espacio:ESPACIO,p_version_esperada:5,p_etiqueta:'Intento no autorizado',
      p_cambios:[{c:'registros',id:'r26-2',v:null}],
    });
    expect(forbidden.error?.code).toBe('42501');
    // Otra cuenta con el MISMO persona_id no puede deshacer lo hecho por el revisor.
    await expect(guardarDecisionIt1(clients.otroRevisor, {
      versionEsperada:5, registroId:'r26-2', accion:'deshacer',
      motivo:'Otro usuario no puede revertir la decisión',
    })).rejects.toThrow(/un revisor no puede deshacer/);
    const reverse=await guardarDecisionIt1(clients.revisor,{
      versionEsperada:5,registroId:'r26-2',accion:'deshacer',motivo:'Revertir vinculación comprobada',
    });
    expect(reverse.version).toBe(6);
    expect(sql("select valor->>'localId' from ulit_censo.entidad where coleccion='vinculos' and id='vin-r26-2'")).toBe('');
    expect(sql(`select version||':'||escritura_habilitada from ulit_censo.espacio where id='${ESPACIO}'`)).toBe('6:false');
    // Integración negativa real PostgREST: un ocupado sin negocio válido
    // no puede crear un local/ocupación ni variar la versión del espacio.
    sql("update ulit_censo.entidad set valor=jsonb_set(valor,'{datos}',(valor->'datos')-'negocioId') where coleccion='observaciones' and id='obs26-3'");
    await expect(guardarDecisionIt1(clients.revisor,{
      versionEsperada:6,registroId:'r26-3',accion:'local-nuevo',
      motivo:'Prueba de ocupación sin negocio existente'})).rejects.toThrow(/incoherencia/);
    expect(sql(`select version||':'||escritura_habilitada from ulit_censo.espacio where id='${ESPACIO}'`)).toBe('6:false');
  });
});
