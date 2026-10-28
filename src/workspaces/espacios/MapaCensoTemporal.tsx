import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LngLatBounds, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { AlertTriangle, ArrowLeft, Info } from 'lucide-react';
import { MapaBase } from '../../components/mapa/MapaBase';
import { fmt } from '../../components/ui';
import { useEspacios } from '../../store/espacios';
import { censoTemporal, filtrar, LOCALIZACION_TXT, porCalle, type FiltrosCenso } from '../../domain/censoTemporal';
import { useAsistenteEspacio } from './estadoAsistenteEspacio';
import type { LngLat } from '../../domain/types';

const POR_PAGINA = 100;
const ESTADO_TXT = { ocupado: 'Ocupado', vacio: 'Vacío', desconocido: 'Sin dato' } as const;

/**
 * C1e-B · El censo analizado (en memoria, sin guardar) sobre el callejero del municipio. Reutiliza el
 * mapa base de la aplicación. Cada calle reconocida se dibuja con el número de registros que tiene; no se
 * sitúa ningún establecimiento en un punto, porque el archivo no da la posición del portal.
 */
export function MapaCensoTemporal({ onVolver }: { onVolver: () => void }) {
  const db = useEspacios((s) => s.db!);
  const preparado = useAsistenteEspacio((s) => s.preparado)!;
  const censo = useMemo(() => censoTemporal(preparado.resultado, preparado.plan), [preparado]);
  const [f, setF] = useState<FiltrosCenso>({});
  const [n, setN] = useState(POR_PAGINA);
  const lista = useMemo(() => filtrar(censo.registros, f), [censo, f]);
  const calles = useMemo(() => porCalle(db, lista), [db, lista]);
  const opcionesCalle = useMemo(() => porCalle(db, censo.registros).map((c) => [c.calleId, c.nombre] as const).sort((a, b) => a[1].localeCompare(b[1], 'es')), [db, censo]);
  const actividades = useMemo(() => [...new Set(censo.registros.map((r) => r.actividad))].sort((a, b) => a.localeCompare(b, 'es')), [censo]);
  const max = Math.max(1, ...calles.map((c) => c.registros));
  const r = censo.resumen;
  const sinLoc = lista.filter((x) => x.localizacion === 'sin-localizacion').length;

  const mapa = useRef<MLMap | null>(null);
  const [listo, setListo] = useState(false);
  const elegir = useRef((calleId: string) => setF((x) => ({ ...x, calleId })));
  const alListo = useCallback((m: MLMap) => {
    mapa.current = m;
    m.addSource('censo', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'censo-l', type: 'line', source: 'censo', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['interpolate', ['linear'], ['get', 'peso'], 0, '#9ec5ff', 1, '#0b3a8c'], 'line-width': ['interpolate', ['linear'], ['get', 'peso'], 0, 3, 1, 9] } });
    m.addLayer({ id: 'censo-hit', type: 'line', source: 'censo', paint: { 'line-opacity': 0, 'line-width': 18 } });
    m.on('click', 'censo-hit', (e) => e.features?.[0] && elegir.current(String(e.features[0].properties.calleId)));
    setListo(true);
  }, []);
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo) return;
    const feats = calles.flatMap((c) => c.segmentos.map((coords) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: coords }, properties: { calleId: c.calleId, peso: c.registros / max } })));
    (m.getSource('censo') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats });
    const pts = feats.flatMap((x) => x.geometry.coordinates) as [number, number][];
    if (pts.length) m.fitBounds(pts.reduce((b, p) => b.extend(p), new LngLatBounds(pts[0], pts[0])), { padding: 30, duration: 0, maxZoom: 17 });
  }, [calles, listo, max]);

  const mun = db.municipios[preparado.plan.municipio.id];
  const centro: LngLat = mun?.centro ?? Object.values(db.calles).find((c) => c.segmentos.length)?.segmentos[0].coords[0] ?? [-4.91, 41.31];
  const porTipo = Object.entries(preparado.plan.incidencias.porTipo).sort((a, b) => b[1] - a[1]);

  return (
    <section className="tarjeta inc-bloque" aria-label="Censo en mapa">
      <div className="fila" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn s" onClick={onVolver}><ArrowLeft size={14} /> Volver al diagnóstico</button>
        <h2 style={{ margin: 0 }}>Censo en mapa · {preparado.plan.destino.nombre}</h2>
      </div>
      <div className="t-info" role="note"><Info size={15} /> <span>Solo en la memoria de esta pestaña: no se guarda nada. El archivo no indica dónde está cada portal, así que los registros se muestran <b>agrupados por calle</b>; nunca en un punto concreto. Los textos se muestran tal como están en el archivo.</span></div>

      <div className="ux-cifras" aria-label="Resumen del censo analizado">
        <div><b>{fmt(r.registros)}</b><span>registros</span></div>
        <div><b>{fmt(r.ocupados)}</b><span>ocupados</span></div>
        <div><b>{fmt(r.vacios)}</b><span>vacíos</span></div>
        <div><b>{fmt(r.actividades)}</b><span>actividades distintas</span></div>
        <div><b>{fmt(r.sinLocalizacion)}</b><span>sin localización fiable</span></div>
        <div><b>{fmt(r.incidencias)}</b><span>incidencias del archivo</span></div>
      </div>
      {r.desconocidos > 0 && <p className="muted" style={{ margin: 0 }}>{fmt(r.desconocidos)} registro(s) sin dato de ocupación. {fmt(r.soloCalle)} con calle pero sin número de portal.</p>}

      <div className="col-ctrl" aria-label="Filtros">
        <label className="campo"><span>Calle</span>
          <select className="input" aria-label="Filtrar por calle" value={f.calleId ?? ''} onChange={(e) => { setF({ ...f, calleId: e.target.value || undefined }); setN(POR_PAGINA); }}>
            <option value="">Todas</option>{opcionesCalle.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
          </select></label>
        <label className="campo"><span>Estado</span>
          <select className="input" aria-label="Filtrar por estado" value={f.estado ?? ''} onChange={(e) => { setF({ ...f, estado: (e.target.value || undefined) as FiltrosCenso['estado'] }); setN(POR_PAGINA); }}>
            <option value="">Todos</option><option value="ocupado">Ocupado</option><option value="vacio">Vacío</option><option value="desconocido">Sin dato</option>
          </select></label>
        <label className="campo"><span>Actividad (texto del archivo)</span>
          <select className="input" aria-label="Filtrar por actividad" value={f.actividad === undefined ? '__todas' : f.actividad} onChange={(e) => { setF({ ...f, actividad: e.target.value === '__todas' ? undefined : e.target.value }); setN(POR_PAGINA); }}>
            <option value="__todas">Todas</option>{actividades.map((a) => <option key={a || '__vacia'} value={a}>{a || '(sin actividad)'}</option>)}
          </select></label>
        <label className="campo"><span>Localización</span>
          <select className="input" aria-label="Filtrar por localización" value={f.localizacion ?? ''} onChange={(e) => { setF({ ...f, localizacion: (e.target.value || undefined) as FiltrosCenso['localizacion'] }); setN(POR_PAGINA); }}>
            <option value="">Todas</option>{(Object.keys(LOCALIZACION_TXT) as (keyof typeof LOCALIZACION_TXT)[]).map((k) => <option key={k} value={k}>{LOCALIZACION_TXT[k]}</option>)}
          </select></label>
      </div>

      <div className="mapa-censo" aria-label="Mapa de calles con registros">
        <MapaBase centro={centro} zoom={15} onListo={alListo} />
      </div>
      <p className="muted" style={{ margin: 0 }}>{fmt(lista.length)} registro(s) con los filtros · {fmt(calles.length)} calle(s) en el mapa · {fmt(sinLoc)} sin localización fiable (no aparecen en el mapa). Pulse una calle para filtrarla.</p>

      <div className="tabla-scroll">
        <table className="tabla ap-tabla" aria-label="Registros del censo analizado">
          <thead><tr><th className="num">Fila</th><th>Calle (archivo)</th><th>Nº</th><th>Nombre</th><th>Estado</th><th>Actividad</th><th>Localización</th></tr></thead>
          <tbody>{lista.slice(0, n).map((x) => (
            <tr key={x.fila} className={x.localizacion === 'sin-localizacion' ? 'aviso' : ''}>
              <td className="num">{x.fila}</td><td>{x.calleTexto || '—'}</td><td>{x.numero || '—'}</td><td>{x.nombre || '—'}</td><td>{ESTADO_TXT[x.estado]}</td><td>{x.actividad || '—'}</td>
              <td>{x.localizacion === 'sin-localizacion' ? <span className="chip aviso" title={LOCALIZACION_TXT[x.localizacion]}><AlertTriangle size={12} /> Sin localización</span> : <span className="chip" title={LOCALIZACION_TXT[x.localizacion]}>{x.localizacion === 'solo-calle' ? 'Solo calle' : 'Calle (portal sin posición)'}</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {lista.length > n && <button className="btn s" style={{ alignSelf: 'flex-start' }} onClick={() => setN(n + POR_PAGINA)}>Mostrar más ({fmt(lista.length - n)})</button>}

      <details className="ux-plegable">
        <summary>Incidencias del archivo ({fmt(r.incidencias)})</summary>
        <ul className="inc-lista" aria-label="Incidencias por tipo">{porTipo.map(([t, k]) => <li key={t}>{t}: {fmt(k)}</li>)}</ul>
        <button className="btn s" onClick={onVolver}>Ver el detalle en el diagnóstico</button>
      </details>
    </section>
  );
}
