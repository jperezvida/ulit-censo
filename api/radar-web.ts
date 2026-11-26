import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { analizarPagina } from '../src/domain/radarAnalisisWeb';
import {
  lugaresDesdeNominatim, marcaDesdeWikidata, type ContextoNegocio, type MarcaWikidata,
} from '../src/domain/radarInvestigacion';

const PROYECTO = 'https://ldegybookaubncnayhep.supabase.co';
const ESPACIO = 'real-medina-del-campo-2026';
const LIMITE_BYTES = 300_000;
const AGENTE = 'ULIT-Censo-Radar/0.2 (investigacion asistida de comercios; contacto via ULIT Censo)';
/** Cada petición debe terminar holgadamente dentro del límite de una función de Vercel. */
const PLAZO_MS = 8000;

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
      path:url.pathname+url.search, method:'GET', timeout:4000,
      lookup:(_host,_opts,cb)=>cb(null,ip,4),
      headers:{
        'user-agent':AGENTE,
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

function conPlazo<T>(p:Promise<T>,ms:number,mensaje:string):Promise<T> {
  let temporizador:ReturnType<typeof setTimeout>|undefined;
  return Promise.race([p,new Promise<never>((_,reject)=>{temporizador=setTimeout(()=>reject(Error(mensaje)),ms);})])
    .finally(()=>clearTimeout(temporizador));
}
const texto=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max?v.trim():null;

/**
 * Lugares de OpenStreetMap con ese nombre en el municipio, vía Nominatim (datos abiertos ODbL,
 * sin clave ni coste). Overpass no es accesible desde la red de Vercel (comprobado: tiempo agotado
 * en 4 servidores). Política de Nominatim: agente identificado y ≤1 petición/s (lo espacia el
 * cliente) con resultados guardados 30 días.
 */
async function lugaresNominatim(nombre:string, municipio:string, provincia?:string) {
  const u=new URL('https://nominatim.openstreetmap.org/search');
  u.search=new URLSearchParams({q:[nombre,municipio,provincia].filter(Boolean).join(', '),format:'jsonv2',
    extratags:'1',addressdetails:'1',limit:'5',countrycodes:'es','accept-language':'es'}).toString();
  const r=await fetch(u,{headers:{'user-agent':AGENTE},signal:AbortSignal.timeout(PLAZO_MS/2)});
  if(!r.ok) throw Error('OpenStreetMap (Nominatim) no está disponible ahora mismo ('+r.status+').');
  return lugaresDesdeNominatim(await r.json(),municipio);
}

/** Cuentas oficiales de marcas (P856, P2003, P2013, P2002) en Wikidata. */
async function marcasWikidata(ids:string[]):Promise<MarcaWikidata[]> {
  const r=await fetch('https://www.wikidata.org/w/api.php?action=wbgetentities&props=claims&format=json&ids='
    +ids.join('|'),{headers:{'user-agent':AGENTE},signal:AbortSignal.timeout(PLAZO_MS)});
  if(!r.ok) throw Error('Wikidata no está disponible ahora mismo ('+r.status+').');
  const d=await r.json() as {entities?:Record<string,unknown>};
  return ids.map(id=>marcaDesdeWikidata(id,d.entities?.[id])).filter((m):m is MarcaWikidata=>!!m);
}

/**
 * Radar Digital (solo equipo de Oficina, verificado por RPC; sin service_role ni escritura):
 * - `paginas`: lee hasta 4 webs HTTPS públicas y devuelve los enlaces que ellas mismas publican.
 * - `osm`: lugares del municipio en OpenStreetMap. - `marcas`: cuentas oficiales en Wikidata.
 * No consulta buscadores, no rastrea redes sociales, no almacena nada.
 */
export default async function handler(req:Request):Promise<Response> {
  if(req.method!=='POST') return respuesta(405,{error:'Usa POST.'});
  const token=req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]{40,4000})$/)?.[1];
  if(!token) return respuesta(401,{error:'Inicia sesión para usar el Radar Digital.'});
  const longitud=Number(req.headers.get('content-length')??'0');
  if(longitud>6000) return respuesta(413,{error:'Solicitud demasiado grande.'});
  let body:Record<string,unknown>;
  try {
    const raw=await req.text();
    if(raw.length>6000) return respuesta(413,{error:'Solicitud demasiado grande.'});
    const parsed:unknown=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw Error();
    body=parsed as Record<string,unknown>;
  } catch{return respuesta(400,{error:'Solicitud JSON inválida.'});}
  const accion=body.accion??'paginas';

  // Validar la entrada ANTES de consultar la sesión: nada inválido llega a la red.
  let tarea:()=>Promise<Response>;
  if(accion==='osm'){
    const nombreValido=(v:string|null)=>!!v&&/^[\p{L}][\p{L} .'-]{1,59}$/u.test(v);
    const municipio=texto(body.municipio,60);
    const provincia=body.provincia===undefined?undefined:texto(body.provincia,60);
    const nombre=texto(body.nombre,200);
    if(!nombreValido(municipio)) return respuesta(400,{error:'Municipio no válido.'});
    if(provincia!==undefined&&!nombreValido(provincia)) return respuesta(400,{error:'Provincia no válida.'});
    if(!nombre||nombre.length<2) return respuesta(400,{error:'Falta el nombre del negocio.'});
    tarea=async()=>respuesta(200,{lugares:await lugaresNominatim(nombre,municipio!,provincia??undefined)});
  } else if(accion==='marcas'){
    const ids=Array.isArray(body.ids)?body.ids.filter((x):x is string=>typeof x==='string'&&/^Q\d{1,10}$/.test(x)):[];
    if(!ids.length||ids.length>40) return respuesta(400,{error:'Indica entre 1 y 40 marcas.'});
    tarea=async()=>respuesta(200,{marcas:await marcasWikidata([...new Set(ids)])});
  } else if(accion==='paginas'){
    const lista=Array.isArray(body.urls)?body.urls:[];
    if(!lista.length||lista.length>4||lista.some(u=>typeof u!=='string')) return respuesta(400,{error:'Indica entre 1 y 4 webs.'});
    let urls:URL[];
    try{urls=(lista as string[]).map(validarDestinoWeb);}
    catch(e){return respuesta(400,{error:e instanceof Error?e.message:'URL inválida.'});}
    const c=(body.contexto??{}) as Record<string,unknown>;
    const ctx:ContextoNegocio={nombre:texto(c.nombre,200)??'',calle:texto(c.calle,200)??'',municipio:texto(c.municipio,60)??''};
    tarea=async()=>{
      const resultados=await Promise.allSettled(urls.map(url=>conPlazo(htmlSeguro(url),PLAZO_MS,'La web tardó demasiado en responder.')
        .then(r=>analizarPagina(r.texto,r.url,ctx,url.toString()))));
      return respuesta(200,{resultados:resultados.map((r,i)=>r.status==='fulfilled'
        ?{url:urls[i].toString(),pagina:r.value}
        :{url:urls[i].toString(),error:r.reason instanceof Error?r.reason.message:'No se pudo analizar la página.'})});
    };
  } else return respuesta(400,{error:'Acción desconocida.'});

  try{
    if(!await accesoPermitido(token)) return respuesta(403,{error:'Sin autorización para el Radar Digital de IT1.'});
  }catch{return respuesta(503,{error:'No se pudo verificar la sesión del censo.'});}
  try{return await tarea();}
  catch(e){return respuesta(502,{error:e instanceof Error?e.message:'La fuente no respondió.'});}
}
