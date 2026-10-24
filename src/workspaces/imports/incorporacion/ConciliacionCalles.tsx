import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MapPinOff, Undo2 } from 'lucide-react';
import { fmt } from '../../../components/ui';
import type { DecisionesIncorporacion } from '../../../domain/incorporacion';
import { denominacionesPorConciliar, ESTADO_CALLE_TXT } from '../../../domain/c1e';
import { FUENTE_TXT, type DecisionCalle, type Propuesta } from '../../../domain/conciliacionCalles';
import type { ResultadoInterpretacion } from '../../../domain/xlsx/interpretacion';
import { ChipEstado } from './RevisionGrupos';
import { useCtxIncorporacion } from './contextoIncorporacion';
import type { Id } from '../../../domain/types';

/** Las denominaciones con más registros se revisan primero. */
const PRIORITARIAS = 4;

/**
 * Conciliación SUPERVISADA de calles: por cada denominación del archivo sin correspondencia automática,
 * las propuestas con su FUENTE y, al lado, la decisión. Nada se aplica sin una persona que confirme y
 * justifique; la decisión cubre todos los registros de esa denominación.
 */
export function ConciliacionCalles({ resultado, decisiones, onCambiar, firma, sinPermiso }: {
  resultado: ResultadoInterpretacion;
  decisiones: DecisionesIncorporacion;
  onCambiar: (d: DecisionesIncorporacion) => void;
  firma: { porId: Id; fecha: string };
  sinPermiso?: string;
}) {
  const { db, destino } = useCtxIncorporacion();
  const lista = useMemo(() => denominacionesPorConciliar(db, resultado, destino.municipioId, decisiones), [db, resultado, destino, decisiones]);
  const calles = useMemo(() => Object.values(db.calles).filter((c) => c.municipioId === destino.municipioId).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')), [db, destino]);
  const decisionDe = (d: string) => decisiones.calles?.find((x) => x.denominacion === d);
  const fijar = (denominacion: string, dec: DecisionCalle | null) => {
    const resto = (decisiones.calles ?? []).filter((x) => x.denominacion !== denominacion);
    onCambiar({ ...decisiones, calles: dec ? [...resto, dec] : resto });
  };
  const pendientes = lista.filter((d) => d.estado === 'pendiente');
  const prioritarias = new Set([...lista].sort((a, b) => b.filas - a.filas).slice(0, PRIORITARIAS).map((d) => d.denominacion));
  return (
    <div className="col" style={{ gap: 10 }} aria-label="Conciliación de calles">
      <div className="t-info" style={{ margin: 0 }}>
        <div>
          <b>Ninguna correspondencia se aplica sola.</b> Cada propuesta indica su fuente. Confirmarla vincula <b>todos</b> los registros de esa denominación a la calle elegida, con persona, fecha y justificación. El texto original del archivo no se modifica. Si la calle no está en el callejero, no se inventan calles, geometrías ni coordenadas: el registro se conserva sin vínculo.
          {db.meta?.detalleCallejero && <div className="muted" style={{ marginTop: 4 }}>Callejero: {db.meta.detalleCallejero}</div>}
        </div>
      </div>
      <div className="fila" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="chip aviso">{fmt(pendientes.length)} denominación(es) pendiente(s) · {fmt(pendientes.reduce((a, d) => a + d.filas, 0))} registros</span>
        <span className="chip ok">{fmt(lista.filter((d) => d.estado === 'conciliada').length)} conciliada(s)</span>
        <span className="chip">{fmt(lista.filter((d) => d.estado === 'sin-correspondencia').length)} sin correspondencia (decidido)</span>
      </div>
      {!lista.length && <div className="vacio-estado tarjeta">Todas las denominaciones del archivo coinciden con el callejero.</div>}
      <div className="dat-tabla scroll-fino" style={{ maxHeight: 620 }}>
        <table className="tabla ap-tabla conc-tabla" aria-label="Denominaciones por conciliar">
          <thead><tr><th>Denominación en el archivo</th><th className="num">Registros</th><th>Propuestas (fuente)</th><th>Decisión</th></tr></thead>
          <tbody>
            {lista.map((d) => {
              const dec = decisionDe(d.denominacion);
              return (
                <tr key={d.denominacion} aria-label={`Denominación ${d.denominacion}`}>
                  <td>
                    <b>{d.denominacion}</b>
                    {prioritarias.has(d.denominacion) && d.estado === 'pendiente' && <div><span className="chip aviso">Prioritaria</span></div>}
                  </td>
                  <td className="num">{fmt(d.filas)}</td>
                  <td>
                    {d.ausente && <div className="conc-ausente"><MapPinOff size={13} /> {d.ausente.nota}</div>}
                    {d.propuestas.map((p) => <PropuestaTxt key={p.calleId} p={p} />)}
                    {!d.propuestas.length && !d.ausente && <span className="muted">Sin propuestas: no hay ninguna calle con una relación verificable.</span>}
                  </td>
                  <td>
                    {dec ? (
                      <div className="col" style={{ gap: 3 }}>
                        <span><ChipEstado e="resuelto" /> {dec.accion === 'vincular' ? <>→ <b>{db.calles[dec.calleId]?.nombre ?? dec.calleId}</b></> : ESTADO_CALLE_TXT['sin-correspondencia']}</span>
                        <span className="muted dec-nota"><CheckCircle2 size={13} /> {db.personas[dec.porId]?.nombre ?? dec.porId} · {dec.fecha} · «{dec.motivo}»{dec.accion === 'vincular' ? ` · fuente: ${dec.fuente === 'eleccion-manual' ? 'elección manual' : FUENTE_TXT[dec.fuente].titulo}` : ''}</span>
                        <div><button className="btn s" onClick={() => fijar(d.denominacion, null)}><Undo2 size={13} /> Retirar la decisión</button></div>
                      </div>
                    ) : sinPermiso ? <span className="muted dec-nota">Pendiente · {sinPermiso}</span> : (
                      <Decidir denominacion={d.denominacion} propuestas={d.propuestas} ausente={!!d.ausente} calles={calles} onDecidir={(x) => fijar(d.denominacion, { ...x, ...firma } as DecisionCalle)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PropuestaTxt({ p }: { p: Propuesta }) {
  const f = FUENTE_TXT[p.fuente];
  return (
    <div className="conc-prop">
      <b>{p.calle}</b> <span className={`chip ${f.solida ? '' : 'aviso'}`}>{f.titulo}</span>
      <div className="muted">{p.explicacion}</div>
    </div>
  );
}

type Opcion = '' | 'sin' | 'otra' | Id;
type SinFirma = DecisionCalle extends infer T ? (T extends unknown ? Omit<T, 'porId' | 'fecha'> : never) : never;

function Decidir({ denominacion, propuestas, ausente, calles, onDecidir }: {
  denominacion: string; propuestas: Propuesta[]; ausente: boolean; calles: { id: Id; nombre: string }[];
  onDecidir: (d: SinFirma) => void;
}) {
  const [opcion, setOpcion] = useState<Opcion>('');
  const [otra, setOtra] = useState<Id>('');
  const [motivo, setMotivo] = useState('');
  const prop = propuestas.find((p) => p.calleId === opcion);
  const debil = opcion === 'otra' || (prop && !FUENTE_TXT[prop.fuente].solida);
  const listo = !!motivo.trim() && (opcion === 'sin' || !!prop || (opcion === 'otra' && !!otra));
  const confirmar = () => {
    if (opcion === 'sin') onDecidir({ denominacion, accion: 'sin-correspondencia', motivo: motivo.trim() });
    else if (prop) onDecidir({ denominacion, accion: 'vincular', calleId: prop.calleId, fuente: prop.fuente, motivo: motivo.trim() });
    else if (opcion === 'otra' && otra) onDecidir({ denominacion, accion: 'vincular', calleId: otra, fuente: 'eleccion-manual', motivo: motivo.trim() });
  };
  return (
    <div className="col dec-elegir" style={{ gap: 4 }}>
      <select className="input" aria-label={`Decisión para ${denominacion}`} value={opcion} onChange={(e) => setOpcion(e.target.value)}>
        <option value="">Dejar pendiente</option>
        {propuestas.map((p) => <option key={p.calleId} value={p.calleId}>Confirmar: {p.calle}</option>)}
        <option value="otra">Elegir otra calle del callejero…</option>
        <option value="sin">{ausente ? 'Sin correspondencia: la calle no está en el callejero' : 'Sin correspondencia en el callejero'}</option>
      </select>
      {opcion === 'otra' && (
        <select className="input" aria-label={`Calle del callejero para ${denominacion}`} value={otra} onChange={(e) => setOtra(e.target.value)}>
          <option value="">— Calle —</option>
          {calles.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      )}
      {debil && <span className="conc-aviso"><AlertTriangle size={13} /> El parecido del texto no basta: indique qué fuente lo confirma (nomenclátor, plano, visita…).</span>}
      {opcion && <input className="input" placeholder="Justificación (obligatoria)" aria-label={`Justificación para ${denominacion}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      {opcion && <div><button className="btn s primario" disabled={!listo} onClick={confirmar}>Confirmar decisión</button></div>}
    </div>
  );
}
