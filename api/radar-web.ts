import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { extraerEnlacesPublicos } from '../src/domain/radarAnalisisWeb';

const PROYECTO = 'https://ldegybookaubncnayhep.supabase.co';
const ESPACIO = 'real-medina-del-campo-2026';
const LIMITE_BYTES = 300_000;

const respuesta = (status:number, contenido:unknown) => new Response(JSON.stringify(contenido), {
  status, headers: {
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
  },
});

/** Nunca aceptar IPs, localhost, direcciones privadas, credenciales o puertos arbitrarios. */
export function validarDestinoWeb(valor: string): URL {
  let url: URL;
  try { url = new URL(valor); } catch { throw Error('Escribe la dirección completa de una web HTTPS.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      host.length > 253 || host.length < 4 || !host.includes('.') || host.endsWith('.') ||
      isIP(host) || /(^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)) {
    throw Error('Solo se pueden analizar dominios públicos con HTTPS.');
  }
  if (url.href.length > 2000) throw Error('La dirección web es demasiado larga.');
  url.hash = '';
  return url;
}
function ipv4Publica(address:string): boolean {
  const o=address.split('.').map(Number);
  if (o.length!==4 || o.some(v=>!Number.isInteger(v)||v<0||v>255)) return false;
  const [a,b,c]=o;
  return !(a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||
    (a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||
    (a===192&&(b===0||b===168||(b===88&&c===99)))||
    (a===198&&(b===18||b===19||(b===51&&c===100)))||
    (a===203&&b===0&&c===113));
}

async function htmlSeguro(url:URL, saltos=0):Promise<{texto:string;url:string}> {
  if(saltos>2) throw Error('La web redirige demasiadas veces.');
  const ips=await lookup(url.hostname,{all:true,family:4});
  if (!ips.length || ips.some(x=>!ipv4Publica(x.address)))
    throw Error('No se puede comprobar una dirección de red pública segura.');
  const ip=ips[0].address;
  const resultado=await new Promise<{texto?:string;redireccion?:string}>((resolve,reject)=>{
    const req=httpsRequest({
      hostname:url.hostname, servername:url.hostname, port:443,
      path:url.pathname+url.search, method:'GET', timeout:5500,
      lookup:(_host,_opts,cb)=>cb(null,ip,4),
      headers:{
        'user-agent':'ULIT-Censo-Radar/0.1 (manual pilot; public website links)',
        'accept':'text/html,application/xhtml+xml',
        'accept-encoding':'identity',
      },
    },res=>{
      const status=res.statusCode??0;
      if([301,302,303,307,308].includes(status)&&res.headers.location) {
        res.resume();
        resolve({redireccion:res.headers.location});
        return;
      }
      if(status!==200){res.resume();reject(Error('La web respondió con un error HTTP '+status+'.'));return;}
      const tipo=String(res.headers['content-type']??'');
      if(!/text\/html|application\/xhtml\+xml/i.test(tipo)){
        res.resume();reject(Error('La dirección no devuelve una página HTML pública.'));return;
      }
      const chunks:Buffer[]=[];
      let bytes=0;
      res.on('data',(chunk:Buffer)=>{
        bytes+=chunk.length;
        if(bytes>LIMITE_BYTES){
          req.destroy(Error('La página supera el límite de lectura del piloto.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end',()=>resolve({texto:Buffer.concat(chunks).toString('utf8')}));
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('La web tardó demasiado en responder.')));
    req.on('error',reject);
    req.end();
  });
  if(resultado.redireccion){
    const siguiente=validarDestinoWeb(new URL(resultado.redireccion,url).toString());
    return htmlSeguro(siguiente,saltos+1);
  }
  return {texto:resultado.texto??'',url:url.toString()};
}

/** Solo usuarios del equipo de Oficina, verificados por la RPC existente. No requiere service_role. */
async function accesoPermitido(token:string):Promise<boolean> {
  const clave=process.env.VITE_ULIT_CENSO_SUPABASE_CLAVE_PUBLICA;
  const url=process.env.VITE_ULIT_CENSO_SUPABASE_URL;
  if(!clave || !url || new URL(url).origin!==PROYECTO) return false;
  const r=await fetch(PROYECTO+'/rest/v1/rpc/ulit_censo_franquicias_it1_2026',{
    method:'POST',
    headers:{
      'authorization':'Bearer '+token,
      'apikey':clave,
      'content-type':'application/json',
    },
    body:JSON.stringify({
      p_espacio:ESPACIO,p_accion:'estado',p_version_esperada:0,p_ids:[],p_respuesta:null,
    }),
    signal:AbortSignal.timeout(5000),
  });
  if(!r.ok) return false;
  const dato=await r.json() as {habilitada?:boolean;alcance?:string};
  return dato.habilitada===true && dato.alcance==='it1-franquicias-supervisadas';
}

/** Lectura bajo demanda de una ÚNICA URL elegida por el revisor.
 * No consulta buscadores, no rastrea redes, no almacena datos y no escribe en Supabase.
 */
export default async function handler(req:Request):Promise<Response> {
  if(req.method!=='POST') return respuesta(405,{error:'Usa POST.'});
  const token=req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{40,4000})$/)?.[1];
  if(!token) return respuesta(401,{error:'Inicia sesión para analizar una web.'});
  const longitud=Number(req.headers.get('content-length')??'0');
  if(longitud>3000) return respuesta(413,{error:'Solicitud demasiado grande.'});
  let body:unknown;
  try {
    const raw=await req.text();
    if(raw.length>3000) return respuesta(413,{error:'Solicitud demasiado grande.'});
    body=JSON.parse(raw);
  } catch{return respuesta(400,{error:'Solicitud JSON inválida.'});}
  const urlTexto=(body&&typeof body==='object'&&'url' in body)
    ? (body as {url?:unknown}).url:null;
  if(typeof urlTexto!=='string') return respuesta(400,{error:'Falta la dirección web.'});
  let url:URL;
  try{url=validarDestinoWeb(urlTexto);}catch(e){return respuesta(400,{error:e instanceof Error?e.message:'URL inválida.'});}
  try{
    if(!await accesoPermitido(token)) return respuesta(403,{error:'Sin autorización para el piloto de IT1.'});
  }catch{return respuesta(503,{error:'No se pudo verificar la sesión del censo.'});}
  try{
    const {texto,pagina}=await (async()=>{
      const r=await htmlSeguro(url);
      return {texto:r.texto,pagina:r.url};
    })();
    return respuesta(200,{hallazgo:extraerEnlacesPublicos(texto,pagina)});
  }catch(e){return respuesta(422,{error:e instanceof Error?e.message:'No se pudo analizar la página.'});}
}
