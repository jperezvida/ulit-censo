// @vitest-environment node
/**
 * Recorrido completo contra un Supabase LOCAL (nunca el compartido) con datos SINTÉTICOS.
 * Solo se ejecuta con `docs/persistencia/pruebas/e2e-supabase-local.sh`, que levanta el entorno, aplica
 * las migraciones y define las variables; con `npm test` normal se omite.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEspacios } from './espacios';
import { AlmacenSupabase, ConflictoRemoto, partir, diferencia, jsonCanonico } from './almacenSupabase';
import { crearBaseEspacio, municipioDeEspacio, PREFIJO, personaEspacio } from '../domain/espacios';
import { createHash } from 'node:crypto';
import { altaMunicipio, crearCampana, TERRITORIO_INICIAL } from '../domain/municipios';
import { aplicarCarga } from '../domain/callejeros';
import { leerOsmMunicipio } from '../domain/fuentesCallejero';
import { osmVillaSintetica } from '../data/callejeroSintetico';
import { archivoItinerario, libroConFilas, libroItinerario } from '../data/xlsxItinerarios';
import { prepararIncorporacion } from '../domain/incorporacionXlsx';
import { aplicarIncorporacion } from '../domain/incorporacion';
import { crearItinerario } from '../domain/campanaOperativa';
import { pendientesCampana, vincularALocal } from '../domain/conciliacionPosterior';
import { clasificar } from '../domain/clasificacion';
import { registrarDatoDigital, verificarDigital } from '../domain/digital';
import { validarInstantanea } from '../data/instantaneaOsm';
import { ARCHIVO_SINTETICO_C1E, libroSinteticoC1e } from '../data/xlsxSinteticoC1e';
import { FILAS_2025 } from '../domain/censo2026.fixture';
import { kNC, type BaseDatos } from '../domain/db';

const URL = process.env.ULIT_CENSO_SUPABASE_LOCAL_URL ?? '';
const PUB = process.env.ULIT_CENSO_SUPABASE_LOCAL_PUBLICA ?? '';
const SECRETA = process.env.ULIT_CENSO_SUPABASE_LOCAL_SECRETA ?? ''; // solo en esta prueba local, para crear cuentas
const PSQL = process.env.ULIT_CENSO_SUPABASE_LOCAL_PSQL ?? '';
const NOMBRE = 'Coordinación Sintética';
const CLAVE = 'contraseña-sintética-1';
const sql = (q: string) => execFileSync('psql', [PSQL, '-v', 'ON_ERROR_STOP=1', '-At', '-c', q], { encoding: 'utf8' }).trim();

async function cuenta(email: string) {
  const r = await fetch(`${URL}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SECRETA, Authorization: `Bearer ${SECRETA}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: CLAVE, email_confirm: true }) });
  const j = await r.json() as { id?: string };
  return j.id ?? sql(`select id from auth.users where email = '${email}'`);
}
async function sesion(email: string): Promise<SupabaseClient> {
  const c = createClient(URL, PUB, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: CLAVE });
  if (error) throw error;
  return c;
}
const huella = (db: BaseDatos) => createHash('sha256').update(jsonCanonico(db)).digest('hex');
const dbAbierta = () => useEspacios.getState().db!;
const modificar = async (m: string, f: (db: BaseDatos, ctx: { prefijo: string; porId: string }) => BaseDatos) => {
  const r = await useEspacios.getState().modificar(m, f);
  if (!r.ok) throw new Error(r.error);
};

describe.skipIf(!URL)('ULIT Censo contra Supabase local (SINTÉTICO)', () => {
  const ESPACIO = `ensayo-e2e-${Date.now().toString(36)}`;
  let coord: SupabaseClient;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    for (const k of ['coord', 'revisora', 'lectora', 'adminbase']) ids[k] = await cuenta(`${k}-${ESPACIO}@ejemplo.invalid`);
    // ULIT base: una administradora suya (perfiles.rol = admin) que NO es miembro de ULIT Censo.
    sql(`insert into public.perfiles (id, rol) values ('${ids.adminbase}', 'admin') on conflict do nothing`);
    // Alta del espacio y de sus miembros (plantilla 0003, hecha por la administración).
    const persona = crearBaseEspacio('ensayo', { persona: { nombre: NOMBRE, roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: 'x', incluirMedina: false }).meta.espacioCreadoPorId!;
    sql(`insert into ulit_censo.espacio (id, tipo, nombre, escritura_habilitada) values ('${ESPACIO}', 'ensayo', 'E2E sintético', true);
         insert into ulit_censo.miembro (espacio_id, usuario_id, rol, persona_id) values
           ('${ESPACIO}', '${ids.coord}', 'administrador', '${persona}'),
           ('${ESPACIO}', '${ids.revisora}', 'revisor', 'ensayo-p-revisora'),
           ('${ESPACIO}', '${ids.lectora}', 'lector', 'ensayo-p-lectora');`);
    coord = await sesion(`coord-${ESPACIO}@ejemplo.invalid`);
  }, 60000);

  it('recorrido completo: crear, 2025, 2026 e IT1, G5, Oficina, recarga, copia y restauración; conflictos y permisos', async () => {
    const t0 = Date.now();
    // 1 · Crear y abrir el espacio en el servidor
    await useEspacios.getState().abrirRemoto(new AlmacenSupabase(coord, ESPACIO));
    expect(useEspacios.getState().fase).toBe('sin-crear');
    // La identidad de Auth no depende del nombre libre escrito en la pantalla.
    expect((await useEspacios.getState().crear({ nombre: 'Nombre mostrado diferente', roles: ['coordinador'] }, { incluirMedina: false })).ok).toBe(true);
    expect(dbAbierta().meta.espacioId).toBe(ESPACIO);
    expect(personaEspacio(dbAbierta())!.id).toBe(crearBaseEspacio('ensayo', { persona: { nombre: NOMBRE, roles: ['coordinador'] }, calles: [], detalleCallejero: '', espacioId: ESPACIO, incluirMedina: false }).meta.espacioCreadoPorId);
    expect(personaEspacio(dbAbierta())!.nombre).toBe('Nombre mostrado diferente');
    const porId = personaEspacio(dbAbierta())!.id;
    const o = { prefijo: PREFIJO.ensayo, porId, anioActual: 2026 };
    let munId = '';
    await modificar('Municipio sintético', (db) => { const m = altaMunicipio(db, { nombre: 'Villa Sintética de Arriba', ine: '99001', provincia: 'Provincia Sintética', territorio: TERRITORIO_INICIAL }, o); munId = m.municipioId; return m.db; });
    const j = osmVillaSintetica(1); const l = leerOsmMunicipio(j, { nombre: 'Villa Sintética de Arriba', ine: '99001' }); if (!l.ok) throw new Error(l.motivo);
    await modificar('Callejero sintético', (db) => aplicarCarga(db, munId, l, { archivo: 'v.json', contenido: JSON.stringify(j), fuente: 'OpenStreetMap (Overpass API)' }, o).db);
    let h25 = '', c26 = '', it1 = '';
    await modificar('Campaña 2025', (db) => { const r = crearCampana(db, { municipioId: munId, anio: 2025, nombre: 'Censo 2025', clase: 'historica' }, o); h25 = r.campanaId; return r.db; });

    // 2 · Incorporar el censo sintético 2025 (vía `incorporar`, la misma que usa el asistente)
    const d25 = { municipioId: munId, anio: 2025, campanaId: h25 };
    const p25 = await prepararIncorporacion(dbAbierta(), await libroConFilas('IT1', FILAS_2025), 'censo_2025_SINTETICO.xlsx', d25, {});
    expect((await useEspacios.getState().incorporar({ resultado: p25.resultado, destino: d25, decisiones: {}, plan: p25.plan, requisitos: [] })).ok).toBe(true);

    // 3 · Campaña operativa 2026 e IT1
    await modificar('Campaña 2026', (db) => { const r = crearCampana(db, { municipioId: munId, anio: 2026, nombre: 'Censo 2026', clase: 'operativa', tipoOperativa: 'actualizacion', campanaReferenciaId: h25 }, o); c26 = r.campanaId; return r.db; });
    await modificar('IT1', (db) => { const r = crearItinerario(db, c26, { codigo: 'IT1' }, o); it1 = r.itinerarioId; return r.db; });
    const d26 = { municipioId: munId, anio: 2026, campanaId: c26, itinerarioId: it1 };
    const p26 = await prepararIncorporacion(dbAbierta(), await libroItinerario('IT1'), archivoItinerario('IT1'), d26, {});
    expect((await useEspacios.getState().incorporar({ resultado: p26.resultado, destino: d26, decisiones: {}, plan: p26.plan, requisitos: [] })).ok).toBe(true);

    // 4 · Conciliación G5 de una fila clara
    const pan = pendientesCampana(dbAbierta(), c26).find((p) => p.nombre === 'PANADERÍA SINTÉTICA')!;
    await modificar('Conciliación', (db) => vincularALocal(db, c26, pan.registroId, pan.candidatos[0].localId, { porId }));
    // 5 · Oficina: clasificar el alta, redes y reseñas, verificar
    const bar = Object.values(dbAbierta().negocios).find((n) => n.nombre === 'BAR SINTÉTICO EL OLMO')!;
    const al = { itinerarioId: it1 };
    await modificar('Bar', (db) => clasificar(db, bar.id, c26, 'a1-hosteleria.restauracion.bares-y-cafeterias.bar', porId, { alcance: al }));
    await modificar('Google', (db) => registrarDatoDigital(db, bar.id, c26, 'googleBusiness', { respuesta: 'si' }, porId, { alcance: al }));
    await modificar('Reseñas', (db) => registrarDatoDigital(db, bar.id, c26, 'numResenas', { respuesta: 'si', valor: 37 }, porId, { alcance: al }));
    await modificar('Responde', (db) => registrarDatoDigital(db, bar.id, c26, 'respondeResenas', { respuesta: 'no' }, porId, { alcance: al }));
    for (const v of ['web', 'ventaOnline', 'facebook', 'twitter'] as const) await modificar(v, (db) => registrarDatoDigital(db, bar.id, c26, v, { respuesta: 'no' }, porId, { alcance: al }));
    await modificar('Instagram', (db) => registrarDatoDigital(db, bar.id, c26, 'instagram', { respuesta: 'si' }, porId, { alcance: al }));
    await modificar('Seguidores', (db) => registrarDatoDigital(db, bar.id, c26, 'seguidoresInstagram', { respuesta: 'si', valor: 120 }, porId, { alcance: al }));
    await modificar('Verificar', (db) => verificarDigital(db, bar.id, c26, porId, { alcance: al }));
    const huellaTrabajo = huella(dbAbierta());
    const obs2025 = () => jsonCanonico(Object.fromEntries(Object.entries(dbAbierta().observaciones).filter(([, x]) => x.campanaId === h25)));
    const historico25 = obs2025();

    // 6 · Cerrar y volver a entrar (otra sesión): todo recuperado, idéntico
    useEspacios.getState().cerrar();
    const coord2 = await sesion(`coord-${ESPACIO}@ejemplo.invalid`);
    await useEspacios.getState().abrirRemoto(new AlmacenSupabase(coord2, ESPACIO));
    expect(useEspacios.getState().fase).toBe('listo');
    expect(huella(dbAbierta())).toBe(huellaTrabajo);
    expect(dbAbierta().digital[kNC(bar.id, c26)]).toMatchObject({ estado: 'verificada', datos: { numResenas: { valor: 37 }, seguidoresInstagram: { valor: 120 } } });
    expect(dbAbierta().clasificaciones[kNC(bar.id, c26)]).toMatchObject({ actividadId: 'a1-hosteleria.restauracion.bares-y-cafeterias.bar' });

    // 7 · Copia, exportación y restauración
    const almacen = useEspacios.getState().remoto!;
    const copia = await almacen.crearCopia('Antes de un error simulado');
    const exp = await almacen.descargarCopia(copia);
    expect(exp.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((exp.contenido as { version: number }).version).toBe(almacen.version);
    await modificar('Error simulado', (db) => registrarDatoDigital(db, bar.id, c26, 'web', { respuesta: 'si' }, porId, { alcance: al }));
    expect(huella(dbAbierta())).not.toBe(huellaTrabajo);
    await almacen.restaurarCopia(copia, 'Deshacer el error simulado');
    await useEspacios.getState().reabrir();
    expect(huella(dbAbierta())).toBe(huellaTrabajo);

    // 8a · Conflicto: otra pestaña guardó antes → no se sobrescribe
    const otra = new AlmacenSupabase(await sesion(`coord-${ESPACIO}@ejemplo.invalid`), ESPACIO);
    const { db: dbOtra } = await otra.leer();
    await modificar('Esta pestaña guarda', (db) => registrarDatoDigital(db, bar.id, c26, 'valoracion', { respuesta: 'si', valor: 4.5 }, porId, { alcance: al }));
    const enOtra = registrarDatoDigital(dbOtra!, bar.id, c26, 'valoracion', { respuesta: 'si', valor: 1 }, porId, { alcance: al });
    await expect(otra.guardar(dbOtra!, enOtra, 'Pestaña antigua')).rejects.toBeInstanceOf(ConflictoRemoto);
    await useEspacios.getState().reabrir();
    expect(dbAbierta().digital[kNC(bar.id, c26)].datos.valoracion?.valor).toBe(4.5);
    // En el store, un conflicto se informa y no cambia nada
    const vAntes = useEspacios.getState().remoto!.version;
    useEspacios.getState().remoto!.info!.version = vAntes - 1;
    const r = await useEspacios.getState().modificar('Con versión antigua', (db) => registrarDatoDigital(db, bar.id, c26, 'web', { respuesta: 'si' }, porId, { alcance: al }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/No se ha sobrescrito nada/) });
    useEspacios.getState().remoto!.info!.version = vAntes;

    // 8b · Permisos y protección del histórico 2025 (JSON manipulado enviado directamente a la API)
    const base = dbAbierta();
    const obs25 = Object.values(base.observaciones).find((x) => x.campanaId === h25)!;
    const revisora = new AlmacenSupabase(await sesion(`revisora-${ESPACIO}@ejemplo.invalid`), ESPACIO); await revisora.leer();
    const tocar25 = { ...base, observaciones: { ...base.observaciones, [obs25.id]: { ...obs25, datos: { ...obs25.datos, nombre: 'MANIPULADO' } } } };
    await expect(revisora.guardar(base, tocar25, 'manipulado')).rejects.toThrow(/censo histórico solo lo modifica coordinación/);
    const camp = { ...base, campanas: { ...base.campanas, [c26]: { ...base.campanas[c26], tipo: 'historico-importado' as const } } };
    await expect(revisora.guardar(base, camp, 'manipulado')).rejects.toThrow(/no puede modificar campanas/);
    const persona = { ...base, personas: { ...base.personas, 'ensayo-p-revisora': { id: 'ensayo-p-revisora', nombre: 'X', iniciales: 'X', roles: ['administrador' as const], color: '#000' } } };
    await expect(revisora.guardar(base, persona, 'manipulado')).rejects.toThrow(/no puede modificar personas/);
    // Protección indirecta: un local o negocio que figura en 2025 no lo cambia ni lo borra la revisión
    const local25 = base.locales[obs25.localId!];
    await expect(revisora.guardar(base, { ...base, locales: { ...base.locales, [local25.id]: { ...local25, estado: 'desaparecido' as never } } }, 'manipulado')).rejects.toThrow(/vinculado al histórico/);
    const { [local25.id]: _borrado, ...sinLocal } = base.locales;
    await expect(revisora.guardar(base, { ...base, locales: sinLocal }, 'manipulado')).rejects.toThrow(/vinculado al histórico/);
    const neg25 = Object.values(base.ocupaciones).find((x) => x.desdeCampanaId === h25 && x.negocioId)!.negocioId!;
    await expect(revisora.guardar(base, { ...base, negocios: { ...base.negocios, [neg25]: { ...base.negocios[neg25], nombre: 'MANIPULADO' } } }, 'manipulado')).rejects.toThrow(/vinculado al histórico/);
    const lectora = new AlmacenSupabase(await sesion(`lectora-${ESPACIO}@ejemplo.invalid`), ESPACIO); await lectora.leer();
    await expect(lectora.guardar(base, registrarDatoDigital(base, bar.id, c26, 'web', { respuesta: 'si' }, porId, { alcance: al }), 'x')).rejects.toThrow(/sin permiso/);
    const adminBase = await sesion(`adminbase-${ESPACIO}@ejemplo.invalid`);
    expect((await adminBase.rpc('ulit_censo_mis_espacios')).data).toEqual([]);
    expect((await adminBase.rpc('ulit_censo_leer', { p_espacio: ESPACIO })).error?.message).toMatch(/sin permiso/);
    const anonimo = createClient(URL, PUB, { auth: { persistSession: false } });
    expect((await anonimo.rpc('ulit_censo_leer', { p_espacio: ESPACIO })).error?.code).toBe('42501');
    expect((await anonimo.schema('ulit_censo' as never).from('entidad').select('*')).error).toBeTruthy();
    // El histórico 2025 sigue intacto
    await useEspacios.getState().reabrir();
    expect(obs2025()).toBe(historico25);
    console.log(`Recorrido completo en ${((Date.now() - t0) / 1000).toFixed(1)} s · versión final ${useEspacios.getState().remoto!.version}`);
  }, 180000);

  it('carga grande (Medina 2025 sintético, ~5.600 entidades): por partes, en una transacción, dentro de los límites', async () => {
    const v = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
    if (!v.ok) throw new Error(v.motivo);
    const ESP2 = `${ESPACIO}-grande`;
    let db = crearBaseEspacio('ensayo', { persona: { nombre: NOMBRE, roles: ['coordinador'] }, calles: v.calles, detalleCallejero: 'OSM', espacioId: ESP2 });
    sql(`insert into ulit_censo.espacio (id, tipo, nombre, escritura_habilitada) values ('${ESP2}', 'ensayo', 'Carga grande', true);
         insert into ulit_censo.miembro (espacio_id, usuario_id, rol, persona_id) values ('${ESP2}', '${ids.coord}', 'coordinador', '${db.meta.espacioCreadoPorId}');`);
    const porId = db.meta.espacioCreadoPorId!;
    const h = crearCampana(db, { municipioId: municipioDeEspacio('ensayo'), anio: 2025, nombre: 'Censo 2025 (sintético C1e)', clase: 'historica' }, { prefijo: PREFIJO.ensayo, porId }); db = h.db;
    const d25 = { municipioId: municipioDeEspacio('ensayo'), anio: 2025, campanaId: h.campanaId };
    const p = await prepararIncorporacion(db, await libroSinteticoC1e(v.calles), ARCHIVO_SINTETICO_C1E, d25, {});
    db = aplicarIncorporacion(db, p.resultado, d25, {}, p.plan, { porId }).db;
    const cambios = diferencia(null, db);
    expect(db.meta.espacioId).toBe(ESP2);
    const partes = partir(cambios);
    const almacen = new AlmacenSupabase(coord, ESP2); await almacen.leer();
    const t = Date.now();
    await almacen.guardar(null, db, 'Carga del censo 2025 sintético');
    const ms = Date.now() - t;
    const { db: leido } = await new AlmacenSupabase(coord, ESP2).leer();
    expect(huella(leido!)).toBe(huella(db));
    expect(almacen.version).toBe(1); // una sola operación (atómica) aunque se suba por partes
    const tamanos = partes.map((x) => JSON.stringify(x).length);
    console.log(`Carga grande: ${cambios.length} entidades en ${partes.length} partes (máx ${(Math.max(...tamanos) / 1e6).toFixed(2)} MB) · ${(ms / 1000).toFixed(1)} s en total`);
    expect(partes.length).toBeGreaterThan(1);
    expect(Math.max(...tamanos)).toBeLessThan(1_600_000);
    expect(ms).toBeLessThan(8000 * partes.length);
  }, 180000);

  it('espacio real dado de alta sin escritura: no permite inicializar ni forzar una RPC', async () => {
    const ESPACIO_REAL = ESPACIO.replace(/^ensayo-/, 'real-');
    sql(`insert into ulit_censo.espacio (id, tipo, nombre, escritura_habilitada) values ('${ESPACIO_REAL}', 'real', 'Medina real (solo lectura)', false);
         insert into ulit_censo.miembro (espacio_id, usuario_id, rol, persona_id) values ('${ESPACIO_REAL}', '${ids.coord}', 'administrador', 'real-p-coordinacion-sintetica');`);
    await useEspacios.getState().abrirRemoto(new AlmacenSupabase(coord, ESPACIO_REAL));
    expect(useEspacios.getState().fase).toBe('sin-crear');
    expect(useEspacios.getState().remoto?.info?.escrituraHabilitada).toBe(false);
    const creacion = await useEspacios.getState().crear({ nombre: NOMBRE, roles: ['coordinador'] }, { incluirMedina: false });
    expect(creacion.ok).toBe(false);
    expect(creacion.error).toMatch(/solo lectura/);
    const intento = await coord.rpc('ulit_censo_aplicar', {
      p_espacio: ESPACIO_REAL,
      p_version_esperada: 0,
      p_etiqueta: 'Intento no autorizado',
      p_cambios: [{ c: '_raiz', id: 'raiz', v: { meta: { espacio: 'real', espacioId: ESPACIO_REAL } } }],
    });
    expect(intento.error?.code).toBe('42501');
    const estado = sql(`select version || ':' || (select count(*) from ulit_censo.entidad where espacio_id = '${ESPACIO_REAL}') from ulit_censo.espacio where id = '${ESPACIO_REAL}'`);
    expect(estado).toBe('0:0');
  }, 60000);

  it('real: solo permite inicializar Medina + callejero OSM, cierra la escritura y rechaza Excel', async () => {
    const realId = `real-e2e-preparacion-${Date.now().toString(36)}`;
    const personaId = 'real-p-coordinacion-sintetica';
    sql(`insert into ulit_censo.espacio (id,tipo,nombre,escritura_habilitada,preparacion_habilitada)
           values ('${realId}','real','Medina E2E, inicialización exclusiva',true,true);
         insert into ulit_censo.miembro (espacio_id,usuario_id,rol,persona_id)
           values ('${realId}','${ids.coord}','administrador','${personaId}');`);

    const almacen = new AlmacenSupabase(coord, realId);
    await useEspacios.getState().abrirRemoto(almacen);
    expect(useEspacios.getState().fase).toBe('sin-crear');
    expect(almacen.info?.preparacionHabilitada).toBe(true);

    const osm = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
    if (!osm.ok) throw new Error(osm.motivo);
    const callesOsm = osm.calles;
    const base = crearBaseEspacio('real', {
      persona: { nombre: NOMBRE, roles: ['coordinador'] }, personaId, espacioId: realId,
      calles: callesOsm,
      detalleCallejero: 'Instantánea OSM local validada',
    });
    expect(Object.keys(base.calles).length).toBeGreaterThanOrEqual(20);

    // Un administrador NO puede saltarse la fase mediante RPC para crear una campaña/Excel.
    const noCampana = await coord.rpc('ulit_censo_aplicar', {
      p_espacio: realId, p_version_esperada: 0, p_etiqueta: 'Campaña prohibida',
      p_cambios: [
        { c: '_raiz', id: 'raiz', v: { meta: { espacio: 'real', espacioId: realId } } },
        { c: 'campanas', id: 'real-camp-falsa', v: { id: 'real-camp-falsa' } },
      ],
    });
    expect(noCampana.error?.code).toBe('42501');
    const noExcel = await coord.rpc('ulit_censo_aplicar', {
      p_espacio: realId, p_version_esperada: 0, p_etiqueta: 'Excel prohibido',
      p_cambios: [
        { c: '_raiz', id: 'raiz', v: { meta: { espacio: 'real', espacioId: realId } } },
        { c: 'importaciones', id: 'real-imp-falsa', v: { id: 'real-imp-falsa' } },
      ],
    });
    expect(noExcel.error?.code).toBe('42501');

    // Una carga inicial sin el callejero tampoco debe crear nada, ni cerrar el permiso.
    const sinCalles = {
      ...base,
      calles: {},
    };
    const sinCallesRpc = await coord.rpc('ulit_censo_aplicar', {
      p_espacio: realId, p_version_esperada: 0, p_etiqueta: 'Sin callejero',
      p_cambios: diferencia(null, sinCalles),
    });
    expect(sinCallesRpc.error?.code).toBe('42501');
    expect(sql(`select version || ':' || preparacion_habilitada::text from ulit_censo.espacio where id='${realId}'`)).toBe('0:true');

    // El mismo almacenador real usa el RPC en lotes si hacen falta; toda la carga es atómica.
    expect(await almacen.guardar(null, base, 'Primera y única inicialización de Medina')).toBe(1);
    const recuperado = await new AlmacenSupabase(coord, realId).leer();
    expect(recuperado.info.version).toBe(1);
    expect(recuperado.info.preparacionHabilitada).toBe(false);
    expect(recuperado.info.escrituraHabilitada).toBe(false);
    expect(Object.keys(recuperado.db!.calles).length).toBe(Object.keys(base.calles).length);
    expect(Object.keys(recuperado.db!.municipios)).toEqual(['real-mun-medina']);
    expect(Object.keys(recuperado.db!.campanas)).toHaveLength(0);
    expect(Object.keys(recuperado.db!.importaciones)).toHaveLength(0);

    const segunda = await coord.rpc('ulit_censo_aplicar', {
      p_espacio: realId, p_version_esperada: 1, p_etiqueta: 'Otro cambio',
      p_cambios: [{ c: 'campanas', id: 'real-camp-falsa', v: { id: 'real-camp-falsa' } }],
    });
    expect(segunda.error?.code).toBe('42501');
    const huella = sql(`select version || ':' || escritura_habilitada::text || ':' || preparacion_habilitada::text ||
      ':' || (select count(*) from ulit_censo.entidad where espacio_id='${realId}' and coleccion='importaciones')
      from ulit_censo.espacio where id='${realId}'`);
    expect(huella).toBe('1:false:false:0');
  }, 180000);

});
