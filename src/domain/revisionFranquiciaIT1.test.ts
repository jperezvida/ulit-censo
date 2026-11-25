import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import { prepararFranquiciasIT1, pendientesFranquiciaIT1 } from './revisionFranquiciaIT1';
import { exportarRevisionGeneral } from './exportacionRevisionGeneral';
import type { RevisionFranquiciaRegistro } from './types';

function fixture() {
  const db=baseVacia();
  db.campanas.c26={id:'c26',municipioId:'medina',anio:2026,nombre:'Censo 2026',
    tipo:'actualizacion',periodo:{inicio:'2026-01-01'},ambitoCalleIds:[],ampliacionCalleIds:[],
    estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},
    procedencia:'importado'};
  db.campanas.c25={...db.campanas.c26,id:'c25',anio:2025,tipo:'historico-importado'};
  db.itinerarios.it1={id:'it1',campanaId:'c26',codigo:'IT1',nombre:'IT1',
    origen:'excel',color:'#123',tramos:[],asignadosIds:[],creado:'2026-10-01'};
  db.importaciones.imp={id:'imp',campanaId:'c26',municipioId:'medina',tipo:'C-excel-itinerario',
    archivo:'IT1.xlsx',huella:'abc',fecha:'2026-10-01',filas:105,estado:'confirmada',
    resumen:{},procedencia:'importado'};
  for(let n=1;n<=105;n++){
    const vacio=n>66;
    db.registros['r'+n]={id:'r'+n,importacionId:'imp',itinerarioId:'it1',fila:n+1,
      datos:{'Nombre del negocio':vacio?'':'Negocio ficticio '+n,'Local Vacío':vacio?'1':'0',
        'Franquicia':vacio?'':n<=27?'0':n<=30?'1':''}};
  }
  return db;
}
const revisión=(id:string,estado:RevisionFranquiciaRegistro['estado'],respuesta?:'si'|'no',masiva=false):RevisionFranquiciaRegistro=>
  ({id,registroId:id,campanaId:'c26',estado,respuesta,masiva,porId:'revisor',fecha:'2026-11-25T10:00:00Z'});

describe('IT1 · franquicias por fila Excel en dos pasos',()=>{
  it('de 66 ocupados, 30 con datos van a revisión; 36 vacíos, al segundo paso; locales vacíos fuera',()=>{
    const db=fixture();
    const filas=prepararFranquiciasIT1(db,'c26');
    expect(filas).toHaveLength(66);
    expect(filas.filter(f=>f.paso===1)).toHaveLength(30);
    expect(filas.filter(f=>f.paso===2)).toHaveLength(36);
    expect(filas.find(f=>f.fila.id==='r1')?.propuesta).toBe('no');
    expect(filas.find(f=>f.fila.id==='r28')?.propuesta).toBe('si');
    expect(filas.find(f=>f.fila.id==='r31')?.propuesta).toBeNull();
    expect(prepararFranquiciasIT1(db,'c25')).toEqual([]);
  });
  it('Enter confirma la propuesta sin modificar el Excel; Supr rechaza y lleva a nuevos',()=>{
    const db=fixture();
    const original=JSON.stringify(db.registros);
    db.revisionesFranquiciaRegistros!['r1']=revisión('r1','aceptada','no');
    db.revisionesFranquiciaRegistros!['r28']=revisión('r28','rechazada');
    const filas=prepararFranquiciasIT1(db,'c26');
    expect(filas.find(f=>f.fila.id==='r1')).toMatchObject({confirmada:true,paso:1});
    expect(filas.find(f=>f.fila.id==='r28')).toMatchObject({confirmada:false,paso:2});
    const cola=[{ids:['r28'],accion:'resolver' as const,respuesta:'no' as const}];
    const pendientes=pendientesFranquiciaIT1(filas,cola);
    expect(pendientes.find(f=>f.fila.id==='r28')).toMatchObject({paso:2,pendiente:false,confirmada:false});
    expect(JSON.stringify(db.registros)).toBe(original);
  });
  it('aceptar todos solo confirma las propuestas 0/1; el blanco no equivale a NO',()=>{
    const db=fixture();
    for(let n=1;n<=30;n++)
      db.revisionesFranquiciaRegistros!['r'+n]=revisión('r'+n,'aceptada',n<=27?'no':'si',true);
    const filas=prepararFranquiciasIT1(db,'c26');
    expect(filas.filter(f=>f.confirmada)).toHaveLength(30);
    expect(filas.filter(f=>!f.confirmada)).toHaveLength(36);
    expect(filas.filter(f=>f.revision?.masiva)).toHaveLength(30);
    expect(filas[30].revision).toBeUndefined();
  });
  it('corrección 1/0 y auditoría se exportan; rechazos no se dan por finalizados',()=>{
    const db=fixture();
    db.revisionesFranquiciaRegistros!['r1']=revisión('r1','corregida','si');
    db.revisionesFranquiciaRegistros!['r2']=revisión('r2','rechazada');
    db.revisionesFranquiciaRegistros!['r3']=revisión('r3','aceptada','no',true);
    const exp=exportarRevisionGeneral(db,'c26','it1');
    expect(exp.filas[0]['Franquicia']).toBe('1');
    expect(exp.filas[0]['ULIT · Revisión franquicia']).toBe('Corregida');
    expect(exp.filas[1]['Franquicia']).toBe('0');
    expect(exp.filas[1]['ULIT · Revisión franquicia']).toBe('Rechazada (pendiente)');
    expect(exp.filas[2]['Franquicia']).toBe('0');
    expect(exp.filas[2]['ULIT · Revisión franquicia']).toBe('Aceptada (confirmación masiva)');
    expect(exp.filas[66]['Franquicia']).toBe('');
    expect(exp.filas[66]['ULIT · Revisión franquicia']).toBe('No aplica');
    expect(db.registros.r1.datos.Franquicia).toBe('0');
    expect(exportarRevisionGeneral(db,'c25').filas).toEqual([]);
  });
});
