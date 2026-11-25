import { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { baseVacia } from '../../domain/db';
import type { BaseDatos } from '../../domain/db';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import { guardarCategoriaIT1, type CambioCategoriaIT1 } from '../../store/categoriaIT1Real';
import { crearColaCategoriaIT1, type EstadoColaCategoriaIT1 } from '../../store/colaCategoriaIT1';
import CategoriaIT1 from './CategoriaIT1';
import { sugerirPorNombre } from '../../domain/buscador';
import { ID_CATALOGO_2026 } from '../../domain/catalogo2026';
import { categoriasDelCatalogo, OPCIONES_CATEGORIAS_2026,
  type ValoresCategoria } from '../../domain/revisionCategoriaIT1';

vi.mock('../../store/categoriaIT1Real', () => ({
  capacidadCategoriaIT1: vi.fn(async () => ({
    habilitada:true,alcance:'it1-categorias-supervisadas',
  })),
  guardarCategoriaIT1:vi.fn(),
}));

function base(): BaseDatos {
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
  return db;
}

/** Ficticio: Antenas Eiras (con categoría), Peluquería Sol (sin categoría) y un vacío. */
function fixture(): BaseDatos {
  const db=base();
  db.registros.r1={id:'r1',importacionId:'imp',itinerarioId:'it1',fila:2,
    datos:{'Local Vacío':'0','Nombre del negocio':'Antenas Eiras',
      Dirección:'Calle Mayor',Num:'2',GrActividad:'Servicios',
      'Subgrupo de actividad':'Reparaciones',Actividad:'Reparaciones'}};
  db.registros.r2={id:'r2',importacionId:'imp',itinerarioId:'it1',fila:3,
    datos:{'Local Vacío':'0','Nombre del negocio':'Peluquería Sol',
      Dirección:'Calle Nueva',Num:'5',GrActividad:'',
      'Subgrupo de actividad':'',Actividad:''}};
  db.registros.r3={id:'r3',importacionId:'imp',itinerarioId:'it1',fila:4,
    datos:{'Local Vacío':'1','Nombre del negocio':'',
      Dirección:'Calle Nueva',Num:'7','Long fachada':'6'}};
  return db;
}

/** Ficticio con la forma real de IT1: 105 filas, 66 ocupadas (57 con categoría y 9 sin ella). */
function fixture66(): BaseDatos {
  const db=base();
  for (let n=1;n<=105;n++) {
    const vacio=n>66;
    const conCategoria=!vacio&&n<=57;
    db.registros['r'+n]={id:'r'+n,importacionId:'imp',itinerarioId:'it1',fila:n+1,
      datos:{'Local Vacío':vacio?'1':'0','Nombre del negocio':vacio?'':'Negocio ficticio '+n,
        Dirección:'Calle Ficticia',Num:String(n),
        GrActividad:conCategoria?'Servicios':'',
        'Subgrupo de actividad':conCategoria?'Reparaciones':'',
        Actividad:conCategoria?'Reparaciones':''}};
  }
  return db;
}

/** Celdas del Excel para una categoría del catálogo 2026 (datos ficticios). */
function celdas(v: ValoresCategoria): Record<string,string> {
  return {GrActividad:v.grupoActividad,'Gr Comercio':v.grupoComercio,
    'Subgrupo de actividad':v.subgrupo,Actividad:v.actividad,'Descripción':v.descripcionActividad};
}
const carniceria=()=>categoriasDelCatalogo(
  OPCIONES_CATEGORIAS_2026.find((o)=>o.etiqueta.includes('Carnicería'))!.id);

function Pantalla({ inicial=fixture }: { inicial?: () => BaseDatos }) {
  const [db,setDb]=useState(inicial);
  const [version,setVersion]=useState(20);
  const [estadoColaCategoriaIT1,setEstadoColaCategoriaIT1]=useState<EstadoColaCategoriaIT1>({
    pendientes:[],error:'',
  });
  const colaRef=useRef<ReturnType<typeof crearColaCategoriaIT1> | null>(null);
  const aplicarRevisionCategoriaReal=(cambio: CambioCategoriaIT1)=>{
    setDb((prev)=>({...prev,revisionesCategoriaRegistros:{
      ...(prev.revisionesCategoriaRegistros??{}),
      [cambio.registroId]: cambio.revision,
    }}));
    setVersion(cambio.version);
  };
  const encolarCategoriaIT1: NonNullable<import('../../store/fuenteOficina').FuenteOficina['encolarCategoriaIT1']> = (decision) => {
    if (!colaRef.current) colaRef.current=crearColaCategoriaIT1(
      version,guardarCategoriaIT1,aplicarRevisionCategoriaReal,setEstadoColaCategoriaIT1,
    );
    return colaRef.current.encolar(decision);
  };
  return <FuenteOficinaContext.Provider value={{
    db,campanaId:'c26',personaId:'responsable',roles:['coordinador'],
    soloLectura:true,aplicar:()=>false,versionReal:version,aplicarRevisionCategoriaReal,
    estadoColaCategoriaIT1, encolarCategoriaIT1,
    reintentarColaCategoriaIT1:()=>colaRef.current?.reintentar(),
  }}><MemoryRouter><CategoriaIT1/></MemoryRouter></FuenteOficinaContext.Provider>;
}

const paso1=()=>screen.getByRole('region',{name:'Paso 1 · Validar categoría'});
const paso2=()=>screen.getByRole('region',{name:'Paso 2 · Categorizar'});
const resumen=()=>screen.getByRole('status',{name:'Estado del guardado'});
const tecla=(key: string)=>fireEvent.keyDown(document.body,{key});
const listo=()=>waitFor(()=>expect(within(paso1()).getByRole('button',{name:/Correcta/})).toBeEnabled());
const botonPaso=(n: 1|2)=>screen.getByRole('button',{name:new RegExp(n===1?'Validar categorías':'Categorizar pendientes')});

describe('Oficina · categorización IT1 en dos pasos',()=>{
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

  it('paso 1 muestra solo negocios con categoría del Excel; los vacíos no aparecen', async()=>{
    render(<Pantalla/>);
    await listo();
    expect(within(paso1()).getByText('Antenas Eiras')).toBeInTheDocument();
    expect(within(paso1()).getByText(/Servicios › Reparaciones/)).toBeInTheDocument();
    expect(within(paso1()).getByText(/quedan/).textContent).toMatch(/Revisadas 0 de 1/);
    expect(botonPaso(2)).toHaveTextContent('Quedan 1');
    expect(screen.queryByText('Calle Nueva, 7')).not.toBeInTheDocument();
  });

  it('Enter acepta y avanza sin esperar al servidor; solo cuenta como guardada al confirmarse', async()=>{
    let resolver!: (cambio:CambioCategoriaIT1)=>void;
    vi.mocked(guardarCategoriaIT1).mockImplementationOnce(
      () => new Promise<CambioCategoriaIT1>((resolve)=>{ resolver=resolve; }));
    render(<Pantalla/>);
    await listo();
    tecla('Enter');
    // Avance inmediato: el paso 1 queda completado mientras la RPC sigue pendiente.
    expect(within(paso1()).getByText('Paso 1 completado.')).toBeInTheDocument();
    expect(resumen()).toHaveTextContent('1 decisiones por guardar');
    expect(resumen()).toHaveTextContent('0 de 2 con categoría finalizada');
    expect(guardarCategoriaIT1).toHaveBeenCalledWith('r1',20,'aceptar',
      expect.objectContaining({grupoActividad:'Servicios'}));
    await act(async()=>resolver({registroId:'r1',version:21,revision:{
      id:'r1',registroId:'r1',campanaId:'c26',estado:'aceptada',
      valores:{grupoActividad:'Servicios',grupoComercio:'',
        subgrupo:'Reparaciones',actividad:'Reparaciones',descripcionActividad:''},
      porId:'responsable',fecha:'2026-11-24T17:00:00Z',
    }}));
    await waitFor(()=>expect(resumen()).toHaveTextContent('1 de 2 con categoría finalizada'));
    expect(resumen()).toHaveTextContent('0 decisiones por guardar');
    // Aceptada: no vuelve a aparecer como pendiente en ningún paso.
    expect(botonPaso(1)).toHaveTextContent('Completado');
    expect(resumen()).toHaveTextContent('1 pendientes de revisar');
  });

  it('N rechaza sin abrir editor, avanza y el negocio pasa al paso 2 con el Excel como referencia', async()=>{
    render(<Pantalla/>);
    await listo();
    tecla('n');
    expect(within(paso1()).getByText('Paso 1 completado.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(guardarCategoriaIT1).toHaveBeenCalledWith('r1',20,'rechazar',
      expect.objectContaining({subgrupo:'Reparaciones'}));
    expect(botonPaso(2)).toHaveTextContent('Quedan 2');
    await waitFor(()=>expect(resumen()).toHaveTextContent('0 decisiones por guardar'));
    // El rechazo es una decisión guardada en el servidor, pero no finaliza la categorización.
    expect(resumen()).toHaveTextContent('1 decisiones guardadas en el servidor (1 rechazos)');
    expect(resumen()).toHaveTextContent('0 de 2 con categoría finalizada');
    fireEvent.click(botonPaso(2));
    expect(within(paso2()).getByText('Antenas Eiras')).toBeInTheDocument();
    expect(within(paso2()).getByText(/rechazada, solo como referencia/)).toHaveTextContent('Servicios › Reparaciones');
  });

  it('Supr también rechaza; ← vuelve al anterior y permite cambiar la decisión ya guardada', async()=>{
    const db=()=>{ const d=fixture(); d.registros.r4={...d.registros.r1,id:'r4',fila:5,
      datos:{...d.registros.r1.datos,'Nombre del negocio':'Bar Ficticio'}}; return d; };
    render(<Pantalla inicial={db}/>);
    await listo();
    tecla('Delete');
    expect(within(paso1()).getByText('Bar Ficticio')).toBeInTheDocument();
    tecla('ArrowLeft');
    expect(within(paso1()).getByText('Antenas Eiras')).toBeInTheDocument();
    await waitFor(()=>expect(within(paso1()).getByText('Rechazada · guardada')).toBeInTheDocument());
    tecla('Enter');
    // Tras corregir la decisión vuelve al pendiente.
    expect(within(paso1()).getByText('Bar Ficticio')).toBeInTheDocument();
    await waitFor(()=>expect(guardarCategoriaIT1).toHaveBeenLastCalledWith('r1',21,'aceptar',
      expect.objectContaining({subgrupo:'Reparaciones'})));
    await waitFor(()=>expect(resumen()).toHaveTextContent('1 de 3 con categoría finalizada'));
    expect(botonPaso(2)).toHaveTextContent('Quedan 1');
  });

  it('un error de guardado no produce falsos positivos y se puede reintentar', async()=>{
    vi.mocked(guardarCategoriaIT1).mockRejectedValueOnce(new Error('sin conexión'));
    render(<Pantalla/>);
    await listo();
    tecla('Enter');
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Guardado detenido: sin conexión'));
    expect(resumen()).toHaveTextContent('1 decisiones por guardar');
    expect(resumen()).toHaveTextContent('0 de 2 con categoría finalizada');
    fireEvent.click(screen.getByRole('button',{name:'Reintentar guardado'}));
    await waitFor(()=>expect(resumen()).toHaveTextContent('1 de 2 con categoría finalizada'));
    expect(screen.queryByText(/Guardado detenido/)).not.toBeInTheDocument();
  });

  it('paso 2 marca la propuesta por el nombre, pero solo se aplica al pulsar Enter', async()=>{
    render(<Pantalla/>);
    await listo();
    fireEvent.click(botonPaso(2));
    const t=paso2();
    expect(within(t).getByText('Peluquería Sol')).toBeInTheDocument();
    expect(within(t).getByText('Sin categoría en el Excel.')).toBeInTheDocument();
    expect(within(t).getByRole('note')).toHaveTextContent(/Propuesta por el nombre: .*Peluquería/);
    const opcion=within(t).getByRole('option',{selected:true});
    expect(opcion).toHaveTextContent(/Peluquería/);
    // Visible y marcada, pero sin decisión hasta la confirmación explícita.
    expect(guardarCategoriaIT1).not.toHaveBeenCalled();
    fireEvent.keyDown(within(t).getByRole('combobox'),{key:'Enter'});
    await waitFor(()=>expect(guardarCategoriaIT1).toHaveBeenCalledWith('r2',20,'corregir',
      expect.objectContaining({subgrupo:expect.stringMatching(/Peluquer/)})));
    expect(within(paso2()).getByText('Paso 2 completado.')).toBeInTheDocument();
    await waitFor(()=>expect(resumen()).toHaveTextContent('1 de 2 con categoría finalizada'));
  });

  it('los rechazados se categorizan en el paso 2 sin perder decisiones al cambiar de paso', async()=>{
    render(<Pantalla/>);
    await listo();
    tecla('n');
    fireEvent.click(botonPaso(2));
    // Primero el que no tenía categoría (orden del Excel), después el rechazado.
    expect(within(paso2()).getByText('Antenas Eiras')).toBeInTheDocument();
    const buscador=within(paso2()).getByRole('combobox');
    fireEvent.change(buscador,{target:{value:'carniceria'}});
    fireEvent.keyDown(buscador,{key:'Enter'});
    expect(within(paso2()).getByText('Peluquería Sol')).toBeInTheDocument();
    fireEvent.click(botonPaso(1));
    fireEvent.click(botonPaso(2));
    expect(within(paso2()).getByText('Peluquería Sol')).toBeInTheDocument();
    await waitFor(()=>expect(guardarCategoriaIT1).toHaveBeenCalledWith('r1',21,'corregir',
      expect.objectContaining({actividad:'Carnicería'})));
    await waitFor(()=>expect(resumen()).toHaveTextContent('1 de 2 con categoría finalizada'));
  });

  it('IT1 real ficticio: 66 ocupados, 57 en el paso 1 y 9 en el paso 2; navegación inmediata', async()=>{
    // El servidor no responde durante la prueba: la navegación no debe esperar a Supabase.
    vi.mocked(guardarCategoriaIT1).mockImplementation(()=>new Promise<CambioCategoriaIT1>(()=>{}));
    render(<Pantalla inicial={fixture66}/>);
    await listo();
    expect(botonPaso(1)).toHaveTextContent('Quedan 57');
    expect(botonPaso(2)).toHaveTextContent('Quedan 9');
    expect(resumen()).toHaveTextContent('66 pendientes de revisar');
    expect(resumen()).toHaveTextContent('0 de 66 con categoría finalizada');
    const tiempos: number[]=[];
    for (let i=1;i<=10;i++) {
      const t0=performance.now();
      tecla(i%2 ? 'Enter' : 'n');
      tiempos.push(performance.now()-t0);
      expect(within(paso1()).getByText('Negocio ficticio '+(i+1))).toBeInTheDocument();
    }
    expect(Math.max(...tiempos)).toBeLessThan(500);
    expect(botonPaso(1)).toHaveTextContent('Quedan 47');
    expect(botonPaso(2)).toHaveTextContent('Quedan 14');
    expect(resumen()).toHaveTextContent('61 pendientes de revisar');
    expect(resumen()).toHaveTextContent('0 de 66 con categoría finalizada');
    tecla('ArrowLeft');
    expect(within(paso1()).getByText('Negocio ficticio 10')).toBeInTheDocument();
    expect(within(paso1()).getByText('Rechazada · por guardar')).toBeInTheDocument();
  });

  it('contadores: el rechazo guardado no es categoría finalizada; al corregir pasa a finalizada', async()=>{
    render(<Pantalla/>);
    await listo();
    expect(resumen()).toHaveTextContent('0 decisiones guardadas en el servidor');
    tecla('n');
    await waitFor(()=>expect(resumen()).toHaveTextContent('1 decisiones guardadas en el servidor (1 rechazos)'));
    expect(resumen()).toHaveTextContent('0 de 2 con categoría finalizada');
    expect(resumen()).toHaveTextContent('2 pendientes de revisar');
    fireEvent.click(botonPaso(2));
    const buscador=within(paso2()).getByRole('combobox');
    fireEvent.change(buscador,{target:{value:'carniceria'}});
    fireEvent.keyDown(buscador,{key:'Enter'});
    await waitFor(()=>expect(resumen()).toHaveTextContent('1 de 2 con categoría finalizada'));
    // La última decisión de ese negocio ya no es un rechazo: sigue siendo 1 decisión guardada.
    expect(resumen()).toHaveTextContent('1 decisiones guardadas en el servidor');
    expect(resumen()).not.toHaveTextContent('rechazos');
  });

  it('frecuentes: no salen de originales pendientes, sí de categorías aceptadas en el servidor', async()=>{
    const db=()=>{ const d=fixture(); d.registros.r1={...d.registros.r1,
      datos:{...d.registros.r1.datos,...celdas(carniceria())}}; return d; };
    render(<Pantalla inicial={db}/>);
    await listo();
    fireEvent.click(botonPaso(2));
    // Carnicería solo existe como original sin revisar: no se propone como frecuente.
    expect(within(paso2()).queryByText('frecuente')).not.toBeInTheDocument();
    fireEvent.click(botonPaso(1));
    tecla('Enter');
    await waitFor(()=>expect(resumen()).toHaveTextContent('1 de 2 con categoría finalizada'));
    fireEvent.click(botonPaso(2));
    const op=within(paso2()).getByRole('option',{name:/Carnicería/});
    expect(op).toHaveTextContent('frecuente');
    expect(op).toHaveAttribute('aria-selected','false');
  });

  it('una categoría del Excel rechazada no vuelve a aparecer marcada en el paso 2', async()=>{
    const sug=sugerirPorNombre(ID_CATALOGO_2026,'Peluquería Sol').sugerencias;
    expect(sug).toHaveLength(1);
    const peluqueria=categoriasDelCatalogo(sug[0].nodoId,sug[0].descripcion??'');
    const db=()=>{ const d=fixture(); d.registros.r1={...d.registros.r1,
      datos:{...d.registros.r1.datos,'Nombre del negocio':'Peluquería Sol',...celdas(peluqueria)}};
      delete d.registros.r2; return d; };
    render(<Pantalla inicial={db}/>);
    await listo();
    expect(within(paso1()).getByRole('heading',{level:3})).toHaveTextContent(/Peluquer/);
    tecla('n');
    fireEvent.click(botonPaso(2));
    const t=paso2();
    expect(within(t).getByText('Peluquería Sol')).toBeInTheDocument();
    expect(within(t).getByRole('note')).toHaveTextContent(/categoría rechazada del Excel: no se marca/);
    expect(within(t).queryByRole('option',{selected:true})).not.toBeInTheDocument();
    expect(within(t).getByRole('option',{name:/Peluquer/})).toHaveTextContent('rechazada en el Excel');
    fireEvent.keyDown(within(t).getByRole('combobox'),{key:'Enter'});
    // Enter sin elección explícita no guarda nada: solo consta el rechazo.
    await waitFor(()=>expect(resumen()).toHaveTextContent('0 decisiones por guardar'));
    expect(guardarCategoriaIT1).toHaveBeenCalledTimes(1);
    expect(guardarCategoriaIT1).toHaveBeenCalledWith('r1',20,'rechazar',expect.anything());
    expect(within(paso2()).getByText('Peluquería Sol')).toBeInTheDocument();
  });

  it('un negocio sin categoría en el Excel sí recibe la propuesta marcada (sin rechazo previo)', async()=>{
    render(<Pantalla/>);
    await listo();
    fireEvent.click(botonPaso(2));
    expect(within(paso2()).getByRole('option',{selected:true})).toHaveTextContent(/Peluquería/);
    expect(within(paso2()).queryByText('rechazada en el Excel')).not.toBeInTheDocument();
  });

  it('paso 2: subgrupo + actividad específica libre se guarda como descripción y avanza al instante', async()=>{
    const db=()=>{ const d=fixture(); d.registros.r2={...d.registros.r2,
      datos:{...d.registros.r2.datos,'Nombre del negocio':'Oficina de Empleo de Medina del Campo'}}; return d; };
    render(<Pantalla inicial={db}/>);
    await listo();
    fireEvent.click(botonPaso(2));
    const caja=within(paso2()).getByRole('combobox');
    fireEvent.change(caja,{target:{value:'organismos oficiales'}});
    fireEvent.keyDown(caja,{key:'Enter'});
    const campo=within(paso2()).getByRole('combobox',{name:/Actividad específica/});
    fireEvent.change(campo,{target:{value:'Oficina de empleo'}});
    fireEvent.keyDown(campo,{key:'Enter'});
    expect(within(paso2()).getByText('Paso 2 completado.')).toBeInTheDocument();
    await waitFor(()=>expect(guardarCategoriaIT1).toHaveBeenCalledWith('r2',20,'corregir',{
      grupoActividad:'Servicios',grupoComercio:'',subgrupo:'Organismos Oficiales',
      actividad:'',descripcionActividad:'Oficina de empleo'}));
    await waitFor(()=>expect(resumen()).toHaveTextContent('1 de 2 con categoría finalizada'));
  });
});
