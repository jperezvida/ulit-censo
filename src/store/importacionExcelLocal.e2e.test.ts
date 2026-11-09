// @vitest-environment node
// Auth + PostgREST reales SOLO sobre la instalación local desechable.
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { consultarCapacidadExcel } from './importacionExcelReal';
const URL=process.env.ULIT_CENSO_SUPABASE_LOCAL_URL??'';
const PUB=process.env.ULIT_CENSO_SUPABASE_LOCAL_PUBLICA??'';
const SEC=process.env.ULIT_CENSO_SUPABASE_LOCAL_SECRETA??'';
const DB=process.env.ULIT_CENSO_SUPABASE_LOCAL_PSQL??'';
const ESP='real-medina-del-campo-2026', CAMP='real-camp-medina-2026-censo-medina-del-campo-2026';
const SHA='a'.repeat(64), PASSWORD='Solo-para-pruebas-locales-2026';
const esLocal=(u:string)=>{try{return ['localhost','127.0.0.1','::1'].includes(new globalThis.URL(u).hostname);}catch{return false;}};
const sql=(query:string)=>{if(!esLocal(URL)||!esLocal(DB))throw new Error('Prohibida escritura fuera de Supabase local');
  return execFileSync('psql',[DB,'-v','ON_ERROR_STOP=1','-At','-c',query],{encoding:'utf8'}).trim();};
async function crearUsuario(rol:string){
  const email=`it2-${rol}-${Date.now()}@ejemplo.invalid`;
  const response=await fetch(`${URL}/auth/v1/admin/users`,{
    method:'POST',headers:{apikey:SEC,Authorization:`Bearer ${SEC}`,'Content-Type':'application/json'},
    body:JSON.stringify({email,password:PASSWORD,email_confirm:true})});
  const user=await response.json() as {id?:string;message?:string};
  if(!response.ok||!user.id)throw new Error(user.message??'GoTrue no creó usuario local');
  const cliente=createClient(URL,PUB,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await cliente.auth.signInWithPassword({email,password:PASSWORD});
  if(login.error)throw login.error;
  return {id:user.id,cliente};
}
const cambios=[
  {c:'itinerarios',id:'real-it-it2',v:{id:'real-it-it2',campanaId:CAMP,codigo:'IT2',origen:'excel'}},
  {c:'importaciones',id:'imp-it2',v:{id:'imp-it2',campanaId:CAMP,municipioId:'real-mun-medina',
    tipo:'C-excel-itinerario',estado:'confirmada',huella:SHA,filas:2,c1:{sha256:SHA,anio:2026,itinerario:{id:'real-it-it2',codigo:'IT2'}}}},
  {c:'registros',id:'r26-2',v:{id:'r26-2',fila:2,importacionId:'imp-it2',itinerarioId:'real-it-it2',datos:{'Dirección':'Calle ficticia','Número':'9','Negocio':'Panadería de prueba'}}},
  {c:'registros',id:'r26-3',v:{id:'r26-3',fila:3,importacionId:'imp-it2',itinerarioId:'real-it-it2',datos:{'Dirección':'Calle ficticia','Número':'11','Negocio':'Librería de prueba'}}},
  {c:'vinculos',id:'vin-r26-2',v:{id:'vin-r26-2',origen:{tipo:'registro',id:'r26-2'},localId:null,confianza:'sin-vinculo',criterio:'Sin correspondencia automática'}},
  {c:'vinculos',id:'vin-r26-3',v:{id:'vin-r26-3',origen:{tipo:'registro',id:'r26-3'},localId:null,confianza:'sin-vinculo',criterio:'Sin correspondencia automática'}},
];
describe.skipIf(!URL)('IT2 con Supabase Auth y PostgREST LOCALES',()=>{
  const users:Record<string,SupabaseClient>={};
  beforeAll(async()=>{
    if(!esLocal(URL)||!esLocal(DB)||!PUB||!SEC)throw new Error('Falta entorno local protegido');
    sql(`insert into ulit_censo.espacio(id,tipo,nombre,version,escritura_habilitada,preparacion_habilitada)
       values ('${ESP}','real','Medina sintética',4,false,false);
      insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version) values
       ('${ESP}','_raiz','raiz','{"version":11,"secuencia":400,"meta":{"espacio":"real","espacioId":"${ESP}"},"colaSync":[]}',4),
       ('${ESP}','campanas','${CAMP}','{"id":"${CAMP}","tipo":"actualizacion","anio":2026}',4),
       ('${ESP}','campanas','hist-2025','{"id":"hist-2025","tipo":"historico-importado","anio":2025}',4),
       ('${ESP}','registros','hist-registro','{"id":"hist-registro","datos":{"nombre":"Histórico intacto"}}',4);`);
    for(const rol of ['admin','revisor']){
      const u=await crearUsuario(rol);
      users[rol]=u.cliente;
      sql(`insert into ulit_censo.miembro(espacio_id,usuario_id,rol,persona_id)
        values ('${ESP}','${u.id}','${rol==='admin'?'administrador':'revisor'}','persona-${rol}')`);
    }
  },90000);
  it('deniega anónimo y revisor con sesión válida',async()=>{
    const params={p_espacio:ESP,p_version_esperada:4,p_codigo:'IT2',p_sha:SHA,p_parte_adicional:false,p_cambios:cambios};
    const anon=createClient(URL,PUB,{auth:{persistSession:false}});
    expect((await anon.rpc('ulit_censo_importar_excel_2026',params)).error).toBeTruthy();
    expect((await users.revisor.rpc('ulit_censo_importar_excel_2026',params)).error?.code).toBe('42501');
    expect(await consultarCapacidadExcel(users.revisor)).toBeNull();
    expect((await consultarCapacidadExcel(users.admin))?.habilitada).toBe(true);
  });
  it('importa 2 filas pendientes y deja histórico y escritura intactos',async()=>{
    const r=await users.admin.rpc('ulit_censo_importar_excel_2026',{
      p_espacio:ESP,p_version_esperada:4,p_codigo:'IT2',p_sha:SHA,p_parte_adicional:false,p_cambios:cambios});
    if(r.error)throw new Error(`${r.error.code} ${r.error.message}`);
    expect(r.data).toMatchObject({version:5,filas:2,itinerario:'IT2'});
    expect(sql(`select version||':'||escritura_habilitada from ulit_censo.espacio where id='${ESP}'`)).toBe('5:false');
    expect(sql("select count(*) from ulit_censo.entidad where coleccion='registros' and valor->>'importacionId'='imp-it2'")).toBe('2');
    expect(sql("select valor->'datos'->>'nombre' from ulit_censo.entidad where id='hist-registro'")).toBe('Histórico intacto');
    expect(sql("select count(*) from ulit_censo.copia where version=4")).toBe('1');
  });
  it('impide reintentar tras commit y reutilizar SHA',async()=>{
    const params={p_espacio:ESP,p_codigo:'IT2',p_sha:SHA,p_parte_adicional:false,p_cambios:cambios};
    expect((await users.admin.rpc('ulit_censo_importar_excel_2026',{...params,p_version_esperada:4})).error?.code).toBe('PT409');
    expect((await users.admin.rpc('ulit_censo_importar_excel_2026',{...params,p_version_esperada:5})).error?.code).toBe('42501');
    expect(sql(`select version||':'||escritura_habilitada from ulit_censo.espacio where id='${ESP}'`)).toBe('5:false');
  });
});
