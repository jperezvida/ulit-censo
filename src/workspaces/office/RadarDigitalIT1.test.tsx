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
});
