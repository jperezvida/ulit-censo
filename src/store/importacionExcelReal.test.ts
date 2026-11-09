import { describe, expect, it } from 'vitest';
import { baseVacia, type BaseDatos } from '../domain/db';
import type { Campana, Importacion, Itinerario, RegistroOrigen, VinculoHistorico } from '../domain/types';
import { MAX_CAMBIOS_EXCEL_REAL, diagnosticarTamanoExcel, prepararCambiosExcel } from './importacionExcelReal';

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
    d.despues.importaciones['importado']=d.antes.importaciones['importado'];
    expect(()=>prepararCambiosExcel(d.antes,d.despues,'IT2',SHA,false)).toThrow(/ya se encuentra incorporado/);
  });
  it('diagnostica límites por entidades, bytes y filas sin exponer textos del Excel', () => {
    const d=fixture();
    const normal=diagnosticarTamanoExcel(d.antes,d.despues);
    expect(normal.filas).toBe(1);
    expect(normal.entidades).toBeGreaterThan(2);
    expect(normal.excedeBytes).toBe(false);
    expect(normal.colecciones.some(c=>c.nombre==='registros'&&c.cantidad===1)).toBe(true);
    const grande=fixture();
    grande.despues.registros.r26={...grande.despues.registros.r26,
      datos:{Dirección:'Calle ficticia', observaciones:'x'.repeat(MAX_CAMBIOS_EXCEL_REAL.bytes+1)} };
    const diagnostico=diagnosticarTamanoExcel(grande.antes,grande.despues);
    expect(diagnostico.excedeBytes).toBe(true);
    expect(diagnostico.excedeEntidades).toBe(false);
    expect(()=>prepararCambiosExcel(grande.antes,grande.despues,'IT2',SHA,false))
      .toThrow(/MiB de cambios.*No se ha enviado nada/);
    expect(JSON.stringify(diagnostico)).not.toContain('Calle ficticia');
  });
  it('detecta exceso de entidades aunque no supere el tamaño del JSON', () => {
    const d=fixture();
    const extras=Object.fromEntries(Array.from({length:MAX_CAMBIOS_EXCEL_REAL.entidades},(_,i)=>[
      'vin-extra-'+i, {id:'vin-extra-'+i,origen:{tipo:'registro',id:'r26'},localId:null,confianza:'sin-vinculo',criterio:'prueba'} as VinculoHistorico,
    ]));
    d.despues.vinculos={...d.despues.vinculos,...extras};
    const diagnostico=diagnosticarTamanoExcel(d.antes,d.despues);
    expect(diagnostico.excedeEntidades).toBe(true);
    expect(()=>prepararCambiosExcel(d.antes,d.despues,'IT2',SHA,false))
      .toThrow(/entidades \(máximo 3000\)/);
  });
  it('admite 548 filas y 2383 entidades dentro de la nueva ventana segura',()=>{
    const d=fixture();
    const extraRows=Object.fromEntries(Array.from({length:547},(_,i)=>[
      'r-'+i,{id:'r-'+i,importacionId:'imp-it2',itinerarioId:'real-it-it2',
        fila:i+3,datos:{Dirección:'Calle de ensayo',Num:String(1000+i)} } as RegistroOrigen,
    ]));
    const extraVinculos=Object.fromEntries(Array.from({length:547},(_,i)=>[
      'v-'+i,{id:'v-'+i,origen:{tipo:'registro',id:'r-'+i},localId:null,confianza:'sin-vinculo'} as VinculoHistorico,
    ]));
    // Contadores estructurales sin alterar datos anteriores ni forzar locales.
    d.despues.registros={...d.despues.registros,...extraRows};
    d.despues.vinculos={...d.despues.vinculos,...extraVinculos};
    d.despues.importaciones['imp-it2']={...d.despues.importaciones['imp-it2'],filas:548};
    const diag=diagnosticarTamanoExcel(d.antes,d.despues);
    expect(diag.filas).toBe(548);
    expect(diag.excedeFilas).toBe(false);
    expect(diag.excedeEntidades).toBe(false);
    expect(MAX_CAMBIOS_EXCEL_REAL.entidades).toBeGreaterThan(2383);
    expect(MAX_CAMBIOS_EXCEL_REAL.bytes).toBeGreaterThan(2.66*1048576);
    expect(prepararCambiosExcel(d.antes,d.despues,'IT2',SHA,false).length).toBe(diag.entidades);
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
