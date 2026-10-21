import { useMemo, useState, type PointerEvent } from 'react';
import { X } from 'lucide-react';
import { fmt } from '../../components/ui';
import type { BaseDatos } from '../../domain/db';
import { claseDe, cortesCuantiles, rankingCalles, SECTORES, UMBRAL_CALLE, type FilaRanking, type Sector, type UnidadPanel } from '../../domain/panel';
import type { Calle, Id, LngLat } from '../../domain/types';
import { COLOR, fmtPct } from './graficos';
import { LienzoGL, webglDisponible, type CalleMapa, type PuntoMapa } from './mapaGL';
import { SECTOR_CORTO } from './comun';

/**
 * Mapa territorial del Resumen. Nunca inventa posiciones:
 * - **puntos** por establecimiento solo si sus locales tienen coordenadas VERIFICADAS;
 * - si no, **agregados por calle** sobre la geometría del callejero;
 * - sin geometría, el Resumen muestra la matriz calle × sector (`MatrizTerritorial`), no un mapa.
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

function Leyenda({ capa, cortes, colores, modo }: { capa: CapaMapa; cortes: number[]; colores: string[]; modo: 'calles' | 'puntos' }) {
  if (modo === 'puntos') {
    return (
      <div className="vz-mapa-leyenda">
        {SECTORES.map((s) => <span key={s}><i className="punto" style={{ background: COLOR[s] }} />{SECTOR_CORTO[s]}</span>)}
        <span><i className="punto" style={{ background: COLOR['Sin clasificar'] }} />Sin clasificar</span>
        <span><i className="punto" style={{ background: TONO_CAPA.vacios }} />Vacío</span>
      </div>
    );
  }
  return (
    <div className="vz-mapa-leyenda" aria-label={`Escala: ${etiquetaCapa(capa)}`}>
      <b>{etiquetaCapa(capa)} <small>· % de la calle</small></b>
      {cortes.map((c, i) => <span key={i}><i style={{ background: colores[i] }} />{i === 0 ? `≤ ${fmtPct(c, 0)}` : `${fmtPct(cortes[i - 1], 0)}–${fmtPct(c, 0)}`}</span>)}
      <span><i style={{ background: '#e6eaf0' }} />&lt; {UMBRAL_CALLE} observados</span>
    </div>
  );
}

export function MapaTerritorial({ db, municipioId, unidades, capa, sobre, fijada, onSobre, onFijar, onFiltrar }: {
  db: BaseDatos; municipioId: Id; unidades: UnidadPanel[]; capa: CapaMapa; sobre: Id | null; fijada: Id | null;
  onSobre: (id: Id | null) => void; onFijar: (id: Id | null) => void; onFiltrar: (id: Id) => void;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; id: Id } | null>(null);
  // Mapa base cartográfico (MapLibre) si hay WebGL; si no (o en pruebas), el mismo mapa en SVG.
  const [gl] = useState(webglDisponible);
  const base = useMemo(() => Object.values(db.calles).filter((c) => c.municipioId === municipioId && c.segmentos.some((s) => s.coords.length > 1)), [db.calles, municipioId]);
  const filas = useMemo(() => callesDelAmbito(unidades), [unidades]);
  const porCalle = useMemo(() => new Map(filas.map((f) => [f.calleId, f])), [filas]);
  const puntos = useMemo(() => unidades.filter((u) => u.coord), [unidades]);
  const modo: 'puntos' | 'calles' = puntos.length ? 'puntos' : 'calles';
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
  const destacadas = [...aptas].sort((a, b) => valorCapa(b, capa) * b.observados - valorCapa(a, capa) * a.observados).slice(0, 3).map((f) => f.calleId);
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
  const mover = (e: PointerEvent, id: Id) => {
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, id });
    onSobre(id);
  };
  const salir = () => { setTip(null); onSobre(null); };
  const callesGL = useMemo<CalleMapa[]>(
    () => base.map((c) => { const f = porCalle.get(c.id); return { id: c.id, nombre: c.nombre, segmentos: c.segmentos.map((s) => s.coords), color: modo === 'puntos' ? '#9aa6b8' : color(f), ancho: f ? 2 + 5 * Math.sqrt(f.observados / maxObs) : 1.2, conDatos: !!f }; }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, porCalle, capa, modo, maxObs, cortes.join(',')],
  );
  const puntosGL = useMemo<PuntoMapa[]>(() => puntos.map((u) => {
    const cat = u.vacio ? 'vacios' : (u.sector ?? 'Sin clasificar');
    return { id: u.clave, calleId: u.calleId, coord: u.coord!, color: cat === 'vacios' ? TONO_CAPA.vacios : COLOR[cat], opacidad: capa === 'ocupacion' || cat === capa ? 1 : 0.22 };
  }), [puntos, capa]);
  const centroMun = db.municipios[municipioId]?.centro ?? base[0]?.segmentos[0]?.coords[0];
  const tipFila = tip ? porCalle.get(tip.id) : undefined;
  const fij = fijada ? porCalle.get(fijada) : undefined;

  if (!base.length) return null;
  const etiqueta = modo === 'puntos' ? 'Mapa de establecimientos (coordenadas verificadas)' : `Mapa por calle: ${etiquetaCapa(capa)}`;
  return (
    <div className="vz-mapa2">
      <div className="vz-mapa2-lienzo">
        {gl && centroMun ? (
          <div className="vz-mapa2-gl" role="img" aria-label={etiqueta}>
            <LienzoGL centro={centroMun} calles={callesGL} puntos={puntosGL} sobre={sobre} fijada={fijada} onSobre={onSobre} onFijar={onFijar} onTip={setTip} />
          </div>
        ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={modo === 'puntos' ? 'Mapa de establecimientos (coordenadas verificadas)' : `Mapa por calle: ${etiquetaCapa(capa)}`} onPointerLeave={salir}>
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
            {modo === 'puntos' && puntos.map((u) => {
              const [x, y] = xy(u.coord!);
              const cat = u.vacio ? 'vacios' : (u.sector ?? 'Sin clasificar');
              const enCapa = capa === 'ocupacion' || cat === capa;
              return (
                <circle key={u.clave} cx={x} cy={y} r={(enCapa ? 4.5 : 3) * fz} strokeWidth={1.5 * fz} className="vz-punto" fill={cat === 'vacios' ? TONO_CAPA.vacios : COLOR[cat]} opacity={enCapa ? 1 : 0.22}
                  onPointerMove={(e) => mover(e, u.calleId)} onClick={() => onFijar(fijada === u.calleId ? null : u.calleId)} />
              );
            })}
            {etiquetas.map(({ id, x, y }) => (
              <text key={`e${id}`} x={x} y={y - 7 * fz} className={`vz-mapa-etq ${id === sobre || id === fijada ? 'activa' : ''}`} style={{ fontSize: 11.5 * fz, strokeWidth: 3.5 * fz }} textAnchor="middle">{db.calles[id].nombre}</text>
            ))}
          </svg>
        )}
        {tip && tipFila && (
          <div className="vz-tip" style={{ left: tip.x + 14, top: Math.max(tip.y - 10, 4) }} role="tooltip">
            <b>{tipFila.calle}</b>
            <span><strong className="num">{tipFila.observados >= UMBRAL_CALLE ? fmtPct(valorCapa(tipFila, capa), 0) : '—'}</strong> {etiquetaCapa(capa).toLowerCase()}</span>
            <span className="muted">{fmt(tipFila.observados)} observados · {fmt(tipFila.ocupados)} ocupados · {fmt(tipFila.vacios)} vacíos</span>
          </div>
        )}
        <div className="vz-mapa2-leyenda"><Leyenda capa={capa} cortes={cortes} colores={colores} modo={modo} /></div>
        {fij && (
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
          ? `${fmt(puntos.length)} establecimientos con coordenadas verificadas, en su posición; los demás no se dibujan (no se inventan posiciones).`
          : `Color: % de la calle (cuantiles de las ${fmt(aptas.length)} calles con al menos ${UMBRAL_CALLE} observados) · grosor: establecimientos · sin coordenadas verificadas no se dibujan puntos.`}
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
