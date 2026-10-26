import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LngLatBounds, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { MapaBase } from '../../components/mapa/MapaBase';
import { estaBloqueado } from '../../domain/bloqueo';
import { alternarCalle } from '../../domain/itinerarios';
import { claseCampana } from '../../domain/municipios';
import { personaEspacio } from '../../domain/espacios';
import { geojsonCalles } from '../territory/capas';
import { useEspacios } from '../../store/espacios';
import type { Id, LngLat } from '../../domain/types';

/**
 * Piloto de integración: utiliza el MISMO mapa, GeoJSON y reglas de planificación
 * del prototipo, pero sobre la base verificada del espacio de ensayo.
 * No crea cobertura de campo ni modifica observaciones, locales o incorporaciones.
 */
export function PlanificadorEnsayo({ itinerarioId, onCerrar }: { itinerarioId: Id; onCerrar: () => void }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const tipo = useEspacios((s) => s.tipo);
  const [busqueda, setBusqueda] = useState('');
  const [calleId, setCalleId] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapaListo, setMapaListo] = useState(false);
  const mapa = useRef<MLMap | null>(null);
  const ajustado = useRef(false);
  const it = db.itinerarios[itinerarioId];
  const campana = it ? db.campanas[it.campanaId] : null;
  const municipio = campana ? db.municipios[campana.municipioId] : null;
  const calles = useMemo(() => Object.values(db.calles).filter((c) => c.municipioId === municipio?.id).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [db.calles, municipio?.id]);
  const conGeometria = useMemo(() => calles.filter((c) => c.segmentos.some((s) => s.coords.length >= 2)), [calles]);
  const centro = conGeometria[0]?.segmentos.find((s) => s.coords.length >= 2)?.coords[0] as LngLat | undefined;
  const itinerarios = useMemo(() => Object.values(db.itinerarios).filter((i) => i.campanaId === campana?.id), [db.itinerarios, campana?.id]);
  const persona = personaEspacio(db);
  const puede = tipo === 'ensayo' && !!persona?.roles.some((r) => r === 'coordinador' || r === 'administrador') && !!campana && claseCampana(campana) === 'operativa' && !!it && !estaBloqueado(db, it.id);
  const calle = calleId ? db.calles[calleId] : null;
  const yaAsignada = !!it?.tramos.some((t) => t.calleId === calleId);
  const otros = itinerarios.filter((i) => i.id !== itinerarioId && i.tramos.some((t) => t.calleId === calleId));
  const resultados = calles.filter((c) => c.nombre.toLocaleLowerCase('es').includes(busqueda.trim().toLocaleLowerCase('es'))).slice(0, 25);

  const alListo = useCallback((m: MLMap) => {
    mapa.current = m;
    m.addSource('ux-calles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'ux-calles-base', type: 'line', source: 'ux-calles', paint: { 'line-color': '#9ca9bb', 'line-width': 2 } });
    m.addLayer({ id: 'ux-calles-asig', type: 'line', source: 'ux-calles', filter: ['>', ['get', 'asignado'], 0], paint: { 'line-color': ['get', 'colorPlan'], 'line-width': 5 } });
    m.addLayer({ id: 'ux-calles-seleccion', type: 'line', source: 'ux-calles', filter: ['==', ['get', 'calleId'], ''], paint: { 'line-color': '#021E4A', 'line-width': 3, 'line-gap-width': 4 } });
    m.addLayer({ id: 'ux-calles-hit', type: 'line', source: 'ux-calles', paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 18 } });
    m.on('click', 'ux-calles-hit', (e) => {
      const id = e.features?.[0]?.properties?.calleId;
      if (typeof id === 'string') setCalleId(id);
    });
    m.on('mouseenter', 'ux-calles-hit', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'ux-calles-hit', () => { m.getCanvas().style.cursor = ''; });
    setMapaListo(true);
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!mapaListo || !m || !municipio || !campana) return;
    (m.getSource('ux-calles') as GeoJSONSource).setData(geojsonCalles(db, municipio.id, campana, itinerarios, itinerarioId, new Set()));
  }, [db, municipio, campana, itinerarios, itinerarioId, mapaListo]);

  useEffect(() => {
    if (!mapaListo || !mapa.current) return;
    mapa.current.setFilter('ux-calles-seleccion', ['==', ['get', 'calleId'], calleId ?? '']);
  }, [calleId, mapaListo]);

  useEffect(() => {
    const m = mapa.current;
    if (!mapaListo || !m || ajustado.current) return;
    const elegidas = it?.tramos.flatMap((t) => db.calles[t.calleId]?.segmentos.flatMap((s) => s.coords) ?? []) ?? [];
    const pts = elegidas.length ? elegidas : conGeometria.flatMap((c) => c.segmentos.flatMap((s) => s.coords));
    if (pts.length) {
      const b = pts.reduce((bb, p) => bb.extend(p), new LngLatBounds(pts[0], pts[0]));
      m.fitBounds(b, { padding: 35, maxZoom: 16, duration: 0 });
    }
    ajustado.current = true;
  }, [mapaListo, it, db.calles, conGeometria]);

  if (!it || !campana || !municipio) return <p role="alert">Itinerario no encontrado.</p>;

  const guardar = async () => {
    if (!calle || !puede || ocupado || (!yaAsignada && otros.length)) return;
    const resultado = await modificar('Guardando planificación…', (actual) => {
      const objetivo = actual.itinerarios[itinerarioId];
      const via = actual.calles[calle.id];
      if (!objetivo || !via || objetivo.campanaId !== campana.id || via.municipioId !== municipio.id) throw new Error('La calle y el itinerario deben pertenecer a la campaña seleccionada.');
      if (claseCampana(actual.campanas[campana.id]) !== 'operativa') throw new Error('Solo se planifican campañas operativas.');
      const responsables = personaEspacio(actual)?.roles ?? [];
      if (!responsables.includes('coordinador') && !responsables.includes('administrador')) throw new Error('No hay permiso para modificar la planificación.');
      if (!objetivo.tramos.some((t) => t.calleId === via.id) && Object.values(actual.itinerarios).some((i) => i.campanaId === campana.id && i.id !== itinerarioId && i.tramos.some((t) => t.calleId === via.id))) throw new Error('La calle ya está planificada en otro itinerario. Revise el solapamiento.');
      return alternarCalle(actual, itinerarioId, via.id).db;
    });
    setError(resultado.ok ? null : resultado.error ?? 'No se ha guardado el cambio.');
  };

  return (
    <section className="ux-planificador" aria-label={'Planificador de ' + it.codigo}>
      <div className="fila cj-fila-acc" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div><b>{'Planificar ' + it.codigo}</b><p className="muted" style={{ margin: 0 }}>{it.tramos.length} calle(s) planificadas · el Excel no demuestra cobertura de campo</p></div>
        <button className="btn s" onClick={onCerrar}>Cerrar mapa</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>Selecciona una calle en el mapa o en la lista. La planificación no modifica los locales ni los registros incorporados.</p>
      <div className="ux-plan-disposicion">
        <div className="ux-plan-lista">
          <label className="campo"><span>Buscar calle</span><input className="input" aria-label="Buscar calle en el planificador" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre de la calle" /></label>
          <div className="ux-plan-resultados" aria-label="Calles disponibles">
            {resultados.map((c) => <button key={c.id} className={'btn s ' + (calleId === c.id ? 'primario' : '')} onClick={() => setCalleId(c.id)}>{c.nombre}{it.tramos.some((t) => t.calleId === c.id) ? ' · planificada' : ''}{!c.segmentos.length ? ' · sin mapa' : ''}</button>)}
            {!resultados.length && <p className="muted">No se encontraron calles.</p>}
          </div>
        </div>
        <div className="ux-plan-mapa">
          {centro ? <MapaBase centro={centro} zoom={13} onListo={alListo} className="ux-plan-mapa-lienzo" /> : <div className="ux-plan-sin-geo">Este municipio no tiene calles dibujadas en el mapa. Puedes planificarlas por nombre, sin inventar geometría.</div>}
        </div>
      </div>
      {calle && <div className="fila cj-fila-acc" style={{ alignItems: 'center' }}>
        <b>{calle.nombre}</b>
        {otros.length > 0 && !yaAsignada && <span className="chip aviso">Asignada a {otros.map((i) => i.codigo).join(', ')}. Requiere revisar el solapamiento.</span>}
        <button className="btn s primario" disabled={!puede || !!ocupado || (!yaAsignada && otros.length > 0)} onClick={() => void guardar()}>{yaAsignada ? 'Quitar de la planificación' : 'Añadir calle al itinerario'}</button>
      </div>}
      {!puede && <p className="muted">La edición está limitada a coordinación en el espacio de ensayo y a itinerarios abiertos.</p>}
      {error && <p className="t-info error" role="alert">{error}</p>}
    </section>
  );
}
