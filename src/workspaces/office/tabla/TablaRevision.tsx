import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as KE } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertCircle, CheckCircle2, CheckSquare, Clock, Columns3, GitCompare, Info, ListChecks, Loader2, Lock, Pin, PinOff, Redo2, ShieldCheck, Square, Undo2 } from 'lucide-react';
import { verificarDigital } from '../../../domain/digital';
import { useStore } from '../../../store/store';
import type { FilaOficina } from '../../../domain/oficina';
import type { Id, VariableDigital } from '../../../domain/types';
import { useCtxOficina } from '../contextoOficina';
import { Puntos } from '../ListaRegistros';
import { observarRectConRespaldo } from '../virtual';
import type { Tarea } from '../tareas';
import {
  COLUMNAS, COLUMNAS_TAREA, COLUMNA_POR_ID, ErrorCeldas, REFERENCIA_DE, aTSV, aplicarCambiosCeldas, motivoNoEditable, parseTSV,
  type CambioCelda, type Columna, type CtxCelda,
} from './columnas';
import { BuscadorClasificacion } from '../BuscadorClasificacion';
import { ModalAccionMasiva } from '../ModalAccionMasiva';
import { catalogoDeCampana } from '../../../domain/clasificacion';
import { textoClasificacion } from '../../../domain/buscador';
import '../../../styles/tabla-revision.css';

const ALTO = 34;
const ANCHO_META = 100;

/** Atajos de respuesta inmediata en columnas Sí/No (sin abrir editor). */
const ATAJOS: Record<string, { texto: string; t: string }> = {
  '1': { texto: '1', t: 'Sí' },
  '0': { texto: '0', t: 'No' },
  n: { texto: 'N/A', t: 'No aplicable' },
  N: { texto: 'N/A', t: 'No aplicable' },
  '?': { texto: '?', t: 'Sin información' },
};

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
  const comparar = useStore((s) => !!s.prefs.oficina?.[s.prefs.personaId]?.comparar?.[tarea]);
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
    let ids = visiblesIds;
    // «Comparar con la campaña anterior»: cada columna con referencia lleva al lado la suya (solo lectura).
    if (comparar) ids = ids.flatMap((id) => (REFERENCIA_DE[id] && !visiblesIds.includes(REFERENCIA_DE[id]) ? [id, REFERENCIA_DE[id]] : [id]));
    const vis = ids.map((id) => COLUMNA_POR_ID[id]).filter(Boolean);
    return [...vis.filter((c) => fijasIds.includes(c.id)), ...vis.filter((c) => !fijasIds.includes(c.id))];
  }, [visiblesIds, fijasIds, comparar]);
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
  /** Filas marcadas para una acción masiva (Espacio o casilla); si no hay, cuenta el rango de filas. */
  const [marcadas, setMarcadas] = useState<Set<Id>>(new Set());
  const [modalAccion, setModalAccion] = useState(false);
  const ultimoIndice = useRef(0);
  /** El cursor se movió porque el registro activo salió de la vista (no por la persona). */
  const movidoSolo = useRef(false);
  /** Último registro que la tabla comunicó como seleccionado (para reconocer su eco). */
  const enviado = useRef<Id | null>(null);
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
    const f = activo.f;
    const t = setTimeout(() => {
      enviado.current = f;
      onSel(f);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo?.f]);
  useEffect(() => {
    // El eco de nuestra propia selección (llega con retraso por la URL) no debe devolver el
    // cursor a una fila anterior si la persona ya ha seguido avanzando con el teclado.
    if (sel && sel === enviado.current) return;
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

  /** Confirma la edición (con `textoElegido` cuando lo aporta un editor especial, p. ej. el buscador). */
  const confirmar = (despues: Despues, textoElegido?: string) => {
    if (!edicion || !filaActiva || !colActiva || r0 === undefined) return;
    const texto = textoElegido ?? edicion.texto;
    const sinCambio = texto === edicion.original;
    // Re-confirmar una actividad importada o heredada la deja confirmada.
    const confirmaClasificacion = colActiva.id === 'actividad' && !!filaActiva.clasificacion && !filaActiva.clasificacion.confirmada;
    const siguiente = despues === 'abajo' ? filasOrd[Math.min(r0 + 1, filasOrd.length - 1)]?.localId : undefined;
    if (!sinCambio || confirmaClasificacion) {
      const ok = ejecutar([{ fila: filaActiva, col: colActiva, texto }], `${colActiva.titulo}${texto ? `: ${texto}` : ' vaciado'}`);
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

  /** Filas para una acción masiva: las marcadas o, si no hay, las del rango (si abarca varias). */
  const seleccion = useMemo(() => {
    if (marcadas.size) return filasOrd.filter((f) => marcadas.has(f.localId));
    if (rango && rango.r2 > rango.r1) return filasOrd.slice(rango.r1, rango.r2 + 1);
    return [];
  }, [marcadas, filasOrd, rango]);

  const alternarMarca = (ids: Id[]) =>
    setMarcadas((m) => {
      const n = new Set(m);
      const todas = ids.every((id) => n.has(id));
      for (const id of ids) {
        if (todas) n.delete(id);
        else n.add(id);
      }
      return n;
    });

  /**
   * Siguiente celda adecuada tras una respuesta inmediata. En presencia digital: la siguiente
   * variable exigible y sin responder (misma fila y después las siguientes). En el resto de tareas:
   * la misma columna en la fila siguiente. Se calcula con los datos ya actualizados.
   */
  const avanzar = (r: number, c: number) => {
    const ctxN: CtxCelda = { ...ctxCelda, db: useStore.getState().db! };
    if (tarea === 'digital') {
      const hasta = Math.min(filasOrd.length, r + 200);
      for (let i = r; i < hasta; i++) {
        for (let j = i === r ? c + 1 : 0; j < cols.length; j++) {
          const col = cols[j];
          if (!col.id.startsWith('dig.') || !col.editor) continue;
          const f = filasOrd[i];
          if (motivoNoEditable(col, f, ctxN) || col.atenuada?.(f, ctxN) || col.texto(f, ctxN) !== '') continue;
          setActivo({ f: f.localId, c: col.id });
          setAncla(null);
          asegurarVisible(i, j);
          return;
        }
      }
    }
    const siguiente = filasOrd[r + 1];
    if (!siguiente) return;
    setActivo({ f: siguiente.localId, c: cols[c].id });
    setAncla(null);
    asegurarVisible(r + 1, c);
  };

  /** Respuesta inmediata (1/0/N/?) en la celda activa o en todas las del rango (atómico). */
  const responder = (atajo: { texto: string; t: string }) => {
    if (!filaActiva || !colActiva || r0 === undefined) return;
    const celdas = nCeldas > 1 ? celdasDelRango() : [{ fila: filaActiva, col: colActiva }];
    if (celdas.some((x) => x.col.editor !== 'respuesta')) {
      setMensaje({ t: 'Los atajos 1/0/N/? solo se aplican a columnas Sí/No. No se ha aplicado ningún cambio.', tipo: 'error' });
      return;
    }
    const ok = ejecutar(celdas.map((x) => ({ ...x, texto: atajo.texto })), `${colActiva.titulo}: ${atajo.t}${celdas.length > 1 ? ` · ${celdas.length} celdas` : ''}`);
    if (ok && celdas.length === 1) avanzar(r0, c0);
  };

  const onKeyDown = (e: KE<HTMLDivElement>) => {
    if (edicion || !filasOrd.length) return;
    // Nunca se interceptan teclas dirigidas a un campo de texto (buscador, descripción…).
    if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return;
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
        setMarcadas(new Set());
        setMensaje(null);
        return;
      case ' ':
        // Espacio marca o desmarca la fila (Mayús+Espacio: todas las del rango) para una acción masiva.
        e.preventDefault();
        if (r < 0) return;
        alternarMarca(e.shiftKey && rango ? filasOrd.slice(rango.r1, rango.r2 + 1).map((f) => f.localId) : [filasOrd[r].localId]);
        return;
      case 'F10':
      case 'ContextMenu':
        if (k === 'F10' && !e.shiftKey) return;
        e.preventDefault();
        if (seleccion.length) setModalAccion(true);
        else setMensaje({ t: 'Selecciona antes varias filas (Espacio o Mayús+↓) para una acción masiva.', tipo: 'info' });
        return;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        vaciar();
        return;
      default:
        if (ATAJOS[k] && !e.altKey && r >= 0 && colActiva?.editor === 'respuesta') {
          e.preventDefault();
          const motivo = motivoNoEditable(colActiva, filaActiva!, ctxCelda);
          if (motivo && nCeldas === 1) setMensaje({ t: `${colActiva.titulo}: ${motivo}`, tipo: 'info' });
          else responder(ATAJOS[k]);
          return;
        }
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
  const ultimo = useRef({ edicion, activo, confirmar, empezarEdicion, cancelar, onAbrirFicha, onCronologia, enfocar, alternarMarca });
  ultimo.current = { edicion, activo, confirmar, empezarEdicion, cancelar, onAbrirFicha, onCronologia, enfocar, alternarMarca };
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
      confirmarCon: (texto, despues) => ultimo.current.confirmar(despues, texto),
      cancelarEdicion: () => ultimo.current.cancelar(),
      teclaEditor: (e) => {
        e.stopPropagation();
        const u = ultimo.current;
        if (e.key === 'Enter') { e.preventDefault(); u.confirmar('abajo'); }
        else if (e.key === 'Tab') { e.preventDefault(); u.confirmar(e.shiftKey ? 'izquierda' : 'derecha'); }
        else if (e.key === 'Escape') { e.preventDefault(); u.cancelar(); }
      },
      abrirFicha: (id) => ultimo.current.onAbrirFicha(id),
      marcar: (id) => ultimo.current.alternarMarca([id]),
      cronologia: (id) => ultimo.current.onCronologia(id),
    }),
    [],
  );

  const ultimaOp = pilaDeshacer[pilaDeshacer.length - 1]?.etiqueta;
  const refId = db.campanas[ctxCelda.campanaId]?.campanaReferenciaId;
  const anioRef = refId ? db.campanas[refId]?.anio ?? 'anterior' : 'anterior';
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
              <div key={col.id} role="columnheader" className={`tab-c ${i < nFijas ? 'fija' : ''} ${i === nFijas - 1 ? 'ultima-fija' : ''} ${col.referencia ? 'ref' : ''}`} style={{ width: col.ancho, left: i < nFijas ? izq[i] : undefined }} aria-sort={orden?.col === col.id ? (orden.asc ? 'ascending' : 'descending') : 'none'}>
                <button className="tab-cab-btn" title={`${col.tituloDe?.(ctxCelda) ?? col.titulo}${col.referencia ? ' · referencia de solo lectura' : ''} · pulsa para ordenar`} onClick={() => setOrden((o) => (o?.col === col.id ? (o.asc ? { col: col.id, asc: false } : null) : { col: col.id, asc: true }))}>
                  {col.tituloDe?.(ctxCelda) ?? col.titulo} {orden?.col === col.id ? (orden.asc ? '↑' : '↓') : ''}
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
                    marcada={marcadas.has(f.localId)}
                    errores={errores}
                    ctx={ctxCelda}
                    acc={acciones}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="tab-estado" role="status" aria-live="polite">
        {colActiva && filaActiva ? (
          <span className="tab-estado-celda">
            <b>{colActiva.titulo}</b> · {filaActiva.vacio ? 'Vacío' : filaActiva.nombre} ({filaActiva.calle} {filaActiva.numero ?? 's/n'})
            {motivoActiva ? <span className="muted"> · {motivoActiva}</span> : <span className="tab-ok"> · {colActiva.editor === 'respuesta' ? `1 Sí · 0 No${colActiva.id === 'franquicia' ? '' : ' · N N/A'} · ? sin info · Supr pendiente` : 'editable (Enter/F2)'}</span>}
            {nCeldas > 1 && <span> · {nCeldas} celdas</span>}
          </span>
        ) : (
          <span className="muted">Pulsa en una celda o usa las flechas. Enter/F2 edita · 1/0/N/? responde · Espacio marca · Ctrl+C/Ctrl+V · Ctrl+Z/Ctrl+Y · Ctrl+Enter abre la ficha.</span>
        )}
        {mensaje && (
          <span className={`tab-msg ${mensaje.tipo}`} title={mensaje.t}>
            {mensaje.tipo === 'error' ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />} {mensaje.t}
          </span>
        )}
        <span className="esp" />
        {seleccion.length > 0 && (
          <span className="tab-sel" role="group" aria-label="Selección">
            <b>{seleccion.length}</b> fila(s)
            <button className="btn s primario" onClick={() => setModalAccion(true)} title="Acción sobre la selección (Mayús+F10)"><ListChecks size={13} /> Acciones…</button>
            {marcadas.size > 0 && <button className="btn s fantasma" onClick={() => { setMarcadas(new Set()); enfocar(); }}>Quitar</button>}
          </span>
        )}
        <button
          className={`btn s ${comparar ? 'on' : 'fantasma'}`}
          aria-pressed={comparar}
          onClick={() => { const a = useStore.getState().prefs.oficina?.[personaId]?.comparar ?? {}; setPrefsOficina(personaId, { comparar: { ...a, [tarea]: !comparar } }); enfocar(); }}
          title="Muestra junto a cada dato el de la campaña anterior (solo lectura; «≠» = era otro negocio)"
        >
          <GitCompare size={13} /> Comparar con {anioRef}
        </button>
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

      {modalAccion && seleccion.length > 0 && (
        <ModalAccionMasiva
          filas={seleccion}
          campanaId={ctxCelda.campanaId}
          personaId={personaId}
          alcance={ctxCelda.alcance}
          bloqueado={ctxCelda.bloqueado}
          variableInicial={colActiva?.editor === 'respuesta' ? (colActiva.id === 'franquicia' ? 'franquicia' : (colActiva.id.slice(4) as VariableDigital)) : tarea === 'digital' ? 'web' : 'franquicia'}
          onCerrar={() => { setModalAccion(false); setTimeout(enfocar, 0); }}
          onHecho={(t) => { setMensaje({ t, tipo: 'ok' }); setMarcadas(new Set()); setAncla(null); }}
        />
      )}
      {panelCols && (
        <div className="tab-panel-cols panel-flotante" role="dialog" aria-label="Columnas">
          <div className="rotulo sin-linea">Columnas de «{tarea}»</div>
          {COLUMNAS.map((col) => {
            const vis = visiblesIds.includes(col.id);
            const fija = fijasIds.includes(col.id);
            return (
              <div key={col.id} className="tab-panel-col">
                <label>
                  <input type="checkbox" checked={vis} onChange={(e) => guardarCols(e.target.checked ? [...visiblesIds, col.id] : visiblesIds.filter((x) => x !== col.id), fijasIds)} /> {col.tituloDe?.(ctxCelda) ?? col.titulo}
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
  confirmarCon: (texto: string, despues: Despues) => void;
  cancelarEdicion: () => void;
  teclaEditor: (e: KE<HTMLInputElement>) => void;
  abrirFicha: (id: Id) => void;
  cronologia: (id: Id) => void;
  marcar: (id: Id) => void;
}

/** Fila memorizada: al moverse con el teclado solo se vuelven a pintar las filas afectadas. */
const FilaTabla = memo(function FilaTabla({ f, indice, top, cols, izq, nFijas, anchoTotal, colActiva, c1, c2, edicion, marcada, errores, ctx, acc }: {
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
  marcada: boolean;
  errores: Map<string, string>;
  ctx: CtxCelda;
  acc: AccionesFila;
}) {
  return (
    <div role="row" aria-rowindex={indice + 2} aria-selected={marcada || undefined} className={`tab-fila ${colActiva ? 'activa' : ''} ${marcada ? 'marcada' : ''} ${f.bloqueado ? 'bloqueada' : ''} ${f.situacion === 'pendiente-visita' ? 'sin-visitar' : ''}`} style={{ top, height: ALTO, width: anchoTotal }}>
      <div className="tab-c tab-meta fija" style={{ left: 0, width: ANCHO_META }} role="rowheader">
        <button className="tab-ficha-btn tab-marca" tabIndex={-1} onClick={() => acc.marcar(f.localId)} aria-pressed={marcada} aria-label={`${marcada ? 'Desmarcar' : 'Marcar'} ${f.vacio ? 'local vacío' : f.nombre}`} title="Marcar para una acción masiva (Espacio)">
          {marcada ? <CheckSquare size={13} /> : <Square size={13} />}
        </button>
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
            className={`tab-c ${ci < nFijas ? 'fija' : ''} ${ci === nFijas - 1 ? 'ultima-fija' : ''} ${col.referencia ? 'ref' : ''} ${col.editor ? 'editable' : ''} ${enRango ? 'rango' : ''} ${esCelda ? 'activa' : ''} ${err ? 'error' : ''} ${col.atenuada?.(f, ctx) ? 'atenuada' : ''}`}
            style={{ width: col.ancho, left: ci < nFijas ? izq[ci] : undefined }}
            onMouseDown={(e) => {
              if (esCelda && edicion) return;
              e.preventDefault();
              acc.pulsarCelda(f.localId, col.id, e.shiftKey);
            }}
            onDoubleClick={acc.dobleClic}
          >
            {esCelda && edicion && col.editor === 'actividad' ? (
              <BuscadorClasificacion
                flotante
                catalogo={catalogoDeCampana(ctx.db, ctx.campanaId)}
                nombreNegocio={f.vacio ? undefined : f.nombre}
                inicial={edicion.texto}
                etiqueta={`Editar ${col.titulo}`}
                onElegir={(e, tecla) => acc.confirmarCon(textoClasificacion(e.opcion.nodoId, e.descripcion), tecla === 'tab' ? 'derecha' : tecla === 'shift-tab' ? 'izquierda' : tecla === 'clic' ? 'nada' : 'abajo')}
                onCancelar={acc.cancelarEdicion}
              />
            ) : esCelda && edicion ? (
              <input
                className="tab-editor"
                autoFocus
                aria-label={`Editar ${col.titulo}`}
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
