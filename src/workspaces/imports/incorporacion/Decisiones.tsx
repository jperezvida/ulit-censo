import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Gavel, Undo2 } from 'lucide-react';
import { Segmentado, fmt } from '../../../components/ui';
import { planificarIncorporacion, type DecisionesIncorporacion, type PlanIncorporacion } from '../../../domain/incorporacion';
import {
  claveCombo, combinacionesHistoricas, MOTIVO_TXT, pendientesDeNodo, reglasPropuestas, textosDiccionario,
} from '../../../domain/incorporacionDemo';
import { mostrarOriginal, type ResultadoInterpretacion } from '../../../domain/xlsx/interpretacion';
import { DISCREPANCIAS_2026, EXCEPCIONES_ICM, ID_CATALOGO_2026 } from '../../../domain/catalogo2026';
import { rutaTexto } from '../../../domain/buscador';
import { textoDireccion } from '../../../domain/consultas';
import { BuscadorClasificacion, type Eleccion } from '../../office/BuscadorClasificacion';
import { ChipEstado } from './RevisionGrupos';
import { hoy } from './estadoAsistente';
import { useCtxIncorporacion } from './contextoIncorporacion';
import { ConciliacionCalles } from './ConciliacionCalles';
import { RevisionEnBloque } from './RevisionEnBloque';
import type { Id } from '../../../domain/types';

type Pestana = 'calles' | 'revision' | 'interpretaciones' | 'correspondencias' | 'exclusiones' | 'clasificacion' | 'catedra';

/** Formulario mínimo de una decisión: persona y fecha automáticas, motivo o referencia obligatorio. */
function Registrar({ etiqueta, ayuda, onRegistrar, deshabilitado }: { etiqueta: string; ayuda: string; onRegistrar: (motivo: string) => void; deshabilitado?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  if (deshabilitado) return <span className="muted dec-nota">{deshabilitado}</span>;
  if (!abierto) return <button className="btn s" onClick={() => setAbierto(true)}><Gavel size={14} /> {etiqueta}</button>;
  return (
    <div className="dec-form">
      <label className="campo">
        <span>{ayuda}</span>
        <textarea className="input" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label={ayuda} />
      </label>
      <div className="fila">
        <button className="btn s" onClick={() => setAbierto(false)}>Cancelar</button>
        <button className="btn s primario" disabled={!motivo.trim()} onClick={() => { onRegistrar(motivo.trim()); setAbierto(false); setMotivo(''); }}>Registrar</button>
      </div>
    </div>
  );
}

function Traza({ porId, fecha, motivo }: { porId: Id; fecha: string; motivo?: string }) {
  const { db } = useCtxIncorporacion();
  return <span className="muted dec-nota"><CheckCircle2 size={13} /> {db.personas[porId]?.nombre ?? porId} · {fecha}{motivo ? ` · «${motivo}»` : ''}</span>;
}

export function Decisiones({ resultado, plan, decisiones, onCambiar }: { resultado: ResultadoInterpretacion; plan: PlanIncorporacion; decisiones: DecisionesIncorporacion; onCambiar: (d: DecisionesIncorporacion) => void }) {
  const [tab, setTab] = useState<Pestana>('calles');
  const ctx = useCtxIncorporacion();
  const autorizado = ctx.autorizado;
  const firma = { porId: ctx.personaId, fecha: hoy() };
  const sinPermiso = autorizado ? undefined : 'Registrar decisiones requiere el rol de coordinación o administración.';
  const props = { resultado, plan, decisiones, onCambiar, firma, sinPermiso };
  return (
    <div className="col" style={{ gap: 12 }}>
      <Segmentado
        valor={tab}
        onCambio={setTab}
        opciones={[
          { v: 'calles', t: 'Calles' },
          { v: 'revision', t: 'Revisión en bloque' },
          { v: 'interpretaciones', t: 'Interpretaciones' },
          { v: 'correspondencias', t: 'Correspondencias' },
          { v: 'exclusiones', t: 'Exclusiones' },
          { v: 'clasificacion', t: 'Clasificación histórica' },
          { v: 'catedra', t: 'Pendiente de la Cátedra' },
        ]}
      />
      {tab === 'calles' && <ConciliacionCalles {...props} />}
      {tab === 'revision' && <RevisionEnBloque {...props} />}
      {tab === 'interpretaciones' && <Interpretaciones {...props} />}
      {tab === 'correspondencias' && <Correspondencias {...props} />}
      {tab === 'exclusiones' && <Exclusiones {...props} />}
      {tab === 'clasificacion' && <Clasificacion {...props} />}
      {tab === 'catedra' && <PendienteCatedra {...props} />}
    </div>
  );
}

interface Props {
  resultado: ResultadoInterpretacion;
  plan: PlanIncorporacion;
  decisiones: DecisionesIncorporacion;
  onCambiar: (d: DecisionesIncorporacion) => void;
  firma: { porId: Id; fecha: string };
  sinPermiso?: string;
}

function Tarjeta({ titulo, estado, children }: { titulo: ReactNode; estado: ReactNode; children: ReactNode }) {
  return (
    <section className="tarjeta dec-tarjeta">
      <div className="fila"><b className="esp">{titulo}</b>{estado}</div>
      {children}
    </section>
  );
}

function Interpretaciones({ resultado, decisiones, onCambiar, firma, sinPermiso }: Props) {
  const reglas = useMemo(() => reglasPropuestas(resultado), [resultado]);
  const textos = useMemo(() => textosDiccionario(resultado), [resultado]);
  const [ver, setVer] = useState<string | null>(null);
  return (
    <div className="col" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>
        Son reglas que la Cátedra debe aprobar. Cada una se autoriza <b>por separado</b>: autorizar una no autoriza ninguna otra. Mientras no se autorice, las celdas quedan sin interpretar y su valor original se conserva.
      </p>
      {!reglas.length && !textos.length && <div className="vacio-estado tarjeta">No hay interpretaciones pendientes en este archivo.</div>}
      {reglas.map((r) => {
        const a = decisiones.reglasAutorizadas?.find((x) => x.regla === r.regla);
        return (
          <Tarjeta key={r.regla} titulo={<>{r.descripcion} <code className="muted">{r.regla}</code></>} estado={<ChipEstado e={a ? 'resuelto' : 'catedra'} />}>
            <div className="fila" style={{ flexWrap: 'wrap' }}>
              <span className="muted">{fmt(r.celdas.length)} celda(s){r.decision ? ` · decisión pendiente ${r.decision}` : ''}</span>
              <button className="btn s fantasma" onClick={() => setVer(ver === r.regla ? null : r.regla)}>{ver === r.regla ? 'Ocultar filas' : 'Ver filas afectadas'}</button>
              <span className="esp" />
              {a ? (
                <>
                  <Traza {...a} />
                  <button className="btn s" onClick={() => onCambiar({ ...decisiones, reglasAutorizadas: decisiones.reglasAutorizadas!.filter((x) => x.regla !== r.regla) })}><Undo2 size={14} /> Retirar</button>
                </>
              ) : (
                <Registrar etiqueta="Registrar autorización de la Cátedra" ayuda="Referencia del acuerdo de la Cátedra (obligatoria)" deshabilitado={sinPermiso} onRegistrar={(motivo) => onCambiar({ ...decisiones, reglasAutorizadas: [...(decisiones.reglasAutorizadas ?? []), { regla: r.regla, ...firma, motivo }] })} />
              )}
            </div>
            {ver === r.regla && (
              <table className="tabla ap-tabla" aria-label={`Filas afectadas por ${r.regla}`}>
                <thead><tr><th>Fila</th><th>Columna</th><th>Original</th><th>{a ? 'Resultado' : 'Propuesta'}</th><th>Estado</th></tr></thead>
                <tbody>{r.celdas.map((c) => <tr key={`${c.fila}-${c.cabecera}`}><td className="mono">{c.fila}</td><td>{c.cabecera}</td><td className="mono">{c.original}</td><td>{c.propuesta}</td><td>{c.estado}</td></tr>)}</tbody>
              </table>
            )}
          </Tarjeta>
        );
      })}
      {textos.map((t) => {
        const a = decisiones.diccionarioAprobado?.find((x) => x.texto.toLowerCase() === t.texto.toLowerCase());
        return (
          <Tarjeta key={t.texto} titulo={<>Diccionario: «{t.texto}» como «sin información»</>} estado={<ChipEstado e={a ? 'resuelto' : 'catedra'} />}>
            <div className="fila" style={{ flexWrap: 'wrap' }}>
              <span className="muted">{t.celdas.map((c) => `fila ${c.fila} (${c.cabecera})`).join(' · ')} · decisión pendiente 1</span>
              <span className="esp" />
              {a ? (
                <>
                  <Traza {...a} />
                  <button className="btn s" onClick={() => onCambiar({ ...decisiones, diccionarioAprobado: decisiones.diccionarioAprobado!.filter((x) => x !== a) })}><Undo2 size={14} /> Retirar</button>
                </>
              ) : (
                <Registrar etiqueta="Registrar aprobación del texto" ayuda="Referencia del acuerdo de la Cátedra (obligatoria)" deshabilitado={sinPermiso} onRegistrar={(motivo) => onCambiar({ ...decisiones, diccionarioAprobado: [...(decisiones.diccionarioAprobado ?? []), { texto: t.texto, ...firma, motivo }] })} />
              )}
            </div>
          </Tarjeta>
        );
      })}
    </div>
  );
}

function Correspondencias({ resultado, decisiones, onCambiar, firma, sinPermiso }: Props) {
  const { db, destino } = useCtxIncorporacion();
  // Plan SIN correspondencias decididas: así se conocen los motivos originales de cada fila.
  const base = useMemo(() => planificarIncorporacion(db, resultado, destino, { ...decisiones, correspondencias: [] }), [db, resultado, destino, decisiones]);
  const porFila = useMemo(() => new Map(resultado.filas.map((f) => [f.fila, f])), [resultado]);
  const orig = useMemo(() => new Map(resultado.original.filas.map((f) => [f.fila, f.celdas])), [resultado]);
  const grupos = useMemo(() => {
    const m = new Map<string, typeof base.filas>();
    for (const f of base.filas) if (f.motivo) m.set(f.motivo, [...(m.get(f.motivo) ?? []), f]);
    return [...m.entries()].sort((a, b) => Number(MOTIVO_TXT[b[0]].decidible) - Number(MOTIVO_TXT[a[0]].decidible));
  }, [base]);
  const decidir = (fila: number, accion: { accion: 'local-nuevo' } | { accion: 'local-existente'; localId: Id } | null, motivo?: string) => {
    const resto = (decisiones.correspondencias ?? []).filter((c) => c.fila !== fila);
    onCambiar({ ...decisiones, correspondencias: accion ? [...resto, { fila, ...accion, ...firma, motivo }] : resto });
  };
  const dir = (fila: number) => {
    const c = orig.get(fila) ?? {};
    return `${c.direccion ? mostrarOriginal(c.direccion).replace(/[«»]/g, '') : '¿calle?'}, ${c.numero ? mostrarOriginal(c.numero).replace(/[«»]/g, '') : 'sin número'}`;
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>
        Una fila del Excel no es necesariamente un local físico. En los casos dudosos se muestran las alternativas, pero <b>no se elige ninguna automáticamente</b>. Lo que se deje pendiente se conserva sin vínculo para revisarlo después.
      </p>
      {grupos.map(([motivo, filas]) => {
        const m = MOTIVO_TXT[motivo];
        return (
          <section key={motivo} className="tarjeta dec-tarjeta" aria-label={m.titulo}>
            <div className="fila"><b className="esp">{m.titulo}</b><span className="chip">{fmt(filas.length)} fila(s)</span></div>
            <p className="muted" style={{ margin: '2px 0 6px' }}>{m.explicacion}</p>
            {m.decidible ? (
              <table className="tabla ap-tabla">
                <thead><tr><th>Fila</th><th>Dirección original</th><th>Negocio</th><th>Decisión</th></tr></thead>
                <tbody>
                  {filas.map((f) => {
                    const d = decisiones.correspondencias?.find((c) => c.fila === f.fila);
                    const negocio = porFila.get(f.fila)?.celdas.nombre?.valor;
                    return (
                      <tr key={f.fila}>
                        <td className="mono">{f.fila}</td>
                        <td>{dir(f.fila)}</td>
                        <td>{negocio !== undefined ? String(negocio) : <span className="muted">{f.local === 'vacio' ? 'local vacío' : '—'}</span>}</td>
                        <td>
                          {d ? (
                            <div className="col" style={{ gap: 2 }}>
                              <b>{d.accion === 'local-nuevo' ? 'Crear un local para esta fila' : `Es el local existente ${textoDireccion(db, db.locales[d.localId])}`}</b>
                              <div className="fila"><Traza {...d} /><button className="btn s" onClick={() => decidir(f.fila, null)}><Undo2 size={13} /> Dejar pendiente</button></div>
                            </div>
                          ) : (
                            <ElegirCorrespondencia fila={f.fila} candidatos={f.candidatos ?? []} sinPermiso={sinPermiso} onElegir={decidir} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="muted" style={{ margin: 0 }}>Filas: {filas.slice(0, 40).map((f) => f.fila).join(', ')}{filas.length > 40 ? '…' : ''}. Sin decisión posible en esta fase: quedan sin vínculo.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ElegirCorrespondencia({ fila, candidatos, sinPermiso, onElegir }: { fila: number; candidatos: Id[]; sinPermiso?: string; onElegir: (fila: number, a: { accion: 'local-nuevo' } | { accion: 'local-existente'; localId: Id }, motivo: string) => void }) {
  const { db } = useCtxIncorporacion();
  const [opcion, setOpcion] = useState('');
  const [motivo, setMotivo] = useState('');
  if (sinPermiso) return <span className="muted dec-nota">Pendiente · {sinPermiso}</span>;
  return (
    <div className="fila dec-elegir" style={{ flexWrap: 'wrap' }}>
      <select className="input" aria-label={`Correspondencia de la fila ${fila}`} value={opcion} onChange={(e) => setOpcion(e.target.value)}>
        <option value="">Dejar pendiente</option>
        <option value="nuevo">Crear un local para esta fila</option>
        {candidatos.map((c) => <option key={c} value={c}>Es el local existente {textoDireccion(db, db.locales[c])}</option>)}
      </select>
      {opcion && <input className="input" placeholder="Motivo (obligatorio)" aria-label={`Motivo de la fila ${fila}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
      {opcion && <button className="btn s primario" disabled={!motivo.trim()} onClick={() => onElegir(fila, opcion === 'nuevo' ? { accion: 'local-nuevo' } : { accion: 'local-existente', localId: opcion }, motivo.trim())}>Guardar</button>}
    </div>
  );
}

function Exclusiones({ resultado, decisiones, onCambiar, firma, sinPermiso }: Props) {
  const [otra, setOtra] = useState('');
  const filas = new Set(resultado.original.filas.map((f) => f.fila));
  const orig = new Map(resultado.original.filas.map((f) => [f.fila, f.celdas]));
  const candidatas = resultado.original.candidatasExcluir;
  const excluidas = decisiones.exclusiones ?? [];
  const excluir = (fila: number, motivo: string) => onCambiar({ ...decisiones, exclusiones: [...excluidas.filter((e) => e.fila !== fila), { fila, ...firma, motivo }] });
  const resumen = (fila: number) => resultado.original.columnas.slice(0, 7).map((c) => `${c.cabecera.trim()}: ${mostrarOriginal(orig.get(fila)?.[c.clave] ?? { t: 'vacio' })}`).join(' · ');
  const n = Number(otra);
  return (
    <div className="col" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>Una fila excluida no se incorpora al modelo, pero su registro original se conserva con el motivo, la persona y la fecha. Las posibles filas de totales las detecta una heurística: compruébelas antes de excluirlas.</p>
      {candidatas.map((c) => {
        const e = excluidas.find((x) => x.fila === c.fila);
        return (
          <Tarjeta key={c.fila} titulo={`Fila ${c.fila} · posible fila de totales`} estado={<ChipEstado e={e ? 'resuelto' : 'revisar'} />}>
            <p className="mono muted" style={{ margin: '4px 0', fontSize: 12 }}>{resumen(c.fila)}</p>
            <div className="fila">
              <span className="muted esp">{e ? 'Excluida de la incorporación.' : 'Si no se excluye, se incorporará como un registro más (con sus incidencias).'}</span>
              {e ? <><Traza {...e} /><button className="btn s" onClick={() => onCambiar({ ...decisiones, exclusiones: excluidas.filter((x) => x !== e) })}><Undo2 size={13} /> Mantener</button></> : <Registrar etiqueta="Excluir esta fila" ayuda="Motivo de la exclusión (obligatorio)" deshabilitado={sinPermiso} onRegistrar={(m) => excluir(c.fila, m)} />}
            </div>
          </Tarjeta>
        );
      })}
      <section className="tarjeta dec-tarjeta">
        <b>Excluir otra fila</b>
        <div className="fila" style={{ marginTop: 6 }}>
          <input className="input" style={{ maxWidth: 120 }} inputMode="numeric" placeholder="Nº de fila" aria-label="Número de fila a excluir" value={otra} onChange={(e) => setOtra(e.target.value.replace(/\D/g, ''))} />
          {otra && !filas.has(n) && <span className="muted">Esa fila no existe en el archivo.</span>}
          {filas.has(n) && !excluidas.some((x) => x.fila === n) && <Registrar etiqueta={`Excluir la fila ${n}`} ayuda="Motivo de la exclusión (obligatorio)" deshabilitado={sinPermiso} onRegistrar={(m) => { excluir(n, m); setOtra(''); }} />}
        </div>
        {excluidas.filter((e) => !candidatas.some((c) => c.fila === e.fila)).map((e) => (
          <div key={e.fila} className="fila" style={{ marginTop: 6 }}><span className="esp">Fila {e.fila} excluida</span><Traza {...e} /><button className="btn s" onClick={() => onCambiar({ ...decisiones, exclusiones: excluidas.filter((x) => x !== e) })}><Undo2 size={13} /> Retirar</button></div>
        ))}
      </section>
    </div>
  );
}

function Clasificacion({ resultado, decisiones, onCambiar, firma, sinPermiso }: Props) {
  const combos = useMemo(() => combinacionesHistoricas(resultado), [resultado]);
  const [editando, setEditando] = useState<string | null>(null);
  const [eleccion, setEleccion] = useState<Eleccion | null>(null);
  const [motivo, setMotivo] = useState('');
  const eqs = decisiones.equivalenciasClasificacion ?? [];
  const eqDe = (clave: string) => eqs.find((q) => claveCombo(q.grupo, q.grupoComercio, q.subgrupo, q.actividad) === clave);
  const bloqueos = eleccion ? pendientesDeNodo(eleccion.opcion.nodoId) : [];
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="t-info" style={{ margin: 0 }}>
        <div>
          <b>Conservar no es confirmar.</b> Las cinco columnas de 2025 se conservan siempre, literalmente, como texto histórico. Una equivalencia autorizada solo crea una <b>propuesta 2026 sin confirmar</b>; confirmar la clasificación 2026 se hace después, en Oficina. Nada se convierte automáticamente.
        </div>
      </div>
      <div className="dat-tabla scroll-fino" style={{ maxHeight: 460 }}>
        <table className="tabla ap-tabla" aria-label="Combinaciones históricas">
          <thead><tr><th>GrActividad</th><th>Gr Comercio</th><th>Subgrupo</th><th>Actividad</th><th className="num">Filas</th><th>Diagnóstico</th><th>Equivalencia 2026</th></tr></thead>
          <tbody>
            {combos.map((c) => {
              const q = eqDe(c.clave);
              return (
                <tr key={c.clave}>
                  <td>{c.grupo ?? '—'}</td><td>{c.grupoComercio ?? '—'}</td><td>{c.subgrupo ?? '—'}</td><td>{c.actividad ?? '—'}{c.conDescripcion ? <div className="muted">{c.conDescripcion} con descripción</div> : null}</td>
                  <td className="num">{fmt(c.filas.length)}</td>
                  <td><span className={`chip cat-${c.categoria}`}>{c.categoria}</span><div className="muted" style={{ fontSize: 12 }}>{c.etiqueta}</div></td>
                  <td>
                    {q ? (
                      <div className="col" style={{ gap: 2 }}>
                        <span>{rutaTexto(q.actividadId, q.descripcion)} <span className="chip aviso">propuesta sin confirmar</span></span>
                        <div className="fila"><Traza {...q} /><button className="btn s" onClick={() => onCambiar({ ...decisiones, equivalenciasClasificacion: eqs.filter((x) => x !== q) })}><Undo2 size={13} /> Retirar</button></div>
                      </div>
                    ) : editando === c.clave ? (
                      <div className="col dec-form" style={{ gap: 6 }}>
                        {!eleccion ? (
                          <BuscadorClasificacion catalogo={ID_CATALOGO_2026} etiqueta="Nodo del catálogo 2026" onElegir={(e) => setEleccion(e)} onCancelar={() => setEditando(null)} />
                        ) : (
                          <>
                            <span>{eleccion.opcion.ruta}{eleccion.descripcion ? ` · ${eleccion.descripcion}` : ''}</span>
                            {bloqueos.length ? <div className="t-info aviso" style={{ margin: 0 }}>Pendiente de la Cátedra: {bloqueos.join('; ')}. No se puede registrar la equivalencia hasta que se resuelva.</div> : (
                              <input className="input" placeholder="Referencia de la autorización (obligatoria)" aria-label="Referencia de la equivalencia" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                            )}
                            <div className="fila">
                              <button className="btn s" onClick={() => { setEleccion(null); setEditando(null); }}>Cancelar</button>
                              <button className="btn s primario" disabled={!!bloqueos.length || !motivo.trim()} onClick={() => {
                                onCambiar({ ...decisiones, equivalenciasClasificacion: [...eqs, { grupo: c.grupo, grupoComercio: c.grupoComercio, subgrupo: c.subgrupo, actividad: c.actividad, actividadId: eleccion.opcion.nodoId, ...(eleccion.descripcion ? { descripcion: eleccion.descripcion } : {}), ...firma, motivo: motivo.trim() }] });
                                setEleccion(null); setEditando(null); setMotivo('');
                              }}>Registrar equivalencia</button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : sinPermiso ? <span className="muted">Se conserva como texto histórico</span> : (
                      <div className="col" style={{ gap: 2 }}>
                        <span className="muted">Se conserva como texto histórico</span>
                        <button className="btn s fantasma" onClick={() => { setEditando(c.clave); setEleccion(null); setMotivo(''); }}>Registrar equivalencia autorizada…</button>
                      </div>
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

function PendienteCatedra({ resultado, plan, decisiones }: Props) {
  const reglas = reglasPropuestas(resultado).filter((r) => !decisiones.reglasAutorizadas?.some((x) => x.regla === r.regla));
  const textos = textosDiccionario(resultado).filter((t) => !decisiones.diccionarioAprobado?.some((x) => x.texto.toLowerCase() === t.texto.toLowerCase()));
  const combos = combinacionesHistoricas(resultado);
  const sinEq = combos.filter((c) => !decisiones.equivalenciasClasificacion?.some((q) => claveCombo(q.grupo, q.grupoComercio, q.subgrupo, q.actividad) === c.clave));
  return (
    <div className="col" style={{ gap: 10 }} aria-label="Pendiente de la Cátedra">
      <p className="muted" style={{ margin: 0 }}>Estas cuestiones no las resuelve la aplicación. Quedan registradas como pendientes y no impiden incorporar el histórico como referencia.</p>
      <ul className="inc-lista">
        {reglas.map((r) => <li key={r.regla}><ChipEstado e="catedra" /> {r.descripcion} — {r.celdas.length} celda(s){r.decision ? ` (decisión ${r.decision})` : ''}</li>)}
        {textos.map((t) => <li key={t.texto}><ChipEstado e="catedra" /> Diccionario: «{t.texto}» — {t.celdas.length} celda(s) (decisión 1)</li>)}
        <li><ChipEstado e="catedra" /> Correspondencias 2025 → 2026: {sinEq.length} de {combos.length} combinaciones históricas sin equivalencia aprobada (decisión 3)</li>
        {plan.mismoPortal.portales > 0 && <li><ChipEstado e="resuelto" /> Varios establecimientos en el mismo portal: {plan.mismoPortal.locales} locales distintos en {plan.mismoPortal.portales} portal(es). Criterio fijado: cada fila es un local físico distinto (corrección C1c-1).</li>}
        <li><ChipEstado e="catedra" /> Estado de revisión de los históricos importados: todo queda pendiente, nada se marca como revisado (decisión 6)</li>
      </ul>
      <details className="tarjeta dec-tarjeta">
        <summary><b>Discrepancias del catálogo 2026 (D01–D14)</b> · {DISCREPANCIAS_2026.length} sin resolver</summary>
        <ul className="inc-lista">{DISCREPANCIAS_2026.map((d) => <li key={d.id}><b>{d.id}</b> {d.tema}: {d.decisionProvisional}</li>)}</ul>
      </details>
      <details className="tarjeta dec-tarjeta">
        <summary><b>Excepciones del ICM</b> · {EXCEPCIONES_ICM.length}</summary>
        <ul className="inc-lista">{EXCEPCIONES_ICM.map((e) => <li key={e.producto}>{e.producto}: {e.nota}</li>)}</ul>
      </details>
    </div>
  );
}
