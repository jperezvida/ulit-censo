import { useState } from 'react';
import { Link2, PlusCircle, Clock, Undo2, CheckCircle2, HelpCircle } from 'lucide-react';
import { useEspacios } from '../../store/espacios';
import { itinerariosDe } from '../../domain/campanaOperativa';
import {
  CLASE_ESTADO_TXT, MOTIVO_PENDIENTE_TXT, crearLocalDistinto, decisionesCampana, deshacerConciliacion, localesPorRevisar, mantenerPendiente,
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
export function ConciliacionPosterior({ campanaId }: { campanaId: Id }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const [f, setF] = useState<FiltrosPendientes>({});
  const [error, setError] = useState<string | null>(null);
  const todos = pendientesCampana(db, campanaId);
  const lista = pendientesCampana(db, campanaId, f);
  const revisar = localesPorRevisar(db, campanaId);
  const decisiones = decisionesCampana(db, campanaId);
  const vigentes = decisiones.filter((d) => !d.decision.deshecha);
  const ultimaPorRegistro = new Map<Id, (typeof vigentes)[number]>();
  for (const d of vigentes) if (!ultimaPorRegistro.has(d.registroId)) ultimaPorRegistro.set(d.registroId, d);
  const calles = [...new Map(todos.filter((p) => p.calleId).map((p) => [p.calleId!, db.calles[p.calleId!]?.nombre ?? p.calleId!])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  const tipos = [...new Set(todos.flatMap((p) => [p.motivo, ...(p.decision ? ['mantener-pendiente'] : [])]))];
  const hacer = async (msg: string, fn: (x: BaseDatos, porId: Id) => BaseDatos) => {
    const r = await modificar(msg, (x, ctx) => fn(x, ctx.porId));
    setError(r.ok ? null : r.error ?? 'No se ha podido guardar.');
  };

  return (
    <div className="col" style={{ gap: 8 }} role="region" aria-label="Conciliación posterior">
      <b>Conciliación posterior · {todos.length} fila(s) sin local</b>
      <p className="muted" style={{ margin: 0 }}>Filas de cualquier itinerario que quedaron sin local al importar. Vincule cada una a un local existente, cree un local distinto si es otro establecimiento, o déjela pendiente. Nada se fusiona por compartir portal.</p>
      <div className="col-ctrl">
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
      </div>
      {error && <div className="t-info error" role="alert">{error}</div>}
      {lista.length === 0 ? <div className="t-info">{todos.length ? 'Ninguna fila con estos filtros.' : 'No queda ninguna fila sin local.'}</div> : (
        <ul className="inc-lista" aria-label="Filas sin local">
          {lista.map((p) => <FilaPendiente key={p.registroId} p={p} deshacible={ultimaPorRegistro.has(p.registroId)} ocupado={!!ocupado} hacer={hacer} campanaId={campanaId} />)}
        </ul>
      )}

      {vigentes.some((d) => d.decision.accion !== 'mantener-pendiente') && (
        <div className="col" style={{ gap: 4 }} aria-label="Decisiones tomadas">
          <b>Decisiones tomadas</b>
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
      )}

      {revisar.length > 0 && (
        <div className="col" style={{ gap: 4 }} aria-label="Estado de locales por revisar">
          <b>Estado de locales por revisar · {revisar.length}</b>
          <p className="muted" style={{ margin: 0 }}>Las observaciones no se cambian ni se borran: la decisión se guarda aparte y se puede retirar.</p>
          <ul className="inc-lista">{revisar.map((e) => {
            const d = db.locales[e.localId]?.direcciones.at(-1);
            const portal = d ? `${db.calles[d.calleId]?.nombre ?? d.calleId}, ${d.numero ?? 's/n'}${d.sufijo ? ` ${d.sufijo}` : ''}` : e.localId;
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

function FilaPendiente({ p, deshacible, ocupado, hacer, campanaId }: { p: Pendiente; deshacible: boolean; ocupado: boolean; campanaId: Id; hacer: (msg: string, fn: (x: BaseDatos, porId: Id) => BaseDatos) => Promise<void> }) {
  const personas = useEspacios((s) => s.db!.personas);
  const [localId, setLocalId] = useState(p.candidatos[0]?.localId ?? '');
  const [distinto, setDistinto] = useState(false);
  const [motivo, setMotivo] = useState('');
  return (
    <li aria-label={`Fila ${p.fila} de ${p.itinerario ?? p.archivo}`}>
      <b>{p.itinerario ?? '—'} · fila {p.fila}</b> · {p.direccion || 'sin dirección'}{p.nombre ? ` · «${p.nombre}»` : ''}{p.vacio !== undefined ? ` · ${p.vacio ? 'vacío' : 'ocupado'}` : ''}
      <div className="muted">{MOTIVO_PENDIENTE_TXT[p.motivo] ?? p.motivo}{p.decision ? ` · mantenida pendiente por ${personas[p.decision.porId]?.nombre ?? p.decision.porId} el ${p.decision.fecha.slice(0, 10)}${p.decision.motivo ? ` («${p.decision.motivo}»)` : ''}` : ''}</div>
      <div className="fila cj-fila-acc">
        {p.candidatos.length > 0 && (<>
          <select className="input" aria-label={`Local para la fila ${p.fila}`} value={localId} onChange={(e) => setLocalId(e.target.value)}>
            {p.candidatos.map((c) => <option key={c.localId} value={c.localId}>{c.portal}{c.mismoPortal ? ' (mismo portal)' : ''}</option>)}
          </select>
          <button className="btn s" disabled={ocupado || !localId} onClick={() => hacer('Vinculando…', (x, porId) => vincularALocal(x, campanaId, p.registroId, localId, { porId }))}><Link2 size={13} /> Vincular</button>
        </>)}
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
