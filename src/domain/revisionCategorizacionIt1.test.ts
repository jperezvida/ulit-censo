import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import { revisionCategorizacionIt1, estadoClasificacionDe } from './revisionCategorizacionIt1';
import { auditarRevisionGeneral } from './revisionGeneral';

function fixture() {
 const db=baseVacia();
 db.campanas.c26={id:'c26',municipioId:'m',anio:2026,nombre:'IT1',tipo:'actualizacion',periodo:{inicio:'2026-01-01'},ambitoCalleIds:[],ampliacionCalleIds:[],estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},procedencia:'importado'};
 db.importaciones.imp={id:'imp',municipioId:'m',campanaId:'c26',tipo:'C-excel-itinerario',archivo:'IT1.xlsx',huella:'x',fecha:'2026-11-01',filas:3,estado:'confirmada',resumen:{},procedencia:'importado'};
 db.itinerarios.it1={id:'it1',campanaId:'c26',codigo:'IT1',nombre:'1',origen:'excel',color:'#333',tramos:[],asignadosIds:[],creado:'2026-11-01'};
 db.registros.r2={id:'r2',importacionId:'imp',itinerarioId:'it1',fila:2,datos:{Dirección:'Calle A',Num:'1','Local Vacío':'0','Nombre del negocio':'Tienda A',GrActividad:'Comercio','Subgrupo de actividad':'Carnes',Actividad:'Carnicería'}};
 db.registros.r3={id:'r3',importacionId:'imp',itinerarioId:'it1',fila:3,datos:{Dirección:'Calle A',Num:'2','Local Vacío':'0','Nombre del negocio':'Tienda B'}};
 db.registros.r4={id:'r4',importacionId:'imp',itinerarioId:'it1',fila:4,datos:{Dirección:'Calle A',Num:'3','Local Vacío':'1','Nombre del negocio':'','Long fachada':'4'}};
 return db;
}

describe('Revisión obligatoria de categorías IT1',()=>{
 it('incluye todas las filas aunque solo los ocupados se categorizan',()=>{
  const d=revisionCategorizacionIt1(fixture(),'c26');
  expect(d.registrosOrigen).toBe(3);expect(d.ocupados).toHaveLength(2);
  expect(d.vacios).toBe(1);expect(d.existentes).toBe(1);expect(d.sinCategoria).toBe(1);
  expect(d.pendientes).toBe(2);expect(d.aceptadas).toBe(0);
  expect(d.duplicadas).toEqual([]);expect(d.faltantes).toEqual([]);
 });
 it('clasificación preexistente no está aceptada hasta que se guarda una decisión humana',()=>{
  const db=fixture(),fila=auditarRevisionGeneral(db,'c26').filas.find(f=>f.id==='r2')!;
  expect(estadoClasificacionDe(fila)).toBe('pendiente');
  const valores=revisionCategorizacionIt1(db,'c26').ocupados[0].valoresCategoria;
  db.correccionesRegistros={r2:{id:'r2',registroId:'r2',campanaId:'c26',
    valores:{},fecha:'2026-11-16',porId:'admin',motivo:'Aceptada',historial:[],
    revisionClasificacion:{estado:'aceptada',valores,fecha:'2026-11-16',porId:'admin'}}};
  expect(revisionCategorizacionIt1(db,'c26').aceptadas).toBe(1);
  db.correccionesRegistros.r2.valores.actividad='Panadería';
  expect(revisionCategorizacionIt1(db,'c26').aceptadas).toBe(0);
 });
 it('si la persona rechaza, sigue pendiente hasta sustituir por otra categoría',()=>{
  const db=fixture(),original=structuredClone(db.registros);
  const valores=revisionCategorizacionIt1(db,'c26').ocupados[0].valoresCategoria;
  db.correccionesRegistros={r2:{id:'r2',registroId:'r2',campanaId:'c26',
    valores:{},fecha:'2026-11-16',porId:'admin',motivo:'Rechazada',historial:[],
    revisionClasificacion:{estado:'rechazada',valores,fecha:'2026-11-16',porId:'admin'}}};
  const resultado=revisionCategorizacionIt1(db,'c26');
  expect(resultado.rechazadas).toBe(1);expect(resultado.pendientes).toBe(2);
  expect(db.registros).toEqual(original);
 });
 it('detecta huecos de fila y no confunde dos locales en la misma calle',()=>{
  const db=fixture();delete db.registros.r3;
  db.registros.r2.datos.Num='3';
  expect(revisionCategorizacionIt1(db,'c26').faltantes).toEqual([3]);
  expect(revisionCategorizacionIt1(db,'c26').duplicadas).toEqual([]);
 });
});
