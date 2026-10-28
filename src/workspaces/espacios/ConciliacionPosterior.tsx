import { useState } from 'react';
import { Link2, PlusCircle, Clock, Undo2, CheckCircle2, HelpCircle } from 'lucide-react';
import { useEspacios } from '../../store/espacios';
import { itinerariosDe } from '../../domain/campanaOperativa';
import {
  CLARIDAD_TXT, CLASE_ESTADO_TXT, MOTIVO_PENDIENTE_TXT, ordenarPorClaridad, crearLocalDistinto, decisionesCampana, deshacerConciliacion, localesPorRevisar, mantenerPendiente,
  pendientesCampana, resolverEstado, retirarResolucion, vincularALocal, type FiltrosPendientes, type Pendiente,
} from '../../domain/conciliacionPosterior';
import type { BaseDatos } from '../../domain/db';
import type { Id } from '../../domain/types';

const ACCION_TXT = { vincular: 'Vinculada a un local existente', 'local-nuevo': 'Local distinto creado', 'mantener-pendiente': 'Mantenida pendiente' } as const;

/**
 * G5 · Conciliación POSTERIOR a la importación: las filas que quedaron sin local en cualquier itinerario de
 * la campaña, con filtros sencillos, y el estado de los locales con observaciones que no coinciden o no
 * tienen fecha. Cada decisión guarda quién y cuándo, y se puede deshacer.
 */
export function ConciliacionPosterior({ campanaId, simple = false, filtroInicial = {} }: { campanaId: Id; simple?: boolean; filtroInicial?: FiltrosPendientes }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const [f, setF] = useState<FiltrosPendientes>(filtroInicial);
  const [error, setError] = useState<string | null>(null);
  const todos = pendientesCampana(db, campanaId);
  // Primero las propuestas más claras; los casos ambiguos se revisan después, uno a uno.
  const lista = ordenarPorClaridad(pendientesCampana(db, campanaId, f));
  const todosRevisar = localesPorRevisar(db, campanaId);
  // UX1 · En la vista sencilla solo lo que necesita intervención: estados contradictorios sin decidir.
  const revisar = simple ? todosRevisar.filter((e) => e.contradictorio && !e.resolucion) : todosRevisar;
  const resueltos = simple ? todosRevisar.filter((e) => e.resolucion) : [];
  const decisiones = decisionesCampana(db, campanaId);
  const vigentes = decisiones.filter((d) => !d.decision.deshecha);
  const ultimaPorRegistro = new Map<Id, (typeof vigentes)[number]>();
  for (const d of vigentes) if (!ultimaPorRegistro.has(d.registroId)) ultimaPorRegistro.set(d.registroId, d);
  const calles = [...new Map(todos.filter((p) => p.calleId).map((p) => [p.calleId!, db.calles[p.calleId!]?.nombre ?? p.calleId!])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  const tipos = [...new Set(todos.flatMap((p) => [p.motivo, ...(p.decision ? ['mantener-pendiente'] : [])]))];
  const portalDe = (localId: Id) => {
    const d = db.locales[localId]?.direcciones.at(-1);
    return d ? `${db.calles[d.calleId]?.nombre ?? d.calleId}, ${d.numero ?? 's/n'}${d.sufijo ? ` ${d.sufijo}` : ''}` : localId;
  };
  const hacer = async (msg: string, fn: (x: BaseDatos, porId: Id) => BaseDatos) => {
    const r = await modificar(msg, (x, ctx) => fn(x, ctx.porId));
    setError(r.ok ? null : r.error ?? 'No se ha podido guardar.');
  };

  return (
    <div className="col" style={{ gap: 8 }} role="region" aria-label="Conciliación posterior">
      {simple ? <b>{todos.length ? `${todos.length} fila(s) sin local` : 'Todas las filas tienen local'}</b> : <>
        <b>Conciliación posterior · {todos.length} fila(s) sin local</b>
        <p className="muted" style={{ margin: 0 }}>Filas de cualquier itinerario que quedaron sin local al importar. Primero aparecen las propuestas más claras. Cada propuesta compara la fila con el censo de referencia, pero no se aplica sola: vincule la fila a un local existente, cree un local distinto si es otro establecimiento, o déjela pendiente. Nada se fusiona por compartir portal, y vincular el mismo local físico no confirma que sea el mismo negocio.</p>
      </>}
      {(!simple || todos.length > 3 || Object.values(f).some(Boolean)) && <div className="col-ctrl">
        <label className="campo"><span>Itinerario</span>
          <select className="input" aria-label="Filtrar por itinerario" value={f.itinerarioId ?? ''} onChange={(e) => setF({ ...f, itinerarioId: e.target.value || undefined })}>
            <option value="">Todos</option>{itinerariosDe(db, campanaId).map((i) => <option key={i.id} value={i.id}>{i.codigo}</option>)}
          </select></label>
        <label className="campo"><span>Calle</span>
          <select className="input" aria-label="Filtrar por calle" value={f.calleId ?? ''} onChange={(e) => setF({ ...f, calleId: e.target.value || undefined })}>
            <option value="">Todas</option>{calles.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select></label>
        <label className="campo"><span>Tipo</span>
          <select className="input" aria-label="Filtrar por tipo" value={f.tipo ?? ''} onChange={(e) => setF({ ...f, tipo: e.target.value || undefined })}>
            <option value="">Todos</option>{tipos.map((t) => <option key={t} value={t}>{MOTIVO_PENDIENTE_TXT[t] ?? t}</option>)}
          </select></label>
      </div>}
      {error && <div className="t-info error" role="alert">{error}</div>}
      {lista.length === 0 ? (simple && !todos.length ? null : <div className="t-info">{todos.length ? 'Ninguna fila con estos filtros.' : 'No queda ninguna fila sin local.'}</div>) : (
        <ul className="inc-lista" aria-label="Filas sin local">
          {lista.map((p) => <FilaPendiente key={p.registroId} p={p} deshacible={ultimaPorRegistro.has(p.registroId)} ocupado={!!ocupado} hacer={hacer} campanaId={campanaId} />)}
        </ul>
      )}

      {vigentes.some((d) => d.decision.accion !== 'mantener-pendiente') && (
        <Plegable simple={simple} titulo={`Decisiones tomadas (${vigentes.filter((d) => d.decision.accion !== 'mantener-pendiente').length})`}>
        <div className="col" style={{ gap: 4 }} aria-label="Decisiones tomadas">
          {!simple && <b>Decisiones tomadas</b>}
          <ul className="inc-lista">{vigentes.filter((d) => d.decision.accion !== 'mantener-pendiente').map((d) => {
            const r = db.registros[d.registroId];
            return (
              <li key={`${d.vinculoId}-${d.indice}`}>
                {db.itinerarios[r?.itinerarioId ?? '']?.codigo ?? ''} fila {r?.fila} · {ACCION_TXT[d.decision.accion]} · {db.personas[d.decision.porId]?.nombre ?? d.decision.porId}, {d.decision.fecha.slice(0, 10)}{d.decision.motivo ? ` · «${d.decision.motivo}»` : ''}{' '}
                <button className="btn s" disabled={!!ocupado} onClick={() => hacer('Deshaciendo la decisión…', (x, porId) => deshacerConciliacion(x, campanaId, d.registroId, { porId }))}><Undo2 size={13} /> Deshacer</button>
              </li>
            );
          })}</ul>
        </div>
        </Plegable>
      )}

      {resueltos.length > 0 && (
        <Plegable simple titulo={`Estados decididos (${resueltos.length})`}>
          <ul className="inc-lista" aria-label="Estados decididos">{resueltos.map((e) => (
            <li key={e.localId}>{portalDe(e.localId)} · {e.valor === 'vacio' ? 'vacío' : e.valor === 'ocupado' ? 'ocupado' : 'dudoso'} · {db.personas[e.resolucion!.porId]?.nombre ?? e.resolucion!.porId}, {e.resolucion!.fecha.slice(0, 10)}{' '}
              <button className="btn s" disabled={!!ocupado} onClick={() => hacer('Retirando la decisión…', (x, porId) => retirarResolucion(x, campanaId, e.localId, { porId }))}><Undo2 size={13} /> Retirar</button>
            </li>
          ))}</ul>
        </Plegable>
      )}

      {revisar.length > 0 && (
        <div className="col" style={{ gap: 4 }} aria-label="Estado de locales por revisar">
          <b>{simple ? `${revisar.length} local(es) con datos que no coinciden` : `Estado de locales por revisar · ${revisar.length}`}</b>
          {!simple && <p className="muted" style={{ margin: 0 }}>Las observaciones no se cambian ni se borran: la decisión se guarda aparte y se puede retirar.</p>}
          <ul className="inc-lista">{revisar.map((e) => {
            const portal = portalDe(e.localId);
            return (
              <li key={e.localId} className={e.resolucion ? '' : 'aviso'}>
                <b>{portal}</b> · {CLASE_ESTADO_TXT[e.clase]}{e.valor && e.resolucion ? `: ${e.valor === 'vacio' ? 'vacío' : 'ocupado'}` : ''} · {e.motivo}
                <div className="muted">{e.observaciones.map((o) => `${db.itinerarios[o.itinerarioId ?? '']?.codigo ?? '—'}: ${o.datos.vacio ? 'vacío' : o.datos.nombre ?? 'ocupado'} (${o.fecha ?? 'sin fecha'})`).join(' · ')}</div>
                {e.propuesta && !e.resolucion && <div className="muted">Propuesta (no aplicada): {e.propuesta.motivo}</div>}
                <div className="fila cj-fila-acc">
                  {e.resolucion ? (
                    <button className="btn s" disabled={!!ocupado} onClick={() => hacer('Retirando la decisión…', (x, porId) => retirarResolucion(x, campanaId, e.localId, { porId }))}><Undo2 size={13} /> Retirar la decisión</button>
                  ) : (<>
                    {(['ocupado', 'vacio'] as const).map((v) => {
                      const o = e.observaciones.filter((x) => (x.datos.vacio ? 'vacio' : 'ocupado') === v).at(-1);
                      return o && <button key={v} className="btn s" disabled={!!ocupado} onClick={() => hacer('Guardando la decisión…', (x, porId) => resolverEstado(x, campanaId, e.localId, { estado: v, observacionId: o.id }, { porId }))}><CheckCircle2 size={13} /> Confirmar {v === 'vacio' ? 'vacío' : 'ocupado'}</button>;
                    })}
                    {e.clase !== 'dudoso' && <button className="btn s" disabled={!!ocupado} onClick={() => hacer('Guardando la decisión…', (x, porId) => resolverEstado(x, campanaId, e.localId, { estado: 'dudoso' }, { porId }))}><HelpCircle size={13} /> Marcar dudoso</button>}
                  </>)}
                </div>
              </li>
            );
          })}</ul>
        </div>
      )}
    </div>
  );
}

/** En la vista sencilla, lo secundario queda plegado; en la completa se muestra tal cual. */
function Plegable({ simple, titulo, children }: { simple: boolean; titulo: string; children: React.ReactNode }) {
  return simple ? <details className="ux-plegable"><summary>{titulo}</summary>{children}</details> : <>{children}</>;
}

function FilaPendiente({ p, deshacible, ocupado, hacer, campanaId }: { p: Pendiente; deshacible: boolean; ocupado: boolean; campanaId: Id; hacer: (msg: string, fn: (x: BaseDatos, porId: Id) => BaseDatos) => Promise<void> }) {
  const personas = useEspacios((s) => s.db!.personas);
  const [localId, setLocalId] = useState(p.candidatos[0]?.localId ?? '');
  const [distinto, setDistinto] = useState(false);
  const [motivo, setMotivo] = useState('');
  return (
    <li aria-label={`Fila ${p.fila} de ${p.itinerario ?? p.archivo}`}>
      <b>{p.itinerario ?? '—'} · fila {p.fila}</b> · {p.direccion || 'sin dirección'}{p.nombre ? ` · «${p.nombre}»` : ''}{p.vacio !== undefined ? ` · ${p.vacio ? 'vacío' : 'ocupado'}` : ''}
      <div className="muted">{MOTIVO_PENDIENTE_TXT[p.motivo] ?? p.motivo}{p.decision ? ` · mantenida pendiente por ${personas[p.decision.porId]?.nombre ?? p.decision.porId} el ${p.decision.fecha.slice(0, 10)}${p.decision.motivo ? ` («${p.decision.motivo}»)` : ''}` : ''}</div>
      <div className={`chip ${p.claridad === 'clara' ? 'ok' : p.claridad === 'mismo-portal' ? '' : 'aviso'}`} style={{ alignSelf: 'flex-start' }}>{CLARIDAD_TXT[p.claridad]}</div>
      {p.candidatos.length > 0 && (
        <fieldset className="col" style={{ gap: 6, border: 0, padding: 0, margin: '6px 0' }}>
          <legend className="muted">Locales propuestos (ordenados; ninguno se aplica sin su decisión)</legend>
          {p.candidatos.map((c) => (
            <label key={c.localId} className="tarjeta col" style={{ gap: 4, padding: 8 }} aria-label={`Candidato ${c.portal}`}>
              <span><input type="radio" name={`cand-${p.registroId}`} checked={localId === c.localId} onChange={() => setLocalId(c.localId)} /> <b>{c.portal}</b>{c.mismoPortal ? ' · mismo portal' : ''}</span>
              <table className="tabla" aria-label={`Comparación con ${c.portal}`}>
                <thead><tr><th></th><th>{c.referencia?.campana ?? 'Censo de referencia'}</th><th>Esta fila</th></tr></thead>
                <tbody>
                  <tr><th>Nombre</th><td>{c.referencia?.nombre ?? '—'}</td><td>{p.nombre ?? '—'}</td></tr>
                  <tr><th>Dirección</th><td>{c.portal}</td><td>{p.direccion || '—'}</td></tr>
                  <tr><th>Estado</th><td>{c.referencia ? (c.referencia.vacio ? 'Vacío' : 'Ocupado') : '—'}</td><td>{p.vacio === undefined ? '—' : p.vacio ? 'Vacío' : 'Ocupado'}</td></tr>
                  <tr><th>Actividad</th><td>{c.referencia?.actividad ?? '—'}</td><td>{p.actividad ?? '—'}</td></tr>
                </tbody>
              </table>
              <ul className="muted" style={{ margin: 0 }} aria-label={`Motivos de ${c.portal}`}>{c.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
            </label>
          ))}
          <span className="muted">Vincular indica que es el mismo local físico; no confirma que sea el mismo negocio.</span>
        </fieldset>
      )}
      <div className="fila cj-fila-acc">
        {p.candidatos.length > 0 && <button className="btn s" disabled={ocupado || !localId} onClick={() => hacer('Vinculando…', (x, porId) => vincularALocal(x, campanaId, p.registroId, localId, { porId }))}><Link2 size={13} /> Es el mismo local físico</button>}
        {p.puedeCrearLocal && !distinto && <button className="btn s" disabled={ocupado} onClick={() => setDistinto(true)}><PlusCircle size={13} /> Es un local distinto</button>}
        {!p.decision && <button className="btn s" disabled={ocupado} onClick={() => hacer('Guardando…', (x, porId) => mantenerPendiente(x, campanaId, p.registroId, { porId }))}><Clock size={13} /> Mantener pendiente</button>}
        {deshacible && p.decision && <button className="btn s" disabled={ocupado} onClick={() => hacer('Deshaciendo…', (x, porId) => deshacerConciliacion(x, campanaId, p.registroId, { porId }))}><Undo2 size={13} /> Deshacer</button>}
      </div>
      {distinto && (
        <div className="fila cj-fila-acc">
          <input className="input" aria-label={`Por qué es un local distinto (fila ${p.fila})`} placeholder="p. ej. otro establecimiento en el mismo portal, comprobado en campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button className="btn s" disabled={ocupado || !motivo.trim()} onClick={() => hacer('Creando el local…', (x, porId) => crearLocalDistinto(x, campanaId, p.registroId, { porId, motivo }))}><PlusCircle size={13} /> Crear local distinto</button>
          <button className="btn s" onClick={() => setDistinto(false)}>Cancelar</button>
        </div>
      )}
    </li>
  );
}
