import { useMemo, useState } from 'react';
import { AlertTriangle, ClipboardList, FileWarning, Hourglass, Link2Off, MapPinned, Rows3 } from 'lucide-react';
import { fmt } from '../../components/ui';
import { adopcion, datosCampana, distribucion, filtrar, pct, resumen, SECTORES, VARIABLES_PRESENCIA } from '../../domain/panel';
import type { Id } from '../../domain/types';
import { Apilada, BarrasPareadas, Bloque, COLOR, fmtPct, Kpi, SinDatos, textoProp, valorProp } from './graficos';
import { FUENTE_COLOR, FUENTE_TXT, SECTOR_CORTO, type Contexto } from './comun';

/** Cobertura y calidad: del registro original al establecimiento observado, y el estado de cada dato. */
export function Cobertura({ datos, unidades }: Contexto) {
  const c = datos.correspondencias;
  const ocup = unidades.filter((u) => !u.vacio);
  const origen = { manual: 0, heredado: 0, importado: 0, ninguno: 0 };
  for (const u of ocup) origen[u.franquiciaOrigen ?? 'ninguno']++;
  const estados = { verificada: 0, borrador: 0, 'sin-datos': 0 };
  for (const u of ocup) if (u.digitalEstado !== 'no-aplica') estados[u.digitalEstado]++;
  const sinLocal = unidades.filter((u) => u.sinLocal).length;
  const hayReg = datos.registrosCensales > 0;
  const conEst = datos.registrosCensales - datos.registrosSinEstablecimiento;
  const dims = [
    { t: 'Clasificación', d: 'ocupados', segs: (Object.keys(FUENTE_TXT) as (keyof typeof FUENTE_TXT)[]).map((k) => ({ t: FUENTE_TXT[k], n: ocup.filter((u) => u.fuenteClasificacion === k).length, color: FUENTE_COLOR[k] })) },
    { t: 'Franquicia', d: 'ocupados', segs: [{ t: 'Comprobada (manual)', n: origen.manual, color: '#2a78d6' }, { t: 'Heredada (borrador)', n: origen.heredado, color: '#eda100' }, { t: 'Importada (histórica)', n: origen.importado, color: '#6250d6' }, { t: 'Sin dato', n: origen.ninguno, color: '#dfe4ec' }] },
    { t: 'Revisión digital', d: 'ocupados', segs: [{ t: 'Verificada', n: estados.verificada, color: '#2a78d6' }, { t: 'Borrador o importada', n: estados.borrador, color: '#eda100' }, { t: 'Sin datos', n: estados['sin-datos'], color: '#dfe4ec' }] },
    { t: 'Localización', d: 'observados', segs: [{ t: 'Con local identificado', n: unidades.length - sinLocal, color: '#2a78d6' }, { t: 'Sin local identificado', n: sinLocal, color: '#eda100' }] },
  ];
  return (
    <>
      <div className="vz-kpis c-12" style={{ ['--n' as string]: 6 }} aria-label="Indicadores de cobertura y calidad">
        <Kpi icono={<Rows3 size={14} />} etq="Registros censales" valor={fmt(datos.registrosCensales)} sub={hayReg ? `filas importadas de la campaña${datos.registrosExcluidos ? ` · ${fmt(datos.registrosExcluidos)} excluidas` : ''}` : 'sin importaciones en esta campaña'} />
        <Kpi icono={<ClipboardList size={14} />} etq="Observados" valor={fmt(unidades.length)} sub={`establecimientos · ${fmt(sinLocal)} sin local`} />
        {hayReg
          ? <Kpi icono={<Link2Off size={14} />} etq="Sin establecimiento" valor={fmt(datos.registrosSinEstablecimiento)} sub="registros sin local observado ni observación propia" tono={datos.registrosSinEstablecimiento ? 'aviso' : undefined} barra={pct({ n: datos.registrosSinEstablecimiento, den: datos.registrosCensales })} color="#eda100" />
          : <Kpi icono={<Link2Off size={14} />} etq="Sin establecimiento" valor="—" sub="no hay registros importados" />}
        <Kpi icono={<FileWarning size={14} />} etq="Con incidencias" valor={fmt(datos.registrosConIncidencias)} sub={hayReg ? `registros · ${fmt(datos.incidencias)} incidencias conservadas` : 'sin registros importados'} tono={datos.registrosConIncidencias ? 'aviso' : undefined} barra={hayReg ? pct({ n: datos.registrosConIncidencias, den: datos.registrosCensales }) : undefined} color="#eda100" />
        <Kpi icono={<Hourglass size={14} />} etq="Pendientes de visita" valor={fmt(datos.pendientesVisita)}  sub="locales anteriores aún sin observar" tono={datos.pendientesVisita ? 'aviso' : undefined} />
        <Kpi icono={<MapPinned size={14} />} etq="Calles con registros" valor={`${fmt(datos.callesConRegistros)} de ${fmt(datos.callesAmbito)}`} sub="del ámbito de la campaña" barra={pct({ n: datos.callesConRegistros, den: datos.callesAmbito })} color="#1baf7a" />
      </div>

      <Bloque span={12} titulo="Trazabilidad: del registro al establecimiento" sub="Cada paso con su cifra. Los registros y los establecimientos no son cantidades equivalentes.">
        <div className="vz-flujo" style={{ ['--n' as string]: hayReg ? 6 : 3 }}>
          {hayReg && <div className="vz-paso"><b className="num">{fmt(datos.registrosCensales + datos.registrosExcluidos)}</b><span>Filas importadas</span><small>todas se conservan con su original</small></div>}
          {hayReg && <div className="vz-paso" style={{ borderColor: '#c3cad6' }}><b className="num">{fmt(datos.registrosExcluidos)}</b><span>Excluidas por una persona</span><small>no cuentan como registros censales</small></div>}
          {hayReg && <div className="vz-paso" style={{ borderColor: '#2a78d6' }}><b className="num">{fmt(conEst)}</b><span>Con establecimiento observado</span><small>de {fmt(datos.registrosCensales)} registros censales</small></div>}
          <div className="vz-paso" style={{ borderColor: '#2a78d6' }}><b className="num">{fmt(unidades.length)}</b><span>Establecimientos observados</span><small>unidad de todos los gráficos</small></div>
          <div className="vz-paso" style={{ borderColor: '#2a78d6' }}><b className="num">{fmt(unidades.length - sinLocal)}</b><span>Con local identificado</span><small>{fmtPct(pct({ n: unidades.length - sinLocal, den: unidades.length }), 0)} de los observados</small></div>
          <div className="vz-paso" style={{ borderColor: '#eda100' }}><b className="num">{fmt(sinLocal)}</b><span>Sin local identificado</span><small>correspondencia registro–local pendiente</small></div>
        </div>
      </Bloque>

      <Bloque span={5} titulo="Correspondencias registro–local" sub={`${fmt(c.confirmada + c.probable + c.dudosa + c.sinVinculo)} vínculos de registros importados.`} nota="«Probable» se creó a partir de la fila y está pendiente de conciliar con otras campañas; «dudosa» y «sin vínculo» necesitan revisión.">
        {c.confirmada + c.probable + c.dudosa + c.sinVinculo ? (
          <Apilada etiqueta="Correspondencias" segmentos={[{ t: 'Confirmada', n: c.confirmada, color: '#2a78d6' }, { t: 'Probable', n: c.probable, color: '#86b6ef' }, { t: 'Dudosa', n: c.dudosa, color: '#eda100' }, { t: 'Sin vínculo', n: c.sinVinculo, color: '#eb6834' }]} />
        ) : <SinDatos texto="No hay registros importados en esta campaña." />}
        <dl className="vz-def" style={{ marginTop: 6 }}>
          <dt>Confirmada</dt><dd>{fmt(c.confirmada)} · revisada por una persona.</dd>
          <dt>Probable</dt><dd>{fmt(c.probable)} · creada desde la fila, sin conciliar.</dd>
          <dt>Dudosa</dt><dd>{fmt(c.dudosa)} · varias opciones posibles: requiere decisión.</dd>
          <dt>Sin vínculo</dt><dd>{fmt(c.sinVinculo)} · registro sin local asociado.</dd>
        </dl>
      </Bloque>
      <Bloque span={7} titulo="Estado del dato" sub="Origen y verificación de cada dimensión. Solo «confirmada», «comprobada» y «verificada» son comprobaciones de la campaña.">
        <table className="vz-tabla" aria-label="Estado del dato">
          <tbody>
            {dims.map((d) => (
              <tr key={d.t}>
                <td style={{ width: 120, verticalAlign: 'top' }}><b>{d.t}</b><br /><span className="muted" style={{ fontSize: 11 }}>{d.d}</span></td>
                <td><Apilada compacta etiqueta={d.t} segmentos={d.segs} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Bloque>
    </>
  );
}

/** Comparar dos campañas cualesquiera (años o ámbitos), con avisos de comparabilidad. */
export function Comparar({ db, datos, filtros }: Contexto) {
  const otras = Object.values(db.campanas).filter((c) => c.id !== datos.campana.id).sort((a, b) => (a.municipioId === datos.municipio.id ? -1 : 1) - (b.municipioId === datos.municipio.id ? -1 : 1) || b.anio - a.anio);
  // La campaña secundaria se valida en cada render: si cambia la principal (o desaparece la elegida),
  // nunca se compara una campaña consigo misma ni se conserva en silencio una selección inexistente.
  const [elegida, setElegida] = useState<Id | undefined>();
  const ref = datos.campana.campanaReferenciaId;
  const porDefecto = ref && ref !== datos.campana.id && db.campanas[ref] ? ref : otras[0]?.id;
  const elegidaValida = !!elegida && elegida !== datos.campana.id && !!db.campanas[elegida];
  const otraId = elegidaValida ? elegida : porDefecto;
  const avisoSeleccion = elegida && !elegidaValida
    ? elegida === datos.campana.id
      ? `La campaña que habías elegido para comparar («${db.campanas[elegida]?.nombre}») es ahora la campaña principal: una campaña no se compara consigo misma.`
      : 'La campaña que habías elegido para comparar ya no existe.'
    : undefined;
  const otro = useMemo(() => (otraId && db.campanas[otraId] ? datosCampana(db, otraId) : null), [db, otraId]);
  if (!otro) return <div className="c-12"><SinDatos texto="No hay otra campaña con la que comparar." /></div>;
  const filas = [datos, otro].map((d) => {
    const us = filtrar(d.unidades, { ...filtros, calleId: undefined });
    const r = resumen(us);
    const ocup = us.filter((u) => !u.vacio);
    const fuente = distribucion(ocup, (u) => u.fuenteClasificacion)[0]?.clave as keyof typeof FUENTE_TXT | undefined;
    return { d, r, us, ocup, fuente, web: adopcion(us, 'web') };
  });
  const [a, b] = filas;
  const avisos = [
    a.d.municipio.id !== b.d.municipio.id && 'Son ámbitos geográficos distintos: las cifras no son comparables como evolución.',
    a.d.callesConRegistros !== b.d.callesConRegistros && `Cobertura distinta: ${fmt(a.d.callesConRegistros)} frente a ${fmt(b.d.callesConRegistros)} calles con registros.`,
    a.d.historica !== b.d.historica && 'Una campaña es un histórico importado (referencia) y la otra no.',
    a.fuente !== b.fuente && 'Las clasificaciones proceden de fuentes distintas (p. ej., texto histórico frente a catálogo 2026).',
    (a.d.pendientesVisita || b.d.pendientesVisita) && 'Hay locales pendientes de visita: una campaña en curso no está completa.',
  ].filter(Boolean) as string[];
  const nombre = (x: typeof a) => `${x.d.municipio.nombre} · ${x.d.campana.nombre}`;
  const dif = (x: number, y: number) => (x === y ? 'igual' : `${x > y ? '+' : '−'}${fmt(Math.abs(x - y))}`);
  const difPct = (x: number | null, y: number | null) => (x === null || y === null ? '—' : `${x >= y ? '+' : '−'}${fmtPct(Math.abs(x - y)).replace(' %', '')} p.p.`);
  const fila = (t: string, f: (x: (typeof filas)[number]) => string, d?: string) => <tr key={t}><td>{t}</td><td className="num">{f(a)}</td><td className="num">{f(b)}</td><td className="num dif">{d ?? ''}</td></tr>;
  const kpi = (t: string, va: string, vb: string, d: string) => (
    <Kpi etq={t} valor={<span className="vz-ab"><b className="num">{va}</b><span>frente a {vb}</span></span>} sub={`diferencia de cifras: ${d}`} />
  );
  const ocupA = pct(a.r.ocupacion);
  const ocupB = pct(b.r.ocupacion);

  return (
    <>
      <Bloque span={12} titulo="Campañas que se comparan" sub="Mismos filtros globales en ambas (salvo la calle).">
        <div className="vz-comparar-cab">
          <div className="vz-lado b"><span>Campaña principal</span><b>{nombre(a)}</b></div>
          <span className="vz-vs">frente a</span>
          <label className="vz-lado"><span>Comparar con</span>
            <select className="input" aria-label="Campaña con la que comparar" value={otraId} onChange={(e) => setElegida(e.target.value)}>
              {otras.map((c) => <option key={c.id} value={c.id}>{db.municipios[c.municipioId]?.nombre} · {c.nombre}</option>)}
            </select>
          </label>
        </div>
        {avisoSeleccion && (
          <div className="t-info aviso vz-aviso" role="status" aria-label="Selección de comparación cambiada">
            <AlertTriangle size={14} /> <span>{avisoSeleccion} Se compara con «{otro.municipio.nombre} · {otro.campana.nombre}»; elige otra campaña si lo prefieres.</span>
          </div>
        )}
        <div className="t-info aviso vz-aviso" role="note"><AlertTriangle size={14} /> <div>Las diferencias <b>no</b> son aperturas ni cierres confirmados: para eso hace falta la correspondencia confirmada entre locales (pestaña «Evolución» de Análisis).{avisos.length > 0 && <ul className="vz-avisos-lista">{avisos.map((x) => <li key={x}>{x}</li>)}</ul>}</div></div>
      </Bloque>

      <div className="vz-kpis c-12" style={{ ['--n' as string]: 4 }} aria-label="Comparación de indicadores">
        {kpi('Establecimientos observados', fmt(a.r.establecimientos), fmt(b.r.establecimientos), dif(a.r.establecimientos, b.r.establecimientos))}
        {kpi('Tasa de ocupación', fmtPct(ocupA), fmtPct(ocupB), difPct(ocupA, ocupB))}
        {kpi('Locales vacíos', fmt(a.r.vacios), fmt(b.r.vacios), dif(a.r.vacios, b.r.vacios))}
        {kpi('Franquicias (Sí)', fmtPct(pct(a.r.franquicias)), fmtPct(pct(b.r.franquicias)), difPct(pct(a.r.franquicias), pct(b.r.franquicias)))}
      </div>

      <Bloque span={6} titulo="Peso de cada sector" sub="Porcentaje sobre los ocupados de cada campaña.">
        <BarrasPareadas etiqueta="Peso de cada sector" series={[nombre(b), nombre(a)]} formato={(v) => fmtPct(v, 0)}
          filas={[...SECTORES, undefined].map((s) => ({ clave: s ?? 'sin', etiqueta: s ? SECTOR_CORTO[s] : 'Sin clasificar', color: s ? COLOR[s] : COLOR['Sin clasificar'], b: a.ocup.length ? a.ocup.filter((u) => u.sector === s).length / a.ocup.length : null, a: b.ocup.length ? b.ocup.filter((u) => u.sector === s).length / b.ocup.length : null }))} />
      </Bloque>
      <Bloque span={6} titulo="Adopción digital" sub="Sí entre Sí/No, por canal.">
        <BarrasPareadas etiqueta="Adopción digital comparada" series={[nombre(b), nombre(a)]} formato={(v) => fmtPct(v, 0)}
          filas={VARIABLES_PRESENCIA.map((x) => ({ clave: x.v, etiqueta: x.t, a: valorProp(adopcion(b.us, x.v)), b: valorProp(adopcion(a.us, x.v)) }))} />
      </Bloque>

      <Bloque span={12} titulo="Tabla de comparación" sub="Cifras de cada campaña con sus denominadores. La diferencia es aritmética: no indica aperturas ni cierres.">
        <table className="vz-tabla" aria-label="Comparación">
          <thead><tr><th>Indicador</th><th className="num">{nombre(a)}</th><th className="num">{nombre(b)}</th><th className="num">Diferencia</th></tr></thead>
          <tbody>
            {fila('Calles con registros', (x) => fmt(x.d.callesConRegistros), dif(a.d.callesConRegistros, b.d.callesConRegistros))}
            {fila('Establecimientos observados', (x) => fmt(x.r.establecimientos), dif(a.r.establecimientos, b.r.establecimientos))}
            {fila('Ocupados', (x) => fmt(x.r.ocupados), dif(a.r.ocupados, b.r.ocupados))}
            {fila('Vacíos', (x) => `${fmt(x.r.vacios)} (${fmtPct(pct({ n: x.r.vacios, den: x.r.establecimientos }))})`, dif(a.r.vacios, b.r.vacios))}
            {[...SECTORES, undefined].map((s) => fila(s ?? 'Sin clasificar', (x) => { const n = x.ocup.filter((u) => u.sector === s).length; return `${fmt(n)} (${fmtPct(pct({ n, den: x.ocup.length }))})`; }))}
            {fila('Web (Sí entre Sí/No)', (x) => textoProp(x.web))}
            {fila('Fuente principal de la clasificación', (x) => (x.fuente ? FUENTE_TXT[x.fuente] : '—'))}
          </tbody>
        </table>
      </Bloque>
    </>
  );
}
