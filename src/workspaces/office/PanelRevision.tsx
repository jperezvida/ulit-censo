import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, Copy, ExternalLink, GitMerge, ShieldCheck, Undo2, X } from 'lucide-react';
import { useContexto, useFichaLocal } from '../../store/contexto';
import { useStore } from '../../store/store';
import { actualizarRevisiones, aprobar, asignarActividad, devolver, editarNegocio, esDudosa, motivoNoAprobable, type FilaOficina } from '../../domain/oficina';
import { useCtxOficina } from './contextoOficina';
import { clasificacionAnterior, clasificacionEn, partirDeClasificacionAnterior } from '../../domain/clasificacion';
import { VARIABLES_DIGITALES, esExigible, estadoDigital, partirDeDigitalAnterior, problemasDigitales, registrarDatoDigital, revisionDigitalAnterior, revisionDigitalEn, verificarDigital } from '../../domain/digital';
import { RESPUESTA_TXT } from '../../domain/respuesta';
import { negocioEn, ocupacionEn, textoDireccion } from '../../domain/consultas';
import { resolverVinculo } from '../../domain/conciliacion';
import { TIPO_OBS_TXT } from '../../domain/campo';
import { rutaActividad } from '../../domain/taxonomy';
import type { Respuesta, VariableDigital } from '../../domain/types';
import { SelectorActividad } from '../../components/SelectorActividad';
import { Historico } from '../local/Historico';
import { Modal, fmtFecha } from '../../components/ui';

export type Pestana = 'ficha' | 'digital' | 'historico' | 'conciliacion';

/** Campo de texto que guarda al confirmar (Enter o salir del campo), no en cada pulsación. */
export function CampoConfirmado({ valor, onGuardar, placeholder, etiqueta, disabled }: { valor: string; onGuardar: (v: string) => void; placeholder?: string; etiqueta: string; disabled?: boolean }) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  const guardar = () => {
    if (v !== valor) onGuardar(v);
  };
  return (
    <input
      className="input"
      aria-label={etiqueta}
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={guardar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') guardar();
        if (e.key === 'Escape') setV(valor);
      }}
    />
  );
}

export function PanelRevision({ fila, onCerrar, onAnterior, onSiguiente, onAprobar, onDevolver, posicion, variante = 'panel', pestanaInicial }: {
  fila: FilaOficina;
  onCerrar: () => void;
  onAnterior: () => void;
  onSiguiente: () => void;
  onAprobar?: () => void;
  onDevolver?: () => void;
  posicion: string;
  variante?: 'panel' | 'pagina';
  pestanaInicial?: Pestana;
}) {
  const { db, campana, prefs } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const oficina = useCtxOficina();
  const alcance = oficina?.alcance;
  const bloqueado = !!oficina?.bloqueado || fila.bloqueado;
  const [devolviendo, setDevolviendo] = useState(false);
  const ficha = useFichaLocal();
  const vinculos = useMemo(
    () => Object.values(db.vinculos).filter((v) => v.localId === fila.localId && v.origen.tipo === 'observacion' && (v.confianza === 'dudosa' || v.confianza === 'probable')),
    [db.vinculos, fila.localId],
  );
  const [pestana, setPestana] = useState<Pestana>(pestanaInicial ?? (esDudosa(fila) && vinculos.length ? 'conciliacion' : 'ficha'));
  if (!campana) return null;
  const l = db.locales[fila.localId];
  const neg = fila.negocioId ? db.negocios[fila.negocioId] : undefined;
  const r = fila.rev;
  const motivo = motivoNoAprobable(fila);
  const ref = campana.campanaReferenciaId;
  const antes = ref ? negocioEn(db, fila.localId, ref) : null;
  const cla = neg ? clasificacionEn(db, neg.id, campana.id) : undefined;
  const claAnt = neg ? clasificacionAnterior(db, neg.id, campana.id) : undefined;
  const ocAntes = ref ? ocupacionEn(db, fila.localId, ref) : undefined;
  const accionAprobar = onAprobar ?? (() => aplicar((d) => aprobar(d, campana.id, [fila], alcance).db, 'Registro aprobado'));
  const accionDevolver = onDevolver ?? (() => setDevolviendo(true));

  return (
    <aside className={`of-panel ${variante === 'pagina' ? 'of-panel-pagina' : ''}`} aria-label="Revisión del registro">
      <div className="of-panel-cab">
        <div className="fila">
          <span className="muted mono" style={{ fontSize: 11 }}>{posicion}</span>
          <span className="esp" />
          <button className="btn s fantasma icono" onClick={onAnterior} aria-label="Anterior (K)"><ArrowUp size={15} /></button>
          <button className="btn s fantasma icono" onClick={onSiguiente} aria-label="Siguiente (J)"><ArrowDown size={15} /></button>
          <button className="btn s fantasma icono" onClick={onCerrar} aria-label="Cerrar"><X size={15} /></button>
        </div>
        <h3>{fila.vacio ? 'Local vacío' : fila.nombre}</h3>
        <div className="muted" style={{ fontSize: 13 }}>{textoDireccion(db, l)}{fila.itinerario ? ` · ${fila.itinerario}` : ''}</div>
        <div className="of-estados4">
          <Estado t="Campo" ok={r.campo === 'terminado'} />
          <Estado t="Categoría" ok={fila.vacio || r.categorizacion === 'revisado'} na={fila.vacio} onClick={fila.vacio ? undefined : () => setPestana('ficha')} />
          <Estado t="Digital" ok={fila.vacio || r.digital === 'revisado'} na={fila.vacio} onClick={fila.vacio ? undefined : () => setPestana('digital')} />
          <Estado t="Validación" ok={r.validacion === 'aprobada'} error={r.validacion === 'devuelta'} />
        </div>
        {r.validacion === 'devuelta' && <div className="t-info error" style={{ margin: '8px 0 0' }}>Devuelto: {r.motivoDevolucion}</div>}
        {fila.situacion === 'pendiente-visita' && <div className="t-info" style={{ margin: '8px 0 0' }}>Pendiente de visitar en campo: se muestran los datos de {db.campanas[ref ?? '']?.anio ?? 'referencia'}.</div>}
        {bloqueado && <div className="t-info aviso" style={{ margin: '8px 0 0' }}>Itinerario con la revisión cerrada: solo lectura.</div>}
        {fila.obs && (
          <div className="of-obs-det">
            <span className={`of-obs t-${fila.obs.tipo}`}>{TIPO_OBS_TXT[fila.obs.tipo]}</span>
            <span className="muted">{fmtFecha(fila.obs.fecha)} · {fila.obs.fuente === 'campo-app' ? 'app de campo' : fila.obs.fuente}{fila.obs.investigadorId ? ` · ${db.personas[fila.obs.investigadorId]?.nombre}` : ''}</span>
            {fila.obs.nota && <span className="of-nota">“{fila.obs.nota}”</span>}
          </div>
        )}
      </div>

      <div className="of-tabs">
        {(['ficha', 'digital', 'historico', 'conciliacion'] as Pestana[]).map((p) => (
          <button key={p} className={pestana === p ? 'on' : ''} onClick={() => setPestana(p)} disabled={p === 'digital' && fila.vacio}>
            {{ ficha: 'Ficha', digital: 'Digital', historico: 'Histórico', conciliacion: `Conciliación${vinculos.length ? ` (${vinculos.length})` : ''}` }[p]}
          </button>
        ))}
      </div>

      <fieldset className="of-panel-cuerpo scroll-fino" disabled={bloqueado} style={{ border: 0, margin: 0, minWidth: 0 }}>
        {pestana === 'ficha' && (
          <div className="col" style={{ gap: 14 }}>
            {neg ? (
              <>
                <div className="campo">
                  <label>Nombre comercial</label>
                  <CampoConfirmado etiqueta="Nombre comercial" valor={neg.nombre} onGuardar={(v) => aplicar((d) => editarNegocio(d, campana.id, neg.id, { nombre: v }, alcance), 'Nombre comercial')} />
                </div>
                <div className="grid2">
                  <div className="campo">
                    <label>Cadena / franquicia</label>
                    <CampoConfirmado etiqueta="Cadena o franquicia" valor={neg.cadena ?? ''} placeholder="Independiente" onGuardar={(v) => aplicar((d) => editarNegocio(d, campana.id, neg.id, { cadena: v.trim() || undefined }, alcance), 'Cadena / franquicia')} />
                  </div>
                  <div className="campo">
                    <label>Descripción</label>
                    <CampoConfirmado etiqueta="Descripción" valor={neg.descripcion ?? ''} onGuardar={(v) => aplicar((d) => editarNegocio(d, campana.id, neg.id, { descripcion: v.trim() || undefined }, alcance), 'Descripción')} />
                  </div>
                </div>
                <div>
                  <div className="rotulo" style={{ marginBottom: 8 }}>Clasificación (4 niveles)</div>
                  <SelectorActividad key={fila.localId} valor={cla?.actividadId} onCambio={(id) => aplicar((d) => asignarActividad(d, campana.id, [fila], id, prefs.personaId, alcance), 'Actividad asignada · categorización revisada')} />
                  {cla && !cla.confirmada && (
                    <div className="fila" style={{ marginTop: 6 }}>
                      <span className="chip aviso">{cla.origen === 'heredado' ? 'Copiada de una campaña anterior' : 'Importada'} · sin confirmar</span>
                      <button className="btn s" onClick={() => aplicar((d) => asignarActividad(d, campana.id, [fila], cla.actividadId, prefs.personaId, alcance), 'Clasificación confirmada')}>Confirmar</button>
                    </div>
                  )}
                  {!cla && claAnt && (
                    <div className="fila" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                      <span className="muted" style={{ fontSize: 12 }}>En {db.campanas[claAnt.campanaId]?.anio}: {rutaActividad(claAnt.actividadId).at(-1)?.nombre} (mismo negocio)</span>
                      <button className="btn s" onClick={() => aplicar((d) => partirDeClasificacionAnterior(d, neg.id, campana.id, prefs.personaId, { alcance }), 'Clasificación anterior copiada como borrador')}>Partir de {db.campanas[claAnt.campanaId]?.anio}</button>
                    </div>
                  )}
                  {antes && antes.id !== neg.id && <p className="muted" style={{ fontSize: 12 }}>En {db.campanas[ref!]?.anio} el local lo ocupaba otro negocio ({antes.nombre}): no se hereda su clasificación.</p>}
                </div>
              </>
            ) : (
              <div className="t-info" style={{ margin: 0 }}>
                Local vacío{fila.metros ? ` · ${fila.metros} m de fachada` : ''}. {ocAntes?.negocioId ? `En ${db.campanas[ref!]?.anio} estaba ocupado por ${db.negocios[ocAntes.negocioId]?.nombre}.` : ''}
              </div>
            )}
            <label className="fila" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={!!r.pendienteComprobacion} onChange={(e) => aplicar((d) => actualizarRevisiones(d, campana.id, [fila.localId], { pendienteComprobacion: e.target.checked }, alcance), e.target.checked ? 'Pendiente de comprobación' : 'Comprobado')} />
              Pendiente de comprobación
            </label>
            {fila.errores.length > 0 && <div className="t-info error" style={{ margin: 0 }}>Errores: {fila.errores.join(' · ')}</div>}
            <button className="btn s fantasma" style={{ alignSelf: 'flex-start' }} onClick={() => ficha.abrir(fila.localId)}><ExternalLink size={13} /> Abrir ficha completa del local</button>
          </div>
        )}
        {pestana === 'digital' && neg && <Digital negocioId={neg.id} />}
        {pestana === 'historico' && <Historico db={db} localId={fila.localId} />}
        {pestana === 'conciliacion' && (
          <div className="col">
            {vinculos.length === 0 && <p className="muted">No hay correspondencias pendientes para este local.</p>}
            {vinculos.map((v) => (
              <div key={v.id} className="of-concilia">
                <div className="fila"><GitMerge size={15} /><b>¿Es el mismo espacio físico?</b><span className="chip dudoso">{v.confianza}</span></div>
                <p className="muted" style={{ margin: '4px 0 8px', fontSize: 12.5 }}>{v.criterio}. El sistema solo propone; la decisión es humana.</p>
                {(v.candidatos ?? []).map((c) => {
                  const lc = db.locales[c.localId];
                  if (!lc) return null;
                  const nAnt = ref ? negocioEn(db, c.localId, ref) : null;
                  return (
                    <div key={c.localId} className="of-comparar">
                      <div>
                        <div className="rotulo sin-linea">{db.campanas[ref ?? '']?.anio ?? 'Anterior'}</div>
                        <b>{nAnt?.nombre ?? 'Vacío'}</b>
                        <div className="muted">{textoDireccion(db, lc)}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>Estado: {lc.estado}</div>
                      </div>
                      <div>
                        <div className="rotulo sin-linea">{campana.anio} (campo)</div>
                        <b>{fila.vacio ? 'Vacío' : fila.nombre}</b>
                        <div className="muted">{textoDireccion(db, l)}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>Coincidencia {Math.round(c.puntuacion * 100)} %: {c.motivo}</div>
                      </div>
                      <div className="of-decision">
                        <button className="btn s" onClick={() => aplicar((d) => resolverVinculo(d, v.id, { tipo: 'mismo-local', localAnteriorId: c.localId }, prefs.personaId, alcance), 'Vinculado: mismo local físico (histórico unificado)')}>Mismo local</button>
                      </div>
                    </div>
                  );
                })}
                <div className="fila" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                  <button className="btn s" onClick={() => aplicar((d) => resolverVinculo(d, v.id, { tipo: 'distintos' }, prefs.personaId, alcance), 'Confirmado como local distinto')}>Son locales distintos</button>
                  <button className="btn s fantasma" onClick={() => aplicar((d) => resolverVinculo(d, v.id, { tipo: 'indeterminado' }, prefs.personaId, alcance), 'Queda indeterminado')}>Dejar indeterminado</button>
                </div>
              </div>
            ))}
            {(fila.obs?.tipo === 'posible-desaparicion' || fila.obs?.tipo === 'dudoso') && (
              <div className="t-info aviso" style={{ margin: 0 }}>
                Marcado en campo como «{TIPO_OBS_TXT[fila.obs.tipo]}». No se contabiliza como cierre hasta que se confirme.
                <button className="btn s" style={{ marginLeft: 'auto' }} onClick={() => aplicar((d) => actualizarRevisiones(d, campana.id, [fila.localId], { pendienteComprobacion: false }, alcance), 'Comprobación registrada')}>Comprobado</button>
              </div>
            )}
          </div>
        )}
      </fieldset>

      <div className="of-panel-pie">
        <button className="btn" onClick={accionDevolver} disabled={bloqueado}><Undo2 size={14} /> Devolver</button>
        <span className="esp" />
        {motivo && <span className="muted" style={{ fontSize: 11.5 }} title="Requisitos para aprobar">Falta: {motivo}</span>}
        <button className="btn primario" onClick={accionAprobar} disabled={!!motivo || bloqueado}><CheckCheck size={14} /> Aprobar</button>
      </div>
      {devolviendo && <ModalDevolverUno onCerrar={() => setDevolviendo(false)} onAplicar={(m) => { aplicar((d) => devolver(d, campana.id, [fila.localId], m, alcance), 'Registro devuelto para corrección'); setDevolviendo(false); }} />}
    </aside>
  );
}

function Estado({ t, ok, na, error, onClick }: { t: string; ok: boolean; na?: boolean; error?: boolean; onClick?: () => void }) {
  return (
    <button className={`of-e4 ${ok ? 'ok' : ''} ${error ? 'error' : ''}`} onClick={onClick} disabled={!onClick} title={onClick ? 'Pulsa para cambiar' : undefined}>
      <span className="of-e4-t"><i />{t}</span>
      <small>{na ? 'no aplica' : error ? 'devuelto' : ok ? (t === 'Campo' ? 'terminado' : t === 'Validación' ? 'aprobada' : 'revisado') : 'pendiente'}</small>
    </button>
  );
}

const OPCIONES: { r: Respuesta; t: string; tecla: string }[] = [
  { r: 'si', t: 'Sí', tecla: '1' },
  { r: 'no', t: 'No', tecla: '0' },
  { r: 'na', t: 'N/A', tecla: 'N' },
  { r: 'sin-info', t: '¿?', tecla: '?' },
  { r: 'pendiente', t: '·', tecla: 'Supr' },
];

/** Valor numérico que se guarda al confirmar (Enter o salir), no en cada pulsación. */
function NumeroConfirmado({ valor, onGuardar, etiqueta }: { valor?: number; onGuardar: (v: number | undefined) => void; etiqueta: string }) {
  const [t, setT] = useState(valor === undefined ? '' : String(valor));
  useEffect(() => setT(valor === undefined ? '' : String(valor)), [valor]);
  const guardar = () => {
    const x = t.trim().replace(',', '.');
    if (x === '' && valor !== undefined) onGuardar(undefined);
    else if (x !== '' && Number.isFinite(+x) && +x !== valor) onGuardar(+x);
  };
  return (
    <input className="input of-mini" style={{ width: 80 }} inputMode="decimal" aria-label={etiqueta} value={t} placeholder="valor"
      onChange={(e) => setT(e.target.value)} onBlur={guardar} onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setT(valor === undefined ? '' : String(valor)); }} />
  );
}

function ModalDevolverUno({ onCerrar, onAplicar }: { onCerrar: () => void; onAplicar: (m: string) => void }) {
  const [m, setM] = useState('');
  return (
    <Modal titulo="Devolver para corrección" onCerrar={onCerrar} pie={<><button className="btn" onClick={onCerrar}>Cancelar</button><button className="btn primario" disabled={!m.trim()} onClick={() => onAplicar(m.trim())}>Devolver</button></>}>
      <textarea className="input" aria-label="Motivo de la devolución" value={m} onChange={(e) => setM(e.target.value)} autoFocus />
    </Modal>
  );
}

function Digital({ negocioId }: { negocioId: string }) {
  const { db, campana, prefs } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const alcance = useCtxOficina()?.alcance;
  const rev = revisionDigitalEn(db, negocioId, campana!.id);
  const ant = revisionDigitalAnterior(db, negocioId, campana!.id);
  const estado = estadoDigital(db, negocioId, campana!.id);
  const problemas = problemasDigitales(rev);
  const registrar = (v: VariableDigital, respuesta: Respuesta, valor?: number) =>
    aplicar((d) => registrarDatoDigital(d, negocioId, campana!.id, v, { respuesta, valor }, prefs.personaId, { alcance }), 'Dato digital');
  const neg = db.negocios[negocioId];
  const ESTADO_TXT = { 'sin-datos': 'Sin datos', 'solo-historico': 'Solo datos históricos', borrador: `Borrador ${campana!.anio}`, verificada: 'Verificada' } as const;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="fila" style={{ flexWrap: 'wrap' }}>
        <span className={`chip ${estado === 'verificada' ? 'ok' : estado === 'borrador' ? 'aviso' : ''}`}>
          {estado === 'verificada' ? <ShieldCheck size={12} /> : null} {ESTADO_TXT[estado]}
          {estado === 'verificada' && rev?.verificadaEn ? ` · ${db.personas[rev.verificadaPor ?? '']?.nombre ?? ''} ${fmtFecha(rev.verificadaEn)}` : ''}
        </span>
        <span className="esp" />
        {ant && (
          <button className="btn s" onClick={() => aplicar((d) => partirDeDigitalAnterior(d, negocioId, campana!.id, prefs.personaId, { alcance }), `Copiado de ${db.campanas[ant.campanaId]?.anio} como borrador sin verificar`)}>
            <Copy size={13} /> Partir de {db.campanas[ant.campanaId]?.anio}
          </button>
        )}
        <button
          className="btn s primario"
          disabled={!rev || problemas.length > 0 || estado === 'verificada'}
          title={problemas.map((p) => p.mensaje).join('\n') || undefined}
          onClick={() => aplicar((d) => verificarDigital(d, negocioId, campana!.id, prefs.personaId, { alcance }), `Presencia digital verificada en ${campana!.anio}`)}
        >
          <ShieldCheck size={13} /> Verificar
        </button>
      </div>
      {!ant && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{neg?.procedencia === 'manual' ? 'Negocio nuevo: no hereda perfiles del negocio que ocupaba antes el local.' : 'Sin revisiones anteriores de este negocio.'}</p>}
      {problemas.length > 0 && rev && (
        <div className="t-info aviso" style={{ margin: 0, flexDirection: 'column', gap: 2 }}>
          {problemas.slice(0, 6).map((p) => <span key={p.variable + p.tipo}>{p.tipo === 'contradiccion' ? '⚠ ' : '· '}{p.mensaje}</span>)}
          {problemas.length > 6 && <span>… y {problemas.length - 6} más</span>}
        </div>
      )}
      <table className="tabla of-digital">
        <thead>
          <tr><th>Variable</th><th>{campana!.anio}</th>{ant && <th title="Solo referencia: no cuenta como verificado en esta campaña">{db.campanas[ant.campanaId]?.anio} <span className="muted">(ref.)</span></th>}</tr>
        </thead>
        <tbody>
          {VARIABLES_DIGITALES.map((def) => {
            const d = rev?.datos[def.id];
            const exigible = esExigible(rev, def.id);
            const r = d?.respuesta ?? 'pendiente';
            const da = ant?.datos[def.id];
            return (
              <tr key={def.id} className={!exigible ? 'of-dig-opcional' : ''}>
                <td className="muted">
                  {def.etiqueta}
                  {exigible && r === 'pendiente' && <span className="of-req" title="Obligatoria con las respuestas actuales">•</span>}
                  {d?.origen === 'heredado' && <span className="tag naranja" title="Copiado de otra campaña: confírmalo">heredado</span>}
                </td>
                <td>
                  <div className="of-resp">
                    {def.tipo === 'numero' && (
                      <NumeroConfirmado
                        etiqueta={def.etiqueta}
                        valor={d?.valor}
                        onGuardar={(v) => (v === undefined ? registrar(def.id, 'pendiente') : registrar(def.id, 'si', v))}
                      />
                    )}
                    {OPCIONES.filter((o) => (def.tipo === 'numero' ? o.r !== 'si' && o.r !== 'no' : true)).filter((o) => o.r !== 'na' || def.admiteNa || def.depende).map((o) => (
                      <button key={o.r} className={`of-r ${r === o.r ? 'on r-' + o.r : ''}`} title={`${o.t === '·' ? 'Pendiente' : o.t} (${o.tecla})`} onClick={() => registrar(def.id, o.r)}>
                        {o.t}
                      </button>
                    ))}
                  </div>
                </td>
                {ant && <td className="of-ref">{da ? (da.valor !== undefined ? String(da.valor) : RESPUESTA_TXT[da.respuesta]) : '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>«·» = pendiente (no equivale a «No»). N/A = no aplicable · ¿? = sin información disponible. Cambiar un dato tras verificar reabre la revisión.</p>
    </div>
  );
}
