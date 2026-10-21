import type { ReactNode } from 'react';
import { fmt } from '../../components/ui';
import type { Parte, Proporcion } from '../../domain/panel';
import type { Calle, LngLat, Municipio } from '../../domain/types';

/**
 * Componentes de gráfico del dashboard (C1d-B). Genéricos: reciben partes ya calculadas, muestran
 * siempre el número absoluto y el denominador, y tienen un estado «sin datos». Añadir un indicador
 * nuevo no exige rehacerlos.
 */

export const fmtPct = (v: number | null, dec = 1) => (v === null ? '—' : `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: dec, minimumFractionDigits: 0 })} %`);
export const fmtNum = (v: number | null | undefined, dec = 1) => (v === null || v === undefined ? '—' : v.toLocaleString('es-ES', { maximumFractionDigits: dec }));
export const textoProp = (p: Proporcion) => (p.den ? `${fmtPct(p.n / p.den)} (${fmt(p.n)} de ${fmt(p.den)})` : 'sin datos');

export function SinDatos({ texto = 'Sin datos para estos filtros.' }: { texto?: string }) {
  return <div className="vz-vacio" role="note">{texto}</div>;
}

export function Bloque({ titulo, nota, children, ancho, etiqueta }: { titulo: ReactNode; nota?: ReactNode; children: ReactNode; ancho?: boolean; etiqueta?: string }) {
  return (
    <section className={`tarjeta vz-bloque ${ancho ? 'vz-ancho' : ''}`} aria-label={etiqueta ?? (typeof titulo === 'string' ? titulo : undefined)}>
      <h3>{titulo}</h3>
      {children}
      {nota && <p className="vz-nota">{nota}</p>}
    </section>
  );
}

export function Kpi({ etq, valor, sub, tono }: { etq: ReactNode; valor: ReactNode; sub?: ReactNode; tono?: 'aviso' | 'gris' }) {
  return (
    <div className={`vz-kpi ${tono ?? ''}`}>
      <span className="vz-kpi-etq">{etq}</span>
      <b className="num">{valor}</b>
      {sub && <span className="vz-kpi-sub">{sub}</span>}
    </div>
  );
}

/** Barras horizontales con número y porcentaje sobre `total` (por defecto, la suma). */
export function BarrasH({ partes, total, color = 'var(--azul)', colores, onClic, activa, limite }: { partes: Parte[]; total?: number; color?: string; colores?: Record<string, string>; onClic?: (clave: string) => void; activa?: string; limite?: number }) {
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
      {limite && partes.length > limite && <span className="vz-nota">y {partes.length - limite} más</span>}
      <span className="vz-nota">Denominador: {fmt(den)}.</span>
    </div>
  );
}

/** Barra apilada (100 %) con leyenda: cada segmento con su número y su porcentaje. */
export function Apilada({ segmentos, den, etiqueta }: { segmentos: { t: string; n: number; color: string }[]; den?: number; etiqueta?: string }) {
  const total = den ?? segmentos.reduce((a, s) => a + s.n, 0);
  if (!total) return <SinDatos />;
  return (
    <div className="vz-apilada" aria-label={etiqueta}>
      <div className="vz-apilada-barra">{segmentos.filter((s) => s.n).map((s) => <span key={s.t} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} title={`${s.t}: ${fmt(s.n)}`} />)}</div>
      <div className="vz-leyenda">{segmentos.map((s) => <span key={s.t}><i style={{ background: s.color }} />{s.t} <b className="num">{fmt(s.n)}</b> <span className="muted">{fmtPct(s.n / total)}</span></span>)}</div>
    </div>
  );
}

/** Histograma vertical (intervalos ya calculados). */
export function Histograma({ partes, color = 'var(--azul)', etiqueta }: { partes: Parte[]; color?: string; etiqueta?: string }) {
  const total = partes.reduce((a, p) => a + p.n, 0);
  if (!total) return <SinDatos />;
  const max = Math.max(...partes.map((p) => p.n), 1);
  return (
    <div className="vz-histo" aria-label={etiqueta} role="list">
      {partes.map((p) => (
        <div key={p.clave} className="vz-histo-col" role="listitem" title={`${p.etiqueta}: ${fmt(p.n)}`}>
          <span className="num vz-histo-n">{fmt(p.n)}</span>
          <span className="vz-histo-barra" style={{ height: `${(p.n / max) * 100}%`, background: color }} />
          <span className="vz-histo-t">{p.etiqueta}</span>
        </div>
      ))}
    </div>
  );
}

const escala = (v: number) => {
  // Escala secuencial de azul claro a azul intenso.
  const l = 95 - v * 55;
  return `hsl(214 80% ${l}%)`;
};

/** Mapa de calor en tabla (calle × indicador). Celdas sin datos suficientes: «—». */
export function MatrizCalor({ filas, columnas, minN }: { filas: { calle: string; n: number; celdas: ({ valor: number | null } & Proporcion)[] }[]; columnas: string[]; minN: number }) {
  if (!filas.length) return <SinDatos texto={`No hay calles con al menos ${minN} respuestas Sí/No.`} />;
  return (
    <div className="dat-tabla scroll-fino vz-matriz">
      <table className="tabla" aria-label="Mapa de calor por calle">
        <thead><tr><th>Calle</th><th className="num">Ocupados</th>{columnas.map((c) => <th key={c} className="num">{c}</th>)}</tr></thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.calle}>
              <td>{f.calle}</td><td className="num">{fmt(f.n)}</td>
              {f.celdas.map((c, i) => (
                <td key={i} className="num vz-celda" style={c.valor === null ? undefined : { background: escala(c.valor), color: c.valor > 0.6 ? '#fff' : undefined }} title={c.valor === null ? `Menos de ${minN} respuestas` : `${fmt(c.n)} de ${fmt(c.den)}`}>
                  {c.valor === null ? '—' : fmtPct(c.valor, 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="vz-escala"><span>0 %</span><i /><span>100 %</span><span className="muted">· «—»: menos de {minN} respuestas Sí/No</span></div>
    </div>
  );
}

/**
 * Mapa por CALLE sobre la geometría del callejero (no se inventan coordenadas de locales): cada
 * calle se colorea con el valor agregado de sus establecimientos.
 */
export function MapaCalles({ calles, valores, minN }: { calles: Calle[]; valores: Map<string, { valor: number | null; den: number }>; minN: number }) {
  const conGeo = calles.filter((c) => c.segmentos.some((s) => s.coords.length > 1));
  if (!conGeo.length) return <SinDatos texto="Las calles de este ámbito no tienen geometría fiable: se usa solo el mapa de calor por calle." />;
  const pts: LngLat[] = conGeo.flatMap((c) => c.segmentos.flatMap((s) => s.coords));
  const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const k = Math.cos(((y0 + y1) / 2) * (Math.PI / 180));
  const W = 640;
  const H = Math.max(200, Math.min(520, (W * (y1 - y0)) / Math.max(1e-9, (x1 - x0) * k)));
  const px = (p: LngLat) => `${(((p[0] - x0) / Math.max(1e-9, x1 - x0)) * (W - 20) + 10).toFixed(1)},${(H - 10 - ((p[1] - y0) / Math.max(1e-9, y1 - y0)) * (H - 20)).toFixed(1)}`;
  return (
    <div className="vz-mapa">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mapa por calle">
        {conGeo.map((c) => {
          const v = valores.get(c.id);
          const color = v && v.valor !== null && v.den >= minN ? escala(v.valor) : '#d6dbe3';
          return c.segmentos.map((s) => <polyline key={s.id} points={s.coords.map(px).join(' ')} fill="none" stroke={color} strokeWidth={v && v.den >= minN ? 4 : 2} strokeLinecap="round"><title>{`${c.nombre}: ${v && v.valor !== null && v.den >= minN ? fmtPct(v.valor) : 'sin datos suficientes'}`}</title></polyline>);
        })}
      </svg>
      <div className="vz-escala"><span>0 %</span><i /><span>100 %</span><span className="muted">· gris: sin datos suficientes (menos de {minN})</span></div>
    </div>
  );
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
