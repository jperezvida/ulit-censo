import { describe, expect, it } from 'vitest';
import { C25_SINT, C26_SINT, escenarioOficina } from '../data/escenarioOficina';
import { ErrorDominio, kNC } from './db';
import { COMERCIO_2026, EXCEPCIONES_ICM, GRUPOS_2026, HOSTELERIA_2026, ID_CATALOGO_2026, SERVICIOS_2026 } from './catalogo2026';
import { ACTIVIDADES_HOJA, ID_CATALOGO_DEMO, NODOS_2026, TAXONOMIA, TAXONOMIA_POR_ID, hijosDe, nivelesDe, rutaActividad } from './taxonomy';
import { buscarClasificacion, opcionesCatalogo, resolverTexto, sugerirPorNombre, textoClasificacion } from './buscador';
import { clasificar, migrarClasificacionesCampana, partirDeClasificacionAnterior, resolverNiveles, validarSeleccion } from './clasificacion';
import { asignarCatalogos, migrarV9aV10 } from './migraciones';
import { filasExport } from './exportacion';
import type { Id } from './types';

const C = ID_CATALOGO_2026;
const primero = (q: string) => buscarClasificacion(C, q).resultados[0];
const nodoPorRuta = (...ruta: string[]) => NODOS_2026.find((n) => rutaActividad(n.id).map((x) => x.nombre).join('|') === ruta.join('|'))!;

describe('Catálogo clasificacion-2026@v1 · estructura', () => {
  it('está separado del catálogo ficticio y sus identificadores son únicos', () => {
    expect(new Set(TAXONOMIA.map((n) => n.id)).size).toBe(TAXONOMIA.length);
    expect(NODOS_2026.every((n) => n.catalogo === C && n.id.startsWith('c26.'))).toBe(true);
    expect(ACTIVIDADES_HOJA.every((n) => (n.catalogo ?? ID_CATALOGO_DEMO) === ID_CATALOGO_DEMO)).toBe(true);
    expect(hijosDe(undefined, C).map((n) => n.nombre)).toEqual(GRUPOS_2026.map((g) => g.nombre));
  });

  it('Comercio tiene cuatro niveles; Hostelería y Servicios no tienen grupo de comercio', () => {
    for (const n of NODOS_2026) {
      const r = rutaActividad(n.id);
      expect(r.map((x) => x.nivel)).toEqual(r[0].codigo === 'C' ? [1, 2, 3, 4].slice(0, r.length) : [1, 3, 4].slice(0, r.length));
    }
    // Comercio: todas sus hojas en el nivel 4
    const hojasC = NODOS_2026.filter((n) => n.id.startsWith('c26.C.') && !hijosDe(n.id).length);
    expect(hojasC.every((n) => n.nivel === 4)).toBe(true);
    // Servicios: grupo › subgrupo (sin actividades cerradas; los ejemplos se guardan como descripción)
    expect(NODOS_2026.filter((n) => n.id.startsWith('c26.S.')).every((n) => n.nivel === 3)).toBe(true);
    // Discotecas: subgrupo de Hostelería sin actividad
    expect(hijosDe(nodoPorRuta('Hostelería y Restauración', 'Discotecas').id)).toEqual([]);
  });

  it('contiene exactamente lo transcrito del documento (sin categorías inventadas)', () => {
    const subC = COMERCIO_2026.flatMap((g) => g.subgrupos);
    const esperado = 3 + COMERCIO_2026.length + subC.length + subC.reduce((s, x) => s + (x.actividades?.length ?? 0), 0)
      + HOSTELERIA_2026.length + HOSTELERIA_2026.reduce((s, x) => s + (x.actividades?.length ?? 0), 0) + SERVICIOS_2026.length;
    expect(NODOS_2026.length).toBe(esperado);
    expect(COMERCIO_2026.map((g) => g.codigo)).toEqual(['A', 'EP', 'EH', 'OE']);
    expect(SERVICIOS_2026.length).toBe(26);
  });

  it('las excepciones ICM (tabaco, ordenadores, papel pintado, alfombras, bisutería, artículos de viaje) llevan a su destino', () => {
    const casos: [string, string[]][] = [
      ['tabaco', ['Comercio', 'Otros equipamientos', 'Estancos', 'Estancos']],
      ['ordenadores', ['Comercio', 'Otros equipamientos', 'Ocio', 'Informática']],
      ['papel pintado', ['Comercio', 'Equipamiento del Hogar', 'Materiales de construcción', 'Revestimientos']],
      ['alfombras', ['Comercio', 'Equipamiento del Hogar', 'Ropa del hogar', 'Ropa del hogar']],
      ['bisutería', ['Comercio', 'Equipamiento Personal', 'Complementos', 'Accesorios']],
      ['artículos de viaje', ['Comercio', 'Equipamiento Personal', 'Complementos']],
    ];
    expect(casos.length).toBe(EXCEPCIONES_ICM.length);
    for (const [q, ruta] of casos) {
      const r = primero(q);
      expect(rutaActividad(r.nodoId).map((n) => n.nombre), q).toEqual(ruta);
      expect(TAXONOMIA_POR_ID[r.nodoId].excepcion ?? '', q).not.toBe('');
    }
    // Artículos de viaje: subgrupo sin actividad concreta → se guarda con descripción
    const viaje = buscarClasificacion(C, 'artículos de viaje').resultados.find((o) => o.tipo === 'ejemplo')!;
    expect(viaje.descripcion).toBe('Artículos de viaje de cuero o imitación de cuero');
  });
});

describe('Todas las combinaciones de niveles', () => {
  const opciones = opcionesCatalogo(C).filter((o) => o.tipo !== 'ejemplo');

  it('cada opción se copia y se vuelve a leer igual (nombre único o ruta completa)', () => {
    for (const o of opciones) {
      const desc = o.requiereDescripcion ? 'Breve descripción' : undefined;
      const t = textoClasificacion(o.nodoId, desc);
      expect(resolverTexto(C, t), t).toEqual({ nodoId: o.nodoId, descripcion: desc });
    }
  });

  it('cada combinación grupo / grupo de comercio / subgrupo / actividad se resuelve y es coherente', () => {
    const porProfundidad: Record<number, number> = {};
    for (const o of opciones) {
      const n = nivelesDe(o.nodoId);
      const desc = o.requiereDescripcion ? 'otra cosa' : undefined;
      const r = resolverNiveles(C, { grupo: n.grupo?.nombre, grupoComercio: n.grupoComercio?.nombre, subgrupo: n.subgrupo?.nombre, actividad: n.actividad?.nombre, descripcion: desc });
      expect(r.nodoId).toBe(o.nodoId);
      const p = rutaActividad(o.nodoId).length;
      porProfundidad[p] = (porProfundidad[p] ?? 0) + 1;
    }
    const subC = COMERCIO_2026.flatMap((g) => g.subgrupos);
    const actsH = HOSTELERIA_2026.reduce((s, x) => s + (x.actividades?.length ?? 0), 0);
    expect(porProfundidad).toEqual({
      // Comercio: grupo › grupo de comercio › subgrupo › actividad
      4: subC.reduce((s, x) => s + (x.actividades?.length ?? 0), 0),
      // Hostelería: grupo › subgrupo › actividad; Comercio: subgrupo con breve descripción
      3: actsH + subC.length,
      // Servicios: grupo › subgrupo (+ descripción); subgrupos de Hostelería (Discotecas, o con descripción)
      2: SERVICIOS_2026.length + HOSTELERIA_2026.length,
    });
  });

  it('rechaza combinaciones inconsistentes', () => {
    expect(() => resolverNiveles(C, { grupo: 'Hostelería y Restauración', subgrupo: 'Carnes', actividad: 'Carnicería' })).toThrow(/inconsistente/);
    expect(() => resolverNiveles(C, { grupo: 'Comercio', grupoComercio: 'Alimentación', subgrupo: 'Salud', actividad: 'Farmacias' })).toThrow(/inconsistente/);
    expect(() => resolverNiveles(C, { grupo: 'Comercio', grupoComercio: 'Otros equipamientos', subgrupo: 'Salud', actividad: 'Parafarmacia' })).toThrow(/inconsistente/);
    expect(() => resolverNiveles(C, { grupo: 'Servicios', subgrupo: 'Hoteles y hospedaje' })).toThrow(/inconsistente/);
    // Subgrupo con actividades sin descripción: no basta
    expect(() => resolverNiveles(C, { grupo: 'Comercio', grupoComercio: 'Alimentación', subgrupo: 'Carnes' })).toThrow(/breve descripción/);
    // Nombres y mayúsculas / tildes de Hoja1 se aceptan
    expect(resolverNiveles(C, { grupo: 'COMERCIO', grupoComercio: 'Otros Equipamientos', subgrupo: 'salud', actividad: 'farmacia' }).nodoId).toBe(nodoPorRuta('Comercio', 'Otros equipamientos', 'Salud', 'Farmacias').id);
  });

  it('valida la selección: grupos no, otro catálogo no, subgrupo con actividades solo con descripción', () => {
    for (const n of NODOS_2026) {
      if (n.nivel < 3) expect(() => validarSeleccion(C, n.id)).toThrow(ErrorDominio);
      else if (hijosDe(n.id).length) {
        expect(() => validarSeleccion(C, n.id)).toThrow(/breve descripción/);
        expect(() => validarSeleccion(C, n.id, 'algo distinto')).not.toThrow();
      } else expect(() => validarSeleccion(C, n.id)).not.toThrow();
    }
    expect(() => validarSeleccion(C, ACTIVIDADES_HOJA[0].id)).toThrow(/no pertenece al catálogo/);
  });
});

describe('Buscador', () => {
  it('texto parcial, sin distinguir mayúsculas ni tildes', () => {
    expect(primero('carni').etiqueta).toBe('Carnicería');
    expect(primero('CARNICERIA').etiqueta).toBe('Carnicería');
    expect(primero('panaderia').etiqueta).toBe('Panadería');
    expect(primero('opticas').etiqueta).toBe('Ópticas');
    expect(primero('fisio')).toMatchObject({ tipo: 'ejemplo', etiqueta: 'Fisioterapia', descripcion: 'Fisioterapia' });
    expect(primero('hoteles').etiqueta).toBe('Hotel');
  });

  it('palabras clave y ejemplos autorizados del documento', () => {
    expect(primero('kebab').etiqueta).toBe('Comida rápida');
    expect(primero('italiano').etiqueta).toBe('Internacional');
    expect(primero('quiosco').etiqueta).toBe('Papelería, prensa y librería');
    expect(primero('vinoteca').etiqueta).toBe('Bebidas');
    expect(primero('karaoke').ruta).toBe('Hostelería y Restauración › Bares y cafeterías › Otros');
    expect(primero('gimnasio')).toMatchObject({ tipo: 'ejemplo', ruta: expect.stringContaining('Práctica deportiva') });
    // «Parafarmacia» no es un término del catálogo: no se equipara a farmacia
    expect(buscarClasificacion(C, 'parafarmacia').resultados.every((r) => r.etiqueta !== 'Farmacias')).toBe(true);
  });

  it('cada sugerencia muestra la ruta completa y se ordena por relevancia', () => {
    const r = buscarClasificacion(C, 'calzado').resultados;
    expect(r[0]).toMatchObject({ etiqueta: 'Calzado', ruta: 'Comercio › Equipamiento Personal › Calzado › Calzado' });
    for (let i = 1; i < r.length; i++) expect(r[i - 1].puntos).toBeGreaterThanOrEqual(r[i].puntos);
    expect(r.every((x) => x.ruta.includes(' › '))).toBe(true);
  });

  it('nombres ambiguos: se marcan y obligan a elegir por la ruta', () => {
    for (const q of ['otros', 'mascotas']) {
      const { ambiguo, resultados } = buscarClasificacion(C, q);
      expect(ambiguo, q).toBe(true);
      expect(new Set(resultados.slice(0, 2).map((r) => r.ruta)).size).toBe(2);
      expect(() => resolverTexto(C, q)).toThrow(/ambiguo/);
    }
    expect(resolverTexto(C, 'Restaurantes › Otros').nodoId).toBe(nodoPorRuta('Hostelería y Restauración', 'Restaurantes', 'Otros').id);
    expect(resolverTexto(C, 'Servicios › Mascotas · Peluquería canina')).toEqual({ nodoId: nodoPorRuta('Servicios', 'Mascotas').id, descripcion: 'Peluquería canina' });
    expect(buscarClasificacion(C, 'carnicería').ambiguo).toBe(false);
  });

  it('lo reciente y lo frecuente desempatan, pero no adelantan a una coincidencia mejor', () => {
    const informatica = buscarClasificacion(C, 'informática').resultados[0];
    const usos = { [informatica.clave]: 500 };
    expect(primero('carnicería').etiqueta).toBe('Carnicería');
    expect(buscarClasificacion(C, 'carnicería', { usos, recientes: [informatica.clave] }).resultados[0].etiqueta).toBe('Carnicería');
    // Sin texto: aparecen los recientes primero
    expect(buscarClasificacion(C, '', { recientes: [informatica.clave] }).resultados[0].clave).toBe(informatica.clave);
  });

  it('textos inexistentes se rechazan sin elegir al azar', () => {
    expect(() => resolverTexto(C, 'Zapatería ortopédica lunar')).toThrow(/no está en el catálogo/);
    expect(() => resolverTexto(C, '')).toThrow();
  });
});

describe('Propuestas por el nombre del establecimiento (nunca se aplican solas)', () => {
  const propuesta = (nombre: string) => sugerirPorNombre(C, nombre).sugerencias.map((s) => s.ruta);
  it('casos del encargo', () => {
    expect(propuesta('Estanco nº 9')).toEqual(['Comercio › Otros equipamientos › Estancos › Estancos']);
    expect(propuesta('Librería El Nogal')).toEqual(['Comercio › Otros equipamientos › Ocio › Papelería, prensa y librería']);
    expect(propuesta('Hotel San Antón')).toEqual(['Hostelería y Restauración › Hoteles y hospedaje › Hotel']);
    expect(propuesta('Parafarmacia Centro')).toEqual([]);
    expect(propuesta('Bar Delia')).toEqual(['Hostelería y Restauración › Bares y cafeterías › Bar']);
  });
  it('sin coincidencia completa o con términos genéricos no se propone nada', () => {
    expect(propuesta('Gestoría Central')).toEqual([]);
    expect(propuesta('Tienda General 4')).toEqual([]);
    expect(propuesta('')).toEqual([]);
  });
});

describe('Descripción libre dentro del subgrupo', () => {
  it('se guarda con el subgrupo y no sustituye la clasificación', () => {
    const esc = escenarioOficina({ calles: 2, localesPorCalle: 4 });
    const neg = Object.values(esc.db.ocupaciones).find((o) => o.negocioId)!.negocioId!;
    const sub = nodoPorRuta('Servicios', 'Servicios médicos').id;
    const db = clasificar(esc.db, neg, C26_SINT, sub, 'p-marta', { descripcion: '  Osteopatía  ' });
    expect(db.clasificaciones[kNC(neg, C26_SINT)]).toMatchObject({ actividadId: sub, descripcion: 'Osteopatía', catalogoId: C, confirmada: true });
    expect(textoClasificacion(sub, 'Osteopatía')).toBe('Servicios médicos · Osteopatía');
    // Subgrupo de Comercio con actividades: exige descripción
    expect(() => clasificar(esc.db, neg, C26_SINT, nodoPorRuta('Comercio', 'Alimentación', 'Carnes').id, 'p-marta')).toThrow(/breve descripción/);
    // Texto libre que no es del catálogo: no se acepta como clasificación
    expect(() => resolverTexto(C, 'Osteopatía')).toThrow();
  });
});

describe('Exportación por niveles (formato sin cambios)', () => {
  it('Hostelería y Servicios no rellenan «Grupo de comercio»; sin actividad se exporta la descripción', () => {
    const esc = escenarioOficina({ calles: 2, localesPorCalle: 4 });
    const [a, b] = Object.values(esc.db.ocupaciones).filter((o) => o.negocioId).map((o) => o.negocioId!);
    let db = clasificar(esc.db, a, C26_SINT, nodoPorRuta('Hostelería y Restauración', 'Hoteles y hospedaje', 'Hostal').id, 'p-marta');
    db = clasificar(db, b, C26_SINT, nodoPorRuta('Servicios', 'Servicios médicos').id, 'p-marta', { descripcion: 'Fisioterapia' });
    const filas = filasExport(db, C26_SINT);
    expect(filas.find((f) => f.Nombre === db.negocios[a].nombre)).toMatchObject({ 'Grupo de actividad': 'Hostelería y Restauración', 'Grupo de comercio': '', 'Subgrupo de actividad': 'Hoteles y hospedaje', Actividad: 'Hostal' });
    expect(filas.find((f) => f.Nombre === db.negocios[b].nombre)).toMatchObject({ 'Grupo de actividad': 'Servicios', 'Grupo de comercio': '', 'Subgrupo de actividad': 'Servicios médicos', Actividad: 'Fisioterapia' });
  });
});

describe('Histórico y migración', () => {
  /** Escenario con una campaña 2026 «antigua» (sin catálogo) y clasificaciones del catálogo ficticio confirmadas. */
  function antiguo() {
    const esc = escenarioOficina({ calles: 3, localesPorCalle: 6 });
    const db = structuredClone(esc.db);
    delete db.campanas[C26_SINT].catalogoId;
    const negocios = Object.values(db.clasificaciones).filter((c) => c.campanaId === C25_SINT).map((c) => c.negocioId);
    for (const n of negocios) {
      const ant = db.clasificaciones[kNC(n, C25_SINT)];
      db.clasificaciones[kNC(n, C26_SINT)] = { ...ant, campanaId: C26_SINT, origen: 'manual', confirmada: true, porId: 'p-marta', fecha: '2026-09-01' };
    }
    return { db, negocios };
  }

  it('2025 no cambia; 2026 pasa a propuestas sin confirmar con traza; es idempotente', () => {
    const { db, negocios } = antiguo();
    const antes2025 = JSON.stringify(Object.values(db.clasificaciones).filter((c) => c.campanaId === C25_SINT));
    const { db: d1, informes } = migrarV9aV10({ ...db, version: 9 });
    expect(d1.version).toBe(10);
    expect(d1.campanas[C26_SINT].catalogoId).toBe(C);
    expect(d1.campanas[C25_SINT].catalogoId).toBeUndefined();
    expect(JSON.stringify(Object.values(d1.clasificaciones).filter((c) => c.campanaId === C25_SINT))).toBe(antes2025);
    const inf = informes[0];
    expect(inf.revisadas).toBe(negocios.length);
    expect(inf.propuestas.length + inf.sinEquivalencia.length).toBe(negocios.length);
    for (const n of negocios) {
      const c = d1.clasificaciones[kNC(n, C26_SINT)];
      if (c.catalogoId === C) {
        // Ninguna confirmada se reasigna en silencio
        expect(c).toMatchObject({ origen: 'migrado', confirmada: false });
        expect(c.migracion).toMatchObject({ desdeActividadId: db.clasificaciones[kNC(n, C26_SINT)].actividadId, desdeCatalogo: ID_CATALOGO_DEMO, estabaConfirmada: true });
        expect(TAXONOMIA_POR_ID[c.actividadId].catalogo).toBe(C);
      } else {
        // Sin equivalente: queda tal cual (y Oficina lo señala)
        expect(c).toEqual(db.clasificaciones[kNC(n, C26_SINT)]);
      }
    }
    // Segunda ejecución: nada cambia
    const d2 = asignarCatalogos(d1).db;
    expect(migrarClasificacionesCampana(d2, C26_SINT).informe.propuestas).toEqual([]);
    expect(d2.clasificaciones).toEqual(d1.clasificaciones);
  });

  it('las campañas con catálogo ya asignado no se vuelven a migrar', () => {
    const esc = escenarioOficina({ calles: 2, localesPorCalle: 4 });
    expect(asignarCatalogos(esc.db).informes).toEqual([]);
  });

  it('«Partir de 2025» propone el equivalente sin confirmar y sin tocar 2025', () => {
    const esc = escenarioOficina({ calles: 3, localesPorCalle: 6 });
    const conEquiv = Object.values(esc.db.clasificaciones).find((c) => c.campanaId === C25_SINT && opcionesCatalogo(C).some((o) => o.tipo === 'actividad' && o.etiqueta === TAXONOMIA_POR_ID[c.actividadId].nombre));
    if (!conEquiv) return;
    const db = partirDeClasificacionAnterior(esc.db, conEquiv.negocioId, C26_SINT, 'p-marta');
    expect(db.clasificaciones[kNC(conEquiv.negocioId, C25_SINT)]).toEqual(conEquiv);
    expect(db.clasificaciones[kNC(conEquiv.negocioId, C26_SINT)]).toMatchObject({ origen: 'heredado', confirmada: false, catalogoId: C });
  });
});

describe('Rendimiento', () => {
  it('miles de filas: buscar y resolver en tiempos de uso interactivo', () => {
    const textos = opcionesCatalogo(C).filter((o) => o.tipo !== 'ejemplo').map((o) => textoClasificacion(o.nodoId, o.requiereDescripcion ? 'x' : undefined));
    const filas: string[] = Array.from({ length: 5000 }, (_, i) => textos[i % textos.length]);
    let t = performance.now();
    const ids: Id[] = filas.map((f) => resolverTexto(C, f).nodoId);
    const resolver = performance.now() - t;
    expect(ids.length).toBe(5000);
    const consultas = ['car', 'pelu', 'hotel', 'otros', 'bisuteria', 'informat', 'gim', 'ropa', 'farm', 'bar'];
    t = performance.now();
    for (let i = 0; i < 1000; i++) buscarClasificacion(C, consultas[i % consultas.length]);
    const buscar = (performance.now() - t) / 1000;
    expect(buscar).toBeLessThan(15); // ms por pulsación
    expect(resolver).toBeLessThan(10000);
  });
});

describe('Informe verificable del catálogo', () => {
  it('docs/fase2/CATALOGO-2026.md coincide con el catálogo (regenerar con scripts/informe-catalogo-2026.ts)', async () => {
    const { readFileSync } = await import('node:fs');
    const { informeCatalogo2026 } = await import('./informeCatalogo');
    const doc = readFileSync(`${process.cwd()}/docs/fase2/CATALOGO-2026.md`, 'utf8');
    expect(doc).toBe(informeCatalogo2026());
    for (const d of ['D01', 'D14']) expect(doc).toContain(`| ${d} |`);
    for (const n of NODOS_2026.filter((x) => x.nivel > 1)) expect(doc).toContain(`\`${n.id}\``);
  });
});
