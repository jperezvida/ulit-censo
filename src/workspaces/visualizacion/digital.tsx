import { useMemo, useState } from 'react';
import { Gauge, Globe, MessageSquareReply, Star, Users } from 'lucide-react';
import { fmt } from '../../components/ui';
import {
  adopcion, compararGrupos, estadisticos, histograma, indicePresencia, matrizCalor, MIN_CELDA, MIN_GRUPO, perfilGrupos, respuestas, RESPUESTAS, SECTORES, valores,
  VARIABLES_PRESENCIA, type UnidadPanel,
} from '../../domain/panel';
import type { VariableDigital } from '../../domain/types';
import { Apilada, BarrasH, Bloque, Caja, COLOR_RESP, fmtNum, fmtPct, Hallazgos, Histograma, Kpi, MapaCalles, MatrizCalor, TablaCalor, valorProp } from './graficos';
import { SECTOR_CORTO, type Contexto } from './comun';

const CANAL_CORTO: Record<string, string> = { web: 'Web', googleBusiness: 'Google', ventaOnline: 'Venta online', instagram: 'Instagram', facebook: 'Facebook', twitter: 'X' };

/** Digitalización 1: presencia y adopción por canal, por grupo y por calle. */
export function Digital1({ db, unidades, filtros, setFiltros, hayCp }: Contexto) {
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
  const conGeo = calles.some((c) => c.segmentos.some((s) => s.coords.length > 1));
  const estados = { verificada: 0, borrador: 0, 'sin-datos': 0 };
  for (const u of ocup) if (u.digitalEstado !== 'no-aplica') estados[u.digitalEstado]++;
  const canales = VARIABLES_PRESENCIA.map((x) => x.v);
  const porSector = perfilGrupos(unidades, (u) => u.sector).filter((g) => SECTORES.includes(g.grupo as never));
  const porFranq = perfilGrupos(unidades, (u) => (u.franquicia === 'si' ? 'Franquicia: Sí' : u.franquicia === 'no' ? 'Franquicia: No' : undefined));
  const porCp = hayCp ? perfilGrupos(unidades, (u) => (u.cp ? `CP ${u.cp}` : undefined)) : [];
  const fila = (g: (typeof porSector)[number]) => ({ clave: g.grupo, nombre: SECTOR_CORTO[g.grupo] ?? g.grupo, n: g.n, celdas: canales.map((c) => g.adopcion[c]) });

  return (
    <>
      <div className="vz-kpis c-12" style={{ ['--n' as string]: 6 }} aria-label="Adopción por canal">
        {VARIABLES_PRESENCIA.map((x) => {
          const a = adopcion(unidades, x.v);
          const r = respuestas(unidades, x.v);
          return <Kpi key={x.v} etq={x.t} valor={fmtPct(valorProp(a), 0)} sub={`${fmt(a.n)} de ${fmt(a.den)} con respuesta · ${fmt(r.pendiente)} pendientes`} barra={valorProp(a)} color={COLOR_RESP.si} />;
        })}
      </div>

      <Bloque span={4} titulo="Estado de la revisión digital" etiqueta="Estado de la revisión digital" sub={`${fmt(ocup.length)} establecimientos ocupados.`} nota="Un dato importado o en borrador NO es una comprobación de la campaña: solo «verificada» lo es.">
        <Apilada etiqueta="Estado de la revisión digital" segmentos={[{ t: 'Verificada', n: estados.verificada, color: '#2a78d6' }, { t: 'Borrador o importada', n: estados.borrador, color: '#eda100' }, { t: 'Sin datos', n: estados['sin-datos'], color: '#dfe4ec' }]} />
        <h4 className="vz-sub">Completitud: ocupados con respuesta Sí/No</h4>
        <BarrasH mostrarDen={false} total={ocup.length} color="#86b6ef" partes={VARIABLES_PRESENCIA.map((x) => ({ clave: x.v, etiqueta: x.t, n: adopcion(unidades, x.v).den }))} />
      </Bloque>
      <Bloque span={8} titulo="Respuestas por canal" sub={`Denominador de cada barra: los ${fmt(ocup.length)} ocupados. A la derecha, la adopción (Sí entre Sí/No).`}>
        <div className="vz-canales">
          {VARIABLES_PRESENCIA.map((x) => {
            const r = respuestas(unidades, x.v);
            const a = adopcion(unidades, x.v);
            return (
              <div key={x.v} className="vz-canal">
                <b>{x.t}</b>
                <Apilada compacta sinLeyenda etiqueta={x.t} den={r.den} segmentos={RESPUESTAS.map((y) => ({ t: y.t, n: r[y.r], color: COLOR_RESP[y.r] }))} />
                <span className="num">{fmtPct(valorProp(a), 0)}<span>{fmt(a.n)} de {fmt(a.den)}</span></span>
              </div>
            );
          }).slice(0, 6)}
        </div>
        <div className="vz-leyenda">{RESPUESTAS.map((y) => <span key={y.r}><i style={{ background: COLOR_RESP[y.r] }} />{y.t}</span>)}</div>
      </Bloque>

      <Bloque span={6} titulo="Adopción por sector" sub="Sí entre Sí/No, por canal." nota={`Una celda solo se colorea con al menos ${MIN_CELDA} respuestas Sí/No.`}>
        <TablaCalor etiqueta="Adopción por sector" primera="Sector" columnas={canales.map((c) => CANAL_CORTO[c])} minN={MIN_CELDA} filas={porSector.map(fila)} />
      </Bloque>
      <Bloque span={6} titulo={hayCp ? 'Adopción por franquicia y código postal' : 'Adopción según franquicia'} sub="Sí entre Sí/No, por canal.">
        <TablaCalor etiqueta="Adopción por franquicia" primera="Grupo" columnas={canales.map((c) => CANAL_CORTO[c])} minN={MIN_CELDA} filas={[...porFranq, ...porCp].map(fila)} />
      </Bloque>

      <Bloque span={conGeo ? 7 : 12} titulo="Mapa de calor por calle" etiqueta="Mapa de calor por calle (adopción)" sub="Las 20 calles con más ocupados. Pulse una calle en el filtro superior para verla sola.">
        <MatrizCalor filas={matriz} columnas={canales.map((c) => CANAL_CORTO[c])} minN={MIN_CELDA} />
      </Bloque>
      {conGeo ? (
        <Bloque span={5} titulo="Mapa por calle" sub="Adopción del canal elegido en cada calle." nota="No se inventan coordenadas de locales: se colorea la geometría de cada calle." acciones={
          <select className="input" aria-label="Indicador del mapa" style={{ width: 'auto', height: 28, fontSize: 12 }} value={v} onChange={(e) => setV(e.target.value as VariableDigital)}>{VARIABLES_PRESENCIA.map((x) => <option key={x.v} value={x.v}>{x.t}</option>)}</select>
        }>
          <MapaCalles calles={calles} valores={valoresCalle} minN={MIN_CELDA} />
        </Bloque>
      ) : (
        <p className="c-12 vz-nota" style={{ borderTop: 0, marginTop: 0 }}>Las calles de este ámbito no tienen geometría fiable: no se dibuja el mapa por calle y se usa el mapa de calor por calle.</p>
      )}
      {filtros.calleId && <button className="c-12 btn s fantasma" style={{ justifySelf: 'start' }} onClick={() => setFiltros({ ...filtros, calleId: undefined })}>Quitar el filtro de calle</button>}
    </>
  );
}

const REDES: { v: VariableDigital; t: string }[] = [{ v: 'seguidoresInstagram', t: 'Instagram' }, { v: 'seguidoresFacebook', t: 'Facebook' }, { v: 'seguidoresTwitter', t: 'Twitter / X' }];

/** Resumen digital de un grupo de ocupados (medianas solo con suficientes casos). */
function perfilDigital(us: UnidadPanel[]) {
  const google = us.filter((u) => u.digital.googleBusiness?.respuesta === 'si');
  const res = valores(us, 'numResenas');
  const ig = valores(us, 'seguidoresInstagram');
  const idx = us.map(indicePresencia).filter((x): x is number => x !== null);
  return {
    n: us.length,
    google: adopcion(us, 'googleBusiness'),
    resenas: res.length >= MIN_GRUPO ? estadisticos(res)!.mediana : null,
    nResenas: res.length,
    responde: adopcion(google, 'respondeResenas'),
    ig: ig.length >= MIN_GRUPO ? estadisticos(ig)!.mediana : null,
    nIg: ig.length,
    indice: idx.length >= MIN_GRUPO ? idx.reduce((a, b) => a + b, 0) / idx.length : null,
    nIndice: idx.length,
  };
}

function TablaPerfilDigital({ grupos, etiqueta }: { grupos: { nombre: string; us: UnidadPanel[] }[]; etiqueta: string }) {
  const filas = grupos.map((g) => ({ nombre: g.nombre, p: perfilDigital(g.us) })).filter((f) => f.p.n);
  if (!filas.length) return <div className="vz-vacio">Sin datos para estos filtros.</div>;
  const ins = (v: number | null, n: number, f: (x: number) => string) => (v === null ? <span className="muted" title={`${fmt(n)} con dato (mínimo ${MIN_GRUPO})`}>{n ? 'insuf.' : '—'}</span> : f(v));
  return (
    <table className="vz-tabla" aria-label={etiqueta}>
      <thead><tr><th>Grupo</th><th className="num">Ocupados</th><th className="num">Google</th><th className="num">Reseñas (med.)</th><th className="num">Responde</th><th className="num">Seg. IG (med.)</th><th className="num">Índice 0–6</th></tr></thead>
      <tbody>
        {filas.map(({ nombre, p }) => (
          <tr key={nombre}>
            <td>{nombre}</td>
            <td className="num">{fmt(p.n)}</td>
            <td className="num" title={`${fmt(p.google.n)} de ${fmt(p.google.den)}`}>{fmtPct(valorProp(p.google), 0)}</td>
            <td className="num">{ins(p.resenas, p.nResenas, (x) => fmtNum(x, 0))}</td>
            <td className="num" title={`${fmt(p.responde.n)} de ${fmt(p.responde.den)}`}>{p.responde.den >= MIN_GRUPO ? fmtPct(valorProp(p.responde), 0) : <span className="muted">{p.responde.den ? 'insuf.' : '—'}</span>}</td>
            <td className="num">{ins(p.ig, p.nIg, (x) => fmtNum(x, 0))}</td>
            <td className="num"><b>{ins(p.indice, p.nIndice, (x) => fmtNum(x, 2))}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Digitalización 2: intensidad (reseñas, respuesta, seguidores, índice) y cruces. */
export function Digital2({ unidades }: Contexto) {
  const ocup = unidades.filter((u) => !u.vacio);
  const resenas = valores(unidades, 'numResenas');
  const eR = estadisticos(resenas);
  const google = ocup.filter((u) => u.digital.googleBusiness?.respuesta === 'si');
  const responde = respuestas(google, 'respondeResenas');
  const respAdop = adopcion(google, 'respondeResenas');
  const completos = ocup.map(indicePresencia).filter((x): x is number => x !== null);
  const media = completos.length ? completos.reduce((a, b) => a + b, 0) / completos.length : null;
  const eIg = estadisticos(valores(unidades, 'seguidoresInstagram'));
  const estRedes = REDES.map((r) => ({ ...r, e: estadisticos(valores(unidades, r.v)) }));
  const maxRed = Math.max(1, ...estRedes.map((r) => r.e?.p75 ?? 0)) * 1.6;
  const gAdop = adopcion(unidades, 'googleBusiness');
  const porSector = compararGrupos(ocup, (u) => u.sector, indicePresencia);
  const porFranq = compararGrupos(ocup, (u) => (u.franquicia === 'si' ? 'Franquicia' : u.franquicia === 'no' ? 'No franquicia' : undefined), indicePresencia);
  const mejor = [...porSector].filter((g) => g.suficiente).sort((a, b) => (b.media ?? 0) - (a.media ?? 0))[0];
  const fr = porFranq.find((g) => g.grupo === 'Franquicia');
  const nofr = porFranq.find((g) => g.grupo === 'No franquicia');

  const lectura = [
    gAdop.den > 0 && { icono: <Star size={14} />, texto: <>El <b>{fmtPct(valorProp(gAdop), 0)}</b> de los ocupados con respuesta tiene ficha de Google Business ({fmt(gAdop.n)} de {fmt(gAdop.den)}){eR ? <>; la mitad tiene <b>{fmtNum(eR.mediana, 0)} reseñas o menos</b></> : null}.</> },
    respAdop.den > 0 && { icono: <MessageSquareReply size={14} />, texto: <>Responde a las reseñas el <b>{fmtPct(valorProp(respAdop), 0)}</b> de quienes tienen ficha y respuesta registrada ({fmt(respAdop.n)} de {fmt(respAdop.den)}).</> },
    mejor && { icono: <Gauge size={14} />, texto: <><b>{mejor.grupo}</b> tiene el índice de presencia más alto: <b>{fmtNum(mejor.media, 2)}</b> canales de 6 (n = {fmt(mejor.n)}).</> },
    fr?.suficiente && nofr?.suficiente && { icono: <Globe size={14} />, texto: <>Índice medio: <b>{fmtNum(fr.media, 2)}</b> en franquicias frente a <b>{fmtNum(nofr.media, 2)}</b> en el resto (n = {fmt(fr.n)} y {fmt(nofr.n)}).</> },
  ].filter(Boolean) as { icono: JSX.Element; texto: JSX.Element }[];

  return (
    <>
      <div className="vz-kpis c-12" style={{ ['--n' as string]: 6 }} aria-label="Indicadores de intensidad digital">
        <Kpi icono={<Globe size={14} />} etq="Con Google Business" valor={fmtPct(valorProp(gAdop), 0)} sub={`${fmt(gAdop.n)} de ${fmt(gAdop.den)} con respuesta`} barra={valorProp(gAdop)} />
        <Kpi icono={<Star size={14} />} etq="Reseñas (mediana)" valor={eR ? fmtNum(eR.mediana, 0) : '—'} sub={eR ? `P25–P75 ${fmtNum(eR.p25, 0)}–${fmtNum(eR.p75, 0)} · ${fmt(eR.n)} con dato` : 'sin datos de reseñas'} />
        <Kpi icono={<MessageSquareReply size={14} />} etq="Responde a reseñas" valor={fmtPct(valorProp(respAdop), 0)} sub={`${fmt(respAdop.n)} de ${fmt(respAdop.den)} con Google y respuesta`} barra={valorProp(respAdop)} />
        <Kpi icono={<Users size={14} />} etq="Seguidores Instagram" valor={eIg ? fmtNum(eIg.mediana, 0) : '—'} sub={eIg ? `mediana · ${fmt(eIg.n)} con dato` : 'sin datos'} />
        <Kpi icono={<Gauge size={14} />} etq="Índice de presencia" valor={media === null ? '—' : `${fmtNum(media, 2)} / 6`} sub="media de canales con Sí" barra={media === null ? null : media / 6} />
        <Kpi icono={<Gauge size={14} />} etq="Índice calculable" valor={fmtPct(ocup.length ? completos.length / ocup.length : null, 0)} sub={`${fmt(completos.length)} de ${fmt(ocup.length)} con los seis canales respondidos`} barra={ocup.length ? completos.length / ocup.length : null} tono={ocup.length && completos.length / ocup.length < 0.5 ? 'aviso' : undefined} />
      </div>

      <Bloque span={6} titulo="Reseñas de Google" sub="Número de reseñas por establecimiento." nota="Solo establecimientos con Google Business = Sí y número de reseñas registrado.">
        <Histograma etiqueta="Reseñas" partes={histograma(resenas, [0, 1, 11, 51, 101, 501, Infinity], ['0', '1–10', '11–50', '51–100', '101–500', '>500'])} ejeX="Reseñas" />
      </Bloque>
      <Bloque span={6} titulo="Respuesta a reseñas" sub={`Entre los ${fmt(google.length)} establecimientos con Google Business = Sí.`}>
        <div className="vz-dato-grande"><b className="num">{fmtPct(valorProp(respAdop), 0)}</b><span>responde (Sí entre Sí/No)</span></div>
        <Apilada etiqueta="Respuesta a reseñas" den={responde.den} segmentos={RESPUESTAS.map((y) => ({ t: y.t, n: responde[y.r], color: COLOR_RESP[y.r] }))} />
        <h4 className="vz-sub">Por sector</h4>
        <table className="vz-tabla" aria-label="Respuesta a reseñas por sector">
          <thead><tr><th>Sector</th><th className="num">Con Google</th><th className="num">Responde (Sí entre Sí/No)</th></tr></thead>
          <tbody>{SECTORES.map((s) => {
            const g = google.filter((u) => u.sector === s);
            const p = adopcion(g, 'respondeResenas');
            const v = p.den >= MIN_GRUPO ? valorProp(p) : null;
            return <tr key={s}><td>{SECTOR_CORTO[s]}</td><td className="num">{fmt(g.length)}</td><td className="num"><span className="vz-celda-barra">{v !== null && <span className="vz-pista"><span style={{ width: `${v * 100}%`, background: COLOR_RESP.si }} /></span>}{v === null ? <span className="muted">{p.den ? 'insuf.' : '—'}</span> : `${fmtPct(v, 0)} (${fmt(p.n)} de ${fmt(p.den)})`}</span></td></tr>;
          })}</tbody>
        </table>
      </Bloque>

      <Bloque span={6} titulo="Seguidores en redes" sub="Caja: P25–P75 · trazo: mediana · bigote: mínimo a máximo (recortado)." nota="Solo con la red = Sí y cifra registrada. Mediana y cuartiles: menos sensibles a valores extremos que la media.">
        <table className="vz-tabla">
          <thead><tr><th>Red</th><th className="num">Con dato</th><th style={{ width: '38%' }}>Distribución</th><th className="num">Mediana</th><th className="num">P25–P75</th></tr></thead>
          <tbody>{estRedes.map((r) => <tr key={r.v}><td>{r.t}</td><td className="num">{fmt(r.e?.n ?? 0)}</td><td><Caja e={r.e} max={maxRed} /></td><td className="num"><b>{fmtNum(r.e?.mediana ?? null, 0)}</b></td><td className="num muted">{r.e ? `${fmtNum(r.e.p25, 0)}–${fmtNum(r.e.p75, 0)}` : '—'}</td></tr>)}</tbody>
        </table>
      </Bloque>
      <Bloque span={6} titulo="Índice de presencia digital (0–6)" sub="Canales con Sí entre web, Google, venta online, Instagram, Facebook y Twitter / X." nota={`Solo se calcula con los seis respondidos (Sí/No): ${fmt(completos.length)} de ${fmt(ocup.length)} ocupados.`}>
        <Histograma etiqueta="Índice de presencia" color="#1c5cab" partes={histograma(completos, [0, 1, 2, 3, 4, 5, 6], ['0', '1', '2', '3', '4', '5–6'])} ejeX="Canales con Sí" />
      </Bloque>

      <Bloque span={6} titulo="Comparativa por sector" nota={`Medianas e índice solo con al menos ${MIN_GRUPO} casos con dato; si no, «insuf.» (datos insuficientes).`}>
        <TablaPerfilDigital etiqueta="Comparativa digital por sector" grupos={SECTORES.map((s) => ({ nombre: SECTOR_CORTO[s], us: ocup.filter((u) => u.sector === s) }))} />
      </Bloque>
      <Bloque span={6} titulo="Comparativa por franquicia" nota="Solo establecimientos con respuesta Sí o No sobre franquicia.">
        <TablaPerfilDigital etiqueta="Comparativa digital por franquicia" grupos={[{ nombre: 'Franquicia', us: ocup.filter((u) => u.franquicia === 'si') }, { nombre: 'No franquicia', us: ocup.filter((u) => u.franquicia === 'no') }]} />
      </Bloque>

      <Bloque span={12} titulo="Lectura ejecutiva" sub="Hallazgos calculados con los filtros actuales; cada uno con su denominador.">
        <Hallazgos items={lectura} />
      </Bloque>
    </>
  );
}
