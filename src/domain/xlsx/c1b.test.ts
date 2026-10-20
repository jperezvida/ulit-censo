// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { conPrefijo, libroFicticio } from '../../data/xlsxFicticio';
import { letraColumna } from './analisis';
import { ErrorLector, LIMITES_XLSX } from './lector';
import { PERFIL_CENSO_27, PERFIL_ITINERARIO_28, type PerfilImportacion } from './perfilesImportacion';
import { interpretarCapa, interpretarXlsx, type CapaOriginal, type OpcionesInterpretacion, type ValorOriginal } from './interpretacion';
import { informeInterpretacion } from './informeInterpretacion';
import { diagnosticarClasificacion } from './clasificacionHistorica';
import { CONFIG_TERRITORIAL } from '../territorio';

/** Todo lo de este archivo es SINTÉTICO: ningún dato real. */
const medina = CONFIG_TERRITORIAL['mun-medina'];
const valladolid = CONFIG_TERRITORIAL['mun-valladolid'];

const ov = (v: unknown): ValorOriginal =>
  v === null || v === undefined ? { t: 'vacio' }
  : typeof v === 'number' ? { t: 'numero', v }
  : typeof v === 'boolean' ? { t: 'booleano', v }
  : v instanceof Date ? { t: 'fecha', v: v.toISOString(), formato: 'dd/mm/yyyy' }
  : typeof v === 'object' ? (v as ValorOriginal)
  : { t: 'texto', v: String(v) };

const OCUPADO: Record<string, unknown> = {
  fecha: new Date(Date.UTC(2025, 4, 5)), cp: 47400, direccion: 'VÍA FICTICIA 001', numero: 3, vacio: 0, nombre: 'COMERCIO FICTICIO 0001',
  grupoActividad: 'Comercio', grupoComercio: 'Alimentación', subgrupo: 'Pan y Lácteos', actividad: 'Panadería', franquicia: 0, web: 1, googleBusiness: 1,
  ventaOnline: 0, numResenas: 10, respondeResenas: 1, instagram: 1, seguidoresInstagram: 100, facebook: 0, seguidoresFacebook: 0, twitter: 0, seguidoresTwitter: 0, numRedes: 1,
};
const VACIO: Record<string, unknown> = { fecha: new Date(Date.UTC(2025, 4, 6)), cp: 47400, direccion: 'VÍA FICTICIA 001', numero: 5, vacio: 1, fachada: 4.5 };

function capa(filas: Record<string, unknown>[], perfil: PerfilImportacion = PERFIL_CENSO_27): CapaOriginal {
  return {
    archivo: { nombre: 'sintetico.xlsx' }, hoja: 'Datos', filaCabecera: 1, perfil: { id: perfil.id, version: perfil.version }, excluidas: [],
    columnas: perfil.columnas.map((c, i) => ({ clave: c.clave, letra: letraColumna(i + 1), cabecera: c.cabecera, tipo: c.tipo, ...(c.territorial ? { territorial: c.territorial } : {}) })),
    filas: filas.map((f, i) => ({ fila: i + 2, celdas: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, ov(v)])) })),
  };
}
const op = (o: OpcionesInterpretacion = {}): OpcionesInterpretacion => ({ territorio: medina, ...o });
/** Interpreta una fila (ocupado por defecto) con cambios y devuelve la fila y sus incidencias. */
function una(cambios: Record<string, unknown>, o: OpcionesInterpretacion = {}, base = OCUPADO) {
  const res = interpretarCapa(capa([{ ...base, ...cambios }]), op(o));
  return { fila: res.filas[0], c: res.filas[0].celdas, inc: res.incidencias, tipos: res.incidencias.map((i) => i.tipo), res };
}

describe('C1b · Principio: nunca perder el original ni inventar valores', () => {
  it('un ocupado correcto se interpreta sin incidencias y sin verificar nada de 2026', () => {
    const { fila, c, inc } = una({});
    expect(inc).toEqual([]);
    expect(fila.local).toBe('ocupado');
    expect(Object.values(c).every((x) => !x.revision)).toBe(true);
    expect(c.franquicia).toMatchObject({ estado: 'valido', valor: false, regla: 'binario-01' });
    expect(c.fecha).toMatchObject({ estado: 'valido', valor: '2025-05-05', regla: 'fecha-excel' });
    expect(c.distrito).toMatchObject({ estado: 'no-aplica', regla: 'territorio-no-se-usa' });
    expect(c.fachada).toMatchObject({ estado: 'no-aplica', regla: 'no-aplica-local-ocupado' });
    expect(fila.verificado2026).toBe(false);
    expect(fila.clasificacion).toMatchObject({ diagnostico: 'coherente', confirmada: false });
  });

  it('distingue los seis estados: válido, vacío, no aplica, inválido, transformado y pendiente', () => {
    const { c } = una({ web: 1, ventaOnline: null, seguidoresInstagram: '120', facebook: 83, seguidoresFacebook: 's/i', numRedes: null });
    expect(c.web.estado).toBe('valido');
    expect(c.ventaOnline.estado).toBe('vacio');
    expect(c.seguidoresInstagram).toMatchObject({ estado: 'transformado', valor: 120, regla: 'entero-texto' });
    expect(c.facebook.estado).toBe('invalido');
    expect(c.seguidoresFacebook.estado).toBe('pendiente');
    expect(una({}, {}, VACIO).c.nombre.estado).toBe('no-aplica');
  });

  it('la interpretación es pura: la capa original no cambia y conserva cada valor tal cual', () => {
    const cp = capa([{ ...OCUPADO, web: 83, fachada: '3,5 m', numero: '16 B', fecha: 'FECHA PENDIENTE', nombre: '  Nombre con espacios  ' }]);
    const copia = structuredClone(cp);
    const res = interpretarCapa(cp, op());
    expect(cp).toEqual(copia);
    expect(res.original.filas[0].celdas.web).toEqual({ t: 'numero', v: 83 });
    expect(res.original.filas[0].celdas.fecha).toEqual({ t: 'texto', v: 'FECHA PENDIENTE' });
    // El nombre se conserva literalmente, incluidos los espacios
    expect(res.filas[0].celdas.nombre.valor).toBe('  Nombre con espacios  ');
  });
});

describe('C1b · Binarios 0/1', () => {
  it.each([4, 23, 83, 226, 247, 379, 3001])('el valor %i es inválido en cualquier columna 0/1 y nunca pasa a Sí', (v) => {
    for (const k of ['franquicia', 'web', 'googleBusiness', 'ventaOnline', 'respondeResenas', 'instagram', 'facebook', 'twitter']) {
      const { c, inc } = una({ [k]: v });
      expect(c[k]).toMatchObject({ estado: 'invalido', regla: 'binario-fuera-de-dominio', revision: true });
      expect(c[k].valor).toBeUndefined();
      expect(inc.find((i) => i.campo === k)).toMatchObject({ tipo: 'binario-invalido', gravedad: 'error', valorOriginal: String(v) });
    }
  });

  it('acepta solo representaciones numéricas inequívocas de 0 y 1', () => {
    expect(una({ web: '1' }).c.web).toMatchObject({ estado: 'transformado', valor: true, regla: 'binario-texto-01' });
    expect(una({ web: ' 0 ' }).c.web).toMatchObject({ estado: 'transformado', valor: false });
    expect(una({ web: '1,0' }).c.web).toMatchObject({ estado: 'transformado', valor: true });
    expect(una({ web: '83' }).c.web).toMatchObject({ estado: 'invalido', regla: 'binario-fuera-de-dominio' });
    expect(una({ web: 'Sí' }).c.web).toMatchObject({ estado: 'invalido', regla: 'binario-texto-no-reconocido' });
    expect(una({ web: true }).c.web).toMatchObject({ estado: 'invalido', regla: 'tipo-no-admitido' });
    expect(una({ web: { t: 'error', v: '#N/A' } }).c.web).toMatchObject({ estado: 'invalido', regla: 'error-excel' });
  });

  it('un binario vacío en un ocupado es «sin información», nunca No; en un local vacío no aplica', () => {
    const { c, tipos } = una({ franquicia: null, web: '   ' });
    expect(c.franquicia).toMatchObject({ estado: 'vacio', regla: 'celda-vacia', revision: true });
    expect(c.franquicia.valor).toBeUndefined();
    expect(c.web).toMatchObject({ estado: 'vacio', regla: 'solo-espacios' });
    expect(tipos.filter((t) => t === 'sin-dato-ocupado')).toHaveLength(2);
    expect(una({}, {}, VACIO).c.franquicia).toMatchObject({ estado: 'no-aplica', regla: 'no-aplica-local-vacio' });
  });
});

describe('C1b · Textos «sin dato» y «s/i» (diccionario pendiente de la Cátedra)', () => {
  it('quedan pendientes, con la propuesta visible y sin aplicarse', () => {
    const { c, inc } = una({ seguidoresInstagram: 'sin dato', seguidoresFacebook: 'S/I', facebook: 1, numRedes: 2 });
    for (const k of ['seguidoresInstagram', 'seguidoresFacebook']) {
      expect(c[k]).toMatchObject({ estado: 'pendiente', regla: 'diccionario-sin-informacion', propuesta: 'sin-informacion', revision: true });
    }
    expect(inc.filter((i) => i.tipo === 'texto-sin-informacion-pendiente').every((i) => i.decision === 'catedra')).toBe(true);
  });

  it('solo si la Cátedra aprueba el diccionario pasan a «sin información» (vacío), conservando el original', () => {
    const { c, res } = una({ seguidoresInstagram: 'sin dato' }, { diccionarioAprobado: ['sin dato'] });
    expect(c.seguidoresInstagram).toMatchObject({ estado: 'vacio', regla: 'diccionario-sin-informacion' });
    expect(res.original.filas[0].celdas.seguidoresInstagram).toEqual({ t: 'texto', v: 'sin dato' });
  });

  it('cualquier otro texto es inválido', () => {
    expect(una({ seguidoresInstagram: 'muchos' }).c.seguidoresInstagram).toMatchObject({ estado: 'invalido', regla: 'numero-texto-no-reconocido' });
    expect(una({ web: 'sin dato' }).c.web).toMatchObject({ estado: 'pendiente' });
  });
});

describe('C1b · Fecha censo', () => {
  const periodo = { desde: '2025-01-01', hasta: '2025-12-31' };
  it('«FECHA PENDIENTE» es inválida y la fecha queda ausente (no se usa la fecha actual)', () => {
    const { c, inc } = una({ fecha: 'FECHA PENDIENTE' });
    expect(c.fecha).toMatchObject({ estado: 'invalido', regla: 'fecha-no-reconocida' });
    expect(c.fecha.valor).toBeUndefined();
    expect(c.fecha.propuesta).toBeUndefined();
    expect(inc[0]).toMatchObject({ tipo: 'fecha-no-reconocida', valorOriginal: '«FECHA PENDIENTE»' });
  });
  it('vacía: ausente con aviso; nunca se rellena', () => {
    const { c, tipos } = una({ fecha: null });
    expect(c.fecha).toMatchObject({ estado: 'vacio' });
    expect(c.fecha.valor).toBeUndefined();
    expect(tipos).toContain('fecha-ausente');
  });
  it('formatos admitidos como texto, comprobando que la fecha existe', () => {
    expect(una({ fecha: '05/01/2025' }).c.fecha).toMatchObject({ estado: 'transformado', valor: '2025-01-05', regla: 'fecha-texto-dma' });
    expect(una({ fecha: '2025-03-07' }).c.fecha).toMatchObject({ estado: 'transformado', valor: '2025-03-07', regla: 'fecha-texto-iso' });
    expect(una({ fecha: '31/02/2025' }).c.fecha).toMatchObject({ estado: 'invalido' });
    expect(una({ fecha: '05/01/25' }).c.fecha).toMatchObject({ estado: 'pendiente', propuesta: '2025-01-05', regla: 'fecha-anio-dos-cifras' });
  });
  it('un número sin formato de fecha queda pendiente salvo autorización expresa de la regla', () => {
    expect(una({ fecha: 45667 }).c.fecha).toMatchObject({ estado: 'pendiente', propuesta: '2025-01-10', regla: 'fecha-serial-sin-formato' });
    expect(una({ fecha: 45667 }, { reglasAutorizadas: ['fecha-serial-sin-formato'] }).c.fecha).toMatchObject({ estado: 'transformado', valor: '2025-01-10' });
  });
  it('señala las fechas incompatibles con la campaña sin corregirlas', () => {
    const { c, inc } = una({ fecha: new Date(Date.UTC(2023, 5, 1)) }, { periodo });
    expect(c.fecha).toMatchObject({ estado: 'pendiente', regla: 'fecha-fuera-de-campana', propuesta: '2023-06-01' });
    expect(inc[0].tipo).toBe('fecha-fuera-de-campana');
    expect(una({}, { periodo }).c.fecha.estado).toBe('valido');
  });
});

describe('C1b · Distrito, Zona y CP según el municipio', () => {
  it('Medina: Distrito y Zona no se usan (vacíos sin incidencia; con valor, se conservan sin usarlos); CP 47400', () => {
    expect(una({}).inc).toEqual([]);
    const { c, tipos } = una({ distrito: 3, cp: 47001 });
    expect(c.distrito).toMatchObject({ estado: 'no-aplica' });
    expect(tipos).toContain('territorio-no-usado-con-valor');
    expect(c.cp).toMatchObject({ estado: 'pendiente', regla: 'cp-distinto-del-fijo', propuesta: '47001' });
    expect(una({}).c.cp).toMatchObject({ estado: 'valido', valor: '47400' });
  });
  it('Medina: un CP vacío en el histórico se conserva vacío; no se rellena con 47400', () => {
    const { c, inc } = una({ cp: null });
    expect(c.cp).toMatchObject({ estado: 'vacio', regla: 'territorio-ausente-historico' });
    expect(c.cp.valor).toBeUndefined();
    expect(inc).toEqual([]);
  });
  it('Valladolid: los vacíos históricos se conservan; en una campaña actual son incidencia; nunca se inventan', () => {
    const fila = { ...OCUPADO, cp: null };
    const hist = interpretarCapa(capa([fila]), { territorio: valladolid });
    expect(['distrito', 'zona', 'cp'].map((k) => hist.filas[0].celdas[k].estado)).toEqual(['vacio', 'vacio', 'vacio']);
    expect(hist.incidencias).toEqual([]);
    const actual = interpretarCapa(capa([fila]), { territorio: valladolid, modo: 'campana-actual' });
    expect(actual.incidencias.map((i) => [i.campo, i.tipo])).toEqual([['distrito', 'territorio-obligatorio-ausente'], ['zona', 'territorio-obligatorio-ausente'], ['cp', 'territorio-obligatorio-ausente']]);
    expect(actual.filas[0].celdas.distrito.valor).toBeUndefined();
    const conValor = interpretarCapa(capa([{ ...OCUPADO, distrito: 4, zona: '12', cp: 47003 }]), { territorio: valladolid, modo: 'campana-actual' });
    expect(conValor.filas[0].celdas.distrito).toMatchObject({ estado: 'valido', valor: '4', regla: 'territorio-codigo' });
    expect(conValor.filas[0].celdas.cp).toMatchObject({ estado: 'valido', valor: '47003' });
  });
  it('un CP de 4 cifras queda pendiente (posible cero inicial perdido)', () => {
    const r = interpretarCapa(capa([{ ...OCUPADO, cp: 8001 }]), { territorio: valladolid });
    expect(r.filas[0].celdas.cp).toMatchObject({ estado: 'pendiente', propuesta: '08001', regla: 'cp-cuatro-cifras' });
  });
});

describe('C1b · Dirección y Num', () => {
  it('conserva el texto de la dirección y distingue número, sufijo, S/N y desconocido', () => {
    expect(una({ numero: 16 }).c.numero).toMatchObject({ estado: 'valido', valor: { tipo: 'numero', numero: 16 } });
    expect(una({ numero: '16 B' }).c.numero).toMatchObject({ estado: 'transformado', regla: 'portal-sufijo', valor: { tipo: 'numero', numero: 16, sufijo: 'B' } });
    expect(una({ numero: 'S/N' }).c.numero).toMatchObject({ estado: 'valido', regla: 'portal-sn', valor: { tipo: 'sin-numero' } });
    const desconocido = una({ numero: null });
    expect(desconocido.c.numero).toMatchObject({ estado: 'vacio' });
    expect(desconocido.c.numero.valor).toBeUndefined();
    expect(desconocido.tipos).toEqual(['numero-ausente']);
    expect(una({ numero: 12.5 }).c.numero.estado).toBe('invalido');
    expect(una({ numero: 'esquina' }).c.numero.estado).toBe('invalido');
    expect(una({ direccion: '  C/ Ficticia,  ' }).c.direccion.valor).toBe('  C/ Ficticia,  ');
    expect(una({ direccion: null }).tipos).toContain('direccion-ausente');
  });
});

describe('C1b · Local Vacío, Long fachada y nombre', () => {
  it('Local Vacío vacío o distinto de 0/1 es incidencia y no se deduce del nombre', () => {
    const sinValor = una({ vacio: null, nombre: null });
    expect(sinValor.fila.local).toBe('desconocido');
    expect(sinValor.tipos).toContain('local-vacio-ausente');
    expect(sinValor.tipos).not.toContain('ocupado-sin-nombre');
    expect(sinValor.c.nombre.estado).toBe('vacio');
    const raro = una({ vacio: 2 });
    expect(raro.fila.local).toBe('desconocido');
    expect(raro.tipos).toContain('local-vacio-invalido');
  });
  it('locales vacíos con campos comerciales rellenos', () => {
    const { tipos, inc } = una({ nombre: 'COMERCIO FICTICIO', franquicia: 1, subgrupo: 'Bares y Cafeterías' }, {}, VACIO);
    expect(tipos).toContain('vacio-con-datos-negocio');
    expect(inc.find((i) => i.tipo === 'vacio-con-datos-negocio')!.relacionadas).toEqual(['nombre', 'subgrupo', 'franquicia']);
  });
  it('ocupado sin nombre', () => {
    expect(una({ nombre: null }).tipos).toContain('ocupado-sin-nombre');
  });
  it('fachada: números no negativos; «3,5 m» queda pendiente salvo autorización, con trazabilidad', () => {
    expect(una({}, {}, VACIO).c.fachada).toMatchObject({ estado: 'valido', valor: 4.5 });
    const p = una({ fachada: '3,5 m' }, {}, VACIO);
    expect(p.c.fachada).toMatchObject({ estado: 'pendiente', regla: 'fachada-con-unidad', propuesta: 3.5 });
    expect(p.inc[0]).toMatchObject({ tipo: 'fachada-con-unidad', decision: 'catedra' });
    expect(una({ fachada: '3,5 m' }, { reglasAutorizadas: ['fachada-con-unidad'] }, VACIO).c.fachada).toMatchObject({ estado: 'transformado', valor: 3.5, regla: 'fachada-con-unidad' });
    expect(una({ fachada: '3,5' }, {}, VACIO).c.fachada).toMatchObject({ estado: 'transformado', valor: 3.5, regla: 'decimal-texto' });
    expect(una({ fachada: -2 }, {}, VACIO).c.fachada.estado).toBe('invalido');
    expect(una({ fachada: 'ancha' }, {}, VACIO).c.fachada.estado).toBe('invalido');
    expect(una({ fachada: 6 }).tipos).toContain('fachada-en-ocupado');
  });
});

describe('C1b · Presencia digital, seguidores, reseñas y Nº redes', () => {
  it('seguidores y reseñas: enteros ≥ 0, incluido el cero; textos y negativos no se aceptan', () => {
    expect(una({ seguidoresInstagram: 0 }).c.seguidoresInstagram).toMatchObject({ estado: 'valido', valor: 0 });
    expect(una({ seguidoresInstagram: -3 }).c.seguidoresInstagram.estado).toBe('invalido');
    expect(una({ numResenas: 2.5 }).c.numResenas.estado).toBe('invalido');
  });
  it('seguidores positivos con la red marcada No: contradicción señalada, sin corregir ningún valor', () => {
    const { c, inc } = una({ facebook: 0, seguidoresFacebook: 50 });
    expect(c.seguidoresFacebook).toMatchObject({ estado: 'valido', valor: 50, revision: true });
    expect(c.facebook).toMatchObject({ estado: 'valido', valor: false });
    expect(inc[0]).toMatchObject({ tipo: 'seguidores-con-red-no', campo: 'seguidoresFacebook', relacionadas: ['facebook'] });
  });
  it('reseñas con Google Business No', () => {
    expect(una({ googleBusiness: 0, numResenas: 12, respondeResenas: 0 }).tipos).toEqual(['resenas-sin-google']);
    expect(una({ googleBusiness: 0, numResenas: 0, respondeResenas: 1 }).tipos).toEqual(['responde-sin-google']);
  });
  it('cifras vacías cuando la red es No: no aplican', () => {
    const { c, inc } = una({ facebook: 0, seguidoresFacebook: null, googleBusiness: 0, numResenas: null, respondeResenas: null });
    expect(c.seguidoresFacebook).toMatchObject({ estado: 'no-aplica', regla: 'no-aplica-red-no' });
    expect(c.numResenas.estado).toBe('no-aplica');
    expect(inc).toEqual([]);
  });
  it('Nº redes = 380: se conserva el original, se informa del calculado y queda inválido', () => {
    const { fila, c, inc, res } = una({ numRedes: 380 });
    expect(fila.redesCalculadas).toBe(1);
    expect(c.numRedes).toMatchObject({ estado: 'invalido', regla: 'redes-discrepa' });
    expect(res.original.filas[0].celdas.numRedes).toEqual({ t: 'numero', v: 380 });
    expect(inc[0].mensaje).toContain('= 380; Instagram + Facebook + Twitter/X = 1');
  });
  it('si alguna red es desconocida o inválida, no se inventa el total', () => {
    const inval = una({ facebook: 247 });
    expect(inval.fila.redesCalculadas).toBeNull();
    expect(inval.c.numRedes).toMatchObject({ estado: 'pendiente', regla: 'redes-no-calculable' });
    expect(inval.tipos).toContain('redes-no-calculable');
    const vacio = una({ twitter: null, numRedes: null });
    expect(vacio.fila.redesCalculadas).toBeNull();
    expect(una({ numRedes: 1 }).c.numRedes).toMatchObject({ estado: 'valido', regla: 'redes-coincide' });
    // Vacío pero calculable: se conserva vacío y el cálculo queda aparte
    const sinOriginal = una({ numRedes: null });
    expect(sinOriginal.c.numRedes.estado).toBe('vacio');
    expect(sinOriginal.fila.redesCalculadas).toBe(1);
  });
});

describe('C1b · Clasificación histórica', () => {
  it('guarda las cinco columnas por separado y literalmente, sin confirmarlas ni pasarlas al catálogo 2026', () => {
    const { fila, c } = una({ grupoActividad: 'Servicios', grupoComercio: null, subgrupo: 'Peluquerias ', actividad: null, descripcionActividad: 'Barbería ficticia' });
    expect(c.subgrupo.valor).toBe('Peluquerias ');
    expect(c.descripcionActividad.valor).toBe('Barbería ficticia');
    expect(c.grupoComercio).toMatchObject({ estado: 'no-aplica', regla: 'no-aplica-fuera-de-comercio' });
    expect(fila.clasificacion).toMatchObject({ diagnostico: 'coherente-subgrupo-sin-actividades', confirmada: false });
    expect(JSON.stringify(fila)).not.toContain('c26.');
  });
  it('respeta la estructura de Servicios: la actividad 2025 que es un ejemplo 2026 no es un error', () => {
    const { tipos, inc } = una({ grupoActividad: 'Servicios', grupoComercio: null, subgrupo: 'Servicios Médicos', actividad: 'Fisioterapia' });
    expect(tipos).toEqual(['servicios-actividad-ejemplo']);
    expect(inc[0]).toMatchObject({ gravedad: 'info', decision: 'catedra' });
  });
  it('señala combinaciones incoherentes o incompletas', () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ grupoActividad: 'Servicios', grupoComercio: null, subgrupo: 'Bares y Cafeterías', actividad: 'Bar' }, 'subgrupo-de-otro-grupo'],
      [{ grupoActividad: 'Hostelería y Restauración', grupoComercio: null, subgrupo: 'Bares y Cafeterías', actividad: 'Bancos' }, 'actividad-no-pertenece'],
      [{ grupoComercio: 'Otros Equipamientos', subgrupo: 'Pan y Lácteos' }, 'grupo-comercio-no-corresponde'],
      [{ grupoActividad: 'Hostelería y Restauración', grupoComercio: 'Alimentación', subgrupo: 'Restaurantes', actividad: 'Tradicional' }, 'grupo-comercio-fuera-de-comercio'],
      [{ subgrupo: null, actividad: null }, 'sin-subgrupo'],
      [{ grupoActividad: null, grupoComercio: null, subgrupo: null, actividad: null }, 'sin-grupo'],
      [{ actividad: null, descripcionActividad: null }, 'incompleta-sin-actividad'],
      [{ grupoComercio: null }, 'comercio-sin-grupo-comercio'],
      [{ subgrupo: 'Inventado Ficticio', actividad: null }, 'subgrupo-inexistente-2026'],
    ];
    for (const [cambios, diag] of casos) {
      const { fila, inc } = una(cambios);
      expect(fila.clasificacion?.diagnostico, diag).toBe(diag);
      expect(inc.some((i) => i.tipo === 'clasificacion-incoherente' || i.tipo === 'clasificacion-incompleta'), diag).toBe(true);
    }
  });
  it('el diagnóstico tolera mayúsculas, tildes y plurales, y marca lo que está fuera de Hoja1', () => {
    expect(diagnosticarClasificacion({ grupo: 'COMERCIO', grupoComercio: 'alimentacion', subgrupo: 'pan y lacteos', actividad: 'panaderia' }).diagnostico).toBe('coherente');
    expect(diagnosticarClasificacion({ grupo: 'Servicios', subgrupo: 'Banca y finanzas', actividad: 'Bancas y finanzas' }).fueraDeLista).toEqual(['actividad']);
  });
});

describe('C1b · Direcciones repetidas y duplicados', () => {
  it('conserva todas las filas, no fusiona y deja la correspondencia física pendiente', () => {
    const res = interpretarCapa(capa([OCUPADO, { ...OCUPADO, nombre: 'SERVICIO FICTICIO DISTINTO' }, { ...OCUPADO, numero: 7 }]), op());
    expect(res.filas).toHaveLength(3);
    expect(res.filas.map((f) => f.grupoDireccion)).toEqual([1, 1, undefined]);
    const rep = res.incidencias.filter((i) => i.tipo === 'direccion-repetida');
    expect(rep.map((i) => i.fila)).toEqual([2, 3]);
    expect(rep[0]).toMatchObject({ gravedad: 'info', decision: 'revision' });
    expect(rep[0].propuesta).toMatch(/No demuestra que haya dos locales físicos/);
  });
  it('una fila idéntica a otra es posible duplicado exacto, sin eliminar ninguna', () => {
    const res = interpretarCapa(capa([OCUPADO, OCUPADO]), op());
    expect(res.filas).toHaveLength(2);
    expect(res.incidencias.filter((i) => i.tipo === 'fila-duplicada-exacta').map((i) => i.fila)).toEqual([3]);
  });
});

describe('C1b · Incidencias trazables', () => {
  it('cada incidencia indica archivo, hoja, fila, columna, tipo y propuesta', () => {
    const { inc } = una({ web: 4 });
    expect(inc[0]).toMatchObject({ archivo: 'sintetico.xlsx', hoja: 'Datos', fila: 2, columna: 'P', cabecera: 'web', campo: 'web', tipo: 'binario-invalido', regla: 'binario-fuera-de-dominio' });
    expect(inc[0].propuesta).toMatch(/nunca pasa a Sí/);
  });
});

describe('C1b · Desde XLSX ficticios (lector seguro y perfiles de C1a)', () => {
  it('perfil de 27 columnas con anomalías y XML con prefijo: detecta todas las anomalías previstas', async () => {
    const bytes = conPrefijo(await libroFicticio({ filas: 40, anomalias: true, repetidas: 2 }));
    const res = await interpretarXlsx(bytes, 'ficticio-27.xlsx', { territorio: medina, periodo: { desde: '2025-01-01', hasta: '2025-12-31' } });
    expect(res.original.perfil.id).toBe('censo-municipal-27');
    expect(res.filas).toHaveLength(42);
    const tipos = new Set(res.incidencias.map((i) => i.tipo));
    for (const t of ['fecha-no-reconocida', 'binario-invalido', 'texto-sin-informacion-pendiente', 'redes-discrepa', 'redes-no-calculable', 'fachada-con-unidad', 'direccion-repetida'] as const) expect(tipos, t).toContain(t);
    const fila = (n: number) => res.filas.find((f) => f.fila === n)!;
    expect(fila(7).celdas.numero).toMatchObject({ estado: 'valido', regla: 'portal-sn' });
    expect(fila(8).celdas.numero).toMatchObject({ estado: 'transformado', valor: { tipo: 'numero', numero: 6, sufijo: 'B' } });
    // El informe agregado no contiene nombres ni direcciones
    const inf = informeInterpretacion(res, 'Medina del Campo');
    const json = JSON.stringify(inf);
    expect(json).not.toMatch(/COMERCIO FICTICIO|SERVICIO FICTICIO|VÍA FICTICIA/);
    expect(inf.celdas.total).toBe(42 * 27);
    expect(inf.celdas.sinRevision + inf.celdas.requierenRevision).toBe(inf.celdas.total);
    expect(inf.clasificacion.confirmadas).toBe(0);
    expect(inf.direccionesRepetidas.filas).toBeGreaterThanOrEqual(4);
  });

  it('perfil de 28 columnas: las mismas reglas, sin Distrito ni Zona', async () => {
    const res = await interpretarXlsx(await libroFicticio({ perfil: 'itinerario-28', filas: 24, anomalias: true }), 'ficticio-28.xlsx', { territorio: medina });
    expect(res.original.perfil.id).toBe('itinerario-medina-2026-28');
    expect(res.original.columnas).toHaveLength(28);
    expect(res.filas[0].celdas.distrito).toBeUndefined();
    expect(res.filas[0].celdas.itinerario).toMatchObject({ estado: 'valido', valor: 1 });
    expect(res.filas[0].celdas.municipio).toMatchObject({ estado: 'valido', regla: 'texto-literal' });
    expect(res.incidencias.some((i) => i.tipo === 'binario-invalido')).toBe(true);
    const capa28 = capa([{ ...OCUPADO, municipio: 'MUNICIPIO FICTICIO', itinerario: 3, ordenPar: null }], PERFIL_ITINERARIO_28);
    expect(interpretarCapa(capa28, op()).incidencias).toEqual([]);
  });

  it('conserva los límites de seguridad del lector', async () => {
    const bytes = await libroFicticio({ filas: 30 });
    await expect(interpretarXlsx(bytes, 'x.xlsx', {}, { ...LIMITES_XLSX, maxBytesArchivo: 1000 })).rejects.toBeInstanceOf(ErrorLector);
  });

  it('rechaza con claridad un libro sin perfil compatible', async () => {
    const bytes = await libroFicticio({ filas: 10, omitir: ['Local Vacío', 'Nº redes', 'web', 'Facebook'] });
    await expect(interpretarXlsx(bytes, 'x.xlsx')).rejects.toThrow(/no es compatible con ningún perfil/);
  });

  it('rendimiento: 10.000 filas ficticias', async () => {
    const bytes = await libroFicticio({ filas: 10000, anomalias: true });
    const t0 = performance.now();
    const res = await interpretarXlsx(bytes, 'ficticio-10000.xlsx', { territorio: medina, periodo: { desde: '2025-01-01', hasta: '2025-12-31' } });
    const tLectura = performance.now() - t0;
    const t1 = performance.now();
    const solo = interpretarCapa(res.original, { territorio: medina });
    const tInterpretacion = performance.now() - t1;
    const inf = informeInterpretacion(res);
    console.info(`[C1b] 10.000 filas: lectura + análisis + interpretación ${Math.round(tLectura)} ms; solo interpretación ${Math.round(tInterpretacion)} ms; ${inf.celdas.total} celdas`);
    expect(res.filas).toHaveLength(10000);
    expect(solo.filas).toHaveLength(10000);
    expect(inf.celdas.total).toBe(270000);
    expect(tInterpretacion).toBeLessThan(5000);
  }, 120000);
});
