import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia, type BaseDatos } from '../../domain/db';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import { crearColaFranquiciaIT1, type EstadoColaFranquiciaIT1 } from '../../store/colaFranquiciaIT1';
import { guardarFranquiciaIT1, type CambioFranquiciaIT1 } from '../../store/franquiciaIT1Real';
import FranquiciaIT1 from './FranquiciaIT1';

vi.mock('../../store/franquiciaIT1Real',()=>({
  capacidadFranquiciaIT1: vi.fn(async()=>({habilitada:true})),
  guardarFranquiciaIT1: vi.fn(),
}));
function fixture(){
  const db=baseVacia();
  db.campanas.c26={id:'c26',municipioId:'medina',anio:2026,nombre:'Censo 2026',
    tipo:'actualizacion',periodo:{inicio:'2026-01-01'},ambitoCalleIds:[],ampliacionCalleIds:[],
    estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},
    procedencia:'importado'};
  db.itinerarios.it1={id:'it1',campanaId:'c26',codigo:'IT1',nombre:'IT1',
    origen:'excel',color:'#123',tramos:[],asignadosIds:[],creado:'2026-10-01'};
  db.importaciones.imp={id:'imp',campanaId:'c26',municipioId:'medina',
    archivo:'IT1.xlsx',tipo:'C-excel-itinerario',fecha:'2026-10-01',
    filas:4,huella:'abc',estado:'confirmada',resumen:{},procedencia:'importado'};
  for(const [id,nombre,valor,vacio] of [
    ['reg-11','Farmacia Ficticia','1',false],
    ['reg-22','Panadería Ficticia','0',false],
    ['reg-33','Peluquería Ficticia','',false],
    ['reg-44','Local vacío ficticio','',true],
  ] as const) db.registros[id]={id,importacionId:'imp',itinerarioId:'it1',
    fila:Number(id.slice(-2)),datos:{'Nombre del negocio':vacio?'':nombre,
      'Local Vacío':vacio?'1':'0','Franquicia':valor,Dirección:'Calle Ficticia',Num:'2'}};
  return db;
}
function Pantalla({inicial=fixture}:{inicial?:()=>BaseDatos}){
  const [db,setDb]=useState(inicial);
  const [version,setVersion]=useState(20);
  const [estadoColaFranquiciaIT1,setEstadoColaFranquiciaIT1]=useState<EstadoColaFranquiciaIT1>({pendientes:[],error:''});
  const colaRef=useRef<ReturnType<typeof crearColaFranquiciaIT1> | null>(null);
  const aplicar=(cambio:CambioFranquiciaIT1)=>{
    setDb(prev=>({...prev,revisionesFranquiciaRegistros:{
      ...(prev.revisionesFranquiciaRegistros??{}),
      ...Object.fromEntries(cambio.revisiones.map(r=>[r.registroId,r])),
    }}));
    setVersion(cambio.version);
  };
  const encolar:NonNullable<import('../../store/fuenteOficina').FuenteOficina['encolarFranquiciaIT1']>=(decision)=>{
    if(!colaRef.current) colaRef.current=crearColaFranquiciaIT1(
      version,guardarFranquiciaIT1,aplicar,setEstadoColaFranquiciaIT1);
    return colaRef.current.encolar(decision);
  };
  return <FuenteOficinaContext.Provider value={{
    db,campanaId:'c26',personaId:'responsable',roles:['coordinador'],
    soloLectura:true,aplicar:()=>false,versionReal:version,
    estadoColaFranquiciaIT1,encolarFranquiciaIT1:encolar,
    reintentarColaFranquiciaIT1:()=>colaRef.current?.reintentar(),
  }}><MemoryRouter><FranquiciaIT1/></MemoryRouter></FuenteOficinaContext.Provider>;
}

beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(guardarFranquiciaIT1).mockImplementation(async(decision,version)=>({
    version:version+1,accion:decision.accion,
    revisiones:decision.ids.map(id=>({
      id,registroId:id,campanaId:'c26',
      estado:decision.accion==='rechazar'?'rechazada':decision.accion==='resolver'?'corregida':'aceptada',
      ...(decision.accion==='rechazar'?{}:{respuesta:decision.accion==='resolver'?decision.respuesta:id==='reg-11'?'si':'no'}),
      masiva:decision.accion==='aceptar-todas',porId:'responsable',fecha:'2026-11-25T10:00:00Z',
    })),
  }));
});

describe('IT1 · franquicias, interacción teclado y aceptación masiva',()=>{
  it('Enter confirma el valor del Excel y Supr rechaza: ese negocio pasa a nuevos',async()=>{
    render(<Pantalla/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:/Correcto · Enter/})).toBeEnabled());
    expect(screen.getByText('Farmacia Ficticia')).toBeInTheDocument();
    fireEvent.keyDown(document.body,{key:'Enter'});
    await waitFor(()=>expect(screen.getByText('Panadería Ficticia')).toBeInTheDocument());
    fireEvent.keyDown(document.body,{key:'Delete'});
    await waitFor(()=>expect(screen.getByRole('button',{name:/2 · Completar franquicias/})).toHaveTextContent('2 pendientes'));
    fireEvent.click(screen.getByRole('button',{name:/2 · Completar franquicias/}));
    expect(screen.getByText('Panadería Ficticia')).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('aria-label','Paso 2 · Completar');
    fireEvent.keyDown(document.activeElement!,{key:'Delete'});
    await waitFor(()=>expect(guardarFranquiciaIT1).toHaveBeenCalledWith(
      {accion:'resolver',ids:['reg-22'],respuesta:'no'},expect.any(Number)));
  });
  it('confirmación masiva requiere segundo clic, acepta solo Excel con 0/1 y deja vacío pendiente',async()=>{
    render(<Pantalla/>);
    await waitFor(()=>expect(screen.getByRole('button',{name:/Dar por correctos todos/})).toBeEnabled());
    fireEvent.click(screen.getByRole('button',{name:/Dar por correctos todos/}));
    expect(guardarFranquiciaIT1).not.toHaveBeenCalled();
    expect(screen.getByText(/se aceptarán las 2 respuestas/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Sí, dar las 2 por correctas/}));
    await waitFor(()=>expect(guardarFranquiciaIT1).toHaveBeenCalledWith(
      {accion:'aceptar-todas',ids:['reg-11','reg-22']},20));
    await waitFor(()=>expect(screen.getByRole('status',{name:'Estado del guardado'})).toHaveTextContent('2 de 3 confirmadas'));
    fireEvent.click(screen.getByRole('button',{name:/2 · Completar franquicias/}));
    expect(screen.getByText('Peluquería Ficticia')).toBeInTheDocument();
    expect(screen.getByRole('status',{name:'Estado del guardado'})).toHaveTextContent('1 pendientes por decidir');
  });
});
