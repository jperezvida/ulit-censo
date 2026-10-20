import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, Clock, Copy, ExternalLink, GitMerge, Lock, Maximize2, Minimize2, ShieldCheck, SkipForward, Undo2, X } from 'lucide-react';
import { useContexto, useFichaLocal } from '../../store/contexto';
import { useStore } from '../../store/store';
import { actualizarRevisiones, aprobar, asignarActividad, devolver, editarNegocio, esDudosa, motivoNoAprobable, type FilaOficina } from '../../domain/oficina';
import { useCtxOficina } from './contextoOficina';
import { parseNumeroDigital } from './tabla/columnas';
import { clasificacionAnterior, clasificacionEn, partirDeClasificacionAnterior } from '../../domain/clasificacion';
import { DEF_VARIABLE, GRUPOS_DIGITALES, VARIABLES_ADICIONALES, esExigible, estadoDigital, numeroRedes, partirDeDigitalAnterior, problemasDigitales, registrarDatoDigital, revisionDigitalAnterior, revisionDigitalEn, verificarDigital } from '../../domain/digital';
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

/**
 * Guarda lo pendiente cuando el campo desaparece (cambio de ficha, ampliar o reducir) para que
 * no se pierda lo tecleado aunque no se haya pulsado Enter ni salido del campo.
 */
function useGuardarAlDesmontar(guardar: () => void) {
  const ref = useRef(guardar);
  ref.current = guardar;
  useEffect(() => () => ref.current(), []);
}

/** Campo de texto que guarda al confirmar (Enter o salir del campo), no en cada pulsación. */
export function CampoConfirmado({ valor, onGuardar, placeholder, etiqueta, disabled }: { valor: string; onGuardar: (v: string) => void; placeholder?: string; etiqueta: string; disabled?: boolean }) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  const guardar = () => {
    if (v !== valor && !disabled) onGuardar(v);
  };
  useGuardarAlDesmontar(guardar);
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

export function PanelRevision({
  fila, onCerrar, onAnterior, onSiguiente, onSiguientePendiente, onAprobar, onDevolver, posicion, variante = 'panel', pestanaInicial,
  pestana: pestanaControlada, onPestana, ampliada = false, onAmpliar, onCronologia,
}: {
  fila: FilaOficina;
  onCerrar: () => void;
  onAnterior: () => void;
  onSiguiente: () => void;
  /** Ir al siguiente establecimiento con tareas pendientes (sin cerrar la ficha). */
  onSiguientePendiente?: () => void;
  onAprobar?: () => void;
  onDevolver?: () => void;
  posicion: string;
  variante?: 'panel' | 'pagina';
  pestanaInicial?: Pestana;
  /** Pestaña controlada desde fuera (se conserva al ampliar, reducir o cambiar de ficha). */
  pestana?: Pestana;
  onPestana?: (p: Pestana) => void;
  ampliada?: boolean;
  onAmpliar?: (v: boolean) => void;
  onCronologia?: () => void;
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
  const [pestanaLocal, setPestanaLocal] = useState<Pestana>(pestanaInicial ?? (esDudosa(fila) && vinculos.length ? 'conciliacion' : 'ficha'));
  const pestanaPedida = pestanaControlada ?? pestanaLocal;
  // Un local vacío no tiene presencia digital: se muestra la ficha.
  const pestana: Pestana = pestanaPedida === 'digital' && fila.vacio ? 'ficha' : pestanaPedida;
  const setPestana = (p: Pestana) => {
    setPestanaLocal(p);
    onPestana?.(p);
  };
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
  const accionAprobar = onAprobar ?? (() => aplicar((d) => aprobar(d, campana.id, [fila], alcance).db, `Registro aprobado · ${fila.vacio ? 'local vacío' : fila.nombre}`));
  const accionDevolver = onDevolver ?? (() => setDevolviendo(true));
  const nombre = fila.vacio ? 'Local vacío' : fila.nombre;
  const direccion = textoDireccion(db, l);

  return (
    <aside
      className={`of-panel ofp ${variante === 'pagina' ? 'of-panel-pagina' : ''} ${ampliada ? 'ofp-ampliada' : ''}`}
      aria-label="Revisión del registro"
      onKeyDown={(e) => {
        if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); onSiguiente(); }
        else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); onAnterior(); }
        else if (e.altKey && (e.key === 'p' || e.key === 'P') && onSiguientePendiente) { e.preventDefault(); onSiguientePendiente(); }
        else if (e.key === 'Escape' && ampliada && onAmpliar && !(e.target as HTMLElement).closest('input, textarea, select')) { e.preventDefault(); onAmpliar(false); }
      }}
    >
      <header className="ofp-cab">
        <div className="ofp-fila1">
          <h3 className="ofp-titulo" title={nombre}>{nombre}</h3>
          <span className="esp" />
          {onAmpliar && (
            <button className="btn s ofp-ampliar" onClick={() => onAmpliar(!ampliada)} title={ampliada ? 'Volver a la tabla con la ficha lateral (Esc)' : 'Ficha en el área central, más ancha'}>
              {ampliada ? <><Minimize2 size={13} /> Reducir ficha</> : <><Maximize2 size={13} /> Ampliar ficha</>}
            </button>
          )}
          <button className="btn s fantasma icono" onClick={onCerrar} aria-label="Cerrar ficha"><X size={15} /></button>
        </div>
        <div className="ofp-fila2">
            <span className="ofp-estados" role="group" aria-label="Estados del registro">
            <Indicador t="Campo" e={r.campo === 'terminado' ? 'ok' : 'pend'} detalle={r.campo === 'terminado' ? 'terminado' : 'pendiente'} />
            <Indicador t="Categoría" e={fila.vacio ? 'na' : r.categorizacion === 'revisado' ? 'ok' : 'pend'} detalle={fila.vacio ? 'no aplica' : r.categorizacion} onClick={fila.vacio ? undefined : () => setPestana('ficha')} />
            <Indicador t="Digital" e={fila.vacio ? 'na' : r.digital === 'revisado' ? 'ok' : 'pend'} detalle={fila.vacio ? 'no aplica' : r.digital} onClick={fila.vacio ? undefined : () => setPestana('digital')} />
            <Indicador t="Revisión" e={r.validacion === 'aprobada' ? 'ok' : r.validacion === 'devuelta' ? 'error' : 'pend'} detalle={r.validacion === 'aprobada' ? 'aprobada' : r.validacion === 'devuelta' ? 'devuelta' : 'pendiente'} />
          </span>
          <span className="ofp-dir" title={direccion}>{direccion}{fila.itinerario ? ` · ${fila.itinerario}` : ''}</span>
          {fila.obs && (
            <span className="ofp-obs" title={fila.obs.nota ? `“${fila.obs.nota}”` : undefined}>
              <span className={`of-obs t-${fila.obs.tipo}`}>{TIPO_OBS_TXT[fila.obs.tipo]}</span>
              {fmtFecha(fila.obs.fecha)} · {fila.obs.fuente === 'campo-app' ? 'app' : fila.obs.fuente}{fila.obs.investigadorId ? ` · ${db.personas[fila.obs.investigadorId]?.nombre ?? ''}` : ''}{fila.obs.nota ? ' · 💬' : ''}
            </span>
          )}
          {r.validacion === 'devuelta' && <span className="chip error" title={r.motivoDevolucion}>Devuelto: {r.motivoDevolucion}</span>}
          {fila.situacion === 'pendiente-visita' && <span className="chip" title={`Se muestran los datos de ${db.campanas[ref ?? '']?.anio ?? 'referencia'}`}>Pendiente de visita</span>}
          {bloqueado && <span className="chip aviso"><Lock size={11} /> Solo lectura</span>}
          {fila.cronologiaIncierta.length > 0 && onCronologia && <button className="chip dudoso ofp-chip-btn" onClick={onCronologia}><Clock size={11} /> Cronología incierta · asignar fechas</button>}
        </div>
      </header>

      <div className="of-tabs ofp-tabs" role="tablist" aria-label="Secciones de la ficha">
        {(['ficha', 'digital', 'historico', 'conciliacion'] as Pestana[]).map((p) => (
          <button key={p} role="tab" aria-selected={pestana === p} className={pestana === p ? 'on' : ''} onClick={() => setPestana(p)} disabled={p === 'digital' && fila.vacio}>
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
        {pestana === 'digital' && neg && <Digital negocioId={neg.id} nombre={neg.nombre} direccion={direccion} bloqueado={bloqueado} />}
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

      <footer className="ofp-pie">
        <div className="ofp-nav" role="group" aria-label="Navegación entre establecimientos">
          <button className="btn s icono" onClick={onAnterior} aria-label="Establecimiento anterior" title="Anterior (Alt+↑)"><ArrowUp size={14} /></button>
          <button className="btn s icono" onClick={onSiguiente} aria-label="Establecimiento siguiente" title="Siguiente (Alt+↓)"><ArrowDown size={14} /></button>
          {onSiguientePendiente && <button className="btn s" onClick={onSiguientePendiente} title="Siguiente con tareas pendientes (Alt+P)"><SkipForward size={13} /> Siguiente pendiente</button>}
          {posicion && <span className="muted mono ofp-pos">{posicion}</span>}
        </div>
        <span className="esp" />
        {motivo && <span className="muted ofp-falta" title={`Para aprobar el registro falta: ${motivo}`}>Falta: {motivo}</span>}
        <button className="btn s" onClick={accionDevolver} disabled={bloqueado}><Undo2 size={13} /> Devolver</button>
        <button
          className="btn s primario"
          onClick={accionAprobar}
          disabled={!!motivo || bloqueado}
          aria-label={`Aprobar registro (revisión general) de ${nombre}`}
          title="Revisión general del registro: campo, categorización y presencia digital"
        >
          <CheckCheck size={13} /> Aprobar registro
        </button>
      </footer>
      {devolviendo && <ModalDevolverUno onCerrar={() => setDevolviendo(false)} onAplicar={(m) => { aplicar((d) => devolver(d, campana.id, [fila.localId], m, alcance), 'Registro devuelto para corrección'); setDevolviendo(false); }} />}
    </aside>
  );
}

function Indicador({ t, e, detalle, onClick }: { t: string; e: 'ok' | 'pend' | 'na' | 'error'; detalle: string; onClick?: () => void }) {
  const contenido = (
    <>
      <i aria-hidden />
      {t}
    </>
  );
  const etiqueta = `${t}: ${detalle}`;
  return onClick ? (
    <button className={`ofp-ind ${e}`} onClick={onClick} title={`${etiqueta} · abrir`} aria-label={etiqueta}>{contenido}</button>
  ) : (
    <span className={`ofp-ind ${e}`} title={etiqueta} aria-label={etiqueta} role="img">{contenido}</span>
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
  const txt = (x?: number) => (x === undefined ? '' : String(x).replace('.', ','));
  const [t, setT] = useState(txt(valor));
  useEffect(() => setT(txt(valor)), [valor]);
  // Mismo intérprete que la tabla: «1.250» = 1250 (miles), «4,5» = 4,5 (decimales).
  const guardar = () => {
    let r: ReturnType<typeof parseNumeroDigital>;
    try {
      r = parseNumeroDigital(t);
    } catch {
      return; // texto no numérico: no se guarda nada
    }
    if (r.respuesta === 'pendiente' && valor !== undefined) onGuardar(undefined);
    else if (r.respuesta === 'si' && r.valor !== valor) onGuardar(r.valor);
  };
  useGuardarAlDesmontar(guardar);
  return (
    <input className="input of-mini ofp-num" inputMode="decimal" aria-label={etiqueta} value={t} placeholder="valor"
      onChange={(e) => setT(e.target.value)} onBlur={guardar} onKeyDown={(e) => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setT(txt(valor)); }} />
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

function Digital({ negocioId, nombre, direccion, bloqueado }: { negocioId: string; nombre: string; direccion: string; bloqueado: boolean }) {
  const { db, campana, prefs } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const alcance = useCtxOficina()?.alcance;
  const rev = revisionDigitalEn(db, negocioId, campana!.id);
  const ant = revisionDigitalAnterior(db, negocioId, campana!.id);
  const estado = estadoDigital(db, negocioId, campana!.id);
  const problemas = problemasDigitales(rev);
  const registrar = (v: VariableDigital, respuesta: Respuesta, valor?: number) =>
    aplicar((d) => registrarDatoDigital(d, negocioId, campana!.id, v, { respuesta, valor }, prefs.personaId, { alcance }), `${DEF_VARIABLE[v].etiqueta} · ${nombre}`, { silencioso: true });
  const neg = db.negocios[negocioId];
  const ESTADO_TXT = { 'sin-datos': 'Sin datos', 'solo-historico': 'Solo datos históricos', borrador: `Borrador ${campana!.anio}`, verificada: 'Verificada' } as const;
  const anioAnt = ant ? db.campanas[ant.campanaId]?.anio : undefined;
  const redes = numeroRedes(rev);
  return (
    <div className="ofp-dig">
      <div className="ofp-dig-barra">
        <span className={`chip ${estado === 'verificada' ? 'ok' : estado === 'borrador' ? 'aviso' : ''}`}>
          {estado === 'verificada' ? <ShieldCheck size={12} /> : null} {ESTADO_TXT[estado]}
          {estado === 'verificada' && rev?.verificadaEn ? ` · ${db.personas[rev.verificadaPor ?? '']?.nombre ?? ''} ${fmtFecha(rev.verificadaEn)}` : ''}
        </span>
        {ant && (
          <button className="btn s" onClick={() => aplicar((d) => partirDeDigitalAnterior(d, negocioId, campana!.id, prefs.personaId, { alcance }), `Copiado de ${anioAnt} como borrador sin verificar`)}>
            <Copy size={13} /> Partir de {anioAnt}
          </button>
        )}
        <span className="esp" />
        <button
          className="btn s ofp-verificar"
          disabled={bloqueado || !rev || problemas.length > 0 || estado === 'verificada'}
          title={problemas.length ? problemas.map((p) => p.mensaje).join('\n') : `Verifica solo la presencia digital de ${nombre} (${direccion})`}
          aria-label={`Verificar presencia digital de ${nombre}`}
          onClick={() => aplicar((d) => verificarDigital(d, negocioId, campana!.id, prefs.personaId, { alcance }), `Presencia digital verificada · ${nombre}`)}
        >
          <ShieldCheck size={13} /> Verificar presencia digital · <b className="ofp-verificar-nombre">{nombre}</b>
        </button>
      </div>
      {problemas.length > 0 && rev && (
        <details className="ofp-problemas">
          <summary>{problemas.length} pendiente(s) o incoherencia(s) para verificar · {problemas[0].mensaje}</summary>
          <ul>{problemas.map((p) => <li key={p.variable + p.tipo}>{p.tipo === 'contradiccion' ? '⚠ ' : ''}{p.mensaje}</li>)}</ul>
        </details>
      )}
      {!ant && <p className="muted ofp-nota">{neg?.procedencia === 'manual' ? 'Negocio nuevo: no hereda perfiles del negocio que ocupaba antes el local.' : 'Sin revisiones anteriores de este negocio.'}</p>}
      <div className="ofp-dig-grupos">
        {GRUPOS_DIGITALES.map((g) => (
          <section key={g.titulo} className="ofp-grupo" aria-label={g.titulo}>
            <h4>{g.titulo}{anioAnt && <span className="muted"> · ref. {anioAnt}</span>}</h4>
            {g.variables.map((v) => <FilaVariable key={v} v={v} rev={rev} ant={ant} registrar={registrar} />)}
            {g.titulo === 'Redes sociales' && (
              <div className="ofp-var ofp-calc" title="Calculado: Instagram + Facebook + Twitter (procedimiento 2026)">
                <span className="ofp-var-t">Nº redes</span>
                <span className="ofp-var-c" aria-label={redes === null ? 'Nº redes sin determinar' : `Nº redes: ${redes}`}><b>{redes ?? '—'}</b> <span className="muted">{redes === null ? 'sin determinar: falta Sí/No en alguna red' : 'calculado'}</span></span>
                <span />
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="muted ofp-nota">«·» = pendiente (no equivale a «No») · N/A = no aplicable · ¿? = sin información. Cambiar un dato tras verificar reabre la revisión.</p>
    </div>
  );
}

function FilaVariable({ v, rev, ant, registrar }: {
  v: VariableDigital;
  rev: ReturnType<typeof revisionDigitalEn>;
  ant: ReturnType<typeof revisionDigitalAnterior>;
  registrar: (v: VariableDigital, r: Respuesta, valor?: number) => void;
}) {
  const def = DEF_VARIABLE[v];
  const d = rev?.datos[v];
  const exigible = esExigible(rev, v);
  const r = d?.respuesta ?? 'pendiente';
  const da = ant?.datos[v];
  const opciones = OPCIONES.filter((o) => (def.tipo === 'numero' ? o.r !== 'si' && o.r !== 'no' : true)).filter((o) => o.r !== 'na' || def.admiteNa || def.depende);
  return (
    <div className={`ofp-var ${!exigible ? 'opcional' : ''} ${def.depende ? 'dependiente' : ''}`}>
      <span className="ofp-var-t" title={!exigible ? 'No se exige con las respuestas actuales' : undefined}>
        {def.etiqueta}
        {VARIABLES_ADICIONALES.includes(v) && <span className="tag" title="Campo adicional: no figura en el procedimiento 2026 ni bloquea la verificación">opcional</span>}
        {exigible && (r === 'pendiente' || (def.exigeSiNo && r !== 'si' && r !== 'no')) && <span className="of-req" title={def.exigeSiNo ? 'Hay que registrar Sí o No' : 'Obligatoria con las respuestas actuales'}>•</span>}
        {d?.origen === 'heredado' && <span className="tag naranja" title="Copiado de otra campaña: confírmalo">heredado</span>}
      </span>
      <span className="ofp-var-c of-resp" role="group" aria-label={def.etiqueta}>
        {def.tipo === 'numero' && <NumeroConfirmado etiqueta={`${def.etiqueta} (valor)`} valor={d?.valor} onGuardar={(x) => (x === undefined ? registrar(v, 'pendiente') : registrar(v, 'si', x))} />}
        {opciones.map((o) => (
          <button key={o.r} className={`of-r ${r === o.r ? 'on r-' + o.r : ''}`} aria-pressed={r === o.r} aria-label={`${def.etiqueta}: ${o.t === '·' ? 'pendiente' : o.t}`} title={`${o.t === '·' ? 'Pendiente' : o.t}`} onClick={() => registrar(v, o.r)}>
            {o.t}
          </button>
        ))}
      </span>
      <span className="ofp-var-ref" title={ant ? 'Solo referencia: no cuenta como verificado en esta campaña' : undefined}>
        {ant ? (da ? (da.valor !== undefined ? da.valor.toLocaleString('es-ES') : RESPUESTA_TXT[da.respuesta]) : '—') : ''}
      </span>
    </div>
  );
}
