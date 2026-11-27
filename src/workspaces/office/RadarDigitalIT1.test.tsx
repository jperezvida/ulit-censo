import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import RadarDigitalIT1 from './RadarDigitalIT1';
import { RITMO_RADAR } from '../../domain/radarInvestigacion';

vi.mock('../../store/clienteSupabase',()=>({
  clienteServidor:vi.fn(()=>({auth:{getSession:async()=>({data:{session:{access_token:'test-jwt'}}})}})),
}));
function fixture(){
  const db=baseVacia();
  db.municipios.medina={id:'medina',nombre:'Medina del Campo',provincia:'Valladolid',fuenteCallejero:'simulado'};
  db.campanas.c26={id:'c26',municipioId:'medina',anio:2026,nombre:'Censo 2026',tipo:'actualizacion',
    periodo:{inicio:'2026-01-01'},ambitoCalleIds:[],ampliacionCalleIds:[],
    estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},procedencia:'importado'};
  db.itinerarios.it1={id:'it1',campanaId:'c26',codigo:'IT1',nombre:'IT1',origen:'excel',color:'#123',tramos:[],asignadosIds:[],creado:'2026-10-01'};
  db.importaciones.imp={id:'imp',campanaId:'c26',municipioId:'medina',tipo:'C-excel-itinerario',archivo:'it1.xlsx',
    huella:'abc',fecha:'2026-10-01',filas:12,estado:'confirmada',resumen:{},procedencia:'importado'};
  for(let i=1;i<=12;i++){
    db.registros['reg'+i]={id:'reg'+i,importacionId:'imp',itinerarioId:'it1',
      fila:i+1,datos:{'Nombre del negocio':i===12?'':'Comercio ficticio '+i,
      'Local Vacío':i===12?'1':'0','Dirección':'Calle Inventada','Num':'4','web':i===1?'0':'',
      'Google My Bussines':'1'}};
  }
  return db;
}
let db=fixture();
function Pantalla(){
  return <FuenteOficinaContext.Provider value={{
    db,campanaId:'c26',personaId:'revisor',roles:['coordinador'],
    soloLectura:true,aplicar:()=>{throw Error('El Radar no debe escribir en el censo');},versionReal:20,
  }}><MemoryRouter><RadarDigitalIT1/></MemoryRouter></FuenteOficinaContext.Provider>;
}
/** Servidor simulado: OpenStreetMap, Wikidata y webs ficticias. */
let marcas:number[]=[];
function servidor(){
  marcas=[];
  return vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
    marcas.push(Date.now());
    const cuerpo=JSON.parse(String(init?.body));
    const json=(d:unknown)=>new Response(JSON.stringify(d),{status:200,headers:{'content-type':'application/json'}});
    if(cuerpo.accion==='osm') return json({lugares:[
      {id:'node/1',nombre:'Comercio ficticio 1',calle:'Calle Inventada',numero:'4',
        web:'https://comercio-ficticio-1.es/',instagram:'https://www.instagram.com/ficticio1'},
      {id:'node/2',nombre:'Comercio ficticio 2',instagram:'https://www.instagram.com/ficticio2'},
      {id:'node/3',nombre:'Comercio ficticio 3',calle:'C/ Inventada',instagram:'https://www.instagram.com/ficticio3'},
    ]});
    if(cuerpo.accion==='paginas') return json({resultados:cuerpo.urls.map((u:string)=>u==='https://comercio-ficticio-1.es/'
      ?{url:u,pagina:{url:u,solicitada:u,menciones:['nombre','municipio'],
        redes:{facebook:'https://www.facebook.com/ficticio1'},fichaGoogle:'https://maps.app.goo.gl/Ficticio1',indiciosVenta:[]}}
      :{url:u,error:'No se puede comprobar una dirección de red pública segura.'})});
    return json({marcas:[]});
  });
}
const trabajo=()=>JSON.parse(localStorage.getItem('ulit-censo-radar-trabajo-v2:c26')??'{}');
const fila=(n:number)=>within(screen.getByRole('navigation',{name:'Negocios del piloto'}))
  .getByRole('button',{name:new RegExp(`^Comercio ficticio ${n} Calle`)});
const foco=()=>screen.getByRole('region',{name:'Investigación del establecimiento'});
async function investigarTodo(){
  render(<Pantalla/>);
  fireEvent.click(screen.getByRole('button',{name:'Investigar 10 automáticamente'}));
  await waitFor(()=>expect(screen.getByText(/Investigación terminada/)).toBeInTheDocument());
}

beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();db=fixture();RITMO_RADAR.nominatimMs=15;});
describe('Radar Digital IT1 · bandeja de investigación automática',()=>{
  it('antes de investigar: 10 negocios, valores del Excel visibles y búsqueda manual preparada',()=>{
    render(<Pantalla/>);
    expect(screen.getAllByRole('button',{name:/^Comercio ficticio \d+ Calle/})).toHaveLength(10);
    expect(screen.getByRole('button',{name:/10 Sin investigar/})).toBeInTheDocument();
    const filaWeb=within(foco()).getAllByRole('row')[1];
    expect(filaWeb).toHaveTextContent('Web oficial');
    expect(filaWeb).toHaveTextContent('No');
    expect(within(filaWeb).getByRole('link',{name:/^Buscar Web/})).toHaveAttribute('href',expect.stringContaining('google.com/search?q='));
  });

  it('investiga en lote, clasifica en bandejas y no escribe nada en el censo',async()=>{
    const red=servidor();
    const original=JSON.stringify(db.registros);
    await investigarTodo();
    const acciones=red.mock.calls.map(([,init])=>JSON.parse(String(init?.body)).accion);
    // Una consulta a OpenStreetMap por negocio, espaciadas ≥1,1 s (política de Nominatim).
    expect(acciones.filter(a=>a==='osm')).toHaveLength(10);
    const tiempos=red.mock.calls.flatMap(([,init],i)=>JSON.parse(String(init?.body)).accion==='osm'?[marcas[i]]:[]);
    for(let i=1;i<tiempos.length;i++) expect(tiempos[i]-tiempos[i-1]).toBeGreaterThanOrEqual(14);
    expect(acciones.filter(a=>a==='paginas')).toHaveLength(10);
    // 1: web relacionada pero el Excel dice No · 2: Instagram sin calle · 3: Instagram con nombre y calle.
    expect(screen.getByRole('button',{name:/^1 Listos para confirmar/})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:/^2 Requieren intervención/})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:/^7 Sin evidencias automáticas/})).toBeInTheDocument();
    expect(JSON.stringify(db.registros)).toBe(original);
  });

  it('muestra procedencia verificable y criterios; Enter confirma solo lo relacionado, avanza y se deshace con Z',async()=>{
    servidor();
    await investigarTodo();
    fireEvent.click(fila(1));
    const web=within(foco()).getAllByRole('row')[1];
    expect(web).toHaveTextContent('Probablemente relacionado');
    expect(web).toHaveTextContent('Mismo nombre');
    expect(web).toHaveTextContent('Misma calle');
    expect(web).toHaveTextContent('Discrepa del Excel');
    expect(within(web).getByRole('link',{name:/OpenStreetMap/})).toHaveAttribute('href','https://www.openstreetmap.org/node/1');
    expect(within(web).getByRole('link',{name:/Web analizada/})).toHaveAttribute('href','https://comercio-ficticio-1.es/');
    expect(within(foco()).getByRole('button',{name:/Confirmar 4 relacionadas y siguiente/})).toBeInTheDocument();
    fireEvent.keyDown(document.body,{key:'Enter'});
    expect(trabajo().reg1).toMatchObject({estado:'revisado',decisiones:{
      web:{valor:'si',url:'https://comercio-ficticio-1.es/'},
      instagram:{valor:'si',url:'https://www.instagram.com/ficticio1'},
      facebook:{valor:'si',url:'https://www.facebook.com/ficticio1'},
      googleBusiness:{valor:'si',url:'https://maps.app.goo.gl/Ficticio1'},
    }});
    // Nunca convierte «sin coincidencias» en «No».
    expect(trabajo().reg1.decisiones.twitter).toBeUndefined();
    expect(within(foco()).getByRole('heading',{level:2})).not.toHaveTextContent(/^Comercio ficticio 1$/);
    expect(screen.getByRole('status',{name:'Progreso del piloto'})).toHaveTextContent('1 de 10 revisados');
    fireEvent.keyDown(document.body,{key:'z'});
    expect(trabajo().reg1).toMatchObject({estado:'pendiente',decisiones:{}});
    expect(within(foco()).getByRole('heading',{level:2})).toHaveTextContent('Comercio ficticio 1');
  });

  it('una coincidencia débil exige intervención; se puede descartar y no vuelve a proponerse',async()=>{
    servidor();
    await investigarTodo();
    fireEvent.click(fila(2));
    const ig=within(foco()).getAllByRole('row')[3];
    expect(ig).toHaveTextContent('Encontrado · comprobar');
    expect(ig).toHaveTextContent('Falta la calle o el municipio');
    // Enter no da por revisado un negocio con coincidencias sin decidir.
    expect(within(foco()).getByRole('button',{name:/Quedan 1 por comprobar/})).toBeInTheDocument();
    fireEvent.keyDown(document.body,{key:'Enter'});
    expect(screen.getByText(/Quedan 1 coincidencias por comprobar/)).toBeInTheDocument();
    expect(within(foco()).getByRole('heading',{level:2})).toHaveTextContent('Comercio ficticio 2');
    expect(trabajo().reg2?.estado).not.toBe('revisado');
    fireEvent.click(within(ig).getByRole('button',{name:'Instagram: la coincidencia no corresponde'}));
    expect(within(foco()).getAllByRole('row')[3]).toHaveTextContent('Descartado');
    expect(trabajo().reg2.descartadas).toEqual(['instagram|https://www.instagram.com/ficticio2']);
    fireEvent.keyDown(document.body,{key:'Enter'});
    expect(trabajo().reg2.estado).toBe('revisado');
    expect(within(foco()).getByRole('heading',{level:2})).not.toHaveTextContent(/^Comercio ficticio 2$/);
  });

  it('teclas 1–6: confirma una propuesta, pero sin propuesta BUSCA en vez de inventar «No tiene»',async()=>{
    servidor();
    await investigarTodo();
    fireEvent.click(fila(2));
    fireEvent.keyDown(document.body,{key:'3'});
    expect(trabajo().reg2.decisiones.instagram).toMatchObject({valor:'si',url:'https://www.instagram.com/ficticio2'});
    const abrir=vi.spyOn(window,'open').mockImplementation(()=>null);
    fireEvent.keyDown(document.body,{key:'5'});
    expect(abrir).toHaveBeenCalledWith(
      'https://www.google.com/search?q='+encodeURIComponent('Comercio ficticio 2 twitter'),
      '_blank','noopener,noreferrer');
    expect(trabajo().reg2.decisiones.twitter).toBeUndefined();
    expect(screen.getByText(/sin propuesta que confirmar/)).toBeInTheDocument();
    fireEvent.click(within(within(foco()).getAllByRole('row')[5])
      .getByRole('button',{name:'X / Twitter: comprobado que no tiene'}));
    expect(trabajo().reg2.decisiones.twitter).toMatchObject({valor:'no'});
    fireEvent.keyDown(document.body,{key:'5'});
    expect(trabajo().reg2.decisiones.twitter).toBeUndefined();
  });

  it('pegar un enlace lo asigna a su campo como candidato SIN validar; se confirma con su número',()=>{
    render(<Pantalla/>);
    const evento=new Event('paste',{bubbles:true,cancelable:true}) as Event & {clipboardData:unknown};
    evento.clipboardData={getData:()=>'https://www.facebook.com/comercio.ficticio1?ref=bookmarks'};
    act(()=>{document.body.dispatchEvent(evento);});
    expect(trabajo().reg1.decisiones.facebook).toBeUndefined();
    expect(trabajo().reg1.manuales.facebook).toBe('https://www.facebook.com/comercio.ficticio1');
    expect(screen.getByText(/candidato sin validar/)).toBeInTheDocument();
    const fb=within(foco()).getAllByRole('row')[4];
    expect(fb).toHaveTextContent('Encontrado · comprobar');
    expect(fb).toHaveTextContent('Aportado por ti');
    fireEvent.keyDown(document.body,{key:'4'});
    expect(trabajo().reg1.decisiones.facebook).toMatchObject({valor:'si',url:'https://www.facebook.com/comercio.ficticio1',manual:true});
    const campo=screen.getByPlaceholderText(/Pega aquí/);
    fireEvent.change(campo,{target:{value:'javascript:alert(1)'}});
    fireEvent.keyDown(campo,{key:'Enter'});
    expect(screen.getByText(/no es un enlace HTTPS/)).toBeInTheDocument();
    expect(Object.keys(trabajo().reg1.decisiones)).toEqual(['facebook']);
  });

  it('una cuenta de twitter.com pegada se reconoce como X y queda pendiente de comprobar',()=>{
    render(<Pantalla/>);
    const evento=new Event('paste',{bubbles:true,cancelable:true}) as Event & {clipboardData:unknown};
    evento.clipboardData={getData:()=>'https://twitter.com/HeladeriaFicticia'};
    act(()=>{document.body.dispatchEvent(evento);});
    expect(trabajo().reg1.manuales.twitter).toBe('https://x.com/HeladeriaFicticia');
    expect(trabajo().reg1.decisiones.twitter).toBeUndefined();
  });

  it('búsquedas manuales: amplia (nombre + plataforma) y específica (plataforma + municipio) en cada red',()=>{
    render(<Pantalla/>);
    const x=within(foco()).getAllByRole('row')[5];
    expect(decodeURIComponent(within(x).getByRole('link',{name:/^Buscar X/}).getAttribute('href')!)).toContain('q=Comercio ficticio 1 twitter');
    expect(decodeURIComponent(within(x).getByRole('link',{name:/específica/}).getAttribute('href')!)).toContain('(site:twitter.com OR site:x.com)');
  });

  it('pegar la web de un negocio la analiza al momento y propone las redes que enlaza',async()=>{
    servidor();
    render(<Pantalla/>);
    const evento=new Event('paste',{bubbles:true,cancelable:true}) as Event & {clipboardData:unknown};
    evento.clipboardData={getData:()=>'https://comercio-ficticio-1.es/'};
    act(()=>{document.body.dispatchEvent(evento);});
    expect(trabajo().reg1.manuales.web).toBe('https://comercio-ficticio-1.es/');
    await waitFor(()=>expect(within(foco()).getAllByRole('row')[4]).toHaveTextContent('Probablemente relacionado'));
    expect(within(foco()).getAllByRole('row')[4]).toHaveTextContent('facebook.com/ficticio1');
    expect(within(foco()).getAllByRole('row')[4]).toHaveTextContent('Enlazado desde la web');
  });

  it('pegar una web analiza solo esa URL: no reconsulta OSM ni pierde las evidencias anteriores',async()=>{
    const red=servidor();
    await investigarTodo();
    fireEvent.click(fila(1));
    expect(within(foco()).getAllByRole('row')[3]).toHaveTextContent('instagram.com/ficticio1');
    red.mockClear();
    const evento=new Event('paste',{bubbles:true,cancelable:true}) as Event & {clipboardData:unknown};
    evento.clipboardData={getData:()=>'https://comercio-ficticio-1.es/'};
    act(()=>{document.body.dispatchEvent(evento);});
    await waitFor(()=>expect(red.mock.calls.length).toBe(1));
    await waitFor(()=>expect(screen.getByText(/Investigación terminada/)).toBeInTheDocument());
    const acciones=red.mock.calls.map(([,init])=>JSON.parse(String(init?.body)).accion);
    expect(acciones).toEqual(['paginas']);
    expect(within(foco()).getAllByRole('row')[3]).toHaveTextContent('instagram.com/ficticio1');
    expect(within(foco()).getAllByRole('row')[4]).toHaveTextContent('facebook.com/ficticio1');
  });

  it('si OpenStreetMap falla, sigue con las webs y lo avisa, sin perder trabajo',async()=>{
    vi.spyOn(globalThis,'fetch').mockImplementation(async(_u,init)=>{
      const cuerpo=JSON.parse(String(init?.body));
      if(cuerpo.accion==='osm') return new Response(JSON.stringify({error:'OpenStreetMap no está disponible ahora mismo (504).'}),{status:502});
      return new Response(JSON.stringify({resultados:cuerpo.urls.map((u:string)=>({url:u,error:'sin respuesta'}))}),{status:200});
    });
    await investigarTodo();
    expect(screen.getByText('1 avisos de la última investigación')).toBeInTheDocument();
    // No haber podido consultar una fuente no es «sin evidencias»: queda incompleta y se puede reintentar.
    expect(screen.getByRole('button',{name:/^10 Investigación incompleta/})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:/^0 Sin evidencias automáticas/})).toBeInTheDocument();
    // Causa distinguible, hora del intento y enfriamiento: una sola consulta a OSM en todo el lote.
    expect(within(foco()).getByRole('status',{name:'Estado de las fuentes'})).toHaveTextContent(/OpenStreetMap — servidor no disponible \(504\)|OpenStreetMap — en pausa/);
    expect(within(foco()).getByRole('status',{name:'Estado de las fuentes'})).toHaveTextContent(/Último intento: \d{2}:\d{2}/);
    expect((globalThis.fetch as unknown as {mock:{calls:[unknown,RequestInit][]}}).mock.calls
      .filter(([,i])=>JSON.parse(String(i.body)).accion==='osm')).toHaveLength(1);
    expect(screen.getByRole('button',{name:'Investigar 10 automáticamente'})).toBeEnabled();
    // Durante el enfriamiento no se insiste; se puede continuar sin OSM y revisar igualmente.
    expect(within(foco()).getByRole('button',{name:/Reintentar OpenStreetMap \(desde las/})).toBeDisabled();
    expect(within(foco()).getByRole('button',{name:/Reintentar OpenStreetMap/}).textContent).not.toMatch(/svg/i);
    fireEvent.click(within(foco()).getByRole('button',{name:'Continuar sin OSM y buscar a mano'}));
    expect(screen.getByRole('button',{name:/^9 Investigación incompleta/})).toBeInTheDocument();
    expect(within(foco()).queryByText(/Investigación incompleta\./)).not.toBeInTheDocument();
  });

  it('«Reintentar OpenStreetMap» repite SOLO OSM: no vuelve a pedir webs ni borra decisiones',async()=>{
    let osmCae=true;
    const red=vi.spyOn(globalThis,'fetch').mockImplementation(async(_u,init)=>{
      const cuerpo=JSON.parse(String(init?.body));
      const json=(d:unknown,status=200)=>new Response(JSON.stringify(d),{status});
      if(cuerpo.accion==='osm') return osmCae ? json({error:'OpenStreetMap (Nominatim) no está disponible ahora mismo (429).'},502)
        : json({lugares:[{id:'node/1',nombre:'Comercio ficticio 1',calle:'Calle Inventada',numero:'4',instagram:'https://www.instagram.com/ficticio1'}]});
      return json({resultados:cuerpo.urls.map((u:string)=>({url:u,error:'sin respuesta'}))});
    });
    await investigarTodo();
    fireEvent.click(fila(1));
    expect(within(foco()).getByRole('status',{name:'Estado de las fuentes'})).toHaveTextContent('límite de uso del proveedor (429)');
    // «No tiene» se marca expresamente (la tecla 5 sin propuesta solo abre la búsqueda).
    fireEvent.click(within(within(foco()).getAllByRole('row')[5]).getByRole('button',{name:'X / Twitter: comprobado que no tiene'}));
    localStorage.removeItem('ulit-censo-radar-osm-pausa');
    osmCae=false;
    const antes=red.mock.calls.length;
    fireEvent.click(fila(2)); fireEvent.click(fila(1));
    fireEvent.click(within(foco()).getByRole('button',{name:'Reintentar OpenStreetMap'}));
    await waitFor(()=>expect(within(foco()).getAllByRole('row')[3]).toHaveTextContent('instagram.com/ficticio1'));
    const nuevas=red.mock.calls.slice(antes).map(([,i])=>JSON.parse(String(i?.body)).accion);
    expect(nuevas).toEqual(['osm']);
    expect(trabajo().reg1.decisiones.twitter).toMatchObject({valor:'no'});
    expect(within(foco()).queryByText(/Investigación incompleta\./)).not.toBeInTheDocument();
  });

  it('mide propuestas correctas e incorrectas tras la revisión humana',async()=>{
    servidor();
    await investigarTodo();
    const avance=screen.getByRole('status',{name:'Progreso del piloto'});
    expect(avance).toHaveTextContent('6 de 60 campos con propuesta automática (5 relacionadas)');
    fireEvent.click(fila(2));
    fireEvent.click(within(within(foco()).getAllByRole('row')[3]).getByRole('button',{name:'Instagram: la coincidencia no corresponde'}));
    fireEvent.click(fila(1));
    fireEvent.keyDown(document.body,{key:'Enter'});
    expect(avance).toHaveTextContent('correctas 4 · incorrectas 1 · sin revisar 1');
  });
});
