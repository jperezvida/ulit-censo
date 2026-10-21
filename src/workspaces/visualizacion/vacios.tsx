import { useMemo } from 'react';
import { AlertTriangle, DoorOpen, MapPin, Percent, Route, Ruler, Target } from 'lucide-react';
import { fmt } from '../../components/ui';
import { bandasVacancia, concentracion, distribucion, estadisticos, histograma, pct, rankingCalles, UMBRAL_CALLE, type FilaRanking, type FiltrosPanel } from '../../domain/panel';
import { Bloque, COLOR, fmtNum, fmtPct, Histograma, Kpi, MapaCalles, Ranking } from './graficos';
import { RankingCalles, type Contexto } from './comun';

const FRANQUICIA_FILTRO_TXT: Record<NonNullable<FiltrosPanel['franquicia']>, string> = { si: 'Sí', no: 'No', pendiente: 'Pendiente o sin dato' };
const GRIS_VACIO = '#7d8ea8';

/**
 * Locales vacíos. Los filtros globales de sector y franquicia no se aplican aquí (lo resuelve la
 * página): un local vacío no tiene sector ni franquicia, así que esos filtros lo eliminarían siempre
 * y darían un cero engañoso. Aquí se explica al usuario y se ofrece quitarlos.
 */
export function Vacios({ db, unidades, hayCp, filtros, setFiltros }: Contexto) {
  const ignorados = [filtros.sector && `sector «${filtros.sector}»`, filtros.franquicia && `franquicia «${FRANQUICIA_FILTRO_TXT[filtros.franquicia]}»`].filter(Boolean) as string[];
  const vac = unidades.filter((u) => u.vacio);
  const medidas = vac.filter((u) => typeof u.metros === 'number').map((u) => u.metros!);
  const m = estadisticos(medidas);
  const tasa = pct({ n: vac.length, den: unidades.length });
  const bandas = bandasVacancia(unidades);
  const conc = concentracion(distribucion(vac, (u) => u.calleId));
  const peor = rankingCalles(unidades, 'vacios', UMBRAL_CALLE, Infinity).filas.filter((f) => f.prop !== null).sort((a, b) => (b.prop ?? 0) - (a.prop ?? 0) || b.vacios - a.vacios)[0];
  const porCp = useMemo(() => {
    const t = new Map<string, { n: number; vacios: number }>();
    for (const u of unidades) {
      if (!u.cp) continue;
      const x = t.get(u.cp) ?? { n: 0, vacios: 0 };
      x.n++;
      if (u.vacio) x.vacios++;
      t.set(u.cp, x);
    }
    return [...t].map(([cp, x]) => ({ cp, ...x, prop: x.vacios / x.n })).sort((a, b) => b.vacios - a.vacios);
  }, [unidades]);
  const mayorProp = porCp.filter((c) => c.n >= UMBRAL_CALLE).sort((a, b) => b.prop - a.prop)[0];
  const relacion = rankingCalles(unidades, 'ocupados', UMBRAL_CALLE, Infinity).filas.sort((a, b) => b.observados - a.observados).slice(0, 10);

  const callesAmbito = useMemo(() => [...new Set(unidades.map((u) => u.calleId))].map((id) => db.calles[id]).filter(Boolean), [unidades, db.calles]);
  const conGeo = callesAmbito.some((x) => x.segmentos.some((s) => s.coords.length > 1));
  const vacanciaCalle = useMemo(() => {
    const t = new Map<string, { valor: number | null; den: number }>();
    for (const f of rankingCalles(unidades, 'vacios', 1, Infinity).filas) t.set(f.calleId, { valor: f.vacios / f.observados, den: f.observados });
    return t;
  }, [unidades]);

  return (
    <>
      {ignorados.length > 0 && (
        <div className="t-info aviso vz-aviso c-12" role="note" aria-label="Filtros no aplicados">
          <AlertTriangle size={14} />
          <span className="esp">
            En esta pestaña no se aplica el filtro de {ignorados.join(' ni el de ')}: un local vacío no tiene sector ni franquicia, y filtrar por ellos daría siempre cero vacíos. Las cifras incluyen todos los establecimientos observados (con los demás filtros). En las otras pestañas el filtro sigue activo.
          </span>
          <button className="btn s" onClick={() => setFiltros({ ...filtros, sector: undefined, franquicia: undefined })}>Quitar estos filtros</button>
        </div>
      )}
      <div className="vz-kpis c-12" style={{ ['--n' as string]: 6 }} aria-label="Indicadores de locales vacíos">
        <Kpi icono={<DoorOpen size={14} />} color={GRIS_VACIO} etq="Locales vacíos" valor={fmt(vac.length)} sub={`de ${fmt(unidades.length)} establecimientos observados`} />
        <Kpi icono={<Percent size={14} />} color={GRIS_VACIO} etq="Tasa de vacío" valor={fmtPct(tasa)} sub={`vacíos ÷ observados · ocupación ${fmtPct(tasa === null ? null : 1 - tasa)}`} barra={tasa} />
        <Kpi icono={<Ruler size={14} />} color={GRIS_VACIO} etq="Fachada media" valor={m ? `${fmtNum(m.media)} m` : '—'} sub={m ? `mediana ${fmtNum(m.mediana)} m · ${fmt(m.n)} de ${fmt(vac.length)} con medida` : 'sin medidas'} />
        <Kpi icono={<Route size={14} />} color={GRIS_VACIO} etq="Calles con vacíos" valor={`${fmt(bandas.conVacios)} de ${fmt(bandas.consideradas)}`} sub={`calles con al menos ${UMBRAL_CALLE} observados`} barra={pct({ n: bandas.conVacios, den: bandas.consideradas })} />
        <Kpi icono={<Target size={14} />} color={GRIS_VACIO} etq="Concentración" valor={fmtPct(conc.prop, 0)} sub={`de los vacíos en ${fmt(conc.k)} calles (${fmt(conc.conValor)} calles con alguno)`} barra={conc.prop} />
        {hayCp && porCp[0]
          ? <Kpi icono={<MapPin size={14} />} color={GRIS_VACIO} etq="CP con más vacíos" valor={porCp[0].cp} sub={`${fmt(porCp[0].vacios)} de ${fmt(porCp[0].n)} observados (${fmtPct(porCp[0].prop, 0)})`} />
          : <Kpi icono={<MapPin size={14} />} color={GRIS_VACIO} etq="Calle con mayor tasa" valor={peor ? fmtPct(peor.prop, 0) : '—'} sub={peor ? `${peor.calle}: ${fmt(peor.vacios)} de ${fmt(peor.observados)}` : `ninguna calle con ${UMBRAL_CALLE} observados`} />}
      </div>

      <Bloque span={7} titulo="Calles con más locales vacíos*" sub={`Tasa de vacío del ámbito: ${fmtPct(tasa)}. Pulse una calle para filtrar.`}>
        <RankingCalles unidades={unidades} criterio="vacios" filtros={filtros} setFiltros={setFiltros} />
      </Bloque>
      <Bloque span={5} titulo="Longitud de fachada de los vacíos" sub={m ? `${fmt(m.n)} vacíos con medida · rango ${fmtNum(m.min)}–${fmtNum(m.max)} m · ${fmt(vac.length - m.n)} sin medida` : 'Sin medidas de fachada.'}>
        <Histograma etiqueta="Fachada" color={GRIS_VACIO} ejeX="Metros de fachada" partes={histograma(medidas, [0, 3, 5, 8, 12, 20, Infinity], ['<3', '3–5', '5–8', '8–12', '12–20', '≥20'])} />
      </Bloque>

      <Bloque span={5} titulo="Calles según su tasa de vacío" sub={`${fmt(bandas.consideradas)} calles con al menos ${UMBRAL_CALLE} observados (de ${fmt(bandas.total)}).`}>
        <Histograma etiqueta="Calles por tasa de vacío" color={GRIS_VACIO} partes={bandas.partes} ejeX="Tasa de vacío de la calle" />
      </Bloque>
      {hayCp && porCp.length ? (
        <Bloque span={7} titulo="Vacíos por código postal" etiqueta="Vacíos por código postal" sub="El CP solo consta si figura en el origen: no se deduce de la calle ni del municipio." nota={mayorProp ? `Mayor proporción de vacíos: CP ${mayorProp.cp} (${fmtPct(mayorProp.prop)}, ${fmt(mayorProp.vacios)} de ${fmt(mayorProp.n)}). * Porcentaje solo con al menos ${UMBRAL_CALLE} observados.` : undefined}>
          <table className="vz-tabla">
            <thead><tr><th>CP</th><th className="num">Observados</th><th className="num">Vacíos</th><th className="num">% vacíos</th></tr></thead>
            <tbody>{porCp.map((c) => (
              <tr key={c.cp}>
                <td>{c.cp}</td><td className="num">{fmt(c.n)}</td><td className="num"><b>{fmt(c.vacios)}</b></td>
                <td className="num"><span className="vz-celda-barra">{c.n >= UMBRAL_CALLE && <span className="vz-pista"><span style={{ width: `${c.prop * 100}%`, background: GRIS_VACIO }} /></span>}{c.n >= UMBRAL_CALLE ? fmtPct(c.prop) : '—*'}</span></td>
              </tr>
            ))}</tbody>
          </table>
          {porCp.length < 6 && (
            <>
              <h4 className="vz-sub">Relación vacíos / total en las calles con más locales</h4>
              <RelacionCalles filas={relacion.slice(0, 5)} onClic={(id) => setFiltros({ ...filtros, calleId: id })} />
            </>
          )}
        </Bloque>
      ) : (
        <Bloque span={7} titulo="Relación vacíos / total por calle" sub="Las diez calles con más establecimientos observados: ocupados y vacíos.">
          <RelacionCalles filas={relacion} onClic={(id) => setFiltros({ ...filtros, calleId: id })} />
        </Bloque>
      )}

      {conGeo && (
        <Bloque span={12} titulo="Mapa: tasa de vacío por calle" sub="Cada calle del callejero, coloreada con su proporción de locales vacíos." nota="No se inventan coordenadas: se colorea la geometría de cada calle con el valor agregado de sus establecimientos.">
          <MapaCalles calles={callesAmbito} valores={vacanciaCalle} minN={UMBRAL_CALLE} leyenda="gris: pocos observados" />
        </Bloque>
      )}
    </>
  );
}

/** Ocupados y vacíos de cada calle (barra apilada) con la proporción de vacíos. */
function RelacionCalles({ filas, onClic }: { filas: FilaRanking[]; onClic: (id: string) => void }) {
  return (
    <>
      <Ranking
        etiqueta="Relación vacíos / total por calle" columnas={['Vacíos', '% vacíos']} onClic={onClic}
        filas={filas.map((f) => ({ clave: f.calleId, nombre: f.calle, n: f.observados, segmentos: [{ t: 'Ocupados', n: f.ocupados, color: COLOR.acento }, { t: 'Vacíos', n: f.vacios, color: GRIS_VACIO }], valor: `${fmt(f.vacios)} / ${fmt(f.observados)}`, extra: fmtPct(f.vacios / f.observados, 0) }))}
      />
      <div className="vz-leyenda"><span><i style={{ background: COLOR.acento }} />Ocupados</span><span><i style={{ background: GRIS_VACIO }} />Vacíos</span></div>
    </>
  );
}
