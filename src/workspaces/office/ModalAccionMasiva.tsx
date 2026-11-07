import { useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { Modal, fmt } from '../../components/ui';
import { ejecutarAccionMasiva, etiquetaVariable, planAccionMasiva, variablesBinarias, type AccionMasiva, type VariableBinaria } from '../../domain/acciones';
import { PARTES_HERENCIA, type ParteHerencia } from '../../domain/herencia';
import { catalogoDeCampana } from '../../domain/clasificacion';
import { rutaTexto } from '../../domain/buscador';
import { DEF_VARIABLE } from '../../domain/digital';
import type { FilaOficina } from '../../domain/oficina';
import type { Alcance } from '../../domain/bloqueo';
import type { Id, Respuesta } from '../../domain/types';
import { BuscadorClasificacion } from './BuscadorClasificacion';

type Tipo = AccionMasiva['tipo'];
const TIPOS: { id: Tipo; t: string }[] = [
  { id: 'respuesta', t: 'Respuesta Sí/No' },
  { id: 'incidencia', t: 'Marcar incidencia' },
  { id: 'clasificacion', t: 'Clasificación' },
  { id: 'partir2025', t: 'Preparar desde la campaña anterior' },
];
const RESPUESTAS: { r: Respuesta; t: string }[] = [
  { r: 'si', t: 'Sí (1)' },
  { r: 'no', t: 'No (0)' },
  { r: 'na', t: 'No aplicable (N)' },
  { r: 'sin-info', t: 'Sin información (?)' },
  { r: 'pendiente', t: 'Pendiente (Supr)' },
];
const NOMBRE_PARTE: Record<ParteHerencia, string> = { clasificacion: 'Clasificación', franquicia: 'Franquicia', digital: 'Presencia digital' };

/**
 * Acción masiva sobre los registros seleccionados: se elige la operación, se ve el plan
 * (cuántos registros, qué operación, cuáles quedan fuera y por qué) y solo entonces se aplica,
 * de forma atómica y como un único paso de deshacer.
 */
export function ModalAccionMasiva({ filas, campanaId, personaId, alcance, bloqueado, variableInicial = 'franquicia', onCerrar, onHecho }: {
  filas: FilaOficina[];
  /** Variable propuesta al abrir (según la tarea activa). */
  variableInicial?: VariableBinaria;
  campanaId: Id;
  personaId: Id;
  alcance?: Alcance;
  bloqueado: boolean;
  onCerrar: () => void;
  onHecho: (mensaje: string) => void;
}) {
  const db = useStore((s) => s.db!);
  const aplicar = useStore((s) => s.aplicar);
  const [tipo, setTipo] = useState<Tipo>('respuesta');
  const [variable, setVariable] = useState<VariableBinaria>(variableInicial);
  const [respuesta, setRespuesta] = useState<Respuesta>('no');
  const [motivo, setMotivo] = useState('');
  const [clasif, setClasif] = useState<{ nodoId: Id; descripcion?: string } | null>(null);
  const [partes, setPartes] = useState<ParteHerencia[]>(PARTES_HERENCIA);
  const [error, setError] = useState<string | null>(null);

  const accion: AccionMasiva | null =
    tipo === 'respuesta' ? { tipo, variable, respuesta }
      : tipo === 'incidencia' ? { tipo, motivo }
        : tipo === 'clasificacion' ? (clasif ? { tipo, ...clasif } : null)
          : { tipo, partes };
  const plan = useMemo(() => (accion ? planAccionMasiva(db, campanaId, filas, accion, { alcance, bloqueado, porId: personaId }) : null), [db, campanaId, filas, JSON.stringify(accion), alcance, bloqueado, personaId]); // eslint-disable-line react-hooks/exhaustive-deps
  const admiteNa = variable !== 'franquicia' && (DEF_VARIABLE[variable].admiteNa || !!DEF_VARIABLE[variable].depende);
  const n = plan?.aplicables.length ?? 0;

  const ejecutar = () => {
    if (!plan || !accion || !n) return;
    let fallo: string | null = null;
    const ok = aplicar((d) => {
      try {
        return ejecutarAccionMasiva(d, campanaId, plan.aplicables, accion, personaId, alcance);
      } catch (e) {
        fallo = e instanceof Error ? e.message : String(e);
        throw e;
      }
    }, `Acción masiva · ${plan.descripcion} · ${fmt(n)} registro(s)`, { silencioso: true, sinAvisoError: true });
    if (fallo) setError(`No se ha aplicado ningún cambio: ${fallo}`);
    else {
      onHecho(ok ? `${plan.descripcion} · ${fmt(n)} registro(s) · Ctrl+Z para deshacer` : 'Sin cambios: los registros ya tenían ese valor');
      onCerrar();
    }
  };

  return (
    <Modal
      titulo="Acción sobre la selección"
      sub={`${fmt(filas.length)} registro(s) seleccionados. Ninguna acción masiva verifica la presencia digital ni aprueba registros.`}
      onCerrar={onCerrar}
      ancho
      pie={
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primario" disabled={!n} onClick={ejecutar} aria-label={`Aplicar a ${n} registros`}>
            Aplicar a {fmt(n)} registro(s)
          </button>
        </>
      }
    >
      <div className="am">
        <div className="segmentado am-tipos" role="radiogroup" aria-label="Operación">
          {TIPOS.map((t) => (
            <button key={t.id} role="radio" aria-checked={tipo === t.id} className={tipo === t.id ? 'on' : ''} onClick={() => { setTipo(t.id); setError(null); }}>{t.t}</button>
          ))}
        </div>

        {tipo === 'respuesta' && (
          <div className="am-params">
            <label className="campo">
              <span>Variable</span>
              <select className="input" value={variable} onChange={(e) => { const v = e.target.value as VariableBinaria; setVariable(v); if (respuesta === 'na' && v === 'franquicia') setRespuesta('no'); }} aria-label="Variable">
                {variablesBinarias().map((v) => <option key={v} value={v}>{etiquetaVariable(v)}</option>)}
              </select>
            </label>
            <div className="campo">
              <span>Respuesta</span>
              <div className="of-resp" role="radiogroup" aria-label="Respuesta">
                {RESPUESTAS.filter((x) => x.r !== 'na' || admiteNa).map((x) => (
                  <button key={x.r} role="radio" aria-checked={respuesta === x.r} className={`of-r ${respuesta === x.r ? `on r-${x.r}` : ''}`} onClick={() => setRespuesta(x.r)}>{x.t}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        {tipo === 'incidencia' && (
          <label className="campo am-params">
            <span>Motivo (queda como «pendiente de comprobación»)</span>
            <input className="input" aria-label="Motivo de la incidencia" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. Revisar en la próxima visita" autoFocus />
          </label>
        )}
        {tipo === 'clasificacion' && (
          <div className="am-params col">
            {clasif && <div className="am-elegida"><b>Clasificación elegida:</b> {rutaTexto(clasif.nodoId, clasif.descripcion)} <button className="btn s fantasma" onClick={() => setClasif(null)}>Cambiar</button></div>}
            {!clasif && <BuscadorClasificacion catalogo={catalogoDeCampana(db, campanaId)} autoFocus etiqueta="Clasificación para la selección" onElegir={(e) => setClasif({ nodoId: e.opcion.nodoId, descripcion: e.descripcion })} />}
          </div>
        )}
        {tipo === 'partir2025' && (
          <div className="am-params col">
            <div className="fila" role="group" aria-label="Datos a preparar">
              {PARTES_HERENCIA.map((p) => (
                <label key={p} className="fila" style={{ gap: 4 }}>
                  <input type="checkbox" checked={partes.includes(p)} onChange={(e) => setPartes(e.target.checked ? [...partes, p] : partes.filter((x) => x !== p))} /> {NOMBRE_PARTE[p]}
                </label>
              ))}
            </div>
            <p className="muted am-nota">Solo se copian datos del MISMO negocio confirmado en campo, como borrador sin verificar. No se sobrescribe nada de esta campaña ni se modifica la anterior.</p>
          </div>
        )}

        {plan && (
          <div className="am-plan" aria-live="polite">
            <div className="am-resumen" role="status">
              <b>{fmt(n)}</b> registro(s) afectados · <span>{plan.descripcion}</span>
            </div>
            {plan.herencia && plan.herencia.senaladas.length > 0 && (
              <details className="am-det">
                <summary>{plan.herencia.senaladas.length} dato(s) histórico(s) inválidos o ambiguos: se señalan y NO se copian</summary>
                <ul>{plan.herencia.senaladas.map((x, i) => <li key={i}>{nombreDe(filas, x.localId)} · {x.detalle}</li>)}</ul>
              </details>
            )}
            {plan.excluidas.length > 0 && (
              <details className="am-det">
                <summary>{plan.excluidas.length} registro(s) excluidos</summary>
                <ul>{plan.excluidas.map((x) => <li key={x.fila.localId}>{x.fila.vacio ? 'Vacío' : x.fila.nombre} ({x.fila.calle} {x.fila.numero ?? 's/n'}) · {x.motivo}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        {error && <div className="t-info error" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}

function nombreDe(filas: FilaOficina[], localId: Id) {
  const f = filas.find((x) => x.localId === localId);
  return f ? `${f.nombre} (${f.calle} ${f.numero ?? 's/n'})` : localId;
}
