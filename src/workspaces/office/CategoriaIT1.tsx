import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, SkipForward, XCircle } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { capacidadCategoriaIT1, type CapacidadCategoriaIT1 } from '../../store/categoriaIT1Real';
import type { DecisionCategoriaIT1 } from '../../store/colaCategoriaIT1';
import {
  CLAVES_CATEGORIA, categoriaTexto, categoriasDelCatalogo, categoriasFrecuentes,
  claveCategoria2026, prepararRevisionCategoriaIT1, repartirPasosCategoria,
  type FilaPasoCategoria,
} from '../../domain/revisionCategoriaIT1';
import { sugerirPorNombre } from '../../domain/buscador';
import { ID_CATALOGO_2026 } from '../../domain/catalogo2026';
import { BuscadorClasificacion, type Eleccion } from './BuscadorClasificacion';
import '../../styles/categoria-it1.css';

type Paso = 1 | 2;
type PorPaso<T> = Record<Paso, T>;
const SIN_COLA: DecisionCategoriaIT1[] = [];

/** Estado legible de una fila para la persona: decisión y si está guardada o por guardar. */
function estadoFila(f: FilaPasoCategoria): { texto: string; clase: string } | null {
  const estado = f.revision?.estado;
  if (f.enCola) {
    const accion = f.enCola.accion === 'aceptar' ? 'Aceptada'
      : f.enCola.accion === 'rechazar' ? 'Rechazada' : 'Categoría elegida';
    return { texto: `${accion} · por guardar`, clase: 'categoria-pendiente' };
  }
  if (estado === 'aceptada' && f.confirmada) return { texto: 'Aceptada · guardada', clase: 'categoria-ok' };
  if (estado === 'corregida' && f.confirmada) return { texto: 'Categoría elegida · guardada', clase: 'categoria-ok' };
  if (estado === 'rechazada') return { texto: 'Rechazada · guardada', clase: 'categoria-rechazo' };
  return null;
}

/**
 * Categorización IT1 en dos pasos separados, en la misma pantalla:
 * 1. Validar las categorías del Excel, una a una (Enter acepta, N/Supr rechaza, ← vuelve).
 * 2. Categorizar los negocios sin categoría y los rechazados con el buscador del catálogo.
 * Avanzar es inmediato: las decisiones van a la cola de guardado y solo cuentan como
 * guardadas cuando el servidor las confirma.
 */
export default function CategoriaIT1() {
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const filas = useMemo(() => campana ? prepararRevisionCategoriaIT1(db, campana.id) : [],
    [db, campana?.id]);
  const frecuentes = useMemo(() => categoriasFrecuentes(filas), [filas]);
  const cola = fuente?.estadoColaCategoriaIT1?.pendientes ?? SIN_COLA;
  const errorCola = fuente?.estadoColaCategoriaIT1?.error ?? '';
  const repartidas = useMemo(() => repartirPasosCategoria(filas, cola), [filas, cola]);
  const porId = useMemo(() => new Map(repartidas.map((f) => [f.fila.id, f])), [repartidas]);

  const [saltados, setSaltados] = useState<string[]>([]);
  const pendientes1 = repartidas.filter((f) => f.paso === 1 && f.pendiente);
  const pendientes2 = useMemo(() => {
    const p = repartidas.filter((f) => f.paso === 2 && f.pendiente);
    const pos = (id: string) => saltados.indexOf(id);
    return [...p.filter((f) => pos(f.fila.id) < 0),
      ...p.filter((f) => pos(f.fila.id) >= 0).sort((a, b) => pos(a.fila.id) - pos(b.fila.id))];
  }, [repartidas, saltados]);
  const total1 = repartidas.filter((f) => f.tienePropuesta).length;
  const total2 = repartidas.filter((f) => f.paso === 2).length;
  const guardadas = filas.filter((f) => f.confirmada).length;

  const [paso, setPaso] = useState<Paso>(() => pendientes1.length || !pendientes2.length ? 1 : 2);
  /** Fichas decididas en esta sesión (para volver atrás), y la ficha que se está viendo. */
  const [historial, setHistorial] = useState<PorPaso<string[]>>({ 1: [], 2: [] });
  const [viendo, setViendo] = useState<PorPaso<string | null>>({ 1: null, 2: null });
  const [error, setError] = useState('');
  const [buscaNegocio, setBuscaNegocio] = useState('');
  const tarjeta = useRef<HTMLElement>(null);

  const [capacidad, setCapacidad] = useState<CapacidadCategoriaIT1>(
    { habilitada: false, motivo: 'Comprobando permiso…' });
  useEffect(() => {
    if (!fuente?.soloLectura || campana?.anio !== 2026) return;
    let activa = true;
    void capacidadCategoriaIT1().then((r) => { if (activa) setCapacidad(r); })
      .catch(() => { if (activa) setCapacidad({
        habilitada: false, motivo: 'No se ha podido verificar la autorización.'
      }); });
    return () => { activa = false; };
  }, [campana?.id, campana?.anio, fuente?.soloLectura]);

  const idVisto = viendo[paso];
  const actual = (idVisto ? porId.get(idVisto) : undefined)
    ?? (paso === 1 ? pendientes1[0] : pendientes2[0]);
  const enHistorial = !!idVisto && porId.has(idVisto);
  const motivoBloqueo = errorCola ? 'El guardado está detenido: reintenta antes de seguir decidiendo.'
    : !fuente?.encolarCategoriaIT1 || !capacidad.habilitada
      ? capacidad.motivo || 'El guardado no está autorizado por el servidor.' : '';

  const propuesta = useMemo(() => actual && paso === 2
    ? sugerirPorNombre(ID_CATALOGO_2026, actual.fila.nombre) : null, [actual?.fila.id, paso]);
  const claveRechazada = actual && paso === 2 && actual.tienePropuesta
    ? claveCategoria2026(actual.existentes) : undefined;
  const frecuentesFicha = useMemo(() => claveRechazada
    ? frecuentes.filter((k) => k !== claveRechazada) : frecuentes, [frecuentes, claveRechazada]);

  // Foco en la ficha al cambiar de paso: Enter/N/← funcionan sin hacer clic antes.
  useEffect(() => {
    if (paso === 1) tarjeta.current?.focus({ preventScroll: true });
  }, [paso]);

  const irA = (p: Paso, id: string | null) => {
    setViendo((v) => ({ ...v, [p]: id }));
    setError('');
  };
  /** Tras decidir: siguiente del historial si se estaba repasando; si no, el siguiente pendiente. */
  const avanzar = (p: Paso, id: string) => {
    const lista = historial[p];
    const i = lista.indexOf(id);
    setHistorial((h) => h[p].includes(id) ? h : { ...h, [p]: [...h[p], id] });
    irA(p, viendo[p] && i >= 0 ? lista[i + 1] ?? null : null);
  };
  const anterior = () => {
    const lista = historial[paso];
    const i = idVisto ? lista.indexOf(idVisto) : lista.length;
    const previo = i > 0 ? lista[i - 1] : i < 0 ? lista[lista.length - 1] : undefined;
    if (previo) irA(paso, previo);
  };
  const siguiente = () => {
    if (!idVisto) return;
    const lista = historial[paso];
    const i = lista.indexOf(idVisto);
    irA(paso, i >= 0 ? lista[i + 1] ?? null : null);
  };

  const encolar = (decision: DecisionCategoriaIT1): boolean => {
    if (motivoBloqueo) { setError(motivoBloqueo); return false; }
    if (!fuente?.encolarCategoriaIT1?.(decision)) {
      setError('No se ha podido añadir la decisión a la cola de guardado. Revisa el aviso de guardado.');
      return false;
    }
    return true;
  };

  const decidirPaso1 = (accion: 'aceptar' | 'rechazar') => {
    if (!actual || paso !== 1) return;
    if (actual.enCola) {
      setError('Esta decisión todavía se está guardando. Podrás cambiarla cuando el servidor la confirme.');
      return;
    }
    if (actual.revision?.estado === 'corregida') {
      setError('Este negocio ya tiene una categoría elegida en el paso 2. Cámbiala desde el paso 2.');
      return;
    }
    const yaGuardada = accion === 'aceptar'
      ? actual.revision?.estado === 'aceptada' && actual.confirmada
      : actual.revision?.estado === 'rechazada';
    if (!yaGuardada && !encolar({ registroId: actual.fila.id, accion, valores: actual.efectivos })) return;
    setError('');
    avanzar(1, actual.fila.id);
  };

  const elegirPaso2 = (e: Eleccion) => {
    if (!actual || paso !== 2) return;
    let valores;
    try { valores = categoriasDelCatalogo(e.opcion.nodoId, e.descripcion ?? ''); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); return; }
    if (actual.enCola && actual.enCola.accion !== 'rechazar') {
      setError('La categoría anterior de este negocio todavía se está guardando. Espera a que se confirme.');
      return;
    }
    const igual = !actual.enCola && actual.confirmada
      && CLAVES_CATEGORIA.every((k) => actual.efectivos[k] === valores[k]);
    if (!igual && !encolar({ registroId: actual.fila.id, accion: 'corregir', valores })) return;
    setError('');
    setSaltados((s) => s.filter((x) => x !== actual.fila.id));
    avanzar(2, actual.fila.id);
  };

  const saltar = () => {
    if (!actual || paso !== 2 || enHistorial || pendientes2.length < 2) return;
    setSaltados((s) => [...s.filter((x) => x !== actual.fila.id), actual.fila.id]);
    setError('');
  };

  // Teclado del paso 1: Enter acepta · N/Supr rechaza · ←/→ recorre lo ya decidido.
  useEffect(() => {
    if (paso !== 1) return;
    const alPulsar = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return;
      const t = ev.target;
      if (t instanceof HTMLElement
        && t.closest('input,textarea,select,button,a,summary,[contenteditable="true"]')) return;
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); anterior(); return; }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); siguiente(); return; }
      if (ev.repeat) return;
      if (ev.key === 'Enter') { ev.preventDefault(); decidirPaso1('aceptar'); }
      else if (ev.key === 'n' || ev.key === 'N' || ev.key === 'Delete') {
        ev.preventDefault(); decidirPaso1('rechazar');
      }
    };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  });

  const cambiarPaso = (p: Paso) => { setPaso(p); setError(''); };
  const resultadosNegocio = buscaNegocio.trim().length < 2 ? [] : repartidas.filter((f) =>
    [f.fila.nombre, f.fila.direccion, f.fila.numero, String(f.fila.registro.fila)].join(' ')
      .toLocaleLowerCase('es').includes(buscaNegocio.trim().toLocaleLowerCase('es'))).slice(0, 8);
  const abrirNegocio = (f: FilaPasoCategoria) => {
    setPaso(f.paso);
    irA(f.paso, f.fila.id);
    setBuscaNegocio('');
  };

  if (!campana) return null;
  if (campana.anio !== 2026) return <main className="pagina"><p>Esta revisión corresponde únicamente a Medina 2026.</p></main>;

  const hecho1 = total1 - pendientes1.length;
  const hecho2 = total2 - pendientes2.length;
  const estado = actual ? estadoFila(actual) : null;
  const pulsadorSinFoco = { onMouseDown: (e: MouseEvent) => e.preventDefault() };
  /** En el paso 1 no se puede cambiar una decisión que aún se está guardando o ya corregida en el paso 2. */
  const bloqueadaFicha1 = !!actual && (!!actual.enCola || actual.revision?.estado === 'corregida');
  const puedeAtras = historial[paso].length > 0 && (!idVisto || historial[paso].indexOf(idVisto) !== 0);

  return <main className="pagina categoria-it1">
    <header className="categoria-cab">
      <Link to="/oficina" className="btn s fantasma"><ArrowLeft size={15}/> Volver a Oficina</Link>
      <span className="rotulo">Oficina · IT1 · Fase 3</span>
      <h1>Categorización de negocios</h1>
    </header>

    <div className="categoria-resumen" role="status" aria-label="Estado del guardado">
      <span><b>{pendientes1.length + pendientes2.length}</b> pendientes de revisar</span>
      <span className={cola.length ? 'categoria-resumen-cola' : ''}><b>{cola.length}</b> decisiones por guardar</span>
      <span><b>{guardadas}</b> de {filas.length} guardadas en el servidor</span>
    </div>
    {errorCola && <p role="alert" className="categoria-advertencia">Guardado detenido: {errorCola}. Las decisiones no confirmadas siguen en la cola y no cuentan como guardadas. <button className="btn s" onClick={() => fuente?.reintentarColaCategoriaIT1?.()}>Reintentar guardado</button></p>}

    <nav className="categoria-pasos" aria-label="Pasos de la categorización">
      {([1, 2] as const).map((p) => {
        const quedan = p === 1 ? pendientes1.length : pendientes2.length;
        return <button type="button" key={p} aria-pressed={paso === p}
          className={'categoria-paso' + (paso === p ? ' activo' : '')} {...pulsadorSinFoco}
          onClick={() => cambiarPaso(p)}>
          <span className="categoria-paso-num">{p}</span>
          <span><b>{p === 1 ? 'Validar categorías del Excel' : 'Categorizar pendientes'}</b>
            <small>{quedan ? `Quedan ${quedan}` : 'Completado'}</small></span>
        </button>;
      })}
    </nav>

    <section ref={tarjeta} tabIndex={-1} className="categoria-tarjeta"
      aria-label={paso === 1 ? 'Paso 1 · Validar categoría' : 'Paso 2 · Categorizar'}>
      <div className="categoria-progreso" aria-hidden>
        <div style={{ width: `${(paso === 1 ? total1 ? hecho1 / total1 : 1 : total2 ? hecho2 / total2 : 1) * 100}%` }}/>
      </div>
      <p className="categoria-progreso-t">
        {paso === 1
          ? <>Revisadas <b>{hecho1}</b> de {total1} con categoría en el Excel · quedan <b>{pendientes1.length}</b></>
          : <>Categorizadas <b>{hecho2}</b> de {total2} · quedan <b>{pendientes2.length}</b>{' '}
            ({repartidas.filter((f) => !f.tienePropuesta).length} sin categoría en el Excel y los rechazados en el paso 1)</>}
      </p>

      {!actual ? <div className="categoria-fin">
        <CheckCircle2 size={22}/>
        <div>
          <b>{paso === 1 ? 'Paso 1 completado.' : 'Paso 2 completado.'}</b>
          <p>{cola.length ? `Quedan ${cola.length} decisiones por guardar en el servidor.` : 'Todas las decisiones están guardadas en el servidor.'}</p>
          {paso === 1 && pendientes2.length > 0 && <button className="btn primario" onClick={() => cambiarPaso(2)}>
            Ir al paso 2 · {pendientes2.length} por categorizar</button>}
          {paso === 2 && pendientes1.length > 0 && <button className="btn" onClick={() => cambiarPaso(1)}>
            Volver al paso 1 · {pendientes1.length} por validar</button>}
        </div>
      </div> : <>
        <div className="categoria-negocio">
          <div>
            <small>IT1 · fila {actual.fila.registro.fila}{enHistorial ? ' · ya revisado en esta sesión' : ''}</small>
            <h2>{actual.fila.nombre || 'Negocio sin identificar'}</h2>
            <p>{actual.fila.direccion}, {actual.fila.numero}</p>
          </div>
          {estado && <span className={estado.clase}>{estado.texto}</span>}
        </div>

        {paso === 1 ? <>
          <div className="categoria-existente">
            <small>Categoría del Excel</small>
            <h3>{categoriaTexto(actual.existentes)}</h3>
            {actual.existentes.descripcionActividad && <p>{actual.existentes.descripcionActividad}</p>}
            {actual.paso === 2 && <p className="categoria-advertencia">
              {actual.revision?.estado === 'corregida' || actual.enCola?.accion === 'corregir'
                ? `Sustituida en el paso 2 por: ${categoriaTexto(actual.visibles)}`
                : 'Rechazada: este negocio se categoriza en el paso 2.'}</p>}
          </div>
          <div className="categoria-acciones">
            <button className="btn primario" {...pulsadorSinFoco} disabled={!!motivoBloqueo || bloqueadaFicha1}
              onClick={() => decidirPaso1('aceptar')}><CheckCircle2 size={16}/> Correcta <kbd>Enter</kbd></button>
            <button className="btn" {...pulsadorSinFoco} disabled={!!motivoBloqueo || bloqueadaFicha1}
              onClick={() => decidirPaso1('rechazar')}><XCircle size={16}/> No es correcta <kbd>N</kbd></button>
            <span className="categoria-nav">
              <button className="btn s icono" {...pulsadorSinFoco} aria-label="Negocio anterior"
                disabled={!puedeAtras} onClick={anterior}><ChevronLeft size={16}/></button>
              <button className="btn s icono" {...pulsadorSinFoco} aria-label="Volver al siguiente"
                disabled={!idVisto} onClick={siguiente}><ChevronRight size={16}/></button>
            </span>
          </div>
          <p className="categoria-teclas"><kbd>Enter</kbd> correcta · <kbd>N</kbd> o <kbd>Supr</kbd> no es correcta (pasa al paso 2) · <kbd>←</kbd> anterior</p>
        </> : <>
          {actual.tienePropuesta
            ? <p className="categoria-referencia">Excel (rechazada, solo como referencia): <b>{categoriaTexto(actual.existentes)}</b></p>
            : <p className="categoria-referencia">Sin categoría en el Excel.</p>}
          {(actual.revision?.estado === 'corregida' || actual.enCola?.accion === 'corregir') &&
            <p className="categoria-referencia">Categoría elegida: <b>{categoriaTexto(actual.visibles)}</b></p>}
          {propuesta && propuesta.sugerencias.length > 0 && <p className="categoria-propuesta" role="note">
            <Lightbulb size={15}/>
            {propuesta.sugerencias.length === 1
              ? <span>Propuesta por el nombre: <b>{propuesta.sugerencias[0].ruta}</b>. Pulsa <kbd>Enter</kbd> para confirmarla o escribe para buscar otra.</span>
              : <span>{propuesta.sugerencias.length} propuestas por el nombre: elige una con <kbd>↑</kbd>/<kbd>↓</kbd> y <kbd>Enter</kbd>.</span>}
          </p>}
          <BuscadorClasificacion key={actual.fila.id} catalogo={ID_CATALOGO_2026}
            nombreNegocio={actual.fila.nombre} frecuentes={frecuentesFicha} marcarPropuestaUnica
            etiqueta={`Categoría para ${actual.fila.nombre || 'el negocio'}`}
            onElegir={(e) => elegirPaso2(e)}/>
          <div className="categoria-acciones">
            <button className="btn s" {...pulsadorSinFoco} disabled={!puedeAtras} onClick={anterior}>
              <ChevronLeft size={15}/> Anterior</button>
            {enHistorial
              ? <button className="btn s" {...pulsadorSinFoco} onClick={siguiente}>
                  Volver al siguiente <ChevronRight size={15}/></button>
              : <button className="btn s" {...pulsadorSinFoco} disabled={pendientes2.length < 2}
                  onClick={saltar}><SkipForward size={15}/> Dejar para después</button>}
          </div>
        </>}
        {motivoBloqueo && <p className="categoria-advertencia" role="status">{motivoBloqueo}</p>}
        {error && <p role="alert" className="categoria-advertencia">{error}</p>}
        <p className="categoria-origen">Origen: {actual.fila.archivo} · fila {actual.fila.registro.fila}. El Excel no se modifica.</p>
      </>}
    </section>

    <details className="categoria-buscar-negocio">
      <summary>Buscar un negocio para revisar de nuevo</summary>
      <input className="input" aria-label="Buscar negocio o calle" value={buscaNegocio}
        onChange={(e) => setBuscaNegocio(e.target.value)} placeholder="Nombre, calle o fila…"/>
      {resultadosNegocio.map((f) => <button type="button" key={f.fila.id} className="categoria-item"
        onClick={() => abrirNegocio(f)}>
        <strong>{f.fila.nombre || 'Negocio sin identificar'}</strong>
        <small>{f.fila.direccion}, {f.fila.numero} · paso {f.paso} · {estadoFila(f)?.texto ?? 'pendiente'}</small>
      </button>)}
    </details>
  </main>;
}
