import ExcelJS from 'exceljs';
import { unzipSync, zipSync } from 'fflate';
import { ErrorDominio, type BaseDatos } from '../domain/db';
import { claveCalle } from '../domain/text';
import { PERFIL_CENSO_27 } from '../domain/xlsx/perfilesImportacion';
import type { Calle, Id, LocalFisico, Municipio } from '../domain/types';
import { crearRng } from './rng';
import { MEDINA } from './callejero';

/**
 * Callejero FICTICIO para simular C1c: añade al municipio calles con los nombres ficticios de los
 * libros de prueba («VÍA FICTICIA 001»…), sin geometría. Solo para pruebas y simulaciones en
 * memoria; no se usa en la aplicación.
 */
export function conCallesFicticias(db: BaseDatos, municipioId: Id, nombres: string[]): BaseDatos {
  const calles: Record<Id, Calle> = { ...db.calles };
  for (const nombre of nombres) {
    const id = `calle-ficticia-${claveCalle(nombre).replace(/[^a-z0-9]+/g, '-')}`;
    calles[id] = { id, municipioId, nombre, tipoVia: 'vía', segmentos: [], longitudM: 0, procedencia: 'simulado', refsFuente: ['escenario-incorporacion'] };
  }
  return { ...db, calles };
}

/** «VÍA FICTICIA 001» … «VÍA FICTICIA n». */
export const viasFicticias = (desde: number, hasta: number) => Array.from({ length: hasta - desde + 1 }, (_, i) => `VÍA FICTICIA ${String(desde + i).padStart(3, '0')}`);

// ───────────── Escenario FICTICIO de C1d: «Medina del Campo (escenario ficticio)» ─────────────


/**
 * Municipio AISLADO para la demostración de C1d. Tiene su propio callejero ficticio y nada
 * referencia a otros municipios: se puede reiniciar sin tocar Medina, Valladolid ni sus campañas.
 */
export const MUNICIPIO_DEMO: Municipio = {
  id: 'mun-demo-medina',
  nombre: 'Medina del Campo (escenario ficticio)',
  provincia: 'Valladolid',
  centro: MEDINA.centro,
  fuenteCallejero: 'sin-geometria',
  ambito: 'municipio',
  escenarioDemo: 'c1d-medina',
  nota: 'Escenario FICTICIO de demostración de la incorporación controlada (C1d): calles «VÍA FICTICIA nnn» sin geometría y un censo 2025 generado por la aplicación. No contiene datos reales.',
};

/** Vías del libro: 93. El callejero ficticio solo tiene 90: las 3 últimas quedan sin correspondencia. */
export const VIAS_ESCENARIO = 93;
export const VIAS_CALLEJERO_ESCENARIO = 90;
/** Dos locales físicos ya existentes en el municipio ficticio (para mostrar candidatos). */
export const LOCALES_PREVIOS_ESCENARIO = [
  { id: 'loc-demo-previo-1', via: 15, numero: 3 },
  { id: 'loc-demo-previo-2', via: 16, numero: 4 },
] as const;

const viaId = (n: number) => `calle-ficticia-demo-${String(n).padStart(3, '0')}`;

/**
 * Prepara el municipio ficticio (idempotente): municipio, callejero ficticio y dos locales previos.
 * No toca ninguna otra entidad.
 */
export function prepararMunicipioDemo(db: BaseDatos): BaseDatos {
  if (db.municipios[MUNICIPIO_DEMO.id]) return db;
  const calles = { ...db.calles };
  for (let n = 1; n <= VIAS_CALLEJERO_ESCENARIO; n++) {
    const id = viaId(n);
    calles[id] = { id, municipioId: MUNICIPIO_DEMO.id, nombre: `VÍA FICTICIA ${String(n).padStart(3, '0')}`, tipoVia: 'vía', segmentos: [], longitudM: 0, procedencia: 'simulado', refsFuente: ['escenario-c1d'] };
  }
  const locales: Record<Id, LocalFisico> = { ...db.locales };
  for (const l of LOCALES_PREVIOS_ESCENARIO) locales[l.id] = { id: l.id, municipioId: MUNICIPIO_DEMO.id, direcciones: [{ calleId: viaId(l.via), numero: l.numero }], estado: 'activo', procedencia: 'simulado' };
  return { ...db, municipios: { ...db.municipios, [MUNICIPIO_DEMO.id]: MUNICIPIO_DEMO }, calles, locales };
}

/** ¿Pertenece la entidad al escenario ficticio? */
export function esMunicipioDemo(db: BaseDatos, municipioId?: Id): boolean {
  return !!municipioId && !!db.municipios[municipioId]?.escenarioDemo;
}

/**
 * Reinicia el escenario ficticio: elimina TODO lo que pertenece al municipio de demostración
 * (municipio, calles, campañas, importaciones, registros, locales, negocios, observaciones,
 * ocupaciones, vínculos y datos por campaña). Se niega si alguna entidad de otro municipio
 * referencia algo del escenario: nunca toca datos ajenos.
 */
export function reiniciarEscenarioDemo(db0: BaseDatos): BaseDatos {
  const mun = MUNICIPIO_DEMO.id;
  if (!db0.municipios[mun]) return db0;
  const campanas = new Set(Object.values(db0.campanas).filter((c) => c.municipioId === mun).map((c) => c.id));
  const calles = new Set(Object.values(db0.calles).filter((c) => c.municipioId === mun).map((c) => c.id));
  const locales = new Set(Object.values(db0.locales).filter((l) => l.municipioId === mun).map((l) => l.id));
  const importaciones = new Set(Object.values(db0.importaciones).filter((i) => i.municipioId === mun).map((i) => i.id));
  const registros = new Set(Object.values(db0.registros).filter((r) => importaciones.has(r.importacionId)).map((r) => r.id));
  const observaciones = new Set(Object.values(db0.observaciones).filter((o) => campanas.has(o.campanaId) || (o.localId && locales.has(o.localId)) || calles.has(o.calleId)).map((o) => o.id));
  const ocupaciones = new Set(Object.values(db0.ocupaciones).filter((o) => locales.has(o.localId) || campanas.has(o.desdeCampanaId)).map((o) => o.id));
  const negocios = new Set<Id>();
  for (const o of Object.values(db0.ocupaciones)) if (ocupaciones.has(o.id) && o.negocioId) negocios.add(o.negocioId);
  for (const o of Object.values(db0.observaciones)) if (observaciones.has(o.id) && o.datos.negocioId) negocios.add(o.datos.negocioId);
  const vinculos = new Set(Object.values(db0.vinculos).filter((v) => (v.origen.tipo === 'registro' ? registros.has(v.origen.id) : observaciones.has(v.origen.id)) || (v.localId && locales.has(v.localId))).map((v) => v.id));
  const itinerarios = new Set(Object.values(db0.itinerarios).filter((i) => campanas.has(i.campanaId)).map((i) => i.id));

  // Seguridad: nada ajeno al escenario puede depender de él.
  const ajenas: string[] = [];
  for (const o of Object.values(db0.observaciones)) if (!observaciones.has(o.id) && o.datos.negocioId && negocios.has(o.datos.negocioId)) ajenas.push(`observación ${o.id}`);
  for (const o of Object.values(db0.ocupaciones)) if (!ocupaciones.has(o.id) && o.negocioId && negocios.has(o.negocioId)) ajenas.push(`ocupación ${o.id}`);
  for (const v of Object.values(db0.vinculos)) if (!vinculos.has(v.id) && (v.candidatos ?? []).some((c) => locales.has(c.localId))) ajenas.push(`vínculo ${v.id}`);
  for (const c of Object.values(db0.campanas)) if (!campanas.has(c.id) && c.campanaReferenciaId && campanas.has(c.campanaReferenciaId)) ajenas.push(`campaña ${c.id}`);
  if (ajenas.length) throw new ErrorDominio('bloqueado', 'No se puede reiniciar el escenario: hay datos de otros municipios que dependen de él.', ajenas.slice(0, 20));

  const sin = <T,>(r: Record<string, T>, quitar: (k: string, x: T) => boolean) => Object.fromEntries(Object.entries(r).filter(([k, x]) => !quitar(k, x)));
  const porCampana = (k: string) => campanas.has(k.split('|')[0]);
  const porNegocioCampana = (_k: string, x: { negocioId: Id; campanaId: Id }) => negocios.has(x.negocioId) || campanas.has(x.campanaId);
  const { [mun]: _m, ...municipios } = db0.municipios;
  return {
    ...db0,
    municipios,
    calles: sin(db0.calles, (k) => calles.has(k)),
    campanas: sin(db0.campanas, (k) => campanas.has(k)),
    itinerarios: sin(db0.itinerarios, (k) => itinerarios.has(k)),
    coberturas: sin(db0.coberturas, porCampana),
    situacionesPrevias: sin(db0.situacionesPrevias, porCampana),
    callesRevisadasPlan: sin(db0.callesRevisadasPlan, porCampana),
    locales: sin(db0.locales, (k) => locales.has(k)),
    negocios: sin(db0.negocios, (k) => negocios.has(k)),
    ocupaciones: sin(db0.ocupaciones, (k) => ocupaciones.has(k)),
    observaciones: sin(db0.observaciones, (k) => observaciones.has(k)),
    registros: sin(db0.registros, (k) => registros.has(k)),
    vinculos: sin(db0.vinculos, (k) => vinculos.has(k)),
    importaciones: sin(db0.importaciones, (k) => importaciones.has(k)),
    revisiones: sin(db0.revisiones, (_k, r) => campanas.has(r.campanaId) || locales.has(r.localId)),
    digital: sin(db0.digital, porNegocioCampana),
    clasificaciones: sin(db0.clasificaciones, porNegocioCampana),
    franquicias: sin(db0.franquicias, porNegocioCampana),
    oficinaItinerarios: sin(db0.oficinaItinerarios, (k) => itinerarios.has(k)),
  };
}

/** Combinaciones de clasificación del escenario: coherentes, de Servicios, incompletas e incoherentes. */
const COMBOS: [number, string, string | null, string | null, string | null, string | null][] = [
  // [peso, GrActividad, Gr Comercio, Subgrupo, Actividad, Descripción]
  [9, 'Comercio', 'Alimentación', 'Pan y Lácteos', 'Panadería', null],
  [6, 'Comercio', 'Alimentación', 'Carnes', 'Carnicería', null],
  [6, 'Comercio', 'Alimentación', 'Fruta y verdura', 'Frutería', null],
  [6, 'Comercio', 'Equipamiento Personal', 'Ropa', 'Moda Mujer', null],
  [5, 'Comercio', 'Equipamiento Personal', 'Calzado', 'Calzado', null],
  [5, 'Comercio', 'Otros Equipamientos', 'Estancos', 'Estancos', null],
  [4, 'Comercio', 'Otros Equipamientos', 'Ocio', 'Papelería, Prensa y Librería', null],
  [4, 'Comercio', 'Equipamiento del Hogar', 'Bricolaje y ferreterías', 'Bricolaje y Ferreterías', null],
  [3, 'Comercio', null, 'Pan y Lácteos', 'Pastelería', null], // falta Gr Comercio
  [3, 'Comercio', 'Otros Equipamientos', 'Pan y Lácteos', 'Panadería', null], // grupo de comercio incoherente
  [12, 'Hostelería y Restauración', null, 'Bares y Cafeterías', 'Bar', null],
  [6, 'Hostelería y Restauración', null, 'Restaurantes', 'Tradicional', null],
  [3, 'Hostelería y Restauración', null, 'Bares y Cafeterías', 'Bancos', null], // actividad ajena
  [2, 'Hostelería y Restauración', null, 'Bares y Cafeterías', null, null], // incompleta
  [8, 'Servicios', null, 'Peluquerías', null, null],
  [6, 'Servicios', null, 'Servicios Médicos', 'Fisioterapia', null], // ejemplo 2026
  [5, 'Servicios', null, 'Otros servicios Profesionales', 'Asesorías', null],
  [4, 'Servicios', null, 'Banca y Finanzas', 'Bancos', null],
  [3, 'Servicios', null, 'Servicios Médicos', 'Residencias de mayores', null], // no prevista
  [3, 'Servicios', null, 'Bares y Cafeterías', 'Bar', null], // subgrupo de otro grupo
  [2, 'Servicios', null, null, null, 'Actividad ficticia sin subgrupo'], // sin subgrupo
];
const PESO_TOTAL = COMBOS.reduce((a, c) => a + c[0], 0);

/** Filas (numeración de la hoja) con anomalías deliberadas, documentadas en docs/fase2/C1D-INCORPORACION.md. */
export const ANOMALIAS_ESCENARIO = {
  fachadaConUnidad: 6, web4: 11, fechaPendiente: 24, google83: 58, ventaOnline226: 109, responde23: 161, facebook247: 214, twitter379: 273,
  franquicia3001: 300, numRedes380: 332, sinDato: 385, sI: 435, seguidoresRedNo: 500, resenasSinGoogle: 510, vacioConNombre: 520,
  ocupadoSinNombre: 530, localVacioVacio: 540, localVacio2: 550, cpDistinto: 560,
  sn: [120, 240, 360, 480, 600, 720], conSufijo: [133, 264, 395, 526, 657, 788], numeroVacio: [193, 384, 575, 766],
  direccionRepetida: [[700, 701], [800, 801]] as [number, number][],
  localPrevio: [150, 151],
} as const;

/**
 * Libro XLSX del escenario (27 columnas, hojas Datos, Hoja1 y Tablas Dinámicas): 889 registros
 * ficticios y una fila «Total general». DETERMINISTA: mismas filas, mismas fechas internas del
 * paquete y, por tanto, el mismo SHA-256 en cada generación (lo exige la incorporación de demostración).
 */
export async function libroEscenarioMedina(): Promise<Uint8Array> {
  const rng = crearRng('c1d-medina-2025-ficticio');
  const A = ANOMALIAS_ESCENARIO;
  const filas: Record<string, unknown>[] = [];
  const N = 889;
  let i = 0;
  for (let via = 1; via <= VIAS_ESCENARIO; via++) {
    const n = via <= 52 ? 10 : 9;
    for (let k = 0; k < n && i < N; k++, i++) {
      const fila = i + 2;
      let vacio = rng.chance(0.31);
      if (fila === A.fachadaConUnidad || fila === A.vacioConNombre) vacio = true;
      if ([A.web4, A.google83, A.ventaOnline226, A.responde23, A.facebook247, A.twitter379, A.franquicia3001, A.numRedes380, A.sinDato, A.sI, A.seguidoresRedNo, A.resenasSinGoogle, A.ocupadoSinNombre].includes(fila as never)) vacio = false;
      let r = rng.next() * PESO_TOTAL;
      const combo = COMBOS.find((c) => (r -= c[0]) < 0) ?? COMBOS[0];
      const sector = combo[1] === 'Comercio' ? 'COMERCIO' : combo[1] === 'Servicios' ? 'SERVICIO' : 'HOSTELERÍA';
      const b = (p: number) => (rng.chance(p) ? 1 : 0);
      const google = b(0.6), ig = b(0.45), fb = b(0.4), tw = b(0.1);
      const mes = rng.int(0, 10);
      filas.push({
        fecha: new Date(Date.UTC(2025, mes, rng.int(1, 28))), cp: 47400, direccion: `VÍA FICTICIA ${String(via).padStart(3, '0')}`, numero: k + 1, vacio: vacio ? 1 : 0,
        fachada: vacio && rng.chance(0.95) ? Math.round(rng.int(30, 120)) / 10 : null,
        nombre: vacio ? null : `${sector} FICTICIO ${String(fila).padStart(4, '0')}`,
        grupoActividad: vacio ? null : combo[1], grupoComercio: vacio ? null : combo[2], subgrupo: vacio ? null : combo[3], actividad: vacio ? null : combo[4], descripcionActividad: vacio ? null : combo[5],
        franquicia: vacio ? null : b(0.1), web: vacio ? null : b(0.4), googleBusiness: vacio ? null : google, ventaOnline: vacio ? null : b(0.15),
        numResenas: vacio ? null : google ? rng.int(0, 600) : 0, respondeResenas: vacio ? null : google ? b(0.5) : 0,
        instagram: vacio ? null : ig, seguidoresInstagram: vacio ? null : ig ? rng.int(30, 9000) : 0,
        facebook: vacio ? null : fb, seguidoresFacebook: vacio ? null : fb ? rng.int(20, 6000) : 0,
        twitter: vacio ? null : tw, seguidoresTwitter: vacio ? null : tw ? rng.int(5, 2500) : 0,
        numRedes: vacio ? null : ig + fb + tw,
      });
    }
  }
  const f = (n: number) => filas[n - 2];
  f(A.fachadaConUnidad).fachada = '3,5 m';
  f(A.web4).web = 4;
  f(A.fechaPendiente).fecha = 'FECHA PENDIENTE';
  f(A.google83).googleBusiness = 83;
  f(A.ventaOnline226).ventaOnline = 226;
  f(A.responde23).respondeResenas = 23;
  f(A.facebook247).facebook = 247;
  f(A.twitter379).twitter = 379;
  f(A.franquicia3001).franquicia = 3001;
  Object.assign(f(A.numRedes380), { instagram: 1, facebook: 0, twitter: 0, seguidoresFacebook: 0, seguidoresTwitter: 0, numRedes: 380 });
  f(A.sinDato).seguidoresInstagram = 'sin dato';
  Object.assign(f(A.sI), { facebook: 1, seguidoresFacebook: 's/i' });
  Object.assign(f(A.seguidoresRedNo), { instagram: 0, seguidoresInstagram: 150 });
  Object.assign(f(A.resenasSinGoogle), { googleBusiness: 0, numResenas: 12, respondeResenas: 0 });
  Object.assign(f(A.vacioConNombre), { nombre: 'COMERCIO FICTICIO ANTERIOR', franquicia: 0 });
  Object.assign(f(A.ocupadoSinNombre), { nombre: null });
  f(A.localVacioVacio).vacio = null;
  f(A.localVacio2).vacio = 2;
  f(A.cpDistinto).cp = 47001;
  for (const n of A.sn) f(n).numero = 'S/N';
  for (const n of A.conSufijo) f(n).numero = `${f(n).numero} B`;
  for (const n of A.numeroVacio) f(n).numero = null;
  for (const [a, b] of A.direccionRepetida) Object.assign(f(b), { direccion: f(a).direccion, numero: f(a).numero, vacio: 0, nombre: `SERVICIO FICTICIO MISMO PORTAL ${b}` });
  for (const [n, l] of A.localPrevio.map((n, j) => [n, LOCALES_PREVIOS_ESCENARIO[j]] as const)) Object.assign(f(n), { direccion: `VÍA FICTICIA ${String(l.via).padStart(3, '0')}`, numero: l.numero });

  const wb = new ExcelJS.Workbook();
  const fijo = new Date(Date.UTC(2025, 11, 1));
  Object.assign(wb, { creator: 'ULIT Censo · escenario ficticio', lastModifiedBy: 'ULIT Censo · escenario ficticio', created: fijo, modified: fijo, keywords: 'ULIT-GENERADO-FICTICIO' });
  const ws = wb.addWorksheet('Datos');
  ws.addRow(PERFIL_CENSO_27.columnas.map((c) => c.cabecera));
  for (const fila of filas) {
    const row = ws.addRow(PERFIL_CENSO_27.columnas.map((c) => fila[c.clave] ?? null));
    if (fila.fecha instanceof Date) row.getCell(1).numFmt = 'dd/mm/yyyy';
  }
  ws.addRow(['Total general', null, null, null, null, null, filas.filter((x) => x.vacio === 1).length]);
  const h1 = wb.addWorksheet('Hoja1');
  h1.addRow(['NÚMERO', 'LOCAL VACÍO', 'GR ACTIVIDAD', 'GR COMERCIO', 'SUBGRUPO ACTIVIDAD', 'ACTIVIDAD']);
  [[1, 0, 'Comercio', 'Alimentación', 'Pan y Lácteos', 'Panadería'], [2, 1, 'Hostelería y Restauración', 'Equipamiento Personal', 'Bares y Cafeterías', 'Bar'], [3, null, 'Servicios', 'Otros Equipamientos', 'Peluquerías', 'Asesorías']].forEach((r) => h1.addRow(r));
  const td = wb.addWorksheet('Tablas Dinámicas');
  td.addRow(['RESUMEN FICTICIO: NO ES UNA FUENTE DE REGISTROS']);
  td.addRow([]);
  td.addRow(['Etiquetas de fila', 'Cuenta de GrActividad', 'Suma de Franquicia']);
  td.addRow(['Total general', N, null]);
  const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  // Reempaquetado con fecha fija: el ZIP de ExcelJS lleva la hora de generación.
  return zipSync(unzipSync(bytes), { mtime: fijo, level: 6 });
}
