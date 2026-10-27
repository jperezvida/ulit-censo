import { beforeEach, describe, expect, it } from 'vitest';
import { C25_SINT, C26_SINT, escenarioOficina } from '../data/escenarioOficina';
import { ErrorDominio, kNC, kRev, type BaseDatos } from './db';
import { indiceObservaciones, indiceOcupaciones, ocupacionEn } from './consultas';
import { aprobar, editarNegocio, filasOficina, motivoNoAprobable, resumenDeFilas, type FilaOficina } from './oficina';
import { franquiciaAnterior, franquiciaEn, partirDeFranquiciaAnterior, registrarFranquicia, revisionFranquicia } from './franquicias';
import { motivoNoHeredable, partirDe2025 } from './herencia';
import { ejecutarAccionMasiva, planAccionMasiva } from './acciones';
import { AVISO_SIN_CLASIFICAR, avisosClasificacion } from './avisosClasificacion';
import { clasificar } from './clasificacion';
import { registrarDatoDigital, verificarDigital } from './digital';
import { cerrarRevisionItinerario } from './bloqueo';
import { registrarNuevoNegocio } from './campo';
import { migrarALaActual, migrarV10aV11 } from './migraciones';
import { NODOS_2026, rutaActividad } from './taxonomy';
import { ID_CATALOGO_2026 } from './catalogo2026';
import type { Id, RevisionDigital, VariableDigital } from './types';

let esc: ReturnType<typeof escenarioOficina>;
const P = 'p-marta';
const filas = (db: BaseDatos, it?: Id) => filasOficina(db, C26_SINT, { obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) }, { itinerarioId: it });
const ocupadas = (db: BaseDatos, it = esc.itinerarios[0]) => filas(db, it).filter((f) => !f.vacio && f.situacion === 'registrado');
const nodo = (...ruta: string[]) => NODOS_2026.find((n) => rutaActividad(n.id).map((x) => x.nombre).join('|') === ruta.join('|'))!.id;
const fila = (db: BaseDatos, localId: Id) => filas(db).find((f) => f.localId === localId)!;
const alcance1 = () => ({ itinerarioId: esc.itinerarios[0] });

/** Todo lo necesario para aprobar un registro (categoría, franquicia y digital verificados). */
function completo(db: BaseDatos, f: FilaOficina): BaseDatos {
  let d = clasificar(db, f.negocioId!, C26_SINT, nodo('Comercio', 'Otros equipamientos', 'Estancos', 'Estancos'), P);
  d = registrarFranquicia(d, f.negocioId!, C26_SINT, 'no', P);
  for (const v of ['web', 'ventaOnline', 'googleBusiness', 'instagram', 'facebook', 'twitter'] as VariableDigital[]) d = registrarDatoDigital(d, f.negocioId!, C26_SINT, v, { respuesta: 'no' }, P);
  return verificarDigital(d, f.negocioId!, C26_SINT, P);
}

/** Revisión digital 2025 ficticia de un negocio (para heredar). */
function digital2025(db: BaseDatos, negocioId: Id, datos: RevisionDigital['datos']): BaseDatos {
  return { ...db, digital: { ...db.digital, [kNC(negocioId, C25_SINT)]: { negocioId, campanaId: C25_SINT, datos, estado: 'verificada', historial: [] } } };
}

beforeEach(() => {
  esc = escenarioOficina({ calles: 4, localesPorCalle: 12 });
});

describe('B5 · Franquicia Sí/No distinta del nombre de cadena', () => {
  it('Sí o No registrado por una persona deja la revisión «revisada» con quién y cuándo', () => {
    const [f] = ocupadas(esc.db);
    const db = registrarFranquicia(esc.db, f.negocioId!, C26_SINT, 'si', P, { fecha: '2026-10-01T10:00:00' });
    expect(franquiciaEn(db, f.negocioId, C26_SINT)).toMatchObject({ respuesta: 'si', origen: 'manual', porId: P });
    expect(db.revisiones[kRev(C26_SINT, f.localId)]).toMatchObject({ franquicia: 'revisado', franquiciaPor: P, franquiciaEn: '2026-10-01T10:00:00' });
  });

  it('«sin información» se registra pero no revisa; «no aplicable» no se admite', () => {
    const [f] = ocupadas(esc.db);
    const db = registrarFranquicia(esc.db, f.negocioId!, C26_SINT, 'sin-info', P);
    expect(franquiciaEn(db, f.negocioId, C26_SINT)?.respuesta).toBe('sin-info');
    expect(revisionFranquicia(db.revisiones[kRev(C26_SINT, f.localId)])).toBe('pendiente');
    expect(() => registrarFranquicia(esc.db, f.negocioId!, C26_SINT, 'na', P)).toThrow(/no aplicable/);
  });

  it('tener o no un nombre de cadena no decide la franquicia', () => {
    const [a, b] = ocupadas(esc.db);
    let db = editarNegocio(esc.db, C26_SINT, a.negocioId!, { cadena: 'Cadena Ficticia' });
    // Con cadena y sin respuesta: la franquicia sigue pendiente, no se presupone «Sí»
    expect(franquiciaEn(db, a.negocioId, C26_SINT)).toBeUndefined();
    expect(revisionFranquicia(db.revisiones[kRev(C26_SINT, a.localId)])).toBe('pendiente');
    // Sin cadena: tampoco se presupone «No»
    expect(db.negocios[b.negocioId!].cadena).toBeUndefined();
    expect(franquiciaEn(db, b.negocioId, C26_SINT)).toBeUndefined();
    // Se puede registrar «No» para un negocio con cadena y «Sí» para uno sin cadena
    db = registrarFranquicia(db, a.negocioId!, C26_SINT, 'no', P);
    db = registrarFranquicia(db, b.negocioId!, C26_SINT, 'si', P);
    expect(db.negocios[a.negocioId!].cadena).toBe('Cadena Ficticia');
    expect(franquiciaEn(db, a.negocioId, C26_SINT)?.respuesta).toBe('no');
    expect(franquiciaEn(db, b.negocioId, C26_SINT)?.respuesta).toBe('si');
  });

  it('cambiar la respuesta tras revisarla conserva el historial y devuelve a pendiente la aprobación', () => {
    const [f] = ocupadas(esc.db);
    let db = completo(esc.db, f);
    db = aprobar(db, C26_SINT, [fila(db, f.localId)]).db;
    expect(db.revisiones[kRev(C26_SINT, f.localId)].validacion).toBe('aprobada');
    db = registrarFranquicia(db, f.negocioId!, C26_SINT, 'si', 'p-elena');
    const r = db.revisiones[kRev(C26_SINT, f.localId)];
    expect(r.validacion).toBe('pendiente');
    expect(r.aprobacionReabierta).toMatchObject({ porId: 'p-elena', motivo: 'Cambio en franquicia' });
    expect(r).toMatchObject({ franquicia: 'revisado', franquiciaPor: 'p-elena' });
    expect(franquiciaEn(db, f.negocioId, C26_SINT)!.historial.map((h) => h.respuesta)).toEqual(['no', 'si']);
  });

  it('progreso de franquicias independiente de categorización y digital', () => {
    const fs = ocupadas(esc.db);
    const antes = resumenDeFilas(filas(esc.db, esc.itinerarios[0]));
    let db = esc.db;
    for (const f of fs.slice(0, 3)) db = registrarFranquicia(db, f.negocioId!, C26_SINT, 'no', P);
    const despues = resumenDeFilas(filas(db, esc.itinerarios[0]));
    expect(despues.franquicias.hechos).toBe(antes.franquicias.hechos + 3);
    expect(despues.categorizacion).toEqual(antes.categorizacion);
    expect(despues.digital).toEqual(antes.digital);
    // Y al revés: clasificar no toca franquicias
    db = clasificar(db, fs[5].negocioId!, C26_SINT, nodo('Comercio', 'Otros equipamientos', 'Estancos', 'Estancos'), P);
    expect(resumenDeFilas(filas(db, esc.itinerarios[0])).franquicias).toEqual(despues.franquicias);
  });

  it('la aprobación general exige la franquicia, sin mezclarla con la verificación digital', () => {
    const [f] = ocupadas(esc.db);
    let db = clasificar(esc.db, f.negocioId!, C26_SINT, nodo('Comercio', 'Otros equipamientos', 'Estancos', 'Estancos'), P);
    expect(motivoNoAprobable(fila(db, f.localId))).toBe('franquicia pendiente');
    db = registrarFranquicia(db, f.negocioId!, C26_SINT, 'no', P);
    expect(motivoNoAprobable(fila(db, f.localId))).toBe('presencia digital pendiente');
    // Verificar la presencia digital no revisa la franquicia (y al revés)
    expect(fila(completo(esc.db, f), f.localId).rev.franquicia).toBe('revisado');
    expect(fila(registrarFranquicia(esc.db, f.negocioId!, C26_SINT, 'si', P), f.localId).rev.digital).toBe('pendiente');
  });

  it('la franquicia 2025 es solo referencia: copiada queda como borrador y hay que comprobarla', () => {
    const f = ocupadas(esc.db).find((x) => ['si', 'no'].includes(franquiciaAnterior(esc.db, x.negocioId!, C26_SINT)?.respuesta ?? ''))!;
    const ant = franquiciaAnterior(esc.db, f.negocioId!, C26_SINT)!;
    expect(franquiciaEn(esc.db, f.negocioId, C26_SINT)).toBeUndefined();
    let db = partirDeFranquiciaAnterior(esc.db, f.negocioId!, C26_SINT, P);
    expect(franquiciaEn(db, f.negocioId, C26_SINT)).toMatchObject({ respuesta: ant.respuesta, origen: 'heredado', desdeCampanaId: C25_SINT });
    expect(revisionFranquicia(db.revisiones[kRev(C26_SINT, f.localId)])).toBe('pendiente');
    // Confirmarla con el mismo valor la deja revisada
    db = registrarFranquicia(db, f.negocioId!, C26_SINT, ant.respuesta, P);
    expect(revisionFranquicia(db.revisiones[kRev(C26_SINT, f.localId)])).toBe('revisado');
    expect(db.franquicias[kNC(f.negocioId!, C25_SINT)]).toEqual(esc.db.franquicias[kNC(f.negocioId!, C25_SINT)]);
  });
});

describe('B5 · Partir de 2025: mismo negocio frente a sustitución', () => {
  it('mismo negocio confirmado en campo: copia clasificación, franquicia y digital como borrador, sin tocar 2025', () => {
    const f = ocupadas(esc.db).find((x) => ['si', 'no'].includes(franquiciaAnterior(esc.db, x.negocioId!, C26_SINT)?.respuesta ?? ''))!;
    let db = digital2025(esc.db, f.negocioId!, { web: { respuesta: 'si', origen: 'importado' }, instagram: { respuesta: 'si', origen: 'importado' }, seguidoresInstagram: { respuesta: 'si', valor: 320, origen: 'importado' } });
    const antes2025 = JSON.stringify([db.clasificaciones[kNC(f.negocioId!, C25_SINT)], db.franquicias[kNC(f.negocioId!, C25_SINT)], db.digital[kNC(f.negocioId!, C25_SINT)]]);
    expect(motivoNoHeredable(db, C26_SINT, f.localId)).toBeNull();
    const r = partirDe2025(db, C26_SINT, [f.localId], P, { alcance: alcance1() });
    db = r.db;
    expect(r.informe.aplicadas[0].partes).toEqual(expect.arrayContaining(['franquicia', 'digital']));
    expect(db.franquicias[kNC(f.negocioId!, C26_SINT)]).toMatchObject({ origen: 'heredado', desdeCampanaId: C25_SINT });
    expect(db.digital[kNC(f.negocioId!, C26_SINT)]).toMatchObject({ estado: 'borrador' });
    expect(db.digital[kNC(f.negocioId!, C26_SINT)].datos.web).toMatchObject({ respuesta: 'si', origen: 'heredado' });
    const cla = db.clasificaciones[kNC(f.negocioId!, C26_SINT)];
    if (cla) expect(cla).toMatchObject({ origen: 'heredado', confirmada: false });
    // Nada queda comprobado ni verificado en 2026
    const rev = db.revisiones[kRev(C26_SINT, f.localId)];
    expect(rev).toMatchObject({ categorizacion: 'pendiente', digital: 'pendiente', validacion: 'pendiente' });
    expect(revisionFranquicia(rev)).toBe('pendiente');
    // Imposible verificar lo copiado sin comprobarlo
    expect(() => verificarDigital(db, f.negocioId!, C26_SINT, P)).toThrow(ErrorDominio);
    expect(JSON.stringify([db.clasificaciones[kNC(f.negocioId!, C25_SINT)], db.franquicias[kNC(f.negocioId!, C25_SINT)], db.digital[kNC(f.negocioId!, C25_SINT)]])).toBe(antes2025);
  });

  it('una farmacia sustituida por una perfumería no hereda nada de la farmacia', () => {
    const f = ocupadas(esc.db)[0];
    let db = digital2025(esc.db, f.negocioId!, { web: { respuesta: 'si', origen: 'importado' } });
    db = registrarNuevoNegocio(db, { campanaId: C26_SINT, investigadorId: 'p-ana', fecha: '2026-10-05T10:00:00' }, f.localId, 'Perfumería Nueva Prueba');
    const nuevo = ocupacionEn(db, f.localId, C26_SINT)!.negocioId!;
    expect(nuevo).not.toBe(f.negocioId);
    expect(motivoNoHeredable(db, C26_SINT, f.localId)).toMatch(/otro negocio/);
    const r = partirDe2025(db, C26_SINT, [f.localId], P);
    expect(r.informe.aplicadas).toEqual([]);
    expect(r.informe.excluidas).toEqual([{ localId: f.localId, motivo: expect.stringMatching(/otro negocio/) }]);
    expect(r.db.franquicias[kNC(nuevo, C26_SINT)]).toBeUndefined();
    expect(r.db.digital[kNC(nuevo, C26_SINT)]).toBeUndefined();
    expect(r.db.clasificaciones[kNC(nuevo, C26_SINT)]).toBeUndefined();
  });

  it('no sobrescribe lo ya registrado en 2026', () => {
    const f = ocupadas(esc.db).find((x) => franquiciaAnterior(esc.db, x.negocioId!, C26_SINT)?.respuesta === 'no' || franquiciaAnterior(esc.db, x.negocioId!, C26_SINT)?.respuesta === 'si')!;
    const ant = franquiciaAnterior(esc.db, f.negocioId!, C26_SINT)!.respuesta;
    const otra = ant === 'si' ? 'no' : 'si';
    let db = registrarFranquicia(esc.db, f.negocioId!, C26_SINT, otra, P);
    db = registrarDatoDigital(db, f.negocioId!, C26_SINT, 'web', { respuesta: 'no' }, P);
    db = digital2025(db, f.negocioId!, { web: { respuesta: 'si', origen: 'importado' } });
    const r = partirDe2025(db, C26_SINT, [f.localId], P);
    expect(franquiciaEn(r.db, f.negocioId, C26_SINT)).toMatchObject({ respuesta: otra, origen: 'manual' });
    expect(r.db.digital[kNC(f.negocioId!, C26_SINT)].datos.web).toMatchObject({ respuesta: 'no', origen: 'manual' });
    expect(r.informe.conservadas.map((x) => x.parte)).toContain('franquicia');
  });

  it('los datos históricos inválidos se señalan y no se copian', () => {
    const f = ocupadas(esc.db)[1];
    const db = digital2025(esc.db, f.negocioId!, {
      web: { respuesta: 'si', origen: 'importado' },
      instagram: { respuesta: 'no', origen: 'importado' },
      seguidoresInstagram: { respuesta: 'si', valor: 500, origen: 'importado' }, // incoherente
      numResenas: { respuesta: 'si', origen: 'importado' }, // sin valor
    });
    const r = partirDe2025(db, C26_SINT, [f.localId], P);
    const datos = r.db.digital[kNC(f.negocioId!, C26_SINT)].datos;
    expect(datos.web).toMatchObject({ respuesta: 'si', origen: 'heredado' });
    expect(datos.seguidoresInstagram).toBeUndefined();
    expect(datos.numResenas).toBeUndefined();
    expect(r.informe.senaladas.map((x) => x.detalle).join(' ')).toMatch(/Seguidores Instagram/);
    expect(r.informe.senaladas.map((x) => x.detalle).join(' ')).toMatch(/Nº de reseñas/);
  });

  it('casos dudosos (conciliación o cronología incierta) no heredan', () => {
    const db = esc.db;
    const localIncierto = Object.values(db.locales).find((l) => Object.values(db.observaciones).some((o) => o.localId === l.id && o.campanaId === C26_SINT && o.cronologia === 'incierta'));
    // Sin casos en el escenario base: se fuerzan con una conciliación pendiente
    const f = ocupadas(db)[2];
    const conVinculo: BaseDatos = { ...db, vinculos: { ...db.vinculos, v1: { id: 'v1', origen: { tipo: 'observacion', id: `obs26-${f.localId}` }, localId: f.localId, confianza: 'dudosa', criterio: 'prueba' } } };
    expect(motivoNoHeredable(conVinculo, C26_SINT, f.localId)).toMatch(/Conciliación pendiente/);
    expect(localIncierto).toBeUndefined();
  });

  it('atómico: un registro bloqueado o fuera del itinerario impide toda la operación', () => {
    const [a, b] = ocupadas(esc.db);
    const db = cerrarRevisionItinerario(esc.db, esc.itinerarios[0], 'p-elena');
    const antes = JSON.stringify(db);
    expect(() => partirDe2025(db, C26_SINT, [a.localId, b.localId], P)).toThrow(/revisión cerrada/);
    expect(JSON.stringify(db)).toBe(antes);
    const deIt2 = filas(esc.db, esc.itinerarios[1]).find((x) => !x.vacio && x.situacion === 'registrado')!;
    expect(() => partirDe2025(esc.db, C26_SINT, [a.localId, deIt2.localId], P, { alcance: alcance1() })).toThrow(/no pertenecen/);
  });
});

describe('B5 · Acciones masivas', () => {
  it('plan: registros afectados, operación y excluidos con motivo', () => {
    const fs = filas(esc.db, esc.itinerarios[1]);
    const plan = planAccionMasiva(esc.db, C26_SINT, fs, { tipo: 'respuesta', variable: 'franquicia', respuesta: 'no' }, { alcance: { itinerarioId: esc.itinerarios[1] }, porId: P });
    expect(plan.descripcion).toBe('Franquicia = No');
    expect(plan.aplicables.every((f) => !f.vacio && f.situacion === 'registrado')).toBe(true);
    expect(plan.excluidas.map((x) => x.motivo)).toEqual(expect.arrayContaining(['Pendiente de visitar en campo']));
    expect(plan.aplicables.length + plan.excluidas.length).toBe(fs.length);
  });

  it('respuesta masiva: se aplica a todos y nunca verifica lo digital ni aprueba', () => {
    const fs = ocupadas(esc.db);
    let db = ejecutarAccionMasiva(esc.db, C26_SINT, fs, { tipo: 'respuesta', variable: 'franquicia', respuesta: 'no' }, P, alcance1());
    expect(fs.every((f) => franquiciaEn(db, f.negocioId, C26_SINT)?.respuesta === 'no')).toBe(true);
    for (const v of ['web', 'ventaOnline', 'googleBusiness', 'instagram', 'facebook', 'twitter'] as VariableDigital[]) {
      db = ejecutarAccionMasiva(db, C26_SINT, fs, { tipo: 'respuesta', variable: v, respuesta: 'no' }, P, alcance1());
    }
    for (const f of fs) {
      expect(db.digital[kNC(f.negocioId!, C26_SINT)].estado).toBe('borrador');
      expect(db.revisiones[kRev(C26_SINT, f.localId)]).toMatchObject({ digital: 'pendiente', validacion: 'pendiente' });
    }
  });

  it('atómica: si un registro está bloqueado o fuera de alcance no se aplica ninguno', () => {
    const fs1 = ocupadas(esc.db);
    const fs2 = filas(esc.db, esc.itinerarios[1]).filter((f) => !f.vacio && f.situacion === 'registrado');
    const accion = { tipo: 'respuesta', variable: 'franquicia', respuesta: 'si' } as const;
    expect(() => ejecutarAccionMasiva(esc.db, C26_SINT, [...fs1.slice(0, 2), fs2[0]], accion, P, alcance1())).toThrow(/no pertenecen/);
    const cerrado = cerrarRevisionItinerario(esc.db, esc.itinerarios[1], 'p-elena');
    const antes = JSON.stringify(cerrado);
    expect(() => ejecutarAccionMasiva(cerrado, C26_SINT, [fs1[0], fs2[0]], accion, P)).toThrow(/revisión cerrada/);
    expect(JSON.stringify(cerrado)).toBe(antes);
    // El plan excluye los bloqueados antes de proponer nada
    const plan = planAccionMasiva(cerrado, C26_SINT, filas(cerrado).filter((f) => f.localId === fs1[0].localId || f.localId === fs2[0].localId), accion, { porId: P });
    expect(plan.aplicables.map((f) => f.localId)).toEqual([fs1[0].localId]);
    expect(plan.excluidas[0].motivo).toMatch(/revisión cerrada/);
  });

  it('clasificación elegida explícitamente, incidencia y preparación desde 2025', () => {
    const fs = ocupadas(esc.db).slice(0, 4);
    const estancos = nodo('Comercio', 'Otros equipamientos', 'Estancos', 'Estancos');
    let db = ejecutarAccionMasiva(esc.db, C26_SINT, fs, { tipo: 'clasificacion', nodoId: estancos }, P, alcance1());
    expect(fs.every((f) => db.clasificaciones[kNC(f.negocioId!, C26_SINT)]?.actividadId === estancos)).toBe(true);
    expect(() => ejecutarAccionMasiva(esc.db, C26_SINT, fs, { tipo: 'clasificacion', nodoId: 'c26.C' }, P)).toThrow(/es un grupo/);
    db = ejecutarAccionMasiva(db, C26_SINT, fs, { tipo: 'incidencia', motivo: 'Revisar rótulo' }, P, alcance1());
    expect(fs.every((f) => db.revisiones[kRev(C26_SINT, f.localId)].pendienteComprobacion && db.revisiones[kRev(C26_SINT, f.localId)].motivoComprobacion === 'Revisar rótulo')).toBe(true);
    const plan = planAccionMasiva(esc.db, C26_SINT, fs, { tipo: 'partir2025' }, { porId: P });
    expect(plan.herencia).toBeDefined();
    const d2 = ejecutarAccionMasiva(esc.db, C26_SINT, plan.aplicables, { tipo: 'partir2025' }, P);
    for (const f of plan.aplicables) expect(revisionFranquicia(d2.revisiones[kRev(C26_SINT, f.localId)])).toBe('pendiente');
  });
});

describe('B5 · Avisos de clasificación sospechosa (no bloqueantes)', () => {
  const C = ID_CATALOGO_2026;
  const cla = (actividadId: Id, descripcion?: string) => ({ negocioId: 'n', campanaId: C26_SINT, actividadId, descripcion, origen: 'manual' as const, confirmada: true });
  it('los cuatro casos mínimos', () => {
    expect(avisosClasificacion(C, undefined, 'Lo que sea')).toEqual([AVISO_SIN_CLASIFICAR]);
    expect(avisosClasificacion(C, cla('a1-comercio.alimentacion.carnes.carniceria'), 'X')[0] ?? '').toMatch(/otro catálogo|Combinación/);
    expect(avisosClasificacion(C, cla(nodo('Comercio', 'Alimentación', 'Carnes')), 'Carnes Pepe')[0]).toMatch(/Combinación incoherente/);
    expect(avisosClasificacion(C, cla(nodo('Hostelería y Restauración', 'Bares y cafeterías', 'Bar')), 'Farmacia Central')[0]).toMatch(/El nombre sugiere «Farmacias»/);
  });
  it('sin contradicción fuerte no hay aviso; nunca cambia la actividad', () => {
    expect(avisosClasificacion(C, cla(nodo('Comercio', 'Otros equipamientos', 'Ocio', 'Papelería, prensa y librería')), 'Librería El Nogal')).toEqual([]);
    expect(avisosClasificacion(C, cla(nodo('Hostelería y Restauración', 'Bares y cafeterías', 'Cafetería')), 'Bar Delia')).toEqual([]); // misma rama
    expect(avisosClasificacion(C, cla(nodo('Servicios', 'Servicios médicos'), 'Fisioterapia'), 'Clínica Sol')).toEqual([]);
    const [f] = ocupadas(esc.db);
    const db = clasificar(esc.db, f.negocioId!, C26_SINT, nodo('Hostelería y Restauración', 'Bares y cafeterías', 'Bar'), P);
    const conAviso = fila(db, f.localId);
    expect(conAviso.actividadId).toBe(nodo('Hostelería y Restauración', 'Bares y cafeterías', 'Bar'));
    expect(motivoNoAprobable(conAviso)).not.toMatch(/aviso/);
  });
});

describe('B5 · Migración v10 → v11', () => {
  function v10(): BaseDatos {
    const db = structuredClone(esc.db) as BaseDatos;
    delete (db as { franquicias?: unknown }).franquicias;
    for (const r of Object.values(db.revisiones)) delete (r as { franquicia?: unknown }).franquicia;
    // una aprobación previa a B5
    const [f] = ocupadas(esc.db);
    db.revisiones[kRev(C26_SINT, f.localId)].validacion = 'aprobada';
    return { ...(db as BaseDatos), version: 10 };
  }
  it('añade el almacén vacío, no deduce franquicias de la cadena y no toca lo demás', () => {
    const antes = v10();
    const { db, aprobadasSinFranquicia } = migrarV10aV11(antes);
    expect(db.version).toBe(11);
    expect(db.franquicias).toEqual({});
    expect(aprobadasSinFranquicia).toBe(1);
    expect(db.revisiones).toEqual(antes.revisiones);
    expect(db.clasificaciones).toEqual(antes.clasificaciones);
    expect(db.negocios).toEqual(antes.negocios);
    // Es idempotente con datos ya migrados
    expect(migrarALaActual(db).db).toBe(db);
  });
  it('encadena v9 → v10 → v11', () => {
    const d9 = { ...v10(), version: 9 };
    const { db, avisos } = migrarALaActual(d9);
    expect(db.version).toBe(11);
    expect(avisos.join(' ')).toMatch(/franquicia pendiente/);
  });
});

describe('B5 · Rendimiento', () => {
  it('miles de registros: filas con avisos y acción masiva atómica en tiempo razonable', () => {
    const grande = escenarioOficina({ calles: 44, localesPorCalle: 80, callesPorItinerario: 40 });
    let t = performance.now();
    const fs = filasOficina(grande.db, C26_SINT, { obs: indiceObservaciones(grande.db), ocu: indiceOcupaciones(grande.db) }, { itinerarioId: grande.itinerarios[2] });
    const tFilas = performance.now() - t;
    const objetivo = fs.filter((f) => !f.vacio && f.situacion === 'registrado');
    expect(objetivo.length).toBeGreaterThan(2000);
    t = performance.now();
    const plan = planAccionMasiva(grande.db, C26_SINT, objetivo, { tipo: 'respuesta', variable: 'franquicia', respuesta: 'no' }, { alcance: { itinerarioId: grande.itinerarios[2] }, porId: P });
    const db = ejecutarAccionMasiva(grande.db, C26_SINT, plan.aplicables, { tipo: 'respuesta', variable: 'franquicia', respuesta: 'no' }, P, { itinerarioId: grande.itinerarios[2] });
    const tAccion = performance.now() - t;
    expect(Object.values(db.franquicias).filter((x) => x.campanaId === C26_SINT).length).toBe(plan.aplicables.length);
    t = performance.now();
    const estancos = nodo('Comercio', 'Otros equipamientos', 'Estancos', 'Estancos');
    const d2 = ejecutarAccionMasiva(db, C26_SINT, plan.aplicables, { tipo: 'clasificacion', nodoId: estancos }, P, { itinerarioId: grande.itinerarios[2] });
    const tClasif = performance.now() - t;
    expect(plan.aplicables.every((f) => d2.clasificaciones[kNC(f.negocioId!, C26_SINT)]?.actividadId === estancos)).toBe(true);
    t = performance.now();
    const planH = planAccionMasiva(grande.db, C26_SINT, objetivo, { tipo: 'partir2025' }, { porId: P });
    ejecutarAccionMasiva(grande.db, C26_SINT, planH.aplicables, { tipo: 'partir2025' }, P);
    const tHerencia = performance.now() - t;
    console.info(`[rendimiento B5] ${fs.length} filas en ${tFilas.toFixed(0)} ms · respuesta masiva sobre ${plan.aplicables.length} en ${tAccion.toFixed(0)} ms · clasificación masiva ${tClasif.toFixed(0)} ms · partir de 2025 (plan + ejecución, ${planH.aplicables.length}) ${tHerencia.toFixed(0)} ms`);
    expect(tFilas).toBeLessThan(5000);
    expect(tAccion).toBeLessThan(3000);
    expect(tClasif).toBeLessThan(5000);
    expect(tHerencia).toBeLessThan(10000);
  }, 60000);
});
