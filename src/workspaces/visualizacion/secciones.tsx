import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useStore } from '../../store/store';
import { fmt } from '../../components/ui';
import {
  adopcion, compararGrupos, datosCampana, distribucion, estadisticos, filtrar, histograma, indicePresencia, matrizCalor, MIN_CELDA, MIN_GRUPO, pct, respuestas, resumen,
  RESPUESTAS, SECTORES, topCalles, UMBRAL_CALLE, valores, VARIABLES_PRESENCIA, type DatosCampana, type FiltrosPanel, type Sector, type UnidadPanel,
} from '../../domain/panel';
import type { VariableDigital } from '../../domain/types';
import { Apilada, BarrasH, Bloque, fmtNum, fmtPct, Histograma, Kpi, MapaCalles, MatrizCalor, SinDatos, textoProp } from './graficos';

export const COLOR_SECTOR: Record<string, string> = { Comercio: '#0065fe', Servicios: '#7a4fd1', 'Hostelería y Restauración': '#d98f00', 'Sin clasificar': '#b9c2cf' };
const COLOR_RESP: Record<string, string> = { si: '#0b7a53', no: '#7d8ea8', 'sin-info': '#a78bdb', na: '#dfe4ec', pendiente: '#f0b44c' };
const FUENTE_TXT = { confirmada: 'Clasificación 2026 confirmada', propuesta: 'Propuesta 2026 sin confirmar', historica: 'Texto histórico (sin convertir)', 'sin-clasificar': 'Sin clasificar' } as const;
const FUENTE_COLOR = { confirmada: '#0b7a53', propuesta: '#f0b44c', historica: '#7a4fd1', 'sin-clasificar': '#b9c2cf' } as const;

type SetFiltros = (f: FiltrosPanel) => void;

function TablaCalles({ unidades, criterio, setFiltros, filtros }: { unidades: UnidadPanel[]; criterio: 'ocupados' | 'vacios'; setFiltros: SetFiltros; filtros: FiltrosPanel }) {
  const t = topCalles(unidades, criterio);
  if (!t.filas.length) return <SinDatos texto={`Ninguna calle alcanza el umbral de ${UMBRAL_CALLE} establecimientos observados.`} />;
  return (
    <>
      <table className="tabla vz-tabla" aria-label={criterio === 'ocupados' ? 'Calles con más locales ocupados' : 'Calles con más locales vacíos'}>
        <thead><tr><th>Calle</th><th className="num">Observados</th><th className="num">{criterio === 'ocupados' ? 'Ocupados' : 'Vacíos'}</th><th className="num">{criterio === 'ocupados' ? '% ocupación' : '% vacíos'}</th></tr></thead>
        <tbody>
          {t.filas.map((f) => (
            <tr key={f.calleId}>
              <td><button className="vz-enlace" onClick={() => setFiltros({ ...filtros, calleId: f.calleId })} title="Filtrar por esta calle">{f.calle}</button></td>
              <td className="num">{fmt(f.locales)}</td>
              <td className="num">{fmt(criterio === 'ocupados' ? f.ocupados : f.vacios)}</td>
              <td className="num">{fmtPct(criterio === 'ocupados' ? f.ocupacion : f.vacancia)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="vz-nota">* Umbral: solo calles con al menos {UMBRAL_CALLE} establecimientos observados ({t.consideradas} de {t.total} calles). Con menos, un porcentaje es poco fiable.</p>
    </>
  );
}

function FuentesClasificacion({ unidades }: { unidades: UnidadPanel[] }) {
  const ocup = unidades.filter((u) => !u.vacio);
  return <Apilada etiqueta="Fuente de la clasificación" segmentos={(Object.keys(FUENTE_TXT) as (keyof typeof FUENTE_TXT)[]).map((k) => ({ t: FUENTE_TXT[k], n: ocup.filter((u) => u.fuenteClasificacion === k).length, color: FUENTE_COLOR[k] }))} />;
}

export function Resumen({ datos, unidades, filtros, setFiltros }: { datos: DatosCampana; unidades: UnidadPanel[]; filtros: FiltrosPanel; setFiltros: SetFiltros }) {
  const r = resumen(unidades);
  const sectores = distribucion(unidades.filter((u) => !u.vacio), (u) => u.sector, 'Sin clasificar');
  const mayor = sectores.find((x) => SECTORES.includes(x.clave as Sector));
  const pend = datos.correspondencias.probable + datos.correspondencias.dudosa + datos.correspondencias.sinVinculo;
  const top = topCalles(unidades, 'ocupados').filas[0];
  const web = adopcion(unidades, 'web');
  const metros = estadisticos(unidades.filter((u) => u.vacio && typeof u.metros === 'number').map((u) => u.metros!));
  const destacados = [
    top && `${top.calle} es la calle con más locales ocupados: ${fmt(top.ocupados)} de ${fmt(top.locales)} observados (${fmtPct(top.ocupacion, 0)}).*`,
    mayor && r.ocupados && `${mayor.etiqueta} es el sector con más ocupados: ${fmtPct(mayor.n / r.ocupados, 0)} (${fmt(mayor.n)} de ${fmt(r.ocupados)}; ${fmt(sectores.find((x) => x.clave === 'Sin clasificar')?.n ?? 0)} sin clasificar).`,
    web.den > 0 && `El ${fmtPct(web.n / web.den, 0)} de los ocupados con respuesta tiene página web (${fmt(web.n)} de ${fmt(web.den)}; ${fmt(r.ocupados - web.den)} sin respuesta Sí/No).`,
    metros && `Los locales vacíos con medida tienen una fachada media de ${fmtNum(metros.media)} m (mediana ${fmtNum(metros.mediana)} m; ${fmt(metros.n)} con dato).`,
  ].filter(Boolean) as string[];
  return (
    <>
      <div className="vz-kpis vz-ancho" aria-label="Indicadores principales">
        {datos.registrosCensales > 0 && <Kpi etq="Registros censales" valor={fmt(datos.registrosCensales)} sub="filas importadas (incluye las sin local)" />}
        <Kpi etq="Establecimientos observados" valor={fmt(r.establecimientos)} sub={r.sinLocal ? `${fmt(r.sinLocal)} sin local identificado` : 'todos con local'} />
        <Kpi etq="Locales físicos identificados" valor={fmt(r.locales)} />
        <Kpi etq="Negocios" valor={fmt(r.negocios)} />
        <Kpi etq="Locales vacíos" valor={fmt(r.vacios)} sub={`${fmtPct(pct({ n: r.vacios, den: r.establecimientos }))} de ${fmt(r.establecimientos)}`} />
        <Kpi etq="Ocupación" valor={fmtPct(pct(r.ocupacion))} sub={`${fmt(r.ocupacion.n)} de ${fmt(r.ocupacion.den)}`} />
        <Kpi etq="Franquicias (Sí)" valor={fmtPct(pct(r.franquicias))} sub={`${fmt(r.franquicias.n)} de ${fmt(r.franquicias.den)} con respuesta · ${fmt(r.franquiciasPendientes)} pendientes`} />
        <Kpi etq="Correspondencias pendientes" valor={fmt(pend)} sub={pend ? `registro–local sin confirmar: ${fmt(datos.correspondencias.probable)} probables · ${fmt(datos.correspondencias.dudosa)} dudosas · ${fmt(datos.correspondencias.sinVinculo)} sin vínculo` : 'registro–local sin confirmar'} tono={pend ? 'aviso' : undefined} />
      </div>
      <Bloque titulo="Distribución por sector" nota="Pulse una barra para filtrar por ese sector.">
        <BarrasH partes={sectores} colores={COLOR_SECTOR} onClic={(s) => SECTORES.includes(s as Sector) && setFiltros({ ...filtros, sector: s as Sector })} activa={filtros.sector} />
        <h4 className="vz-sub">Fuente de la clasificación</h4>
        <FuentesClasificacion unidades={unidades} />
      </Bloque>
      <Bloque titulo="Calles con más locales ocupados*">
        <TablaCalles unidades={unidades} criterio="ocupados" setFiltros={setFiltros} filtros={filtros} />
      </Bloque>
      <Bloque titulo="Datos destacados (calculados)">
        {destacados.length ? <ul className="vz-destacados">{destacados.map((d) => <li key={d}>{d}</li>)}</ul> : <SinDatos />}
        {r.fechas && <p className="vz-nota">Periodo de observación: {r.fechas.desde} a {r.fechas.hasta} ({fmt(r.fechas.n)} con fecha).</p>}
      </Bloque>
      <Bloque titulo="Ocupados y vacíos">
        <Apilada etiqueta="Ocupados y vacíos" segmentos={[{ t: 'Ocupados', n: r.ocupados, color: '#0065fe' }, { t: 'Vacíos', n: r.vacios, color: '#b9c2cf' }]} />
      </Bloque>
    </>
  );
}

export function SectorTab({ sector, datos, unidades, filtros, setFiltros }: { sector: Sector; datos: DatosCampana; unidades: UnidadPanel[]; filtros: FiltrosPanel; setFiltros: SetFiltros }) {
  const ocupTodos = filtrar(datos.unidades, { ...filtros, sector: undefined }).filter((u) => !u.vacio).length;
  const us = unidades.filter((u) => !u.vacio);
  const n2 = distribucion(us, (u) => u.nivel2);
  const n3 = distribucion(us, (u) => u.nivel3);
  const porCalle = distribucion(us, (u) => u.calle);
  const nivel2 = sector === 'Comercio' ? 'Grupo de comercio' : 'Subgrupo de actividad';
  const nivel3 = sector === 'Comercio' ? 'Subgrupo de actividad' : sector === 'Servicios' ? 'Actividad o descripción' : 'Actividad';
  return (
    <>
      <div className="vz-kpis vz-ancho">
        <Kpi etq={`Establecimientos de ${sector}`} valor={fmt(us.length)} sub={`${fmtPct(pct({ n: us.length, den: ocupTodos }))} de ${fmt(ocupTodos)} ocupados`} />
        <Kpi etq="Franquicias (Sí)" valor={textoProp({ n: us.filter((u) => u.franquicia === 'si').length, den: us.filter((u) => u.franquicia === 'si' || u.franquicia === 'no').length })} />
        {VARIABLES_PRESENCIA.slice(0, 3).map((v) => <Kpi key={v.v} etq={v.t} valor={textoProp(adopcion(us, v.v))} sub="Sí entre las respuestas Sí/No" />)}
      </div>
      <Bloque titulo={nivel2}><BarrasH partes={n2} color={COLOR_SECTOR[sector]} limite={12} /></Bloque>
      <Bloque titulo={nivel3}><BarrasH partes={n3} color={COLOR_SECTOR[sector]} limite={12} /></Bloque>
      <Bloque titulo="Franquicia">
        <Apilada etiqueta="Franquicia" segmentos={RESPUESTAS.filter((r) => r.r !== 'na').map((r) => ({ t: r.t, n: us.filter((u) => (u.franquicia ?? 'pendiente') === r.r).length, color: COLOR_RESP[r.r] }))} />
      </Bloque>
      <Bloque titulo={`Calles con más establecimientos de ${sector}`} nota="Recuento absoluto (sin porcentajes): pulse una calle para filtrar.">
        <BarrasH partes={porCalle} color={COLOR_SECTOR[sector]} limite={10} onClic={(c) => { const u = us.find((x) => x.calle === c); if (u) setFiltros({ ...filtros, calleId: u.calleId }); }} />
      </Bloque>
      <Bloque titulo="Fuente de la clasificación" nota="Las clasificaciones históricas son el texto original: no se han convertido al catálogo 2026.">
        <FuentesClasificacion unidades={us} />
      </Bloque>
    </>
  );
}

export function Vacios({ unidades, hayCp, filtros, setFiltros }: { unidades: UnidadPanel[]; hayCp: boolean; filtros: FiltrosPanel; setFiltros: SetFiltros }) {
  const vac = unidades.filter((u) => u.vacio);
  const m = estadisticos(vac.filter((u) => typeof u.metros === 'number').map((u) => u.metros!));
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
  return (
    <>
      <div className="vz-kpis vz-ancho">
        <Kpi etq="Locales vacíos" valor={fmt(vac.length)} sub={`${fmtPct(pct({ n: vac.length, den: unidades.length }))} de ${fmt(unidades.length)} observados`} />
        <Kpi etq="Fachada media" valor={m ? `${fmtNum(m.media)} m` : '—'} sub={m ? `mediana ${fmtNum(m.mediana)} m · ${fmt(m.n)} con medida` : 'sin medidas'} />
        <Kpi etq="Rango de fachada" valor={m ? `${fmtNum(m.min)}–${fmtNum(m.max)} m` : '—'} sub={m ? `${fmt(vac.length - m.n)} vacíos sin medida` : undefined} />
        <Kpi etq="CP con más vacíos" valor={porCp[0]?.cp ?? '—'} sub={porCp[0] ? `${fmt(porCp[0].vacios)} de ${fmt(porCp[0].n)}` : 'sin datos de CP'} />
      </div>
      <Bloque titulo="Longitud de fachada (m)">
        <Histograma etiqueta="Fachada" color="#7d8ea8" partes={histograma(vac.filter((u) => typeof u.metros === 'number').map((u) => u.metros!), [0, 3, 5, 8, 12, 20, Infinity], ['<3', '3–5', '5–8', '8–12', '12–20', '≥20'])} />
      </Bloque>
      <Bloque titulo="Calles con más locales vacíos*"><TablaCalles unidades={unidades} criterio="vacios" setFiltros={setFiltros} filtros={filtros} /></Bloque>
      <Bloque titulo="Vacíos por código postal" nota="El CP solo se muestra si consta en el origen: no se deduce de la calle ni del municipio.">
        {!hayCp || !porCp.length ? <SinDatos texto="Estos datos no incluyen código postal." /> : (
          <>
            <table className="tabla vz-tabla">
              <thead><tr><th>CP</th><th className="num">Observados</th><th className="num">Vacíos</th><th className="num">% vacíos</th></tr></thead>
              <tbody>{porCp.map((c) => <tr key={c.cp}><td>{c.cp}</td><td className="num">{fmt(c.n)}</td><td className="num">{fmt(c.vacios)}</td><td className="num">{c.n >= UMBRAL_CALLE ? fmtPct(c.prop) : '—*'}</td></tr>)}</tbody>
            </table>
            {mayorProp && <p className="vz-nota">Mayor proporción de vacíos: CP {mayorProp.cp} ({fmtPct(mayorProp.prop)}, {fmt(mayorProp.vacios)} de {fmt(mayorProp.n)}). * Porcentaje solo con al menos {UMBRAL_CALLE} observados.</p>}
          </>
        )}
      </Bloque>
    </>
  );
}

export function Digital1({ unidades }: { unidades: UnidadPanel[] }) {
  const db = useStore((s) => s.db!);
  const ocup = unidades.filter((u) => !u.vacio);
  const [v, setV] = useState<VariableDigital>('web');
  const matriz = matrizCalor(unidades);
  const valoresCalle = useMemo(() => {
    const m = new Map<string, { valor: number | null; den: number }>();
    const por = new Map<string, UnidadPanel[]>();
    for (const u of ocup) por.set(u.calleId, [...(por.get(u.calleId) ?? []), u]);
    for (const [c, us] of por) { const p = adopcion(us, v); m.set(c, { valor: p.den ? p.n / p.den : null, den: p.den }); }
    return m;
  }, [ocup, v]);
  const calles = useMemo(() => [...new Set(ocup.map((u) => u.calleId))].map((id) => db.calles[id]).filter(Boolean), [ocup, db.calles]);
  const estados = { verificada: 0, borrador: 0, 'sin-datos': 0 };
  for (const u of ocup) if (u.digitalEstado !== 'no-aplica') estados[u.digitalEstado]++;
  return (
    <>
      <Bloque titulo="Estado de la revisión digital" ancho nota="Un dato importado o en borrador NO es una comprobación de la campaña: solo «verificada» lo es.">
        <Apilada etiqueta="Estado de la revisión digital" segmentos={[{ t: 'Verificada', n: estados.verificada, color: '#0b7a53' }, { t: 'Borrador o importada', n: estados.borrador, color: '#f0b44c' }, { t: 'Sin datos', n: estados['sin-datos'], color: '#dfe4ec' }]} />
      </Bloque>
      <Bloque titulo="Presencia y adopción por canal" ancho nota={`Denominador de cada barra: los ${fmt(ocup.length)} establecimientos ocupados. La adopción (%) se calcula sobre las respuestas Sí/No.`}>
        <div className="vz-canales">
          {VARIABLES_PRESENCIA.map((x) => {
            const r = respuestas(unidades, x.v);
            return (
              <div key={x.v} className="vz-canal">
                <div className="fila"><b className="esp">{x.t}</b><span className="muted">adopción {textoProp(adopcion(unidades, x.v))}</span></div>
                <Apilada etiqueta={x.t} den={r.den} segmentos={RESPUESTAS.map((y) => ({ t: y.t, n: r[y.r], color: COLOR_RESP[y.r] }))} />
              </div>
            );
          })}
        </div>
      </Bloque>
      <Bloque titulo="Mapa de calor por calle (adopción, % de Sí)" ancho>
        <MatrizCalor filas={matriz} columnas={VARIABLES_PRESENCIA.map((x) => x.t)} minN={MIN_CELDA} />
      </Bloque>
      <Bloque titulo="Mapa por calle" ancho nota="Se colorea la geometría de cada calle con el valor agregado de sus establecimientos: no se inventan coordenadas de locales.">
        <label className="fila" style={{ gap: 6 }}><span className="muted">Indicador</span>
          <select className="input" aria-label="Indicador del mapa" style={{ width: 'auto' }} value={v} onChange={(e) => setV(e.target.value as VariableDigital)}>{VARIABLES_PRESENCIA.map((x) => <option key={x.v} value={x.v}>{x.t}</option>)}</select>
        </label>
        <MapaCalles calles={calles} valores={valoresCalle} minN={MIN_CELDA} />
      </Bloque>
    </>
  );
}

export function Digital2({ unidades }: { unidades: UnidadPanel[] }) {
  const ocup = unidades.filter((u) => !u.vacio);
  const resenas = valores(unidades, 'numResenas');
  const eR = estadisticos(resenas);
  const google = ocup.filter((u) => u.digital.googleBusiness?.respuesta === 'si');
  const responde = respuestas(google, 'respondeResenas');
  const indices = ocup.map(indicePresencia);
  const completos = indices.filter((x): x is number => x !== null);
  const redes: { v: VariableDigital; t: string }[] = [{ v: 'seguidoresInstagram', t: 'Instagram' }, { v: 'seguidoresFacebook', t: 'Facebook' }, { v: 'seguidoresTwitter', t: 'Twitter / X' }];
  const porSector = compararGrupos(ocup, (u) => u.sector, indicePresencia);
  const porFranq = compararGrupos(ocup, (u) => (u.franquicia === 'si' ? 'Franquicia' : u.franquicia === 'no' ? 'No franquicia' : undefined), indicePresencia);
  return (
    <>
      <Bloque titulo="Reseñas de Google" nota="Solo establecimientos con Google Business = Sí y número de reseñas registrado.">
        {eR ? <p className="vz-cifras"><b>{fmt(eR.n)}</b> con dato · mediana <b>{fmtNum(eR.mediana, 0)}</b> · P25–P75 {fmtNum(eR.p25, 0)}–{fmtNum(eR.p75, 0)} · máximo {fmt(eR.max)}</p> : null}
        <Histograma etiqueta="Reseñas" partes={histograma(resenas, [0, 1, 11, 51, 101, 501, Infinity], ['0', '1–10', '11–50', '51–100', '101–500', '>500'])} />
      </Bloque>
      <Bloque titulo="Respuesta a reseñas" nota={`Entre los ${fmt(google.length)} establecimientos con Google Business = Sí.`}>
        <Apilada etiqueta="Respuesta a reseñas" den={responde.den} segmentos={RESPUESTAS.map((y) => ({ t: y.t, n: responde[y.r], color: COLOR_RESP[y.r] }))} />
      </Bloque>
      <Bloque titulo="Seguidores en redes" ancho nota="Solo con la red = Sí y cifra registrada. Mediana y cuartiles: menos sensibles a valores extremos que la media.">
        <table className="tabla vz-tabla">
          <thead><tr><th>Red</th><th className="num">Con dato</th><th className="num">Mediana</th><th className="num">P25</th><th className="num">P75</th><th className="num">Máximo</th></tr></thead>
          <tbody>{redes.map((r) => { const e = estadisticos(valores(unidades, r.v)); return <tr key={r.v}><td>{r.t}</td><td className="num">{fmt(e?.n ?? 0)}</td><td className="num">{fmtNum(e?.mediana ?? null, 0)}</td><td className="num">{fmtNum(e?.p25 ?? null, 0)}</td><td className="num">{fmtNum(e?.p75 ?? null, 0)}</td><td className="num">{e ? fmt(e.max) : '—'}</td></tr>; })}</tbody>
        </table>
      </Bloque>
      <Bloque titulo="Índice de presencia digital (0–6)" nota={`Canales con Sí entre web, Google, venta online, Instagram, Facebook y Twitter / X. Solo se calcula con los seis respondidos (Sí/No): ${fmt(completos.length)} de ${fmt(ocup.length)} ocupados.`}>
        {completos.length ? <p className="vz-cifras">Media <b>{fmtNum(completos.reduce((a, b) => a + b, 0) / completos.length, 2)}</b> · mediana {fmtNum(estadisticos(completos)!.mediana, 1)}</p> : null}
        <Histograma etiqueta="Índice de presencia" color="#0b7a53" partes={histograma(completos, [0, 1, 2, 3, 4, 5, 6], ['0', '1', '2', '3', '4', '5–6'])} />
      </Bloque>
      <Bloque titulo="Índice medio por sector y por franquicia" nota={`Grupos con menos de ${MIN_GRUPO} establecimientos con el índice completo: «datos insuficientes».`}>
        {!porSector.length && !porFranq.length ? <SinDatos /> : (
          <table className="tabla vz-tabla">
            <thead><tr><th>Grupo</th><th className="num">n</th><th className="num">Índice medio</th></tr></thead>
            <tbody>{[...porSector, ...porFranq].map((g) => <tr key={g.grupo}><td>{g.grupo}</td><td className="num">{fmt(g.n)}</td><td className="num">{g.suficiente ? fmtNum(g.media, 2) : <span className="muted">datos insuficientes</span>}</td></tr>)}</tbody>
          </table>
        )}
      </Bloque>
    </>
  );
}

export function Cobertura({ datos, unidades }: { datos: DatosCampana; unidades: UnidadPanel[] }) {
  const c = datos.correspondencias;
  const ocup = unidades.filter((u) => !u.vacio);
  const origen = { manual: 0, heredado: 0, importado: 0, ninguno: 0 };
  for (const u of ocup) origen[u.franquiciaOrigen ?? 'ninguno']++;
  return (
    <>
      <div className="vz-kpis vz-ancho">
        <Kpi etq="Calles con registros" valor={`${fmt(datos.callesConRegistros)} de ${fmt(datos.callesAmbito)}`} sub="del ámbito de la campaña" />
        <Kpi etq="Pendientes de visita" valor={fmt(datos.pendientesVisita)} sub="locales de la campaña anterior aún no observados" tono={datos.pendientesVisita ? 'aviso' : undefined} />
        <Kpi etq="Sin local identificado" valor={fmt(unidades.filter((u) => u.sinLocal).length)} sub="registros con correspondencia pendiente" />
        {datos.registrosCensales > 0 && <Kpi etq="Registros censales" valor={fmt(datos.registrosCensales)} sub={`${fmt(datos.registrosCensales - unidades.length)} sin establecimiento observado (calle no reconocida, estado desconocido…)`} />}
      </div>
      <Bloque titulo="Correspondencias registro–local" nota="Solo en importaciones: «probable» se creó a partir de la fila y está pendiente de conciliar con otras campañas.">
        <Apilada etiqueta="Correspondencias" segmentos={[{ t: 'Confirmada', n: c.confirmada, color: '#0b7a53' }, { t: 'Probable', n: c.probable, color: '#7fb6ff' }, { t: 'Dudosa', n: c.dudosa, color: '#f0b44c' }, { t: 'Sin vínculo', n: c.sinVinculo, color: '#dfe4ec' }]} />
      </Bloque>
      <Bloque titulo="Fuente de la clasificación"><FuentesClasificacion unidades={unidades} /></Bloque>
      <Bloque titulo="Origen del dato de franquicia">
        <Apilada etiqueta="Origen de la franquicia" segmentos={[{ t: 'Comprobada (manual)', n: origen.manual, color: '#0b7a53' }, { t: 'Heredada (borrador)', n: origen.heredado, color: '#7fb6ff' }, { t: 'Importada (histórica)', n: origen.importado, color: '#7a4fd1' }, { t: 'Sin dato', n: origen.ninguno, color: '#dfe4ec' }]} />
      </Bloque>
    </>
  );
}

export function Comparar({ datos, filtros }: { datos: DatosCampana; filtros: FiltrosPanel }) {
  const db = useStore((s) => s.db!);
  const otras = Object.values(db.campanas).filter((c) => c.id !== datos.campana.id).sort((a, b) => (a.municipioId === datos.municipio.id ? -1 : 1) - (b.municipioId === datos.municipio.id ? -1 : 1) || b.anio - a.anio);
  const [otraId, setOtraId] = useState(datos.campana.campanaReferenciaId ?? otras[0]?.id);
  const otro = useMemo(() => (otraId && db.campanas[otraId] ? datosCampana(db, otraId) : null), [db, otraId]);
  if (!otro) return <SinDatos texto="No hay otra campaña con la que comparar." />;
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
  const fila = (t: string, f: (x: (typeof filas)[number]) => string) => <tr key={t}><td>{t}</td><td className="num">{f(a)}</td><td className="num">{f(b)}</td></tr>;
  return (
    <>
      <Bloque titulo="Comparar con" ancho>
        <select className="input" aria-label="Campaña con la que comparar" style={{ maxWidth: 420 }} value={otraId} onChange={(e) => setOtraId(e.target.value)}>
          {otras.map((c) => <option key={c.id} value={c.id}>{db.municipios[c.municipioId]?.nombre} · {c.nombre}</option>)}
        </select>
        <div className="t-info aviso vz-aviso" role="note"><AlertTriangle size={14} /> <div>Las diferencias <b>no</b> son aperturas ni cierres confirmados: para eso hace falta la correspondencia confirmada entre locales (pestaña «Evolución» de Análisis).{avisos.length > 0 && <ul className="vz-destacados">{avisos.map((x) => <li key={x}>{x}</li>)}</ul>}</div></div>
        <table className="tabla vz-tabla" aria-label="Comparación">
          <thead><tr><th>Indicador</th><th className="num">{a.d.municipio.nombre} · {a.d.campana.nombre}</th><th className="num">{b.d.municipio.nombre} · {b.d.campana.nombre}</th></tr></thead>
          <tbody>
            {fila('Calles con registros', (x) => fmt(x.d.callesConRegistros))}
            {fila('Establecimientos observados', (x) => fmt(x.r.establecimientos))}
            {fila('Ocupados', (x) => fmt(x.r.ocupados))}
            {fila('Vacíos', (x) => `${fmt(x.r.vacios)} (${fmtPct(pct({ n: x.r.vacios, den: x.r.establecimientos }))})`)}
            {[...SECTORES, undefined].map((s) => fila(s ?? 'Sin clasificar', (x) => { const n = x.ocup.filter((u) => u.sector === s).length; return `${fmt(n)} (${fmtPct(pct({ n, den: x.ocup.length }))})`; }))}
            {fila('Web (Sí entre Sí/No)', (x) => textoProp(x.web))}
            {fila('Fuente principal de la clasificación', (x) => (x.fuente ? FUENTE_TXT[x.fuente] : '—'))}
          </tbody>
        </table>
      </Bloque>
    </>
  );
}
