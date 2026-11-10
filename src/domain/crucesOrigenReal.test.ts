import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import { crucesDeOrigenSinCalle } from './crucesOrigenReal';
import type { BaseDatos } from './db';
import type { Campana, Itinerario, RegistroOrigen } from './types';
import type { FilaInterpretada, Portal } from './xlsx/interpretacion';

function escenario(): BaseDatos {
  const db = baseVacia();
  db.meta.espacio = 'real';
  db.campanas.c26 = { id:'c26', anio:2026, municipioId:'m', tipo:'actualizacion' } as Campana;
  db.itinerarios.it2 = { id:'it2', codigo:'IT2', campanaId:'c26' } as Itinerario;
  db.itinerarios.it3 = { id:'it3', codigo:'IT3', campanaId:'c26' } as Itinerario;
  for (const [fila, num, nombre, vacio] of [
    [2,'1','Tleanm Administración de Fincas','0'],
    [3,'1','Clinica Dental Medina','0'],
    [12,'27','Tanya Nail Studio','0'],
    [13,'27','Foncal Intalaciones','0'],
    [14,'4','Silvia Pariente Hair Style','0'],
    [16,'4','','1'],
    [18,'6','Silueta y Salud','0'],
    [21,'14','','1'],
  ]) {
    const id='r'+fila;
    db.registros[id] = { id, fila:Number(fila), itinerarioId:'it2', importacionId:'imp',
      datos:{ 'Dirección':'Calle Ronda De Gracia','Num':num,
        'Nombre del negocio':nombre,'Local Vacío':vacio } } as RegistroOrigen;
  }
  return db;
}
function actual(fila:number, numero:number, nombre:string, vacio:boolean) {
  const portal: Portal = { tipo:'numero', numero };
  return { fi: { fila, local:vacio?'vacio':'ocupado', celdas: {
    direccion: { estado:'valido', valor:'Calle Ronda De Gracia' },
    numero: { estado:'valido', valor:portal },
    nombre: { estado:'valido', valor:nombre },
  }} as unknown as FilaInterpretada, portal };
}

describe('IT3 · comparar Excel originales aunque IT2 carezca de calle reconocida', () => {
  it('detecta coincidencias, diferencias de estado y portales sin fusionar', () => {
    const db=escenario(), antes=JSON.stringify(db);
    const filas=[actual(63,1,'Tleanm Administración de Fincas',false),
      actual(73,27,'',true),actual(79,6,'Silueta y Salud',false),
      actual(81,14,'',true)];
    const cruces=crucesDeOrigenSinCalle(db,'c26','it3',filas);
    expect(cruces).toHaveLength(4);
    expect(cruces.map(x=>x.tipo)).toEqual([
      'posible-duplicado','contradiccion','posible-duplicado','portal-compartido']);
    expect(cruces.every(x=>x.itinerario==='IT2')).toBe(true);
    expect(JSON.stringify(db)).toBe(antes);
  });
  it('no equipara calles diferentes, otros números ni sufijos', () => {
    const db=escenario(), a=actual(70,1,'Clinica Dental Medina',false),
      b=actual(72,1,'Clinica Dental Medina',false),
      c=actual(74,99,'',true);
    a.fi.celdas.direccion!.valor='Calle Ronda de las Flores';
    b.portal={tipo:'numero',numero:1,sufijo:'A'};
    expect(crucesDeOrigenSinCalle(db,'c26','it3',[a,b,c])).toHaveLength(0);
  });
  it('excluye los registros ya interpretados como observaciones', () => {
    const db=escenario();
    db.observaciones.obs={id:'obs',registroId:'r2',itinerarioId:'it2',campanaId:'c26'} as BaseDatos['observaciones'][string];
    const cruces=crucesDeOrigenSinCalle(db,'c26','it3',[actual(63,1,'Tleanm Administración de Fincas',false)]);
    expect(cruces).toHaveLength(1);
    expect(cruces[0].tipo).toBe('portal-compartido');
    expect(crucesDeOrigenSinCalle(db,'c26','it2',[actual(63,1,'Tleanm Administración de Fincas',false)])).toHaveLength(0);
  });
});
