import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Clock, Globe, Lock, Map, Store, Tags } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { ESTADO_OFICINA_TXT } from '../../domain/bloqueo';
import type { Contador, ResumenItinerario } from '../../domain/oficina';
import { Sim, fmt, fmtFecha } from '../../components/ui';
import { useResumenes } from './contextoOficina';
import '../../styles/oficina-b2.css';

/** Entrada de Oficina: los itinerarios de la campaña con su progreso independiente. */
export default function PanelItinerarios() {
  const { db, campana, municipio } = useContexto();
  const resumenes = useResumenes();
  const nav = useNavigate();
  if (!campana) return null;
  const its = resumenes.filter((r) => r.itinerarioId);
  const fuera = resumenes.find((r) => !r.itinerarioId);
  return (
    <div className="ofi-inicio scroll-fino">
      <header className="ofi-inicio-cab">
        <div>
          <div className="rotulo">04 · Oficina · {campana.nombre}</div>
          <h1>Itinerarios</h1>
          <p className="muted">Cada itinerario tiene su propio progreso. Entra en uno para trabajar sus registros por tareas o por establecimientos.</p>
        </div>
        <span className="esp" />
        {campana.procedencia === 'simulado' && <Sim texto={`${municipio.nombre}: datos ficticios`} />}
        <button className="btn" onClick={() => nav('/oficina/municipal')} title="Todos los registros de la campaña, sin separar por itinerario">
          <Map size={15} /> Vista general municipal
        </button>
      </header>

      {its.length === 0 && <div className="t-info">Esta campaña no tiene itinerarios. Puedes trabajar en la vista general municipal.</div>}

      <div className="ofi-tarjetas">
        {its.map((r) => (
          <TarjetaItinerario key={r.itinerarioId} r={r} quien={r.cierre ? db.personas[r.cierre.porId]?.nombre ?? r.cierre.porId : undefined} onAbrir={(q) => nav(`/oficina/it/${r.itinerarioId}${q}`)} />
        ))}
      </div>

      {fuera && (
        <div className="t-info aviso" style={{ marginTop: 16 }}>
          <AlertTriangle size={15} /> {fmt(fuera.total)} registro(s) no pertenecen a ningún itinerario de la campaña.
          <button className="btn s" style={{ marginLeft: 'auto' }} onClick={() => nav('/oficina/municipal?tarea=todos&filtro=todos&sinIt=1')}>Ver en la vista municipal</button>
        </div>
      )}
    </div>
  );
}

function Progreso({ titulo, c, icono, onClick, etiquetaHechos = 'revisados' }: { titulo: string; c: Contador; icono: React.ReactNode; onClick?: () => void; etiquetaHechos?: string }) {
  const total = c.hechos + c.pendientes;
  const pct = total ? c.hechos / total : 0;
  return (
    <button className="ofi-prog" onClick={onClick} disabled={!onClick} aria-label={`${titulo}: ${c.hechos} ${etiquetaHechos}, ${c.pendientes} pendientes`}>
      <span className="ofi-prog-t">{icono}{titulo}</span>
      <span className="ofi-prog-barra"><i style={{ width: `${pct * 100}%` }} /></span>
      <span className="ofi-prog-n">
        <b>{fmt(c.hechos)}</b> {etiquetaHechos} · <span className={c.pendientes ? 'ofi-pend' : 'muted'}>{fmt(c.pendientes)} pendientes</span>
      </span>
    </button>
  );
}

function TarjetaItinerario({ r, quien, onAbrir }: { r: ResumenItinerario; quien?: string; onAbrir: (query: string) => void }) {
  const cerrada = r.estado === 'revision-cerrada';
  return (
    <article className={`ofi-tarjeta ${cerrada ? 'cerrada' : ''} ${r.estado === 'validado' ? 'validada' : ''}`} aria-label={`Itinerario ${r.codigo}`}>
      <header>
        <b className="mono">{r.codigo}</b>
        <span className="ofi-tarjeta-nombre">{r.nombre}</span>
        <span className="esp" />
        <EstadoRevision estado={r.estado} />
      </header>
      <div className="ofi-calles muted">
        {fmt(r.calles.total)} calles · {fmt(r.calles.completadas)} completadas{r.calles.sinLocales ? ` (${r.calles.sinLocales} sin locales)` : ''}
        {r.calles.enCurso ? ` · ${r.calles.enCurso} en curso` : ''}{r.calles.parciales ? ` · ${r.calles.parciales} parciales` : ''}
      </div>
      <Progreso titulo="Trabajo de campo" c={r.campo} etiquetaHechos="registrados" icono={<Store size={13} />} onClick={r.campo.pendientes ? () => onAbrir('?tarea=todos&filtro=sin-visitar') : undefined} />
      <Progreso titulo="Categorización" c={r.categorizacion} icono={<Tags size={13} />} onClick={() => onAbrir('?tarea=categorizacion&filtro=pendientes')} />
      <Progreso titulo="Presencia digital" c={r.digital} icono={<Globe size={13} />} onClick={() => onAbrir('?tarea=digital&filtro=pendientes')} />
      <div className="ofi-fila-dato">
        <span className="muted">Franquicias</span>
        <span className="chip" title="El estado independiente de franquicias se incorporará en B5">pendiente de B5 · sin progreso</span>
      </div>
      <button className="ofi-fila-dato ofi-incid" onClick={() => onAbrir('?tarea=incidencias&filtro=pendientes')} disabled={!r.incidencias && !r.errores}>
        <span><AlertTriangle size={13} /> Incidencias y contradicciones</span>
        <span>
          <b className={r.incidencias ? 'ofi-pend' : 'muted'}>{fmt(r.incidencias)}</b>
          {r.errores > 0 && <span className="muted"> · {fmt(r.errores)} con errores</span>}
          {r.cronologiaIncierta > 0 && <span className="chip dudoso" style={{ marginLeft: 6 }}><Clock size={11} /> {r.cronologiaIncierta} cronología</span>}
        </span>
      </button>
      <div className="ofi-fila-dato">
        <span className="muted">Revisión final</span>
        <span style={{ fontSize: 12 }}>
          {r.cierre ? `${r.cierre.accion === 'reabrir' ? 'Reabierto' : r.cierre.accion === 'validar' ? 'Validado' : 'Cerrado'} por ${quien} · ${fmtFecha(r.cierre.fecha)}` : 'Sin cerrar'}
        </span>
      </div>
      <footer>
        <button className="btn s primario" onClick={() => onAbrir('?tarea=todos&filtro=pendientes')}>Abrir pendientes <ArrowRight size={13} /></button>
        <button className="btn s fantasma" onClick={() => onAbrir('?tarea=todos&filtro=todos')}>Todos los registros ({fmt(r.total)})</button>
      </footer>
    </article>
  );
}

export function EstadoRevision({ estado }: { estado: ResumenItinerario['estado'] }) {
  if (estado === 'revision-cerrada') {
    return (
      <span className="chip aviso ofi-estado" title={ESTADO_OFICINA_TXT[estado]}>
        <Lock size={11} /> Revisión cerrada · provisional · no apta para exportación municipal
      </span>
    );
  }
  if (estado === 'validado') return <span className="chip ok ofi-estado"><Lock size={11} /> Validado (definitivo)</span>;
  if (estado === 'reabierto') return <span className="chip ofi-estado">Reabierto</span>;
  return <span className="chip ofi-estado">En revisión</span>;
}
