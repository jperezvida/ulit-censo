import { describe, expect, it } from 'vitest';
import { baseVacia, type BaseDatos } from './db';
import { ID_CATALOGO_2026 } from './catalogo2026';
import { categoriaEfectivaFila, obtenerCategorizacionItinerario } from './categorizacionItinerarios';
import { auditarRevisionGeneral } from './revisionGeneral';

const CAT='c26';
export function escenarioCategorias(total=105): BaseDatos {
  const db=baseVacia();
  db.municipios.medina={id:'medina',nombre:'Medina del Campo',provincia:'Valladolid',fuenteCallejero:'osm'};
  db.campanas[CAT]={id:CAT,municipioId:'medina',anio:2026,nombre:'Censo 2026',
    tipo:'actualizacion',periodo:{inicio:'2026-01-01'},ambitoCalleIds:[],ampliacionCalleIds:[],
    estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},
    procedencia:'importado'};
  db.campanas.c25={...db.campanas[CAT],id:'c25',anio:2025,nombre:'Histórico 2025',tipo:'historico-importado'};
  db.itinerarios.it1={id:'it1',campanaId:CAT,codigo:'IT1',nombre:'Primero',
    origen:'excel',color:'#009',tramos:[],asignadosIds:[],creado:'2026-11-01'};
  db.itinerarios.it2={...db.itinerarios.it1,id:'it2',codigo:'IT2'};
  db.importaciones.imp={id:'imp',municipioId:'medina',campanaId:CAT,
    tipo:'C-excel-itinerario',archivo:'ITINERARIO 1.xlsx',huella:'abc',
    fecha:'2026-11-01',filas:total,estado:'confirmada',resumen:{},procedencia:'importado'};
  db.importaciones.h={...db.importaciones.imp,id:'h',campanaId:'c25',filas:1};
  for(let i=1;i<=total;i++){
    const ocupado=i<=66;
    const categoria=i<=57;
    db.registros['r'+i]={id:'r'+i,importacionId:'imp',itinerarioId:'it1',fila:i+1,
      datos:{'Dirección':'Calle Mayor','Num':'5',
        'Local Vacío':ocupado?'0':'1','Long fachada':ocupado?'':'4',
        'Nombre del negocio':ocupado?'Negocio '+i:'',
        'GrActividad':categoria?'Comercio':'',
        'Gr Comercio':categoria?'Alimentación':'',
        'Subgrupo de actividad':categoria?'Pan y Lácteos':'',
        'Actividad':categoria?'Panadería':''}};
  }
  db.registros.h={id:'h',importacionId:'h',fila:4,datos:{'Nombre del negocio':'2025','Local Vacío':'0'}};
  return db;
}

describe('Categorización de itinerarios · lectura auténtica por fila de Excel',()=>{
  it('incluye 105 filas: 66 ocupados, 39 vacíos, 57 clasificaciones anteriores y 9 sin clasificar',()=>{
    const db=escenarioCategorias();
    const original=structuredClone(db.registros);
    const a=obtenerCategorizacionItinerario(db,CAT,'it1');
    expect(a.importacionCompleta).toBe(true);
    expect(a).toMatchObject({registrosTotales:105,ocupados:66,vacios:39,conCategoria:57,
      sinCategoria:9,revisados:0,pendientes:66});
    expect(a.filas).toHaveLength(66);
    expect(a.filas.map(f=>f.id)).toHaveLength(66);
    expect(a.filas[0].tieneCategoria).toBe(true);
    expect(a.filas[0].equivalente?.nodoId).toBe('c26.C.A.pan-y-lacteos.panaderia');
    expect(a.filas[60].tieneCategoria).toBe(false);
    expect(db.registros).toEqual(original);
  });
  it('el mismo portal puede tener muchos establecimientos diferentes sin deduplicarlos',()=>{
    const a=obtenerCategorizacionItinerario(escenarioCategorias(),CAT,'it1');
    expect(a.filas.filter(f=>f.origen.numero==='5')).toHaveLength(66);
    expect(new Set(a.filas.map(f=>f.id)).size).toBe(66);
  });
  it('nunca acepta automáticamente categorías del Excel; requiere decisión humana y nombre vigente',()=>{
    const db=escenarioCategorias();
    const primera=obtenerCategorizacionItinerario(db,CAT,'it1').filas[0];
    const valores={...primera.existente};
    const nodo='c26.C.A.pan-y-lacteos.panaderia';
    db.revisionesCategoriaRegistros!.r1={
      id:'r1',registroId:'r1',itinerarioId:'it1',campanaId:CAT,
      catalogoId:ID_CATALOGO_2026,estado:'aceptada',nodoId:nodo,
      descripcion:'',valores,nombreRevisado:'Negocio 1',fecha:'2026-11-16T10:00:00Z',porId:'admin',
    };
    let a=obtenerCategorizacionItinerario(db,CAT,'it1');
    expect(a.revisados).toBe(1);
    expect(a.pendientes).toBe(65);
    // Si cambia el ocupante, la confirmación anterior deja de ser válida.
    db.correccionesRegistros!.r1={id:'r1',registroId:'r1',campanaId:CAT,
      valores:{nombre:'Nuevo ocupante'},fecha:'2026-11-16T10:01:00Z',
      motivo:'Nueva visita',porId:'admin',historial:[]};
    a=obtenerCategorizacionItinerario(db,CAT,'it1');
    expect(a.revisados).toBe(0);
    expect(categoriaEfectivaFila(db,a.filas[0].origen)).toMatchObject(valores);
  });
  it('una categoría corregida se exporta solo en 2026 y jamás altera la fuente o el 2025',()=>{
    const db=escenarioCategorias();
    const originales=structuredClone(db.registros);
    db.revisionesCategoriaRegistros!.r58={
      id:'r58',registroId:'r58',itinerarioId:'it1',campanaId:CAT,
      catalogoId:ID_CATALOGO_2026,estado:'corregida',
      nodoId:'c26.C.A.pan-y-lacteos.panaderia',
      valores:{grupoActividad:'Comercio',grupoComercio:'Alimentación',
        subgrupo:'Pan y Lácteos',actividad:'Panadería',descripcionActividad:''},
      nombreRevisado:'Negocio 58',fecha:'2026-11-16T10:00:00Z',porId:'admin',
    };
    const row=auditarRevisionGeneral(db,CAT).filas.find(f=>f.id==='r58')!;
    expect(categoriaEfectivaFila(db,row).actividad).toBe('Panadería');
    expect(db.registros).toEqual(originales);
    expect(db.registros.h.datos['Nombre del negocio']).toBe('2025');
  });
  it('rechazar no cuenta como revisado y una importación incompleta bloquea el guardado',()=>{
    const db=escenarioCategorias();
    db.revisionesCategoriaRegistros!.r1={
      id:'r1',registroId:'r1',itinerarioId:'it1',campanaId:CAT,
      catalogoId:ID_CATALOGO_2026,estado:'rechazada',valores:{
        grupoActividad:'',grupoComercio:'',subgrupo:'',actividad:'',descripcionActividad:'',
      },nombreRevisado:'Negocio 1',fecha:'2026-11-16T10:00:00Z',porId:'admin',
    };
    expect(obtenerCategorizacionItinerario(db,CAT,'it1')).toMatchObject({
      rechazados:1,revisados:0,pendientes:66,importacionCompleta:true,
    });
    delete db.registros.r66;
    expect(obtenerCategorizacionItinerario(db,CAT,'it1').importacionCompleta).toBe(false);
  });
  it('la categoría no se guarda en una campaña histórica ni en un itinerario distinto',()=>{
    const db=escenarioCategorias();
    expect(obtenerCategorizacionItinerario(db,'c25','it1').filas).toHaveLength(0);
    expect(obtenerCategorizacionItinerario(db,CAT,'it2').filas).toHaveLength(0);
  });
});
