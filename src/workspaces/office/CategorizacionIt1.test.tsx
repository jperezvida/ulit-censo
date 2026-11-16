import {useState} from 'react';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {baseVacia} from '../../domain/db';
import type {BaseDatos} from '../../domain/db';
import {FuenteOficinaContext} from '../../store/fuenteOficina';
import {guardarCategoriaIt1} from '../../store/categorizacionIt1Real';
import type {CambioRevisionGeneralReal} from '../../store/revisionGeneralReal';
import {revisionCategorizacionIt1} from '../../domain/revisionCategorizacionIt1';
import CategorizacionIt1 from './CategorizacionIt1';

vi.mock('../../store/categorizacionIt1Real',()=>({
 capacidadCategorizacionIt1:vi.fn(async()=>({habilitada:true,version:12,alcance:'categoria-it1-2026'})),
 guardarCategoriaIt1:vi.fn(),
}));
function datos():BaseDatos {
 const db=baseVacia();
 db.municipios.m={id:'m',nombre:'Medina del Campo',provincia:'Valladolid',fuenteCallejero:'osm'};
 db.campanas.c26={id:'c26',municipioId:'m',anio:2026,nombre:'Medina 2026',tipo:'actualizacion',periodo:{inicio:'2026-01-01'},ambitoCalleIds:[],ampliacionCalleIds:[],estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},procedencia:'importado'};
 db.importaciones.imp={id:'imp',municipioId:'m',campanaId:'c26',tipo:'C-excel-itinerario',archivo:'IT1.xlsx',huella:'x',fecha:'2026-11-01',filas:3,estado:'confirmada',resumen:{},procedencia:'importado'};
 db.itinerarios.it1={id:'it1',campanaId:'c26',codigo:'IT1',nombre:'1',origen:'excel',color:'#333',tramos:[],asignadosIds:[],creado:'2026-11-01'};
 db.registros.r2={id:'r2',importacionId:'imp',itinerarioId:'it1',fila:2,datos:{Dirección:'Mayor',Num:'2','Local Vacío':'0','Nombre del negocio':'Carnicería Manolo',GrActividad:'Comercio','Gr Comercio':'Alimentación','Subgrupo de actividad':'Carnes',Actividad:'Carnicería'}};
 db.registros.r3={id:'r3',importacionId:'imp',itinerarioId:'it1',fila:3,datos:{Dirección:'Mayor',Num:'4','Local Vacío':'0','Nombre del negocio':'Peluquería Ana'}};
 db.registros.r4={id:'r4',importacionId:'imp',itinerarioId:'it1',fila:4,datos:{Dirección:'Mayor',Num:'6','Local Vacío':'1','Nombre del negocio':'','Long fachada':'3'}};
 return db;
}
function App() {
 const [db,setDb]=useState(datos);
 const [version,setVersion]=useState(12);
 const aplicarCorreccionReal=(r:CambioRevisionGeneralReal)=>{
  setDb(old=>({...old,correccionesRegistros:{...old.correccionesRegistros,[r.registroId]:r.correccion!}}));
  setVersion(r.version);
 };
 return <FuenteOficinaContext.Provider value={{
  db,campanaId:'c26',personaId:'admin',roles:['administrador'],soloLectura:true,
  aplicar:()=>false,versionReal:version,aplicarCorreccionReal,
 }}>
  <MemoryRouter><CategorizacionIt1/></MemoryRouter>
 </FuenteOficinaContext.Provider>;
}

describe('IT1 · aceptación y rechazo humano obligatorios',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(guardarCategoriaIt1).mockImplementation(async(id,version,accion)=>{
   const db=datos();const fila=revisionCategorizacionIt1(db,'c26').ocupados.find(f=>f.id===id)!;
   const valores=fila.valoresCategoria;
   return {registroId:id,version:version+1,
     correccion:{id,registroId:id,campanaId:'c26',valores:{},fecha:'2026-11-16T11:00:00Z',
      porId:'admin',motivo:'Revisión',historial:[],
      revisionClasificacion:{estado:accion==='rechazar'?'rechazada':'aceptada',
       valores,fecha:'2026-11-16T11:00:00Z',porId:'admin'}}};
  });
 });
 it('los ocupados con categoría se muestran, pero ninguno aparece aceptado de antemano',async()=>{
  render(<App/>);
  expect(document.querySelector('.ci-resumen')).toHaveTextContent('2 ocupados');
  expect(document.querySelector('.ci-resumen')).toHaveTextContent('1 vacíos, no se categorizan');
  const detalle=screen.getByRole('region',{name:'Detalle de categorización'});
  expect(within(detalle).getByText('Carnicería Manolo')).toBeInTheDocument();
  expect(within(detalle).getByText('Carnes')).toBeInTheDocument();
  expect(within(detalle).getByRole('button',{name:/Aceptar categoría y siguiente/})).toBeEnabled();
  expect(screen.getByRole('button',{name:/Por revisar/})).toHaveTextContent('2');
  expect(guardarCategoriaIt1).not.toHaveBeenCalled();
 });
 it('Aceptar confirma la categorización previa y pasa automáticamente al siguiente',async()=>{
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:/Aceptar categoría y siguiente/}));
  await waitFor(()=>expect(screen.getByRole('region',{name:'Detalle de categorización'})
    ).toHaveTextContent('Peluquería Ana'));
  expect(guardarCategoriaIt1).toHaveBeenCalledWith('r2',12,'aceptar',undefined);
  expect(screen.getByRole('button',{name:/Aceptadas/})).toHaveTextContent('1');
  expect(screen.getByRole('button',{name:/Por revisar/})).toHaveTextContent('1');
  fireEvent.click(screen.getByRole('button',{name:/Aceptadas/}));
  expect(screen.getByRole('region',{name:'Detalle de categorización'})).toHaveTextContent('Carnicería Manolo');
 });
 it('Rechazar deja la ficha pendiente de sustituir, sin borrar los valores existentes',async()=>{
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:/Rechazar categoría/}));
  await waitFor(()=>expect(guardarCategoriaIt1).toHaveBeenCalledWith('r2',12,'rechazar',undefined));
  fireEvent.click(screen.getByRole('button',{name:/Rechazadas/}));
  const detalle=screen.getByRole('region',{name:'Detalle de categorización'});
  expect(within(detalle).getByText('Carnicería Manolo')).toBeInTheDocument();
  expect(within(detalle).getByText('Carnes')).toBeInTheDocument();
  expect(within(detalle).getByText(/Categoría anterior rechazada/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Por revisar/})).toHaveTextContent('2');
 });
});
