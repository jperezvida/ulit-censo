import { useState } from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { MemoryRouter,Route,Routes } from 'react-router-dom';
import { baseVacia, type BaseDatos } from '../../domain/db';
import type { CambioCategoriaReal } from '../../store/categoriaReal';
import { guardarCategoriaReal } from '../../store/categoriaReal';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import Categorizacion2026 from './Categorizacion2026';

vi.mock('../../store/categoriaReal',()=>({
  capacidadCategoriaReal:vi.fn(async()=>({
    habilitada:true,catalogo:'clasificacion-2026@v1',alcance:'clasificacion-por-fila-2026',
  })),
  guardarCategoriaReal:vi.fn(),
}));
vi.mock('./BuscadorClasificacion',()=>({
  BuscadorClasificacion:({onElegir}:{onElegir:(x:{opcion:{nodoId:string},descripcion?:string})=>void})=>
    <button type="button" onClick={()=>onElegir({opcion:{nodoId:'c26.S.peluquerias'}})}>
      Elegir peluquería oficial
    </button>,
}));

function datos():BaseDatos{
 const db=baseVacia();
 db.municipios.m={id:'m',nombre:'Medina del Campo',provincia:'Valladolid',fuenteCallejero:'osm'};
 db.campanas.c26={id:'c26',municipioId:'m',anio:2026,nombre:'Censo 2026',
  tipo:'actualizacion',periodo:{inicio:'2026-01-01'},ambitoCalleIds:[],ampliacionCalleIds:[],
  estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},procedencia:'importado'};
 db.itinerarios.it1={id:'it1',campanaId:'c26',codigo:'IT1',nombre:'IT1',origen:'excel',
  color:'#0088ff',tramos:[],asignadosIds:[],creado:'2026-11-01'};
 db.importaciones.imp={id:'imp',municipioId:'m',campanaId:'c26',tipo:'C-excel-itinerario',
  archivo:'IT1.xlsx',huella:'abc',fecha:'2026-11-01',filas:3,estado:'confirmada',
  resumen:{},procedencia:'importado'};
 for(let i=1;i<=3;i++){
  db.registros['r'+i]={id:'r'+i,fila:i+1,importacionId:'imp',itinerarioId:'it1',
   datos:{Dirección:'Calle Mayor',Num:'8','Local Vacío':i===3?'1':'0',
    'Nombre del negocio':i===3?'':i===1?'Panadería sintética':'Peluquería sintética',
    'Long fachada':i===3?'4':'','GrActividad':i===1?'Comercio':'',
    'Gr Comercio':i===1?'Alimentación':'',
    'Subgrupo de actividad':i===1?'Pan y Lácteos':'',
    Actividad:i===1?'Panadería':''}};
 }
 return db;
}
function Vista(){
 const [db,setDb]=useState(datos);
 const [version,setVersion]=useState(20);
 const aplicarCategoriaReal=(cambio:CambioCategoriaReal)=>{
  setDb(prev=>({...prev,revisionesCategoriaRegistros:{
   ...(prev.revisionesCategoriaRegistros??{}),[cambio.registroId]:cambio.revision,
  }}));
  setVersion(cambio.version);
 };
 return <FuenteOficinaContext.Provider value={{
  db,campanaId:'c26',personaId:'admin',roles:['administrador'],
  soloLectura:true,aplicar:()=>false,versionReal:version,aplicarCategoriaReal,
 }}>
  <MemoryRouter initialEntries={['/oficina/categorizacion/it1']}>
   <Routes>
    <Route path="/oficina/categorizacion/:itId" element={<Categorizacion2026/>}/>
   </Routes>
  </MemoryRouter>
 </FuenteOficinaContext.Provider>;
}
describe('Oficina · categoría por fila sin aceptar herencias automáticamente',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(guardarCategoriaReal).mockImplementation(async(registroId,itinerarioId,version,accion,nodoId,descripcion)=>({
   registroId,itinerarioId,version:version+1,accion,
   revision:{id:registroId,registroId,itinerarioId,campanaId:'c26',
    estado:accion==='aceptar'?'aceptada':accion==='rechazar'?'rechazada':'corregida',
    catalogoId:'clasificacion-2026@v1',nodoId:accion==='rechazar'?undefined:nodoId,
    descripcion,valores:{grupoActividad:'Comercio',grupoComercio:'Alimentación',
      subgrupo:'Pan y Lácteos',actividad:'Panadería',descripcionActividad:''},
    nombreRevisado:registroId==='r1'?'Panadería sintética':'Peluquería sintética',
    porId:'admin',fecha:'2026-11-16T11:00:00Z'},
  }));
 });
 it('muestra todos los ocupados y su categoría previa sin aprobarla',async()=>{
  render(<Vista/>);
  expect(screen.getByRole('heading',{name:'Revisión de categorización'})).toBeInTheDocument();
  expect(screen.getByText('3', {selector:'.cat26-resumen b'})).toBeInTheDocument();
  expect(screen.getByText('0 / 2')).toBeInTheDocument();
  const lista=screen.getByRole('region',{name:'Establecimientos para categorizar'});
  expect(within(lista).getAllByRole('button')).toHaveLength(2);
  expect(within(lista).getByText('Panadería sintética')).toBeInTheDocument();
  expect(within(lista).getByText('Peluquería sintética')).toBeInTheDocument();
  expect(within(lista).queryByText('Local vacío')).not.toBeInTheDocument();
  expect(screen.getByText('Panadería',{selector:'dd'})).toBeInTheDocument();
  expect(guardarCategoriaReal).not.toHaveBeenCalled();
 });
 it('aceptar categoría previa avanza a siguiente ocupado, permitiendo volver',async()=>{
  render(<Vista/>);
  const btn=screen.getByRole('button',{name:/Aceptar categoría y siguiente/});
  await waitFor(()=>expect(btn).toBeEnabled());
  fireEvent.click(btn);
  await waitFor(()=>expect(screen.getByRole('heading',{name:'Peluquería sintética'})).toBeInTheDocument());
  expect(guardarCategoriaReal).toHaveBeenCalledWith('r1','it1',20,'aceptar',
    'c26.C.A.pan-y-lacteos.panaderia','');
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Anterior establecimiento'}));
  expect(screen.getByText('Categoría aceptada')).toBeInTheDocument();
  expect(guardarCategoriaReal).toHaveBeenCalledTimes(1);
 });
 it('rechazar obliga a buscar una alternativa; la fila no cuenta como revisada',async()=>{
  render(<Vista/>);
  const rechazar = screen.getByRole('button',{name:/Rechazar existente/});
  await waitFor(()=>expect(rechazar).toBeEnabled());
  fireEvent.click(rechazar);
  await waitFor(()=>expect(screen.getByText(/Clasificación anterior rechazada/)).toBeInTheDocument());
  expect(screen.getByText('0 / 2')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Elegir peluquería oficial'})).toBeInTheDocument();
  expect(guardarCategoriaReal).toHaveBeenCalledWith('r1','it1',20,'rechazar','','');
 });
});
