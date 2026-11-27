import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analizarPagina, esEnlaceFichaGoogle } from './radarAnalisisWeb';
import { CLAVE_RADAR, type NegocioPiloto } from './radarDigitalIT1';
import {
  bandejaDe, campoDeEnlace, causaFallo, confirmarRelacionadas, csvRadar, dominiosProbables, emparejarOSM,
  evidenciasPagina, fusionarTrabajos, guardarResultadosAuto, guardarTrabajos, huellaNegocio,
  investigarNegocio, leerResultadosAuto, leerTrabajos, lugaresDesdeEtiquetas, marcaDesdeWikidata,
  mencionesEnTexto, nivelEvidencia, nombresEquivalentes, perfilDesdeValor, resultadoVigente,
  trabajoVacio, vistaCampo, webSegura, type EvidenciaRadar, type LugarOSM, type ServiciosRadar,
} from './radarInvestigacion';

const MUNICIPIO = 'Medina del Campo';
const negocio = (p: Partial<NegocioPiloto> = {}): NegocioPiloto => ({
  id: 'r1', nombre: 'Óptica Visión Clara', direccion: 'Calle de Padilla', numero: '12', fila: 2,
  datosExcel: { web: '', ventaOnline: '', googleBusiness: '', instagram: '', facebook: '', twitter: '' }, ...p,
});
const overpass = {
  elements: [
    { type: 'node', id: 1, tags: { name: 'Óptica Visión Clara', 'addr:street': 'Calle Padilla', 'addr:housenumber': '12',
      website: 'http://www.opticavisionclara.es', 'contact:instagram': '@opticavisionclara', shop: 'optician' } },
    { type: 'node', id: 2, tags: { name: 'Visión Clara', 'addr:street': 'Plaza Mayor', shop: 'optician',
      'contact:facebook': 'https://www.facebook.com/sharer/sharer.php?u=x' } },
    { type: 'way', id: 3, tags: { name: 'Bar Central', amenity: 'bar' } },
    { type: 'node', id: 4, tags: { name: 'Calzados Ficticios', brand: 'Calzados Ficticios', 'brand:wikidata': 'Q999',
      'addr:street': 'Calle Gamazo', website: 'javascript:alert(1)' } },
    { type: 'node', id: 5, tags: { shop: 'bakery' } },
  ],
};
beforeEach(() => localStorage.clear());

describe('Radar · coincidencias comprensibles', () => {
  it('compara nombres sin tildes ni palabras vacías: el corto debe estar contenido en el largo', () => {
    expect(nombresEquivalentes('Talleres García', 'Talleres Hermanos García S.L.')).toBe(true);
    expect(nombresEquivalentes('Bar Central', 'Cafetería Central')).toBe(false);
    expect(nombresEquivalentes('Óptica Visión', 'OPTICA VISION')).toBe(true);
    expect(nombresEquivalentes('', 'Algo')).toBe(false);
  });
  it('detecta nombre, calle y municipio en el texto de una web', () => {
    const ctx = { nombre: 'Óptica Visión Clara', calle: 'Calle de Padilla', municipio: MUNICIPIO };
    expect(mencionesEnTexto('Óptica Visión Clara · C/ Padilla 12, 47400 Medina del Campo', ctx)).toEqual(['nombre', 'calle', 'municipio']);
    expect(mencionesEnTexto('Óptica Visión Clara en Madrid', ctx)).toEqual(['nombre']);
    expect(mencionesEnTexto('Medina de Rioseco', ctx)).toEqual([]);
  });
  it('nivel: relacionado = nombre + (calle o municipio); marcas y venta online siempre a comprobar', () => {
    const e = (campo: EvidenciaRadar['campo'], criterios: EvidenciaRadar['criterios']): EvidenciaRadar =>
      ({ campo, url: 'https://a.es/', procedencias: [{ fuente: 'web', origen: 'https://a.es/' }], criterios });
    expect(nivelEvidencia(e('web', ['nombre', 'municipio']))).toBe('relacionado');
    expect(nivelEvidencia(e('web', ['osm', 'nombre', 'calle']))).toBe('relacionado');
    expect(nivelEvidencia(e('web', ['osm', 'nombre']))).toBe('encontrado');
    expect(nivelEvidencia(e('web', ['calle', 'municipio']))).toBe('encontrado');
    expect(nivelEvidencia(e('instagram', ['marca']))).toBe('encontrado');
    expect(nivelEvidencia(e('ventaOnline', ['tienda', 'nombre', 'municipio']))).toBe('encontrado');
  });
});

describe('Radar · fuentes públicas gratuitas', () => {
  it('OpenStreetMap: compacta, valida y descarta enlaces inseguros o de compartir', () => {
    const lugares = lugaresDesdeEtiquetas(overpass);
    expect(lugares).toHaveLength(4);
    expect(lugares[0]).toMatchObject({ id: 'node/1', web: 'https://www.opticavisionclara.es/',
      instagram: 'https://www.instagram.com/opticavisionclara' });
    expect(lugares[1].facebook).toBeUndefined();
    expect(lugares[3]).toMatchObject({ marcaWd: 'Q999' });
    expect(lugares[3].web).toBeUndefined();
    expect(lugaresDesdeEtiquetas({ nada: 1 })).toEqual([]);
  });
  it('empareja por nombre y prioriza la misma calle y número', () => {
    const r = emparejarOSM(negocio(), lugaresDesdeEtiquetas(overpass));
    expect(r.map((c) => c.lugar.id)).toEqual(['node/1', 'node/2']);
    expect(r[0].criterios).toEqual(['osm', 'nombre', 'calle', 'numero']);
    expect(r[1].criterios).toEqual(['osm', 'nombre']);
  });
  it('Wikidata: web y redes oficiales de la marca, saneadas', () => {
    const m = marcaDesdeWikidata('Q999', { claims: {
      P856: [{ mainsnak: { datavalue: { value: 'https://www.calzados-ficticios.com' } } }],
      P2003: [{ mainsnak: { datavalue: { value: 'calzadosficticios' } } }],
      P2002: [{ mainsnak: { datavalue: { value: 'javascript:alert(1)' } } }],
    } });
    expect(m).toEqual({ id: 'Q999', web: 'https://www.calzados-ficticios.com/', instagram: 'https://www.instagram.com/calzadosficticios' });
    expect(marcaDesdeWikidata('X1', {})).toBeNull();
  });
  it('valores de perfil y web: acepta usuarios y URL, rechaza IP, credenciales y puertos', () => {
    expect(perfilDesdeValor('twitter', '@tienda_x')).toBe('https://x.com/tienda_x');
    expect(perfilDesdeValor('instagram', 'tienda con espacios')).toBeNull();
    expect(webSegura('www.ejemplo.es')).toBe('https://www.ejemplo.es/');
    for (const v of ['https://127.0.0.1/', 'https://u:p@ejemplo.es/', 'https://ejemplo.es:8443/', 'ftp://ejemplo.es'])
      expect(webSegura(v)).toBeNull();
  });
  it('dominios probables solo con nombres razonables', () => {
    expect(dominiosProbables('Óptica Visión')).toEqual(['https://www.opticavision.es/', 'https://www.opticavision.com/']);
    expect(dominiosProbables('Bar')).toEqual([]);
  });
});

describe('Radar · análisis de una web pública', () => {
  const html = `<html><head><title>Óptica Visión Clara | Medina del Campo</title>
    <script type="application/ld+json">{"@type":"Optician","address":{"streetAddress":"Calle Padilla 12"},
      "sameAs":["https:\\/\\/www.facebook.com\\/opticavisionclara"]}</script>
    <script>var nota="Calle Inventada";</script></head><body>
    <a href="https://www.instagram.com/opticavisionclara/">IG</a>
    <a href="https://twitter.com/intent/tweet?url=x">Compartir</a>
    <a href="https://maps.app.goo.gl/AbCdEf123">Cómo llegar</a>
    <iframe src="https://www.google.com/maps/embed?pb=1"></iframe>
    <div class="woocommerce"></div><a href="/carrito/">Carrito</a></body></html>`;
  it('extrae redes, ficha de Google, indicios de tienda y menciones; ignora compartir e incrustados', () => {
    const p = analizarPagina(html, 'https://www.opticavisionclara.es/',
      { nombre: 'Óptica Visión Clara', calle: 'Calle Padilla', municipio: MUNICIPIO }, 'https://opticavisionclara.es/');
    expect(p.redes).toEqual({ instagram: 'https://www.instagram.com/opticavisionclara/', facebook: 'https://www.facebook.com/opticavisionclara' });
    expect(p.fichaGoogle).toBe('https://maps.app.goo.gl/AbCdEf123');
    expect(p.indiciosVenta).toEqual(['Tecnología de tienda (WooCommerce)', 'Enlace a carrito o pago']);
    expect(p.menciones).toEqual(['nombre', 'calle', 'municipio']);
    expect(p.solicitada).toBe('https://opticavisionclara.es/');
  });
  it('reconoce fichas de Google, no mapas incrustados ni búsquedas genéricas', () => {
    expect(esEnlaceFichaGoogle(new URL('https://www.google.com/maps/place/Optica/@41,-4'))).toBe(true);
    expect(esEnlaceFichaGoogle(new URL('https://www.google.es/maps?cid=123'))).toBe(true);
    expect(esEnlaceFichaGoogle(new URL('https://www.google.com/maps/embed?pb=1'))).toBe(false);
    expect(esEnlaceFichaGoogle(new URL('https://www.google.com/search?q=optica'))).toBe(false);
  });
  it('lo enlazado desde la web hereda su relación y la tienda queda siempre por comprobar', () => {
    const p = analizarPagina(html, 'https://www.opticavisionclara.es/', { nombre: 'Óptica Visión Clara', calle: 'Calle Padilla', municipio: MUNICIPIO });
    const ev = evidenciasPagina(p, 'web');
    const de = (c: string) => ev.find((e) => e.campo === c)!;
    expect(nivelEvidencia(de('web'))).toBe('relacionado');
    expect(nivelEvidencia(de('instagram'))).toBe('relacionado');
    expect(de('instagram').criterios).toContain('enlazado');
    expect(nivelEvidencia(de('googleBusiness'))).toBe('relacionado');
    expect(nivelEvidencia(de('ventaOnline'))).toBe('encontrado');
    expect(de('ventaOnline').detalle).toContain('carrito');
  });
});

describe('Radar · investigación automática de un negocio', () => {
  const pagina = (url: string, menciones: string[], extra = {}) => ({
    url, solicitada: url, menciones, redes: {}, indiciosVenta: [], ...extra,
  }) as never;
  it('usa la web de OpenStreetMap, une procedencias y no deduce dominios si ya hay web declarada', async () => {
    const paginas = vi.fn<ServiciosRadar['paginas']>(async (urls) => ({
      paginas: [pagina(urls[0], ['nombre', 'municipio'], { redes: { facebook: 'https://www.facebook.com/opticavisionclara' } })],
      fallos: [],
    }));
    const r = await investigarNegocio(negocio(), MUNICIPIO, lugaresDesdeEtiquetas(overpass), new Map(), { paginas });
    expect(paginas).toHaveBeenCalledWith(['https://www.opticavisionclara.es/'], expect.objectContaining({ municipio: MUNICIPIO }));
    const web = r.evidencias.find((e) => e.campo === 'web')!;
    expect(web.procedencias.map((p) => p.fuente)).toEqual(['osm', 'web']);
    expect(web.criterios).toEqual(['nombre', 'calle', 'numero', 'municipio', 'osm']);
    expect(r.evidencias.find((e) => e.campo === 'instagram')?.url).toBe('https://www.instagram.com/opticavisionclara');
    expect(r.evidencias.find((e) => e.campo === 'facebook')?.criterios).toContain('enlazado');
    expect(r.huella).toBe(huellaNegocio(negocio()));
  });
  it('un dominio deducido sin el nombre del negocio se descarta y sus fallos no son avisos', async () => {
    const n = negocio({ nombre: 'Zapatería Inventada', direccion: 'Calle Real' });
    const paginas = vi.fn<ServiciosRadar['paginas']>(async (urls) => ({
      paginas: [pagina(urls[0], ['municipio'])],
      fallos: [{ url: urls[1], error: 'No se puede comprobar una dirección de red pública segura.' }],
    }));
    const r = await investigarNegocio(n, MUNICIPIO, [], new Map(), { paginas });
    expect(paginas.mock.calls[0][0]).toEqual(['https://www.zapateriainventada.es/', 'https://www.zapateriainventada.com/']);
    expect(r.evidencias).toEqual([]);
    expect(r.avisos).toEqual([]);
  });
  it('un dominio deducido con el nombre pero sin calle ni municipio (homónimo de otra localidad) se descarta', async () => {
    const n = negocio({ nombre: 'Farmacia Ficticia Puente', direccion: 'Calle Real' });
    const r = await investigarNegocio(n, MUNICIPIO, [], new Map(), {
      paginas: async (urls) => ({ paginas: [pagina(urls[0], ['nombre']), pagina(urls[1], ['nombre', 'municipio'])], fallos: [] }),
    });
    expect(r.evidencias.map((e) => e.url)).toEqual(['https://www.farmaciaficticiapuente.com/']);
    expect(nivelEvidencia(r.evidencias[0])).toBe('relacionado');
  });
    it('las cuentas de una cadena (Wikidata) se proponen como «marca», nunca como relacionadas', async () => {
    const n = negocio({ nombre: 'Calzados Ficticios', direccion: 'Calle Gamazo' });
    const m = new Map([['Q999', { id: 'Q999', instagram: 'https://www.instagram.com/calzadosficticios' }]]);
    const r = await investigarNegocio(n, MUNICIPIO, lugaresDesdeEtiquetas(overpass), m, {
      paginas: async () => ({ paginas: [], fallos: [] }),
    });
    const ig = r.evidencias.find((e) => e.campo === 'instagram')!;
    expect(ig.procedencias[0]).toEqual({ fuente: 'wikidata', origen: 'https://www.wikidata.org/wiki/Q999' });
    expect(nivelEvidencia(ig)).toBe('encontrado');
  });
  it('los resultados caducan si cambia el negocio o pasan 30 días', () => {
    const r = { huella: huellaNegocio(negocio()), fecha: '2026-11-01T00:00:00Z', evidencias: [], avisos: [] };
    expect(resultadoVigente(r, negocio(), Date.parse('2026-11-20'))).toBe(true);
    expect(resultadoVigente(r, negocio(), Date.parse('2026-12-20'))).toBe(false);
    expect(resultadoVigente(r, negocio({ nombre: 'Otro' }), Date.parse('2026-11-20'))).toBe(false);
  });
});

describe('Radar · estados, bandeja y decisiones humanas', () => {
  const ev = (campo: EvidenciaRadar['campo'], url: string, criterios: EvidenciaRadar['criterios']): EvidenciaRadar =>
    ({ campo, url, criterios, procedencias: [{ fuente: 'osm', origen: 'https://www.openstreetmap.org/node/1' }] });
  const resultado = (evidencias: EvidenciaRadar[]) => ({ huella: '', fecha: new Date().toISOString(), evidencias, avisos: [] });
  it('distingue relacionado, encontrado, confirmado, descartado y pendiente', () => {
    const evs = [ev('web', 'https://a.es/', ['osm', 'nombre', 'calle']), ev('instagram', 'https://www.instagram.com/a', ['osm', 'nombre'])];
    const t = trabajoVacio();
    expect(vistaCampo('web', evs, t).estado).toBe('relacionado');
    expect(vistaCampo('instagram', evs, t).estado).toBe('encontrado');
    expect(vistaCampo('twitter', evs, t).estado).toBe('pendiente');
    t.descartadas.push('instagram|https://www.instagram.com/a');
    expect(vistaCampo('instagram', evs, t).estado).toBe('descartado');
    t.decisiones.twitter = { valor: 'no', fecha: '' };
    expect(vistaCampo('twitter', evs, t).estado).toBe('confirmado');
  });
  it('Enter confirma SOLO lo relacionado; nunca convierte ausencia en «No»', () => {
    const r = resultado([ev('web', 'https://a.es/', ['osm', 'nombre', 'calle']), ev('instagram', 'https://www.instagram.com/a', ['osm', 'nombre'])]);
    const d = confirmarRelacionadas(r, trabajoVacio(), 'f');
    expect(d).toEqual({ web: { valor: 'si', url: 'https://a.es/', fecha: 'f' } });
  });
  it('bandeja: intervención por coincidencias débiles o discrepancias con el Excel', () => {
    const t = trabajoVacio();
    const n = negocio();
    expect(bandejaDe(n, undefined, t)).toBe('sin-investigar');
    expect(bandejaDe(n, resultado([]), t)).toBe('sin-evidencias');
    expect(bandejaDe(n, resultado([ev('web', 'https://a.es/', ['osm', 'nombre', 'calle'])]), t)).toBe('listo');
    expect(bandejaDe(n, resultado([ev('web', 'https://a.es/', ['osm', 'nombre'])]), t)).toBe('intervencion');
    const conExcelNo = negocio({ datosExcel: { ...n.datosExcel, web: '0' } });
    expect(bandejaDe(conExcelNo, resultado([ev('web', 'https://a.es/', ['osm', 'nombre', 'calle'])]), t)).toBe('intervencion');
    expect(bandejaDe(n, resultado([]), { ...t, estado: 'revisado' })).toBe('revisado');
  });
  it('un enlace pegado se asigna solo al campo que le corresponde', () => {
    expect(campoDeEnlace('https://www.instagram.com/tienda/')).toEqual({ campo: 'instagram', url: 'https://www.instagram.com/tienda' });
    expect(campoDeEnlace('https://x.com/tienda')).toEqual({ campo: 'twitter', url: 'https://x.com/tienda' });
    expect(campoDeEnlace('https://maps.app.goo.gl/XyZ')?.campo).toBe('googleBusiness');
    expect(campoDeEnlace('https://www.google.com/maps/place/Tienda')?.campo).toBe('googleBusiness');
    expect(campoDeEnlace('https://www.tienda.es/contacto')).toEqual({ campo: 'web', url: 'https://www.tienda.es/contacto' });
    expect(campoDeEnlace('https://www.google.com/search?q=tienda')).toBeNull();
    expect(campoDeEnlace('https://www.instagram.com/p/123')).toBeNull();
    expect(campoDeEnlace('javascript:alert(1)')).toBeNull();
    expect(campoDeEnlace('texto suelto')).toBeNull();
  });
});

describe('Radar · conservación de borradores', () => {
  it('migra el piloto anterior: lo validado pasa a decisión y lo aportado queda pendiente', () => {
    localStorage.setItem(CLAVE_RADAR + ':c26', JSON.stringify({ r1: {
      sitioWeb: 'https://comercio.es/', webValidada: true,
      hallazgo: { urlFinal: 'https://comercio.es/', redes: { instagram: 'https://www.instagram.com/comercio/' }, indiciosVenta: [] },
      perfilesManuales: { facebook: 'https://www.facebook.com/comercio' },
      redesValidadas: { instagram: true }, ventaOnline: 'no', estado: 'revisado', actualizado: '2026-11-25T12:00:00.000Z',
    } }));
    const t = leerTrabajos('c26').r1;
    expect(t.decisiones).toMatchObject({
      web: { valor: 'si', url: 'https://comercio.es/' },
      instagram: { valor: 'si', url: 'https://www.instagram.com/comercio' },
      ventaOnline: { valor: 'no' },
    });
    expect(t.manuales.facebook).toBe('https://www.facebook.com/comercio');
    expect(t.estado).toBe('revisado');
    // El borrador anterior no se borra.
    expect(localStorage.getItem(CLAVE_RADAR + ':c26')).not.toBeNull();
  });
  it('guarda, revalida al leer y descarta valores manipulados', () => {
    guardarTrabajos('c26', { r1: { ...trabajoVacio(), decisiones: {
      web: { valor: 'si', url: 'javascript:alert(1)', fecha: '' },
      instagram: { valor: 'si', url: 'https://www.instagram.com/ok', fecha: '' },
      twitter: { valor: 'quizas' as never, fecha: '' },
    } } });
    expect(leerTrabajos('c26').r1.decisiones).toEqual({ instagram: { valor: 'si', url: 'https://www.instagram.com/ok', fecha: '' } });
    guardarResultadosAuto('c26', { r1: { huella: 'h', fecha: '2026-11-25T00:00:00Z', avisos: [], evidencias: [
      { campo: 'web', url: 'https://ok.es/', criterios: ['nombre', 'inventado' as never], procedencias: [{ fuente: 'osm', origen: 'https://www.openstreetmap.org/node/1' }] },
      { campo: 'web', url: 'https://malo.es/', criterios: [], procedencias: [{ fuente: 'osm', origen: 'javascript:x' }] },
    ] } });
    const r = leerResultadosAuto('c26').r1;
    expect(r.evidencias).toHaveLength(1);
    expect(r.evidencias[0].criterios).toEqual(['nombre']);
  });
  it('al importar una copia prevalece, por negocio, el trabajo más reciente', () => {
    const viejo = { ...trabajoVacio(), actualizado: '2026-11-01T00:00:00Z' };
    const nuevo = { ...trabajoVacio(), estado: 'revisado' as const, actualizado: '2026-11-20T00:00:00Z' };
    expect(fusionarTrabajos({ a: nuevo, b: viejo }, { a: viejo, b: nuevo, c: viejo })).toEqual({ a: nuevo, b: nuevo, c: viejo });
  });
  it('CSV con valor del Excel, decisión y evidencia; neutraliza fórmulas', () => {
    const n = negocio({ nombre: '=HYPERLINK("x")', datosExcel: { web: '1', ventaOnline: '', googleBusiness: '0', instagram: '', facebook: '', twitter: '' } });
    const csv = csvRadar([n], { r1: { ...trabajoVacio(), decisiones: { web: { valor: 'si', url: 'https://a.es/', fecha: '' }, googleBusiness: { valor: 'no', fecha: '' } } } });
    const [cab, fila] = csv.replace('﻿', '').split('\r\n');
    expect(cab).toContain('Web oficial · Excel;Web oficial · Radar;Web oficial · Evidencia');
    expect(fila).toContain(`"'=HYPERLINK(""x"")"`);
    expect(fila).toContain('Sí;Sí;https://a.es/');
    expect(fila).toContain('No;No;');
    expect(fila).toContain('Sin comprobar');
  });
});

describe('Radar · OpenStreetMap vía Nominatim', () => {
  it('espacia las consultas al menos 1,1 s (política de uso), sin retrasar la primera', async () => {
    const { turnosEspaciados, RITMO_RADAR } = await import('./radarInvestigacion');
    expect(RITMO_RADAR.nominatimMs).toBeGreaterThanOrEqual(1000);
    vi.useFakeTimers();
    const turno = turnosEspaciados(1100);
    const hechos: number[] = [];
    for (let i = 0; i < 3; i++) void turno().then(() => hechos.push(Date.now()));
    await vi.advanceTimersByTimeAsync(0);
    expect(hechos).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1099);
    expect(hechos).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(hechos).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1100);
    expect(hechos).toHaveLength(3);
    vi.useRealTimers();
  });
  it('convierte resultados de Nominatim (forma real) y descarta los de otros municipios', async () => {
    const { lugaresDesdeNominatim } = await import('./radarInvestigacion');
    const lugares = lugaresDesdeNominatim([
      { osm_type: 'node', osm_id: 11, name: 'Supermercado Ficticio', address: { road: 'Calle de José Zorrilla', house_number: '7', town: 'Medina del Campo' },
        extratags: { website: 'https://www.super-ficticio.es', brand: 'Super Ficticio', 'brand:wikidata': 'Q999' } },
      { osm_type: 'way', osm_id: 12, name: 'Supermercado Ficticio', address: { road: 'Calle Mayor', city: 'Valladolid' }, extratags: {} },
      { osm_type: 'node', osm_id: 13, name: 'Sin municipio', address: {} },
    ], MUNICIPIO);
    expect(lugares).toEqual([{ id: 'node/11', nombre: 'Supermercado Ficticio', marca: 'Super Ficticio', marcaWd: 'Q999',
      calle: 'Calle de José Zorrilla', numero: '7', web: 'https://www.super-ficticio.es/' }]);
    expect(lugaresDesdeNominatim({ error: 'x' }, MUNICIPIO)).toEqual([]);
  });
});

describe('Radar · HTML hostil', () => {
  it('extrae el texto visible en tiempo lineal aunque haya miles de etiquetas sin cerrar', async () => {
    const { textoVisible } = await import('./radarAnalisisWeb');
    const hostil = '<script>'.repeat(30_000) + 'fin';
    const t0 = performance.now();
    textoVisible(hostil);
    analizarPagina('"sameAs":['.repeat(20_000), 'https://a.es/', { nombre: 'A', calle: '', municipio: MUNICIPIO });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(textoVisible('<p>Hola</p><script>oculto()</script><script type="application/ld+json">{"name":"Visible"}</script><style>x{}</style>'))
      .toMatch(/Hola\s+\{"name":"Visible"\}/);
    expect(textoVisible('<p>Hola</p><script>oculto()</script>')).not.toContain('oculto');
  });
});

describe('Radar · revisión técnica: cadenas, homónimos y fuentes caídas', () => {
  const pagina = (url: string, menciones: string[], extra = {}) => ({
    url, solicitada: url, menciones, redes: {}, indiciosVenta: [], ...extra,
  }) as never;
  const lugarCadena: LugarOSM = { id: 'node/7', nombre: 'Moda Ficticia', marca: 'Moda Ficticia', calle: 'Calle Gamazo', numero: '3',
    web: 'https://www.modaficticia.com/', instagram: 'https://www.instagram.com/modaficticia' };
  const n = negocio({ nombre: 'Moda Ficticia', direccion: 'Calle Gamazo', numero: '3' });

  it('una página de cadena que solo menciona el municipio (localizador) y sus redes son de la marca', async () => {
    const r = await investigarNegocio(n, MUNICIPIO, [lugarCadena], new Map(), {
      paginas: async (urls) => ({ paginas: [pagina(urls[0], ['nombre', 'municipio'], {
        redes: { facebook: 'https://www.facebook.com/modaficticia' }, fichaGoogle: 'https://maps.app.goo.gl/Corporativa' })], fallos: [] }),
    });
    for (const campo of ['web', 'instagram', 'facebook', 'googleBusiness'] as const) {
      const e = r.evidencias.find((x) => x.campo === campo)!;
      expect(e.criterios).toContain('marca');
      expect(nivelEvidencia(e)).toBe('encontrado');
    }
    expect(confirmarRelacionadas(r, trabajoVacio(), 'f')).toEqual({});
  });
  it('si la página de la cadena es la del local (menciona su calle), la web sí puede ser relacionada', async () => {
    const r = await investigarNegocio({ ...n, cadena: true }, MUNICIPIO, [], new Map(), {
      paginas: async (urls) => ({ paginas: [pagina(urls[0], ['nombre', 'calle', 'municipio'])], fallos: [] }),
    }, 'https://www.modaficticia.com/tiendas/medina');
    expect(nivelEvidencia(r.evidencias.find((x) => x.campo === 'web')!)).toBe('relacionado');
  });
  it('la franquicia marcada en el Excel o en la revisión de franquicias también activa la protección', async () => {
    const r = await investigarNegocio({ ...n, cadena: true }, MUNICIPIO, [], new Map(), {
      paginas: async (urls) => ({ paginas: [pagina(urls[0], ['nombre', 'municipio'])], fallos: [] }),
    }, 'https://www.modaficticia.com/');
    expect(r.evidencias[0].criterios).toContain('marca');
  });
  it('homónimo en la misma calle con otro número de portal: nunca se propone como relacionado', () => {
    const c = emparejarOSM(negocio({ nombre: 'Moda Ficticia', direccion: 'Calle Gamazo', numero: '21' }), [lugarCadena]);
    expect(c[0].criterios).toContain('otro-numero');
    expect(nivelEvidencia({ campo: 'web', url: 'https://a.es/', procedencias: [{ fuente: 'osm', origen: 'https://a.es/' }], criterios: c[0].criterios })).toBe('encontrado');
    // El que coincide en número va primero.
    const dos = emparejarOSM(negocio({ nombre: 'Moda Ficticia', direccion: 'Calle Gamazo', numero: '21' }),
      [lugarCadena, { ...lugarCadena, id: 'node/8', numero: '21' }]);
    expect(dos[0].lugar.id).toBe('node/8');
  });
  it('si fallan las fuentes, se conserva lo obtenido y queda «incompleta» (nunca «sin evidencias»)', async () => {
    const r = await investigarNegocio(negocio(), MUNICIPIO, lugaresDesdeEtiquetas(overpass), new Map(), {
      paginas: async () => { throw Error('caída'); },
    }, undefined, ['Wikidata']);
    expect(r.evidencias.find((e) => e.campo === 'instagram')).toBeDefined();
    expect(r.incompleto).toEqual(['Wikidata', 'Web declarada']);
    expect(resultadoVigente(r, negocio())).toBe(false);
    const vacio = { ...r, evidencias: [] };
    expect(bandejaDe(negocio(), vacio, trabajoVacio())).toBe('incompleta');
    expect(bandejaDe(negocio(), { ...vacio, incompleto: undefined }, trabajoVacio())).toBe('sin-evidencias');
  });
  it('medición: correctas (aceptadas tal cual), incorrectas (descartadas o sustituidas) y sin revisar', async () => {
    const { medirPiloto } = await import('./radarInvestigacion');
    const ev = (campo: EvidenciaRadar['campo'], url: string): EvidenciaRadar =>
      ({ campo, url, criterios: ['nombre', 'municipio'], procedencias: [{ fuente: 'web', origen: url }] });
    const r = { huella: '', fecha: '2026-11-25T00:00:00Z', avisos: [], evidencias: [
      ev('web', 'https://a.es/'), ev('instagram', 'https://www.instagram.com/a'), ev('facebook', 'https://www.facebook.com/a'), ev('twitter', 'https://x.com/a')] };
    const t = { ...trabajoVacio(), descartadas: ['instagram|https://www.instagram.com/a'], decisiones: {
      web: { valor: 'si' as const, url: 'https://a.es/', fecha: '' },
      facebook: { valor: 'si' as const, url: 'https://www.facebook.com/otra', fecha: '', manual: true } } };
    expect(medirPiloto([{ r, t }, { t: trabajoVacio() }])).toEqual({
      campos: 12, conPropuesta: 4, relacionadas: 4, correctas: 1, incorrectas: 2, sinRevisar: 1, negociosIncompletos: 0 });
  });
});

describe('Radar: diagnóstico de los fallos del servidor',()=>{
  it('no atribuye a OpenStreetMap los errores 500 internos de Vercel',()=>{
    const e=Object.assign(new Error('El servicio del Radar no respondió.'),{status:500});
    expect(causaFallo(e)).toContain('servidor del Radar (500)');
    expect(causaFallo(e)).toContain('no de OpenStreetMap');
  });
});
