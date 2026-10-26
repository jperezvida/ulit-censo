import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LngLatBounds, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { ArrowLeft, MapPinned } from 'lucide-react';
import { MapaBase } from '../../components/mapa/MapaBase';
import { geojsonCalles } from '../territory/capas';
import { alternarCalle } from '../../domain/itinerarios';
import { itinerariosDe } from '../../domain/campanaOperativa';
import { claseCampana } from '../../domain/municipios';
import { personaEspacio } from '../../domain/espacios';
import { useEspacios } from '../../store/espacios';
import type { BaseDatos } from '../../domain/db';
import type { Id } from '../../domain/types';
import '../../styles/territorio.css';

/** Ensayo acotado: reutiliza el mapa, sus capas y las reglas de planificación, sin acceder al store demo. */
export function PlanificadorEnsayo({ ruta }: { ruta: string }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const [seccion, campanaId, itinerarioId, extra] = ruta.split('/');
  const campana = db.campanas[campanaId];
  const it = db.itinerarios[itinerarioId];
  const municipio = campana && db.municipios[campana.municipioId];
  const persona = personaEspacio(db);
  const puedeEditar = !!persona?.roles.some((r) => r === 'coordinador' || r === 'administrador');
  const valido = seccion === 'planificar' && !extra && !!campana && !!it && !!municipio
    && it.campanaId === campana.id && claseCampana(campana) === 'operativa';
  const [calleId, setCalleId] = useState<Id | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mapa = useRef<MLMap | null>(null);
  const ajustado = useRef(false);
  const [mapaListo, setMapaListo] = useState(false);
  const itinerarios = useMemo(() => campana ? itinerariosDe(db, campana.id) : [], [db, campana]);
  const callesDelMunicipio = useMemo(() => municipio ? Object.values(db.calles).filter((c) => c.municipioId === municipio.id && c.segmentos.length) : [], [db.calles, municipio]);
  const centro = municipio?.centro ?? callesDelMunicipio[0]?.segmentos[0]?.coords[0];
  const capa = useMemo(() => valido ? geojsonCalles(db, municipio.id, campana, itinerarios, it.id, new Set()) : null,
    [db, valido, municipio, campana, itinerarios, it]);

  const alListo = useCallback((m: MLMap) => {
    mapa.current = m;
    m.addSource('calles-ensayo', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'calles-ensayo-fondo', type: 'line', source: 'calles-ensayo',
      paint: { 'line-color': '#8a97ab', 'line-width': 5, 'line-opacity': 0.8 } });
    m.addLayer({ id: 'calles-ensayo-plan', type: 'line', source: 'calles-ensayo', filter: ['>=', ['get', 'asignado'], 1],
      paint: { 'line-color': ['get', 'colorPlan'], 'line-width': 8, 'line-opacity': 0.9 } });
    m.addLayer({ id: 'calles-ensayo-hit', type: 'line', source: 'calles-ensayo',
      paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 22 } });
    m.on('click', 'calles-ensayo-hit', (e) => {
      const id = e.features?.[0]?.properties?.calleId;
      if (typeof id === 'string') { setCalleId(id); setError(null); setResultado(null); }
    });
    m.on('mouseenter', 'calles-ensayo-hit', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'calles-ensayo-hit', () => { m.getCanvas().style.cursor = ''; });
    setMapaListo(true);
  }, []);

  useEffect(() => {
    if (!mapaListo || !capa || !mapa.current) return;
    (mapa.current.getSource('calles-ensayo') as GeoJSONSource).setData(capa);
    const puntos = capa.features.flatMap((f) => f.geometry.coordinates);
    if (puntos.length && !ajustado.current) {
      const bounds = new LngLatBounds();
      puntos.forEach((p) => bounds.extend(p as [number, number]));
      mapa.current.fitBounds(bounds, { padding: 35, maxZoom: 16, duration: 0 });
      ajustado.current = true;
    }
  }, [mapaListo, capa]);

  if (!valido) return <div className="t-info error" role="alert">No se encuentra un itinerario operativo de este espacio. <Link to="/espacios/ensayo">Volver al ensayo</Link>.</div>;
  const calle = calleId && db.calles[calleId]?.municipioId === municipio.id ? db.calles[calleId] : null;
  const enItinerario = !!calle && it.tramos.some((t) => t.calleId === calle.id);
  const otros = calle ? itinerarios.filter((i) => i.id !== it.id && i.tramos.some((t) => t.calleId === calle.id)) : [];
  const conGeometria = !!centro;

  const guardar = async () => {
    if (!calle || !puedeEditar || ocupado) return;
    const id = calle.id;
    const quitar = enItinerario;
    const res = await modificar('Guardando planificación…', (actual: BaseDatos) => {
      if (actual.campanas[campanaId]?.municipioId !== municipio.id || actual.itinerarios[itinerarioId]?.campanaId !== campanaId
        || actual.calles[id]?.municipioId !== municipio.id || claseCampana(actual.campanas[campanaId]) !== 'operativa') {
        throw new Error('La campaña o la calle han cambiado. Vuelva a abrir el itinerario.');
      }
      return alternarCalle(actual, itinerarioId, id).db;
    });
    setError(res.ok ? null : res.error ?? 'No se ha guardado el cambio.');
    setResultado(res.ok ? `${calle.nombre}: ${quitar ? 'retirada' : 'añadida'} a ${it.codigo}. Guardado comprobado.` : null);
  };

  return (
    <section className="col" style={{ gap: 12 }} aria-label="Planificación en mapa del ensayo">
      <div className="fila"><Link to="/espacios/ensayo" className="btn s"><ArrowLeft size={14} /> Volver a itinerarios</Link></div>
      <div><h2 style={{ margin: 0 }}><MapPinned size={20} /> {it.codigo} · {it.nombre}</h2><p className="muted">{municipio.nombre} · {campana.nombre} · {it.tramos.length} calles planificadas</p></div>
      <p className="muted">Seleccione una calle en el mapa y confirme la asignación. Por ahora se asigna la calle completa, ambas aceras. Planificarla no significa que esté censada.</p>
      {!conGeometria ? <div className="t-info aviso">Este municipio no tiene calles dibujadas en su callejero. Puede seguir gestionando el itinerario desde la lista.</div> : (
        <div className="tarjeta" style={{ height: 'min(65vh, 620px)', minHeight: 380, position: 'relative', overflow: 'hidden' }}>
          <MapaBase centro={centro!} onListo={alListo} />
        </div>
      )}
      {calle && <div className="tarjeta fila" style={{ padding: 12, gap: 12, flexWrap: 'wrap' }}>
        <b>{calle.nombre}</b><span className="muted">{enItinerario ? `En ${it.codigo}` : `Aún no está en ${it.codigo}`}</span>
        {otros.length > 0 && <span className="chip aviso">También en {otros.map((i) => i.codigo).join(', ')}: posible solapamiento</span>}
        <span className="esp" />
        <button className="btn s primario" disabled={!puedeEditar || !!ocupado} onClick={() => void guardar()}>{ocupado ?? (enItinerario ? 'Quitar del itinerario' : 'Asignar calle completa')}</button>
      </div>}
      {!puedeEditar && <div className="t-info aviso">Solo la persona coordinadora puede cambiar la planificación.</div>}
      {error && <div className="t-info error" role="alert">{error} Los datos anteriores siguen visibles. Si otra pestaña cambió el espacio, vuelva al inicio y ábralo de nuevo.</div>}
      {resultado && <div className="t-info ok" role="status">{resultado}</div>}
    </section>
  );
}
