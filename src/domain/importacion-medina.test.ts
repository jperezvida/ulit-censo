import { beforeAll, describe, expect, it } from 'vitest';
import { callejeroSimulado, MEDINA } from '../data/callejero';
import { generarDemo } from '../data/semilla';
import type { BaseDatos } from './db';
import { compararImportacion, interpretarFilas, mapearCabecera, parsearCSV, valorBooleano } from './importacion';
import { aplicarResultadosPapel, importarCensoHistorico } from './aplicarImportacion';
import { direccionVigente, localesPrevios } from './consultas';
import { nuevoId } from './db';
import type { Calle } from './types';

let base: BaseDatos;
let calles: Calle[];
const C26 = 'camp-medina-2026';

beforeAll(() => {
  base = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'test' });
  calles = Object.values(base.calles).filter((c) => c.municipioId === MEDINA.id);
});

describe('cabeceras originales del censo de Medina', () => {
  it('reconoce Nombre del negocio, Local Vacío, Long fachada, GrActividad y Gr Comercio', () => {
    const cab = ['Calle', 'Número', 'Nombre del negocio', 'Local Vacío', 'Long fachada', 'GrActividad', 'Gr Comercio', 'Actividad'];
    const m = mapearCabecera(cab);
    expect(m).toMatchObject({ calle: 0, numero: 1, nombre: 2, vacio: 3, metros: 4, grupoActividad: 5, grupoComercio: 6, actividad: 7 });
  });

  it('interpreta el indicador de vacío con 0/1, 0.0/1.0 y variantes', () => {
    expect(['1', '1.0', '1,0', 'Sí', 'x', 'VACÍO'].map(valorBooleano)).toEqual([true, true, true, true, true, true]);
    expect(['0', '0.0', '0,0', 'No', ''].map(valorBooleano)).toEqual([false, false, false, false, false]);
    expect(valorBooleano('quizá')).toBeUndefined();
  });

  it('lee filas con valores numéricos exportados como decimal', () => {
    const c = calles[0].nombre;
    const csv = [
      'Calle;Número;Nombre del negocio;Local Vacío;Long fachada;GrActividad;Gr Comercio',
      `${c};12.0;Bar Uno;0.0;0.0;Hostelería;Restauración`,
      `;14;;1.0;6.5;;`,
      `;16 B;Tienda;0;;Comercio;Alimentación`,
      `;18;;1;;;`,
    ].join('\n');
    const p = parsearCSV(csv);
    const filas = interpretarFilas(p.cabecera, p.filas, mapearCabecera(p.cabecera), calles);
    expect(filas.map((f) => [f.numero, f.sufijo, f.vacio, f.metros])).toEqual([
      [12, undefined, false, undefined],
      [14, undefined, true, 6.5],
      [16, 'B', false, undefined],
      [18, undefined, true, undefined],
    ]);
    expect(filas.every((f) => f.calleId === calles[0].id)).toBe(true);
  });
});

describe('fechas', () => {
  it('no inventa fechas al importar un censo histórico', () => {
    const p = parsearCSV(`Calle;Número;Nombre del negocio;Local Vacío\n${calles[0].nombre};2;Bar Dos;0`);
    const filas = interpretarFilas(p.cabecera, p.filas, mapearCabecera(p.cabecera), calles).map((f) => ({ ...f, clase: 'nuevo' as const, detalle: '' }));
    const { db, campanaId } = importarCensoHistorico(base, MEDINA.id, 2019, 'Censo 2019', filas, 'h.csv');
    const obs = Object.values(db.observaciones).filter((o) => o.campanaId === campanaId);
    expect(obs).toHaveLength(1);
    expect(obs[0].fecha).toBeUndefined();
    expect(obs[0].registrado).toBeTruthy();
  });

  it('no asigna la fecha de importación como fecha de la visita en papel', () => {
    const calle = base.campanas[C26].ampliacionCalleIds[0];
    const filas = interpretarFilas(['Calle', 'Número', 'Nombre'], [[base.calles[calle].nombre, '3', 'Kiosco']], { calle: 0, numero: 1, nombre: 2 }, calles);
    const diff = compararImportacion(base, C26, filas);
    const { db } = aplicarResultadosPapel(base, C26, diff, 'papel.csv', 'C-excel-itinerario', 'p-elena');
    const nueva = Object.values(db.observaciones).find((o) => o.campanaId === C26 && o.calleId === calle && o.datos.nombre === 'Kiosco')!;
    expect(nueva.fuente).toBe('papel');
    expect(nueva.fecha).toBeUndefined();
  });
});

describe('correspondencias ambiguas', () => {
  /** Duplica un local anterior en la misma dirección para tener dos candidatos. */
  function conDosLocalesEnLaMismaDireccion() {
    const camp = base.campanas[C26];
    const calle = camp.ambitoCalleIds.find((id) => localesPrevios(base, camp.campanaReferenciaId, id).length > 2 && !Object.values(base.observaciones).some((o) => o.campanaId === C26 && o.calleId === id))!;
    const original = localesPrevios(base, camp.campanaReferenciaId, calle)[0];
    const d = direccionVigente(original);
    const copiaId = nuevoId('loc');
    const db: BaseDatos = {
      ...base,
      locales: { ...base.locales, [copiaId]: { ...original, id: copiaId } },
      ocupaciones: { ...base.ocupaciones, [`ocu-${copiaId}`]: { id: `ocu-${copiaId}`, localId: copiaId, negocioId: null, metrosFachada: 4, desdeCampanaId: camp.campanaReferenciaId!, orden: 0 } },
      observaciones: { ...base.observaciones, [`obs-${copiaId}`]: { id: `obs-${copiaId}`, campanaId: camp.campanaReferenciaId!, localId: copiaId, calleId: calle, fuente: 'importacion', tipo: 'confirmado', datos: { numero: d.numero, vacio: true }, verificacion: 'verificada' } },
    };
    return { db, calle, d, ids: [original.id, copiaId] };
  }

  it('con varios locales en la dirección no vincula al primero: queda «ambiguo»', () => {
    const { db, calle, d, ids } = conDosLocalesEnLaMismaDireccion();
    const filas = interpretarFilas(['Calle', 'Número', 'Nombre'], [[db.calles[calle].nombre, String(d.numero), 'Negocio Totalmente Nuevo']], { calle: 0, numero: 1, nombre: 2 }, calles);
    const [f] = compararImportacion(db, C26, filas);
    expect(f.clase).toBe('ambiguo');
    expect(f.localId).toBeUndefined();
    expect(f.candidatos?.sort()).toEqual([...ids].sort());
  });

  it('al aplicar, el caso ambiguo no modifica ningún local existente y queda pendiente de conciliación', () => {
    const { db, calle, d, ids } = conDosLocalesEnLaMismaDireccion();
    const filas = interpretarFilas(['Calle', 'Número', 'Nombre'], [[db.calles[calle].nombre, String(d.numero), 'Negocio Totalmente Nuevo']], { calle: 0, numero: 1, nombre: 2 }, calles);
    const diff = compararImportacion(db, C26, filas);
    const { db: tras } = aplicarResultadosPapel(db, C26, diff, 'papel.csv', 'C-excel-itinerario', 'p-elena');
    for (const id of ids) {
      expect(Object.values(tras.observaciones).some((o) => o.campanaId === C26 && o.localId === id)).toBe(false);
      expect(Object.values(tras.ocupaciones).filter((o) => o.localId === id)).toEqual(Object.values(db.ocupaciones).filter((o) => o.localId === id));
    }
    const v = Object.values(tras.vinculos).find((x) => x.criterio.includes('ambigua'))!;
    expect(v.confianza).toBe('dudosa');
    expect(v.candidatos?.map((c) => c.localId).sort()).toEqual([...ids].sort());
  });

  it('con un único local en la dirección sí puede proponerse como modificado', () => {
    const camp = base.campanas[C26];
    const calle = camp.ambitoCalleIds.find((id) => localesPrevios(base, camp.campanaReferenciaId, id).length > 0)!;
    const l = localesPrevios(base, camp.campanaReferenciaId, calle).find((x) => localesPrevios(base, camp.campanaReferenciaId, calle).filter((y) => direccionVigente(y).numero === direccionVigente(x).numero && (direccionVigente(y).sufijo ?? '') === (direccionVigente(x).sufijo ?? '')).length === 1)!;
    const d = direccionVigente(l);
    const filas = interpretarFilas(['Calle', 'Número', 'Nombre'], [[base.calles[calle].nombre, `${d.numero}${d.sufijo ? ' ' + d.sufijo : ''}`, 'Negocio Totalmente Nuevo']], { calle: 0, numero: 1, nombre: 2 }, calles);
    const [f] = compararImportacion(base, C26, filas);
    expect(f.clase).toBe('modificado');
    expect(f.localId).toBe(l.id);
  });
});
