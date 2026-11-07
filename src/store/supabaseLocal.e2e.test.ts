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
import { crearRespaldo, comprobarRespaldo } from '../domain/respaldo';
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
    // Fail closed: nunca crear cuentas ni modificar tablas si las variables apuntan fuera de localhost.
    const permitido = (direccion: string) => {
      try { return ['localhost', '127.0.0.1', '::1'].includes(new globalThis.URL(direccion).hostname); } catch { return false; }
    };
    if (!permitido(URL) || !permitido(PSQL)) throw new Error('E2E denegado: API y PostgreSQL deben ser servidores locales desechables.');
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


  it('recuperación selectiva: copia de real antes de 889 filas sintéticas, restauración atómica y aislamiento de otros espacios', async () => {
    // SOLO se ejecuta con Supabase local desechable (sin URLs ni claves de producción).
    const realId = `real-e2e-restauracion-${Date.now().toString(36)}`;
    const vecinoId = `ensayo-e2e-vecino-${Date.now().toString(36)}`;
    const personaId = 'real-p-coordinacion-sintetica';
    const osm = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
    if (!osm.ok) throw new Error(osm.motivo);

    const original = crearBaseEspacio('real', {
      persona: { nombre: NOMBRE, roles: ['coordinador'] }, personaId, espacioId: realId,
      calles: osm.calles, detalleCallejero: 'Instantánea OSM sintética para test',
    });
    const vecinoBase = crearBaseEspacio('ensayo', {
      persona: { nombre: 'Coordinación vecina de prueba', roles: ['coordinador'] },
      espacioId: vecinoId, incluirMedina: false, calles: [], detalleCallejero: '',
    });
    sql(`insert into ulit_censo.espacio (id,tipo,nombre,escritura_habilitada,preparacion_habilitada)
           values ('${realId}','real','Restauración E2E, prueba sintética',true,true);
         insert into ulit_censo.miembro (espacio_id,usuario_id,rol,persona_id)
           values ('${realId}','${ids.coord}','administrador','${personaId}');
         insert into ulit_censo.espacio (id,tipo,nombre,escritura_habilitada)
           values ('${vecinoId}','ensayo','Espacio vecino inalterable',true);
         insert into ulit_censo.miembro (espacio_id,usuario_id,rol,persona_id)
           values ('${vecinoId}','${ids.coord}','administrador','${vecinoBase.meta.espacioCreadoPorId}');`);

    const real = new AlmacenSupabase(coord, realId);
    const vecino = new AlmacenSupabase(coord, vecinoId);
    await real.leer();
    await vecino.leer();
    expect(await real.guardar(null, original, 'Carga inicial permitida: solo Medina y OSM')).toBe(1);
    expect(await vecino.guardar(null, vecinoBase, 'Alta de espacio vecino')).toBe(1);
    const vecinoAntes = await vecino.leer();
    const huellaVecino = huella(vecinoAntes.db!);
    expect((await real.leer()).info).toMatchObject({ version: 1, escrituraHabilitada: false, preparacionHabilitada: false });

    // La copia interna puede prepararse mientras el espacio real sigue BLOQUEADO.
    const copia = await real.crearCopia('Punto de recuperación antes del histórico 2025');
    const exportada = await real.descargarCopia(copia);
    expect(exportada.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((exportada.contenido as { espacioId: string; version: number })).toMatchObject({ espacioId: realId, version: 1 });
    expect((await real.listarCopias()).length).toBe(1);

    // SIMULACIÓN en BD local: apertura administrativa limitada y una importación de prueba.
    sql(`update ulit_censo.espacio set escritura_habilitada=true
         where id='${realId}' and version=1 and preparacion_habilitada=false`);
    expect((await real.leer()).info.escrituraHabilitada).toBe(true);
    // El futuro importador debe crear y LEER una copia del estado exacto.
    const puntoRecuperacion = await real.asegurarRecuperacionAntesDeImportar(original);
    expect(puntoRecuperacion).toMatchObject({ version: 1, sha256: exportada.sha256 });
    // Si el cliente pretende modificar un estado diferente, se rechaza antes de importar.
    await expect(real.asegurarRecuperacionAntesDeImportar({ ...original, secuencia: original.secuencia + 1 }))
      .rejects.toThrow(/no coincide con el estado/);

    const d = { municipioId: municipioDeEspacio('real'), anio: 2025 };
    const decisiones = { periodoTrabajo: {
      porId: personaId, fecha: '2026-11-05', desde: '2024-01-01', hasta: '2025-12-31',
      motivo: 'Simulación local de recuperación del histórico, sin datos comerciales auténticos.',
    } };
    const p = await prepararIncorporacion(original, await libroSinteticoC1e(osm.calles), ARCHIVO_SINTETICO_C1E, d, decisiones);
    expect(p.plan.aplicable).toBe(true);
    expect(p.plan.registros.previstos).toBe(889);
    expect(p.plan.destino.nueva).toBe(true);
    const aplicado = aplicarIncorporacion(original, p.resultado, d, decisiones, p.plan, { porId: personaId });
    expect(await real.guardar(original, aplicado.db, '889 filas sintéticas 2025 (PRUEBA LOCAL)')).toBe(2);
    expect(sql(`select count(*) from ulit_censo.entidad where espacio_id='${realId}' and coleccion='registros'`)).toBe('889');

    // El cliente con la versión antigua no puede restaurar (sin sobrescribir operaciones nuevas).
    const obsoleto = new AlmacenSupabase(coord, realId);
    await obsoleto.leer();
    obsoleto.info!.version = 1;
    await expect(obsoleto.restaurarCopia(copia, 'Intento obsoleto')).rejects.toBeInstanceOf(ConflictoRemoto);
    expect(sql(`select version from ulit_censo.espacio where id='${realId}'`)).toBe('2');

    // Restauración SOLO del espacio real. Supabase crea antes otra copia automática.
    expect(await real.restaurarCopia(copia, 'Reversión selectiva tras importación sintética')).toBe(3);
    const restaurado = await real.leer();
    expect(huella(restaurado.db!)).toBe(huella(original));
    expect(restaurado.info.version).toBe(3);
    expect(sql(`select count(*) from ulit_censo.entidad where espacio_id='${realId}' and coleccion='registros'`)).toBe('0');
    expect(sql(`select count(*) from ulit_censo.entidad where espacio_id='${realId}' and coleccion='campanas'`)).toBe('0');
    // Una copia manual previa + dos preflights (uno rechazado) + copia automática de la restauración.
    expect((await real.listarCopias()).length).toBe(4);

    const vecinoDespues = await new AlmacenSupabase(coord, vecinoId).leer();
    expect(huella(vecinoDespues.db!)).toBe(huellaVecino);
    expect(vecinoDespues.info.version).toBe(vecinoAntes.info.version);

    // Cierre explícito en el entorno desechable: tampoco el cliente Auth puede reabrirlo por su cuenta.
    sql(`update ulit_censo.espacio set escritura_habilitada=false where id='${realId}' and version=3`);
    expect((await real.leer()).info.escrituraHabilitada).toBe(false);
    const intento = await coord.rpc('ulit_censo_aplicar', {
      p_espacio: realId, p_version_esperada: 3, p_etiqueta: 'Intento tras cierre',
      p_cambios: [{ c: 'campanas', id: 'real-camp-no', v: { id: 'real-camp-no' } }],
    });
    expect(intento.error?.code).toBe('42501');
    expect(sql(`select version from ulit_censo.espacio where id='${realId}'`)).toBe('3');
  }, 180000);


  it('respaldo externo: recuperar 889 filas ficticias desde JSON en espacio real local limpio', async () => {
    // Simulación de desastre LÓGICO: otra instalación local, no la base de producción.
    // El respaldo se genera en memoria y se RESTAURA desde su contenido JSON validado.
    const realId = `real-e2e-rescate-externo-${Date.now().toString(36)}`;
    const personaId = 'real-p-coordinacion-sintetica';
    const osm = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
    if (!osm.ok) throw new Error(osm.motivo);
    const inicial = crearBaseEspacio('real', {
      persona: { nombre: NOMBRE, roles: ['coordinador'] },
      personaId, espacioId: realId, calles: osm.calles, detalleCallejero: 'Instantánea OSM E2E, solo datos sintéticos',
    });
    const d = { municipioId: municipioDeEspacio('real'), anio: 2025 };
    const decisiones = { periodoTrabajo: {
      porId: personaId, fecha: '2026-11-05', desde: '2024-01-01', hasta: '2025-12-31',
      motivo: 'Prueba E2E de recuperación externa de datos ficticios.',
    } };
    const p = await prepararIncorporacion(inicial, await libroSinteticoC1e(osm.calles), ARCHIVO_SINTETICO_C1E, d, decisiones);
    expect(p.plan.registros.previstos).toBe(889);
    const aplicado = aplicarIncorporacion(inicial, p.resultado, d, decisiones, p.plan, { porId: personaId });
    expect(Object.keys(aplicado.db.registros)).toHaveLength(889);

    const respaldo = crearRespaldo(aplicado.db, 'real', '2026-11-05T20:00:00.000Z');
    expect(respaldo.sha256).toMatch(/^[0-9a-f]{64}$/);
    const comprobado = comprobarRespaldo(respaldo.texto, 'real');
    if (!comprobado.ok) throw new Error(comprobado.motivo);
    expect(comprobado.sobre.espacioId).toBe(realId);
    expect(huella(comprobado.db)).toBe(huella(aplicado.db));
    // Corrupción y tipo de espacio incorrecto: rechazo antes de tocar la base.
    expect(comprobarRespaldo(respaldo.texto.replace(NOMBRE, 'Nombre Corrupto'), 'real').ok).toBe(false);
    expect(comprobarRespaldo(respaldo.texto, 'ensayo').ok).toBe(false);
    const otroEspacio = crearBaseEspacio('real', {
      persona: { nombre: NOMBRE, roles: ['coordinador'] },
      personaId, espacioId: 'real-e2e-otro-espacio', calles: osm.calles, detalleCallejero: 'Instantánea OSM E2E',
    });
    expect(comprobado.db.meta.espacioId).not.toBe(otroEspacio.meta.espacioId);

    // Una instalación nueva debe iniciar con el mismo ID lógico para restaurar
    // los datos íntegros sin renombrar/mezclar registros de espacios diferentes.
    sql(`insert into ulit_censo.espacio(id,tipo,nombre,escritura_habilitada,preparacion_habilitada)
      values ('${realId}','real','Recuperación externa sintética',true,true);
      insert into ulit_censo.miembro(espacio_id,usuario_id,rol,persona_id)
      values ('${realId}','${ids.coord}','administrador','${personaId}');`);
    const recuperado = new AlmacenSupabase(coord, realId);
    expect((await recuperado.leer()).db).toBeNull();
    expect(await recuperado.guardar(null, inicial, 'Recuperar infraestructura inicial de Medina E2E')).toBe(1);
    expect((await recuperado.leer()).info).toMatchObject({ version: 1, escrituraHabilitada: false });

    // Solo en este servidor local desechable, la administración autoriza
    // temporalmente la restauración lógica de una copia EXTERNA comprobada.
    sql(`update ulit_censo.espacio set escritura_habilitada=true
       where id='${realId}' and version=1 and preparacion_habilitada=false`);
    expect((await recuperado.leer()).info.escrituraHabilitada).toBe(true);
    expect(await recuperado.guardar(inicial, comprobado.db, 'Restauración de JSON externo E2E')).toBe(2);
    sql(`update ulit_censo.espacio set escritura_habilitada=false
       where id='${realId}' and version=2`);
    const final = await new AlmacenSupabase(coord, realId).leer();
    expect(final.info).toMatchObject({ version: 2, escrituraHabilitada: false, preparacionHabilitada: false });
    expect(huella(final.db!)).toBe(huella(aplicado.db));
    expect(Object.keys(final.db!.registros)).toHaveLength(889);
    expect(Object.keys(final.db!.campanas)).toHaveLength(1);
    expect(Object.keys(final.db!.importaciones)).toHaveLength(1);
    expect(sql(`select count(*) from ulit_censo.entidad where espacio_id='${realId}' and coleccion='registros'`)).toBe('889');
  }, 180000);

  it('permiso específico: histórico 2025 autorizado una sola vez y cierre automático en SQL', async () => {
    const realId = 'real-medina-del-campo-2026'; // SOLO entorno desechable local
    const personaId = 'real-p-coordinacion-sintetica';
    const osm = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
    if (!osm.ok) throw new Error(osm.motivo);
    const inicial = crearBaseEspacio('real', {
      persona: { nombre: NOMBRE, roles: ['coordinador'] },
      personaId, espacioId: realId, calles: osm.calles, detalleCallejero: 'Instantánea OSM sintética E2E',
    });
    sql("insert into ulit_censo.espacio(id,tipo,nombre,escritura_habilitada,preparacion_habilitada) values ('"
      + realId + "','real','Medina 2025 E2E',true,true);"
      + "insert into ulit_censo.miembro(espacio_id,usuario_id,rol,persona_id) values ('"
      + realId + "','" + ids.coord + "','administrador','" + personaId + "');");

    const real = new AlmacenSupabase(coord, realId);
    await real.leer();
    expect(await real.guardar(null, inicial, 'Inicialización local solo Medina y calles OSM')).toBe(1);
    expect((await real.leer()).info).toMatchObject({ version: 1, escrituraHabilitada: false, preparacionHabilitada: false });
    const antes = huella(inicial);
    const copia = await real.asegurarRecuperacionAntesDeImportar(inicial);
    expect(copia.version).toBe(1);

    const d = { municipioId: municipioDeEspacio('real'), anio: 2025 };
    const decisiones = { periodoTrabajo: {
      porId: personaId, fecha: '2026-11-05', desde: '2024-01-01', hasta: '2025-12-31',
      motivo: 'Revisión humana del periodo de trabajo de campo (E2E ficticia).',
    } };
    const plan = await prepararIncorporacion(inicial, await libroSinteticoC1e(osm.calles), ARCHIVO_SINTETICO_C1E, d, decisiones);
    expect(plan.plan.registros.previstos).toBe(889);
    expect(plan.plan.nuevas.registros).toBe(889);
    expect(plan.plan.nuevas.campanas).toBe(1);
    const aplicado = aplicarIncorporacion(inicial, plan.resultado, d, decisiones, plan.plan, { porId: personaId });

    // Ni siquiera se permite depositar una parte del Excel en la tabla temporal
    // cuando la administración todavía no ha concedido la autorización.
    const depositoSinPermiso = await coord.rpc('ulit_censo_lote_subir', {
      p_espacio: realId, p_lote: globalThis.crypto.randomUUID(), p_parte: 0,
      p_cambios: [{ c: 'registros', id: 'fila-no-autorizada', v: { fila: 2 } }],
    });
    expect(depositoSinPermiso.error?.code).toBe('42501');
    expect(sql("select count(*) from ulit_censo.lote_parte where espacio_id='" + realId + "'")).toBe('0');

    // El servidor rechaza sin autorización SQL específica.
    await expect(real.importarPrimerHistorico2025(inicial, aplicado.db, copia)).rejects.toThrow(/autorización específica/);
    expect((await real.leer()).info).toMatchObject({ version: 1, escrituraHabilitada: false });
    expect(huella((await real.leer()).db!)).toBe(antes);

    // Inserción por administración SQL en base desechable: nunca por Auth/API pública.
    const sha = plan.plan.archivo.sha256;
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    sql("insert into ulit_censo.autorizacion_historico_2025" +
      "(espacio_id,usuario_id,version_esperada,sha256_archivo,vigente_hasta,motivo)" +
      " values ('" + realId + "','" + ids.coord + "',1,'" + sha + "',now()+interval '10 minutes'," +
      "'Prueba E2E aislada, permiso de uso único para una importación ficticia');");

    const lectora = new AlmacenSupabase(await sesion('lectora-' + ESPACIO + '@ejemplo.invalid'), realId);
    await expect(lectora.leer()).rejects.toThrow(/sin permiso/);

    // Una autorización caducada nunca permite ejecutar la RPC, ni consumir el permiso.
    sql("update ulit_censo.autorizacion_historico_2025 set vigente_hasta=now()-interval '1 second' where espacio_id='" + realId + "'");
    const caducada = await coord.rpc('ulit_censo_importar_historico_2025', {
      p_espacio: realId, p_lote: globalThis.crypto.randomUUID(), p_partes: 1,
      p_version_esperada: 1, p_copia: copia.id,
    });
    expect(caducada.error?.code).toBe('42501');
    const depositoCaducado = await coord.rpc('ulit_censo_lote_subir', {
      p_espacio: realId, p_lote: globalThis.crypto.randomUUID(), p_parte: 0,
      p_cambios: [{ c: 'registros', id: 'fila-caducada', v: { fila: 2 } }],
    });
    expect(depositoCaducado.error?.code).toBe('42501');
    sql("update ulit_censo.autorizacion_historico_2025 set vigente_hasta=now()+interval '10 minutes' where espacio_id='" + realId + "'");

    // ATAQUE SINTÉTICO: 889 vínculos pero dos dirigidos a la misma fila y otra sin vínculo.
    // Debe fallar ANTES de escribir, conservando la autorización para el lote válido.
    const originales = diferencia(inicial, aplicado.db);
    const enlaces = originales.filter((x) => x.c === 'vinculos');
    expect(enlaces).toHaveLength(889);
    const primero = enlaces[0].v as { origen: { tipo: string; id: string } };
    const defectuosos = originales.map((x) => {
      if (x.c !== 'vinculos' || x.id !== enlaces[1].id) return x;
      return { ...x, v: { ...(x.v as Record<string, unknown>),
        origen: { tipo: 'registro', id: primero.origen.id } } };
    });
    const loteInvalido = globalThis.crypto.randomUUID();
    const partesInvalidas = partir(defectuosos);
    for (const [numero, parte] of partesInvalidas.entries()) {
      const subida = await coord.rpc('ulit_censo_lote_subir', {
        p_espacio: realId, p_lote: loteInvalido, p_parte: numero, p_cambios: parte,
      });
      expect(subida.error).toBeNull();
    }
    const duplicado = await coord.rpc('ulit_censo_importar_historico_2025', {
      p_espacio: realId, p_lote: loteInvalido, p_partes: partesInvalidas.length,
      p_version_esperada: 1, p_copia: copia.id,
    });
    expect(duplicado.error?.code).toBe('42501');
    expect(duplicado.error?.message).toMatch(/vínculos\/exclusiones incoherentes/);
    expect(sql("select version::text || ':' || escritura_habilitada::text from ulit_censo.espacio where id='" + realId + "'")).toBe('1:false');
    expect(sql("select utilizada_en is null from ulit_censo.autorizacion_historico_2025 where espacio_id='" + realId + "'")).toBe('t');
    expect(sql("select count(*) from ulit_censo.entidad where espacio_id='" + realId + "' and coleccion='registros'")).toBe('0');

    // Un segundo coordinador miembro del espacio NO puede borrar el lote ajeno.
    sql("insert into ulit_censo.miembro(espacio_id,usuario_id,rol,persona_id) values ('"
      + realId + "','" + ids.revisora + "','coordinador','real-p-otra-coordinacion')");
    const otraSesion = await sesion('revisora-' + ESPACIO + '@ejemplo.invalid');
    const otroDescarte = await otraSesion.rpc('ulit_censo_descartar_lote_2025', {
      p_espacio: realId, p_lote: loteInvalido,
    });
    expect(otroDescarte.error).toBeNull();
    expect(otroDescarte.data).toBe(0);
    const otroDeposito = await otraSesion.rpc('ulit_censo_lote_subir', {
      p_espacio: realId, p_lote: globalThis.crypto.randomUUID(), p_parte: 0,
      p_cambios: [{ c: 'registros', id: 'lote-otra-cuenta', v: { fila: 2 } }],
    });
    expect(otroDeposito.error?.code).toBe('42501');

    const descartar = await coord.rpc('ulit_censo_descartar_lote_2025', {
      p_espacio: realId, p_lote: loteInvalido,
    });
    expect(descartar.error).toBeNull();
    expect(descartar.data).toBe(partesInvalidas.length);
    expect(sql("select count(*) from ulit_censo.lote_parte where espacio_id='" + realId + "'")).toBe('0');

    expect(await real.importarPrimerHistorico2025(inicial, aplicado.db, copia)).toBe(2);
    const despues = await real.leer();
    expect(despues.info).toMatchObject({ version: 2, escrituraHabilitada: false, preparacionHabilitada: false });
    expect(huella(despues.db!)).toBe(huella(aplicado.db));
    expect(Object.keys(despues.db!.registros).length).toBe(889);
    expect(Object.keys(despues.db!.campanas).length).toBe(1);
    expect(Object.keys(despues.db!.importaciones).length).toBe(1);
    expect(sql("select count(*) from ulit_censo.operacion where espacio_id='" + realId + "' and version=2")).toBe('1');
    expect(sql("select version_resultante from ulit_censo.autorizacion_historico_2025 where espacio_id='" + realId + "'")).toBe('2');
    expect(sql("select count(*) from ulit_censo.copia where espacio_id='" + realId + "'")).toBe('1');

    const intento = await coord.rpc('ulit_censo_aplicar', {
      p_espacio: realId, p_version_esperada: 2, p_etiqueta: 'Fuera del permiso',
      p_cambios: [{ c: 'campanas', id: 'real-camp-falsa', v: { id: 'real-camp-falsa' } }],
    });
    expect(intento.error?.code).toBe('42501');
    const depositoDespues = await coord.rpc('ulit_censo_lote_subir', {
      p_espacio: realId, p_lote: globalThis.crypto.randomUUID(), p_parte: 0,
      p_cambios: [{ c: 'registros', id: 'fila-post-cierre', v: { fila: 2 } }],
    });
    expect(depositoDespues.error?.code).toBe('42501');
    await expect(real.importarPrimerHistorico2025(inicial, aplicado.db, copia)).rejects.toThrow(/versión 1/);
  }, 180000);

  it('IT1 real sintético: reutiliza respaldo y autorización, guarda 105 filas y cierra la escritura', async () => {
    // ÚNICAMENTE sobre Supabase local desechable. No se accede a la base auténtica.
    const realId = 'real-medina-del-campo-2026';
    const campId = 'real-camp-medina-2026-censo-medina-del-campo-2026';
    const origenSha = '7a6d4230a68370cc0bb0245ce68e8c56648be4d89e76531cc0edbd9ab341da61';
    const real = new AlmacenSupabase(coord, realId);
    const readV2 = await real.leer();
    expect(readV2.info).toMatchObject({ version: 2, escrituraHabilitada: false });
    expect(Object.keys(readV2.db!.registros)).toHaveLength(889);
    // La fuente FICTICIA C1e produce 704 locales, frente a los 696 reales.
    // Ajustar SOLO el espacio local desechable para ejercitar exactamente
    // la misma condición inicial de 696 locales que protege la RPC real.
    // Sin tocar el recuento de los 889 registros originales.
    expect(Object.keys(readV2.db!.locales)).toHaveLength(704);
    const descartados = Object.keys(readV2.db!.locales).sort().slice(-8);
    const idsDescartados = descartados.map((id) => "'" + id.replace(/'/g,"''") + "'").join(',');
    sql("begin;" +
      "update ulit_censo.entidad set valor=jsonb_set(valor,'{localId}','null'::jsonb)" +
      " where espacio_id='" + realId + "' and coleccion in ('observaciones','vinculos')" +
      " and valor->>'localId' in (" + idsDescartados + ");" +
      "delete from ulit_censo.entidad where espacio_id='" + realId + "'" +
      " and coleccion='ocupaciones' and valor->>'localId' in (" + idsDescartados + ");" +
      "delete from ulit_censo.entidad where espacio_id='" + realId + "'" +
      " and coleccion='locales' and id in (" + idsDescartados + ");commit;");

    // En producción la campaña de 2026 ya existe en v3. Simular únicamente
    // esa alta en el servidor local, sin cambiar ninguna entidad histórica.
    const camp = {
      id: campId, municipioId: 'real-mun-medina', anio: 2026,
      nombre: 'Censo Medina del Campo 2026', tipo: 'actualizacion',
      periodo: { inicio: '2026-01-01' }, ambitoCalleIds: [], ampliacionCalleIds: [],
      estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
      procedencia: 'manual', campanaReferenciaId: 'camp-hist-real-mun-medina-2025-9e367ca51c',
    };
    sql("begin; insert into ulit_censo.entidad(espacio_id,coleccion,id,valor,version,actualizado_por) values (" +
      "'" + realId + "','campanas','" + campId + "','" + JSON.stringify(camp).replace(/'/g,"''") + "'::jsonb,3,'" + ids.coord + "');" +
      "update ulit_censo.espacio set version=3 where id='" + realId + "' and version=2; commit;");

    const antes = (await real.leer()).db!;
    const historicoInmutable = createHash('sha256').update(jsonCanonico(antes.registros)).digest('hex');
    expect(Object.keys(antes.locales)).toHaveLength(696);
    expect(Object.keys(antes.campanas)).toHaveLength(2);
    const personaId = 'real-p-coordinacion-sintetica';
    const { db: dbConIt, itinerarioId } = crearItinerario(antes,campId,
      { codigo:'IT1', nombre:'IT1 sintético' }, { prefijo:'real', porId:personaId, ahora:'2026-11-07T12:00:00Z' });
    const despues: BaseDatos = structuredClone(dbConIt);
    despues.secuencia = (antes.secuencia ?? 0) + 1;
    const impId = 'imp-it1-sintetico-e2e';
    const calleId = Object.keys(antes.calles)[0];
    expect(calleId).toBeTruthy();
    for (let i=2;i<=106;i++) {
      const registroId = 'reg-' + impId + '-' + i;
      const localId = i<=15 ? 'real-loc-it1-sintetico-' + i : null;
      if(localId) despues.locales[localId] = {
        id:localId,municipioId:'real-mun-medina',
        direcciones:[{calleId,numero:5000+i,desdeCampanaId:campId}],
        estado:'activo',procedencia:'importado',
      };
      despues.registros[registroId] = {
        id:registroId,importacionId:impId,itinerarioId,fila:i,
        datos:{nombre:'COMERCIO SINTÉTICO '+i},
        original:{},interpretacion:{celdas:{},local:localId?'ocupado':'sin-datos',redesCalculadas:{},incidencias:[]},
        huellaFila:'sintetica',
      } as unknown as BaseDatos['registros'][string];
      despues.vinculos['vin-'+registroId] = {
        id:'vin-'+registroId,origen:{tipo:'registro',id:registroId},localId,
        confianza:localId?'probable':'sin-vinculo',
        criterio:localId?'alta sintética':'pendiente sintético',
      };
    }
    despues.importaciones[impId] = {
      id:impId,municipioId:'real-mun-medina',campanaId:campId,tipo:'C-excel-itinerario',
      archivo:'IT1_SINTETICO_E2E.xlsx',huella:origenSha,fecha:'2026-11-07T12:00:00Z',
      filas:105,estado:'confirmada',procedencia:'importado',resumen:{},
      nota:'Prueba sintética sin datos auténticos',
      c1:{ sha256:origenSha,anio:2026,itinerario:despues.itinerarios[itinerarioId] },
    } as unknown as BaseDatos['importaciones'][string];

    // Primera preparación y reintento ANTES de guardar: misma copia, mismo permiso.
    const parametros = {p_espacio:realId,p_sha:origenSha,p_version:3};
    const primera = await coord.rpc('ulit_censo_preparar_it1_2026',parametros);
    expect(primera.error).toBeNull();
    const reintento = await coord.rpc('ulit_censo_preparar_it1_2026',parametros);
    expect(reintento.error).toBeNull();
    expect(reintento.data?.copia).toBe(primera.data?.copia);
    expect(reintento.data?.reutilizada).toBe(true);
    expect(sql("select count(*) from ulit_censo.copia where espacio_id='" + realId + "' and version=3")).toBe('1');

    // Recorrido de la RPC DE PRODUCCIÓN con datos ficticios. La huella del
    // histórico C1e sintético difiere de la auténtica de 2025; por eso aquí
    // ejercitamos la escritura SQL sin el preflight de cliente específico del
    // archivo histórico auténtico. La reproducción cubre la ambigüedad "c".
    const cambios = diferencia(antes,despues);
    const partes = partir(cambios);
    const lote = globalThis.crypto.randomUUID();
    for (const [indice,parte] of partes.entries()) {
      const subida = await coord.rpc('ulit_censo_lote_subir',{
        p_espacio:realId,p_lote:lote,p_parte:indice,p_cambios:parte,
      });
      expect(subida.error).toBeNull();
    }
    const aplicacion = await coord.rpc('ulit_censo_importar_it1_2026',{
      p_espacio:realId,p_lote:lote,p_partes:partes.length,
      p_version_esperada:3,p_copia:primera.data!.copia,
    });
    expect(aplicacion.error).toBeNull();
    expect(aplicacion.data).toBe(4);
    const guardado = await real.leer();
    expect(guardado.info).toMatchObject({version:4,escrituraHabilitada:false,preparacionHabilitada:false});
    expect(huella(guardado.db!)).toBe(huella(despues));
    expect(Object.keys(guardado.db!.registros)).toHaveLength(994);
    const copiaHistoricoPosterior = Object.fromEntries(Object.entries(guardado.db!.registros)
      .filter(([id]) => id in antes.registros));
    expect(createHash('sha256').update(jsonCanonico(copiaHistoricoPosterior)).digest('hex')).toBe(historicoInmutable);
    expect(Object.keys(guardado.db!.itinerarios)).toHaveLength(1);
    expect(Object.keys(guardado.db!.locales)).toHaveLength(710);
    expect(Object.values(guardado.db!.vinculos).filter((x) =>
      x.origen.tipo === 'registro' && x.origen.id.startsWith('reg-'+impId+'-') && !x.localId)).toHaveLength(91);
    expect(sql("select version_resultante from ulit_censo.autorizacion_it1_2026 where espacio_id='" + realId + "'")).toBe('4');
    expect(sql("select count(*) from ulit_censo.lote_parte where espacio_id='" + realId + "'")).toBe('0');

    const segunda = await coord.rpc('ulit_censo_preparar_it1_2026',parametros);
    expect(segunda.error?.code).toBe('42501');
    expect(Object.keys((await real.leer()).db!.registros)).toHaveLength(994);
  }, 180000);

});
