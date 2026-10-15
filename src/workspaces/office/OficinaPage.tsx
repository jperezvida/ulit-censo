import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlertOctagon, CheckCheck, CircleCheck, Copy, Filter, GitMerge, Globe, Inbox, Search, Tags, Undo2, X,
} from 'lucide-react';
import { useContexto, useIndices } from '../../store/contexto';
import { useStore } from '../../store/store';
import { actualizarRevisiones, aprobar, asignarActividad, devolver, esDudosa, filasOficina, type FilaOficina } from '../../domain/oficina';
import { itinerariosDe } from '../../domain/consultas';
import { TIPO_OBS_TXT } from '../../domain/campo';
import { TAXONOMIA } from '../../domain/taxonomy';
import { normalizar } from '../../domain/text';
import type { Id } from '../../domain/types';
import { Modal, Sim, fmt } from '../../components/ui';
import { SelectorActividad } from '../../components/SelectorActividad';
import { PanelRevision } from './PanelRevision';
import '../../styles/oficina.css';

type Vista = 'todas' | 'categorizar' | 'digital' | 'dudosos' | 'duplicados' | 'errores' | 'devueltos' | 'listos' | 'aprobados';

const VISTAS: { v: Vista; t: string; icono: typeof Inbox; f: (x: FilaOficina) => boolean; d: string }[] = [
  { v: 'todas', t: 'Todos los registros', icono: Inbox, f: () => true, d: 'Todo lo observado en la campaña' },
  { v: 'categorizar', t: 'Pendiente de categorizar', icono: Tags, f: (x) => !x.vacio && x.rev.categorizacion === 'pendiente', d: 'Actividad en 4 niveles' },
  { v: 'digital', t: 'Presencia digital pendiente', icono: Globe, f: (x) => !x.vacio && x.rev.digital === 'pendiente', d: 'Web, reseñas y redes de esta campaña' },
  { v: 'dudosos', t: 'Dudosos y conciliación', icono: GitMerge, f: esDudosa, d: 'Correspondencias inciertas y casos marcados' },
  { v: 'duplicados', t: 'Posibles duplicados', icono: Copy, f: (x) => x.duplicado, d: 'Misma dirección y datos parecidos' },
  { v: 'errores', t: 'Con errores', icono: AlertOctagon, f: (x) => x.errores.length > 0, d: 'Datos obligatorios incompletos' },
  { v: 'devueltos', t: 'Devueltos', icono: Undo2, f: (x) => x.rev.validacion === 'devuelta', d: 'Pendientes de corrección' },
  { v: 'listos', t: 'Listos para validar', icono: CircleCheck, f: (x) => x.rev.validacion === 'pendiente' && x.rev.campo === 'terminado' && (x.vacio || (x.rev.categorizacion === 'revisado' && x.rev.digital === 'revisado')) && !esDudosa(x), d: 'Revisión completa' },
  { v: 'aprobados', t: 'Aprobados', icono: CheckCheck, f: (x) => x.rev.validacion === 'aprobada', d: 'Validación final' },
];

const ALTO_FILA = 46;

export default function OficinaPage() {
  const { db, campana, municipio } = useContexto();
  const ix = useIndices();
  const aplicar = useStore((s) => s.aplicar);
  const avisar = useStore((s) => s.avisar);
  const [params, setParams] = useSearchParams();
  const [vista, setVista] = useState<Vista>((params.get('vista') as Vista) || 'todas');
  const [q, setQ] = useState('');
  const [fIt, setFIt] = useState('');
  const [fCalle, setFCalle] = useState(params.get('calle') ?? '');
  const [fGrupo, setFGrupo] = useState('');
  const [orden, setOrden] = useState<{ k: 'dir' | 'nombre' | 'act'; asc: boolean }>({ k: 'dir', asc: true });
  const [marcados, setMarcados] = useState<Set<Id>>(new Set());
  const [activo, setActivo] = useState<Id | null>(params.get('sel'));
  const [modal, setModal] = useState<'actividad' | 'devolver' | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  const todas = useMemo(() => (campana ? filasOficina(db, campana.id, ix) : []), [db, campana, ix]);
  const itinerarios = useMemo(() => (campana ? itinerariosDe(db, campana.id) : []), [db, campana]);
  const filtroVista = VISTAS.find((v) => v.v === vista)!;
  const base = useMemo(() => {
    const nq = normalizar(q);
    return todas.filter((f) => {
      if (fIt && f.itinerario !== fIt) return false;
      if (fCalle && f.calleId !== fCalle) return false;
      if (fGrupo && f.grupo !== fGrupo) return false;
      if (nq && !normalizar(`${f.calle} ${f.numero ?? ''} ${f.nombre} ${f.actividad ?? ''} ${f.cadena ?? ''}`).includes(nq)) return false;
      return true;
    });
  }, [todas, q, fIt, fCalle, fGrupo]);
  const filas = useMemo(() => {
    const r = base.filter(filtroVista.f);
    const dir = orden.asc ? 1 : -1;
    if (orden.k === 'nombre') r.sort((a, b) => dir * a.nombre.localeCompare(b.nombre, 'es'));
    else if (orden.k === 'act') r.sort((a, b) => dir * (a.actividad ?? 'zzz').localeCompare(b.actividad ?? 'zzz', 'es'));
    else if (!orden.asc) r.reverse();
    return r;
  }, [base, filtroVista, orden]);
  const cuentas = useMemo(() => Object.fromEntries(VISTAS.map((v) => [v.v, base.filter(v.f).length])), [base]);

  const virt = useVirtualizer({ count: filas.length, getScrollElement: () => contenedor.current, estimateSize: () => ALTO_FILA, overscan: 12 });
  const idxActivo = filas.findIndex((f) => f.localId === activo);
  const filaActiva = idxActivo >= 0 ? filas[idxActivo] : todas.find((f) => f.localId === activo);

  const seleccion = useMemo(() => filas.filter((f) => marcados.has(f.localId)), [filas, marcados]);
  const objetivo = seleccion.length ? seleccion : filaActiva ? [filaActiva] : [];

  const mover = useCallback(
    (d: number) => {
      if (!filas.length) return;
      const i = Math.max(0, Math.min(filas.length - 1, (idxActivo < 0 ? -1 : idxActivo) + d));
      setActivo(filas[i].localId);
      virt.scrollToIndex(i, { align: 'auto' });
    },
    [filas, idxActivo, virt],
  );

  const accionAprobar = useCallback(() => {
    if (!campana || !objetivo.length) return;
    let res: ReturnType<typeof aprobar> | undefined;
    aplicar((d) => {
      res = aprobar(d, campana.id, objetivo);
      return res.db;
    }, 'Aprobación', { silencioso: true });
    if (res) {
      if (res.aprobados) avisar(`${res.aprobados} registro(s) aprobado(s)${res.omitidos.length ? ` · ${res.omitidos.length} sin aprobar (${[...new Set(res.omitidos.map((o) => o.motivo))].join(', ')})` : ''}`, 'ok', true);
      else avisar(`No se puede aprobar: ${[...new Set(res.omitidos.map((o) => o.motivo))].join(', ')}`, 'error');
    }
  }, [campana, objetivo, aplicar, avisar]);

  const marcarRev = useCallback(
    (cambios: Parameters<typeof actualizarRevisiones>[3], txt: string) => {
      if (!campana || !objetivo.length) return;
      const ids = objetivo.filter((f) => !f.vacio || !('categorizacion' in cambios || 'digital' in cambios)).map((f) => f.localId);
      aplicar((d) => actualizarRevisiones(d, campana.id, ids, cambios), `${txt} (${ids.length})`);
    },
    [campana, objetivo, aplicar],
  );

  // Atajos de teclado
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || modal) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
      else if (e.key === 'x' && activo) setMarcados((m) => { const n = new Set(m); if (n.has(activo)) n.delete(activo); else n.add(activo); return n; });
      else if (e.key === 'a') accionAprobar();
      else if (e.key === 'd' && objetivo.length) setModal('devolver');
      else if (e.key === 'c') marcarRev({ categorizacion: 'revisado' }, 'Categorización revisada');
      else if (e.key === 'g') marcarRev({ digital: 'revisado' }, 'Presencia digital revisada');
      else if (e.key === 'Escape') { setActivo(null); setMarcados(new Set()); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [mover, activo, accionAprobar, marcarRev, objetivo, modal]);

  useEffect(() => {
    if (activo && idxActivo >= 0) virt.scrollToIndex(idxActivo, { align: 'center' });
    // solo al entrar con ?sel=
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!campana) return null;
  const callesConFilas = [...new Map(todas.map((f) => [f.calleId, f.calle])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  const todosMarcados = filas.length > 0 && filas.every((f) => marcados.has(f.localId));
  const ordenar = (k: 'dir' | 'nombre' | 'act') => setOrden((o) => ({ k, asc: o.k === k ? !o.asc : true }));

  return (
    <div className={`oficina ${filaActiva ? 'con-panel' : ''}`}>
      <aside className="of-vistas scroll-fino">
        <div className="rotulo" style={{ padding: '14px 14px 6px' }}>04 · Revisión · {campana.nombre}</div>
        {VISTAS.map(({ v, t, icono: I, d }) => (
          <button key={v} className={`of-vista ${vista === v ? 'on' : ''}`} onClick={() => { setVista(v); setParams((p) => { p.set('vista', v); return p; }, { replace: true }); }} title={d}>
            <I size={15} />
            <span className="esp">{t}</span>
            <span className="num of-cuenta">{fmt(cuentas[v] ?? 0)}</span>
          </button>
        ))}
        <div className="of-ayuda">
          <div className="rotulo">Atajos</div>
          <div><span className="kbd">J</span>/<span className="kbd">K</span> moverse · <span className="kbd">X</span> marcar</div>
          <div><span className="kbd">C</span> categoría revisada · <span className="kbd">G</span> digital revisada</div>
          <div><span className="kbd">A</span> aprobar · <span className="kbd">D</span> devolver · <span className="kbd">Esc</span></div>
        </div>
        <div className="of-ayuda">
          <div className="rotulo">Cuatro estados</div>
          <div className="of-leyenda-estados">
            <span><i className="e campo ok" /> Campo</span>
            <span><i className="e ok" /> Categorización</span>
            <span><i className="e ok" /> Digital</span>
            <span><i className="e ok" /> Validación</span>
          </div>
          <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>Un itinerario con campo terminado no es un censo terminado.</p>
        </div>
      </aside>

      <section className="of-centro">
        <div className="of-filtros">
          <div className="of-busca">
            <Search size={15} />
            <input placeholder={`Buscar en ${fmt(todas.length)} registros: negocio, dirección, actividad…`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Filter size={14} className="muted" />
          {itinerarios.length > 0 && (
            <select className="input of-sel" value={fIt} onChange={(e) => setFIt(e.target.value)}>
              <option value="">Itinerario: todos</option>
              {itinerarios.map((i) => <option key={i.id} value={i.codigo}>{i.codigo} · {i.nombre}</option>)}
            </select>
          )}
          <select className="input of-sel" value={fCalle} onChange={(e) => setFCalle(e.target.value)}>
            <option value="">Calle: todas</option>
            {callesConFilas.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
          <select className="input of-sel" value={fGrupo} onChange={(e) => setFGrupo(e.target.value)}>
            <option value="">Grupo: todos</option>
            {TAXONOMIA.filter((n) => n.nivel === 1).map((n) => <option key={n.id} value={n.nombre}>{n.nombre}</option>)}
          </select>
          {(fIt || fCalle || fGrupo || q) && <button className="btn s fantasma" onClick={() => { setFIt(''); setFCalle(''); setFGrupo(''); setQ(''); }}><X size={13} /> Limpiar</button>}
          <span className="esp" />
          {campana.procedencia === 'simulado' && <Sim texto={`${municipio.nombre}: datos ficticios`} />}
        </div>

        {seleccion.length > 0 && (
          <div className="of-masiva">
            <b>{seleccion.length} seleccionados</b>
            <button className="btn s" onClick={() => setModal('actividad')}><Tags size={13} /> Asignar actividad</button>
            <button className="btn s" onClick={() => marcarRev({ categorizacion: 'revisado' }, 'Categorización revisada')}>Categoría revisada</button>
            <button className="btn s" onClick={() => marcarRev({ digital: 'revisado' }, 'Presencia digital revisada')}>Digital revisada</button>
            <button className="btn s" onClick={() => marcarRev({ pendienteComprobacion: true }, 'Marcados pendientes de comprobación')}>Pendiente de comprobar</button>
            <button className="btn s primario" onClick={accionAprobar}><CheckCheck size={13} /> Aprobar</button>
            <button className="btn s" onClick={() => setModal('devolver')}><Undo2 size={13} /> Devolver</button>
            <span className="esp" />
            <button className="btn s fantasma" onClick={() => setMarcados(new Set())}>Quitar selección</button>
          </div>
        )}

        <div className="of-tabla" role="grid" aria-rowcount={filas.length}>
          <div className="of-fila of-cab" role="row">
            <span className="c-check"><input type="checkbox" checked={todosMarcados} onChange={(e) => setMarcados(e.target.checked ? new Set(filas.map((f) => f.localId)) : new Set())} aria-label="Seleccionar todo" /></span>
            <span className="c-est" title="Campo · Categorización · Digital · Validación">Estado</span>
            <button className="c-dir" onClick={() => ordenar('dir')}>Dirección {orden.k === 'dir' ? (orden.asc ? '↑' : '↓') : ''}</button>
            <button className="c-nom" onClick={() => ordenar('nombre')}>Establecimiento {orden.k === 'nombre' ? (orden.asc ? '↑' : '↓') : ''}</button>
            <button className="c-act" onClick={() => ordenar('act')}>Actividad {orden.k === 'act' ? (orden.asc ? '↑' : '↓') : ''}</button>
            <span className="c-dig">Digital</span>
            <span className="c-obs">Campo {campana.anio}</span>
            <span className="c-it">Itin.</span>
          </div>
          <div ref={contenedor} className="of-cuerpo scroll-fino">
            {filas.length === 0 ? (
              <div className="vacio-estado">
                <CheckCheck size={28} />
                <b>Nada en esta vista</b>
                <span>{vista === 'todas' ? 'No hay registros con los filtros actuales.' : 'Todo revisado en esta vista. 🎉'}</span>
              </div>
            ) : (
              <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
                {virt.getVirtualItems().map((vi) => {
                  const f = filas[vi.index];
                  return (
                    <Fila
                      key={f.localId}
                      f={f}
                      top={vi.start}
                      activa={f.localId === activo}
                      marcada={marcados.has(f.localId)}
                      onClick={() => setActivo(f.localId)}
                      onMarcar={(v) => setMarcados((m) => { const n = new Set(m); if (v) n.add(f.localId); else n.delete(f.localId); return n; })}
                    />
                  );
                })}
              </div>
            )}
          </div>
          <div className="of-pie muted">
            {fmt(filas.length)} de {fmt(todas.length)} registros · {filtroVista.d}
          </div>
        </div>
      </section>

      {filaActiva && (
        <PanelRevision
          key={filaActiva.localId}
          fila={filaActiva}
          onCerrar={() => setActivo(null)}
          onAnterior={() => mover(-1)}
          onSiguiente={() => mover(1)}
          onAprobar={accionAprobar}
          onDevolver={() => setModal('devolver')}
          posicion={idxActivo >= 0 ? `${idxActivo + 1} / ${filas.length}` : ''}
        />
      )}

      {modal === 'actividad' && (
        <ModalActividad
          n={objetivo.filter((f) => !f.vacio).length}
          onCerrar={() => setModal(null)}
          onAplicar={(act) => {
            aplicar((d) => asignarActividad(d, campana.id, objetivo, act), `Actividad asignada a ${objetivo.filter((f) => !f.vacio).length} registros`);
            setModal(null);
          }}
        />
      )}
      {modal === 'devolver' && (
        <ModalDevolver
          n={objetivo.length}
          onCerrar={() => setModal(null)}
          onAplicar={(m) => {
            aplicar((d) => devolver(d, campana.id, objetivo.map((f) => f.localId), m), `${objetivo.length} registro(s) devuelto(s) para corrección`);
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

function Punto({ ok, parcial, t }: { ok: boolean; parcial?: boolean; t: string }) {
  return <i className={`e ${ok ? 'ok' : parcial ? 'parcial' : ''}`} title={t} />;
}

function Fila({ f, top, activa, marcada, onClick, onMarcar }: { f: FilaOficina; top: number; activa: boolean; marcada: boolean; onClick: () => void; onMarcar: (v: boolean) => void }) {
  const r = f.rev;
  return (
    <div className={`of-fila ${activa ? 'activa' : ''} ${marcada ? 'marcada' : ''}`} style={{ transform: `translateY(${top}px)` }} onClick={onClick} role="row" aria-selected={activa}>
      <span className="c-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={marcada} onChange={(e) => onMarcar(e.target.checked)} aria-label="Seleccionar" />
      </span>
      <span className="c-est">
        <Punto ok={r.campo === 'terminado'} t={`Campo: ${r.campo}`} />
        <Punto ok={f.vacio || r.categorizacion === 'revisado'} t={`Categorización: ${f.vacio ? 'no aplica' : r.categorizacion}`} />
        <Punto ok={f.vacio || r.digital === 'revisado'} t={`Digital: ${f.vacio ? 'no aplica' : r.digital}`} />
        <i className={`e ${r.validacion === 'aprobada' ? 'ok' : r.validacion === 'devuelta' ? 'error' : ''}`} title={`Validación: ${r.validacion}`} />
      </span>
      <span className="c-dir">
        <span className="mono num of-n">{f.numero ?? 's/n'}{f.sufijo ? ` ${f.sufijo}` : ''}</span>
        <span className="of-calle">{f.calle}</span>
      </span>
      <span className="c-nom">
        <span className={f.vacio ? 'muted' : ''}>{f.vacio ? `Vacío${f.metros ? ` · ${f.metros} m` : ''}` : f.nombre}</span>
        {f.cadena && <span className="tag">{f.cadena}</span>}
        {f.duplicado && <span className="tag rojo">¿duplicado?</span>}
        {f.vinculo && f.vinculo !== 'confirmada' && <span className="tag morado">{f.vinculo}</span>}
        {r.pendienteComprobacion && <span className="tag morado">comprobar</span>}
        {f.errores.length > 0 && <span className="tag rojo" title={f.errores.join(', ')}>{f.errores.length} error</span>}
        {r.validacion === 'devuelta' && <span className="tag rojo" title={r.motivoDevolucion}>devuelto</span>}
      </span>
      <span className="c-act">
        {f.vacio ? <span className="muted">—</span> : f.actividad ? <><span>{f.actividad}</span><span className="of-grupo">{f.grupo}</span></> : <span className="tag naranja">sin clasificar</span>}
      </span>
      <span className="c-dig">
        {f.digital === 'verificada' && <span className="chip ok">verificada</span>}
        {f.digital === 'anterior' && <span className="chip aviso" title="Hay datos de una campaña anterior: no se consideran verificados en esta">solo anterior</span>}
        {f.digital === 'sin-datos' && <span className="muted">sin datos</span>}
        {f.digital === 'no-aplica' && <span className="muted">—</span>}
      </span>
      <span className="c-obs">{f.obs ? <span className={`of-obs t-${f.obs.tipo}`}>{TIPO_OBS_TXT[f.obs.tipo]}</span> : <span className="muted">—</span>}</span>
      <span className="c-it mono">{f.itinerario ?? ''}</span>
    </div>
  );
}

function ModalActividad({ n, onCerrar, onAplicar }: { n: number; onCerrar: () => void; onAplicar: (id: Id) => void }) {
  const [act, setAct] = useState<Id | undefined>();
  return (
    <Modal titulo="Asignar actividad" sub={`Se aplicará a ${n} establecimientos ocupados y quedará su categorización revisada.`} onCerrar={onCerrar} pie={<><button className="btn" onClick={onCerrar}>Cancelar</button><button className="btn primario" disabled={!act} onClick={() => act && onAplicar(act)}>Aplicar a {n}</button></>}>
      <SelectorActividad valor={act} onCambio={setAct} />
    </Modal>
  );
}

function ModalDevolver({ n, onCerrar, onAplicar }: { n: number; onCerrar: () => void; onAplicar: (m: string) => void }) {
  const [m, setM] = useState('');
  const rapidos = ['Revisar número de portal', 'Confirmar si sigue abierto', 'Nombre comercial ilegible', 'Posible duplicado'];
  return (
    <Modal titulo={`Devolver ${n} registro(s) para corrección`} onCerrar={onCerrar} pie={<><button className="btn" onClick={onCerrar}>Cancelar</button><button className="btn primario" disabled={!m.trim()} onClick={() => onAplicar(m.trim())}>Devolver</button></>}>
      <div className="campo">
        <label>Motivo</label>
        <textarea className="input" value={m} onChange={(e) => setM(e.target.value)} autoFocus />
      </div>
      <div className="fila" style={{ flexWrap: 'wrap', marginTop: 8 }}>
        {rapidos.map((r) => <button key={r} className="btn s" onClick={() => setM(r)}>{r}</button>)}
      </div>
    </Modal>
  );
}
