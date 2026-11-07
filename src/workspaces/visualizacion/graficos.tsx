import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { fmt } from '../../components/ui';
import type { Parte, Proporcion } from '../../domain/panel';
import type { Calle, LngLat, Municipio } from '../../domain/types';

/**
 * Componentes de gráfico del dashboard. Genéricos: reciben partes ya calculadas, muestran siempre
 * el número absoluto y el denominador, y tienen un estado «sin datos». Añadir un indicador nuevo no
 * exige rehacerlos. Color: categórico para la identidad (sectores), una sola tonalidad de claro a
 * oscuro para la magnitud (mapas de calor) y gris para lo que no es dato.
 */

export const fmtPct = (v: number | null, dec = 1) => (v === null ? '—' : `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: dec, minimumFractionDigits: 0 })} %`);
export const fmtNum = (v: number | null | undefined, dec = 1) => (v === null || v === undefined ? '—' : v.toLocaleString('es-ES', { maximumFractionDigits: dec }));
export const textoProp = (p: Proporcion) => (p.den ? `${fmtPct(p.n / p.den)} (${fmt(p.n)} de ${fmt(p.den)})` : 'sin datos');
export const valorProp = (p: Proporcion) => (p.den ? p.n / p.den : null);

/** Paleta: tres sectores en orden fijo (validada para daltonismo), gris para lo que no es sector. */
export const COLOR = {
  Comercio: '#2a78d6',
  Servicios: '#eb6834',
  'Hostelería y Restauración': '#1baf7a',
  'Sin clasificar': '#c3cad6',
  'Vacíos': '#6b7a90',
  acento: '#2a78d6',
  neutro: '#a3adbd',
  referencia: '#c3cad6',
} as Record<string, string>;
/** Respuestas: orden fijo validado (Sí, No, Sin información, Pendiente); «No aplicable» en gris. */
export const COLOR_RESP: Record<string, string> = { si: '#2a78d6', no: '#eb6834', 'sin-info': '#6250d6', na: '#dfe4ec', pendiente: '#eda100' };

/** Escala secuencial de una sola tonalidad (azul, de casi superficie a intenso). */
const RAMPA = ['#e7f0fc', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
export const escala = (v: number) => RAMPA[Math.max(0, Math.min(RAMPA.length - 1, Math.round(v * (RAMPA.length - 1))))];
export const tintaSobre = (v: number) => (v > 0.55 ? '#fff' : 'var(--tinta)');

export function SinDatos({ texto = 'Sin datos para estos filtros.' }: { texto?: string }) {
  return <div className="vz-vacio" role="note">{texto}</div>;
}

type Span = 3 | 4 | 5 | 6 | 7 | 8 | 12;

/** Tarjeta de la retícula: título, subtítulo corto, acciones a la derecha y nota al pie. */
export function Bloque({ titulo, sub, nota, children, span = 6, etiqueta, acciones, className }: {
  titulo: ReactNode; sub?: ReactNode; nota?: ReactNode; children: ReactNode; span?: Span; etiqueta?: string; acciones?: ReactNode; className?: string;
}) {
  return (
    <section className={`vz-bloque c-${span} ${className ?? ''}`} aria-label={etiqueta ?? (typeof titulo === 'string' ? titulo : undefined)}>
      <header className="vz-bloque-cab">
        <div className="vz-bloque-tit">
          <h2>{titulo}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {acciones && <div className="vz-bloque-acc">{acciones}</div>}
      </header>
      <div className="vz-bloque-cuerpo">{children}</div>
      {nota && <p className="vz-nota"><Info size={12} aria-hidden /> <span>{nota}</span></p>}
    </section>
  );
}

/** Tarjeta KPI homogénea: etiqueta, cifra, contexto y, si es una proporción, su barra. */
export function Kpi({ etq, valor, sub, tono, barra, icono, color }: {
  etq: ReactNode; valor: ReactNode; sub?: ReactNode; tono?: 'aviso' | 'gris'; barra?: number | null; icono?: ReactNode; color?: string;
}) {
  return (
    <div className={`vz-kpi ${tono ?? ''}`}>
      <span className="vz-kpi-etq">{icono && <i style={color ? { color, background: `color-mix(in srgb, ${color} 12%, transparent)` } : undefined}>{icono}</i>}{etq}</span>
      <b className="num">{valor}</b>
      {sub && <span className="vz-kpi-sub">{sub}</span>}
      {barra !== undefined && <span className="vz-kpi-barra" aria-hidden><span style={{ width: `${Math.max(0, Math.min(1, barra ?? 0)) * 100}%`, background: color ?? COLOR.acento }} /></span>}
    </div>
  );
}

/** Pequeño selector segmentado dentro de una tarjeta. */
/** Botones excluyentes. Una opción con `motivo` se muestra deshabilitada y explica por qué. */
export function Conmutador<T extends string>({ valor, opciones, onCambio, etiqueta }: { valor: T; opciones: { v: T; t: string; motivo?: string }[]; onCambio: (v: T) => void; etiqueta: string }) {
  return (
    <div className="vz-conmutador" role="group" aria-label={etiqueta}>
      {opciones.map((o) => <button key={o.v} className={o.v === valor ? 'on' : ''} aria-pressed={o.v === valor} disabled={!!o.motivo} title={o.motivo} onClick={() => onCambio(o.v)}>{o.t}</button>)}
    </div>
  );
}

/** Barras horizontales con número y porcentaje sobre `total` (por defecto, la suma). */
export function BarrasH({ partes, total, color = COLOR.acento, colores, onClic, activa, limite, mostrarDen = true }: {
  partes: Parte[]; total?: number; color?: string; colores?: Record<string, string>; onClic?: (clave: string) => void; activa?: string; limite?: number; mostrarDen?: boolean;
}) {
  if (!partes.length || partes.every((p) => !p.n)) return <SinDatos />;
  const den = total ?? partes.reduce((a, p) => a + p.n, 0);
  const max = Math.max(...partes.map((p) => p.n), 1);
  const lista = limite ? partes.slice(0, limite) : partes;
  return (
    <div className="vz-barras" role="list">
      {lista.map((p) => (
        <button key={p.clave} role="listitem" className={`vz-barra ${onClic ? 'clic' : ''} ${activa === p.clave ? 'on' : ''}`} onClick={onClic ? () => onClic(p.clave) : undefined} disabled={!onClic} title={`${p.etiqueta}: ${fmt(p.n)} de ${fmt(den)}`}>
          <span className="vz-barra-t">{p.etiqueta}</span>
          <span className="vz-barra-pista"><span style={{ width: `${(p.n / max) * 100}%`, background: colores?.[p.clave] ?? color }} /></span>
          <span className="vz-barra-n num">{fmt(p.n)}</span>
          <span className="vz-barra-p num">{fmtPct(den ? p.n / den : null)}</span>
        </button>
      ))}
      {(mostrarDen || (limite && partes.length > limite)) && (
        <span className="vz-pie-barras">{limite && partes.length > limite ? `${fmt(partes.length - limite)} más sin mostrar · ` : ''}{mostrarDen ? `% sobre ${fmt(den)}` : ''}</span>
      )}
    </div>
  );
}

/** Barra apilada (100 %) con leyenda: cada segmento con su número y su porcentaje. */
export function Apilada({ segmentos, den, etiqueta, compacta, sinLeyenda }: { segmentos: { t: string; n: number; color: string }[]; den?: number; etiqueta?: string; compacta?: boolean; sinLeyenda?: boolean }) {
  const total = den ?? segmentos.reduce((a, s) => a + s.n, 0);
  if (!total) return <SinDatos />;
  return (
    <div className={`vz-apilada ${compacta ? 'compacta' : ''}`} aria-label={etiqueta}>
      <div className="vz-apilada-barra">{segmentos.filter((s) => s.n).map((s) => <span key={s.t} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} title={`${s.t}: ${fmt(s.n)} (${fmtPct(s.n / total)})`} />)}</div>
      {!sinLeyenda && <div className="vz-leyenda">{segmentos.map((s) => <span key={s.t}><i style={{ background: s.color }} />{s.t} <b className="num">{fmt(s.n)}</b> <span className="muted">{fmtPct(s.n / total)}</span></span>)}</div>}
    </div>
  );
}

/**
 * Anillo de composición con el total en el centro y una leyenda-tabla al lado (número y %). Pulsar
 * una fila de la leyenda puede filtrar.
 */
export function Anillo({ partes, colores, etiqueta, centro, sub, onClic, activa }: {
  partes: Parte[]; colores: Record<string, string>; etiqueta: string; centro: string; sub: string; onClic?: (clave: string) => void; activa?: string;
}) {
  const total = partes.reduce((a, p) => a + p.n, 0);
  const [sobre, setSobre] = useState<string | null>(null);
  if (!total) return <SinDatos />;
  const R = 70;
  const C = 2 * Math.PI * R;
  let acum = 0;
  return (
    <div className="vz-anillo">
      <svg viewBox="0 0 180 180" role="img" aria-label={etiqueta}>
        <circle cx="90" cy="90" r={R} fill="none" stroke="#eef1f5" strokeWidth="22" />
        {partes.filter((p) => p.n).map((p) => {
          const largo = (p.n / total) * C;
          const hueco = partes.filter((x) => x.n).length > 1 ? Math.min(2, largo / 2) : 0;
          const el = (
            <circle key={p.clave} cx="90" cy="90" r={R} fill="none" stroke={colores[p.clave] ?? COLOR.neutro} strokeWidth={sobre === p.clave || activa === p.clave ? 26 : 22}
              strokeDasharray={`${Math.max(0, largo - hueco)} ${C}`} strokeDashoffset={-acum} transform="rotate(-90 90 90)"
              onMouseEnter={() => setSobre(p.clave)} onMouseLeave={() => setSobre(null)} style={{ cursor: onClic ? 'pointer' : undefined, transition: 'stroke-width 120ms var(--ease)' }}
              onClick={onClic ? () => onClic(p.clave) : undefined}>
              <title>{`${p.etiqueta}: ${fmt(p.n)} (${fmtPct(p.n / total)})`}</title>
            </circle>
          );
          acum += largo;
          return el;
        })}
        <text x="90" y="86" textAnchor="middle" className="vz-anillo-n">{sobre ? fmt(partes.find((p) => p.clave === sobre)!.n) : centro}</text>
        <text x="90" y="106" textAnchor="middle" className="vz-anillo-t">{sobre ? fmtPct(partes.find((p) => p.clave === sobre)!.n / total) : sub}</text>
      </svg>
      <table className="vz-leyenda-tabla" aria-label={`${etiqueta} (tabla)`}>
        <tbody>
          {partes.map((p) => (
            <tr key={p.clave} className={`${onClic ? 'clic' : ''} ${activa === p.clave ? 'on' : ''}`} onMouseEnter={() => setSobre(p.clave)} onMouseLeave={() => setSobre(null)} onClick={onClic ? () => onClic(p.clave) : undefined} title={onClic ? 'Filtrar' : undefined}>
              <td><i style={{ background: colores[p.clave] ?? COLOR.neutro }} />{p.etiqueta}</td>
              <td className="num">{fmt(p.n)}</td>
              <td className="num muted">{fmtPct(p.n / total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>Total</td><td className="num">{fmt(total)}</td><td className="num muted">100 %</td></tr></tfoot>
      </table>
    </div>
  );
}

/**
 * Ranking: una fila por elemento con su posición, nombre (pulsable), barra y valores. La barra
 * puede ser simple o apilada (composición de la calle).
 */
export function Ranking({ filas, max, onClic, etiqueta, columnas }: {
  filas: { clave: string; nombre: string; n: number; segmentos?: { t: string; n: number; color: string }[]; color?: string; valor: ReactNode; extra?: ReactNode }[];
  max?: number; onClic?: (clave: string) => void; etiqueta: string; columnas: [string, string?];
}) {
  if (!filas.length) return <SinDatos />;
  const m = max ?? Math.max(...filas.map((f) => (f.segmentos ? f.segmentos.reduce((a, s) => a + s.n, 0) : f.n)), 1);
  return (
    <table className="vz-ranking" aria-label={etiqueta}>
      <thead><tr><th className="num">#</th><th>Calle</th><th aria-hidden /><th className="num">{columnas[0]}</th>{columnas[1] && <th className="num">{columnas[1]}</th>}</tr></thead>
      <tbody>
        {filas.map((f, i) => (
          <tr key={f.clave}>
            <td className="num vz-pos">{i + 1}</td>
            <td className="vz-rank-nom">{onClic ? <button className="vz-enlace" onClick={() => onClic(f.clave)} title="Filtrar por esta calle">{f.nombre}</button> : f.nombre}</td>
            <td className="vz-rank-barra">
              <span className="vz-pista">
                {f.segmentos
                  ? f.segmentos.filter((s) => s.n).map((s) => <span key={s.t} style={{ width: `${(s.n / m) * 100}%`, background: s.color }} title={`${s.t}: ${fmt(s.n)}`} />)
                  : <span style={{ width: `${(f.n / m) * 100}%`, background: f.color ?? COLOR.acento }} />}
              </span>
            </td>
            <td className="num"><b>{f.valor}</b></td>
            {columnas[1] && <td className="num muted">{f.extra}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Barras emparejadas (dos series: referencia en gris y actual en color), con su valor. */
export function BarrasPareadas({ filas, series, formato = (v) => fmt(v), etiqueta }: {
  filas: { clave: string; etiqueta: string; a: number | null; b: number | null; color?: string }[]; series: [string, string]; formato?: (v: number) => string; etiqueta: string;
}) {
  const vals = filas.flatMap((f) => [f.a, f.b]).filter((v): v is number => v !== null);
  if (!vals.length) return <SinDatos />;
  const max = Math.max(...vals, 1e-9);
  return (
    <div className="vz-pareadas" aria-label={etiqueta}>
      <div className="vz-leyenda"><span><i style={{ background: COLOR.referencia }} />{series[0]}</span><span><i style={{ background: COLOR.acento }} />{series[1]}</span></div>
      {filas.map((f) => (
        <div key={f.clave} className="vz-par">
          <span className="vz-par-t">{f.etiqueta}</span>
          <div className="vz-par-barras">
            {[f.a, f.b].map((v, i) => (
              <div key={i} className="vz-par-fila" title={`${series[i]}: ${v === null ? 'sin datos' : formato(v)}`}>
                <span className="vz-pista"><span style={{ width: `${v === null ? 0 : (v / max) * 100}%`, background: i ? f.color ?? COLOR.acento : COLOR.referencia }} /></span>
                <span className="num">{v === null ? '—' : formato(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Histograma vertical (intervalos ya calculados). */
export function Histograma({ partes, color = COLOR.acento, etiqueta, ejeX }: { partes: Parte[]; color?: string; etiqueta?: string; ejeX?: string }) {
  const total = partes.reduce((a, p) => a + p.n, 0);
  if (!total) return <SinDatos />;
  const max = Math.max(...partes.map((p) => p.n), 1);
  return (
    <div className="vz-histo-envoltura">
      <div className="vz-histo" aria-label={etiqueta} role="list">
        {partes.map((p) => (
          <div key={p.clave} className="vz-histo-col" role="listitem" title={`${p.etiqueta}: ${fmt(p.n)} (${fmtPct(p.n / total)})`}>
            <span className="num vz-histo-n">{fmt(p.n)}</span>
            <span className="vz-histo-barra" style={{ height: `${(p.n / max) * 100}%`, background: color }} />
            <span className="vz-histo-t">{p.etiqueta}</span>
          </div>
        ))}
      </div>
      {ejeX && <span className="vz-eje">{ejeX}</span>}
    </div>
  );
}

/** Diagrama de caja horizontal (mín · P25 · mediana · P75 · máx) sobre una escala común. */
export function Caja({ e, max }: { e: { min: number; p25: number; mediana: number; p75: number; max: number } | null; max: number }) {
  if (!e) return <span className="muted">—</span>;
  const x = (v: number) => `${(Math.min(v, max) / Math.max(max, 1e-9)) * 100}%`;
  return (
    <span className="vz-caja" title={`mín. ${fmtNum(e.min, 0)} · P25 ${fmtNum(e.p25, 0)} · mediana ${fmtNum(e.mediana, 0)} · P75 ${fmtNum(e.p75, 0)} · máx. ${fmtNum(e.max, 0)}`}>
      <span className="vz-caja-bigote" style={{ left: x(e.min), width: `calc(${x(e.max)} - ${x(e.min)})` }} />
      <span className="vz-caja-cuerpo" style={{ left: x(e.p25), width: `calc(${x(e.p75)} - ${x(e.p25)})` }} />
      <span className="vz-caja-med" style={{ left: x(e.mediana) }} />
    </span>
  );
}

/**
 * Tabla de calor genérica (filas × columnas de proporciones). Una celda solo se colorea con al menos
 * `minN` respuestas; si no, «—».
 */
export function TablaCalor({ filas, columnas, minN, etiqueta, primera = 'Grupo', nombreN = 'Ocupados', onClic }: {
  filas: { clave: string; nombre: string; n: number; celdas: Proporcion[] }[]; columnas: string[]; minN: number; etiqueta: string; primera?: string; nombreN?: string; onClic?: (clave: string) => void;
}) {
  if (!filas.length) return <SinDatos />;
  return (
    <div className="vz-calor-env scroll-fino">
      <table className="vz-calor" aria-label={etiqueta}>
        <thead><tr><th>{primera}</th><th className="num">{nombreN}</th>{columnas.map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave}>
              <td>{onClic ? <button className="vz-enlace" onClick={() => onClic(f.clave)}>{f.nombre}</button> : f.nombre}</td>
              <td className="num muted">{fmt(f.n)}</td>
              {f.celdas.map((c, i) => {
                const v = c.den >= minN ? c.n / c.den : null;
                return (
                  <td key={i} className="num vz-celda" style={v === null ? undefined : { background: escala(v), color: tintaSobre(v) }} title={v === null ? `Menos de ${minN} respuestas Sí/No (${fmt(c.den)})` : `${fmt(c.n)} de ${fmt(c.den)} con respuesta Sí/No`}>
                    {v === null ? '—' : fmtPct(v, 0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <Escala texto={`«—»: menos de ${minN} respuestas Sí/No`} />
    </div>
  );
}

export function Escala({ texto, desde = '0 %', hasta = '100 %' }: { texto?: string; desde?: string; hasta?: string }) {
  return <div className="vz-escala"><span>{desde}</span><i style={{ background: `linear-gradient(90deg, ${RAMPA.join(', ')})` }} /><span>{hasta}</span>{texto && <span className="muted">· {texto}</span>}</div>;
}

/** Mapa de calor calle × canal (adopción). Mantiene su nombre accesible histórico. */
export function MatrizCalor({ filas, columnas, minN }: { filas: { calleId: string; calle: string; n: number; celdas: ({ valor: number | null } & Proporcion)[] }[]; columnas: string[]; minN: number }) {
  if (!filas.length) return <SinDatos texto={`No hay calles con al menos ${minN} respuestas Sí/No.`} />;
  return <TablaCalor etiqueta="Mapa de calor por calle" primera="Calle" filas={filas.map((f) => ({ clave: f.calleId, nombre: f.calle, n: f.n, celdas: f.celdas }))} columnas={columnas} minN={minN} />;
}

/**
 * Mapa por CALLE sobre la geometría del callejero (no se inventan coordenadas de locales): cada
 * calle se colorea con el valor agregado de sus establecimientos.
 */
export function MapaCalles({ calles, valores, minN, leyenda = 'gris: sin datos suficientes' }: { calles: Calle[]; valores: Map<string, { valor: number | null; den: number }>; minN: number; leyenda?: string }) {
  const conGeo = calles.filter((c) => c.segmentos.some((s) => s.coords.length > 1));
  if (!conGeo.length) return <SinDatos texto="Las calles de este ámbito no tienen geometría fiable: no se dibuja un mapa (no se inventan coordenadas)." />;
  const pts: LngLat[] = conGeo.flatMap((c) => c.segmentos.flatMap((s) => s.coords));
  const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const k = Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
  const W = 760;
  const H = Math.max(240, Math.min(440, (W * (y1 - y0)) / Math.max(1e-9, (x1 - x0) * k)));
  const px = (p: LngLat) => `${(((p[0] - x0) / Math.max(1e-9, x1 - x0)) * (W - 24) + 12).toFixed(1)},${(H - 12 - ((p[1] - y0) / Math.max(1e-9, y1 - y0)) * (H - 24)).toFixed(1)}`;
  return (
    <div className="vz-mapa">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mapa por calle">
        {conGeo.map((c) => {
          const v = valores.get(c.id);
          const ok = !!v && v.valor !== null && v.den >= minN;
          return c.segmentos.map((s) => (
            <polyline key={s.id} points={s.coords.map(px).join(' ')} fill="none" stroke={ok ? escala(v!.valor!) : '#d6dbe3'} strokeWidth={ok ? 4.5 : 2} strokeLinecap="round">
              <title>{`${c.nombre}: ${ok ? `${fmtPct(v!.valor)} (${fmt(v!.den)} observados)` : 'sin datos suficientes'}`}</title>
            </polyline>
          ));
        })}
      </svg>
      <Escala texto={`${leyenda} (menos de ${minN})`} />
    </div>
  );
}

/** Lista de hallazgos calculados (cada uno con su cifra y su denominador). */
export function Hallazgos({ items }: { items: { icono?: ReactNode; texto: ReactNode }[] }) {
  if (!items.length) return <SinDatos />;
  return <ul className="vz-hallazgos">{items.map((x, i) => <li key={i}>{x.icono && <i aria-hidden>{x.icono}</i>}<span>{x.texto}</span></li>)}</ul>;
}

/**
 * Identificador visual del ámbito. Solo se mostraría un escudo o imagen con fuente y licencia
 * verificadas (registro vacío por ahora): en su lugar, un identificador NEUTRO con iniciales.
 */
export const EMBLEMAS: Record<string, { src: string; fuente: string; licencia: string }> = {};

export function Emblema({ municipio, tamano = 44 }: { municipio: Municipio; tamano?: number }) {
  const e = EMBLEMAS[municipio.id];
  if (e) return <img src={e.src} alt={`Escudo de ${municipio.nombre}`} title={`${e.fuente} · ${e.licencia}`} width={tamano} height={tamano} />;
  const iniciales = municipio.nombre.replace(/\(.*?\)/g, '').split(/\s+/).filter((w) => w.length > 2 && w[0] === w[0].toUpperCase()).slice(0, 2).map((w) => w[0]).join('');
  return (
    <span className="vz-emblema" style={{ width: tamano, height: tamano }} role="img" aria-label={`Identificador neutro de ${municipio.nombre} (sin escudo verificado)`} title="Identificador neutro: no hay un escudo con fuente y licencia verificadas">
      {iniciales || '·'}
    </span>
  );
}
