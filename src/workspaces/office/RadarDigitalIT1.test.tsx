import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import RadarDigitalIT1 from './RadarDigitalIT1';

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
      'Local Vacío':i===12?'1':'0','Dirección':'Calle Inventada','Num':'4','web':i===1?'0':''}};
  }
  return db;
}
function Pantalla(){
  return <FuenteOficinaContext.Provider value={{
    db:fixture(),campanaId:'c26',personaId:'revisor',roles:['coordinador'],
    soloLectura:true,aplicar:()=>false,versionReal:20,
  }}><MemoryRouter><RadarDigitalIT1/></MemoryRouter></FuenteOficinaContext.Provider>;
}
beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();});
describe('Radar Digital IT1: piloto sin escritura al censo',()=>{
  it('ofrece solamente 10 negocios, búsqueda contextualizada y datos fuente en acordeón',()=>{
    render(<Pantalla/>);
    expect(screen.getByRole('status',{name:'Progreso del piloto'})).toHaveTextContent('10 negocios del piloto');
    expect(screen.getAllByRole('button',{name:/Comercio ficticio/})).toHaveLength(10);
    expect(screen.getByRole('heading',{name:'Comercio ficticio 1'})).toBeInTheDocument();
    expect(screen.getByRole('link',{name:/Buscar web oficial/})).toHaveAttribute('href',
      expect.stringContaining('google.com/search?q='));
    fireEvent.click(screen.getByText(/Ver valores originales del Excel/));
    expect(screen.getByText('Web:')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });
  it('no asigna perfiles ni Sí automáticamente: los hallazgos requieren confirmación',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({
      hallazgo:{urlFinal:'https://comercio-ficticio.es/',redes:{instagram:'https://www.instagram.com/ficticio/'},
        indiciosVenta:['Tecnología de tienda (Shopify)']},
    }),{status:200,headers:{'content-type':'application/json'}}));
    render(<Pantalla/>);
    fireEvent.change(screen.getByLabelText(/Web candidata/),{target:{value:'https://comercio-ficticio.es/'}});
    fireEvent.click(screen.getByRole('button',{name:'Analizar web'}));
    await waitFor(()=>expect(screen.getByRole('link',{name:/Página analizada/})).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/radar-web',expect.objectContaining({method:'POST'}));
    const confirmar=screen.getByRole('checkbox',{name:/Web oficial verificada por mí/});
    expect(confirmar).not.toBeChecked();
    expect(screen.getByRole('checkbox',{name:'Confirmado'})).not.toBeChecked();
    fireEvent.click(confirmar);
    expect(confirmar).toBeChecked();
    expect(screen.getByRole('status',{name:'Progreso del piloto'})).toHaveTextContent('1 webs validadas');
    fireEvent.click(screen.getByRole('button',{name:/Marcar investigación revisada/}));
    expect(screen.getByRole('status',{name:'Progreso del piloto'})).toHaveTextContent('1 revisados en este navegador');
    expect(JSON.parse(localStorage.getItem('ulit-censo-radar-it1-piloto-v1:c26')!))
      .toHaveProperty('reg1.estado','revisado');
  });
  it('permite registrar y confirmar una red sin disponer de página web',()=>{
    render(<Pantalla/>);
    fireEvent.click(screen.getByText('Añadir perfiles encontrados manualmente'));
    const insta=screen.getByPlaceholderText('https://www.instagram.com/negocio/');
    fireEvent.change(insta,{target:{value:'https://www.instagram.com/tienda.ficticia/'}});
    const confirmado=screen.getByRole('checkbox',{name:'Confirmado'});
    expect(confirmado).not.toBeChecked();
    expect(screen.getByText('Encontrado manualmente')).toBeInTheDocument();
    fireEvent.click(confirmado);
    expect(confirmado).toBeChecked();
    expect(JSON.parse(localStorage.getItem('ulit-censo-radar-it1-piloto-v1:c26')!))
      .toHaveProperty('reg1.redesValidadas.instagram',true);
    expect(screen.getByRole('status',{name:'Progreso del piloto'})).toHaveTextContent('0 webs validadas');
  });
  it('confirma en una acción la web y los enlaces descubiertos, nunca redes ausentes',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({
      hallazgo:{urlFinal:'https://comercio-ficticio.es/',
        titulo:'Comercio ficticio 1 | Inicio',
        redes:{instagram:'https://www.instagram.com/ficticio/',facebook:'https://www.facebook.com/ficticio/'},
        indiciosVenta:[]},
    }),{status:200,headers:{'content-type':'application/json'}}));
    render(<Pantalla/>);
    fireEvent.change(screen.getByLabelText(/Web candidata/),{target:{value:'https://comercio-ficticio.es/'}});
    fireEvent.click(screen.getByRole('button',{name:'Analizar web'}));
    const lote=await screen.findByRole('button',{name:/Confirmar web y enlaces comprobados/});
    expect(lote).toBeEnabled();
    expect(screen.getByText(/nombre aparece en el título/i)).toBeInTheDocument();
    fireEvent.click(lote);
    await waitFor(()=>{
      const d=JSON.parse(localStorage.getItem('ulit-censo-radar-it1-piloto-v1:c26')!);
      expect(d.reg1.webValidada).toBe(true);
      expect(d.reg1.redesValidadas).toMatchObject({instagram:true,facebook:true});
      expect(d.reg1.redesValidadas.twitter).toBeUndefined();
    });
    expect(screen.getByRole('status',{name:'Progreso del piloto'})).toHaveTextContent('1 webs validadas');
  });
  it('una respuesta tardía no reintroduce resultados de una web que se ha cambiado',async()=>{
    let responder!: (r:Response)=>void;
    vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(resolve=>{responder=resolve;}));
    render(<Pantalla/>);
    const web=screen.getByLabelText(/Web candidata/);
    fireEvent.change(web,{target:{value:'https://web-anterior.es/'}});
    fireEvent.click(screen.getByRole('button',{name:'Analizar web'}));
    fireEvent.change(web,{target:{value:'https://web-nueva.es/'}});
    responder(new Response(JSON.stringify({hallazgo:{
      urlFinal:'https://web-anterior.es/',redes:{instagram:'https://www.instagram.com/antigua/'},
      indiciosVenta:[],
    }}),{status:200,headers:{'content-type':'application/json'}}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Analizar web'})).toBeEnabled());
    expect(screen.queryByRole('link',{name:/Página analizada/})).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('ulit-censo-radar-it1-piloto-v1:c26')!))
      .toHaveProperty('reg1.sitioWeb','https://web-nueva.es/');
  });

});
