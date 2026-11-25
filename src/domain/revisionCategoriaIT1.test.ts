import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import { resumenItinerarios, type FilaOficina } from './oficina';
import { categoriasDelCatalogo, categoriasFrecuentes, categoriaTexto, claveCategoria2026,
  mismaCategoria, opcionEquivaleA, OPCIONES_CATEGORIAS_2026, prepararRevisionCategoriaIT1,
  repartirPasosCategoria,
} from './revisionCategoriaIT1';

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

describe('Categorización IT1 · reparto en dos pasos',()=>{
  const carniceria=()=>categoriasDelCatalogo(
    OPCIONES_CATEGORIAS_2026.find(o=>o.etiqueta.includes('Carnicería'))!.id);
  it('57 al paso 1 y 9 al paso 2; ninguno guardado sin confirmación del servidor',()=>{
    const filas=repartirPasosCategoria(prepararRevisionCategoriaIT1(fixture(),'c26'),[]);
    expect(filas.filter(f=>f.paso===1&&f.pendiente)).toHaveLength(57);
    expect(filas.filter(f=>f.paso===2&&f.pendiente)).toHaveLength(9);
    expect(filas.filter(f=>f.confirmada)).toHaveLength(0);
  });
  it('rechazar mueve al paso 2 (en cola o guardado); aceptar deja de estar pendiente sin contar como guardado',()=>{
    const db=fixture();
    const filas=prepararRevisionCategoriaIT1(db,'c26');
    const [r1,r2]=filas;
    const cola=[{registroId:'r1',accion:'rechazar' as const,valores:r1.efectivos},
      {registroId:'r2',accion:'aceptar' as const,valores:r2.efectivos}];
    const p=repartirPasosCategoria(filas,cola);
    expect(p[0]).toMatchObject({paso:2,pendiente:true,confirmada:false});
    expect(p[1]).toMatchObject({paso:1,pendiente:false,confirmada:false});
    db.revisionesCategoriaRegistros!.r1={id:'r1',registroId:'r1',campanaId:'c26',estado:'rechazada',
      valores:r1.efectivos,porId:'responsable',fecha:'2026-11-24T10:00:00Z'};
    const guardado=repartirPasosCategoria(prepararRevisionCategoriaIT1(db,'c26'),[]);
    expect(guardado[0]).toMatchObject({paso:2,pendiente:true,confirmada:false});
    // Elegir nueva categoría en cola: deja de estar pendiente y muestra la elegida.
    const corr=repartirPasosCategoria(prepararRevisionCategoriaIT1(db,'c26'),
      [{registroId:'r1',accion:'corregir',valores:carniceria()}]);
    expect(corr[0]).toMatchObject({paso:2,pendiente:false,confirmada:false});
    expect(corr[0].visibles.actividad).toBe('Carnicería');
    expect(corr[0].existentes.subgrupo).toBe('Reparaciones');
  });
  it('las frecuentes solo cuentan decisiones aceptadas o corregidas confirmadas por el servidor',()=>{
    const db=fixture();
    const v=carniceria();
    const clave=claveCategoria2026(v)!;
    expect(clave).toBeDefined();
    // Originales pendientes de revisar con una categoría coherente: NO cuentan.
    for (const n of [1,2,3]) Object.assign(db.registros['r'+n].datos,{GrActividad:v.grupoActividad,
      'Gr Comercio':v.grupoComercio,'Subgrupo de actividad':v.subgrupo,Actividad:v.actividad});
    const filas=prepararRevisionCategoriaIT1(db,'c26');
    expect(claveCategoria2026(filas[0].existentes)).toBe(clave);
    expect(categoriasFrecuentes(filas)).toEqual([]);
    // Aceptada en el servidor: cuenta.
    const rev=(id:string,estado:'aceptada'|'rechazada'|'corregida',valores=v)=>{
      db.revisionesCategoriaRegistros![id]={id,registroId:id,campanaId:'c26',estado,
        valores,porId:'responsable',fecha:'2026-11-24T10:00:00Z'}; };
    rev('r1','aceptada',filas[0].existentes);
    expect(categoriasFrecuentes(prepararRevisionCategoriaIT1(db,'c26'))).toEqual([clave]);
    // Rechazada: no cuenta, aunque la categoría sea coherente.
    rev('r1','rechazada',filas[0].existentes);
    expect(categoriasFrecuentes(prepararRevisionCategoriaIT1(db,'c26'))).toEqual([]);
    // Corregida en el paso 2: cuenta.
    rev('r58','corregida');
    expect(categoriasFrecuentes(prepararRevisionCategoriaIT1(db,'c26'))).toEqual([clave]);
  });
  it('reconoce la opción equivalente a una categoría rechazada (ignora la descripción)',()=>{
    const v=carniceria();
    const op=OPCIONES_CATEGORIAS_2026.find(o=>o.etiqueta.includes('Carnicería'))!;
    expect(opcionEquivaleA(op.id,v)).toBe(true);
    expect(opcionEquivaleA(op.id,{...v,descripcionActividad:'otra'})).toBe(true);
    expect(mismaCategoria(v,{...v,actividad:'carniceria '})).toBe(true);
    const otra=OPCIONES_CATEGORIAS_2026.find(o=>!o.etiqueta.includes('Carnicería')&&!o.requiereDescripcion)!;
    expect(opcionEquivaleA(otra.id,v)).toBe(false);
    expect(opcionEquivaleA('a1-comercio',v)).toBe(false);
  });
});

/** Los paneles de Oficina y Excel miden universos distintos: nunca trasferir estados por proximidad. */
describe('IT1 · coherencia de progreso entre Excel y locales físicos', () => {
  it('muestra 66 decisiones del Excel sin dar por categorizados los 6 locales físicos', () => {
    const db = fixture();
    const origen = JSON.stringify(db.registros);
    // Simula seis locales físicos ocupados sin revisión propia; no se deduce una equivalencia
    // con ninguna de las 66 filas, aunque todas hayan sido revisadas.
    const locales = Array.from({ length: 6 }, (_, n) => ({
      localId: 'local-' + n, itinerarioIds: ['it1'], situacion: 'registrado', vacio: false,
      rev: { categorizacion: 'pendiente', digital: 'pendiente' },
      incidencias: [], avisos: [], errores: [], cronologiaIncierta: [],
    } as unknown as FilaOficina));
    const it1 = () => resumenItinerarios(db, 'c26', locales).find((r) => r.codigo === 'IT1')!;
    expect(it1().categorizacionExcel).toEqual({ hechos: 0, pendientes: 66 });
    expect(it1().categorizacion).toEqual({ hechos: 0, pendientes: 6 });

    const carniceria = categoriasDelCatalogo(
      OPCIONES_CATEGORIAS_2026.find((o) => o.etiqueta.includes('Carnicería'))!.id);
    for (const f of prepararRevisionCategoriaIT1(db, 'c26')) {
      db.revisionesCategoriaRegistros![f.fila.id] = {
        id: f.fila.id, registroId: f.fila.id, campanaId: 'c26',
        estado: f.tienePropuesta ? 'aceptada' : 'corregida',
        valores: f.tienePropuesta ? f.existentes : carniceria,
        porId: 'responsable', fecha: '2026-11-25T10:00:00Z',
      };
    }
    expect(it1().categorizacionExcel).toEqual({ hechos: 66, pendientes: 0 });
    expect(it1().categorizacion).toEqual({ hechos: 0, pendientes: 6 });
    expect(locales.every((f) => f.rev.categorizacion === 'pendiente')).toBe(true);
    expect(JSON.stringify(db.registros)).toBe(origen);
    expect(resumenItinerarios(db, 'c26', locales).find((r) => r.codigo === 'IT2')?.categorizacionExcel).toBeUndefined();

    db.revisionesCategoriaRegistros!.r1.estado = 'rechazada';
    expect(it1().categorizacionExcel).toEqual({ hechos: 65, pendientes: 1 });
    expect(it1().categorizacion).toEqual({ hechos: 0, pendientes: 6 });
    expect(resumenItinerarios(db, 'c25', locales).every((r) => !r.categorizacionExcel)).toBe(true);
  });
});
