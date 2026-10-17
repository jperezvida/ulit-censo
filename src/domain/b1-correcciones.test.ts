import { beforeAll, describe, expect, it } from 'vitest';
import { callejeroSimulado, MEDINA } from '../data/callejero';
import { generarDemo } from '../data/semilla';
import { ErrorDominio, kNC, kRev, type BaseDatos } from './db';
import { itinerariosDe, localesPrevios, observacionesDeLocal, ocupacionEn, ocupacionesDeLocal, revisionDe } from './consultas';
import {
  confirmarSinCambios, finalizarCalle, MOTIVO_CRONOLOGIA, registrarLocalNuevo, registrarNuevoNegocio, registrarVacio, ubicarEnCronologia, type Contexto,
} from './campo';
import { clasificacionEn, clasificar } from './clasificacion';
import { registrarDatoDigital, verificarDigital } from './digital';
import {
  cerrarRevisionItinerario, controlesValidacion, ESTADO_OFICINA_TXT, estadoOficina, itinerariosDeLocal, localesDeNegocio, validarItinerario,
} from './bloqueo';
import { editarNegocio } from './oficina';
import { nuevoVinculo, resolverVinculo } from './conciliacion';
import { crearItinerario, marcarCalleRevisada, quitarDeAmbito, registrarOmision } from './itinerarios';
import { compararImportacion, fechaDesdeExcel, interpretarFilas } from './importacion';
import { aplicarResultadosPapel } from './aplicarImportacion';
import { ACTIVIDADES_HOJA, hijosDe, TAXONOMIA } from './taxonomy';
import type { Id, LocalFisico, VariableDigital } from './types';

const C25 = 'camp-medina-2025';
const C26 = 'camp-medina-2026';
let base: BaseDatos;
const ctx = (fecha: string | undefined, extra: Partial<Contexto> = {}): Contexto => ({ campanaId: C26, investigadorId: 'p-ana', fecha, ...extra });
const itin = (db: BaseDatos, codigo: string) => itinerariosDe(db, C26).find((i) => i.codigo === codigo)!;
const nombreVigente = (db: BaseDatos, localId: Id) => {
  const n = ocupacionEn(db, localId, C26)?.negocioId;
  return n ? db.negocios[n].nombre : 'vacío';
};
const negocioPorNombre = (db: BaseDatos, nombre: string) => Object.values(db.negocios).find((n) => n.nombre === nombre)!.id;

beforeAll(() => {
  base = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'test' });
});

function localOcupadoSinVisitar(db: BaseDatos, itCodigo: string, saltar = 0): { local: LocalFisico; negocioId: Id } {
  const iti = itin(db, itCodigo);
  for (const t of iti.tramos) {
    for (const l of localesPrevios(db, C25, t.calleId)) {
      const oc = ocupacionEn(db, l.id, C25);
      const visitado = Object.values(db.observaciones).some((o) => o.localId === l.id && o.campanaId === C26);
      if (oc?.negocioId && !visitado && itinerariosDeLocal(db, C26, l.id).length === 1 && saltar-- <= 0) return { local: l, negocioId: oc.negocioId };
    }
  }
  throw new Error('sin local disponible');
}

/** Comprueba que la operación se rechaza y que no altera la base de datos de entrada. */
function rechazaSinCambios(db: BaseDatos, op: () => unknown, patron: RegExp | typeof ErrorDominio) {
  const antes = JSON.stringify(db);
  expect(op).toThrow(patron as RegExp);
  expect(JSON.stringify(db)).toBe(antes);
}

// ───────────────────── 1. Ocupante vigente frente a histórico ─────────────────────

describe('negocios sustituidos en el mismo local', () => {
  /** Bar Delia (2025) → confirmado sep. → vacío → Perfumería Sol (oct.). */
  function sustituciones() {
    const { local, negocioId: barDelia } = localOcupadoSinVisitar(base, 'IT-B');
    let db = confirmarSinCambios(base, ctx('2026-09-10T10:00:00'), local.id);
    db = registrarVacio(db, ctx('2026-09-25T10:00:00'), local.id, 5);
    db = registrarNuevoNegocio(db, ctx('2026-10-05T10:00:00'), local.id, 'Perfumería Sol Prueba');
    return { db, local, barDelia, perfumeria: negocioPorNombre(db, 'Perfumería Sol Prueba') };
  }

  it('el ocupante anterior no figura como vigente; el histórico conserva las tres etapas', () => {
    const { db, local, barDelia, perfumeria } = sustituciones();
    expect(ocupacionesDeLocal(db, local.id).map((o) => o.negocioId)).toEqual([barDelia, null, perfumeria]);
    expect(ocupacionEn(db, local.id, C26)!.negocioId).toBe(perfumeria);
    expect(ocupacionEn(db, local.id, C25)!.negocioId).toBe(barDelia);
    expect(localesDeNegocio(db, barDelia, C26)).toEqual({ todos: [local.id], vigentes: [] });
    expect(localesDeNegocio(db, perfumeria, C26)).toEqual({ todos: [local.id], vigentes: [local.id] });
  });

  it('clasificar o revisar lo digital de Bar Delia no cambia los estados de revisión de Perfumería Sol', () => {
    const s = sustituciones();
    let db = clasificar(s.db, s.perfumeria, C26, ACTIVIDADES_HOJA[0].id, 'p-marta');
    for (const v of ['web', 'ventaOnline', 'googleBusiness', 'instagram', 'facebook', 'twitter'] as VariableDigital[]) {
      db = registrarDatoDigital(db, s.perfumeria, C26, v, { respuesta: 'no' }, 'p-marta');
    }
    db = verificarDigital(db, s.perfumeria, C26, 'p-marta');
    const revAntes = revisionDe(db, C26, s.local.id);
    expect(revAntes).toMatchObject({ categorizacion: 'revisado', digital: 'revisado' });
    // Trabajo posterior sobre el negocio sustituido
    db = registrarDatoDigital(db, s.barDelia, C26, 'web', { respuesta: 'si' }, 'p-marta');
    db = clasificar(db, s.barDelia, C26, ACTIVIDADES_HOJA[1].id, 'p-marta');
    db = editarNegocio(db, C26, s.barDelia, { cadena: 'Cadena Ficticia' });
    expect(revisionDe(db, C26, s.local.id)).toEqual(revAntes);
    expect(db.digital[kNC(s.perfumeria, C26)].estado).toBe('verificada');
    expect(clasificacionEn(db, s.perfumeria, C26)!.actividadId).toBe(ACTIVIDADES_HOJA[0].id);
  });

  it('un negocio que no consta en la campaña no se puede revisar en ella', () => {
    const { local, negocioId: barDelia } = localOcupadoSinVisitar(base, 'IT-B');
    // Sustituido sin haberse visto en 2026: su ocupación termina en 2025.
    const db = registrarNuevoNegocio(base, ctx('2026-10-05T10:00:00'), local.id, 'Perfumería Sol Prueba');
    expect(localesDeNegocio(db, barDelia, C26).todos).toEqual([]);
    rechazaSinCambios(db, () => clasificar(db, barDelia, C26, ACTIVIDADES_HOJA[0].id, 'p-marta'), /no consta en esta campaña/);
    rechazaSinCambios(db, () => registrarDatoDigital(db, barDelia, C26, 'web', { respuesta: 'si' }, 'p-marta'), /no consta en esta campaña/);
  });
});

// ───────────────────── 1b. Cronología efectiva frente a orden de introducción ─────────────────────

describe('observaciones introducidas fuera de orden', () => {
  it('un vacío de septiembre introducido después de Perfumería Sol (octubre) queda como etapa intermedia', () => {
    const { local, negocioId: barDelia } = localOcupadoSinVisitar(base, 'IT-B');
    let db = confirmarSinCambios(base, ctx('2026-09-10T10:00:00'), local.id);
    db = registrarNuevoNegocio(db, ctx('2026-10-05T10:00:00'), local.id, 'Perfumería Sol Prueba');
    const perfumeria = negocioPorNombre(db, 'Perfumería Sol Prueba');
    db = clasificar(db, perfumeria, C26, ACTIVIDADES_HOJA[0].id, 'p-marta');
    const rev = revisionDe(db, C26, local.id);
    // Llega tarde la hoja en papel con un vacío del 25 de septiembre
    db = registrarVacio(db, ctx('2026-09-25', { fuente: 'papel' }), local.id, 6);
    const ocus = ocupacionesDeLocal(db, local.id);
    expect(ocus.map((o) => o.negocioId)).toEqual([barDelia, null, perfumeria]);
    expect(ocus[1].hastaObservacionId).toBe(ocus[2].desdeObservacionId);
    expect(ocus[0].hastaObservacionId).toBe(ocus[1].desdeObservacionId);
    expect(ocus[2].hastaCampanaId).toBeUndefined();
    expect(nombreVigente(db, local.id)).toBe('Perfumería Sol Prueba');
    expect(revisionDe(db, C26, local.id)).toMatchObject({ categorizacion: rev.categorizacion, digital: rev.digital });
    // El orden mostrado es cronológico, no el de introducción
    expect(observacionesDeLocal(db, local.id).filter((o) => o.campanaId === C26).map((o) => o.tipo)).toEqual(['confirmado', 'vacio', 'nuevo-negocio']);
  });

  it('un nuevo negocio anterior introducido tarde no desplaza al vigente ni toca su revisión', () => {
    const { local } = localOcupadoSinVisitar(base, 'IT-B');
    let db = registrarNuevoNegocio(base, ctx('2026-10-05T10:00:00'), local.id, 'Perfumería Sol Prueba');
    const perfumeria = negocioPorNombre(db, 'Perfumería Sol Prueba');
    db = clasificar(db, perfumeria, C26, ACTIVIDADES_HOJA[0].id, 'p-marta');
    db = registrarNuevoNegocio(db, ctx('2026-09-15'), local.id, 'Bar Intermedio Prueba');
    expect(nombreVigente(db, local.id)).toBe('Perfumería Sol Prueba');
    expect(revisionDe(db, C26, local.id).categorizacion).toBe('revisado');
    const intermedio = negocioPorNombre(db, 'Bar Intermedio Prueba');
    expect(localesDeNegocio(db, intermedio, C26)).toEqual({ todos: [local.id], vigentes: [] });
  });

  it('una confirmación en papel con fecha anterior registra el negocio de ESA fecha', () => {
    const { local, negocioId: barDelia } = localOcupadoSinVisitar(base, 'IT-B');
    let db = registrarNuevoNegocio(base, ctx('2026-10-05T10:00:00'), local.id, 'Perfumería Sol Prueba');
    db = confirmarSinCambios(db, ctx('2026-09-10', { fuente: 'papel' }), local.id);
    const conf = Object.values(db.observaciones).find((o) => o.localId === local.id && o.tipo === 'confirmado')!;
    expect(conf.datos.negocioId).toBe(barDelia);
    expect(conf.cronologia).toBeUndefined();
    expect(nombreVigente(db, local.id)).toBe('Perfumería Sol Prueba');
  });

  it('sin fecha (o el mismo día sin hora) el cambio queda «incierto» y no altera las ocupaciones', () => {
    const { local } = localOcupadoSinVisitar(base, 'IT-B');
    let db = registrarNuevoNegocio(base, ctx('2026-10-05T10:00:00'), local.id, 'Perfumería Sol Prueba');
    const ocupacionesAntes = ocupacionesDeLocal(db, local.id);
    for (const fecha of [undefined, '2026-10-05']) {
      const tras = registrarVacio(db, ctx(fecha, { fuente: 'papel' }), local.id, 4);
      expect(ocupacionesDeLocal(tras, local.id)).toEqual(ocupacionesAntes);
      const obs = Object.values(tras.observaciones).find((o) => o.localId === local.id && o.tipo === 'vacio')!;
      expect(obs.cronologia).toBe('incierta');
      expect(revisionDe(tras, C26, local.id)).toMatchObject({ pendienteComprobacion: true, motivoComprobacion: MOTIVO_CRONOLOGIA });
    }
    db = registrarVacio(db, ctx(undefined, { fuente: 'papel' }), local.id, 4);
    const obs = Object.values(db.observaciones).find((o) => o.localId === local.id && o.tipo === 'vacio')!;
    // La oficina le asigna la fecha real: se coloca como etapa intermedia
    rechazaSinCambios(db, () => ubicarEnCronologia(db, obs.id, '2026-10-05', 'p-marta'), /indica también la hora/);
    db = ubicarEnCronologia(db, obs.id, '2026-09-20', 'p-marta');
    expect(ocupacionesDeLocal(db, local.id).map((o) => (o.negocioId ? db.negocios[o.negocioId].nombre : 'vacío')).slice(-2)).toEqual(['vacío', 'Perfumería Sol Prueba']);
    expect(db.observaciones[obs.id]).toMatchObject({ fecha: '2026-09-20', fechaAsignada: { porId: 'p-marta' } });
    expect(db.observaciones[obs.id].cronologia).toBeUndefined();
    expect(revisionDe(db, C26, local.id).pendienteComprobacion).toBe(false);
  });

  it('importación en papel posterior con «Fecha censo»: respeta la fecha de la visita', () => {
    expect(fechaDesdeExcel('46275')).toBe('2026-09-10');
    expect(fechaDesdeExcel('10/09/2026')).toBe('2026-09-10');
    expect(fechaDesdeExcel('')).toBeUndefined();
    const { local, negocioId: barDelia } = localOcupadoSinVisitar(base, 'IT-B');
    let db = registrarNuevoNegocio(base, ctx('2026-10-05T10:00:00'), local.id, 'Perfumería Sol Prueba');
    const calle = db.calles[local.direcciones.at(-1)!.calleId];
    const d = local.direcciones.at(-1)!;
    const filas = interpretarFilas(
      ['Fecha censo', 'Dirección', 'Num', 'Nombre del negocio'],
      [['46275', calle.nombre, `${d.numero}${d.sufijo ? ' ' + d.sufijo : ''}`, db.negocios[barDelia].nombre]],
      { fecha: 0, calle: 1, numero: 2, nombre: 3 },
      Object.values(db.calles),
    );
    const diff = compararImportacion(db, C26, filas);
    expect(diff[0]).toMatchObject({ clase: 'sin-cambios', localId: local.id, fecha: '2026-09-10' });
    db = aplicarResultadosPapel(db, C26, diff, 'itinerario.xlsx', 'C-excel-itinerario', 'p-elena').db;
    const papel = Object.values(db.observaciones).find((o) => o.localId === local.id && o.fuente === 'papel')!;
    expect(papel).toMatchObject({ fecha: '2026-09-10', tipo: 'confirmado' });
    expect(papel.datos.negocioId).toBe(barDelia);
    expect(nombreVigente(db, local.id)).toBe('Perfumería Sol Prueba');
  });
});

// ───────────────────── 2. Aislamiento entre itinerarios ─────────────────────

describe('aislamiento entre itinerarios', () => {
  /** Calle nueva repartida por aceras: IT-PAR (pares) e IT-IMPAR (impares). */
  function calleRepartida() {
    let r = registrarOmision(base, MEDINA.id, 'Calle Ficticia Repartida', [[-4.91, 41.31], [-4.909, 41.311]]);
    let db = r.db;
    const calleId = r.id;
    const par = crearItinerario(db, C26, { codigo: 'IT-PAR', nombre: 'Pares', color: '#000', tramos: [{ calleId, acera: 'par', orden: 1 }] });
    const impar = crearItinerario(par.db, C26, { codigo: 'IT-IMPAR', nombre: 'Impares', color: '#111', tramos: [{ calleId, acera: 'impar', orden: 1 }] });
    db = impar.db;
    r = { db, id: calleId };
    return { db, calleId, par: par.id, impar: impar.id };
  }

  it('registrarLocalNuevo se limita a la acera del itinerario de trabajo', () => {
    const { db, calleId, par, impar } = calleRepartida();
    const alta = (n: number, itId: Id, d = db) => registrarLocalNuevo(d, ctx('2026-10-01', { alcance: { itinerarioId: itId } }), { calleId, numero: n, vacio: true });
    expect(() => alta(3, impar)).not.toThrow();
    rechazaSinCambios(db, () => alta(4, impar), /no pertenece a IT-IMPAR/);
    // Con IT-PAR cerrado, los impares siguen editables y los pares no
    const cerrado = cerrarRevisionItinerario(db, par, 'p-elena');
    expect(() => alta(5, impar, cerrado)).not.toThrow();
    rechazaSinCambios(cerrado, () => registrarLocalNuevo(cerrado, ctx('2026-10-01'), { calleId, numero: 6, vacio: true }), /IT-PAR tiene la revisión cerrada/);
    // Cerrar la calle desde otro itinerario tampoco se permite
    rechazaSinCambios(db, () => finalizarCalle(db, ctx('2026-10-01', { alcance: { itinerarioId: impar } }), calleId, { acera: 'par', par: true, impar: false, resultado: 'completada-sin-locales' }), /no pertenece a IT-IMPAR/);
  });

  it('las operaciones de campo con alcance rechazan locales de otro itinerario', () => {
    const a = localOcupadoSinVisitar(base, 'IT-A');
    const alcance = { itinerarioId: itin(base, 'IT-B').id };
    rechazaSinCambios(base, () => confirmarSinCambios(base, ctx('2026-10-01', { alcance }), a.local.id), /no pertenecen a IT-B/);
    rechazaSinCambios(base, () => registrarVacio(base, ctx('2026-10-01', { alcance }), a.local.id), /no pertenecen a IT-B/);
    rechazaSinCambios(base, () => registrarNuevoNegocio(base, ctx('2026-10-01', { alcance }), a.local.id, 'X'), /no pertenecen a IT-B/);
  });

  it('un negocio asociado a locales de dos itinerarios no se modifica desde uno solo', () => {
    const a = localOcupadoSinVisitar(base, 'IT-A');
    const b = localOcupadoSinVisitar(base, 'IT-B');
    // El negocio de IT-A pasa (en septiembre) a ocupar también el local de IT-B.
    let db = registrarNuevoNegocio(base, ctx('2026-09-01T10:00:00'), b.local.id, 'temporal');
    const ocB = ocupacionEn(db, b.local.id, C26)!;
    db = { ...db, ocupaciones: { ...db.ocupaciones, [ocB.id]: { ...ocB, negocioId: a.negocioId } } };
    expect(localesDeNegocio(db, a.negocioId, C26).todos.sort()).toEqual([a.local.id, b.local.id].sort());
    const deB = { alcance: { itinerarioId: itin(db, 'IT-B').id } };
    rechazaSinCambios(db, () => clasificar(db, a.negocioId, C26, ACTIVIDADES_HOJA[0].id, 'p-marta', deB), /no pertenecen a IT-B/);
    rechazaSinCambios(db, () => registrarDatoDigital(db, a.negocioId, C26, 'web', { respuesta: 'si' }, 'p-marta', deB), /no pertenecen a IT-B/);
    rechazaSinCambios(db, () => editarNegocio(db, C26, a.negocioId, { nombre: 'Otro' }, deB.alcance), /no pertenecen a IT-B/);
    // Sin alcance (vista municipal) se permite… salvo que uno de sus itinerarios esté cerrado
    expect(() => clasificar(db, a.negocioId, C26, ACTIVIDADES_HOJA[0].id, 'p-marta')).not.toThrow();
    const cerrado = cerrarRevisionItinerario(db, itin(db, 'IT-A').id, 'p-elena');
    rechazaSinCambios(cerrado, () => clasificar(cerrado, a.negocioId, C26, ACTIVIDADES_HOJA[0].id, 'p-marta'), /IT-A tiene la revisión cerrada/);
  });

  it('la conciliación no fusiona con un local de otro itinerario ni de uno cerrado', () => {
    const a = localOcupadoSinVisitar(base, 'IT-A');
    const b = localOcupadoSinVisitar(base, 'IT-B');
    const calleB = b.local.direcciones.at(-1)!.calleId;
    const r = registrarLocalNuevo(base, ctx('2026-10-01'), { calleId: calleB, numero: b.local.direcciones.at(-1)!.numero, vacio: true });
    const obs = Object.values(r.db.observaciones).find((o) => o.localId === r.localId)!;
    const v = nuevoVinculo({ origen: { tipo: 'observacion', id: obs.id }, localId: r.localId, confianza: 'dudosa', criterio: 'prueba', candidatos: [] });
    let db = { ...r.db, vinculos: { ...r.db.vinculos, [v.id]: v } };
    rechazaSinCambios(db, () => resolverVinculo(db, v.id, { tipo: 'mismo-local', localAnteriorId: a.local.id }, 'p-marta', { itinerarioId: itin(db, 'IT-B').id }), /no pertenecen a IT-B/);
    db = cerrarRevisionItinerario(db, itin(db, 'IT-A').id, 'p-elena');
    rechazaSinCambios(db, () => resolverVinculo(db, v.id, { tipo: 'mismo-local', localAnteriorId: a.local.id }, 'p-marta'), /IT-A tiene la revisión cerrada/);
  });

  it('una importación con filas de otro itinerario se rechaza entera, sin cambios parciales', () => {
    const a = localOcupadoSinVisitar(base, 'IT-A');
    const b = localOcupadoSinVisitar(base, 'IT-B');
    const fila = (l: LocalFisico) => {
      const d = l.direcciones.at(-1)!;
      return ['', base.calles[d.calleId].nombre, `${d.numero}${d.sufijo ? ' ' + d.sufijo : ''}`, base.negocios[ocupacionEn(base, l.id, C25)!.negocioId!].nombre];
    };
    const filas = interpretarFilas(['Fecha censo', 'Dirección', 'Num', 'Nombre del negocio'], [fila(b.local), fila(a.local)], { fecha: 0, calle: 1, numero: 2, nombre: 3 }, Object.values(base.calles));
    const diff = compararImportacion(base, C26, filas);
    expect(diff.map((f) => f.clase)).toEqual(['sin-cambios', 'sin-cambios']);
    rechazaSinCambios(base, () => aplicarResultadosPapel(base, C26, diff, 'it-b.xlsx', 'C-excel-itinerario', 'p-elena', { alcance: { itinerarioId: itin(base, 'IT-B').id } }), /no pertenecen a IT-B/);
  });

  it('la planificación de calles de un itinerario cerrado queda bloqueada solo en su campaña', () => {
    const itA = itin(base, 'IT-A');
    const db = cerrarRevisionItinerario(base, itA.id, 'p-elena');
    const calle = itA.tramos[0].calleId;
    rechazaSinCambios(db, () => quitarDeAmbito(db, C26, calle), /IT-A/);
    rechazaSinCambios(db, () => marcarCalleRevisada(db, C26, calle, 'p-elena', true), /IT-A/);
    expect(() => marcarCalleRevisada(db, C25, calle, 'p-elena', true)).not.toThrow();
  });
});

// ───────────────────── 4. Validación provisional ─────────────────────

describe('cierre provisional y validación definitiva', () => {
  it('la validación definitiva se rechaza mientras falten los controles del bloque C', () => {
    const itA = itin(base, 'IT-A');
    expect(controlesValidacion(base, itA.id).disponibles).toBe(false);
    rechazaSinCambios(base, () => validarItinerario(base, itA.id, 'p-elena'), /validación definitiva no está disponible/);
    expect(estadoOficina(base, itA.id)).toBe('en-revision');
  });

  it('el cierre provisional registra quién y cuándo, sin exigir una persona distinta', () => {
    const a = localOcupadoSinVisitar(base, 'IT-A');
    const itA = itin(base, 'IT-A');
    let db = clasificar(base, a.negocioId, C26, ACTIVIDADES_HOJA[0].id, 'p-marta');
    db = cerrarRevisionItinerario(db, itA.id, 'p-marta', '2026-11-02T12:00:00');
    expect(db.oficinaItinerarios[itA.id]).toMatchObject({ estado: 'revision-cerrada', historial: [{ accion: 'cerrar-revision', porId: 'p-marta', fecha: '2026-11-02T12:00:00' }] });
    expect(ESTADO_OFICINA_TXT['revision-cerrada']).toMatch(/provisional, no apta para exportación municipal/);
    expect(revisionDe(db, C26, a.local.id)).toEqual(db.revisiones[kRev(C26, a.local.id)]);
  });
});

// ───────────────────── 6. Clasificación sin cuatro niveles obligatorios ─────────────────────

describe('clasificación según el procedimiento 2026', () => {
  it('admite un subgrupo con breve descripción y la conserva por campaña', () => {
    const { negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    const subgrupo = TAXONOMIA.find((n) => n.nivel === 3 && hijosDe(n.id).length)!;
    const db = clasificar(base, negocioId, C26, subgrupo.id, 'p-marta', { descripcion: '  Logopedia  ' });
    expect(clasificacionEn(db, negocioId, C26)).toMatchObject({ actividadId: subgrupo.id, descripcion: 'Logopedia', confirmada: true });
    expect(clasificacionEn(db, negocioId, C25)?.descripcion).toBeUndefined();
  });
});
