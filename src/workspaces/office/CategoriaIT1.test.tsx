import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import type { BaseDatos } from '../../domain/db';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import { guardarCategoriaIT1, type CambioCategoriaIT1 } from '../../store/categoriaIT1Real';
import CategoriaIT1 from './CategoriaIT1';

vi.mock('../../store/categoriaIT1Real', () => ({
  capacidadCategoriaIT1: vi.fn(async () => ({
    habilitada:true,alcance:'it1-categorias-supervisadas',
  })),
  guardarCategoriaIT1:vi.fn(),
}));

function fixture(): BaseDatos {
  const db=baseVacia();
  db.municipios.medina={id:'medina',nombre:'Medina del Campo',
    provincia:'Valladolid',fuenteCallejero:'osm'};
  db.campanas.c26={id:'c26',municipioId:'medina',anio:2026,nombre:'Censo 2026',
    tipo:'actualizacion',periodo:{inicio:'2026-01-01'},ambitoCalleIds:[],ampliacionCalleIds:[],
    estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},
    procedencia:'importado'};
  db.itinerarios.it1={id:'it1',campanaId:'c26',codigo:'IT1',
    nombre:'IT1',origen:'excel',color:'#123',tramos:[],asignadosIds:[],creado:'2026-10-01'};
  db.importaciones.imp={id:'imp',campanaId:'c26',municipioId:'medina',archivo:'IT1.xlsx',
    tipo:'C-excel-itinerario',fecha:'2026-10-01',filas:3,
    huella:'abc',estado:'confirmada',resumen:{},procedencia:'importado'};
  db.registros.r1={id:'r1',importacionId:'imp',itinerarioId:'it1',fila:2,
    datos:{'Local Vacío':'0','Nombre del negocio':'Antenas Eiras',
      Dirección:'Calle Mayor',Num:'2',GrActividad:'Servicios',
      'Subgrupo de actividad':'Reparaciones',Actividad:'Reparaciones'}};
  db.registros.r2={id:'r2',importacionId:'imp',itinerarioId:'it1',fila:3,
    datos:{'Local Vacío':'0','Nombre del negocio':'Tienda Nueva',
      Dirección:'Calle Nueva',Num:'5',GrActividad:'',
      'Subgrupo de actividad':'',Actividad:''}};
  db.registros.r3={id:'r3',importacionId:'imp',itinerarioId:'it1',fila:4,
    datos:{'Local Vacío':'1','Nombre del negocio':'',
      Dirección:'Calle Nueva',Num:'7','Long fachada':'6'}};
  return db;
}

function Pantalla() {
  const [db,setDb]=useState(fixture);
  const [version,setVersion]=useState(20);
  const aplicarRevisionCategoriaReal=(cambio: CambioCategoriaIT1)=>{
    setDb((prev)=>({...prev,revisionesCategoriaRegistros:{
      ...(prev.revisionesCategoriaRegistros??{}),
      [cambio.registroId]: cambio.revision,
    }}));
    setVersion(cambio.version);
  };
  return <FuenteOficinaContext.Provider value={{
    db,campanaId:'c26',personaId:'responsable',roles:['coordinador'],
    soloLectura:true,aplicar:()=>false,versionReal:version,aplicarRevisionCategoriaReal,
  }}><MemoryRouter><CategoriaIT1/></MemoryRouter></FuenteOficinaContext.Provider>;
}

describe('Oficina · revisión categorización IT1',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.mocked(guardarCategoriaIT1).mockImplementation(async(registroId,version,accion,valores)=>({
      registroId,version:version+1,revision:{
        id:registroId,registroId,campanaId:'c26',
        estado:accion==='aceptar'?'aceptada':accion==='rechazar'?'rechazada':'corregida',
        valores,porId:'responsable',fecha:'2026-11-16T10:00:00Z',
      },
    }));
  });

  it('muestra todos los ocupados, no los vacíos, y obliga a aceptar la categoría anterior', async()=>{
    render(<Pantalla/>);
    const listado=screen.getByRole('region',{name:'Negocios del itinerario 1'});
    const detalle=screen.getByRole('region',{name:'Revisión de la categoría'});
    expect(within(listado).getByText('Antenas Eiras')).toBeInTheDocument();
    expect(within(listado).getByText('Tienda Nueva')).toBeInTheDocument();
    expect(within(listado).queryByText('Calle Nueva, 7')).not.toBeInTheDocument();
    expect(within(detalle).getByText(/Servicios › Reparaciones/)).toBeInTheDocument();
    await waitFor(()=>expect(within(detalle).getByRole('button',
      {name:/Aceptar categoría y siguiente/})).toBeEnabled());
    fireEvent.click(within(detalle).getByRole('button',{name:/Aceptar categoría y siguiente/}));
    await waitFor(()=>expect(within(detalle).getByText('Tienda Nueva')).toBeInTheDocument());
    expect(guardarCategoriaIT1).toHaveBeenCalledWith('r1',20,'aceptar',
      expect.objectContaining({grupoActividad:'Servicios'}));
    expect(within(detalle).getByText('Sin categorización')).toBeInTheDocument();
    expect(within(detalle).getByText('Elegir categoría correcta')).toBeInTheDocument();
  });

  it('No es correcta registra el rechazo y obliga a elegir nueva categoría', async()=>{
    render(<Pantalla/>);
    const detalle=screen.getByRole('region',{name:'Revisión de la categoría'});
    await waitFor(()=>expect(within(detalle).getByRole('button',
      {name:'No es correcta'})).toBeEnabled());
    fireEvent.click(within(detalle).getByRole('button',{name:'No es correcta'}));
    await waitFor(()=>expect(within(detalle).getByText('Elegir categoría correcta')).toBeInTheDocument());
    expect(guardarCategoriaIT1).toHaveBeenCalledWith('r1',20,'rechazar',
      expect.objectContaining({subgrupo:'Reparaciones'}));
  });
});
