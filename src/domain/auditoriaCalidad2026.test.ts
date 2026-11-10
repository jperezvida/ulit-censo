import { describe, expect, it } from 'vitest';
import { baseVacia } from './db';
import { auditarCalidad2026, incidenciasRegistro2026 } from './auditoriaCalidad2026';
import type { Campana, Importacion, Itinerario, RegistroOrigen } from './types';

function registro(id: string, fila: number, lv: string, nombre: string, fachada: string, resto: Record<string,string> = {}): RegistroOrigen {
  return { id, importacionId:'imp26', itinerarioId:'it2', fila,
    datos:{ 'Local Vacío':lv, 'Nombre del negocio':nombre, 'Long fachada':fachada,
      'Dirección':'Calle de prueba','Num':String(fila), ...resto } } as RegistroOrigen;
}

describe('Fase 1 · revisión de coherencia sin modificar el original',()=>{
  it('local vacío correcto: LV 1, sin nombre, fachada cumplimentada y sin datos comerciales',()=>{
    expect(incidenciasRegistro2026(registro('a',2,'1','','4.5'))).toEqual([]);
  });
  it('ocupado correcto: LV 0 con nombre y sin metros de fachada',()=>{
    expect(incidenciasRegistro2026(registro('a',2,'0','Café de prueba',''))).toEqual([]);
  });
  it('detecta nombre con LV1 y fachada ausente como una sola fila con dos problemas',()=>{
    expect(incidenciasRegistro2026(registro('a',2,'1','Asesoría Nuria Mate','')).map(x=>x.codigo))
      .toEqual(['vacio-con-nombre','vacio-sin-fachada']);
  });
  it('señala ceros en redes y franquicia como datos consignados de un vacío',()=>{
    expect(incidenciasRegistro2026(registro('a',2,'1','','3', {
      'Actividad':'Peluquería','Franquicia':'0','web':'0','Instagram':'0'})).map(x=>x.codigo))
      .toEqual(['vacio-con-actividad','vacio-con-digital']);
  });
  it('detecta ocupado sin nombre, ocupado con fachada y estados inválidos',()=>{
    expect(incidenciasRegistro2026(registro('a',2,'0','','20')).map(x=>x.codigo))
      .toEqual(['ocupado-sin-nombre','ocupado-con-fachada']);
    expect(incidenciasRegistro2026(registro('b',3,'','','')).map(x=>x.codigo)).toEqual(['lv-invalido']);
  });
  it('audita únicamente registros de 2026 confirmados y no escribe sobre ellos',()=>{
    const db=baseVacia();
    db.campanas.c26={id:'c26',anio:2026,tipo:'actualizacion'} as Campana;
    db.itinerarios.it2={id:'it2',codigo:'IT2',campanaId:'c26'} as Itinerario;
    db.importaciones.imp26={id:'imp26',campanaId:'c26',estado:'confirmada'} as Importacion;
    db.importaciones.imp25={id:'imp25',campanaId:'c25',estado:'confirmada'} as Importacion;
    db.registros.a=registro('a',2,'1','Asesoría Nuria Mate','');
    db.registros.b=registro('b',3,'0','Farmacia','');
    db.registros.c={...registro('c',4,'1','ANTIGUO',''),importacionId:'imp25'};
    const antes=JSON.stringify(db);
    const informe=auditarCalidad2026(db,'c26');
    expect(informe.total).toBe(2);
    expect(informe.filas).toHaveLength(1);
    expect(informe.filas[0].itinerario).toBe('IT2');
    expect(informe.filas[0].incidencias).toHaveLength(2);
    expect(informe.conformes).toBe(1);
    expect(JSON.stringify(db)).toBe(antes);
  });
});
