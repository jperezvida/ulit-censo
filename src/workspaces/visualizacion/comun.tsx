import { fmt } from '../../components/ui';
import type { BaseDatos } from '../../domain/db';
import { rankingCalles, SECTORES, UMBRAL_CALLE, type CriterioCalle, type DatosCampana, type FiltrosPanel, type UnidadPanel } from '../../domain/panel';
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
