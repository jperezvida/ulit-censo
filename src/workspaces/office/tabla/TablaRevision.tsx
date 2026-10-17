import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as KE } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertCircle, CheckCircle2, Clock, Columns3, Info, Loader2, Lock, Pin, PinOff, Redo2, ShieldCheck, Undo2 } from 'lucide-react';
import { verificarDigital } from '../../../domain/digital';
import { useStore } from '../../../store/store';
import type { FilaOficina } from '../../../domain/oficina';
import type { Id } from '../../../domain/types';
import { useCtxOficina } from '../contextoOficina';
import { Puntos } from '../ListaRegistros';
import { observarRectConRespaldo } from '../virtual';
import type { Tarea } from '../tareas';
import {
  ACTIVIDADES_SELECCIONABLES, COLUMNAS, COLUMNAS_TAREA, COLUMNA_POR_ID, ErrorCeldas, aTSV, aplicarCambiosCeldas, motivoNoEditable, parseTSV,
  type CambioCelda, type Columna, type CtxCelda,
} from './columnas';
import '../../../styles/tabla-revision.css';

const ALTO = 34;
const ANCHO_META = 82;

interface Pos {
  f: Id; // localId
  c: string; // id de columna
}

type Despues = 'abajo' | 'derecha' | 'izquierda' | 'nada';

/**
 * Tabla de revisión rápida (B3).
 *
 * - Navegación: flechas, Tab/Mayús+Tab, Inicio/Fin, AvPág/RePág; Mayús+flechas amplía el rango.
 * - Edición: Enter o F2 (o empezar a escribir) · Enter confirma y baja · Tab confirma y avanza ·
 *   Esc cancela. Supr vacía las celdas del rango.
 * - Copiar/pegar rangos (Ctrl+C / Ctrl+V) entre celdas compatibles: el pegado es atómico.
 * - Deshacer/rehacer por operación confirmada (Ctrl+Z / Ctrl+Y).
 * - Ctrl+Enter abre la ficha (histórico y conciliación incluidos).
 *
 * El cursor se guarda por (local, columna): sobrevive a la virtualización, al filtrado y al
 * desplazamiento horizontal.
 */
export function TablaRevision({ filas, tarea, sel, onSel, onAbrirFicha, onCronologia }: {
  filas: FilaOficina[];
  tarea: Tarea;
  sel: Id | null;
  onSel: (id: Id) => void;
  onAbrirFicha: (id: Id) => void;
  onCronologia: (id: Id) => void;
}) {
  const db = useStore((s) => s.db!);
  const aplicar = useStore((s) => s.aplicar);
  const deshacer = useStore((s) => s.deshacer);
  const rehacer = useStore((s) => s.rehacer);
  const pilaDeshacer = useStore((s) => s.pilaDeshacer);
  const pilaRehacer = useStore((s) => s.pilaRehacer);
  const guardado = useStore((s) => s.guardado);
  const personaId = useStore((s) => s.prefs.personaId);
  const prefsCol = useStore((s) => s.prefs.oficina?.[s.prefs.personaId]?.columnas?.[tarea]);
  const setPrefsOficina = useStore((s) => s.setPrefsOficina);
  const ctxOf = useCtxOficina()!;
  const ctxCelda: CtxCelda = useMemo(
    () => ({ db, campanaId: ctxOf.campana.id, personaId, alcance: ctxOf.alcance, bloqueado: ctxOf.bloqueado }),
    [db, ctxOf.campana.id, personaId, ctxOf.alcance, ctxOf.bloqueado],
  );

  // ── Columnas visibles y fijadas ──
  const visiblesIds = prefsCol?.visibles ?? COLUMNAS_TAREA[tarea];
  const fijasIds = prefsCol?.fijas ?? COLUMNAS.filter((c) => c.fijaPorDefecto).map((c) => c.id);
  const cols = useMemo(() => {
    const vis = visiblesIds.map((id) => COLUMNA_POR_ID[id]).filter(Boolean);
    return [...vis.filter((c) => fijasIds.includes(c.id)), ...vis.filter((c) => !fijasIds.includes(c.id))];
  }, [visiblesIds, fijasIds]);
  const nFijas = cols.filter((c) => fijasIds.includes(c.id)).length;
  const izq = useMemo(() => {
    const out: number[] = [];
    let x = ANCHO_META;
    for (const c of cols) {
      out.push(x);
      x += c.ancho;
    }
    return out;
  }, [cols]);
  const anchoTotal = ANCHO_META + cols.reduce((a, c) => a + c.ancho, 0);
  const anchoFijas = ANCHO_META + cols.slice(0, nFijas).reduce((a, c) => a + c.ancho, 0);

  // ── Orden ──
  const [orden, setOrden] = useState<{ col: string; asc: boolean } | null>(null);
  const filasOrd = useMemo(() => {
    if (!orden) return filas;
    const col = COLUMNA_POR_ID[orden.col];
    const r = [...filas].sort((a, b) => col.orden!(a, b, ctxCelda));
    return orden.asc ? r : r.reverse();
  }, [filas, orden, ctxCelda]);
  const indice = useMemo(() => new Map(filasOrd.map((f, i) => [f.localId, i])), [filasOrd]);

  // ── Cursor, rango y edición ──
  const [activo, setActivo] = useState<Pos | null>(() => (sel ? { f: sel, c: cols.find((c) => c.editor)?.id ?? cols[0].id } : null));
  const [ancla, setAncla] = useState<Pos | null>(null);
  const [edicion, setEdicion] = useState<{ texto: string; original: string } | null>(null);
  const [errores, setErrores] = useState<Map<string, string>>(new Map());
  const [mensaje, setMensaje] = useState<{ t: string; tipo: 'error' | 'info' | 'ok' } | null>(null);
  const [panelCols, setPanelCols] = useState(false);
  const ultimoIndice = useRef(0);
  /** El cursor se movió porque el registro activo salió de la vista (no por la persona). */
  const movidoSolo = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);

  const r0 = activo ? indice.get(activo.f) : undefined;
  const c0 = activo ? cols.findIndex((c) => c.id === activo.c) : -1;
  if (r0 !== undefined) ultimoIndice.current = r0;

  // Si el registro activo sale de la vista (filtro), el cursor pasa al que ocupa su lugar.
  useEffect(() => {
    if (!filasOrd.length) return;
    if (!activo) return;
    const colOk = cols.some((c) => c.id === activo.c) ? activo.c : cols[0].id;
    if (!indice.has(activo.f)) {
      const f = filasOrd[Math.min(ultimoIndice.current, filasOrd.length - 1)];
      movidoSolo.current = true; // no arrastra a la ficha abierta: la persona decide cuándo avanzar
      setActivo({ f: f.localId, c: colOk });
      setEdicion(null);
    } else if (colOk !== activo.c) setActivo({ ...activo, c: colOk });
  }, [filasOrd, indice, activo, cols]);

  // Sincroniza el registro seleccionado (URL) con la fila activa, sin hacerlo en cada pulsación.
  useEffect(() => {
    if (!activo || activo.f === sel || !indice.has(activo.f)) return;
    if (movidoSolo.current) {
      movidoSolo.current = false;
      return;
    }
    const t = setTimeout(() => onSel(activo.f), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo?.f]);
  useEffect(() => {
    if (sel && indice.has(sel) && sel !== activo?.f) setActivo({ f: sel, c: activo?.c ?? cols.find((c) => c.editor)?.id ?? cols[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const virt = useVirtualizer({
    count: filasOrd.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => ALTO,
    overscan: 16,
    observeElementRect: observarRectConRespaldo(560),
    // Las filas empiezan bajo la cabecera fija (que además tapa la parte superior al subir).
    scrollMargin: ALTO,
    scrollPaddingStart: ALTO,
  });

  const rango = useMemo(() => {
    if (!activo || r0 === undefined || c0 < 0) return null;
    const a = ancla && indice.has(ancla.f) ? ancla : activo;
    const ra = indice.get(a.f)!;
    const ca = Math.max(0, cols.findIndex((c) => c.id === a.c));
    return { r1: Math.min(ra, r0), r2: Math.max(ra, r0), c1: Math.min(ca, c0), c2: Math.max(ca, c0) };
  }, [activo, ancla, indice, cols, r0, c0]);
  const nCeldas = rango ? (rango.r2 - rango.r1 + 1) * (rango.c2 - rango.c1 + 1) : 0;

  const enfocar = useCallback(() => grid.current?.focus({ preventScroll: true }), []);

  const asegurarVisible = useCallback(
    (r: number, c: number) => {
      virt.scrollToIndex(r, { align: 'auto' });
      const el = scroll.current;
      if (!el || c < nFijas) return;
      const x = izq[c];
      const w = cols[c].ancho;
      if (x - anchoFijas < el.scrollLeft) el.scrollLeft = x - anchoFijas;
      else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
    },
    [virt, izq, cols, nFijas, anchoFijas],
  );

  const irA = useCallback(
    (r: number, c: number, extender = false) => {
      if (!filasOrd.length) return;
      const rr = Math.max(0, Math.min(filasOrd.length - 1, r));
      const cc = Math.max(0, Math.min(cols.length - 1, c));
      const nuevo = { f: filasOrd[rr].localId, c: cols[cc].id };
      if (extender) setAncla((a) => a ?? activo);
      else setAncla(null);
      setActivo(nuevo);
      setMensaje(null);
      asegurarVisible(rr, cc);
    },
    [filasOrd, cols, activo, asegurarVisible],
  );

  /** Ejecuta cambios de celda como UNA operación (atómica y deshacible). */
  const ejecutar = useCallback(
    (cambios: CambioCelda[], etiqueta: string): boolean => {
      if (!cambios.length) return true;
      let fallo: ErrorCeldas | null = null;
      const ok = aplicar((d) => {
        try {
          return aplicarCambiosCeldas(d, cambios, { ...ctxCelda, db: d });
        } catch (e) {
          if (e instanceof ErrorCeldas) fallo = e;
          throw e;
        }
      }, etiqueta, { silencioso: true, sinAvisoError: true });
      if (fallo) {
        const f = fallo as ErrorCeldas;
        setErrores(new Map(f.celdas.map((x) => [`${x.localId}|${x.colId}`, x.motivo])));
        setMensaje({ t: f.message, tipo: 'error' });
      } else if (ok) {
        setErrores(new Map());
        setMensaje({ t: `${etiqueta} · guardado`, tipo: 'ok' });
      }
      return !fallo;
    },
    [aplicar, ctxCelda],
  );

  const filaActiva = r0 !== undefined ? filasOrd[r0] : undefined;
  const colActiva = c0 >= 0 ? cols[c0] : undefined;

  const empezarEdicion = (inicial?: string) => {
    if (!filaActiva || !colActiva) return;
    const motivo = motivoNoEditable(colActiva, filaActiva, ctxCelda);
    if (motivo) {
      setMensaje({ t: `${colActiva.titulo}: ${motivo}`, tipo: 'info' });
      return;
    }
    const original = colActiva.texto(filaActiva, ctxCelda);
    setEdicion({ texto: inicial ?? original, original });
  };

  const confirmar = (despues: Despues) => {
    if (!edicion || !filaActiva || !colActiva || r0 === undefined) return;
    const sinCambio = edicion.texto === edicion.original;
    // Re-confirmar una actividad importada o heredada la deja confirmada.
    const confirmaClasificacion = colActiva.id === 'actividad' && !!filaActiva.clasificacion && !filaActiva.clasificacion.confirmada;
    const siguiente = despues === 'abajo' ? filasOrd[Math.min(r0 + 1, filasOrd.length - 1)]?.localId : undefined;
    if (!sinCambio || confirmaClasificacion) {
      const ok = ejecutar([{ fila: filaActiva, col: colActiva, texto: edicion.texto }], `${colActiva.titulo}${edicion.texto ? `: ${edicion.texto}` : ' vaciado'}`);
      if (!ok) return; // el editor sigue abierto para corregir
    }
    setEdicion(null);
    enfocar();
    if (despues === 'abajo' && siguiente) {
      setActivo({ f: siguiente, c: colActiva.id });
      setAncla(null);
      const i = indice.get(siguiente);
      if (i !== undefined) asegurarVisible(i, c0);
    } else if (despues === 'derecha') irA(r0, c0 + 1);
    else if (despues === 'izquierda') irA(r0, c0 - 1);
  };

  const cancelar = () => {
    setEdicion(null);
    setMensaje(null);
    enfocar();
  };

  const celdasDelRango = (): { fila: FilaOficina; col: Columna }[] => {
    if (!rango) return [];
    const out: { fila: FilaOficina; col: Columna }[] = [];
    for (let r = rango.r1; r <= rango.r2; r++) for (let c = rango.c1; c <= rango.c2; c++) out.push({ fila: filasOrd[r], col: cols[c] });
    return out;
  };

  const vaciar = () => {
    const celdas = celdasDelRango();
    ejecutar(celdas.map((x) => ({ ...x, texto: '' })), `Vaciadas ${celdas.length} celda(s)`);
  };

  const onKeyDown = (e: KE<HTMLDivElement>) => {
    if (edicion || !filasOrd.length) return;
    const mod = e.ctrlKey || e.metaKey;
    const r = r0 ?? -1;
    const c = c0 < 0 ? 0 : c0;
    const k = e.key;
    if (mod && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) rehacer();
      else deshacer();
      return;
    }
    if (mod && (k === 'y' || k === 'Y')) {
      e.preventDefault();
      rehacer();
      return;
    }
    if (mod && k === 'Enter') {
      e.preventDefault();
      if (filaActiva) onAbrirFicha(filaActiva.localId);
      return;
    }
    if (mod && ['c', 'v', 'x'].includes(k.toLowerCase())) return; // copiar/pegar: eventos copy/paste
    if (mod && k !== 'Home' && k !== 'End') return;
    const pagina = Math.max(1, Math.floor((scroll.current?.clientHeight ?? 400) / ALTO) - 1);
    switch (k) {
      case 'ArrowDown': e.preventDefault(); irA(r + 1, c, e.shiftKey); return;
      case 'ArrowUp': e.preventDefault(); irA(Math.max(0, r - 1), c, e.shiftKey); return;
      case 'ArrowRight': e.preventDefault(); irA(Math.max(0, r), c + 1, e.shiftKey); return;
      case 'ArrowLeft': e.preventDefault(); irA(Math.max(0, r), c - 1, e.shiftKey); return;
      case 'PageDown': e.preventDefault(); irA(r + pagina, c, e.shiftKey); return;
      case 'PageUp': e.preventDefault(); irA(Math.max(0, r - pagina), c, e.shiftKey); return;
      case 'Home': e.preventDefault(); irA(e.ctrlKey ? 0 : Math.max(0, r), 0); return;
      case 'End': e.preventDefault(); irA(e.ctrlKey ? filasOrd.length - 1 : Math.max(0, r), cols.length - 1); return;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) {
          if (c > 0) irA(Math.max(0, r), c - 1);
          else if (r > 0) irA(r - 1, cols.length - 1);
        } else if (c < cols.length - 1) irA(Math.max(0, r), c + 1);
        else if (r < filasOrd.length - 1) irA(r + 1, 0);
        return;
      case 'Enter':
      case 'F2':
        e.preventDefault();
        if (r < 0) irA(0, c);
        else empezarEdicion();
        return;
      case 'Escape':
        setAncla(null);
        setMensaje(null);
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        vaciar();
        return;
      default:
        if (k.length === 1 && !e.altKey && r >= 0) {
          e.preventDefault();
          empezarEdicion(k);
        }
    }
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (edicion || !rango) return;
    e.preventDefault();
    const m: string[][] = [];
    for (let r = rango.r1; r <= rango.r2; r++) m.push(cols.slice(rango.c1, rango.c2 + 1).map((col) => col.texto(filasOrd[r], ctxCelda)));
    e.clipboardData.setData('text/plain', aTSV(m));
    setMensaje({ t: `${nCeldas} celda(s) copiadas`, tipo: 'info' });
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (edicion || !rango) return;
    e.preventDefault();
    const m = parseTSV(e.clipboardData.getData('text/plain'));
    if (!m.length) return;
    const cambios: CambioCelda[] = [];
    const unico = m.length === 1 && m[0].length === 1;
    if (unico && nCeldas > 1) {
      for (const x of celdasDelRango()) cambios.push({ ...x, texto: m[0][0] });
    } else {
      const alto = m.length;
      const ancho = Math.max(...m.map((x) => x.length));
      if (rango.r1 + alto > filasOrd.length || rango.c1 + ancho > cols.length) {
        setMensaje({ t: `El pegado (${alto}×${ancho}) no cabe en las filas y columnas visibles desde la celda activa. No se ha aplicado ningún cambio.`, tipo: 'error' });
        return;
      }
      m.forEach((fila, i) => fila.forEach((t, j) => cambios.push({ fila: filasOrd[rango.r1 + i], col: cols[rango.c1 + j], texto: t })));
    }
    ejecutar(cambios, `Pegado de ${cambios.length} celda(s)`);
  };

  // Manejadores estables para las filas memorizadas (leen el estado más reciente por referencia).
  const ultimo = useRef({ edicion, activo, confirmar, empezarEdicion, cancelar, onAbrirFicha, onCronologia, enfocar });
  ultimo.current = { edicion, activo, confirmar, empezarEdicion, cancelar, onAbrirFicha, onCronologia, enfocar };
  const acciones = useMemo<AccionesFila>(
    () => ({
      pulsarCelda: (localId, colId, shift) => {
        const u = ultimo.current;
        if (u.edicion && u.activo?.f === localId && u.activo.c === colId) return;
        if (u.edicion) u.confirmar('nada');
        if (shift && u.activo) setAncla((a) => a ?? u.activo);
        else setAncla(null);
        setActivo({ f: localId, c: colId });
        setMensaje(null);
        u.enfocar();
      },
      dobleClic: () => ultimo.current.empezarEdicion(),
      cambiarEdicion: (texto) => setEdicion((e) => (e ? { ...e, texto } : e)),
      teclaEditor: (e) => {
        e.stopPropagation();
        const u = ultimo.current;
        if (e.key === 'Enter') { e.preventDefault(); u.confirmar('abajo'); }
        else if (e.key === 'Tab') { e.preventDefault(); u.confirmar(e.shiftKey ? 'izquierda' : 'derecha'); }
        else if (e.key === 'Escape') { e.preventDefault(); u.cancelar(); }
      },
      abrirFicha: (id) => ultimo.current.onAbrirFicha(id),
      cronologia: (id) => ultimo.current.onCronologia(id),
    }),
    [],
  );

  const ultimaOp = pilaDeshacer[pilaDeshacer.length - 1]?.etiqueta;
  const proximaRe = pilaRehacer[pilaRehacer.length - 1]?.etiqueta;
  const motivoActiva = filaActiva && colActiva ? motivoNoEditable(colActiva, filaActiva, ctxCelda) : null;

  const guardarCols = (visibles: string[], fijas: string[]) => {
    const actuales = useStore.getState().prefs.oficina?.[personaId]?.columnas ?? {};
    setPrefsOficina(personaId, { columnas: { ...actuales, [tarea]: { visibles, fijas } } });
  };

  return (
    <div className="tab-revision">
      <div
        ref={grid}
        className="tab-grid"
        role="grid"
        tabIndex={0}
        aria-label="Tabla de revisión"
        aria-rowcount={filasOrd.length + 1}
        aria-colcount={cols.length + 1}
        aria-activedescendant={activo && !edicion ? `cel-${activo.f}-${activo.c}` : undefined}
        aria-multiselectable
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
      >
        <div ref={scroll} className="tab-scroll scroll-fino">
          <div className="tab-cab" role="row" style={{ width: anchoTotal }}>
            <div className="tab-c tab-meta fija" style={{ left: 0, width: ANCHO_META }} role="columnheader">
              <button className="tab-cols-btn" onClick={() => setPanelCols((v) => !v)} aria-label="Configurar columnas" title="Columnas"><Columns3 size={14} /></button>
            </div>
            {cols.map((col, i) => (
              <div key={col.id} role="columnheader" className={`tab-c ${i < nFijas ? 'fija' : ''} ${i === nFijas - 1 ? 'ultima-fija' : ''}`} style={{ width: col.ancho, left: i < nFijas ? izq[i] : undefined }} aria-sort={orden?.col === col.id ? (orden.asc ? 'ascending' : 'descending') : 'none'}>
                <button className="tab-cab-btn" title={`${col.titulo} · pulsa para ordenar`} onClick={() => setOrden((o) => (o?.col === col.id ? (o.asc ? { col: col.id, asc: false } : null) : { col: col.id, asc: true }))}>
                  {col.titulo} {orden?.col === col.id ? (orden.asc ? '↑' : '↓') : ''}
                </button>
              </div>
            ))}
          </div>
          {filasOrd.length === 0 ? (
            <div className="vacio-estado" style={{ width: '100%' }}><b>Nada en esta vista</b><span>Cambia el filtro o la búsqueda.</span></div>
          ) : (
            <div style={{ height: virt.getTotalSize(), width: anchoTotal, position: 'relative' }}>
              {virt.getVirtualItems().map((vi) => {
                const f = filasOrd[vi.index];
                const esActiva = activo?.f === f.localId;
                const enRango = !!rango && vi.index >= rango.r1 && vi.index <= rango.r2;
                return (
                  <FilaTabla
                    key={f.localId}
                    f={f}
                    indice={vi.index}
                    top={vi.start - ALTO}
                    cols={cols}
                    izq={izq}
                    nFijas={nFijas}
                    anchoTotal={anchoTotal}
                    colActiva={esActiva ? activo!.c : null}
                    c1={enRango ? rango!.c1 : -1}
                    c2={enRango ? rango!.c2 : -1}
                    edicion={esActiva ? edicion : null}
                    errores={errores}
                    ctx={ctxCelda}
                    acc={acciones}
                  />
                );
              })}
            </div>
          )}
        </div>
        <datalist id="tab-catalogo">
          {ACTIVIDADES_SELECCIONABLES.map((a) => <option key={a.id} value={a.nombre} />)}
        </datalist>
      </div>

      <div className="tab-estado" role="status" aria-live="polite">
        {colActiva && filaActiva ? (
          <span className="tab-estado-celda">
            <b>{colActiva.titulo}</b> · {filaActiva.vacio ? 'Vacío' : filaActiva.nombre} ({filaActiva.calle} {filaActiva.numero ?? 's/n'})
            {motivoActiva ? <span className="muted"> · {motivoActiva}</span> : <span className="tab-ok"> · editable (Enter/F2)</span>}
            {nCeldas > 1 && <span> · {nCeldas} celdas</span>}
          </span>
        ) : (
          <span className="muted">Pulsa en una celda o usa las flechas. Enter/F2 edita · Esc cancela · Ctrl+C/Ctrl+V · Ctrl+Z/Ctrl+Y · Ctrl+Enter abre la ficha.</span>
        )}
        {mensaje && (
          <span className={`tab-msg ${mensaje.tipo}`} title={mensaje.t}>
            {mensaje.tipo === 'error' ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />} {mensaje.t}
          </span>
        )}
        <span className="esp" />
        {tarea === 'digital' && filaActiva && !filaActiva.vacio && filaActiva.negocioId && (
          <button
            className="btn s"
            disabled={!!motivoNoEditable(COLUMNA_POR_ID['dig.web'], filaActiva, ctxCelda) || filaActiva.digital === 'verificada'}
            onClick={() => {
              const negocioId = filaActiva.negocioId!;
              const ok = aplicar((d) => verificarDigital(d, negocioId, ctxCelda.campanaId, personaId, { alcance: ctxCelda.alcance }), `Presencia digital verificada · ${filaActiva.nombre}`, { silencioso: true, sinAvisoError: true });
              setMensaje(ok ? { t: `Presencia digital verificada · ${filaActiva.nombre}`, tipo: 'ok' } : { t: 'No se puede verificar: revisa las variables pendientes o incoherentes (ver ficha).', tipo: 'error' });
              enfocar();
            }}
            title={`Verifica solo la presencia digital de ${filaActiva.nombre} (${filaActiva.calle} ${filaActiva.numero ?? 's/n'}); no aprueba el registro`}
            aria-label={`Verificar presencia digital de ${filaActiva.nombre}`}
          >
            <ShieldCheck size={13} /> Verificar digital · <b className="tab-verificar-nombre">{filaActiva.nombre}</b>
          </button>
        )}
        <button className="btn s fantasma" disabled={!ultimaOp} onClick={deshacer} title={ultimaOp ? `Deshacer: ${ultimaOp} (Ctrl+Z)` : 'Nada que deshacer'} aria-label="Deshacer"><Undo2 size={13} /></button>
        <button className="btn s fantasma" disabled={!proximaRe} onClick={rehacer} title={proximaRe ? `Rehacer: ${proximaRe} (Ctrl+Y)` : 'Nada que rehacer'} aria-label="Rehacer"><Redo2 size={13} /></button>
        <span className={`tab-guardado ${guardado.estado}`} title="Los cambios se guardan en este navegador">
          {guardado.estado === 'pendiente' ? <><Loader2 size={12} className="girar" /> Guardando…</> : guardado.estado === 'error' ? <><AlertCircle size={12} /> Sin guardar en el navegador</> : <><CheckCircle2 size={12} /> Guardado</>}
        </span>
      </div>

      {panelCols && (
        <div className="tab-panel-cols panel-flotante" role="dialog" aria-label="Columnas">
          <div className="rotulo sin-linea">Columnas de «{tarea}»</div>
          {COLUMNAS.map((col) => {
            const vis = visiblesIds.includes(col.id);
            const fija = fijasIds.includes(col.id);
            return (
              <div key={col.id} className="tab-panel-col">
                <label>
                  <input type="checkbox" checked={vis} onChange={(e) => guardarCols(e.target.checked ? [...visiblesIds, col.id] : visiblesIds.filter((x) => x !== col.id), fijasIds)} /> {col.titulo}
                </label>
                <button className="btn s fantasma" disabled={!vis} aria-label={`${fija ? 'Desfijar' : 'Fijar'} ${col.titulo}`} onClick={() => guardarCols(visiblesIds, fija ? fijasIds.filter((x) => x !== col.id) : [...fijasIds, col.id])}>
                  {fija ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
              </div>
            );
          })}
          <div className="fila" style={{ marginTop: 8 }}>
            <button className="btn s" onClick={() => { const a = useStore.getState().prefs.oficina?.[personaId]?.columnas ?? {}; const { [tarea]: _, ...resto } = a; setPrefsOficina(personaId, { columnas: resto }); }}>Restablecer</button>
            <span className="esp" />
            <button className="btn s primario" onClick={() => setPanelCols(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

interface AccionesFila {
  pulsarCelda: (localId: Id, colId: string, shift: boolean) => void;
  dobleClic: () => void;
  cambiarEdicion: (texto: string) => void;
  teclaEditor: (e: KE<HTMLInputElement>) => void;
  abrirFicha: (id: Id) => void;
  cronologia: (id: Id) => void;
}

/** Fila memorizada: al moverse con el teclado solo se vuelven a pintar las filas afectadas. */
const FilaTabla = memo(function FilaTabla({ f, indice, top, cols, izq, nFijas, anchoTotal, colActiva, c1, c2, edicion, errores, ctx, acc }: {
  f: FilaOficina;
  indice: number;
  top: number;
  cols: Columna[];
  izq: number[];
  nFijas: number;
  anchoTotal: number;
  colActiva: string | null;
  c1: number;
  c2: number;
  edicion: { texto: string } | null;
  errores: Map<string, string>;
  ctx: CtxCelda;
  acc: AccionesFila;
}) {
  return (
    <div role="row" aria-rowindex={indice + 2} className={`tab-fila ${colActiva ? 'activa' : ''} ${f.bloqueado ? 'bloqueada' : ''} ${f.situacion === 'pendiente-visita' ? 'sin-visitar' : ''}`} style={{ top, height: ALTO, width: anchoTotal }}>
      <div className="tab-c tab-meta fija" style={{ left: 0, width: ANCHO_META }} role="rowheader">
        <button className="tab-ficha-btn" tabIndex={-1} onClick={() => acc.abrirFicha(f.localId)} aria-label={`Abrir ficha de ${f.vacio ? 'local vacío' : f.nombre}`} title="Ficha, histórico y conciliación (Ctrl+Enter)"><Info size={13} /></button>
        <Puntos f={f} />
        {f.bloqueado && <Lock size={11} aria-label="Bloqueado" />}
        {f.cronologiaIncierta.length > 0 && (
          <button className="tab-ficha-btn" tabIndex={-1} onClick={() => acc.cronologia(f.localId)} aria-label="Asignar fechas de cronología incierta" title="Cronología incierta: asignar fechas"><Clock size={12} /></button>
        )}
      </div>
      {cols.map((col, ci) => {
        const enRango = ci >= c1 && ci <= c2;
        const esCelda = colActiva === col.id;
        const err = errores.get(`${f.localId}|${col.id}`);
        return (
          <div
            key={col.id}
            id={`cel-${f.localId}-${col.id}`}
            role="gridcell"
            aria-selected={enRango}
            aria-readonly={!col.editor}
            aria-colindex={ci + 2}
            aria-invalid={err ? true : undefined}
            title={err}
            className={`tab-c ${ci < nFijas ? 'fija' : ''} ${ci === nFijas - 1 ? 'ultima-fija' : ''} ${col.editor ? 'editable' : ''} ${enRango ? 'rango' : ''} ${esCelda ? 'activa' : ''} ${err ? 'error' : ''} ${col.atenuada?.(f, ctx) ? 'atenuada' : ''}`}
            style={{ width: col.ancho, left: ci < nFijas ? izq[ci] : undefined }}
            onMouseDown={(e) => {
              if (esCelda && edicion) return;
              e.preventDefault();
              acc.pulsarCelda(f.localId, col.id, e.shiftKey);
            }}
            onDoubleClick={acc.dobleClic}
          >
            {esCelda && edicion ? (
              <input
                className="tab-editor"
                autoFocus
                aria-label={`Editar ${col.titulo}`}
                list={col.editor === 'actividad' ? 'tab-catalogo' : undefined}
                value={edicion.texto}
                inputMode={col.editor === 'numero' ? 'decimal' : undefined}
                onChange={(e) => acc.cambiarEdicion(e.target.value)}
                onKeyDown={acc.teclaEditor}
              />
            ) : (
              <span className="tab-v">{col.render ? col.render(f, ctx) : col.texto(f, ctx)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
});
