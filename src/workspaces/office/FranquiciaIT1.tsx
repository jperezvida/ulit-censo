import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { capacidadFranquiciaIT1, type CapacidadFranquiciaIT1 } from '../../store/franquiciaIT1Real';
import {
  prepararFranquiciasIT1, pendientesFranquiciaIT1,
  type DecisionFranquiciaIT1,
} from '../../domain/revisionFranquiciaIT1';
import '../../styles/categoria-it1.css';

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
  useEffect(() => { tarjeta.current?.focus(); }, [paso]);
  const [viendo, setViendo] = useState<string | null>(null);
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
    tarjeta.current?.focus();
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
      if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing ||
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

  return <div className="categoria-it1" style={{maxWidth: 1280, margin:'0 auto', padding:'24px 28px'}}>
    <Link to="/oficina" className="btn s fantasma"><ArrowLeft size={16}/> Volver a Oficina</Link>
    <p className="rotulo" style={{marginTop:22}}>OFICINA · IT1 · FASE 3</p>
    <h1>Revisión de franquicias</h1>
    <p className="muted">Dos pasos. Primero valida los datos del Excel; después completa los negocios sin dato o los rechazados.</p>
    <div className="categoria-resumen" role="status" aria-label="Estado del guardado"
      style={{display:'flex',gap:12,flexWrap:'wrap',margin:'18px 0'}}>
      <span className="t-info"><b>{ocupados-guardadas-totalPorGuardar}</b> pendientes por decidir</span>
      <span className="t-info"><b>{totalPorGuardar}</b> decisiones por guardar</span>
      <span className="t-info"><b>{guardadas}</b> de {ocupados} confirmadas en el servidor</span>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12,margin:'16px 0'}}>
      {([1,2] as const).map((p) => <button key={p} type="button" className={'btn '+(paso===p?'primario':'')}
        style={{justifyContent:'flex-start',padding:18,textAlign:'left',height:'auto'}}
        onClick={()=>{setPaso(p);setViendo(null);setConfirmandoTodas(false);setError('');}}>
        <b>{p} · {p===1?'Revisar franquicias del Excel':'Completar franquicias'}</b>
        <span style={{marginLeft:'auto'}}>{resumen(p)===0?'Completado':resumen(p)+' pendientes'}</span>
      </button>)}
    </div>
    {motivoBloqueo && <p className="t-info aviso" role="alert">{motivoBloqueo}</p>}
    {error && <p className="t-info aviso" role="alert">{error}</p>}
    {errorCola && fuente?.reintentarColaFranquiciaIT1 && <button type="button" className="btn" onClick={fuente.reintentarColaFranquiciaIT1}>Reintentar guardado</button>}
    {paso===1 && pendientes1.length>0 && (
      <div style={{padding:'12px 0'}}>
        {!confirmandoTodas ? <button type="button" className="btn" disabled={!!motivoBloqueo || totalPorGuardar>0}
          onClick={()=>setConfirmandoTodas(true)}>Dar por correctos todos los datos existentes</button> :
          <div className="t-info aviso" role="group" aria-label="Confirmar todas las propuestas">
            <p><b>Confirmación masiva:</b> se aceptarán las {pendientes1.length} respuestas 0/1 existentes del Excel aún sin revisar.
              Cada decisión quedará identificada en el servidor. Los datos vacíos seguirán pendientes. ¿Confirmas?</p>
            <button type="button" className="btn primario" disabled={!!motivoBloqueo || totalPorGuardar>0} onClick={confirmarTodas}>
              Sí, dar las {pendientes1.length} por correctas</button>{' '}
            <button type="button" className="btn" onClick={()=>setConfirmandoTodas(false)}>Cancelar</button>
          </div>}
      </div>
    )}
    <section ref={tarjeta} tabIndex={-1} className="t-info" aria-label={paso===1?'Paso 1 · Revisar':'Paso 2 · Completar'}
      style={{marginTop:12,padding:28,minHeight:270}}>
      {!actual ? <>
        <p style={{fontWeight:700,color:'var(--verde,#18794e)'}}><CheckCircle2 size={19}/> Paso {paso} completado.</p>
        <p className="muted">{totalPorGuardar ? 'Hay decisiones esperando confirmación del servidor.' : 'No quedan decisiones pendientes en este paso.'}</p>
        {paso===1 && <button type="button" className="btn primario" onClick={()=>setPaso(2)}>Ir al paso 2</button>}
      </> : <>
        <p className="muted">Quedan {resumen(paso)} · {actual.fila.direccion}, {actual.fila.numero}</p>
        <h2>{actual.fila.nombre}</h2>
        {paso===1 ? <>
          <p>Franquicia indicada en el Excel: <b style={{fontSize:22}}>{respuestaTexto(actual.propuesta)}</b></p>
          <p className="muted">¿Es correcto el valor que figura en el Excel?</p>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            <button type="button" className="btn primario" disabled={!!motivoBloqueo || !!actual.enCola}
              onClick={()=>decidir('aceptar')}><CheckCircle2 size={16}/> Correcto · Enter</button>
            <button type="button" className="btn" disabled={!!motivoBloqueo || !!actual.enCola}
              onClick={()=>decidir('rechazar')}><XCircle size={16}/> No es correcto · Supr</button>
          </div>
          <p className="muted">Rechazar lo envía al paso 2 sin abrir formularios.</p>
        </> : <>
          <p className="muted">{actual.propuesta ? 'Excel rechazado: '+respuestaTexto(actual.propuesta) : 'Sin valor de franquicia en el Excel.'}</p>
          <p>¿Es una franquicia? <span className="muted">(Una cadena comercial no siempre es franquicia)</span></p>
          <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
            <button type="button" className="btn primario" disabled={!!motivoBloqueo || !!actual.enCola}
              onClick={()=>decidir('resolver','si')}><CheckCircle2 size={16}/> Sí · Enter</button>
            <button type="button" className="btn" disabled={!!motivoBloqueo || !!actual.enCola}
              onClick={()=>decidir('resolver','no')}><XCircle size={16}/> No · Supr</button>
            <button type="button" className="btn fantasma" disabled={pendientes2.length<2}
              onClick={omitirCaso}>Dejar pendiente · Esc</button>
          </div>
        </>}
        {actual.enCola && <p className="muted">Decisión por guardar; no cuenta como confirmada.</p>}
        {actual.confirmada && <p className="muted"><CheckCircle2 size={14}/> Decisión guardada: {respuestaTexto(actual.revision?.respuesta)}</p>}
      </>}
    </section>
    {guardadas>0 && <details style={{marginTop:22}}>
      <summary>Buscar un negocio para revisar de nuevo</summary>
      <input className="campo" style={{margin:'12px 0',width:'100%',maxWidth:420}}
        value={buscar} onChange={(e)=>setBuscar(e.target.value)} placeholder="Buscar nombre o dirección…"
        aria-label="Buscar negocio revisado"/>
      <div style={{maxHeight:240,overflowY:'auto'}}>
        {vistas.filter((f) => f.confirmada && f.fila.nombre.toLowerCase().includes(buscar.toLowerCase()))
          .slice(0,60).map((f) => <button key={f.fila.id} type="button" className="btn fantasma"
            style={{display:'block',margin:'3px 0'}} onClick={()=>mostrar(f.fila.id,f.paso)}>
            {f.fila.nombre} · {respuestaTexto(f.revision?.respuesta)}
          </button>)}
      </div>
    </details>}
    {ocupados===0 && <p className="t-info aviso"><AlertTriangle size={16}/> No hay negocios ocupados del IT1 en esta campaña.</p>}
  </div>;
}
