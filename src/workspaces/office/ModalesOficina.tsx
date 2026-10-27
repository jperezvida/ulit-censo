import { useState } from 'react';
import { Clock, Lock, ShieldAlert } from 'lucide-react';
import { useStore } from '../../store/store';
import { cerrarRevisionItinerario, controlesValidacion, reabrirItinerario } from '../../domain/bloqueo';
import { TIPO_OBS_TXT, ubicarEnCronologia } from '../../domain/campo';
import { observacionesDeLocal, ocupacionesDeLocal } from '../../domain/consultas';
import type { Alcance } from '../../domain/bloqueo';
import type { Id, Itinerario } from '../../domain/types';
import { Modal, fmtFecha } from '../../components/ui';

/** Cierre PROVISIONAL de la revisión: registra quién y cuándo; no habilita la exportación. */
export function ModalCerrarRevision({ it, personaId, pendientes, onCerrar }: { it: Itinerario; personaId: Id; pendientes: number; onCerrar: () => void }) {
  const db = useStore((s) => s.db!);
  const aplicar = useStore((s) => s.aplicar);
  const ahora = new Date();
  return (
    <Modal
      titulo={`Cerrar la revisión de ${it.codigo}`}
      sub="Cierre provisional: bloquea la edición de sus registros en esta campaña."
      onCerrar={onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primario" onClick={() => { aplicar((d) => cerrarRevisionItinerario(d, it.id, personaId), `Revisión de ${it.codigo} cerrada (provisional)`); onCerrar(); }}>
            <Lock size={14} /> Cerrar revisión
          </button>
        </>
      }
    >
      <dl className="ofi-dl">
        <dt>Revisión final por</dt><dd>{db.personas[personaId]?.nombre ?? personaId} <span className="muted">(puede ser quien hizo el trabajo)</span></dd>
        <dt>Fecha</dt><dd>{ahora.toLocaleString('es-ES')}</dd>
        <dt>Registros con tareas pendientes</dt><dd>{pendientes}</dd>
      </dl>
      <div className="t-info aviso" style={{ margin: '10px 0 0' }}>
        <ShieldAlert size={15} /> Esto <b>no</b> es la validación definitiva: el itinerario no queda apto para la exportación municipal hasta superar los controles del bloque C.
      </div>
    </Modal>
  );
}

export function ModalReabrir({ it, personaId, onCerrar }: { it: Itinerario; personaId: Id; onCerrar: () => void }) {
  const aplicar = useStore((s) => s.aplicar);
  const [motivo, setMotivo] = useState('');
  return (
    <Modal
      titulo={`Reabrir ${it.codigo}`}
      sub="Hay que justificar la reapertura. Queda registrado quién la hace, cuándo y por qué."
      onCerrar={onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primario" disabled={!motivo.trim()} onClick={() => { if (aplicar((d) => reabrirItinerario(d, it.id, personaId, motivo), `${it.codigo} reabierto`)) onCerrar(); }}>Reabrir</button>
        </>
      }
    >
      <label className="campo">
        <span>Motivo</span>
        <textarea className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus aria-label="Motivo de la reapertura" />
      </label>
    </Modal>
  );
}

export function ModalValidacion({ it, onCerrar }: { it: Itinerario; onCerrar: () => void }) {
  const db = useStore((s) => s.db!);
  const c = controlesValidacion(db, it.id);
  return (
    <Modal titulo={`Validación definitiva de ${it.codigo}`} sub="No disponible todavía." onCerrar={onCerrar} pie={<button className="btn" onClick={onCerrar}>Entendido</button>}>
      <p>La validación definitiva (apta para la consolidación municipal) exige superar estos controles, pendientes de implementar:</p>
      <ul>{c.pendientes.map((p) => <li key={p}>{p}</li>)}</ul>
      <p className="muted">Mientras tanto, usa «Cerrar revisión (provisional)», que bloquea la edición y registra quién y cuándo.</p>
    </Modal>
  );
}

/**
 * Observaciones de cronología incierta de un local: la oficina asigna la fecha real y el
 * evento se coloca en su lugar (puede quedar como etapa intermedia del histórico).
 */
export function ModalCronologia({ localId, campanaId, personaId, alcance, onCerrar }: { localId: Id; campanaId: Id; personaId: Id; alcance?: Alcance; onCerrar: () => void }) {
  const db = useStore((s) => s.db!);
  const aplicar = useStore((s) => s.aplicar);
  const obs = observacionesDeLocal(db, localId).filter((o) => o.campanaId === campanaId);
  const inciertas = obs.filter((o) => o.cronologia === 'incierta');
  const [fechas, setFechas] = useState<Record<Id, string>>({});
  const ocupaciones = ocupacionesDeLocal(db, localId);
  return (
    <Modal titulo="Cronología incierta" sub="Asigna la fecha (y la hora si coincide el día) en que se produjo cada evento." onCerrar={onCerrar} ancho pie={<button className="btn" onClick={onCerrar}>Cerrar</button>}>
      {inciertas.length === 0 && <p className="muted">No quedan eventos con cronología incierta en este local.</p>}
      {inciertas.map((o) => (
        <div key={o.id} className="ofi-crono">
          <div>
            <b>{TIPO_OBS_TXT[o.tipo]}</b> · {o.datos.vacio ? 'vacío' : o.datos.nombre ?? '—'}
            <div className="muted" style={{ fontSize: 12 }}>Fuente: {o.fuente} · introducido {fmtFecha(o.registrado)} · sin fecha que permita ordenarlo</div>
          </div>
          <input
            type="datetime-local"
            className="input"
            aria-label="Fecha real del evento"
            value={fechas[o.id] ?? ''}
            onChange={(e) => setFechas((f) => ({ ...f, [o.id]: e.target.value }))}
          />
          <button
            className="btn s primario"
            disabled={!fechas[o.id]}
            onClick={() => aplicar((d) => ubicarEnCronologia(d, o.id, `${fechas[o.id]}:00`, personaId, alcance), 'Evento colocado en su fecha')}
          >
            <Clock size={13} /> Asignar fecha
          </button>
        </div>
      ))}
      <div className="rotulo" style={{ marginTop: 14 }}>Secuencia actual de ocupaciones</div>
      <ol className="ofi-secuencia">
        {ocupaciones.map((oc) => (
          <li key={oc.id}>
            {oc.negocioId ? db.negocios[oc.negocioId]?.nombre : 'Vacío'} <span className="muted">· desde {db.campanas[oc.desdeCampanaId]?.anio}{oc.desdeFecha ? ` (${fmtFecha(oc.desdeFecha)})` : ''}{oc.hastaObservacionId ? ' · sustituido' : ' · vigente'}</span>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
