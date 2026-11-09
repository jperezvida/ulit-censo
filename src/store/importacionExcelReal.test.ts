import { describe, expect, it } from 'vitest';
import { baseVacia, type BaseDatos } from '../domain/db';
import type { Campana, Importacion, Itinerario, RegistroOrigen, VinculoHistorico } from '../domain/types';
import { prepararCambiosExcel } from './importacionExcelReal';

const SHA='a'.repeat(64);
const CAMP26='real-camp-medina-2026-censo-medina-del-campo-2026';
const CAMP25='camp-hist-real-mun-medina-2025-9e367ca51c';
function fixture() {
  const antes=baseVacia();
  antes.meta={espacio:'real',espacioId:'real-medina-del-campo-2026'};
  antes.campanas[CAMP26]={id:CAMP26,tipo:'actualizacion',anio:2026} as Campana;
  antes.campanas[CAMP25]={id:CAMP25,tipo:'historico-importado',anio:2025} as Campana;
  antes.registros['r25']={id:'r25',importacionId:'imp25',fila:2,datos:{'Nombre del negocio':'Historia'}} as RegistroOrigen;
  const despues:BaseDatos={...antes,
    secuencia:antes.secuencia+1,
    itinerarios:{...antes.itinerarios,'real-it-it2':{
      id:'real-it-it2',codigo:'IT2',campanaId:CAMP26,origen:'excel'
    } as Itinerario},
    importaciones:{...antes.importaciones,'imp-it2':{
      id:'imp-it2',tipo:'C-excel-itinerario',estado:'confirmada',
      campanaId:CAMP26,huella:SHA,filas:1,
      c1:{sha256:SHA,itinerario:{id:'real-it-it2',codigo:'IT2'}},
    } as unknown as Importacion},
    registros:{...antes.registros,'r26':{
      id:'r26',importacionId:'imp-it2',itinerarioId:'real-it-it2',
      fila:2,datos:{Dirección:'Calle ficticia'}
    } as RegistroOrigen},
    vinculos:{...antes.vinculos,'v26':{
      id:'v26',origen:{tipo:'registro',id:'r26'},localId:null,
    } as VinculoHistorico},
  };
  return {antes,despues};
}

describe('Guardado de Excel real · control client-side sin tocar Supabase',()=>{
  it('genera exclusivamente altas IT2 y un aumento de secuencia',()=>{
    const {antes,despues}=fixture();
    const cambios=prepararCambiosExcel(antes,despues,'IT2',SHA,false);
    expect(cambios.filter(c=>c.c==='registros')).toHaveLength(1);
    expect(cambios.filter(c=>c.c==='vinculos')).toHaveLength(1);
    expect(cambios.filter(c=>c.c==='importaciones')).toHaveLength(1);
    expect(cambios.some(c=>c.c==='campanas')).toBe(false);
    expect(antes.registros['r25'].datos['Nombre del negocio']).toBe('Historia');
  });
  it('permite únicamente pendientes sin aumento artificial de secuencia',()=>{
    const {antes,despues}=fixture();
    despues.secuencia=antes.secuencia;
    const cambios=prepararCambiosExcel(antes,despues,'IT2',SHA,false);
    expect(cambios.some(c=>c.c==='_raiz')).toBe(false);
  });
  it('rechaza manipular histórico, campañas o registros ya guardados',()=>{
    const {antes,despues}=fixture();
    despues.campanas={...despues.campanas,[CAMP25]:{...despues.campanas[CAMP25],nombre:'histórico adulterado'}};
    expect(()=>prepararCambiosExcel(antes,despues,'IT2',SHA,false)).toThrow(/modifica datos anteriores/);
    const d=fixture();
    d.despues.registros={...d.despues.registros,r25:{...d.despues.registros.r25,datos:{'Nombre del negocio':'Cambiado'}}};
    expect(()=>prepararCambiosExcel(d.antes,d.despues,'IT2',SHA,false)).toThrow(/modifica datos anteriores/);
  });
  it('rechaza metadatos de huella o destino distintos y archivos duplicados',()=>{
    const d=fixture();
    expect(()=>prepararCambiosExcel(d.antes,d.despues,'IT3',SHA,false)).toThrow(/un único Excel/);
    expect(()=>prepararCambiosExcel(d.antes,d.despues,'IT2','f'.repeat(64),false)).toThrow(/un único Excel/);
    d.antes.importaciones['importado']={id:'importado',campanaId:CAMP26,huella:SHA,estado:'confirmada'} as Importacion;
    expect(()=>prepararCambiosExcel(d.antes,d.despues,'IT2',SHA,false)).toThrow(/ya se encuentra incorporado/);
  });
  it('impide borrar un registro o modificar la raíz fuera de la secuencia',()=>{
    const d=fixture();
    delete d.despues.registros.r25;
    expect(()=>prepararCambiosExcel(d.antes,d.despues,'IT2',SHA,false)).toThrow(/modifica datos anteriores/);
    const e=fixture();
    e.despues.meta={...e.despues.meta,otro:'inseguro'};
    expect(()=>prepararCambiosExcel(e.antes,e.despues,'IT2',SHA,false)).toThrow(/configuración real/);
  });
});
