import { useMemo, useState, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import { fmt } from '../../components/ui';
import type { BaseDatos } from '../../domain/db';
import { claseDe, cortesCuantiles, rankingCalles, SECTORES, UMBRAL_CALLE, type FilaRanking, type Sector, type UnidadPanel } from '../../domain/panel';
import type { Calle, Id, LngLat } from '../../domain/types';
import { COLOR, fmtPct } from './graficos';
import { LienzoGL, webglDisponible, type CalleMapa, type PuntoMapa, type TipMapa } from './mapaGL';
import { FUENTE_TXT, SECTOR_CORTO } from './comun';
import { VARIABLES_DIGITALES } from '../../domain/digital';
import { desplazamientoGrupo, esFicticio, type PosicionEstablecimiento, type ResultadoPosiciones, type TipoPosicion } from '../../domain/posiciones';

/**
 * Mapa territorial del Resumen, con dos vistas:
 * - **Por calles**: agregados por calle sobre la geometría del callejero, con cinco capas;
 * - **Por establecimientos**: un punto por local físico, coloreado por sector o vacío. La posición es la
 *   verificada, la aproximada (dibujada aparte, pendiente de validación) o, solo en datos ficticios, una
 *   ubicación simulada sobre la calle, señalada como tal (`domain/posiciones.ts`). Nada se inventa ni se guarda.
 * Sin geometría, el Resumen muestra la matriz calle × sector (`MatrizTerritorial`), no un mapa.
 * Mapa, rankings y matriz comparten la calle resaltada (al pasar el cursor) y la fijada (al pulsar).
 */

export type CapaMapa = 'ocupacion' | Sector | 'vacios';
export const CAPAS: { v: CapaMapa; t: string }[] = [
  { v: 'ocupacion', t: 'Ocupación' }, { v: 'Comercio', t: 'Comercio' }, { v: 'Servicios', t: 'Servicios' }, { v: 'Hostelería y Restauración', t: 'Hostelería' }, { v: 'vacios', t: 'Vacíos' },
];
/** Tono de cada capa: los sectores conservan su color; ocupación y vacíos usan tonos propios. */
export const TONO_CAPA: Record<CapaMapa, string> = { ocupacion: '#5a48c9', Comercio: COLOR.Comercio, Servicios: COLOR.Servicios, 'Hostelería y Restauración': COLOR['Hostelería y Restauración'], vacios: '#4f5d72' };
// ── Rampas secuenciales en OKLCH: un solo tono y luminosidad decreciente. Validadas con el validador de
// la guía de visualización (modo ordinal: monótonas, pasos distinguibles, extremo claro visible).
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const srgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function aOklch(h: string): [number, number, number] {
  const [r, g, b] = hex(h).map((c) => lin(c / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(A, B), Math.atan2(B, A)];
}
function deOklch(L: number, C: number, H: number): string {
  // Reduce el croma hasta entrar en la gama sRGB.
  for (let c = C; c >= 0; c -= 0.005) {
    const A = c * Math.cos(H);
    const B = c * Math.sin(H);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    if (rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, srgb(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('')}`;
  }
  return '#888888';
}
/**
 * Luminosidades de los pasos: evitan el tramo ≈0,52–0,64, donde ni el texto blanco ni la tinta alcanzan
 * 4,5:1 (peor contraste de las cifras de la matriz: 4,9:1), y el paso más claro supera 2:1 sobre el fondo.
 */
const LUMINOSIDADES = [0.745, 0.655, 0.505, 0.43, 0.35];
/** Rampa secuencial de `n` pasos para un tono (de claro a oscuro). */
export const rampa = (tono: string, n: number) => {
  const [, C, H] = aOklch(tono);
  const ls = n >= 5 ? LUMINOSIDADES : n === 1 ? [0.505] : Array.from({ length: n }, (_, i) => LUMINOSIDADES[Math.round((i * (LUMINOSIDADES.length - 1)) / (n - 1))]);
  return ls.map((L, i) => deOklch(L, C * (0.75 + 0.25 * (n === 1 ? 1 : i / (n - 1))), H));
};
/** Texto legible sobre un fondo: tinta o blanco, el de MAYOR contraste (WCAG). */
export const tintaPara = (fondo: string) => {
  const [r, g, b] = hex(fondo).map((c) => lin(c / 255));
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const conBlanco = 1.05 / (Y + 0.05);
  const conTinta = (Y + 0.05) / (0.0137 + 0.05); // tinta #0b1b33
  return conTinta >= conBlanco ? '#0b1b33' : '#ffffff';
};

export const valorCapa = (f: FilaRanking, capa: CapaMapa): number => (capa === 'ocupacion' ? f.ocupados : capa === 'vacios' ? f.vacios : f.composicion[capa]) / f.observados;
const etiquetaCapa = (capa: CapaMapa) => (capa === 'ocupacion' ? 'Ocupación' : capa === 'vacios' ? 'Locales vacíos' : SECTOR_CORTO[capa]);

/** Calles del ámbito con su composición (todas, sin umbral: el umbral se aplica al colorear). */
export const callesDelAmbito = (us: UnidadPanel[]) => rankingCalles(us, 'ocupados', 1, Infinity).filas;

function Leyenda({ capa, cortes, colores }: { capa: CapaMapa; cortes: number[]; colores: string[] }) {
  return (
    <div className="vz-mapa-leyenda" aria-label={`Escala: ${etiquetaCapa(capa)}`}>
      <b>{etiquetaCapa(capa)} <small>· % de la calle</small></b>
      {cortes.map((c, i) => <span key={i}><i style={{ background: colores[i] }} />{i === 0 ? `≤ ${fmtPct(c, 0)}` : `${fmtPct(cortes[i - 1], 0)}–${fmtPct(c, 0)}`}</span>)}
      <span><i style={{ background: '#e6eaf0' }} />&lt; {UMBRAL_CALLE} observados</span>
    </div>
  );
}

// ── Modo «Por establecimientos» ──
export type VistaMapa = 'calles' | 'establecimientos';
export const VISTAS: { v: VistaMapa; t: string }[] = [{ v: 'calles', t: 'Por calles' }, { v: 'establecimientos', t: 'Por establecimientos' }];
export type CategoriaPunto = Sector | 'Sin clasificar' | 'vacios';
const CATEGORIAS: { k: CategoriaPunto; t: string }[] = [...SECTORES.map((s) => ({ k: s as CategoriaPunto, t: SECTOR_CORTO[s] })), { k: 'Sin clasificar', t: 'Sin clasificar' }, { k: 'vacios', t: 'Vacíos' }];
export const categoriaPunto = (u: UnidadPanel): CategoriaPunto => (u.vacio ? 'vacios' : u.sector ?? 'Sin clasificar');
/** Color de punto: el del sector; los vacíos, su tono; «sin clasificar», un gris visible sobre el mapa. */
export const colorPunto = (c: CategoriaPunto) => (c === 'vacios' ? TONO_CAPA.vacios : c === 'Sin clasificar' ? '#8d97a8' : COLOR[c]);
const DIGITAL_CORTO: Record<string, string> = { web: 'Web', ventaOnline: 'Venta online', googleBusiness: 'Google', respondeResenas: 'Responde reseñas', instagram: 'Instagram', facebook: 'Facebook', twitter: 'X', otrasRedes: 'Otras redes' };
const RESP_TXT: Record<string, string> = { si: 'Sí', no: 'No', 'sin-info': 'Sin información', na: 'No aplica', pendiente: 'Pendiente' };
const FUENTE_POS = { 'gps-campo': 'GPS de campo', catastro: 'Catastro', 'comprobacion-manual': 'comprobación manual' } as const;
const portalTxt = (u: UnidadPanel) => (u.numero === null ? 's/n' : `${u.numero}${u.sufijo ? ` ${u.sufijo}` : ''}`);
const nombreTxt = (u: UnidadPanel) => (u.vacio ? 'Local vacío' : u.nombre ?? 'Nombre no registrado');

function LeyendaPuntos({ conteo, ocultas, onAlternar, tipos }: {
  conteo: Record<CategoriaPunto, number>; ocultas: Set<CategoriaPunto>; onAlternar: (c: CategoriaPunto) => void; tipos: Record<TipoPosicion, number>;
}) {
  return (
    <div className="vz-mapa-leyenda" role="group" aria-label="Leyenda: categorías de establecimiento">
      {CATEGORIAS.filter((c) => conteo[c.k] > 0).map((c) => (
        <button key={c.k} className={`vz-ley-cat ${ocultas.has(c.k) ? 'off' : ''}`} aria-pressed={!ocultas.has(c.k)} onClick={() => onAlternar(c.k)} title={ocultas.has(c.k) ? 'Mostrar' : 'Ocultar'}>
          <i className="punto" style={{ background: colorPunto(c.k) }} />{c.t}<b className="num">{fmt(conteo[c.k])}</b>
        </button>
      ))}
      {tipos.aproximada > 0 && <span className="vz-ley-tipo"><i className="punto hueco" />Aproximada · pendiente de validación</span>}
      {tipos.verificada > 0 && (tipos.aproximada > 0 || tipos.simulada > 0) && <span className="vz-ley-tipo"><i className="punto" style={{ background: '#5b6678' }} />Verificada</span>}
    </div>
  );
}

/** Ficha del establecimiento pulsado: solo datos registrados (sin cadena, descripciones ni observaciones libres). */
function FichaLocal({ db, u, p, hermanos, ficticio, onSel, onCerrar }: {
  ficticio: boolean;
  db: BaseDatos; u: UnidadPanel; p: PosicionEstablecimiento; hermanos: UnidadPanel[]; onSel: (clave: string) => void; onCerrar: () => void;
}) {
  const cat = categoriaPunto(u);
  const ver = u.localId ? db.locales[u.localId]?.coordVerificada : undefined;
  const digital = VARIABLES_DIGITALES.filter((v) => v.tipo === 'respuesta').map((v) => ({ t: DIGITAL_CORTO[v.id] ?? v.etiqueta, r: u.digital[v.id]?.respuesta })).filter((x) => x.r && x.r !== 'pendiente');
  const posicion = p.tipo === 'verificada' && ver ? `Posición verificada · ${FUENTE_POS[ver.fuente]} (${ver.fecha})` : p.tipo === 'aproximada' ? 'Posición aproximada · pendiente de validación' : 'Ubicación simulada a partir del callejero · no es una coordenada';
  return (
    <div className="vz-fijada vz-ficha-local" aria-label="Establecimiento seleccionado">
      <div className="fila"><b className="esp">{nombreTxt(u)}</b><button className="vz-quitar" aria-label="Cerrar la ficha" onClick={onCerrar}><X size={14} /></button></div>
      <span className="muted">{u.calle}, {portalTxt(u)}{ficticio && <small className="vz-ficticio" title="Dato de demostración: no es una dirección real comprobada"> · nº ficticio</small>}</span>
      <span className={`vz-pos vz-pos-${p.tipo}`}>{posicion}</span>
      <dl className="vz-ficha-dl">
        <dt>Estado</dt><dd>{u.vacio ? 'Vacío' : 'Ocupado'}</dd>
        {!u.vacio && (
          <><dt>Sector</dt><dd><i className="punto" style={{ background: colorPunto(cat) }} /> {u.sector ?? 'Sin clasificar'}{u.nivel2 ? ` · ${u.nivel2}` : ''}{u.sector && <small>{FUENTE_TXT[u.fuenteClasificacion]}</small>}</dd></>
        )}
        {!u.vacio && u.franquicia && <><dt>Franquicia</dt><dd>{RESP_TXT[u.franquicia]}</dd></>}
        {u.metros !== undefined && <><dt>Fachada</dt><dd>{fmt(u.metros)} m</dd></>}
      </dl>
      {digital.length > 0 && (
        <div className="vz-ficha-digital">
          <span>Presencia digital{u.digitalEstado === 'borrador' ? ' · revisión en borrador' : ''}</span>
          <span className="vz-ficha-chips">{digital.map((d) => <span key={d.t} className={`r-${d.r}`}>{d.t} <b>{RESP_TXT[d.r!]}</b></span>)}</span>
        </div>
      )}
      {hermanos.length > 0 && (
        <div className="vz-ficha-portal">
          <span>Mismo portal: {hermanos.length + 1} locales independientes</span>
          {hermanos.map((h) => <button key={h.clave} className="vz-enlace" onClick={() => onSel(h.clave)}>{nombreTxt(h)}</button>)}
        </div>
      )}
    </div>
  );
}

export function MapaTerritorial({ db, municipioId, unidades, capa, vista = 'calles', posiciones, sobre, fijada, onSobre, onFijar, onFiltrar }: {
  db: BaseDatos; municipioId: Id; unidades: UnidadPanel[]; capa: CapaMapa; vista?: VistaMapa; posiciones?: ResultadoPosiciones; sobre: Id | null; fijada: Id | null;
  onSobre: (id: Id | null) => void; onFijar: (id: Id | null) => void; onFiltrar: (id: Id) => void;
}) {
  const [tip, setTip] = useState<TipMapa | null>(null);
  const [puntoSel, setPuntoSel] = useState<string | null>(null);
  const [ocultas, setOcultas] = useState<Set<CategoriaPunto>>(new Set());
  // Mapa base cartográfico (MapLibre) si hay WebGL; si no (o en pruebas), el mismo mapa en SVG.
  const [gl] = useState(webglDisponible);
  const base = useMemo(() => Object.values(db.calles).filter((c) => c.municipioId === municipioId && c.segmentos.some((s) => s.coords.length > 1)), [db.calles, municipioId]);
  const filas = useMemo(() => callesDelAmbito(unidades), [unidades]);
  const porCalle = useMemo(() => new Map(filas.map((f) => [f.calleId, f])), [filas]);
  const porClave = useMemo(() => new Map(unidades.map((u) => [u.clave, u])), [unidades]);
  const modo: 'puntos' | 'calles' = vista === 'establecimientos' ? 'puntos' : 'calles';
  // Posiciones (calculadas sobre TODA la campaña, estables al filtrar) de las unidades visibles.
  const enMapa = useMemo(() => (modo === 'puntos' && posiciones ? posiciones.posiciones.filter((p) => porClave.has(p.clave)) : []), [modo, posiciones, porClave]);
  const conteo = useMemo(() => {
    const c = Object.fromEntries(CATEGORIAS.map((x) => [x.k, 0])) as Record<CategoriaPunto, number>;
    for (const p of enMapa) c[categoriaPunto(porClave.get(p.clave)!)]++;
    return c;
  }, [enMapa, porClave]);
  const tipos = useMemo(() => {
    const t: Record<TipoPosicion, number> = { verificada: 0, aproximada: 0, simulada: 0 };
    for (const p of enMapa) t[p.tipo]++;
    return t;
  }, [enMapa]);
  const puntos = useMemo(() => enMapa.filter((p) => !ocultas.has(categoriaPunto(porClave.get(p.clave)!))), [enMapa, ocultas, porClave]);
  const aptas = filas.filter((f) => f.observados >= UMBRAL_CALLE);
  const cortes = cortesCuantiles(aptas.map((f) => valorCapa(f, capa)));
  const colores = rampa(TONO_CAPA[capa], Math.max(1, cortes.length));
  const maxObs = Math.max(1, ...filas.map((f) => f.observados));

  // Proyección equirrectangular corregida por la latitud, ajustada a la caja de las calles con geometría.
  const pts: LngLat[] = base.flatMap((c) => c.segmentos.flatMap((s) => s.coords));
  const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  // Lienzo de proporción fija (el del contenedor) y escala uniforme centrada: el texto no encoge.
  const k = Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
  const W = 520;
  const H = Math.round(Math.max(240, Math.min(560, (W * (y1 - y0)) / Math.max(1e-9, (x1 - x0) * k))));
  const esc = Math.min((W - 32) / Math.max(1e-9, (x1 - x0) * k), (H - 28) / Math.max(1e-9, y1 - y0));
  /** Factor para que textos y trazos mantengan su tamaño en pantalla (lienzo de 300 px de alto). */
  const fz = H / 300;
  const ox = (W - (x1 - x0) * k * esc) / 2;
  const oy = (H - (y1 - y0) * esc) / 2;
  const xy = (p: LngLat): [number, number] => [ox + (p[0] - x0) * k * esc, H - oy - (p[1] - y0) * esc];
  const linea = (c: LngLat[]) => c.map((p) => xy(p).map((v) => v.toFixed(1)).join(',')).join(' ');
  const centro = (c: Calle) => {
    const seg = [...c.segmentos].sort((a, b) => b.coords.length - a.coords.length)[0];
    return xy(seg.coords[Math.floor(seg.coords.length / 2)]);
  };

  const color = (f?: FilaRanking) => (f && f.observados >= UMBRAL_CALLE && cortes.length ? colores[claseDe(valorCapa(f, capa), cortes)] : '#e6eaf0');
  const ancho = (f?: FilaRanking) => (f ? 2 + 5 * Math.sqrt(f.observados / maxObs) : 1.2) * fz;
  const destacadas = modo === 'calles' ? [...aptas].sort((a, b) => valorCapa(b, capa) * b.observados - valorCapa(a, capa) * a.observados).slice(0, 3).map((f) => f.calleId) : [];
  // Etiquetas selectivas (las 3 calles destacadas de la capa, la seleccionada y la resaltada), sin solaparse.
  const etiquetas: { id: Id; x: number; y: number }[] = [];
  for (const id of [...new Set([fijada, sobre, ...destacadas].filter(Boolean) as Id[])]) {
    const c = db.calles[id];
    if (!c || !c.segmentos.some((s) => s.coords.length > 1)) continue;
    const [x, y] = centro(c);
    const largo = c.nombre.length * 6.2 * fz;
    if (etiquetas.some((e) => Math.abs(e.y - y) < 15 * fz && Math.abs(e.x - x) < (largo + db.calles[e.id].nombre.length * 6.2 * fz) / 2)) continue;
    etiquetas.push({ id, x, y });
  }
  const mover = (e: PointerEvent, id: Id, punto?: string) => {
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, id, punto });
    onSobre(id);
  };
  const salir = () => { setTip(null); onSobre(null); };
  const callesGL = useMemo<CalleMapa[]>(
    () => base.map((c) => { const f = porCalle.get(c.id); return { id: c.id, nombre: c.nombre, segmentos: c.segmentos.map((s) => s.coords), color: modo === 'puntos' ? '#b3bccb' : color(f), ancho: modo === 'puntos' ? 1.6 : f ? 2 + 5 * Math.sqrt(f.observados / maxObs) : 1.2, conDatos: !!f }; }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, porCalle, capa, modo, maxObs, cortes.join(',')],
  );
  /** Con una calle fijada, los establecimientos de las demás se atenúan. */
  const opacidad = (calleId: Id) => (fijada && calleId !== fijada ? 0.28 : 1);
  const puntosGL = useMemo<PuntoMapa[]>(() => puntos.map((p) => ({
    id: p.clave, calleId: p.calleId, coord: p.coord, tipo: p.tipo, enGrupo: p.enGrupo, indiceEnGrupo: p.indiceEnGrupo,
    color: colorPunto(categoriaPunto(porClave.get(p.clave)!)), opacidad: opacidad(p.calleId),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })), [puntos, porClave, fijada]);
  const centroMun = db.municipios[municipioId]?.centro ?? base[0]?.segmentos[0]?.coords[0];
  const tipFila = tip ? porCalle.get(tip.id) : undefined;
  const tipUnidad = tip?.punto ? porClave.get(tip.punto) : undefined;
  const fij = fijada ? porCalle.get(fijada) : undefined;
  const sel = modo === 'puntos' && puntoSel ? enMapa.find((p) => p.clave === puntoSel) : undefined;
  const selU = sel ? porClave.get(sel.clave) : undefined;
  const hermanos = sel ? enMapa.filter((p) => p.portal === sel.portal && p.clave !== sel.clave).map((p) => porClave.get(p.clave)!) : [];
  const simuladas = tipos.simulada > 0;
  // Calles reales (OpenStreetMap): se atribuyen siempre; con datos ficticios, se dice que portales y ubicaciones no lo son.
  const callesOsm = base.some((c) => c.procedencia === 'osm');
  const atribucion = callesOsm ? ' Callejero © colaboradores de OpenStreetMap (ODbL).' : '';

  if (!base.length) return null;
  const etiqueta = modo === 'puntos' ? `Mapa por establecimientos${simuladas ? ' (ubicaciones simuladas)' : ''}` : `Mapa por calle: ${etiquetaCapa(capa)}`;
  const locales = unidades.filter((u) => u.localId).length;
  return (
    <div className="vz-mapa2">
      {modo === 'puntos' && simuladas && (
        <div className="vz-simuladas" role="note" aria-label="Ubicaciones simuladas">
          <b>Ubicaciones simuladas</b>
          <span>{callesOsm
            ? 'Calles reales de OpenStreetMap; los negocios, sus números de portal y sus ubicaciones son ficticios. No son direcciones comprobadas.'
            : 'Datos ficticios situados a lo largo de su calle. No son coordenadas.'}</span>
        </div>
      )}
      <div className="vz-mapa2-lienzo">
        {gl && centroMun ? (
          <div className="vz-mapa2-gl" role="img" aria-label={etiqueta}>
            <LienzoGL centro={centroMun} calles={callesGL} puntos={puntosGL} sobre={sobre} fijada={fijada} puntoSel={sel?.clave ?? null} onSobre={onSobre} onFijar={onFijar} onTip={setTip} onPunto={setPuntoSel} />
          </div>
        ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={etiqueta} onPointerLeave={salir}>
            {/* Calles del callejero sin datos: contexto */}
            {base.filter((c) => !porCalle.has(c.id)).map((c) => c.segmentos.map((s) => <polyline key={s.id} points={linea(s.coords)} className="vz-calle-fondo" />))}
            {modo === 'calles' && base.filter((c) => porCalle.has(c.id)).map((c) => {
              const f = porCalle.get(c.id)!;
              const activa = c.id === sobre || c.id === fijada;
              return (
                <g key={c.id} className={`vz-calle ${activa ? 'activa' : ''}`} onPointerMove={(e) => mover(e, c.id)} onClick={() => onFijar(fijada === c.id ? null : c.id)}>
                  {activa && c.segmentos.map((s) => <polyline key={`h${s.id}`} points={linea(s.coords)} className="vz-calle-halo" strokeWidth={ancho(f) + 6 * fz} />)}
                  {c.segmentos.map((s) => <polyline key={s.id} points={linea(s.coords)} stroke={color(f)} strokeWidth={ancho(f)} strokeLinecap="round" fill="none" />)}
                  {c.segmentos.map((s) => <polyline key={`t${s.id}`} points={linea(s.coords)} className="vz-calle-hit" strokeWidth={14 * fz} />)}
                </g>
              );
            })}
            {modo === 'puntos' && base.filter((c) => porCalle.has(c.id)).map((c) => c.segmentos.map((s) => <polyline key={s.id} points={linea(s.coords)} className={`vz-calle-base ${c.id === sobre || c.id === fijada ? 'activa' : ''}`} />))}
            {modo === 'puntos' && puntos.filter((p) => p.enGrupo > 1).map((p) => {
              const [x, y] = xy(p.coord);
              const [dx, dy] = desplazamientoGrupo(p.enGrupo, p.indiceEnGrupo, 7 * fz);
              return <g key={`g${p.clave}`} className="vz-grupo" opacity={opacidad(p.calleId)}><line x1={x} y1={y} x2={x + dx} y2={y + dy} strokeWidth={0.8 * fz} />{p.indiceEnGrupo === 0 && <circle cx={x} cy={y} r={1.6 * fz} />}</g>;
            })}
            {modo === 'puntos' && puntos.map((p) => {
              const u = porClave.get(p.clave)!;
              const [x, y] = xy(p.coord);
              const [dx, dy] = desplazamientoGrupo(p.enGrupo, p.indiceEnGrupo, 7 * fz);
              const c = colorPunto(categoriaPunto(u));
              const hueco = p.tipo === 'aproximada';
              return (
                <circle key={p.clave} data-clave={p.clave} data-tipo={p.tipo} cx={x + dx} cy={y + dy} r={3.4 * fz} strokeWidth={(hueco ? 1.8 : 1) * fz}
                  className={`vz-punto ${hueco ? 'hueco' : ''}`} fill={hueco ? '#ffffff' : c} stroke={hueco ? c : '#ffffff'} opacity={opacidad(p.calleId)}
                  aria-label={`${nombreTxt(u)}, ${u.calle} ${portalTxt(u)}`}
                  onPointerMove={(e) => mover(e, p.calleId, p.clave)} onClick={() => setPuntoSel(puntoSel === p.clave ? null : p.clave)} />
              );
            })}
            {sel && (() => { const [x, y] = xy(sel.coord); const [dx, dy] = desplazamientoGrupo(sel.enGrupo, sel.indiceEnGrupo, 7 * fz); return <circle cx={x + dx} cy={y + dy} r={6.5 * fz} strokeWidth={2 * fz} className="vz-punto-sel" />; })()}
            {etiquetas.map(({ id, x, y }) => (
              <text key={`e${id}`} x={x} y={y - 7 * fz} className={`vz-mapa-etq ${id === sobre || id === fijada ? 'activa' : ''}`} style={{ fontSize: 11.5 * fz, strokeWidth: 3.5 * fz }} textAnchor="middle">{db.calles[id].nombre}</text>
            ))}
          </svg>
        )}
        {modo === 'puntos' && !enMapa.length && (
          <div className="vz-mapa2-vacio" role="note">Ningún establecimiento tiene posición verificada ni aproximada. Use la vista «Por calles».</div>
        )}
        {tip && tipUnidad ? (
          <div className="vz-tip" style={{ left: tip.x + 14, top: Math.max(tip.y - 10, 4) }} role="tooltip">
            <b>{nombreTxt(tipUnidad)}</b>
            <span className="muted">{tipUnidad.calle}, {portalTxt(tipUnidad)} · {tipUnidad.vacio ? 'vacío' : tipUnidad.sector ?? 'sin clasificar'}</span>
          </div>
        ) : tip && tipFila && (
          <div className="vz-tip" style={{ left: tip.x + 14, top: Math.max(tip.y - 10, 4) }} role="tooltip">
            <b>{tipFila.calle}</b>
            <span><strong className="num">{tipFila.observados >= UMBRAL_CALLE ? fmtPct(valorCapa(tipFila, capa), 0) : '—'}</strong> {etiquetaCapa(capa).toLowerCase()}</span>
            <span className="muted">{fmt(tipFila.observados)} observados · {fmt(tipFila.ocupados)} ocupados · {fmt(tipFila.vacios)} vacíos</span>
          </div>
        )}
        <div className="vz-mapa2-leyenda">
          {modo === 'puntos'
            ? <LeyendaPuntos conteo={conteo} ocultas={ocultas} tipos={tipos} onAlternar={(c) => setOcultas((o) => { const n = new Set(o); if (n.has(c)) n.delete(c); else n.add(c); return n; })} />
            : <Leyenda capa={capa} cortes={cortes} colores={colores} />}
        </div>
        {sel && selU ? (
          <FichaLocal db={db} u={selU} p={sel} hermanos={hermanos} ficticio={esFicticio(selU, db.municipios[municipioId] ?? {})} onSel={setPuntoSel} onCerrar={() => setPuntoSel(null)} />
        ) : fij && (
          <div className="vz-fijada" aria-label="Calle seleccionada">
            <div className="fila"><b className="esp">{fij.calle}</b><button className="vz-quitar" aria-label="Quitar la selección" onClick={() => onFijar(null)}><X size={14} /></button></div>
            <span className="muted">{fmt(fij.observados)} observados · ocupación {fmtPct(fij.ocupados / fij.observados, 0)}</span>
            <span className="vz-fijada-comp">
              {SECTORES.map((s) => <span key={s}><i style={{ background: COLOR[s] }} />{SECTOR_CORTO[s]}<b className="num">{fmt(fij.composicion[s])}</b></span>)}
              <span><i style={{ background: TONO_CAPA.vacios }} />Vacíos<b className="num">{fmt(fij.vacios)}</b></span>
            </span>
            <button className="btn s" onClick={() => onFiltrar(fij.calleId)}>Filtrar por esta calle</button>
          </div>
        )}
      </div>
      <p className="vz-mapa-nota">
        {modo === 'puntos'
          ? [
            `${fmt(enMapa.length)} de ${fmt(locales)} locales físicos en el mapa, uno por local`,
            tipos.simulada ? `${fmt(tipos.simulada)} con ubicación simulada` : '',
            tipos.verificada ? `${fmt(tipos.verificada)} con coordenadas verificadas` : '',
            tipos.aproximada ? `${fmt(tipos.aproximada)} aproximadas, pendientes de validación` : '',
            locales - enMapa.length ? `${fmt(locales - enMapa.length)} sin posición (no se dibujan)` : '',
            unidades.length - locales ? `${fmt(unidades.length - locales)} sin local identificado (no se dibujan)` : '',
            enMapa.some((p) => p.enGrupo > 1) ? 'los que comparten posición se abren en corona alrededor de su portal' : '',
          ].filter(Boolean).join(' · ') + '.' + atribucion
          : `Color: % de la calle (cuantiles de las ${fmt(aptas.length)} calles con al menos ${UMBRAL_CALLE} observados) · grosor: establecimientos.${atribucion}`}
      </p>
    </div>
  );
}

/** Columnas de la matriz territorial (mismo orden y color que los rankings). */
const COLUMNAS: { k: Sector | 'vacios'; t: string }[] = [...SECTORES.map((s) => ({ k: s, t: SECTOR_CORTO[s] })), { k: 'vacios', t: 'Vacíos' }];

/**
 * Matriz territorial calle × sector, para ámbitos SIN geometría fiable: conserva la lectura territorial
 * y la comparación simultánea de los cuatro grupos sin dibujar un mapa inventado.
 */
export function MatrizTerritorial({ unidades, sobre, fijada, onSobre, onFijar, filas: limite = 12 }: {
  unidades: UnidadPanel[]; sobre: Id | null; fijada: Id | null; onSobre: (id: Id | null) => void; onFijar: (id: Id | null) => void; filas?: number;
}) {
  const todas = callesDelAmbito(unidades);
  const filas = [...todas].sort((a, b) => b.observados - a.observados || a.calle.localeCompare(b.calle, 'es')).slice(0, limite);
  const n = (f: FilaRanking, k: Sector | 'vacios') => (k === 'vacios' ? f.vacios : f.composicion[k]);
  const escalas = new Map(COLUMNAS.map((c) => {
    const vals = todas.filter((f) => f.observados >= UMBRAL_CALLE).map((f) => n(f, c.k) / f.observados);
    const cortes = cortesCuantiles(vals);
    return [c.k, { cortes, colores: rampa(TONO_CAPA[c.k === 'vacios' ? 'vacios' : c.k], Math.max(1, cortes.length)) }];
  }));
  return (
    <div className="vz-matriz-env">
      <table className="vz-matriz-terr" aria-label="Matriz territorial: calles × sector">
        <thead>
          <tr><th>Calle</th><th className="num">Obs.</th>{COLUMNAS.map((c) => <th key={c.k} className="num"><i style={{ background: TONO_CAPA[c.k === 'vacios' ? 'vacios' : c.k] }} />{c.t}</th>)}</tr>
        </thead>
        <tbody onPointerLeave={() => onSobre(null)}>
          {filas.map((f) => (
            <tr key={f.calleId} className={`${f.calleId === sobre ? 'sobre' : ''} ${f.calleId === fijada ? 'fijada' : ''}`} onPointerEnter={() => onSobre(f.calleId)}>
              <td><button className="vz-enlace" onClick={() => onFijar(fijada === f.calleId ? null : f.calleId)} title={f.calle}>{f.calle}</button></td>
              <td className="num muted">{fmt(f.observados)}</td>
              {COLUMNAS.map((c) => {
                const v = n(f, c.k);
                const e = escalas.get(c.k)!;
                const ok = f.observados >= UMBRAL_CALLE && e.cortes.length > 0;
                const fondo = ok ? e.colores[claseDe(v / f.observados, e.cortes)] : '#f1f3f7';
                return (
                  <td key={c.k} className="num vz-mt-celda" style={{ background: fondo, color: ok ? tintaPara(fondo) : 'var(--tinta-3)' }} title={`${f.calle} · ${c.t}: ${fmt(v)} de ${fmt(f.observados)} (${fmtPct(v / f.observados, 0)})`}>
                    {fmt(v)}<small>{ok ? fmtPct(v / f.observados, 0) : '—'}</small>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="vz-mapa-nota">
        Las {fmt(filas.length)} calles con más establecimientos observados (de {fmt(todas.length)}). Cifra = establecimientos; color = % de la calle, por cuantiles de cada columna («—»: menos de {UMBRAL_CALLE} observados).
        Las calles de este ámbito no tienen geometría fiable: no se dibuja un mapa.
      </p>
    </div>
  );
}
