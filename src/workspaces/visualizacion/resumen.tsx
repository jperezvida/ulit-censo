import { useMemo, useState } from 'react';
import { DoorOpen, Globe, MapPin, Store, UtensilsCrossed } from 'lucide-react';
import { fmt } from '../../components/ui';
import {
  adopcion, concentracion, distribucion, filtrar, origenDatos, pct, perfilGrupos, rankingCalles, resumen, SECTORES, UMBRAL_CALLE, type CriterioCalle, type Sector, type UnidadPanel,
} from '../../domain/panel';
import type { Id } from '../../domain/types';
import { Apilada, Bloque, COLOR, Conmutador, fmtPct, Hallazgos, SinDatos } from './graficos';
import { textosOrigen, type Contexto } from './comun';
import { CAPAS, MapaTerritorial, MatrizTerritorial, TONO_CAPA, type CapaMapa } from './mapa';

const RANKINGS: { criterio: CriterioCalle; titulo: string; color: string }[] = [
  { criterio: 'Comercio', titulo: 'Comercio', color: COLOR.Comercio },
  { criterio: 'Servicios', titulo: 'Servicios', color: COLOR.Servicios },
  { criterio: 'Hostelería y Restauración', titulo: 'Hostelería y restauración', color: COLOR['Hostelería y Restauración'] },
  { criterio: 'vacios', titulo: 'Locales vacíos', color: TONO_CAPA.vacios },
];

/** Uno de los cuatro rankings simultáneos (top 5), sincronizado con el mapa. */
function RankingMini({ unidades, criterio, titulo, color, sobre, fijada, onSobre, onFijar }: {
  unidades: UnidadPanel[]; criterio: CriterioCalle; titulo: string; color: string; sobre: Id | null; fijada: Id | null; onSobre: (id: Id | null) => void; onFijar: (id: Id | null) => void;
}) {
  const r = rankingCalles(unidades, criterio, UMBRAL_CALLE, 5);
  const max = Math.max(1, ...r.filas.map((f) => f.n));
  return (
    <section className="vz-rank" aria-label={`Calles con más ${titulo.toLowerCase()}`}>
      <header>
        <i style={{ background: color }} aria-hidden />
        <h3>{titulo}</h3>
        <span title={r.porSector ? 'Calles con al menos un establecimiento del grupo' : `Calles con al menos ${UMBRAL_CALLE} observados`}>{r.porSector ? `${fmt(r.consideradas)} calles` : `${fmt(r.consideradas)} evaluables`}</span>
      </header>
      {r.filas.length ? (
        <ol onPointerLeave={() => onSobre(null)}>
          {r.filas.map((f, i) => (
            <li key={f.calleId} className={`${f.calleId === sobre ? 'sobre' : ''} ${f.calleId === fijada ? 'fijada' : ''}`} onPointerEnter={() => onSobre(f.calleId)}>
              <span className="vz-rank-pos">{i + 1}</span>
              <button className="vz-rank-calle" onClick={() => onFijar(fijada === f.calleId ? null : f.calleId)} onFocus={() => onSobre(f.calleId)} onBlur={() => onSobre(null)} title={`${f.calle}: ${fmt(f.n)} de ${fmt(f.observados)} observados`}>{f.calle}</button>
              <span className="vz-rank-barra" aria-hidden><span style={{ width: `${(f.n / max) * 100}%`, background: color }} /></span>
              <b className="num">{fmt(f.n)}</b>
              <span className="vz-rank-pct num" title={f.prop === null ? `Menos de ${UMBRAL_CALLE} observados en la calle` : '% de la calle'}>{f.prop === null ? '—' : fmtPct(f.prop, 0)}</span>
            </li>
          ))}
        </ol>
      ) : <SinDatos texto={r.porSector ? 'Ninguna calle con este grupo.' : `Ninguna calle con ${UMBRAL_CALLE} observados.`} />}
    </section>
  );
}

/**
 * Resumen: el resultado principal del censo. Primera pantalla: cinco indicadores, el mapa territorial
 * (o la matriz calle × sector si no hay geometría) y los cuatro rankings simultáneos, vinculados.
 */
export function Resumen({ db, datos, unidades, filtros, setFiltros }: Contexto) {
  const [capa, setCapa] = useState<CapaMapa>('ocupacion');
  const [sobre, setSobre] = useState<Id | null>(null);
  const [fijada, setFijada] = useState<Id | null>(null);
  const r = resumen(unidades);
  const ocup = unidades.filter((u) => !u.vacio);
  // Mapa y rankings comparan los cuatro grupos: no aplican los filtros de sector ni franquicia (los vacíos
  // no los tienen y anularían la comparación); sí el código postal y la calle.
  const territorio = useMemo(() => filtrar(datos.unidades, { cp: filtros.cp, calleId: filtros.calleId }), [datos.unidades, filtros.cp, filtros.calleId]);
  const ignorados = [filtros.sector && `filtro de sector «${filtros.sector}»`, filtros.franquicia && 'filtro de franquicia'].filter(Boolean) as string[];
  const conGeo = useMemo(() => Object.values(db.calles).some((c) => c.municipioId === datos.municipio.id && c.segmentos.some((s) => s.coords.length > 1)), [db.calles, datos.municipio.id]);
  const clasif = textosOrigen(origenDatos(datos)).partes.find((p) => p.t === 'Clasificación');

  const perfil = perfilGrupos(unidades, (u) => u.sector);
  const grupos = [
    ...SECTORES.map((s) => ({ k: s as string, t: s as string, n: ocup.filter((u) => u.sector === s).length, color: COLOR[s], perfil: perfil.find((g) => g.grupo === s) })),
    { k: 'Sin clasificar', t: 'Sin clasificar', n: ocup.filter((u) => !u.sector).length, color: COLOR['Sin clasificar'], perfil: undefined },
    { k: 'Vacíos', t: 'Locales vacíos', n: r.vacios, color: TONO_CAPA.vacios, perfil: undefined },
  ];
  const celda = (p?: { n: number; den: number }) => (p && p.den ? <span title={`${fmt(p.n)} de ${fmt(p.den)} con respuesta Sí/No`}>{fmtPct(p.n / p.den, 0)}</span> : <span className="muted">—</span>);

  const conc = concentracion(distribucion(ocup, (u) => u.calleId));
  const web = adopcion(unidades, 'web');
  const mayor = grupos.slice(0, 3).sort((a, b) => b.n - a.n)[0];
  const topHost = rankingCalles(territorio, 'Hostelería y Restauración', UMBRAL_CALLE, 1).filas[0];
  const topVac = rankingCalles(territorio, 'vacios', UMBRAL_CALLE, 1).filas[0];
  const destacados = [
    mayor && mayor.n > 0 && r.ocupados > 0 && { icono: <Store size={14} />, texto: <><b>{mayor.t}</b> reúne el <b>{fmtPct(mayor.n / r.ocupados, 0)}</b> de los establecimientos ocupados ({fmt(mayor.n)} de {fmt(r.ocupados)}).</> },
    conc.prop !== null && conc.conValor > conc.k && { icono: <MapPin size={14} />, texto: <>Las <b>{conc.k} calles</b> con más actividad concentran el <b>{fmtPct(conc.prop, 0)}</b> de los ocupados ({fmt(conc.top)} de {fmt(conc.total)}).</> },
    topHost && { icono: <UtensilsCrossed size={14} />, texto: <><b>{topHost.calle}</b> es la calle con más hostelería ({fmt(topHost.n)}); tiene {fmt(topHost.vacios)} {topHost.vacios === 1 ? 'local vacío' : 'locales vacíos'} de {fmt(topHost.observados)} observados.</> },
    topVac && { icono: <DoorOpen size={14} />, texto: <><b>{topVac.calle}</b> es la calle con más locales vacíos: <b>{fmt(topVac.vacios)}</b> de {fmt(topVac.observados)} ({fmtPct(topVac.prop, 0)}).*</> },
    web.den > 0 && { icono: <Globe size={14} />, texto: <>El <b>{fmtPct(web.n / web.den, 0)}</b> de los ocupados con respuesta tiene página web ({fmt(web.n)} de {fmt(web.den)}).</> },
  ].filter(Boolean) as { icono: JSX.Element; texto: JSX.Element }[];

  const ocupPct = pct(r.ocupacion);
  const vinculo = { sobre, fijada, onSobre: setSobre, onFijar: setFijada };
  return (
    <>
      <div className="vz-tira c-12" role="group" aria-label="Indicadores principales">
        <div className="vz-tira-kpi">
          <span>Establecimientos observados</span>
          <b>{fmt(r.establecimientos)}</b>
          <small title={datos.registrosCensales > 0 ? `${fmt(datos.registrosCensales)} registros censales importados` : undefined}>{fmt(r.locales)} locales físicos{r.sinLocal ? ` · ${fmt(r.sinLocal)} sin local` : ''}</small>
        </div>
        <div className="vz-tira-kpi">
          <span>Tasa de ocupación</span>
          <b>{fmtPct(ocupPct)}</b>
          <small>{fmt(r.ocupados)} ocupados de {fmt(r.establecimientos)}</small>
          <i className="vz-tira-medidor" aria-hidden><i style={{ width: `${(ocupPct ?? 0) * 100}%` }} /></i>
        </div>
        <div className="vz-tira-kpi">
          <span>Locales vacíos</span>
          <b>{fmt(r.vacios)}</b>
          <small>{fmtPct(pct({ n: r.vacios, den: r.establecimientos }))} de los observados</small>
        </div>
        <div className="vz-tira-kpi">
          <span>Negocios</span>
          <b>{fmt(r.negocios)}</b>
          <small>distintos, en locales ocupados</small>
        </div>
        <div className="vz-tira-kpi">
          <span>Franquicias (Sí)</span>
          <b>{fmtPct(pct(r.franquicias))}</b>
          <small title={r.franquiciasPendientes ? `${fmt(r.franquiciasPendientes)} sin respuesta Sí/No` : undefined}>{fmt(r.franquicias.n)} de {fmt(r.franquicias.den)} con respuesta Sí/No</small>
        </div>
      </div>

      <section className="vz-bloque c-7 vz-bloque-mapa" aria-label={conGeo ? 'Mapa territorial' : 'Matriz territorial'}>
        <header className="vz-bloque-cab">
          <div className="vz-bloque-tit">
            <h2>{conGeo ? 'Mapa territorial' : 'Matriz territorial: calles × sector'}</h2>
            {!conGeo && <p>Sin geometría de calles fiable: calles × grupos, vinculada a los rankings.</p>}
          </div>
          {conGeo && <div className="vz-bloque-acc"><Conmutador etiqueta="Capa del mapa" valor={capa} opciones={CAPAS} onCambio={setCapa} /></div>}
        </header>
        {ignorados.length > 0 && <p className="vz-nota-filtro">El {ignorados.join(' y el ')} no se aplican al mapa ni a los rankings: comparan los cuatro grupos (los vacíos no tienen sector ni franquicia).</p>}
        {conGeo
          ? <MapaTerritorial db={db} municipioId={datos.municipio.id} unidades={territorio} capa={capa} {...vinculo} onFiltrar={(id) => { setFijada(null); setFiltros({ ...filtros, calleId: id }); }} />
          : <MatrizTerritorial unidades={territorio} {...vinculo} />}
      </section>

      <section className="c-5 vz-rankings" aria-label="Rankings de calles">
        <h2 className="vh">Rankings de calles</h2>
        {RANKINGS.map((x) => <RankingMini key={x.criterio} unidades={territorio} criterio={x.criterio} titulo={x.titulo} color={x.color} {...vinculo} />)}
        <p className="vz-rankings-nota">Top 5 por número de establecimientos. «%»: peso en la calle, solo con al menos {UMBRAL_CALLE} observados (los vacíos, solo en esas calles).</p>
      </section>

      <Bloque span={7} titulo="Distribución sectorial" etiqueta="Distribución por sector" sub={`Todos los grupos sobre los ${fmt(r.establecimientos)} establecimientos observados. Pulse un sector para filtrar.`} nota={clasif ? `Clasificación: ${clasif.v}.` : undefined}>
        <Apilada sinLeyenda etiqueta="Distribución sectorial" segmentos={grupos.map((g) => ({ t: g.t, n: g.n, color: g.color }))} />
        <table className="vz-tabla vz-tabla-dist" aria-label="Distribución sectorial (tabla)">
          <thead><tr><th>Grupo</th><th className="num">Establecimientos</th><th className="num">% observados</th><th className="num">% ocupados</th><th className="num">Franquicia</th><th className="num">Web</th><th className="num">Google</th></tr></thead>
          <tbody>
            {grupos.map((g) => {
              const esSector = SECTORES.includes(g.k as Sector);
              return (
                <tr key={g.k} className={`${esSector ? 'clic' : ''} ${filtros.sector === g.k ? 'on' : ''}`} onClick={esSector ? () => setFiltros({ ...filtros, sector: filtros.sector === g.k ? undefined : (g.k as Sector) }) : undefined} title={esSector ? 'Filtrar por este sector' : undefined}>
                  <td><span className="vz-clave"><i style={{ background: g.color }} />{g.t}</span></td>
                  <td className="num"><b>{fmt(g.n)}</b></td>
                  <td className="num">{fmtPct(r.establecimientos ? g.n / r.establecimientos : null, 1)}</td>
                  <td className="num">{g.k === 'Vacíos' ? <span className="muted">—</span> : fmtPct(r.ocupados ? g.n / r.ocupados : null, 1)}</td>
                  <td className="num">{celda(g.perfil?.franquicia)}</td>
                  <td className="num">{celda(g.perfil?.adopcion.web)}</td>
                  <td className="num">{celda(g.perfil?.adopcion.googleBusiness)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Bloque>
      <Bloque span={5} titulo="Datos destacados" sub="Calculados con los filtros actuales." nota={topVac ? `* Solo calles con al menos ${UMBRAL_CALLE} observados.` : undefined}>
        <Hallazgos items={destacados.slice(0, 4)} />
      </Bloque>

      <Bloque span={12} titulo="Cómo leer estas cifras" sub="Cada cifra tiene su propio denominador.">
        <dl className="vz-def vz-def-cols">
          {datos.registrosCensales > 0 && <div><dt>Registros censales</dt><dd>{fmt(datos.registrosCensales)} filas importadas; {fmt(datos.registrosSinEstablecimiento)} sin establecimiento observado.</dd></div>}
          <div><dt>Observados</dt><dd>{fmt(r.establecimientos)}: la unidad de todos los gráficos.</dd></div>
          <div><dt>Locales</dt><dd>{fmt(r.locales)} físicos distintos; un portal puede tener varios.</dd></div>
          <div><dt>Ocupación</dt><dd>ocupados ÷ observados ({fmt(r.ocupados)} ÷ {fmt(r.establecimientos)}).</dd></div>
          <div><dt>Franquicia y canales</dt><dd>Sí ÷ (Sí + No): nunca cuentan los pendientes.</dd></div>
          <div><dt>Calles</dt><dd>% solo con al menos {UMBRAL_CALLE} observados.</dd></div>
          {r.fechas && <div><dt>Periodo</dt><dd>{r.fechas.desde} a {r.fechas.hasta} ({fmt(r.fechas.n)} con fecha).</dd></div>}
        </dl>
      </Bloque>
    </>
  );
}
