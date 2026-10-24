import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, LayoutList, Lock, LockOpen, Search, ShieldCheck, Table2, X } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { estadoOficina } from '../../domain/bloqueo';
import { normalizar } from '../../domain/text';
import type { FilaOficina } from '../../domain/oficina';
import type { Id } from '../../domain/types';
import { Segmentado, Sim, fmt, fmtFecha } from '../../components/ui';
import { OficinaContext, useFilas, useModoOficina, type CtxOficina } from './contextoOficina';
import { FILTROS, TAREAS, TAREA_POR_ID, aplicaFiltro, siguientePendiente, tareasPendientes, type Filtro, type Tarea } from './tareas';
import { EstadoRevision } from './PanelItinerarios';
import { ListaRegistros } from './ListaRegistros';
import { PanelRevision, type Pestana } from './PanelRevision';
import { VistaTareas } from './VistaTareas';
import { ModalCerrarRevision, ModalCronologia, ModalReabrir, ModalValidacion } from './ModalesOficina';
import '../../styles/oficina-b2.css';

/** Espacio de trabajo de un itinerario (o de toda la campaña, en la vista municipal). */
export default function EspacioOficina({ municipal = false }: { municipal?: boolean }) {
  const { db, campana, municipio, prefs } = useContexto();
  const { itId } = useParams();
  const it = !municipal && itId ? db.itinerarios[itId] : undefined;
  const [params, setParams] = useSearchParams();
  const tarea = (params.get('tarea') as Tarea) || 'todos';
  const filtro = (params.get('filtro') as Filtro) || 'pendientes';
  const sel = params.get('sel');
  const calle = params.get('calle') ?? '';
  const soloSinIt = params.get('sinIt') === '1';
  const [q, setQ] = useState('');
  const [modo, setModo] = useModoOficina();
  const [ampliada, setAmpliada] = useState(false);
  const [pestana, setPestana] = useState<Pestana>(() => (tarea === 'digital' ? 'digital' : tarea === 'incidencias' ? 'conciliacion' : 'ficha'));
  const [modal, setModal] = useState<'cerrar' | 'reabrir' | 'validar' | 'cronologia' | null>(null);
  const filasIt = useFilas(it?.id);
  const estado = it ? estadoOficina(db, it.id) : 'en-revision';
  const itCerrado = estado === 'revision-cerrada' || estado === 'validado';
  // Una campaña histórica o ya validada no se edita desde Oficina (evita tocar otra campaña por descuido).
  const campanaCerrada = !!campana && (campana.tipo === 'historico-importado' || campana.estados.validacion === 'terminado');
  const bloqueado = itCerrado || campanaCerrada;

  const setParam = (k: string, v: string | null) =>
    setParams((p) => {
      if (v === null || v === '') p.delete(k);
      else p.set(k, v);
      return p;
    }, { replace: true });

  const base = useMemo(() => {
    const nq = normalizar(q);
    return filasIt.filter((f) => {
      if (soloSinIt && f.itinerarioIds.length) return false;
      if (calle && f.calleId !== calle) return false;
      if (nq && !normalizar(`${f.calle} ${f.numero ?? ''}${f.sufijo ?? ''} ${f.nombre} ${f.actividad ?? ''} ${f.cadena ?? ''}`).includes(nq)) return false;
      return true;
    });
  }, [filasIt, q, calle, soloSinIt]);
  const def = TAREA_POR_ID[tarea] ?? TAREA_POR_ID.todos;
  const filas = useMemo(() => base.filter((f) => def.aplica(f) && aplicaFiltro(def, filtro, f)), [base, def, filtro]);
  const cuentas = useMemo(
    () => Object.fromEntries(TAREAS.map((t) => [t.id, { total: base.filter(t.aplica).length, pend: t.pendiente ? base.filter((f) => t.aplica(f) && t.pendiente!(f)).length : null }])),
    [base],
  );
  if (!campana) return null;
  if (!municipal && !it) return <div className="t-info error" style={{ margin: 24 }}>Itinerario no encontrado. <Link to="/oficina">Volver a Oficina</Link></div>;

  const ctx: CtxOficina = { campana, itinerario: it, alcance: it ? { itinerarioId: it.id } : undefined, bloqueado, personaId: prefs.personaId };
  const filaSel: FilaOficina | undefined = filas.find((f) => f.localId === sel) ?? filasIt.find((f) => f.localId === sel);
  const elegir = (id: Id | null) => setParam('sel', id);
  const idx = filaSel ? filas.indexOf(filaSel) : -1;
  const mover = (d: number) => {
    const i = Math.max(0, Math.min(filas.length - 1, idx + d));
    if (filas[i]) elegir(filas[i].localId);
  };
  const irSiguientePendiente = () => {
    const f = siguientePendiente(filas, idx, tarea);
    if (f) elegir(f.localId);
  };
  const cierre = it ? [...(db.oficinaItinerarios[it.id]?.historial ?? [])].reverse().find((h) => h.accion !== 'validar') : undefined;
  const pendientesTotales = filasIt.filter((f) => tareasPendientes(f).length || f.situacion === 'pendiente-visita').length;

  return (
    <OficinaContext.Provider value={ctx}>
      <div className={`ofi-espacio modo-${modo} ${modo === 'tareas' && ampliada ? 'ficha-ampliada' : ''}`}>
        <header className="ofi-cab">
          <Link to="/oficina" className="btn s fantasma" aria-label="Volver a los itinerarios"><ChevronLeft size={15} /> Itinerarios</Link>
          <div className="ofi-cab-tit">
            <b>{it ? `${it.codigo} · ${it.nombre}` : 'Vista general municipal'}</b>
            <span className="muted">{campana.nombre} · {fmt(filasIt.length)} registros{municipal ? ' · todos los itinerarios' : ''}</span>
          </div>
          {it && <EstadoRevision estado={estado} />}
          {it && cierre && (
            <span className="muted ofi-cierre" title={cierre.motivo}>
              {cierre.accion === 'reabrir' ? 'Reabierto' : 'Cerrado'} por {db.personas[cierre.porId]?.nombre ?? cierre.porId} · {fmtFecha(cierre.fecha)}
            </span>
          )}
          <span className="esp" />
          {campana.procedencia === 'simulado' && <Sim texto={`${municipio.nombre}: ficticio`} />}
          <Segmentado
            valor={modo}
            onCambio={setModo}
            opciones={[
              { v: 'tareas', t: <span className="fila" style={{ gap: 4 }}><Table2 size={14} /> Por tareas</span> },
              { v: 'establecimiento', t: <span className="fila" style={{ gap: 4 }}><LayoutList size={14} /> Por establecimientos</span> },
            ]}
          />
          {it && !bloqueado && <button className="btn s" onClick={() => setModal('cerrar')}><Lock size={13} /> Cerrar revisión (provisional)</button>}
          {it && itCerrado && <button className="btn s" onClick={() => setModal('reabrir')}><LockOpen size={13} /> Reabrir</button>}
          {it && <button className="btn s fantasma" onClick={() => setModal('validar')} title="Requiere los controles del bloque C" aria-label="Validación definitiva"><ShieldCheck size={13} /> <span className="ofi-validar-txt">Validación definitiva</span></button>}
        </header>

        {campanaCerrada && (
          <div className="ofi-banda-bloqueo" role="status">
            <Lock size={14} /> {campana.nombre} es una campaña histórica o ya validada: se consulta en modo de solo lectura.
          </div>
        )}
        {itCerrado && (
          <div className="ofi-banda-bloqueo" role="status">
            <Lock size={14} /> {it?.codigo} tiene la revisión cerrada de forma provisional: sus registros de {campana.anio} no se pueden modificar. <b>No es apto para la exportación municipal.</b> Reábrelo con un motivo para corregir.
          </div>
        )}

        <nav className="ofi-tareas" aria-label="Tareas">
          {TAREAS.map((t) => {
            const c = cuentas[t.id];
            return (
              <button key={t.id} className={`ofi-tarea ${tarea === t.id ? 'on' : ''}`} onClick={() => setParam('tarea', t.id)} title={t.aviso ?? t.descripcion} aria-pressed={tarea === t.id}>
                {t.titulo}
                <span className="ofi-tarea-n">{c.pend === null ? `${fmt(c.total)} · sin estado (B5)` : `${fmt(c.pend)} / ${fmt(c.total)}`}</span>
              </button>
            );
          })}
        </nav>

        <div className="ofi-filtros">
          <div className="of-busca">
            <Search size={15} />
            <input placeholder="Buscar negocio, número, actividad…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Búsqueda" />
          </div>
          <div className="ofi-chips" role="group" aria-label="Filtro">
            {FILTROS.filter((x) => (def.pendiente ? true : x.id !== 'pendientes' && x.id !== 'revisados')).map((x) => (
              <button key={x.id} className={`chip ${filtro === x.id ? 'on' : ''}`} onClick={() => setParam('filtro', x.id)} aria-pressed={filtro === x.id}>{x.titulo}</button>
            ))}
          </div>
          {(calle || soloSinIt) && (
            <button className="btn s fantasma" onClick={() => { setParam('calle', null); setParam('sinIt', null); }}><X size={13} /> {calle ? db.calles[calle]?.nombre : 'Sin itinerario'}</button>
          )}
          <span className="esp" />
          <span className="muted" style={{ fontSize: 12 }}>{fmt(filas.length)} en esta vista · {fmt(pendientesTotales)} con algo pendiente</span>
        </div>
        {def.aviso && <div className="t-info" style={{ margin: '0 12px 8px' }}>{def.aviso}</div>}

        {modo === 'tareas' ? (
          <VistaTareas tarea={tarea} filas={filas} todas={filasIt} sel={filaSel?.localId ?? null} onSel={elegir} pestana={pestana} onPestana={setPestana} ampliada={ampliada} onAmpliada={setAmpliada} onCronologia={(id) => { elegir(id); setModal('cronologia'); }} />
        ) : (
          <div className="ofi-establecimiento">
            <ListaRegistros filas={filas} sel={filaSel?.localId ?? null} onSel={elegir} etiqueta={`Registros · ${def.titulo}`} />
            <div className="ofi-ficha">
              {filaSel ? (
                <>
                  <PanelRevision
                    key={filaSel.localId}
                    variante="pagina"
                    fila={filaSel}
                    pestana={pestana}
                    onPestana={setPestana}
                    onCerrar={() => elegir(null)}
                    onAnterior={() => mover(-1)}
                    onSiguiente={() => mover(1)}
                    onSiguientePendiente={irSiguientePendiente}
                    onCronologia={() => setModal('cronologia')}
                    posicion={idx >= 0 ? `${idx + 1} / ${filas.length}` : 'fuera del filtro'}
                  />
                </>
              ) : (
                <div className="vacio-estado"><b>Elige un establecimiento</b><span>Completa todas sus tareas y pasa al siguiente pendiente.</span></div>
              )}
            </div>
          </div>
        )}

        {modal === 'cerrar' && it && <ModalCerrarRevision it={it} personaId={prefs.personaId} pendientes={pendientesTotales} onCerrar={() => setModal(null)} />}
        {modal === 'reabrir' && it && <ModalReabrir it={it} personaId={prefs.personaId} onCerrar={() => setModal(null)} />}
        {modal === 'validar' && it && <ModalValidacion it={it} onCerrar={() => setModal(null)} />}
        {modal === 'cronologia' && filaSel && <ModalCronologia localId={filaSel.localId} campanaId={campana.id} personaId={prefs.personaId} alcance={ctx.alcance} onCerrar={() => setModal(null)} />}
      </div>
    </OficinaContext.Provider>
  );
}
