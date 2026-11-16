import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import { categoriasDelCatalogo, categoriaTexto, OPCIONES_CATEGORIAS_2026,
  prepararRevisionCategoriaIT1 } from './revisionCategoriaIT1';

function fixture() {
  const db = baseVacia();
  db.campanas.c26 = { id:'c26', municipioId:'medina', anio:2026, nombre:'Censo 2026',
    tipo:'actualizacion', periodo:{inicio:'2026-01-01'}, ambitoCalleIds:[], ampliacionCalleIds:[],
    estados:{planificacion:'pendiente',campo:'pendiente',revision:'pendiente',validacion:'pendiente'},
    procedencia:'importado' };
  db.campanas.c25 = { ...db.campanas.c26, id:'c25', anio:2025, tipo:'historico-importado' };
  db.itinerarios.it1 = {id:'it1',campanaId:'c26',codigo:'IT1',nombre:'IT1',
    origen:'excel',color:'#123',tramos:[],asignadosIds:[],creado:'2026-10-01'};
  db.itinerarios.it2 = { ...db.itinerarios.it1,id:'it2',codigo:'IT2' };
  db.importaciones.i1 = {id:'i1',campanaId:'c26',municipioId:'medina',tipo:'C-excel-itinerario',
    archivo:'IT1.xlsx',huella:'abc',fecha:'2026-10-01',filas:105,estado:'confirmada',
    resumen:{},procedencia:'importado'};
  db.importaciones.i2 = { ...db.importaciones.i1,id:'i2',archivo:'IT2.xlsx' };
  db.importaciones.h = { ...db.importaciones.i1,id:'h',campanaId:'c25',archivo:'2025.xlsx' };
  for(let n=1;n<=105;n++) {
    const vacio=n>66;
    db.registros['r'+n] = {id:'r'+n,importacionId:'i1',itinerarioId:'it1',fila:n+1,
      datos:{'Local Vacío':vacio?'1':'0','Nombre del negocio':vacio?'':'Negocio '+n,
        'Dirección':'Calle Mayor','Num':String(n%10),
        'GrActividad':!vacio&&n<=57?'Servicios':'',
        'Subgrupo de actividad':!vacio&&n<=57?'Reparaciones':'',
        'Actividad':!vacio&&n<=57?'Reparaciones':''} };
  }
  db.registros.rOtro = { ...db.registros.r3,id:'rOtro',itinerarioId:'it2',importacionId:'i2' };
  db.registros.h = { ...db.registros.r1,id:'h',importacionId:'h' };
  return db;
}

describe('Categorización IT1 · no omitir registros sin conciliar',()=>{
  it('incluye las 105 filas del Excel, pero revisa exclusivamente los 66 ocupados',()=>{
    const db=fixture();
    const original=structuredClone(db.registros);
    const filas=prepararRevisionCategoriaIT1(db,'c26');
    expect(filas).toHaveLength(66);
    expect(filas.filter(f=>f.tienePropuesta)).toHaveLength(57);
    expect(filas.filter(f=>!f.tienePropuesta)).toHaveLength(9);
    expect(db.vinculos).toEqual({});
    expect(db.registros).toEqual(original);
    expect(prepararRevisionCategoriaIT1(db,'c25')).toEqual([]);
  });
  it('ninguna categorización importada está confirmada hasta que la persona acepta',()=>{
    const db=fixture();
    const original=structuredClone(db.registros.r1);
    const f=prepararRevisionCategoriaIT1(db,'c26')[0];
    expect(f.tienePropuesta).toBe(true);
    expect(f.confirmada).toBe(false);
    db.revisionesCategoriaRegistros!.r1 = {
      id:'r1',registroId:'r1',campanaId:'c26',estado:'aceptada',valores:f.existentes,
      porId:'responsable',fecha:'2026-11-16T10:00:00Z',
    };
    expect(prepararRevisionCategoriaIT1(db,'c26')[0].confirmada).toBe(true);
    db.revisionesCategoriaRegistros!.r1.estado='rechazada';
    expect(prepararRevisionCategoriaIT1(db,'c26')[0].confirmada).toBe(false);
    expect(db.registros.r1).toEqual(original);
  });
  it('una categoría del catálogo 2026 se guarda sin usar el catálogo ficticio',()=>{
    const op=OPCIONES_CATEGORIAS_2026.find(o=>o.etiqueta.includes('Carnicería'));
    expect(op).toBeDefined();
    const v=categoriasDelCatalogo(op!.id);
    expect(v.grupoActividad).toBe('Comercio');
    expect(v.subgrupo).toBe('Carnes');
    expect(v.actividad).toBe('Carnicería');
    expect(categoriaTexto(v)).toContain('Carnicería');
    expect(()=>categoriasDelCatalogo('a1-comercio')).toThrow('oficial');
  });
  it('si se corrige una categoría, se muestra la efectiva y no se reescribe el Excel',()=>{
    const db=fixture();
    const nuevo = categoriasDelCatalogo(OPCIONES_CATEGORIAS_2026.find(o=>o.etiqueta.includes('Carnicería'))!.id);
    db.revisionesCategoriaRegistros!.r2={
      id:'r2',registroId:'r2',campanaId:'c26',estado:'corregida',
      valores:nuevo,porId:'responsable',fecha:'2026-11-16T10:00:00Z',
    };
    const f=prepararRevisionCategoriaIT1(db,'c26')[1];
    expect(f.efectivos.actividad).toBe('Carnicería');
    expect(f.confirmada).toBe(true);
    expect(db.registros.r2.datos.Actividad).toBe('Reparaciones');
  });
});
