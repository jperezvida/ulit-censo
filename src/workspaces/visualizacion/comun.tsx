import { fmt } from '../../components/ui';
import type { BaseDatos } from '../../domain/db';
import { rankingCalles, SECTORES, UMBRAL_CALLE, type CriterioCalle, type DatosCampana, type FiltrosPanel, type OrigenDatos, type UnidadPanel } from '../../domain/panel';
import { Apilada, COLOR, fmtPct, Ranking, SinDatos } from './graficos';

/** Lo que recibe cada pestaña del cuadro de mando. */
export interface Contexto {
  db: BaseDatos;
  datos: DatosCampana;
  /** Establecimientos observados con los filtros globales aplicados. */
  unidades: UnidadPanel[];
  filtros: FiltrosPanel;
  setFiltros: (f: FiltrosPanel) => void;
  hayCp: boolean;
}

export const FUENTE_TXT = { confirmada: 'Clasificación 2026 confirmada', propuesta: 'Propuesta 2026 sin confirmar', historica: 'Texto histórico (sin convertir)', 'sin-clasificar': 'Sin clasificar' } as const;
export const FUENTE_COLOR = { confirmada: '#2a78d6', propuesta: '#eda100', historica: '#6250d6', 'sin-clasificar': '#c3cad6' } as const;
export const SECTOR_CORTO: Record<string, string> = { Comercio: 'Comercio', Servicios: 'Servicios', 'Hostelería y Restauración': 'Hostelería' };
const COMPOSICION = [...SECTORES, 'Sin clasificar', 'Vacíos'] as const;
const RESTO = '#e6eaf0';

export function FuentesClasificacion({ unidades }: { unidades: UnidadPanel[] }) {
  const ocup = unidades.filter((u) => !u.vacio);
  return <Apilada compacta etiqueta="Fuente de la clasificación" segmentos={(Object.keys(FUENTE_TXT) as (keyof typeof FUENTE_TXT)[]).map((k) => ({ t: FUENTE_TXT[k], n: ocup.filter((u) => u.fuenteClasificacion === k).length, color: FUENTE_COLOR[k] }))} />;
}

/**
 * Ranking de calles con la composición de cada una (sectores, sin clasificar, vacíos). Ocupados y
 * vacíos solo con calles que alcanzan el umbral; sectores en recuento absoluto.
 */
export function RankingCalles({ unidades, criterio, filtros, setFiltros, limite = 10, etiqueta }: { unidades: UnidadPanel[]; criterio: CriterioCalle; filtros: FiltrosPanel; setFiltros: (f: FiltrosPanel) => void; limite?: number; etiqueta?: string }) {
  const r = rankingCalles(unidades, criterio, UMBRAL_CALLE, limite);
  const nombre = etiqueta ?? (criterio === 'ocupados' ? 'Calles con más locales ocupados' : criterio === 'vacios' ? 'Calles con más locales vacíos' : `Calles con más establecimientos de ${criterio}`);
  if (!r.filas.length) return <SinDatos texto={r.porSector ? 'Ninguna calle tiene establecimientos de este sector con estos filtros.' : `Ninguna calle alcanza el umbral de ${UMBRAL_CALLE} establecimientos observados.`} />;
  const enfoque = criterio === 'ocupados' ? null : criterio === 'vacios' ? 'Vacíos' : criterio;
  return (
    <>
      <Ranking
        etiqueta={nombre}
        columnas={[criterio === 'ocupados' ? 'Ocupados' : criterio === 'vacios' ? 'Vacíos' : 'Estab.', criterio === 'ocupados' ? '% ocupación' : criterio === 'vacios' ? '% vacíos' : '% de la calle']}
        onClic={(id) => setFiltros({ ...filtros, calleId: id })}
        filas={r.filas.map((f) => ({
          clave: f.calleId,
          nombre: f.calle,
          n: f.n,
          // La barra muestra la composición de la calle; el criterio, en color pleno y el resto atenuado.
          segmentos: COMPOSICION.map((k) => ({ t: k, n: f.composicion[k], color: enfoque && k !== enfoque ? RESTO : COLOR[k] })).filter((s) => !enfoque || s.t === enfoque || s.n).sort((a, b) => (enfoque ? Number(b.t === enfoque) - Number(a.t === enfoque) : 0)),
          valor: fmt(f.n),
          extra: f.prop === null ? <span title={`Menos de ${UMBRAL_CALLE} observados`}>—*</span> : fmtPct(f.prop, 0),
        }))}
      />
      <div className="vz-leyenda">
        {(enfoque ? [enfoque, 'Resto de la calle'] : COMPOSICION).map((k) => <span key={k}><i style={{ background: k === 'Resto de la calle' ? RESTO : COLOR[k] }} />{SECTOR_CORTO[k] ?? k}</span>)}
        <span className="muted">
          · * % solo en calles con al menos {UMBRAL_CALLE} observados
          {r.porSector ? ` · ${fmt(r.consideradas)} de ${fmt(r.total)} calles con presencia` : ` · ${fmt(r.consideradas)} de ${fmt(r.total)} calles lo alcanzan`}
        </span>
      </div>
    </>
  );
}

const n = (x: number) => fmt(x);

/**
 * Texto del aviso de origen, calculado con los datos reales de la campaña (no un texto fijo): separa el
 * tipo de campaña del origen de la clasificación, la franquicia y la revisión digital.
 */
export function textosOrigen(o: OrigenDatos) {
  const c = o.clasificacion;
  const clas = [
    c.historica && `${n(c.historica)} con el texto original de ${o.anio} (sin convertir al catálogo 2026)`,
    c.confirmada && `${n(c.confirmada)} confirmadas en el modelo`,
    c.propuesta && `${n(c.propuesta)} propuestas sin confirmar`,
    c['sin-clasificar'] && `${n(c['sin-clasificar'])} sin clasificar`,
  ].filter(Boolean) as string[];
  const f = o.franquicia;
  const fran = [f.manual && `${n(f.manual)} comprobadas`, f.heredado && `${n(f.heredado)} heredadas (borrador)`, f.importado && `${n(f.importado)} importadas`, f.ninguno && `${n(f.ninguno)} sin dato`].filter(Boolean) as string[];
  const g = o.digital;
  const dig = [g.verificada && `${n(g.verificada)} verificadas en el modelo`, g.borrador && `${n(g.borrador)} en borrador o importadas`, g['sin-datos'] && `${n(g['sin-datos'])} sin datos`].filter(Boolean) as string[];
  const advertencias = [
    o.historica && 'Es una referencia histórica: no es la campaña 2026 ni la sustituye.',
    o.historica && (c.confirmada || g.verificada) && `«Confirmada» y «verificada» se refieren a la campaña de ${o.anio}, no son comprobaciones de 2026.`,
    o.demostracion && 'Datos de demostración: los estados «confirmada» y «verificada» son ficticios, no comprobaciones reales de campo.',
  ].filter(Boolean) as string[];
  return {
    titulo: o.historica ? `Histórico importado · ${o.anio}` : `Campaña ${o.anio}`,
    partes: [
      clas.length && { t: 'Clasificación', v: clas.join(' · ') },
      fran.length && { t: 'Franquicia', v: fran.join(' · ') },
      dig.length && { t: 'Presencia digital', v: dig.join(' · ') },
    ].filter(Boolean) as { t: string; v: string }[],
    advertencias,
  };
}

/** Aviso de origen de los datos: una línea, con el detalle desplegable. */
export function AvisoOrigen({ origen }: { origen: OrigenDatos }) {
  const t = textosOrigen(origen);
  if (!origen.historica && !origen.demostracion) return null;
  return (
    <details className={`vz-origen ${origen.historica ? 'historico' : ''}`} role="note" aria-label="Origen de los datos">
      <summary>
        <b>{t.titulo}</b>
        <span>{t.advertencias[0]}</span>
        <span className="vz-origen-mas">Origen de los datos</span>
      </summary>
      <dl>
        {t.partes.map((p) => <div key={p.t}><dt>{p.t}</dt><dd>{p.v}</dd></div>)}
      </dl>
      {t.advertencias.length > 1 && <ul>{t.advertencias.slice(1).map((a) => <li key={a}>{a}</li>)}</ul>}
    </details>
  );
}
