import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Search, XCircle } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { capacidadCategoriaIT1, type CapacidadCategoriaIT1 } from '../../store/categoriaIT1Real';
import {
  categoriaTexto, categoriasDelCatalogo, OPCIONES_CATEGORIAS_2026,
  prepararRevisionCategoriaIT1,
} from '../../domain/revisionCategoriaIT1';
import '../../styles/categoria-it1.css';

type Vista = 'pendientes' | 'revisados' | 'todos';

/** Una única pantalla de trabajo del IT1: se revisan TODAS las filas ocupadas. */
export default function CategoriaIT1() {
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const filas = useMemo(() => campana ? prepararRevisionCategoriaIT1(db, campana.id) : [],
    [db, campana?.id]);
  const [vista, setVista] = useState<Vista>('pendientes');
  const [busqueda, setBusqueda] = useState('');
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [cambiar, setCambiar] = useState(false);
  const [buscaCategoria, setBuscaCategoria] = useState('');
  const [nodo, setNodo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
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

  const cola = fuente?.estadoColaCategoriaIT1?.pendientes ?? [];
  const errorCola = fuente?.estadoColaCategoriaIT1?.error ?? '';
  const ultimoPorRegistro = new Map(cola.map((d) => [d.registroId, d]));
  // Adelantar solo la vista: la confirmación procede siempre del servidor.
  const filasVisuales = filas.map((f) => {
    const enCola = ultimoPorRegistro.get(f.fila.id);
    return { ...f, enCola,
      efectivos: enCola?.accion === 'corregir' ? enCola.valores : f.efectivos,
      confirmada: f.confirmada || (!!enCola && enCola.accion !== 'rechazar' && !errorCola),
    };
  });
  const pendiente = filasVisuales.filter((f) => !f.confirmada);
  const visibles = filasVisuales.filter((f) =>
    (vista === 'todos' || (vista === 'pendientes' ? !f.confirmada : f.confirmada))
    && (!busqueda.trim() || [
      f.fila.nombre, f.fila.direccion, f.fila.numero, String(f.fila.registro.fila),
      categoriaTexto(f.efectivos),
    ].join(' ').toLocaleLowerCase('es').includes(busqueda.trim().toLocaleLowerCase('es'))));
  const indice = Math.max(0, visibles.findIndex((f) => f.fila.id === seleccion));
  const actual = visibles[indice];
  const bloquearDecision = Boolean(errorCola) || Boolean(actual?.enCola
    && actual.enCola.accion !== 'rechazar');

  const opciones = OPCIONES_CATEGORIAS_2026.filter((x) =>
    !buscaCategoria.trim() || x.etiqueta.toLocaleLowerCase('es')
      .includes(buscaCategoria.toLocaleLowerCase('es'))).slice(0, 180);

  const cambiarFicha = (id: string) => {
    setSeleccion(id);
    setCambiar(false);
    setNodo('');
    setDescripcion('');
    setBuscaCategoria('');
    setError('');
  };

  const decidir = (accion: 'aceptar'|'rechazar'|'corregir') => {
    if (!actual || !fuente?.encolarCategoriaIT1 || !capacidad.habilitada || errorCola
      || (actual.enCola && !(actual.enCola.accion === 'rechazar' && accion === 'corregir'))) return;
    let valores = actual.efectivos;
    if (accion === 'corregir') {
      try { valores = categoriasDelCatalogo(nodo, descripcion); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); return; }
    }
    if (!fuente.encolarCategoriaIT1({ registroId: actual.fila.id, accion, valores })) {
      setError('Esta ficha ya está pendiente de guardar o la cola necesita atención.');
      return;
    }
    setError('');
    if (accion === 'rechazar') {
      setCambiar(true);
      setAviso('Clasificación rechazada. Elige la correcta; se guardará en orden.');
    } else {
      const siguientes = visibles.slice(indice + 1).filter((f) => !f.confirmada
        && f.fila.id !== actual.fila.id);
      const siguiente = siguientes[0] ?? visibles.slice(0, indice).find((f) =>
        !f.confirmada && f.fila.id !== actual.fila.id);
      setSeleccion(siguiente?.fila.id ?? null);
      setCambiar(false);
      setNodo('');
      setDescripcion('');
      setBuscaCategoria('');
      setAviso('Siguiente ficha lista. La decisión anterior está pendiente de confirmación.');
    }
  };

  // Enter confirma y avanza; no interfiere con inputs ni navegación.
  useEffect(() => {
    const alPulsar = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.repeat || event.isComposing
        || event.ctrlKey || event.altKey || event.metaKey) return;
      const destino = event.target;
      if (destino instanceof HTMLElement) {
        if (destino.closest('input,textarea,select,a,[contenteditable="true"]')) return;
        const boton = destino.closest('button');
        if (boton && !boton.classList.contains('categoria-item')) return;
        if (boton?.classList.contains('categoria-item')
          && boton.getAttribute('data-registro') !== actual?.fila.id) return;
      }
      if (!actual || !capacidad.habilitada || errorCola || bloquearDecision) return;
      const editor = cambiar || !actual.tienePropuesta
        || actual.revision?.estado === 'rechazada' || actual.enCola?.accion === 'rechazar';
      if (editor && !nodo) return;
      event.preventDefault();
      decidir(editor ? 'corregir' : 'aceptar');
    };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  });


  if (!campana) return null;
  if (campana.anio !== 2026) return <main className="pagina"><p>Esta revisión corresponde únicamente a Medina 2026.</p></main>;

  return <main className="pagina categoria-it1">
    <header className="categoria-cab">
      <Link to="/oficina" className="btn s fantasma"><ArrowLeft size={15}/> Volver a Oficina</Link>
      <span className="rotulo">Oficina · IT1 · Fase 3</span>
      <h1>Categorización de negocios</h1>
      <p>Comprueba cada establecimiento ocupado. Las categorías importadas no se consideran aceptadas hasta que pulses «Aceptar».</p>
    </header>
    <div className="categoria-resumen" role="status">
      <span><b>{filas.length}</b> ocupados</span>
      <span><b>{filas.filter((f) => f.confirmada).length}</b> revisados</span>
      <span><b>{pendiente.length}</b> por revisar</span>
      <span><b>{filas.filter((f) => !f.tienePropuesta).length}</b> sin categoría original</span>
      <span><b>{cola.length}</b> por guardar</span>
    </div>
    <p className="categoria-nota">Se incluyen todos los registros ocupados de IT1, aunque aún no estén vinculados a un local físico. Los vacíos quedan excluidos. El Excel original no se modifica. Pulsa <kbd>Enter</kbd> para confirmar y avanzar.</p>
    {errorCola && <p role="alert" className="categoria-advertencia">Guardado detenido: {errorCola}. Las decisiones no confirmadas siguen en cola. <button className="btn s" onClick={() => fuente?.reintentarColaCategoriaIT1?.()}>Reintentar guardado</button></p>}
    {!!cola.length && !errorCola && <p role="status" className="categoria-aviso">Guardando {cola.length} decisión(es) en orden. No cierres la pestaña hasta que marque 0.</p>}
    <div className="categoria-filtros" role="group" aria-label="Filtrar categorización">
      {(['pendientes','revisados','todos'] as const).map((op) =>
        <button type="button" className={vista === op ? 'btn s primario' : 'btn s'}
          disabled={false} aria-pressed={vista === op} key={op}
          onClick={() => { setVista(op); setSeleccion(null); setCambiar(false); }}>
          {op === 'pendientes' ? 'Pendientes' : op === 'revisados' ? 'Revisados' : 'Todos'}
        </button>)}
      <label className="categoria-buscar"><Search size={14}/>
        <input aria-label="Buscar negocio, calle o categoría" value={busqueda}
          disabled={false} onChange={(e) => { setBusqueda(e.target.value); setSeleccion(null); }}
          placeholder="Buscar negocio o calle…"/>
      </label>
    </div>
    <div className="categoria-columnas">
      <section className="categoria-lista" aria-label="Negocios del itinerario 1">
        <div className="categoria-lista-head">{visibles.length} registros en esta vista</div>
        {visibles.map((f) => <button type="button" key={f.fila.id}
          disabled={false} data-registro={f.fila.id} className={'categoria-item' + (actual?.fila.id === f.fila.id ? ' activo' : '')}
          onClick={() => cambiarFicha(f.fila.id)}>
          <strong>{f.fila.nombre || 'Negocio sin identificar'}</strong>
          <small>{f.fila.direccion}, {f.fila.numero} · fila {f.fila.registro.fila}</small>
          <span className={f.confirmada ? 'categoria-ok' : 'categoria-pendiente'}>
            {f.enCola ? 'Por guardar' : f.confirmada ? 'Revisado' : f.revision?.estado === 'rechazada'
              ? 'Categoría rechazada' : f.tienePropuesta ? 'Por confirmar' : 'Sin categoría'}
          </span>
        </button>)}
        {!visibles.length && <p className="muted">No hay negocios con estos filtros.</p>}
      </section>
      <section className="categoria-detalle" aria-label="Revisión de la categoría">
        {actual ? <>
          <div className="categoria-detalle-cab">
            <div>
              <small>IT1 · Fila {actual.fila.registro.fila}</small>
              <h2>{actual.fila.nombre}</h2>
              <p>{actual.fila.direccion}, {actual.fila.numero}</p>
            </div>
            <div className="categoria-nav">
              <button className="btn s icono" aria-label="Anterior negocio"
                disabled={indice === 0}
                onClick={() => cambiarFicha(visibles[indice - 1].fila.id)}><ChevronLeft size={16}/></button>
              <span>{indice+1} / {visibles.length}</span>
              <button className="btn s icono" aria-label="Siguiente negocio"
                disabled={indice === visibles.length - 1}
                onClick={() => cambiarFicha(visibles[indice + 1].fila.id)}><ChevronRight size={16}/></button>
            </div>
          </div>
          <div className="categoria-existente">
            <small>Categorización {actual.revision?.estado === 'corregida' ? 'corregida' : 'existente en el Excel'}</small>
            <h3>{categoriaTexto(actual.efectivos)}</h3>
            {actual.efectivos.descripcionActividad && <p>{actual.efectivos.descripcionActividad}</p>}
            {(actual.revision?.estado === 'rechazada' || actual.enCola?.accion === 'rechazar') && <p className="categoria-advertencia">
              Has rechazado esta clasificación. Selecciona la correcta para validarla.</p>}
          </div>
          {actual.confirmada && !cambiar && !actual.enCola
            ? <div className="categoria-acciones">
                <p className="categoria-confirmada"><CheckCircle2 size={17}/> Categorización revisada y guardada.</p>
                <button className="btn s" disabled={false}
                  onClick={() => setCambiar(true)}>Cambiar categoría</button>
              </div>
            : <>
              {!cambiar && !actual.enCola && actual.tienePropuesta && actual.revision?.estado !== 'rechazada' &&
                <div className="categoria-acciones">
                  <button className="btn primario" disabled={bloquearDecision || !capacidad.habilitada}
                    onClick={() => void decidir('aceptar')}><CheckCircle2 size={16}/> Aceptar categoría y siguiente</button>
                  <button className="btn" disabled={bloquearDecision || !capacidad.habilitada}
                    onClick={() => void decidir('rechazar')}><XCircle size={16}/> No es correcta</button>
                </div>}
              {(cambiar || !actual.tienePropuesta || actual.revision?.estado === 'rechazada' || actual.enCola?.accion === 'rechazar') &&
                <div className="categoria-editor">
                  <h3>Elegir categoría correcta</h3>
                  <label>Buscar dentro del catálogo oficial de 2026
                    <input className="input" value={buscaCategoria}
                      disabled={false} onChange={(e) => setBuscaCategoria(e.target.value)}
                      placeholder="Ej.: peluquería, reparación, alimentación…"/>
                  </label>
                  <label>Actividad o subgrupo
                    <select className="input" aria-label="Categoría oficial" value={nodo}
                      disabled={false} onChange={(e) => setNodo(e.target.value)}>
                      <option value="">Selecciona una categoría…</option>
                      {opciones.map((op) => <option key={op.id} value={op.id}>{op.etiqueta}</option>)}
                    </select>
                  </label>
                  <label>Descripción de la actividad (cuando sea necesaria)
                    <input className="input" value={descripcion} disabled={false}
                      onChange={(e) => setDescripcion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && nodo && !e.nativeEvent.isComposing) {
                          e.preventDefault(); decidir('corregir');
                        }
                      }}
                      placeholder="Descripción breve, si procede"/>
                  </label>
                  <button className="btn primario" disabled={(bloquearDecision && actual?.enCola?.accion !== 'rechazar') || !capacidad.habilitada || !nodo}
                    onClick={() => void decidir('corregir')}>Guardar nueva categoría y siguiente</button>
                </div>}
            </>}
          {!capacidad.habilitada && <p className="categoria-advertencia" role="status">
            {capacidad.motivo || 'El guardado no está autorizado por el servidor.'}</p>}
          {actual.enCola && <p role="status" className="categoria-aviso">Esta ficha tiene una decisión todavía por guardar en el servidor.</p>}
          {error && <p role="alert" className="categoria-advertencia">{error}</p>}
          {aviso && <p role="status" className="categoria-aviso">{aviso}</p>}
          <p className="categoria-origen">Origen: {actual.fila.archivo} · fila {actual.fila.registro.fila}. Se conserva sin modificar.</p>
        </> : <p className="muted">Selecciona un negocio para confirmar su categorización.</p>}
      </section>
    </div>
  </main>;
}
