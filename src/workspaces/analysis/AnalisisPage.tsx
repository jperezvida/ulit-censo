import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GeoJSONSource, Map as MLMap, MapLayerMouseEvent } from 'maplibre-gl';
import { AlertTriangle, Download, FileSpreadsheet, Info, Printer } from 'lucide-react';
import { useContexto, useFichaLocal, useIndices } from '../../store/contexto';
import { compararCampanas, resumenCampana } from '../../domain/estadisticas';
import { coberturaCalle, esCompletada, itinerariosDe } from '../../domain/consultas';
import { aCSV, COLUMNAS_TRADICIONALES, descargar, filasExport } from '../../domain/exportacion';
import { COLOR_GRUPO, TAXONOMIA } from '../../domain/taxonomy';
import { MapaBase } from '../../components/mapa/MapaBase';
import { geojsonLocales } from '../territory/capas';
import { Segmentado, Sim, fmt } from '../../components/ui';
import type { Id } from '../../domain/types';
import '../../styles/analisis.css';

type Tab = 'evolucion' | 'mapa' | 'exportar';

export default function AnalisisPage() {
  const { campana, municipio } = useContexto();
  const [tab, setTab] = useState<Tab>('evolucion');
  if (!campana) return null;
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div className="esp">
          <div className="rotulo sin-linea">06 · Histórico y análisis · {municipio.nombre}</div>
          <h1>Evolución del comercio</h1>
          <p>Las comparaciones separan la evolución real (mismo ámbito) de lo incorporado por ampliación. Aperturas y cierres solo con correspondencia confirmada.</p>
        </div>
        <Segmentado valor={tab} onCambio={setTab} opciones={[{ v: 'evolucion', t: 'Evolución' }, { v: 'mapa', t: 'Mapa de actividad' }, { v: 'exportar', t: 'Exportar' }]} />
      </div>
      {tab === 'evolucion' && <Evolucion />}
      {tab === 'mapa' && <MapaActividad />}
      {tab === 'exportar' && <Exportar />}
    </div>
  );
}

function Evolucion() {
  const { db, campanas, campana } = useContexto();
  const [aId, setA] = useState<Id>(campana?.campanaReferenciaId ?? campanas[Math.max(0, campanas.length - 2)]?.id);
  const [bId, setB] = useState<Id>(campana?.campanaReferenciaId ? campana.id : campanas[campanas.length - 1]?.id);
  const cmp = useMemo(() => (aId && bId && aId !== bId ? compararCampanas(db, aId, bId) : null), [db, aId, bId]);
  const serie = useMemo(
    () =>
      campanas.map((c, i) => {
        const prev = campanas[i - 1];
        const ambPrev = new Set(prev?.ambitoCalleIds ?? []);
        const comun = new Set(c.ambitoCalleIds.filter((id) => !prev || ambPrev.has(id)));
        const ampl = new Set(c.ambitoCalleIds.filter((id) => prev && !ambPrev.has(id)));
        const rC = resumenCampana(db, c.id, comun);
        const rA = resumenCampana(db, c.id, ampl);
        const cob = c.ambitoCalleIds.length ? c.ambitoCalleIds.filter((id) => esCompletada(coberturaCalle(db, c.id, id).estado)).length / c.ambitoCalleIds.length : 0;
        const r = resumenCampana(db, c.id);
        return { c, comun: rC.locales, ampl: rA.locales, cob, enCurso: c.estados.campo !== 'terminado', dig: r.digital, ocupados: r.ocupados };
      }),
    [db, campanas],
  );
  if (campanas.length < 2) return <div className="vacio-estado tarjeta">Se necesitan al menos dos campañas para comparar.</div>;
  const B = bId ? db.campanas[bId] : undefined;
  const maxSerie = Math.max(1, ...serie.map((s) => s.comun + s.ampl));
  const enCursoB = B && B.estados.campo !== 'terminado';
  const cobB = serie.find((s) => s.c.id === bId)?.cob ?? 0;

  return (
    <div className="an-rejilla">
      <div className="an-selector tarjeta">
        <span>Comparar</span>
        <select className="input" value={aId} onChange={(e) => setA(e.target.value)}>{campanas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <span>→</span>
        <select className="input" value={bId} onChange={(e) => setB(e.target.value)}>{campanas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <span className="esp" />
        <Sim texto="Cifras sobre datos ficticios" />
      </div>
      {enCursoB && (
        <div className="t-info aviso an-ancho" style={{ margin: 0 }}>
          <AlertTriangle size={15} /> {B!.nombre} está en curso: el campo cubre el {Math.round(cobB * 100)} % de las calles del ámbito. Los locales aún no visitados aparecen como «no observados» (indeterminados), nunca como cierres.
        </div>
      )}
      {cmp && (
        <>
          <div className="an-kpis an-ancho">
            <Kpi etq="Locales · ámbito comparable" a={cmp.anterior.locales} b={cmp.posteriorComparable.locales} sub={`${cmp.comparables.length} calles censadas en ambas campañas`} />
            <Kpi etq="Incorporados por ampliación" b={cmp.posteriorAmpliacion.locales} soloB sub={`${cmp.ampliacion.length} calles nuevas: no es crecimiento del comercio`} tono="ampl" />
            <Kpi etq="Vacíos · ámbito comparable" a={cmp.anterior.vacios} b={cmp.posteriorComparable.vacios} sub={`${pct(cmp.anterior.vacios, cmp.anterior.locales)} → ${pct(cmp.posteriorComparable.vacios, cmp.posteriorComparable.locales)} de los locales`} invertir />
            <Kpi etq="Indeterminados" b={cmp.indeterminados.noObservados + cmp.indeterminados.altasSinCorrespondencia + cmp.indeterminados.posiblesDesapariciones} soloB sub="sin correspondencia confirmada" tono="gris" />
          </div>

          <section className="tarjeta an-bloque">
            <h3>Cambios confirmados en el ámbito comparable</h3>
            <p className="muted">Solo locales con correspondencia confirmada entre {db.campanas[aId].anio} y {B!.anio}.</p>
            <BarrasFlujo
              filas={[
                { t: 'Sin cambios de ocupación', v: cmp.sinCambios, c: '#7d8ea8' },
                { t: 'Aperturas (vacío → ocupado o alta confirmada)', v: cmp.aperturas, c: '#0b7a53' },
                { t: 'Cierres (ocupado → vacío)', v: cmp.cierres, c: '#b42318' },
                { t: 'Cambio de negocio en el local', v: cmp.cambiosActividad, c: '#0065fe' },
              ]}
            />
            <h4>Indeterminados (no se interpretan)</h4>
            <BarrasFlujo
              rayado
              filas={[
                { t: 'Locales anteriores aún no observados', v: cmp.indeterminados.noObservados, c: '#97a3b5' },
                { t: 'Altas sin correspondencia confirmada', v: cmp.indeterminados.altasSinCorrespondencia, c: '#97a3b5' },
                { t: 'Posibles desapariciones físicas', v: cmp.indeterminados.posiblesDesapariciones, c: '#97a3b5' },
              ]}
            />
          </section>

          <section className="tarjeta an-bloque">
            <h3>Ocupados por grupo de actividad</h3>
            <p className="muted">Ámbito comparable. Gris: {db.campanas[aId].anio}; color: {B!.anio}.</p>
            <GruposComparados a={cmp.anterior.porGrupo} b={cmp.posteriorComparable.porGrupo} anioA={db.campanas[aId].anio} anioB={B!.anio} />
          </section>
        </>
      )}

      <section className="tarjeta an-bloque an-ancho">
        <h3>Locales por campaña: ámbito anterior y ampliación</h3>
        <p className="muted">La parte rayada son locales de calles incorporadas en esa campaña. Compararla con la anterior inflaría el crecimiento.</p>
        <div className="an-serie">
          {serie.map((s) => (
            <div key={s.c.id} className="an-serie-fila">
              <span className="mono an-serie-anio">{s.c.anio}</span>
              <div className="an-serie-barra">
                <span className="seg comun" style={{ width: `${(s.comun / maxSerie) * 100}%` }} title={`${s.c.nombre}: ${fmt(s.comun)} locales en calles ya censadas`} />
                {s.ampl > 0 && <span className="seg ampl" style={{ width: `${(s.ampl / maxSerie) * 100}%` }} title={`${fmt(s.ampl)} locales en calles de ampliación`} />}
              </div>
              <span className="an-serie-v num">
                <b>{fmt(s.comun + s.ampl)}</b>
                {s.ampl > 0 && <span className="muted"> · +{fmt(s.ampl)} ampl.</span>}
                {s.enCurso && <span className="chip aviso" style={{ marginLeft: 6 }}>en curso · {Math.round(s.cob * 100)} % calles</span>}
              </span>
            </div>
          ))}
        </div>
        <div className="an-leyenda">
          <span><i className="seg comun" /> Calles ya censadas en la campaña anterior</span>
          <span><i className="seg ampl" /> Ampliación territorial</span>
        </div>
      </section>

      <section className="tarjeta an-bloque an-ancho">
        <h3>Digitalización (solo mediciones verificadas en cada campaña)</h3>
        <table className="tabla an-dig">
          <thead><tr><th>Campaña</th><th>Verificados</th><th>Página web</th><th>Google Business</th><th>Instagram</th><th>Sin verificar</th></tr></thead>
          <tbody>
            {serie.map((s) => (
              <tr key={s.c.id}>
                <td><b>{s.c.nombre}</b></td>
                <td className="num">{fmt(s.dig.verificados)} / {fmt(s.ocupados)}</td>
                <td><MiniPct v={s.dig.conWeb} n={s.dig.verificados} /></td>
                <td><MiniPct v={s.dig.conGoogle} n={s.dig.verificados} /></td>
                <td><MiniPct v={s.dig.conInstagram} n={s.dig.verificados} /></td>
                <td className="num muted">{fmt(s.dig.sinVerificar)}{s.dig.sinVerificar > 0 && s.dig.verificados === 0 ? ' · pendiente de revisar' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12 }}>Un dato de una campaña anterior no cuenta como verificado en la siguiente.</p>
      </section>
    </div>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');

function Kpi({ etq, a, b, sub, soloB, tono, invertir }: { etq: string; a?: number; b: number; sub: string; soloB?: boolean; tono?: 'ampl' | 'gris'; invertir?: boolean }) {
  const d = a !== undefined ? b - a : 0;
  const bueno = invertir ? d < 0 : d > 0;
  return (
    <div className={`an-kpi tarjeta ${tono ?? ''}`}>
      <div className="an-kpi-etq">{etq}</div>
      <div className="an-kpi-v num">
        {!soloB && a !== undefined && <span className="an-kpi-a">{fmt(a)} →</span>}
        {soloB && tono === 'ampl' ? '+' : ''}{fmt(b)}
        {!soloB && a !== undefined && d !== 0 && <span className={`an-delta ${bueno ? 'up' : 'down'}`}>{d > 0 ? '+' : ''}{fmt(d)}</span>}
      </div>
      <div className="an-kpi-sub">{sub}</div>
    </div>
  );
}

function BarrasFlujo({ filas, rayado }: { filas: { t: string; v: number; c: string }[]; rayado?: boolean }) {
  const max = Math.max(1, ...filas.map((f) => f.v));
  return (
    <div className="an-flujo">
      {filas.map((f) => (
        <div key={f.t} className="an-flujo-fila" title={`${f.t}: ${fmt(f.v)}`}>
          <span className="an-flujo-t">{f.t}</span>
          <div className="an-flujo-barra">
            <span className={rayado ? 'rayado' : ''} style={{ width: `${(f.v / max) * 100}%`, background: rayado ? undefined : f.c }} />
          </div>
          <b className="num">{fmt(f.v)}</b>
        </div>
      ))}
    </div>
  );
}

function GruposComparados({ a, b, anioA, anioB }: { a: Record<string, number>; b: Record<string, number>; anioA: number; anioB: number }) {
  const grupos = TAXONOMIA.filter((n) => n.nivel === 1);
  const max = Math.max(1, ...Object.values(a), ...Object.values(b));
  return (
    <div className="an-grupos">
      {grupos.map((g) => (
        <div key={g.id} className="an-grupo">
          <span className="an-grupo-t">{g.nombre}</span>
          <div className="an-grupo-barras">
            <div className="an-gb" title={`${g.nombre} ${anioA}: ${a[g.nombre] ?? 0}`}><span style={{ width: `${((a[g.nombre] ?? 0) / max) * 100}%`, background: '#b9c2cf' }} /><em className="num">{fmt(a[g.nombre] ?? 0)}</em></div>
            <div className="an-gb" title={`${g.nombre} ${anioB}: ${b[g.nombre] ?? 0}`}><span style={{ width: `${((b[g.nombre] ?? 0) / max) * 100}%`, background: COLOR_GRUPO[g.id] }} /><em className="num">{fmt(b[g.nombre] ?? 0)}</em></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniPct({ v, n }: { v: number; n: number }) {
  const p = n ? v / n : 0;
  return (
    <span className="an-minipct" title={`${v} de ${n}`}>
      <span className="an-minipct-b"><span style={{ width: `${p * 100}%` }} /></span>
      <span className="num">{n ? `${Math.round(p * 100)} %` : '—'}</span>
    </span>
  );
}

function MapaActividad() {
  const { db, municipio, campana } = useContexto();
  const ix = useIndices();
  const ficha = useFichaLocal();
  const fichaRef = useRef(ficha);
  fichaRef.current = ficha;
  const mapa = useRef<MLMap | null>(null);
  const [listo, setListo] = useState(false);
  const [grupo, setGrupo] = useState<string>('');
  const [soloVacios, setSoloVacios] = useState(false);
  const datos = useMemo(() => geojsonLocales(db, municipio.id, campana, ix), [db, municipio.id, campana, ix]);
  const alListo = useCallback((m: MLMap) => {
    mapa.current = m;
    m.addSource('loc', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'loc', type: 'circle', source: 'loc', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 8],
      'circle-color': ['case', ['==', ['get', 'vacio'], 1], '#ffffff', ['get', 'color']],
      'circle-stroke-color': ['case', ['==', ['get', 'vacio'], 1], '#3b4a61', '#ffffff'],
      'circle-stroke-width': ['case', ['==', ['get', 'vacio'], 1], 1.8, 1],
    } });
    m.on('click', 'loc', (e: MapLayerMouseEvent) => e.features?.[0] && fichaRef.current.abrir(e.features[0].properties.localId));
    m.on('mouseenter', 'loc', () => (m.getCanvas().style.cursor = 'pointer'));
    m.on('mouseleave', 'loc', () => (m.getCanvas().style.cursor = ''));
    setListo(true);
  }, []);
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    const g = TAXONOMIA.find((n) => n.nombre === grupo);
    const f = datos.features.filter((x) => (soloVacios ? x.properties!.vacio === 1 : !g || x.properties!.color === COLOR_GRUPO[g.id]));
    (m.getSource('loc') as GeoJSONSource).setData({ type: 'FeatureCollection', features: f });
  }, [datos, grupo, soloVacios, listo]);

  if (municipio.fuenteCallejero === 'sin-geometria') return <div className="vacio-estado tarjeta">{municipio.nombre} no tiene geometría en el prototipo: el mapa temático se prueba en Medina del Campo.</div>;
  const n = datos.features.length;
  return (
    <div className="an-mapa tarjeta">
      <div className="an-mapa-barra">
        <select className="input" value={grupo} onChange={(e) => { setGrupo(e.target.value); setSoloVacios(false); }} style={{ width: 200 }}>
          <option value="">Todos los grupos</option>
          {TAXONOMIA.filter((t) => t.nivel === 1).map((t) => <option key={t.id}>{t.nombre}</option>)}
        </select>
        <label className="fila" style={{ fontSize: 13 }}><input type="checkbox" checked={soloVacios} onChange={(e) => setSoloVacios(e.target.checked)} /> Solo vacíos</label>
        <span className="esp" />
        <div className="an-leyenda">
          {TAXONOMIA.filter((t) => t.nivel === 1).map((t) => <span key={t.id}><i style={{ background: COLOR_GRUPO[t.id], borderRadius: '50%' }} /> {t.nombre}</span>)}
          <span><i style={{ background: '#fff', border: '1.5px solid #3b4a61', borderRadius: '50%' }} /> Vacío</span>
        </div>
      </div>
      <div className="an-mapa-lienzo">
        <MapaBase centro={municipio.centro!} zoom={15} onListo={alListo} />
      </div>
      <p className="muted" style={{ fontSize: 12, padding: '8px 14px', margin: 0 }}>
        <Info size={12} /> {fmt(n)} locales de {campana?.nombre} (o de su campaña de referencia si aún no se han visitado). Mapa de actividad independiente del mapa de cobertura territorial (Territorio → Cobertura). Posiciones ficticias.
      </p>
    </div>
  );
}

function Exportar() {
  const { db, campana, municipio } = useContexto();
  const nav = useNavigate();
  const its = campana ? itinerariosDe(db, campana.id) : [];
  const [ambito, setAmbito] = useState<string>('todo');
  const filas = useMemo(() => {
    if (!campana) return [];
    if (ambito === 'todo') return filasExport(db, campana.id);
    if (ambito.startsWith('it:')) return filasExport(db, campana.id, { itinerarioId: ambito.slice(3) });
    return filasExport(db, campana.id, { calleIds: new Set([ambito.slice(2)]) });
  }, [db, campana, ambito]);
  if (!campana) return null;
  const callesCampana = campana.ambitoCalleIds.map((id) => db.calles[id]).filter(Boolean).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const nombre = `${municipio.nombre.replace(/\s+/g, '_')}_${campana.anio}_${ambito === 'todo' ? 'completo' : ambito.replace(':', '-')}.csv`;
  return (
    <div className="an-export">
      <div className="tarjeta an-bloque">
        <h3>Excel compatible con el censo tradicional</h3>
        <div className="fila" style={{ flexWrap: 'wrap' }}>
          <select className="input" style={{ width: 280 }} value={ambito} onChange={(e) => setAmbito(e.target.value)}>
            <option value="todo">{municipio.nombre} · {campana.nombre} completo</option>
            <optgroup label="Por itinerario">{its.map((i) => <option key={i.id} value={`it:${i.id}`}>{i.codigo} · {i.nombre}</option>)}</optgroup>
            <optgroup label="Por calle">{callesCampana.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.nombre}</option>)}</optgroup>
          </select>
          <button className="btn primario" onClick={() => descargar(nombre, aCSV(filas))} disabled={!filas.length}><Download size={15} /> Descargar CSV ({fmt(filas.length)} filas)</button>
          <Sim texto="Contenido ficticio" />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>CSV con separador «;» y UTF-8, se abre directamente en Excel. Columnas provisionales hasta recibir la estructura real; las métricas digitales indican si están verificadas en esta campaña.</p>
        <div className="dat-tabla scroll-fino" style={{ maxHeight: 360 }}>
          <table className="tabla">
            <thead><tr>{COLUMNAS_TRADICIONALES.slice(0, 12).map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{filas.slice(0, 25).map((f, i) => <tr key={i}>{COLUMNAS_TRADICIONALES.slice(0, 12).map((c) => <td key={c} style={{ whiteSpace: 'nowrap' }}>{f[c]}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
      <div className="tarjeta an-bloque">
        <h3>Mapas y hojas de campo</h3>
        <p className="muted">Documento A4 por itinerario con mapa numerado, listado de calles y locales anteriores con espacio para anotar.</p>
        <div className="an-its">
          {its.length === 0 && <span className="muted">Esta campaña no tiene itinerarios.</span>}
          {its.map((i) => (
            <button key={i.id} className="btn" onClick={() => nav(`/imprimir/${i.id}`)} style={{ borderLeft: `4px solid ${i.color}` }}>
              <Printer size={14} /> {i.codigo} · {i.nombre}
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}><FileSpreadsheet size={12} /> Informes para ayuntamientos: previstos en la siguiente fase a partir de estas mismas cifras.</p>
      </div>
    </div>
  );
}
