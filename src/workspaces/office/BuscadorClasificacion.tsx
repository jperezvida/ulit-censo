import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Lightbulb } from 'lucide-react';
import { useStore } from '../../store/store';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { buscarClasificacion, sugerirPorNombre, type OpcionClasificacion, type Resultado } from '../../domain/buscador';
import '../../styles/clasificacion.css';

/**
 * Buscador predictivo de clasificación (tabla y ficha).
 *
 * Teclado: escribir filtra · ↑/↓ recorre · Enter elige · Tab elige y avanza (en la tabla) ·
 * Esc vuelve atrás o cancela. Si el texto corresponde a varias clasificaciones, no hay ninguna
 * marcada: hay que elegir con ↑/↓. Elegir un subgrupo con actividades pide una breve descripción.
 * Las sugerencias por el nombre del establecimiento son PROPUESTAS: se aplican solo al elegirlas.
 */
export interface Eleccion {
  opcion: OpcionClasificacion;
  /** Descripción final (de un ejemplo, o tecleada para un subgrupo sin actividad adecuada). */
  descripcion?: string;
}

interface Item extends OpcionClasificacion {
  seccion: 'nombre' | 'reciente' | 'resultado';
  motivo?: string;
}

/** Referencia estable: una lista nueva en cada render recalcularía la lista y perdería la selección. */
const SIN_RECIENTES: string[] = [];

export function BuscadorClasificacion({
  catalogo, nombreNegocio, inicial = '', onElegir, onCancelar, flotante = false, autoFocus = true, etiqueta = 'Buscar actividad',
}: {
  catalogo: string;
  /** Nombre comercial: para proponer clasificaciones (nunca se aplican solas). */
  nombreNegocio?: string;
  inicial?: string;
  onElegir: (e: Eleccion, tecla: 'enter' | 'tab' | 'shift-tab' | 'clic') => void;
  onCancelar?: () => void;
  /** En la celda de la tabla la lista flota sobre la tabla (no queda recortada). */
  flotante?: boolean;
  autoFocus?: boolean;
  etiqueta?: string;
}) {
  // En un espacio de trabajo no se leen ni guardan las preferencias de la demostración (recientes y usos).
  const fuente = useFuenteOficina();
  const personaId = useStore((s) => s.prefs.personaId);
  const prefsDemo = useStore((s) => s.prefs.oficina?.[s.prefs.personaId]);
  const setPrefsDemo = useStore((s) => s.setPrefsOficina);
  const prefs = fuente ? undefined : prefsDemo;
  const setPrefsOficina: typeof setPrefsDemo = (id, p) => { if (!fuente) setPrefsDemo(id, p); };
  // Al editar una clasificación con descripción se busca por la clasificación, sin la descripción.
  const [q, setQ] = useState(() => inicial.split(' · ')[0]);
  const [sel, setSel] = useState<number>(-1);
  const [paso, setPaso] = useState<{ opcion: OpcionClasificacion; descripcion: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
  /** En la ficha, la lista solo se despliega con el foco (no ocupa espacio en reposo). */
  const [foco, setFoco] = useState(autoFocus);

  const recientes = prefs?.recientesActividad?.[catalogo] ?? SIN_RECIENTES;
  const usos = prefs?.usosActividad?.[catalogo];
  const { items, ambiguo } = useMemo(() => {
    const out: Item[] = [];
    let amb = false;
    if (!q.trim()) {
      if (nombreNegocio) {
        const s = sugerirPorNombre(catalogo, nombreNegocio);
        out.push(...s.sugerencias.map((x) => ({ ...x, seccion: 'nombre' as const })));
        amb = s.ambiguo;
      }
      const r = buscarClasificacion(catalogo, '', { recientes, usos, limite: 6 }).resultados;
      out.push(...r.filter((x) => !out.some((o) => o.clave === x.clave)).map((x) => ({ ...x, seccion: 'reciente' as const })));
    } else {
      const r = buscarClasificacion(catalogo, q, { recientes, usos, limite: 14 });
      out.push(...r.resultados.map((x: Resultado) => ({ ...x, seccion: 'resultado' as const })));
      amb = r.ambiguo;
    }
    return { items: out, ambiguo: amb };
  }, [catalogo, q, nombreNegocio, recientes, usos]);

  // Selección por defecto: la primera, salvo que sea ambiguo o solo haya propuestas/recientes.
  useEffect(() => {
    setSel(!ambiguo && items.length && items[0].seccion === 'resultado' ? 0 : -1);
    setAviso(null);
  }, [items, ambiguo]);

  useLayoutEffect(() => {
    if (!flotante || !input.current) return;
    const r = input.current.getBoundingClientRect();
    const alto = Math.min(380, window.innerHeight - r.bottom - 12);
    const arriba = alto < 200 && r.top > 260;
    // Encima de la celda se ancla por abajo: la lista crece hacia arriba sin dejar hueco.
    const ancho = Math.max(r.width, 460);
    const left = Math.min(r.left, window.innerWidth - ancho - 8);
    setPos(arriba ? { left, bottom: window.innerHeight - r.top + 2, width: ancho } : { left, top: r.bottom + 2, width: ancho });
  }, [flotante, q, paso]);

  const recordar = (o: OpcionClasificacion) => {
    const recs = [o.clave, ...recientes.filter((k) => k !== o.clave)].slice(0, 8);
    const u = { ...(usos ?? {}), [o.clave]: (usos?.[o.clave] ?? 0) + 1 };
    setPrefsOficina(personaId, {
      recientesActividad: { ...(prefs?.recientesActividad ?? {}), [catalogo]: recs },
      usosActividad: { ...(prefs?.usosActividad ?? {}), [catalogo]: u },
    });
  };

  const elegir = (o: OpcionClasificacion, tecla: 'enter' | 'tab' | 'shift-tab' | 'clic') => {
    if (o.requiereDescripcion) {
      setPaso({ opcion: o, descripcion: q.trim() && q.trim().toLowerCase() !== o.etiqueta.toLowerCase() ? q.trim() : '' });
      return;
    }
    recordar(o);
    onElegir({ opcion: o, descripcion: o.descripcion }, tecla);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (paso) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (!paso.descripcion.trim()) {
          setAviso('Escribe una breve descripción de la actividad.');
          return;
        }
        recordar(paso.opcion);
        onElegir({ opcion: paso.opcion, descripcion: paso.descripcion.trim() }, e.key === 'Tab' ? (e.shiftKey ? 'shift-tab' : 'tab') : 'enter');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPaso(null);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const tecla = e.key === 'Tab' ? (e.shiftKey ? 'shift-tab' : 'tab') : 'enter';
      if (sel >= 0 && items[sel]) elegir(items[sel], tecla);
      else if (ambiguo) setAviso(`Hay ${items.filter((i) => i.etiqueta.toLowerCase() === items[0]?.etiqueta.toLowerCase()).length} clasificaciones posibles: elige una con ↑/↓.`);
      else if (!items.length) setAviso(q.trim() ? 'Sin coincidencias en el catálogo. Busca el subgrupo y añade una breve descripción.' : 'Escribe para buscar.');
      else setAviso('Elige una opción con ↑/↓ y pulsa Enter.');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancelar?.();
    }
  };

  const lista = (
    <div
      className={`bc-lista ${flotante ? 'flotante panel-flotante' : ''}`}
      style={flotante && pos ? { ...pos, maxHeight: Math.max(160, Math.min(380, window.innerHeight - (pos.bottom ?? pos.top ?? 0) - 8)) } : undefined}
      onMouseDown={(e) => e.preventDefault()}
    >
      {paso ? (
        <div className="bc-paso">
          <div className="muted bc-ruta">{paso.opcion.ruta}</div>
          <div className="bc-paso-t">El subgrupo tiene actividades; si ninguna encaja, añade una breve descripción:</div>
          {aviso && <div className="bc-aviso" role="alert">{aviso}</div>}
        </div>
      ) : (
        <>
          {aviso && <div className="bc-aviso" role="alert">{aviso}</div>}
          {ambiguo && !aviso && <div className="bc-aviso">Varias clasificaciones con ese nombre: elige una con ↑/↓.</div>}
          <ul role="listbox" id="bc-opciones" aria-label="Clasificaciones">
            {items.map((o, i) => (
              <li
                key={`${o.seccion}-${o.clave}`}
                id={`bc-op-${i}`}
                role="option"
                aria-selected={i === sel}
                className={`bc-op ${i === sel ? 'on' : ''} t-${o.tipo}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => elegir(o, 'clic')}
              >
                <span className="bc-op-t">
                  {o.seccion === 'nombre' && <Lightbulb size={12} aria-label="Propuesta por el nombre" />}
                  {o.seccion === 'reciente' && <Clock size={12} aria-label="Usada recientemente" />}
                  <b>{o.etiqueta}</b>
                  {o.tipo === 'subgrupo' && o.requiereDescripcion && <span className="tag">sin actividad · con descripción</span>}
                  {o.tipo === 'ejemplo' && <span className="tag">descripción</span>}
                  {o.seccion === 'nombre' && <span className="tag naranja">propuesta: {o.motivo}</span>}
                </span>
                <span className="bc-ruta">{o.ruta}{o.seccion === 'resultado' && o.motivo ? ` · ${o.motivo}` : ''}</span>
              </li>
            ))}
            {!items.length && q.trim() && <li className="bc-vacio">Sin coincidencias. Busca el subgrupo (p. ej. «servicios médicos») para añadir una descripción.</li>}
            {!items.length && !q.trim() && <li className="bc-vacio">Escribe parte del nombre, una palabra clave o un ejemplo.</li>}
          </ul>
        </>
      )}
      <div className="bc-pie muted">{paso ? 'Enter aceptar · Esc volver' : '↑/↓ elegir · Enter aceptar · Esc cancelar'}</div>
    </div>
  );

  return (
    <div className="bc">
      <input
        ref={input}
        className={flotante ? 'tab-editor' : 'input'}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded
        aria-controls="bc-opciones"
        aria-activedescendant={!paso && sel >= 0 ? `bc-op-${sel}` : undefined}
        aria-label={paso ? `Descripción para ${paso.opcion.etiqueta}` : etiqueta}
        placeholder={paso ? 'Breve descripción de la actividad' : 'Actividad, palabra clave o ejemplo…'}
        value={paso ? paso.descripcion : q}
        onChange={(e) => (paso ? setPaso({ ...paso, descripcion: e.target.value }) : setQ(e.target.value))}
        onKeyDown={onKeyDown}
        onFocus={() => setFoco(true)}
        onBlur={() => setFoco(false)}
      />
      {flotante ? createPortal(lista, document.body) : (foco || q || paso) && lista}
    </div>
  );
}
