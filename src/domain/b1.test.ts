import { beforeAll, describe, expect, it } from 'vitest';
import { callejeroSimulado, MEDINA } from '../data/callejero';
import { generarDemo } from '../data/semilla';
import { ErrorDominio, kNC, type BaseDatos } from './db';
import { itinerariosDe, localesPrevios, ocupacionEn, ocupacionesDeLocal, revisionDe } from './consultas';
import { confirmarSinCambios, registrarNuevoNegocio, registrarVacio, type Contexto } from './campo';
import { clasificacionAnterior, clasificacionEn, clasificar, partirDeClasificacionAnterior } from './clasificacion';
import {
  confirmarDatoHeredado, esExigible, partirDeDigitalAnterior, problemasDigitales, registrarDatoDigital, revisionDigitalAnterior, verificarDigital,
} from './digital';
import { codificarRespuesta, respuestaDesdeValor } from './respuesta';
import { cerrarRevisionItinerario, comprobarEditable, itinerariosDeLocal, reabrirItinerario } from './bloqueo';
import { actualizarRevisiones } from './oficina';
import { alternarCalle } from './itinerarios';
import { ACTIVIDADES_HOJA } from './taxonomy';
import type { Campana, Id, LocalFisico, Respuesta, VariableDigital } from './types';

const C25 = 'camp-medina-2025';
const C26 = 'camp-medina-2026';
let base: BaseDatos;
const ctx = (fecha: string, extra: Partial<Contexto> = {}): Contexto => ({ campanaId: C26, investigadorId: 'p-ana', fecha, ...extra });

beforeAll(() => {
  base = generarDemo({ calles: callejeroSimulado(MEDINA.id, MEDINA.centro), fuente: 'simulado', detalleFuente: 'test' });
});

/** Local de un itinerario, ocupado en 2025 por un negocio y todavía no visitado en 2026. */
function localOcupadoSinVisitar(db: BaseDatos, itCodigo: string): { local: LocalFisico; negocioId: Id } {
  const it = itinerariosDe(db, C26).find((i) => i.codigo === itCodigo)!;
  for (const t of it.tramos) {
    for (const l of localesPrevios(db, C25, t.calleId)) {
      const oc = ocupacionEn(db, l.id, C25);
      const visitado = Object.values(db.observaciones).some((o) => o.localId === l.id && o.campanaId === C26);
      if (oc?.negocioId && !visitado && itinerariosDeLocal(db, C26, l.id).length === 1) return { local: l, negocioId: oc.negocioId };
    }
  }
  throw new Error('sin local disponible');
}

const instantanea = (db: BaseDatos) => JSON.stringify({
  registros: db.registros,
  obs25: Object.values(db.observaciones).filter((o) => o.campanaId === C25),
  cla25: Object.values(db.clasificaciones).filter((c) => c.campanaId === C25),
  dig25: Object.values(db.digital).filter((d) => d.campanaId === C25),
  imp: db.importaciones,
});

describe('modelo temporal de ocupaciones', () => {
  it('Bar Delia 2025 → sin cambios (sep. 2026) → Perfumería Sol (oct. 2026): cada evento conserva su negocio', () => {
    const { local, negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    const nombre2025 = base.negocios[negocioId].nombre;
    let db = confirmarSinCambios(base, ctx('2026-09-10T10:00:00'), local.id);
    db = registrarNuevoNegocio(db, ctx('2026-10-05T10:00:00'), local.id, 'Perfumería Sol');
    const obs26 = Object.values(db.observaciones).filter((o) => o.localId === local.id && o.campanaId === C26).sort((a, b) => a.orden! - b.orden!);
    expect(obs26.map((o) => o.tipo)).toEqual(['confirmado', 'nuevo-negocio']);
    expect(obs26[0].datos.negocioId).toBe(negocioId);
    expect(obs26[0].datos.nombre).toBe(nombre2025);
    expect(db.negocios[obs26[1].datos.negocioId!].nombre).toBe('Perfumería Sol');
    const ocus = ocupacionesDeLocal(db, local.id);
    expect(ocus).toHaveLength(2);
    expect(ocus[0]).toMatchObject({ negocioId, desdeCampanaId: C25, hastaCampanaId: C26, hastaObservacionId: obs26[1].id });
    expect(ocupacionEn(db, local.id, C25)!.negocioId).toBe(negocioId);
    expect(db.negocios[ocupacionEn(db, local.id, C26)!.negocioId!].nombre).toBe('Perfumería Sol');
  });

  it('varios cambios en una misma campaña no borran ocupaciones intermedias', () => {
    const { local, negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    let db = registrarNuevoNegocio(base, ctx('2026-09-01'), local.id, 'Negocio Intermedio');
    db = registrarVacio(db, ctx('2026-10-01'), local.id, 6);
    db = registrarNuevoNegocio(db, ctx('2026-10-20'), local.id, 'Negocio Final');
    const ocus = ocupacionesDeLocal(db, local.id);
    expect(ocus.map((o) => (o.negocioId ? db.negocios[o.negocioId].nombre : 'vacío'))).toEqual([base.negocios[negocioId].nombre, 'Negocio Intermedio', 'vacío', 'Negocio Final']);
    expect(ocus.slice(0, 3).every((o) => o.hastaObservacionId)).toBe(true);
    expect(ocus[3].hastaCampanaId).toBeUndefined();
    expect(db.negocios[ocupacionEn(db, local.id, C26)!.negocioId!].nombre).toBe('Negocio Final');
  });
});

describe('el histórico original permanece intacto', () => {
  it('clasificar, cambiar negocio y revisar lo digital en 2026 no altera 2025 ni los registros de origen', () => {
    const antes = instantanea(base);
    const { local, negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    const otra = ACTIVIDADES_HOJA.find((a) => a.id !== clasificacionEn(base, negocioId, C25)?.actividadId)!;
    let db = clasificar(base, negocioId, C26, otra.id, 'p-marta');
    db = registrarDatoDigital(db, negocioId, C26, 'web', { respuesta: 'si' }, 'p-marta');
    db = registrarNuevoNegocio(db, ctx('2026-10-01'), local.id, 'Otro negocio');
    expect(instantanea(db)).toBe(antes);
    expect(clasificacionEn(db, negocioId, C26)!.actividadId).toBe(otra.id);
  });
});

describe('clasificación por campaña', () => {
  it('confirmar una actividad marca la categorización; copiar la anterior solo crea un borrador', () => {
    const { local, negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    const ant = clasificacionAnterior(base, negocioId, C26)!;
    expect(ant.campanaId).toBe(C25);
    let db = partirDeClasificacionAnterior(base, negocioId, C26, 'p-marta');
    expect(clasificacionEn(db, negocioId, C26)).toMatchObject({ actividadId: ant.actividadId, origen: 'heredado', confirmada: false });
    expect(revisionDe(db, C26, local.id).categorizacion).toBe('pendiente');
    db = clasificar(db, negocioId, C26, ant.actividadId, 'p-marta');
    expect(clasificacionEn(db, negocioId, C26)).toMatchObject({ origen: 'manual', confirmada: true, porId: 'p-marta' });
    expect(revisionDe(db, C26, local.id).categorizacion).toBe('revisado');
  });

  it('un negocio distinto en el mismo local no hereda la clasificación del anterior', () => {
    const { local } = localOcupadoSinVisitar(base, 'IT-B');
    const db = registrarNuevoNegocio(base, ctx('2026-10-01'), local.id, 'Negocio Nuevo');
    const nuevo = ocupacionEn(db, local.id, C26)!.negocioId!;
    expect(clasificacionAnterior(db, nuevo, C26)).toBeUndefined();
    expect(partirDeClasificacionAnterior(db, nuevo, C26, 'p-marta')).toBe(db);
  });

  it('rechaza nodos inexistentes y grupos con actividades por debajo sin descripción', () => {
    const { negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    expect(() => clasificar(base, negocioId, C26, 'no-existe', 'p-marta')).toThrow(ErrorDominio);
    expect(() => clasificar(base, negocioId, C26, 'a1-comercio', 'p-marta')).toThrow(/actividades por debajo/);
    expect(() => clasificar(base, negocioId, C26, 'a1-comercio', 'p-marta', { descripcion: 'algo' })).toThrow(/actividades por debajo/);
  });
});

describe('revisión digital', () => {
  const reg = (db: BaseDatos, neg: Id, v: VariableDigital, r: Respuesta, valor?: number) => registrarDatoDigital(db, neg, C26, v, { respuesta: r, valor }, 'p-marta');

  it('«pendiente» no equivale a «no»: no tiene código de salida y lo vacío se lee como pendiente', () => {
    expect(codificarRespuesta('pendiente', { si: 1, no: 0 })).toBeNull();
    expect(codificarRespuesta('na', { si: 1, no: 0 })).toBeNull();
    expect(codificarRespuesta('no', { si: 1, no: 0 })).toBe(0);
    expect(codificarRespuesta('si', { si: '1.0', no: '0.0' })).toBe('1.0');
    expect(respuestaDesdeValor('')).toBe('pendiente');
    expect(respuestaDesdeValor(null)).toBe('pendiente');
    expect(respuestaDesdeValor('0.0')).toBe('no');
    expect(respuestaDesdeValor(1)).toBe('si');
  });

  it('las obligaciones son condicionales (sin GBP no se exigen reseñas; sin Instagram, seguidores)', () => {
    const { negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    let db = base;
    for (const v of ['web', 'ventaOnline', 'facebook', 'twitter'] as VariableDigital[]) db = reg(db, negocioId, v, 'no');
    db = reg(db, negocioId, 'googleBusiness', 'no');
    db = reg(db, negocioId, 'instagram', 'si');
    let rev = db.digital[kNC(negocioId, C26)];
    expect(esExigible(rev, 'numResenas')).toBe(false);
    expect(esExigible(rev, 'seguidoresInstagram')).toBe(true);
    expect(problemasDigitales(rev).map((p) => p.variable)).toEqual(['seguidoresInstagram']);
    expect(() => verificarDigital(db, negocioId, C26, 'p-marta')).toThrow(/No se puede verificar/);
    db = reg(db, negocioId, 'seguidoresInstagram', 'si', 850);
    db = verificarDigital(db, negocioId, C26, 'p-marta', { fecha: '2026-10-16T09:00:00' });
    rev = db.digital[kNC(negocioId, C26)];
    expect(rev).toMatchObject({ estado: 'verificada', verificadaPor: 'p-marta', verificadaEn: '2026-10-16T09:00:00' });
  });

  it('sin reseñas no se exige la respuesta a reseñas', () => {
    const { negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    let db = reg(base, negocioId, 'googleBusiness', 'si');
    db = reg(db, negocioId, 'numResenas', 'si', 0);
    expect(esExigible(db.digital[kNC(negocioId, C26)], 'respondeResenas')).toBe(false);
    db = reg(db, negocioId, 'numResenas', 'si', 12);
    expect(esExigible(db.digital[kNC(negocioId, C26)], 'respondeResenas')).toBe(true);
  });

  it('detecta contradicciones y valores fuera de rango', () => {
    const { negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    let db = reg(base, negocioId, 'googleBusiness', 'no');
    db = reg(db, negocioId, 'valoracion', 'si', 4.2);
    expect(problemasDigitales(db.digital[kNC(negocioId, C26)]).some((p) => p.tipo === 'contradiccion' && p.variable === 'valoracion')).toBe(true);
    db = reg(db, negocioId, 'googleBusiness', 'si');
    db = reg(db, negocioId, 'valoracion', 'si', 7);
    expect(problemasDigitales(db.digital[kNC(negocioId, C26)]).some((p) => /fuera de rango/.test(p.mensaje))).toBe(true);
  });

  it('cambiar un dato tras verificar reabre la revisión y la deja pendiente', () => {
    const { local, negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    let db = base;
    for (const v of ['web', 'ventaOnline', 'googleBusiness', 'instagram', 'facebook', 'twitter'] as VariableDigital[]) db = reg(db, negocioId, v, 'no');
    db = verificarDigital(db, negocioId, C26, 'p-marta');
    expect(revisionDe(db, C26, local.id).digital).toBe('revisado');
    db = reg(db, negocioId, 'web', 'si');
    const rev = db.digital[kNC(negocioId, C26)];
    expect(rev.estado).toBe('borrador');
    expect(rev.historial.at(-1)).toMatchObject({ accion: 'reabrir', motivo: 'Cambio en Página web', porId: 'p-marta' });
    expect(revisionDe(db, C26, local.id).digital).toBe('pendiente');
    // registrar el mismo valor no reabre nada
    expect(reg(db, negocioId, 'web', 'si')).toBe(db);
  });

  it('no admite «no aplicable» donde no procede, pero sí «sin información»', () => {
    const { negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    expect(() => reg(base, negocioId, 'web', 'na')).toThrow(/no admite/);
    expect(reg(base, negocioId, 'web', 'sin-info').digital[kNC(negocioId, C26)].datos.web?.respuesta).toBe('sin-info');
  });

  it('lo heredado de 2025 es borrador y debe confirmarse antes de verificar', () => {
    const { negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    const ant = revisionDigitalAnterior(base, negocioId, C26);
    expect(ant).toBeDefined();
    let db = partirDeDigitalAnterior(base, negocioId, C26, 'p-marta');
    const rev = db.digital[kNC(negocioId, C26)];
    expect(rev.estado).toBe('borrador');
    expect(Object.values(rev.datos).every((d) => d!.origen === 'heredado')).toBe(true);
    expect(() => verificarDigital(db, negocioId, C26, 'p-marta')).toThrow();
    for (const v of Object.keys(rev.datos) as VariableDigital[]) db = confirmarDatoHeredado(db, negocioId, C26, v, 'p-marta');
    expect(verificarDigital(db, negocioId, C26, 'p-marta').digital[kNC(negocioId, C26)].estado).toBe('verificada');
  });

  it('no mezcla los datos digitales de negocios distintos en el mismo local', () => {
    const { local, negocioId } = localOcupadoSinVisitar(base, 'IT-B');
    let db = reg(base, negocioId, 'web', 'si');
    db = registrarNuevoNegocio(db, ctx('2026-10-01'), local.id, 'Negocio Nuevo');
    const nuevo = ocupacionEn(db, local.id, C26)!.negocioId!;
    expect(revisionDigitalAnterior(db, nuevo, C26)).toBeUndefined();
    expect(partirDeDigitalAnterior(db, nuevo, C26, 'p-marta')).toBe(db);
    expect(db.digital[kNC(nuevo, C26)]).toBeUndefined();
    expect(db.digital[kNC(negocioId, C26)].datos.web?.respuesta).toBe('si');
  });
});

describe('bloqueo de itinerarios con la revisión cerrada', () => {
  it('bloquea solo el itinerario y la campaña cerrados', () => {
    const a = localOcupadoSinVisitar(base, 'IT-A');
    const b = localOcupadoSinVisitar(base, 'IT-B');
    const itA = itinerariosDe(base, C26).find((i) => i.codigo === 'IT-A')!;
    const db = cerrarRevisionItinerario(base, itA.id, 'p-elena');
    expect(() => confirmarSinCambios(db, ctx('2026-10-01'), a.local.id)).toThrow(/IT-A tiene la revisión cerrada/);
    expect(() => clasificar(db, a.negocioId, C26, ACTIVIDADES_HOJA[0].id, 'p-marta')).toThrow(ErrorDominio);
    expect(() => registrarDatoDigital(db, a.negocioId, C26, 'web', { respuesta: 'si' }, 'p-marta')).toThrow(ErrorDominio);
    expect(() => alternarCalle(db, itA.id, itA.tramos[0].calleId)).toThrow(/cerrado o validado/);
    // otro itinerario de la misma campaña sigue editable
    expect(() => confirmarSinCambios(db, ctx('2026-10-01'), b.local.id)).not.toThrow();
  });

  it('el mismo local puede revisarse en una campaña posterior', () => {
    const a = localOcupadoSinVisitar(base, 'IT-A');
    const itA = itinerariosDe(base, C26).find((i) => i.codigo === 'IT-A')!;
    let db = cerrarRevisionItinerario(base, itA.id, 'p-elena');
    const c27: Campana = { ...db.campanas[C26], id: 'camp-medina-2027', anio: 2027, nombre: 'Censo 2027', campanaReferenciaId: C26, procedencia: 'manual' };
    db = { ...db, campanas: { ...db.campanas, [c27.id]: c27 } };
    expect(() => comprobarEditable(db, c27.id, { localId: a.local.id })).not.toThrow();
    const tras = confirmarSinCambios(db, { campanaId: c27.id, investigadorId: 'p-ana', fecha: '2027-05-01' }, a.local.id);
    expect(Object.values(tras.observaciones).some((o) => o.localId === a.local.id && o.campanaId === c27.id)).toBe(true);
  });

  it('reabrir exige motivo y queda registrado', () => {
    const a = localOcupadoSinVisitar(base, 'IT-A');
    const itA = itinerariosDe(base, C26).find((i) => i.codigo === 'IT-A')!;
    let db = cerrarRevisionItinerario(base, itA.id, 'p-elena', '2026-11-01');
    expect(() => reabrirItinerario(db, itA.id, 'p-elena', '  ')).toThrow(/motivo/);
    db = reabrirItinerario(db, itA.id, 'p-elena', 'Error en un número de portal', '2026-11-02');
    expect(db.oficinaItinerarios[itA.id].historial.map((h) => h.accion)).toEqual(['cerrar-revision', 'reabrir']);
    expect(() => confirmarSinCambios(db, ctx('2026-11-03'), a.local.id)).not.toThrow();
  });
});

describe('aislamiento entre itinerarios', () => {
  it('una operación con alcance de un itinerario no puede modificar registros de otro', () => {
    const a = localOcupadoSinVisitar(base, 'IT-A');
    const b = localOcupadoSinVisitar(base, 'IT-B');
    const itB = itinerariosDe(base, C26).find((i) => i.codigo === 'IT-B')!;
    const alcance = { itinerarioId: itB.id };
    expect(() => actualizarRevisiones(base, C26, [a.local.id], { pendienteComprobacion: true }, alcance)).toThrow(/no pertenecen a IT-B/);
    expect(() => clasificar(base, a.negocioId, C26, ACTIVIDADES_HOJA[0].id, 'p-marta', { alcance })).toThrow(ErrorDominio);
    const db = clasificar(base, b.negocioId, C26, ACTIVIDADES_HOJA[0].id, 'p-marta', { alcance });
    // el registro de IT-A queda exactamente igual
    expect(db.revisiones[`${C26}|${a.local.id}`]).toEqual(base.revisiones[`${C26}|${a.local.id}`]);
    expect(clasificacionEn(db, a.negocioId, C26)).toEqual(clasificacionEn(base, a.negocioId, C26));
  });
});
