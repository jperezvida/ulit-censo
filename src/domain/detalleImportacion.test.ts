import { describe, expect, it } from 'vitest';
import { columnasVistaImportacion, notaVisibleImportacion, resumenVinculosImportacion } from './detalleImportacion';
import type { Importacion, RegistroOrigen, VinculoHistorico } from './types';

const fila = (id: string): RegistroOrigen => ({
  id, importacionId:'imp1', fila:Number(id.replace(/\D/g,'')), datos: {
    CP: '47400', Num: id, web:'0', Actividad:'Calzado', Dirección:'Calle Carrera',
    'Nombre del negocio':'Comercio de prueba', 'Local Vacío':'0',
  },
});
const vinculo = (id:string,localId:string|null,confianza:VinculoHistorico['confianza']):VinculoHistorico =>
  ({id:'v-'+id,origen:{tipo:'registro',id},localId,confianza,criterio:'test'});

describe('Ficha real de importación', () => {
  it('distingue con local, sin local y confirmado: 105 no significa 105 sin local', () => {
    const registros=Array.from({length:105},(_,i)=>fila('r'+(i+2)));
    const vinculos=registros.map((r,i)=>vinculo(r.id,i<14?'loc'+i:null,
      i<14?'probable':i<75?'dudosa':'sin-vinculo'));
    expect(resumenVinculosImportacion(registros,vinculos)).toMatchObject({
      conLocal:14,sinLocal:91,confirmados:0,noConfirmados:105,
    });
    vinculos[0]=vinculo(registros[0].id,'loc0','confirmada');
    expect(resumenVinculosImportacion(registros,vinculos)).toMatchObject({
      conLocal:14,sinLocal:91,confirmados:1,noConfirmados:104,
    });
  });
  it('muestra dirección y negocio delante de seguidores, sin perder columnas', () => {
    const f=fila('r2');
    expect(columnasVistaImportacion([f])).toEqual([
      'Dirección','Num','Nombre del negocio','Local Vacío','Actividad',
    ]);
    expect(columnasVistaImportacion([f],true)).toEqual(Object.keys(f.datos));
    expect(columnasVistaImportacion([])).toEqual([]);
  });
  it('corrige la nota heredada del histórico sin cambiar el objeto guardado', () => {
    const imp={ tipo:'C-excel-itinerario',
      nota:'C1c · Censo histórico incorporado como referencia: nada queda revisado, verificado ni validado. Los bytes del archivo no se guardan.',
    } as Importacion;
    const previo=JSON.stringify(imp);
    expect(notaVisibleImportacion(imp)).toContain('Excel de itinerario');
    expect(JSON.stringify(imp)).toBe(previo);
    expect(notaVisibleImportacion({...imp,tipo:'A-censo-historico'}))
      .toBe(imp.nota);
  });
});
