import { useState } from 'react';
import { AlertTriangle, FileUp, Plus } from 'lucide-react';
import { fmt } from '../../components/ui';
import { useEspacios } from '../../store/espacios';
import { callesConObservaciones, censoConsolidado, crearItinerario, tramosDeducidosSinConfirmar, validarItinerario } from '../../domain/campanaOperativa';
import { ConciliacionPosterior } from './ConciliacionPosterior';
import type { Id } from '../../domain/types';
import { useAsistenteEspacio, useSeleccionEspacio } from './estadoAsistenteEspacio';

/**
 * G4 · Campaña OPERATIVA: sus itinerarios (IT1, IT2…), la incorporación del Excel de cada uno y el censo
 * consolidado con su desglose. Los cruces entre itinerarios se señalan; nada se fusiona solo.
 */
export function CampanaOperativa({ campanaId }: { campanaId: Id }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const sel = useSeleccionEspacio();
  const c = db.campanas[campanaId];
  const censo = censoConsolidado(db, campanaId);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const problemas = codigo.trim() ? validarItinerario(db, campanaId, codigo) : [];
  const incorporar = (itinerarioId: Id) => {
    sel.elegir({ modo: 'operativo', municipioId: c.municipioId, campanaId, itinerarioId });
    useAsistenteEspacio.getState().reiniciar();
    document.querySelector('[aria-label="Incorporar un censo"]')?.scrollIntoView?.({ behavior: 'smooth' });
  };
  const t = censo.total;
  return (
    <div className="mun-form" role="group" aria-label={`Campaña operativa ${c.nombre}`}>
      <b>{c.nombre} ({c.anio}) · itinerarios y censo consolidado</b>
      <p className="muted" style={{ margin: 0 }}>Cada itinerario aporta su Excel, que se incorpora en esta misma campaña (no se crea una campaña por itinerario). El censo de la campaña es la suma consolidada de todos ellos.</p>

      <div className="ap-resumen" aria-label="Censo consolidado">
        <div><span className="muted">Itinerarios</span><b>{censo.itinerarios.length}</b><span className="muted">{fmt(t.archivos)} archivo(s)</span></div>
        <div><span className="muted">Registros</span><b>{fmt(t.registros)}</b><span className="muted">filas de los Excel · {fmt(t.observaciones)} observaciones</span></div>
        <div><span className="muted">Locales únicos</span><b>{fmt(t.locales)}</b><span className="muted">{fmt(t.ocupados)} ocupados · {fmt(t.vacios)} vacíos (confirmados)</span></div>
        <div><span className="muted">Por decidir</span><b>{fmt(t.dudosos + t.sinFecha)}</b><span className="muted">{fmt(t.dudosos)} dudosos · {fmt(t.sinFecha)} sin fecha suficiente</span></div>
        <div><span className="muted">Pendientes</span><b>{fmt(t.pendientes)}</b><span className="muted">filas sin local</span></div>
        <div><span className="muted">Calles</span><b>{fmt(t.calles)}</b><span className="muted">con observaciones (recorrido no confirmado)</span></div>
      </div>

      <div className="tabla-scroll">
        <table className="tabla ap-tabla" aria-label="Desglose por itinerario">
          <thead><tr><th>Itinerario</th><th>Archivo</th><th className="num">Registros</th><th className="num">Con local</th><th className="num">Pendientes</th><th>Fechas</th><th /></tr></thead>
          <tbody>{censo.itinerarios.map((d) => (
            <tr key={d.itinerario.id}>
              <td><span className="it-color" style={{ background: d.itinerario.color }} /> <b>{d.itinerario.codigo}</b><div className="muted">{d.itinerario.nombre}</div></td>
              <td>{d.archivos.length ? d.archivos.map((a) => <div key={a.importacionId}>{a.archivo}<div className="muted mono cj-archivo">{a.sha256.slice(0, 12)}… · {a.fecha.slice(0, 10)}</div></div>) : <span className="muted">Sin incorporar</span>}</td>
              <td className="num">{fmt(d.registros)}</td>
              <td className="num">{fmt(d.vinculados)}</td>
              <td className="num">{fmt(d.pendientes)}</td>
              <td>{d.fechas ? `${d.fechas.desde} – ${d.fechas.hasta}` : '—'}{d.sinFecha ? <div className="muted">{d.sinFecha} sin fecha</div> : null}</td>
              <td>
                <div className="fila cj-fila-acc">
                  {!d.archivos.length && <button className="btn s" onClick={() => incorporar(d.itinerario.id)}><FileUp size={13} /> Incorporar su Excel</button>}
                  {d.calles.length > 0 && <span className="muted" title={callesConObservaciones(db, d.itinerario.id).map((x) => `${x.nombre}: portales ${x.numeros.join(', ') || '—'}${x.sinNumero ? ` y ${x.sinNumero} sin número` : ''}`).join(' · ')}>{d.calles.length} calle(s) con observaciones · recorrido no confirmado</span>}
                  {tramosDeducidosSinConfirmar(db, d.itinerario.id).length > 0
                    ? <span className="muted">{d.itinerario.tramos.length} tramo(s) deducidos de lo observado (G4): no confirmados, no indican calle completa ni cobertura</span>
                    : d.itinerario.tramos.length > 0 && <span className="muted">{d.itinerario.tramos.length} tramo(s)</span>}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div className="col-ctrl">
        <label className="campo"><span>Nuevo itinerario: código</span><input className="input" aria-label="Código del itinerario" placeholder="p. ej. IT4" value={codigo} onChange={(e) => setCodigo(e.target.value)} /></label>
        <label className="campo"><span>Nombre (opcional)</span><input className="input" aria-label="Nombre del itinerario" value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
      </div>
      {(error || problemas[0]) && <div className="t-info error" role="alert">{error ?? problemas[0]}</div>}
      <div><button className="btn s" disabled={!codigo.trim() || problemas.length > 0 || !!ocupado} onClick={async () => {
        const r = await modificar('Creando el itinerario…', (x, ctx) => crearItinerario(x, campanaId, { codigo, nombre }, ctx).db);
        if (!r.ok) return setError(r.error ?? null);
        setError(null);
        setCodigo('');
        setNombre('');
      }}><Plus size={13} /> Añadir itinerario</button></div>

      {(censo.posiblesDuplicados.length > 0 || censo.contradicciones.length > 0 || censo.solapamientos.length > 0 || censo.mismoPortal.length > 0) && (
        <div className="col" style={{ gap: 6 }} aria-label="Cruces entre itinerarios">
          <b><AlertTriangle size={14} /> Cruces entre itinerarios (nada se fusiona solo)</b>
          <ul className="inc-lista">
            {censo.posiblesDuplicados.map((d) => <li key={`d-${d.portal}-${d.nombre}`} className={d.conciliado ? '' : 'aviso'}>Posible duplicado: «{d.nombre}», {d.portal} · {d.observaciones.map((o) => `${o.itinerario}${o.fila ? ` (fila ${o.fila})` : ''}`).join(' y ')} · {d.conciliado ? 'conciliado: es el mismo local' : 'pendiente de conciliar'}</li>)}
            {censo.contradicciones.map((x) => <li key={`c-${x.portal}`} className={x.resuelta ? '' : 'aviso'}>Contradicción: {x.portal} · vacío según {x.vacio.join(', ')} y ocupado según {x.ocupado.join(', ')} · {x.resuelta ? 'resuelta por decisión' : 'sin resolver'}</li>)}
            {censo.mismoPortal.map((m) => <li key={`p-${m.portal}`}>{m.portal}: {m.locales} locales distintos en el mismo portal (no se fusionan)</li>)}
            {censo.solapamientos.map((s) => <li key={`s-${s.calleId}`}>Calle compartida: {s.calle} · {s.itinerarios.join(', ')}</li>)}
          </ul>
        </div>
      )}

      {censo.total.archivos > 0 && <ConciliacionPosterior campanaId={campanaId} />}
    </div>
  );
}
