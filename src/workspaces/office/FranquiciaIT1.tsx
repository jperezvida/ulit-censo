import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { capacidadFranquiciaIT1, type CapacidadFranquiciaIT1 } from '../../store/franquiciaIT1Real';
import {
  prepararFranquiciasIT1, pendientesFranquiciaIT1,
  type DecisionFranquiciaIT1,
} from '../../domain/revisionFranquiciaIT1';
import '../../styles/franquicia-it1.css';

const SIN_COLA: DecisionFranquiciaIT1[] = [];
type Paso = 1 | 2;
const respuestaTexto = (v: 'si' | 'no' | null | undefined) => v === 'si' ? 'Sí' : v === 'no' ? 'No' : 'Sin dato';

export default function FranquiciaIT1() {
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const filas = useMemo(() => campana ? prepararFranquiciasIT1(db, campana.id) : [], [db, campana?.id]);
  const cola = fuente?.estadoColaFranquiciaIT1?.pendientes ?? SIN_COLA;
  const errorCola = fuente?.estadoColaFranquiciaIT1?.error ?? '';
  const vistas = useMemo(() => pendientesFranquiciaIT1(filas, cola), [filas, cola]);
  const pendientes1 = vistas.filter((f) => f.paso === 1 && f.pendiente);
  const pendientes2 = vistas.filter((f) => f.paso === 2 && f.pendiente);
  const guardadas = filas.filter((f) => f.confirmada).length;
  const totalPorGuardar = cola.reduce((n,d) => n+d.ids.length,0);
  const [paso, setPaso] = useState<Paso>(1);
  const tarjeta = useRef<HTMLElement>(null);
  // El foco vuelve a la ficha: Enter/Supr funcionan aunque se cambie de pestaña con un clic.
  const [viendo, setViendo] = useState<string | null>(null);
  // También al recuperar una ficha ya revisada desde el buscador.
  useEffect(() => { tarjeta.current?.focus({ preventScroll: true }); }, [paso, viendo]);
  const [confirmandoTodas, setConfirmandoTodas] = useState(false);
  const [saltados, setSaltados] = useState<string[]>([]);
  const [buscar, setBuscar] = useState('');
  const [error, setError] = useState('');
  const [capacidad, setCapacidad] = useState<CapacidadFranquiciaIT1>(
    { habilitada:false, motivo:'Comprobando permisos…' });

  useEffect(() => {
    if (!fuente?.soloLectura || campana?.anio !== 2026) return;
    let activa = true;
    void capacidadFranquiciaIT1().then((c) => { if (activa) setCapacidad(c); })
      .catch(() => { if (activa) setCapacidad({ habilitada:false, motivo:'No se pudo verificar el permiso.' }); });
    return () => { activa = false; };
  }, [campana?.id, campana?.anio, fuente?.soloLectura]);

  const pendientes = paso === 1 ? pendientes1 : [...pendientes2].sort((a,b) => {
    const x = saltados.indexOf(a.fila.id), y = saltados.indexOf(b.fila.id);
    return (x >= 0 ? x+1000 : -1) - (y >= 0 ? y+1000 : -1);
  });
  const actual = vistas.find((f) => f.fila.id === viendo) ?? pendientes[0];
  const motivoBloqueo = errorCola ? 'Guardado detenido: reintenta para continuar.'
    : !fuente?.encolarFranquiciaIT1 || !capacidad.habilitada
      ? capacidad.motivo || 'El servidor no autorizó esta operación.' : '';
  const ocupados = filas.length;
  const encolar = (decision: DecisionFranquiciaIT1) => {
    if (motivoBloqueo) { setError(motivoBloqueo); return false; }
    if (!fuente?.encolarFranquiciaIT1?.(decision)) {
      setError('No se pudo añadir la decisión a la cola. Comprueba si hay otra pendiente de guardar.');
      return false;
    }
    setError('');
    setViendo(null);
    tarjeta.current?.focus({ preventScroll: true });
    return true;
  };
  const decidir = (accion: 'aceptar' | 'rechazar' | 'resolver', respuesta?: 'si' | 'no') => {
    if (!actual || actual.enCola) return;
    if (paso === 1 && (accion === 'resolver' || !actual.propuesta)) return;
    if (paso === 2 && accion !== 'resolver') return;
    if (actual.confirmada && (
      (accion === 'aceptar' && actual.revision?.estado === 'aceptada') ||
      (accion === 'resolver' && actual.revision?.estado === 'corregida'
        && actual.revision.respuesta === respuesta))) {
      // No reenviar una decisión idéntica: el servidor la rechaza como duplicada.
      setViendo(null); return;
    }
    encolar({ accion, ids:[actual.fila.id], ...(respuesta ? { respuesta } : {}) });
  };
  const confirmarTodas = () => {
    const ids = pendientes1.filter((f) => !f.enCola && !f.revision).map((f) => f.fila.id);
    if (!ids.length) { setConfirmandoTodas(false); return; }
    if (encolar({ accion:'aceptar-todas', ids })) {
      setConfirmandoTodas(false);
    }
  };
  const omitirCaso = () => {
    if (!actual || paso !== 2 || pendientes2.length < 2) return;
    setSaltados((s) => [...s.filter((id) => id !== actual.fila.id), actual.fila.id]);
    setViendo(null);
  };
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || ev.repeat ||
          (ev.target instanceof HTMLElement && ev.target.closest('button,input,textarea,select,a,summary,[contenteditable=true]')) ||
          confirmandoTodas) return;
      if (paso === 1) {
        if (ev.key === 'Enter') { ev.preventDefault(); decidir('aceptar'); }
        if (ev.key === 'Delete' || ev.key.toLowerCase() === 'n') { ev.preventDefault(); decidir('rechazar'); }
      } else {
        if (ev.key === 'Enter' || ev.key.toLowerCase() === 's') { ev.preventDefault(); decidir('resolver','si'); }
        if (ev.key === 'Delete' || ev.key.toLowerCase() === 'n') { ev.preventDefault(); decidir('resolver','no'); }
        if (ev.key === 'Escape') { ev.preventDefault(); omitirCaso(); }
      }
    };
    document.addEventListener('keydown',onKeyDown);
    return () => document.removeEventListener('keydown',onKeyDown);
  });

  const mostrar = (id: string, p: Paso) => { setPaso(p); setViendo(id); setConfirmandoTodas(false); setError(''); };
  const resumen = (p: Paso) => (p === 1 ? pendientes1 : pendientes2).length;
  if (!campana || campana.anio !== 2026) return <p>Selecciona la campaña 2026.</p>;


  // Los botones no roban el foco al hacer clic: inmediatamente después sirve otra vez Enter/Supr.
  const mantenerFoco = { onMouseDown: (e: MouseEvent<HTMLButtonElement>) => e.preventDefault() };

  return <main className="pagina franquicia-it1">
    <header className="franquicia-cabecera">
      <Link to="/oficina" className="btn s fantasma"><ArrowLeft size={15}/> Volver a Oficina</Link>
      <span className="rotulo">Oficina · IT1 · Fase 3</span>
      <h1>Revisión de franquicias</h1>
      <p>Primero confirma los valores del Excel. Después completa los que faltan o has rechazado.</p>
    </header>

    <div className="franquicia-resumen" role="status" aria-label="Estado del guardado">
      <span><strong>{ocupados-guardadas-totalPorGuardar}</strong> pendientes por decidir</span>
      <span className={totalPorGuardar ? 'franquicia-resumen-cola' : ''}>
        <strong>{totalPorGuardar}</strong> decisiones por guardar
      </span>
      <span><strong>{guardadas}</strong> de {ocupados} confirmadas en el servidor</span>
    </div>

    <nav className="franquicia-pasos" aria-label="Pasos de revisión de franquicias">
      {([1,2] as const).map((p) =>
        <button type="button" key={p} className={'franquicia-paso' + (paso === p ? ' activo' : '')}
          aria-pressed={paso === p} {...mantenerFoco}
          onClick={() => { setPaso(p); setViendo(null); setConfirmandoTodas(false); setError(''); }}>
          <span className="franquicia-paso-num">{p}</span>
          <span className="franquicia-paso-texto">
            <b>{p===1 ? 'Revisar franquicias del Excel' : 'Completar franquicias'}</b>
            <small>{resumen(p)===0 ? 'Completado' : resumen(p)+' pendientes'}</small>
          </span>
        </button>)}
    </nav>

    <section ref={tarjeta} tabIndex={-1} className="franquicia-ficha"
      aria-label={paso===1 ? 'Paso 1 · Revisar' : 'Paso 2 · Completar'}>
      <div className="franquicia-ficha-progreso">
        <span>Paso {paso} de 2</span>
        <strong>Quedan {resumen(paso)}</strong>
      </div>

      {!actual ? <div className="franquicia-ficha-fin">
        <CheckCircle2 size={29} aria-hidden="true"/>
        <h2>Paso {paso} completado</h2>
        <p>{totalPorGuardar
          ? 'Hay decisiones pendientes de confirmación en el servidor.'
          : 'Todas las decisiones de este paso están guardadas.'}</p>
        {paso===1 && <button type="button" className="btn primario" {...mantenerFoco}
          onClick={()=>setPaso(2)}>Ir al paso 2</button>}
      </div> :
        <div className="franquicia-ficha-contenido">
          <div className="franquicia-negocio">
            <h2 title={actual.fila.nombre}>{actual.fila.nombre || 'Negocio sin identificar'}</h2>
            <p title={`${actual.fila.direccion}, ${actual.fila.numero}`}>
              {actual.fila.direccion}, {actual.fila.numero}
            </p>
          </div>

          <div className="franquicia-valor">
            <span>{paso===1 ? 'VALOR EN EL EXCEL'
              : actual.propuesta ? 'VALOR DEL EXCEL RECHAZADO' : 'VALOR EN EL EXCEL'}</span>
            <strong>{actual.propuesta ? respuestaTexto(actual.propuesta).toLocaleUpperCase('es') : 'SIN DATO'}</strong>
            <p>{paso===1 ? '¿Es correcto?' : '¿Es una franquicia?'}</p>
          </div>

          <div className="franquicia-decisiones">
            <button type="button" className="franquicia-decision principal" {...mantenerFoco}
              disabled={!!motivoBloqueo || !!actual.enCola}
              onClick={()=>paso===1 ? decidir('aceptar') : decidir('resolver','si')}>
              <CheckCircle2 size={18} aria-hidden="true"/>
              <span>{paso===1 ? 'Correcto' : 'Sí'}</span>
              <kbd>Enter</kbd>
            </button>
            <button type="button" className="franquicia-decision secundaria" {...mantenerFoco}
              disabled={!!motivoBloqueo || !!actual.enCola}
              onClick={()=>paso===1 ? decidir('rechazar') : decidir('resolver','no')}>
              <XCircle size={18} aria-hidden="true"/>
              <span>{paso===1 ? 'No es correcto' : 'No'}</span>
              <kbd>Supr</kbd>
            </button>
          </div>
          <div className="franquicia-ficha-pie">
            <span className="franquicia-estado-ficha">
              {actual.enCola ? 'Por guardar en el servidor'
                : actual.confirmada ? 'Decisión guardada en el servidor'
                : paso===1 ? 'Si rechazas, pasará al paso 2'
                : 'Una cadena comercial no siempre es franquicia'}
            </span>
            {paso===2 && <button type="button" className="franquicia-posponer" {...mantenerFoco}
              disabled={pendientes2.length<2} onClick={omitirCaso}>Dejar para después <kbd>Esc</kbd></button>}
          </div>
        </div>}
    </section>

    <div className="franquicia-secundario">
      {motivoBloqueo && <p className="franquicia-aviso" role="alert">{motivoBloqueo}</p>}
      {error && <p className="franquicia-aviso" role="alert">{error}</p>}
      {errorCola && fuente?.reintentarColaFranquiciaIT1 &&
        <button type="button" className="btn" {...mantenerFoco}
          onClick={fuente.reintentarColaFranquiciaIT1}>Reintentar guardado</button>}

      {paso===1 && pendientes1.length>0 && (
        <div className="franquicia-masiva">
          {!confirmandoTodas ? <>
            <button type="button" className="btn" disabled={!!motivoBloqueo || totalPorGuardar>0}
              onClick={()=>setConfirmandoTodas(true)}>Aceptar todas las respuestas existentes</button>
            <p>Solo confirma los valores 0/1 del Excel. Los que están en blanco seguirán pendientes.</p>
          </> : <div className="franquicia-confirmar-todas" role="group" aria-label="Confirmar todas las propuestas">
            <p><strong>Confirmación masiva.</strong> Se aceptarán las {pendientes1.length} respuestas 0/1 existentes del Excel aún sin revisar.
              Cada decisión quedará registrada en el servidor. Los datos vacíos seguirán pendientes. ¿Confirmas?</p>
            <div className="franquicia-confirmar-botones">
              <button type="button" className="btn primario" disabled={!!motivoBloqueo || totalPorGuardar>0}
                onClick={confirmarTodas}>Sí, dar las {pendientes1.length} por correctas</button>
              <button type="button" className="btn" onClick={()=>setConfirmandoTodas(false)}>Cancelar</button>
            </div>
          </div>}
        </div>
      )}

      {guardadas>0 && <details className="franquicia-buscar">
        <summary>Buscar un negocio para revisar de nuevo</summary>
        <input className="campo" value={buscar} onChange={(e)=>setBuscar(e.target.value)}
          placeholder="Nombre del negocio…" aria-label="Buscar negocio revisado"/>
        <div className="franquicia-resultados">
          {vistas.filter((f) => f.confirmada && f.fila.nombre.toLowerCase().includes(buscar.toLowerCase()))
            .slice(0,60).map((f) => <button key={f.fila.id} type="button" className="btn fantasma"
              onClick={()=>mostrar(f.fila.id,f.paso)}>
              {f.fila.nombre} · {respuestaTexto(f.revision?.respuesta)}
            </button>)}
        </div>
      </details>}
      {ocupados===0 && <p className="franquicia-aviso"><AlertTriangle size={16}/> No hay negocios ocupados del IT1 en esta campaña.</p>}
    </div>
  </main>;
}
