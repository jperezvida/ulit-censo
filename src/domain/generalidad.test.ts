// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { CASOS_GENERALIDAD } from '../data/xlsxGeneralidad';
import { libroFicticio, type OpcionesLibroFicticio } from '../data/xlsxFicticio';
import { analizarXlsx } from './xlsx/analisis';
import { interpretarXlsx } from './xlsx/interpretacion';

/**
 * G0 · Pruebas de GENERALIDAD: censos sintéticos con estructuras distintas de las de Medina del Campo
 * (otros municipios y años, columnas con otros nombres y en otro orden, columnas desconocidas,
 * campos ausentes, otros formatos de fecha, hojas auxiliares, cabecera fuera de la fila 1).
 *
 * En G0 las limitaciones estaban marcadas con `it.fails` (documentaban sin bloquear la CI). Con G1
 * (catálogo común, correspondencia de columnas y perfiles como datos) son pruebas normales.
 */
beforeAll(() => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

const VARIANTES_MEDINA: Record<string, OpcionesLibroFicticio> = {
  'formato Medina con una columna adicional («Observaciones»)': { extra: ['Observaciones'] },
  'formato Medina sin las columnas de redes sociales': { omitir: ['Instagram', 'segu Insta', 'Facebook', 'Segu F', 'Twitter', 'Segu T', 'Nº redes'] },
  'formato Medina con «Dirección» renombrada como «Calle»': { cabeceras: { Dirección: 'Calle' } },
};

describe('G0 · Lo que ya funciona con archivos distintos', () => {
  for (const c of CASOS_GENERALIDAD) {
    it(`caso ${c.id} (${c.municipio} ${c.anio}): se lee con el lector seguro y se describen todas sus hojas`, async () => {
      const inf = await analizarXlsx(await c.generar(), c.archivo);
      expect(inf.hojas.map((h) => h.nombre)).toContain(c.hoja);
      expect(inf.archivo.sha256).toMatch(/^[0-9a-f]{64}$/);
    });
  }
  it('la hoja de resumen (tabla dinámica) se reconoce como resumen y no como datos', async () => {
    const b = CASOS_GENERALIDAD.find((c) => c.id === 'B')!;
    const inf = await analizarXlsx(await b.generar(), b.archivo);
    expect(inf.hojas.find((h) => h.nombre === 'Resumen')?.rol).toBe('resumen');
  });
  it('el formato de referencia de Medina (27 columnas exactas) sigue reconociéndose', async () => {
    const inf = await analizarXlsx(await libroFicticio({ filas: 10 }), 'x.xlsx');
    expect(inf.perfilPropuesto).toBe('censo-municipal-27');
  });
});

describe('G1 · Antes limitaciones conocidas de G0, ahora resueltas', () => {
  for (const c of CASOS_GENERALIDAD.filter((x) => x.id !== 'C')) {
    it(`caso ${c.id}: detecta la hoja de datos «${c.hoja}» y su cabecera en la fila ${c.filaCabecera}`, async () => {
      const inf = await analizarXlsx(await c.generar(), c.archivo);
      expect(inf.hojaDatos).toBe(c.hoja);
      expect(inf.filas.filaCabecera).toBe(c.filaCabecera);
    });
    it(`caso ${c.id}: se interpreta conservando sus ${c.filas} filas`, async () => {
      const r = await interpretarXlsx(await c.generar(), c.archivo);
      expect(r.filas).toHaveLength(c.filas);
    });
  }
  for (const [nombre, o] of Object.entries(VARIANTES_MEDINA)) {
    it(`${nombre}: se interpreta`, async () => {
      const r = await interpretarXlsx(await libroFicticio({ filas: 10, ...o }), 'x.xlsx');
      expect(r.filas).toHaveLength(10);
    });
  }
});

// ───────────── G1 · Perfiles configurables ─────────────
import { readFileSync } from 'node:fs';
import { leerLibro } from './xlsx/lector';
import { analizarLibroLeido } from './xlsx/analisis';
import { asignarColumna, evaluarCorrespondencia, perfilDesdeCorrespondencia, validarPerfil } from './xlsx/correspondencia';
import { PERFIL_CENSO_27, PERFIL_MEDINA_2025, referenciaAplicable, SHA256_ORIGINAL_MEDINA_2025 } from './xlsx/referencias';
import { validarInstantanea } from '../data/instantaneaOsm';
import { crearBaseEspacio, municipioDeEspacio } from './espacios';
import { prepararIncorporacion } from './incorporacionXlsx';
import { aplicarIncorporacion } from './incorporacion';

const caso = (id: string) => CASOS_GENERALIDAD.find((c) => c.id === id)!;

describe('G1 · Correspondencia de columnas y perfiles como datos', () => {
  it('caso A: reconoce todas las columnas, conserva las adicionales y no inventa valores', async () => {
    const c = caso('A');
    const r = await interpretarXlsx(await c.generar(), c.archivo);
    expect(Object.fromEntries(r.estructura.correspondencia.map((x) => [x.cabecera, x.clave]))).toEqual(c.esperado);
    expect(r.original.adicionales?.map((a) => a.cabecera)).toEqual(['Observaciones del censista', 'Código interno']);
    expect(r.original.filas.filter((f) => f.adicionales).length).toBe(40);
    // Fechas en texto: se interpretan con sus reglas explícitas; «Sí»/«No» en una columna 0/1 NO se convierte
    expect(r.filas.every((f) => f.celdas.fecha?.estado === 'transformado')).toBe(true);
    const franq = r.filas.map((f) => f.celdas.franquicia).filter((x) => x && x.estado !== 'no-aplica');
    expect(franq.length).toBeGreaterThan(0);
    expect(franq.every((x) => x!.estado === 'invalido' && x!.valor === undefined)).toBe(true);
    // Campos sin columna: no aparecen (CP, Distrito, Zona, redes)
    expect(r.filas.some((f) => 'cp' in f.celdas || 'instagram' in f.celdas)).toBe(false);
  });

  it('caso C: las columnas dudosas NO se asignan solas; con la correspondencia manual se guarda un perfil y se interpreta', async () => {
    const c = caso('C');
    const bytes = await c.generar();
    await expect(interpretarXlsx(bytes, c.archivo)).rejects.toThrow(/relaciónelas en el paso «Columnas»/);
    const inf = await analizarXlsx(bytes, c.archivo);
    expect(inf.hojaDatos).toBe('Datos');
    let corr = inf.correspondencia;
    expect(corr.filter((x) => x.estado === 'ambigua').map((x) => x.cabecera)).toEqual(['Nombre comercial', 'Nombre del local', 'Dirección', 'Dirección fiscal']);
    expect(evaluarCorrespondencia(corr)).toMatchObject({ lista: false });
    const idx = (h: string) => corr.find((x) => x.cabecera === h)!.indice;
    corr = asignarColumna(corr, idx('Nombre comercial'), 'nombre');
    corr = asignarColumna(corr, idx('Dirección'), 'direccion');
    corr = asignarColumna(corr, idx('Nombre del local'), null);
    corr = asignarColumna(corr, idx('Dirección fiscal'), null);
    expect(() => asignarColumna(corr, idx('Dirección fiscal'), 'direccion')).toThrow(/ya está asignado/);
    expect(evaluarCorrespondencia(corr).lista).toBe(true);
    const perfil = perfilDesdeCorrespondencia(corr, { nombre: 'Aldea Sintética 2022', hoja: 'Datos', filaCabecera: 1, fecha: '2026-10-25' });
    expect(perfil).toMatchObject({ id: 'usuario-aldea-sintetica-2022', version: 1, origen: 'usuario', adicionales: ['Nombre del local', 'Dirección fiscal'] });
    // Guardar (JSON) y volver a cargar
    const cargado = validarPerfil(JSON.parse(JSON.stringify(perfil)));
    expect(cargado.ok).toBe(true);
    const r = await interpretarXlsx(bytes, c.archivo, {}, undefined, { perfil: cargado.ok ? cargado.perfil : undefined });
    expect(r.filas).toHaveLength(12);
    expect(r.original.perfil).toEqual({ id: 'usuario-aldea-sintetica-2022', version: 1 });
    expect(r.original.adicionales?.map((a) => a.cabecera)).toEqual(['Nombre del local', 'Dirección fiscal']);
  });

  it('un perfil guardado se REUTILIZA con otro archivo de la misma estructura aunque la hoja tenga otro nombre', async () => {
    const c = caso('B');
    const inf = await analizarXlsx(await c.generar(), c.archivo);
    const perfil = perfilDesdeCorrespondencia(inf.correspondencia, { nombre: 'Pueblo del Río', hoja: 'Hoja1', filaCabecera: 1 });
    // Otro año: misma estructura, hoja renombrada
    const leido = await leerLibro(await c.generar());
    leido.libro.getWorksheet('Hoja1')!.name = 'Censo 2025';
    const otro = new Uint8Array((await leido.libro.xlsx.writeBuffer()) as ArrayBuffer);
    const r = await interpretarXlsx(otro, 'pueblo_2025.xlsx', {}, undefined, { perfil });
    expect(r.original.hoja).toBe('Censo 2025');
    expect(r.filas).toHaveLength(60);
  });

  it('hoja y fila de cabecera elegidas por la persona; si no encajan con el perfil, se explica', async () => {
    const c = caso('A');
    const bytes = await c.generar();
    const leido = await leerLibro(bytes);
    const mal = await analizarLibroLeido(leido, bytes, c.archivo, { hoja: 'Censo 2023', filaCabecera: 1 });
    expect(mal.cabeceras.map((x) => x.cabecera)).toEqual(['Villa Sintética de Arriba · censo comercial 2023 (SINTÉTICO)']);
    const bien = await analizarLibroLeido(leido, bytes, c.archivo, { hoja: 'Censo 2023', filaCabecera: 3 });
    expect(bien.cabeceras).toHaveLength(10);
    const perfil = perfilDesdeCorrespondencia(bien.correspondencia, { nombre: 'Villa A', hoja: 'Censo 2023', filaCabecera: 3 });
    await expect(interpretarXlsx(bytes, c.archivo, {}, undefined, { perfil, hoja: 'Portada', filaCabecera: 1 })).rejects.toThrow(/no encaja con el perfil «Villa A»: faltan/);
  });

  it('perfiles de referencia de Medina: indicadores y huella solo cuando corresponde', () => {
    expect(PERFIL_CENSO_27.referencia).toBeUndefined();
    expect(referenciaAplicable(PERFIL_CENSO_27, SHA256_ORIGINAL_MEDINA_2025, true)).toBeUndefined();
    expect(referenciaAplicable(PERFIL_MEDINA_2025, 'otra-huella')).toBeUndefined();
    expect(referenciaAplicable(PERFIL_MEDINA_2025, SHA256_ORIGINAL_MEDINA_2025)?.filas).toBe(889);
    expect(referenciaAplicable(PERFIL_MEDINA_2025, 'otra-huella', true)?.filas).toBe(889);
    expect(referenciaAplicable(PERFIL_MEDINA_2025, SHA256_ORIGINAL_MEDINA_2025, false)).toBeUndefined();
  });

  it('incorporación (ensayo) de un censo con otra estructura: columnas adicionales en el registro de origen, sin valores inventados', async () => {
    const v = validarInstantanea(JSON.parse(readFileSync('public/data/medina-callejero.json', 'utf8')));
    if (!v.ok) throw new Error(v.motivo);
    const db = crearBaseEspacio('ensayo', { persona: { nombre: 'Persona de Prueba', roles: ['coordinador'] }, calles: v.calles, detalleCallejero: 'OSM', espacioId: 'g1', ahora: '2026-10-25T10:00:00.000Z' });
    const c = caso('B');
    const destino = { municipioId: municipioDeEspacio('ensayo'), anio: 2024 };
    const { resultado, plan } = await prepararIncorporacion(db, await c.generar(['Calle de las Angustias', 'Calle de las Farolas']), c.archivo, destino, {});
    expect(plan.aplicable).toBe(true);
    const r = aplicarIncorporacion(db, resultado, destino, {}, plan, { porId: db.meta.espacioCreadoPorId!, ahora: '2026-10-25T11:00:00.000Z' });
    const regs = Object.values(r.db.registros);
    expect(regs).toHaveLength(60);
    expect(regs.every((x) => x.adicionales?.['SUPERFICIE M2'] !== undefined && x.datos['SUPERFICIE M2'] !== undefined)).toBe(true);
    expect(regs.every((x) => !('vacio' in (x.original ?? {})) || x.original!.vacio.t === 'texto')).toBe(true);
    expect(Object.values(r.db.locales).every((l) => !l.coord)).toBe(true);
  });
});


