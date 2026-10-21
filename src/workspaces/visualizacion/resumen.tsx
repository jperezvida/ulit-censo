import { useMemo, useState } from 'react';
import { Building2, DoorOpen, Globe, Link2, MapPinned, Ruler, Store, Tag, TrendingUp, Users } from 'lucide-react';
import { fmt } from '../../components/ui';
import {
  adopcion, bandasVacancia, concentracion, distribucion, estadisticos, perfilGrupos, pct, resumen, SECTORES, UMBRAL_CALLE, type CriterioCalle, type Sector,
} from '../../domain/panel';
import { Anillo, Apilada, Bloque, COLOR, Conmutador, fmtNum, fmtPct, Hallazgos, Histograma, Kpi, MapaCalles } from './graficos';
import { FuentesClasificacion, RankingCalles, type Contexto } from './comun';

const CRITERIOS: { v: CriterioCalle; t: string }[] = [
  { v: 'ocupados', t: 'Ocupados' }, { v: 'Comercio', t: 'Comercio' }, { v: 'Servicios', t: 'Servicios' }, { v: 'Hostelería y Restauración', t: 'Hostelería' }, { v: 'vacios', t: 'Vacíos' },
];

/** Pestaña principal: el resultado del censo de un vistazo, con sus denominadores. */
export function Resumen({ db, datos, unidades, filtros, setFiltros }: Contexto) {
  const [criterio, setCriterio] = useState<CriterioCalle>('ocupados');
  const r = resumen(unidades);
  const ocup = unidades.filter((u) => !u.vacio);
  const sectores = distribucion(ocup, (u) => u.sector, 'Sin clasificar');
  const grupos = [...SECTORES.map((s) => ({ clave: s, etiqueta: s, n: ocup.filter((u) => u.sector === s).length })), { clave: 'Sin clasificar', etiqueta: 'Sin clasificar', n: ocup.filter((u) => !u.sector).length }, { clave: 'Vacíos', etiqueta: 'Locales vacíos', n: r.vacios }];
  const c = datos.correspondencias;
  const pend = c.probable + c.dudosa + c.sinVinculo;
  const perfil = perfilGrupos(unidades, (u) => u.sector);
  const conc = concentracion(distribucion(ocup, (u) => u.calleId));
  const web = adopcion(unidades, 'web');
  const metros = estadisticos(unidades.filter((u) => u.vacio && typeof u.metros === 'number').map((u) => u.metros!));
  const mayor = sectores.find((x) => SECTORES.includes(x.clave as Sector));
  const bandas = bandasVacancia(unidades);
  const altas = bandas.partes.filter((b) => b.clave === '3' || b.clave === '4').reduce((a, b) => a + b.n, 0);

  const callesAmbito = useMemo(() => [...new Set(unidades.map((u) => u.calleId))].map((id) => db.calles[id]).filter(Boolean), [unidades, db.calles]);
  const conGeo = callesAmbito.some((x) => x.segmentos.some((s) => s.coords.length > 1));
  const ocupacionCalle = useMemo(() => {
    const m = new Map<string, { valor: number | null; den: number }>();
    for (const u of unidades) {
      const x = m.get(u.calleId) ?? { valor: 0, den: 0 };
      x.den++;
      x.valor = (x.valor ?? 0) + (u.vacio ? 0 : 1);
      m.set(u.calleId, x);
    }
    for (const x of m.values()) x.valor = x.den ? x.valor! / x.den : null;
    return m;
  }, [unidades]);

  const destacados = [
    mayor && r.ocupados && { icono: <Store size={14} />, texto: <><b>{mayor.etiqueta}</b> es el grupo con más establecimientos ocupados: <b>{fmtPct(mayor.n / r.ocupados, 0)}</b> ({fmt(mayor.n)} de {fmt(r.ocupados)}).</> },
    conc.prop !== null && conc.conValor > conc.k && { icono: <MapPinned size={14} />, texto: <>Las <b>{conc.k} calles</b> con más actividad reúnen el <b>{fmtPct(conc.prop, 0)}</b> de los ocupados ({fmt(conc.top)} de {fmt(conc.total)}; {fmt(conc.conValor)} calles con actividad).</> },
    bandas.consideradas > 0 && { icono: <DoorOpen size={14} />, texto: <><b>{fmt(altas)}</b> de {fmt(bandas.consideradas)} calles con al menos {UMBRAL_CALLE} observados tienen <b>más del 40 % de locales vacíos</b>.</> },
    web.den > 0 && { icono: <Globe size={14} />, texto: <>El <b>{fmtPct(web.n / web.den, 0)}</b> de los ocupados con respuesta tiene página web ({fmt(web.n)} de {fmt(web.den)}; {fmt(r.ocupados - web.den)} sin respuesta Sí/No).</> },
    !web.den && metros && { icono: <Ruler size={14} />, texto: <>Los vacíos con medida tienen una fachada media de <b>{fmtNum(metros.media)} m</b> (mediana {fmtNum(metros.mediana)} m; {fmt(metros.n)} con dato).</> },
  ].filter(Boolean) as { icono: JSX.Element; texto: JSX.Element }[];

  const ocupPct = pct(r.ocupacion);
  return (
    <>
      <div className="c-12 vz-grid" style={{ marginTop: 0 }} aria-label="Indicadores principales">
        <div className="vz-heroe c-4">
          <span className="vz-rotulo">Establecimientos observados</span>
          <span className="vz-heroe-n num">{fmt(r.establecimientos)}</span>
          <p>{fmt(r.locales)} locales físicos identificados{r.sinLocal ? ` · ${fmt(r.sinLocal)} sin local identificado` : ''}.</p>
          <div className="vz-heroe-barra" aria-hidden><span style={{ width: `${(ocupPct ?? 0) * 100}%` }} /><span style={{ flex: 1 }} /></div>
          <div className="vz-heroe-leyenda"><span>Ocupados <b className="num">{fmt(r.ocupados)}</b></span><span>Vacíos <b className="num">{fmt(r.vacios)}</b></span></div>
          <div className="vz-heroe-pie">
            <span>Tasa de ocupación<b className="num">{fmtPct(ocupPct)}</b></span>
            <span>{datos.registrosCensales > 0 ? <>Registros censales<b className="num">{fmt(datos.registrosCensales)}</b></> : <>Calles con registros<b className="num">{fmt(datos.callesConRegistros)}</b></>}</span>
          </div>
        </div>
        <div className="vz-kpis c-8" style={{ ['--n' as string]: 3 }}>
          <Kpi icono={<Building2 size={14} />} etq="Locales físicos identificados" valor={fmt(r.locales)} sub={r.sinLocal ? `${fmt(r.sinLocal)} establecimientos sin local` : 'todos los establecimientos con local'} />
          <Kpi icono={<Users size={14} />} etq="Negocios" valor={fmt(r.negocios)} sub="distintos, en establecimientos ocupados" />
          <Kpi icono={<DoorOpen size={14} />} etq="Locales vacíos" valor={fmt(r.vacios)} sub={`${fmtPct(pct({ n: r.vacios, den: r.establecimientos }))} de ${fmt(r.establecimientos)} observados`} barra={pct({ n: r.vacios, den: r.establecimientos })} color="#7d8ea8" />
          <Kpi icono={<Tag size={14} />} etq="Franquicias (Sí)" valor={fmtPct(pct(r.franquicias))} sub={`${fmt(r.franquicias.n)} de ${fmt(r.franquicias.den)} con respuesta · ${fmt(r.franquiciasPendientes)} pendientes`} barra={pct(r.franquicias)} />
          <Kpi icono={<Link2 size={14} />} etq="Correspondencias pendientes" valor={fmt(pend)} sub={pend ? `${fmt(c.probable)} probables · ${fmt(c.dudosa)} dudosas · ${fmt(c.sinVinculo)} sin vínculo` : 'registro–local sin confirmar'} tono={pend ? 'aviso' : undefined} />
          <Kpi icono={<TrendingUp size={14} />} etq="Cobertura del ámbito" valor={fmtPct(pct({ n: datos.callesConRegistros, den: datos.callesAmbito }), 0)} sub={`${fmt(datos.callesConRegistros)} de ${fmt(datos.callesAmbito)} calles con registros`} barra={pct({ n: datos.callesConRegistros, den: datos.callesAmbito })} color="#1baf7a" />
        </div>
      </div>

      <Bloque span={5} titulo="Distribución por grandes grupos" etiqueta="Distribución por sector" sub="Sobre todos los establecimientos observados. Pulse un sector para filtrar.">
        <Anillo
          etiqueta="Distribución por grandes grupos" partes={grupos} colores={COLOR} centro={fmt(r.establecimientos)} sub="observados" activa={filtros.sector}
          onClic={(s) => SECTORES.includes(s as Sector) && setFiltros({ ...filtros, sector: filtros.sector === s ? undefined : (s as Sector) })}
        />
        <h4 className="vz-sub">Fuente de la clasificación de los ocupados</h4>
        <FuentesClasificacion unidades={unidades} />
      </Bloque>
      <Bloque span={7} titulo="Calles más relevantes" sub="Barra: composición de cada calle. Pulse una calle para filtrar." acciones={<Conmutador etiqueta="Criterio del ranking" valor={criterio} opciones={CRITERIOS} onCambio={setCriterio} />}>
        <RankingCalles unidades={unidades} criterio={criterio} filtros={filtros} setFiltros={setFiltros} limite={8} />
      </Bloque>

      <Bloque span={4} titulo="Datos destacados" sub="Calculados sobre los filtros actuales.">
        <Hallazgos items={destacados} />
      </Bloque>
      <Bloque span={8} titulo="Perfil de los sectores" sub="Ocupados de cada sector. Franquicia y canales: Sí entre las respuestas Sí/No." nota="Las proporciones solo usan respuestas Sí/No: «pendiente», «sin información» y «no aplicable» no cuentan como «No».">
        <table className="vz-tabla" aria-label="Perfil de los sectores">
          <thead><tr><th>Sector</th><th className="num">Establecimientos</th><th className="num">% ocupados</th><th className="num">Franquicia</th><th className="num">Web</th><th className="num">Google</th><th className="num">Venta online</th></tr></thead>
          <tbody>
            {SECTORES.map((s) => {
              const g = perfil.find((x) => x.grupo === s);
              const celda = (p?: { n: number; den: number }) => (p && p.den ? <span title={`${fmt(p.n)} de ${fmt(p.den)}`}>{fmtPct(p.n / p.den, 0)}</span> : <span className="muted">—</span>);
              return (
                <tr key={s} className={filtros.sector === s ? 'on' : ''}>
                  <td><span className="vz-leyenda"><span><i style={{ background: COLOR[s] }} />{s}</span></span></td>
                  <td className="num"><span className="vz-celda-barra"><span className="vz-pista"><span style={{ width: `${((g?.n ?? 0) / Math.max(1, ...perfil.map((x) => x.n))) * 100}%`, background: COLOR[s] }} /></span>{fmt(g?.n ?? 0)}</span></td>
                  <td className="num">{fmtPct(r.ocupados ? (g?.n ?? 0) / r.ocupados : null, 0)}</td>
                  <td className="num">{celda(g?.franquicia)}</td>
                  <td className="num">{celda(g?.adopcion.web)}</td>
                  <td className="num">{celda(g?.adopcion.googleBusiness)}</td>
                  <td className="num">{celda(g?.adopcion.ventaOnline)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td className="muted">Sin clasificar</td><td className="num muted">{fmt(ocup.filter((u) => !u.sector).length)}</td><td className="num muted">{fmtPct(r.ocupados ? ocup.filter((u) => !u.sector).length / r.ocupados : null, 0)}</td><td colSpan={4} /></tr></tfoot>
        </table>
        <h4 className="vz-sub">Peso de cada sector entre los {fmt(r.ocupados)} ocupados</h4>
        <Apilada compacta etiqueta="Peso de cada sector" segmentos={[...SECTORES.map((s) => ({ t: s, n: ocup.filter((u) => u.sector === s).length, color: COLOR[s] })), { t: 'Sin clasificar', n: ocup.filter((u) => !u.sector).length, color: COLOR['Sin clasificar'] }]} />
      </Bloque>

      {conGeo ? (
        <Bloque span={8} titulo="Vista territorial: ocupación por calle" sub="Cada calle del callejero, coloreada con su tasa de ocupación." nota="No se inventan coordenadas de locales: se colorea la geometría de cada calle con el valor agregado de sus establecimientos.">
          <MapaCalles calles={callesAmbito} valores={ocupacionCalle} minN={UMBRAL_CALLE} leyenda="gris: pocos observados" />
        </Bloque>
      ) : (
        <Bloque span={8} titulo="Vista territorial: calles según su tasa de vacío" sub={`${fmt(bandas.consideradas)} calles con al menos ${UMBRAL_CALLE} observados (de ${fmt(bandas.total)}).`} nota="Las calles de este ámbito no tienen geometría fiable: en lugar de un mapa (no se inventan coordenadas) se muestra el reparto de las calles por su tasa de vacío.">
          <Histograma etiqueta="Calles por tasa de vacío" color="#7d8ea8" partes={bandas.partes} ejeX="Tasa de vacío de la calle" />
        </Bloque>
      )}
      <Bloque span={4} titulo="Cómo leer estas cifras" sub="Cada cifra tiene su propio denominador.">
        <dl className="vz-def">
          {datos.registrosCensales > 0 && <><dt>Registros censales</dt><dd>{fmt(datos.registrosCensales)} filas importadas; {fmt(datos.registrosSinEstablecimiento)} sin establecimiento observado.</dd></>}
          <dt>Observados</dt><dd>{fmt(r.establecimientos)}: la unidad de todos los gráficos.</dd>
          <dt>Locales</dt><dd>{fmt(r.locales)} físicos distintos; un local puede no estar identificado.</dd>
          <dt>Ocupación</dt><dd>ocupados ÷ observados ({fmt(r.ocupados)} ÷ {fmt(r.establecimientos)}).</dd>
          <dt>Franquicia y canales</dt><dd>Sí ÷ (Sí + No): nunca cuentan los pendientes.</dd>
          <dt>Calles</dt><dd>% solo con al menos {UMBRAL_CALLE} observados.</dd>
          {r.fechas && <><dt>Periodo</dt><dd>{r.fechas.desde} a {r.fechas.hasta} ({fmt(r.fechas.n)} con fecha).</dd></>}
        </dl>
      </Bloque>
    </>
  );
}
