import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LngLatBounds, Marker, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import { ArrowLeft, FileSpreadsheet, Printer } from 'lucide-react';
import { useStore } from '../../store/store';
import { MapaBase } from '../../components/mapa/MapaBase';
import { direccionVigente, indiceObservaciones, indiceOcupaciones, localesPrevios, ocupacionEn, situacionPrevia } from '../../domain/consultas';
import { estimarCarga, longitudTramo } from '../../domain/planificacion';
import { rutaActividad } from '../../domain/taxonomy';
import { formatoDistancia } from '../../domain/geo';
import { aCSV, descargar, filasExport } from '../../domain/exportacion';
import type { LocalFisico } from '../../domain/types';
import '../../styles/imprimir.css';

interface Opciones {
  mapa: boolean;
  listado: boolean;
  anteriores: boolean;
  hojaNuevos: boolean;
  blancosPorCalle: number;
  porAcera: boolean;
  actividad: boolean;
  grande: boolean;
}

export default function HojaCampo() {
  const { itId } = useParams();
  const db = useStore((s) => s.db!);
  const it = itId ? db.itinerarios[itId] : undefined;
  const [o, setO] = useState<Opciones>({ mapa: true, listado: true, anteriores: true, hojaNuevos: true, blancosPorCalle: 4, porAcera: true, actividad: true, grande: false });
  const ix = useMemo(() => ({ obs: indiceObservaciones(db), ocu: indiceOcupaciones(db) }), [db]);
  const mapa = useRef<MLMap | null>(null);
  const [listo, setListo] = useState(false);

  const camp = it ? db.campanas[it.campanaId] : undefined;
  const ref = camp?.campanaReferenciaId;
  const carga = useMemo(() => (it && camp ? estimarCarga(db, camp, it.tramos, ix.obs) : null), [db, camp, it, ix.obs]);

  const alListo = useCallback((m: MLMap) => {
    mapa.current = m;
    m.addSource('it', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'it-casing', type: 'line', source: 'it', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
    m.addLayer({ id: 'it-l', type: 'line', source: 'it', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5 } });
    setListo(true);
  }, []);

  // Al imprimir cambia el ancho útil: reencuadrar el mapa
  useEffect(() => {
    const ajustar = () => {
      const m = mapa.current;
      if (!m || !it) return;
      m.resize();
      const pts = it.tramos.flatMap((t) => db.calles[t.calleId]?.segmentos.flatMap((s) => s.coords) ?? []) as [number, number][];
      if (pts.length) m.fitBounds(pts.reduce((b, p) => b.extend(p), new LngLatBounds(pts[0], pts[0])), { padding: 40, duration: 0 });
    };
    window.addEventListener('beforeprint', ajustar);
    window.addEventListener('afterprint', ajustar);
    return () => {
      window.removeEventListener('beforeprint', ajustar);
      window.removeEventListener('afterprint', ajustar);
    };
  }, [db.calles, it]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo || !it) return;
    const feats = it.tramos.flatMap((t) => {
      const c = db.calles[t.calleId];
      const segs = t.segmentoIds?.length ? c?.segmentos.filter((s) => t.segmentoIds!.includes(s.id)) : c?.segmentos;
      return (segs ?? []).map((s) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: s.coords }, properties: { color: it.color } }));
    });
    (m.getSource('it') as GeoJSONSource).setData({ type: 'FeatureCollection', features: feats });
    const pts = feats.flatMap((f) => f.geometry.coordinates) as [number, number][];
    if (pts.length) m.fitBounds(pts.reduce((b, p) => b.extend(p), new LngLatBounds(pts[0], pts[0])), { padding: 40, duration: 0 });
    const marcas = it.tramos.map((t) => {
      const c = db.calles[t.calleId];
      const segs = t.segmentoIds?.length ? c?.segmentos.filter((s) => t.segmentoIds!.includes(s.id)) : c?.segmentos;
      const largo = [...(segs ?? [])].sort((a, b) => b.longitudM - a.longitudM)[0];
      if (!largo) return null;
      const el = document.createElement('div');
      el.className = 'num-tramo imp';
      el.style.setProperty('--c', it.color);
      el.textContent = String(t.orden);
      return new Marker({ element: el }).setLngLat(largo.coords[Math.floor(largo.coords.length / 2)]).addTo(m);
    });
    return () => marcas.forEach((mk) => mk?.remove());
  }, [db, it, listo]);

  if (!it || !camp) return <div className="pagina">Itinerario no encontrado. <Link to="/territorio">Volver</Link></div>;
  const municipio = db.municipios[camp.municipioId];
  const personas = it.asignadosIds.map((id) => db.personas[id]?.nombre).filter(Boolean).join(', ');
  const hoy = new Date().toLocaleDateString('es-ES');
  const set = (p: Partial<Opciones>) => setO((x) => ({ ...x, ...p }));

  const exportar = () => {
    const filas = filasExport(db, ref ?? camp.id, { itinerarioId: it.id });
    descargar(`${it.codigo}_${municipio.nombre.replace(/\s+/g, '_')}_locales_${db.campanas[ref ?? camp.id]?.anio}.csv`, aCSV(filas));
  };

  return (
    <div className={`imprimir ${o.grande ? 'grande' : ''}`}>
      <aside className="imp-panel no-imprimir">
        <Link to={`/territorio?it=${it.id}`} className="btn s fantasma"><ArrowLeft size={14} /> Volver al planificador</Link>
        <h2>Hoja de campo</h2>
        <p className="muted" style={{ fontSize: 12.5 }}>{it.codigo} · {it.nombre}<br />{municipio.nombre} · {camp.nombre}</p>
        <div className="rotulo">Contenido</div>
        <label><input type="checkbox" checked={o.mapa} onChange={(e) => set({ mapa: e.target.checked })} /> Mapa del itinerario</label>
        <label><input type="checkbox" checked={o.listado} onChange={(e) => set({ listado: e.target.checked })} /> Listado numerado de calles</label>
        <label><input type="checkbox" checked={o.anteriores} onChange={(e) => set({ anteriores: e.target.checked })} /> Locales anteriores por calle</label>
        <label><input type="checkbox" checked={o.hojaNuevos} onChange={(e) => set({ hojaNuevos: e.target.checked })} /> Hoja de locales nuevos</label>
        <div className="rotulo">Formato</div>
        <label><input type="checkbox" checked={o.porAcera} onChange={(e) => set({ porAcera: e.target.checked })} /> Separar acera par / impar</label>
        <label><input type="checkbox" checked={o.actividad} onChange={(e) => set({ actividad: e.target.checked })} /> Mostrar actividad anterior</label>
        <label><input type="checkbox" checked={o.grande} onChange={(e) => set({ grande: e.target.checked })} /> Letra grande</label>
        <label className="imp-num">Filas en blanco por calle
          <input type="number" min={0} max={12} value={o.blancosPorCalle} onChange={(e) => set({ blancosPorCalle: Math.max(0, Math.min(12, +e.target.value)) })} className="input" />
        </label>
        <div className="col" style={{ marginTop: 10 }}>
          <button className="btn primario" onClick={() => window.print()}><Printer size={15} /> Imprimir o guardar PDF</button>
          <button className="btn" onClick={exportar}><FileSpreadsheet size={15} /> Excel (CSV) de locales anteriores</button>
        </div>
        <p className="muted" style={{ fontSize: 11.5 }}>Formato A4 vertical. Los datos de locales son ficticios en este prototipo.</p>
      </aside>

      <main className="imp-hojas">
        <section className="hoja">
          <header className="hoja-cab">
            <div>
              <div className="hoja-marca"><b>ULIT</b> Censo · Cátedra de Innovación para el Comercio</div>
              <h1><span style={{ color: it.color }}>{it.codigo}</span> {it.nombre}</h1>
              <div className="hoja-meta">{municipio.nombre} · {camp.nombre} · {it.tramos.length} calles · {carga ? formatoDistancia(carga.longitudM) : ''} · {carga?.localesPrevios ?? 0} locales anteriores</div>
            </div>
            <div className="hoja-campos">
              <div>Investigador/a: <span className="linea-escribir">{personas}</span></div>
              <div>Fecha: <span className="linea-escribir" /></div>
              <div className="hoja-sim">Datos de demostración · impreso {hoy}</div>
            </div>
          </header>

          {o.mapa && (
            <div className="hoja-mapa">
              <MapaBase centro={municipio.centro} zoom={15} onListo={alListo} interactivo={false} preservarDibujo />
            </div>
          )}

          {o.listado && (
            <table className="hoja-tabla calles">
              <thead>
                <tr><th>Nº</th><th>Calle</th><th>Long.</th><th>Loc. ant.</th><th>Indicaciones</th><th>Par</th><th>Impar</th><th>Sin loc.</th></tr>
              </thead>
              <tbody>
                {it.tramos.map((t) => {
                  const c = db.calles[t.calleId];
                  const n = localesPrevios(db, ref, t.calleId, ix.obs).length;
                  const sit = situacionPrevia(db, camp, t.calleId, ix.obs);
                  return (
                    <tr key={t.calleId}>
                      <td className="n" style={{ color: it.color }}>{t.orden}</td>
                      <td><b>{c?.nombre}</b></td>
                      <td>{formatoDistancia(longitudTramo(t, c))}</td>
                      <td>{n || '—'}</td>
                      <td className="ind">
                        {[t.etiqueta ?? (sit !== 'con-registros' ? 'Censar desde cero' : ''), t.acera !== 'ambas' ? `solo ${t.acera === 'par' ? 'pares' : 'impares'}` : '', t.segmentoIds?.length ? 'tramo parcial (ver mapa)' : ''].filter(Boolean).join(' · ')}
                      </td>
                      <td className="caja">{t.acera !== 'impar' ? '☐' : '—'}</td>
                      <td className="caja">{t.acera !== 'par' ? '☐' : '—'}</td>
                      <td className="caja">☐</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {o.anteriores &&
          it.tramos.map((t) => {
            const c = db.calles[t.calleId];
            const previos = localesPrevios(db, ref, t.calleId, ix.obs);
            const grupos: [string, LocalFisico[]][] = o.porAcera
              ? [['Acera impar', previos.filter((l) => (direccionVigente(l).numero ?? 1) % 2 === 1)], ['Acera par', previos.filter((l) => (direccionVigente(l).numero ?? 1) % 2 === 0)]]
              : [['', previos]];
            return (
              <section key={t.calleId} className={`hoja-calle ${previos.length < 8 ? 'corta' : ''}`}>
                <h2>
                  <span className="n" style={{ background: it.color }}>{t.orden}</span>
                  {c?.nombre}
                  <span className="hoja-calle-meta">{previos.length ? `${previos.length} locales en ${db.campanas[ref ?? '']?.anio ?? 'el censo anterior'}` : 'Sin locales anteriores · censar desde cero'}</span>
                  <span className="hoja-calle-checks">☐ par recorrida ☐ impar recorrida ☐ sin locales</span>
                </h2>
                {previos.length > 0 &&
                  grupos.filter(([, ls]) => ls.length).map(([etq, ls]) => (
                    <table key={etq} className="hoja-tabla previos">
                      <thead>
                        <tr>
                          <th className="nn">Nº</th>
                          <th>{etq ? `${etq} · ` : ''}Establecimiento anterior</th>
                          {o.actividad && <th>Actividad</th>}
                          <th className="caja">Igual</th>
                          <th className="caja">Vacío</th>
                          <th className="caja">No está</th>
                          <th className="anota">Cambios: nuevo nombre / metros / observaciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ls.map((l) => {
                          const d = direccionVigente(l);
                          const oc = ocupacionEn(db, l.id, ref!, ix.ocu);
                          const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
                          return (
                            <tr key={l.id}>
                              <td className="nn">{d.numero ?? 's/n'}{d.sufijo ? ` ${d.sufijo}` : ''}</td>
                              <td>{neg?.nombre ?? <i>Vacío{oc?.metrosFachada ? ` (${oc.metrosFachada} m)` : ''}</i>}</td>
                              {o.actividad && <td className="act">{rutaActividad(neg?.actividadId)[3]?.nombre ?? ''}</td>}
                              <td className="caja">☐</td>
                              <td className="caja">☐</td>
                              <td className="caja">☐</td>
                              <td className="anota" />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ))}
                {o.blancosPorCalle > 0 && (
                  <table className="hoja-tabla nuevos">
                    <thead>
                      <tr><th className="nn">Nº</th><th className="caja">Ocup.</th><th className="caja">Vacío</th><th>Locales nuevos: nombre del establecimiento o metros de fachada</th><th className="anota">Observaciones</th></tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: o.blancosPorCalle }).map((_, i) => (
                        <tr key={i}><td className="nn" /><td className="caja">☐</td><td className="caja">☐</td><td /><td className="anota" /></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}

        {o.hojaNuevos && (
          <section className="hoja hoja-salto">
            <h2 className="hoja-tit">Hoja de locales nuevos · {it.codigo}</h2>
            <p className="hoja-meta">Para locales que no figuran en el listado anterior. La calle se escribe una vez por bloque; no hace falta repetirla.</p>
            <table className="hoja-tabla nuevos grande">
              <thead>
                <tr><th style={{ width: '24%' }}>Calle</th><th className="nn">Nº</th><th className="caja">Ocup.</th><th className="caja">Vacío</th><th>Nombre o metros de fachada</th><th className="anota">Observaciones / incidencias</th></tr>
              </thead>
              <tbody>
                {Array.from({ length: 24 }).map((_, i) => (
                  <tr key={i}><td /><td className="nn" /><td className="caja">☐</td><td className="caja">☐</td><td /><td className="anota" /></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
