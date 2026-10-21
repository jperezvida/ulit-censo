import { Globe, Layers, MapPin, PieChart, Store, Tag } from 'lucide-react';
import { fmt } from '../../components/ui';
import { concentracion, distribucion, filtrar, perfilGrupos, RESPUESTAS, SECTORES, UMBRAL_CALLE, VARIABLES_PRESENCIA, type Sector } from '../../domain/panel';
import { Apilada, BarrasH, Bloque, COLOR, COLOR_RESP, fmtPct, Hallazgos, Kpi, valorProp } from './graficos';
import { FuentesClasificacion, RankingCalles, SECTOR_CORTO, type Contexto } from './comun';

const NIVEL: Record<Sector, [string, string]> = {
  Comercio: ['Grupos de comercio', 'Actividades más frecuentes (subgrupo)'],
  Servicios: ['Subgrupos de servicios', 'Servicios más frecuentes'],
  'Hostelería y Restauración': ['Tipos de establecimiento', 'Actividades más frecuentes'],
};

/** Pestañas de Comercio, Servicios y Hostelería: el sector en detalle y frente a los demás. */
export function SectorTab({ sector, datos, unidades, filtros, setFiltros, hayCp }: Contexto & { sector: Sector }) {
  const base = filtrar(datos.unidades, { ...filtros, sector: undefined });
  const ocupTodos = base.filter((u) => !u.vacio);
  const us = unidades.filter((u) => !u.vacio);
  const color = COLOR[sector];
  const n2 = distribucion(us, (u) => u.nivel2, 'Sin detalle');
  const n3 = distribucion(us, (u) => u.nivel3, 'Sin detalle');
  const perfil = perfilGrupos(base, (u) => u.sector);
  const propio = perfil.find((g) => g.grupo === sector);
  const resto = perfilGrupos(base, (u) => (u.sector && u.sector !== sector ? 'resto' : undefined))[0];
  const conc = concentracion(distribucion(us, (u) => u.calleId));
  const franq = { n: us.filter((u) => u.franquicia === 'si').length, den: us.filter((u) => u.franquicia === 'si' || u.franquicia === 'no').length };
  const peso = ocupTodos.length ? us.length / ocupTodos.length : null;
  const pesoObs = base.length ? us.length / base.length : null;
  const [nivel2, nivel3] = NIVEL[sector];

  const comparar = (a: number | null, b: number | null) => (a === null || b === null ? null : a > b + 0.02 ? 'por encima' : a < b - 0.02 ? 'por debajo' : 'en línea');
  const fr = comparar(valorProp(franq), resto ? valorProp(resto.franquicia) : null);
  const web = comparar(propio ? valorProp(propio.adopcion.web) : null, resto ? valorProp(resto.adopcion.web) : null);
  const hallazgos = [
    n2[0] && us.length && { icono: <Layers size={14} />, texto: <><b>{n2[0].etiqueta}</b> es la categoría principal: <b>{fmtPct(n2[0].n / us.length, 0)}</b> del sector ({fmt(n2[0].n)} de {fmt(us.length)}).</> },
    conc.prop !== null && conc.conValor > conc.k && { icono: <MapPin size={14} />, texto: <>Las <b>{conc.k} calles</b> principales concentran el <b>{fmtPct(conc.prop, 0)}</b> del sector; está presente en {fmt(conc.conValor)} calles.</> },
    fr && { icono: <Tag size={14} />, texto: <>La franquicia está <b>{fr}</b> de los demás sectores ({fmtPct(valorProp(franq), 0)} frente a {fmtPct(valorProp(resto!.franquicia), 0)}, sobre respuestas Sí/No).</> },
    web && { icono: <Globe size={14} />, texto: <>La presencia web está <b>{web}</b> de los demás sectores ({fmtPct(valorProp(propio!.adopcion.web), 0)} frente a {fmtPct(valorProp(resto!.adopcion.web), 0)}).</> },
  ].filter(Boolean) as { icono: JSX.Element; texto: JSX.Element }[];

  const porCp = hayCp ? [...new Set(base.map((u) => u.cp).filter(Boolean))].map((cp) => {
    const enCp = base.filter((u) => u.cp === cp);
    const oc = enCp.filter((u) => !u.vacio);
    const s = oc.filter((u) => u.sector === sector);
    return { cp: cp!, obs: enCp.length, ocup: oc.length, n: s.length, prop: oc.length >= UMBRAL_CALLE ? s.length / oc.length : null };
  }).sort((a, b) => b.n - a.n) : [];

  const filasComp: { t: string; v: (g?: (typeof perfil)[number]) => string }[] = [
    { t: 'Establecimientos', v: (g) => fmt(g?.n ?? 0) },
    { t: 'Peso sobre los ocupados', v: (g) => fmtPct(ocupTodos.length ? (g?.n ?? 0) / ocupTodos.length : null, 0) },
    { t: 'Franquicia (Sí)', v: (g) => fmtPct(g ? valorProp(g.franquicia) : null, 0) },
    ...VARIABLES_PRESENCIA.slice(0, 4).map((x) => ({ t: x.t, v: (g?: (typeof perfil)[number]) => fmtPct(g ? valorProp(g.adopcion[x.v]) : null, 0) })),
  ];

  return (
    <>
      <div className="vz-kpis c-12" style={{ ['--n' as string]: 6 }} aria-label={`Indicadores de ${sector}`}>
        <Kpi icono={<Store size={14} />} color={color} etq="Establecimientos" valor={fmt(us.length)} sub={`de ${SECTOR_CORTO[sector].toLowerCase()} con los filtros actuales`} />
        <Kpi icono={<PieChart size={14} />} color={color} etq="Peso en ocupados" valor={fmtPct(peso)} sub={`${fmt(us.length)} de ${fmt(ocupTodos.length)} ocupados`} barra={peso} />
        <Kpi icono={<Layers size={14} />} color={color} etq="Peso en observados" valor={fmtPct(pesoObs)} sub={`${fmt(us.length)} de ${fmt(base.length)} observados (con vacíos)`} barra={pesoObs} />
        <Kpi icono={<Tag size={14} />} color={color} etq="Franquicias (Sí)" valor={fmtPct(valorProp(franq))} sub={`${fmt(franq.n)} de ${fmt(franq.den)} con respuesta`} barra={valorProp(franq)} />
        <Kpi icono={<Globe size={14} />} color={color} etq="Página web" valor={fmtPct(propio ? valorProp(propio.adopcion.web) : null)} sub={propio ? `${fmt(propio.adopcion.web.n)} de ${fmt(propio.adopcion.web.den)} con respuesta` : 'sin datos'} barra={propio ? valorProp(propio.adopcion.web) : null} />
        <Kpi icono={<MapPin size={14} />} color={color} etq="Google Business" valor={fmtPct(propio ? valorProp(propio.adopcion.googleBusiness) : null)} sub={propio ? `${fmt(propio.adopcion.googleBusiness.n)} de ${fmt(propio.adopcion.googleBusiness.den)} con respuesta` : 'sin datos'} barra={propio ? valorProp(propio.adopcion.googleBusiness) : null} />
      </div>

      <Bloque span={6} titulo={nivel2} sub={`Reparto de los ${fmt(us.length)} establecimientos del sector.`}>
        <BarrasH partes={n2} color={color} limite={10} total={us.length} />
      </Bloque>
      <Bloque span={6} titulo={nivel3} sub="Las diez más frecuentes.">
        <BarrasH partes={n3} color={color} limite={10} total={us.length} />
      </Bloque>

      <Bloque span={7} titulo={`Calles con más ${SECTOR_CORTO[sector].toLowerCase()}`} etiqueta={`Calles con más establecimientos de ${sector}`} sub="Recuento absoluto; «% de la calle»: peso del sector entre los observados de la calle. Pulse para filtrar.">
        <RankingCalles unidades={base} criterio={sector} filtros={filtros} setFiltros={setFiltros} />
      </Bloque>
      <Bloque span={5} titulo="Concentración y lectura" sub="Calculado con los filtros actuales.">
        <div className="vz-dato-grande"><b className="num">{fmtPct(conc.prop, 0)}</b><span>del sector en sus {fmt(conc.k)} calles principales</span></div>
        <Hallazgos items={hallazgos} />
      </Bloque>

      <Bloque span={7} titulo="Comparación con los otros sectores" sub="Ocupados de cada sector con los mismos filtros. Canales y franquicia: Sí entre Sí/No.">
        <table className="vz-tabla" aria-label="Comparación con los otros sectores">
          <thead><tr><th>Indicador</th>{SECTORES.map((s) => <th key={s} className="num"><span className="vz-leyenda" style={{ justifyContent: 'flex-end' }}><span><i style={{ background: COLOR[s] }} />{SECTOR_CORTO[s]}</span></span></th>)}</tr></thead>
          <tbody>{filasComp.map((f) => <tr key={f.t}><td>{f.t}</td>{SECTORES.map((s) => <td key={s} className="num" style={s === sector ? { fontWeight: 700, background: 'var(--azul-suave)' } : undefined}>{f.v(perfil.find((g) => g.grupo === s))}</td>)}</tr>)}</tbody>
        </table>
      </Bloque>
      <Bloque span={5} titulo="Franquicia y fuente de la clasificación" nota={us.some((u) => u.fuenteClasificacion === 'historica') ? 'Las clasificaciones con texto histórico son el texto original: no se han convertido al catálogo 2026.' : undefined}>
        <h4 className="vz-sub">Franquicia</h4>
        <Apilada compacta etiqueta="Franquicia" segmentos={RESPUESTAS.filter((r) => r.r !== 'na').map((r) => ({ t: r.t, n: us.filter((u) => (u.franquicia ?? 'pendiente') === r.r).length, color: COLOR_RESP[r.r] }))} />
        <h4 className="vz-sub">Fuente de la clasificación</h4>
        <FuentesClasificacion unidades={us} />
      </Bloque>

      {porCp.length > 0 && (
        <Bloque span={12} titulo="Por código postal" sub={`El CP solo consta si figura en el origen. «% sobre ocupados» solo con al menos ${UMBRAL_CALLE} ocupados.`}>
          <table className="vz-tabla" aria-label="Sector por código postal">
            <thead><tr><th>CP</th><th className="num">Observados</th><th className="num">Ocupados</th><th className="num">{SECTOR_CORTO[sector]}</th><th className="num">% sobre ocupados</th></tr></thead>
            <tbody>{porCp.map((c) => <tr key={c.cp}><td>{c.cp}</td><td className="num">{fmt(c.obs)}</td><td className="num">{fmt(c.ocup)}</td><td className="num"><b>{fmt(c.n)}</b></td><td className="num"><span className="vz-celda-barra">{c.prop !== null && <span className="vz-pista"><span style={{ width: `${c.prop * 100}%`, background: color }} /></span>}{c.prop === null ? '—*' : fmtPct(c.prop, 0)}</span></td></tr>)}</tbody>
          </table>
        </Bloque>
      )}
    </>
  );
}
