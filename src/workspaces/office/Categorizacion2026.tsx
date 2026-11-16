import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { capacidadCategoriaReal, guardarCategoriaReal, type CapacidadCategoriaReal, type CambioCategoriaReal } from '../../store/categoriaReal';
import { ID_CATALOGO_2026 } from '../../domain/catalogo2026';
import { obtenerCategorizacionItinerario, type FilaCategorizacion } from '../../domain/categorizacionItinerarios';
import { rutaTexto } from '../../domain/buscador';
import { streetViewParaRevision } from '../../domain/streetViewRevision';
import { BuscadorClasificacion } from './BuscadorClasificacion';
import '../../styles/categorizacion-2026.css';

type Filtro = 'pendientes' | 'todas' | 'revisadas' | 'rechazadas';
const CAMPOS = [
  ['grupoActividad','Grupo de actividad'],
  ['grupoComercio','Grupo de comercio'],
  ['subgrupo','Subgrupo'],
  ['actividad','Actividad'],
  ['descripcionActividad','Descripción'],
] as const;

export default function Categorizacion2026() {
  const { itId = '' } = useParams();
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const itinerario = db.itinerarios[itId];
  const datos = useMemo(() => campana
    ? obtenerCategorizacionItinerario(db, campana.id, itId) : null,
  [db, campana?.id, itId]);
  const [filtro, setFiltro] = useState<Filtro>('pendientes');
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState('');
  const [recorridoIds, setRecorridoIds] = useState<string[] | null>(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');
  const [capacidad, setCapacidad] = useState<CapacidadCategoriaReal>({
    habilitada: false, motivo: 'Comprobando autorización…',
  });
  useEffect(() => {
    if (!fuente?.soloLectura || campana?.anio !== 2026) return;
    let vigente = true;
    void capacidadCategoriaReal().then((c) => { if (vigente) setCapacidad(c); })
      .catch(() => { if (vigente) setCapacidad({ habilitada: false,
        motivo: 'No se ha podido verificar la autorización.' }); });
    return () => { vigente = false; };
  }, [fuente?.soloLectura, campana?.id, campana?.anio]);
  if (!campana || !itinerario || !datos || campana.anio !== 2026
    || itinerario.campanaId !== campana.id) {
    return <main className="pagina"><Link to="/oficina">Volver a Oficina</Link>
      <p>La revisión de categorías solo está disponible para itinerarios confirmados de 2026.</p></main>;
  }

  const texto = busqueda.trim().toLocaleLowerCase('es');
  const filtradas = datos.filas.filter((f) =>
    (filtro === 'pendientes' ? !f.revisada
      : filtro === 'revisadas' ? f.revisada
        : filtro === 'rechazadas' ? f.revision?.estado === 'rechazada' : true)
    && (!texto || [f.origen.nombre, f.origen.direccion, f.origen.numero,
      f.existente.grupoActividad, f.existente.subgrupo, f.existente.actividad,
      String(f.origen.registro.fila)].join(' ').toLocaleLowerCase('es').includes(texto))
  );
  const porId = new Map(datos.filas.map((f) => [f.id, f]));
  const recorrido = recorridoIds
    ? recorridoIds.map((id) => porId.get(id)).filter((f): f is FilaCategorizacion => !!f)
    : filtradas;
  const indice = Math.max(0, recorrido.findIndex((f) => f.id === seleccionado));
  const actual = recorrido[indice];
  const streetView = actual ? streetViewParaRevision(db, campana.id, actual.origen) : null;

  const reset = () => {
    if (guardando) return;
    setSeleccionado('');
    setRecorridoIds(null);
    setEditando(false);
    setError('');
    setAviso('');
  };
  const elegirFiltro = (nuevo: Filtro) => {
    if (guardando) return;
    setFiltro(nuevo);
    reset();
  };
  const mover = (pos: number) => {
    if (guardando || pos < 0 || pos >= recorrido.length) return;
    setSeleccionado(recorrido[pos].id);
    setEditando(false); setError(''); setAviso('');
  };

  const guardar = async (accion: CambioCategoriaReal['accion'], nodoId = '', descripcion = '') => {
    if (!actual || !capacidad.habilitada || !datos.importacionCompleta
      || !fuente?.versionReal || !fuente.aplicarCategoriaReal || guardando) return;
    setGuardando(true); setError(''); setAviso('');
    try {
      const cambio = await guardarCategoriaReal(actual.id, itId,
        fuente.versionReal, accion, nodoId, descripcion);
      if (!recorridoIds) setRecorridoIds(recorrido.map((f) => f.id));
      fuente.aplicarCategoriaReal(cambio);
      if (accion === 'rechazar') {
        setEditando(true);
        setAviso('Clasificación anterior rechazada. Elige ahora la correcta para completar esta ficha.');
      } else {
        const siguiente = recorrido.slice(indice + 1).find((f) => !f.revisada)
          ?? recorrido.slice(0, indice).find((f) => !f.revisada);
        setSeleccionado(siguiente?.id ?? actual.id);
        setEditando(false);
        setAviso(siguiente
          ? 'Categorización guardada. Siguiente establecimiento pendiente.'
          : 'Guardado. Has terminado esta tanda; puedes volver atrás.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  const permisos = !!fuente?.soloLectura && capacidad.habilitada
    && !!fuente.aplicarCategoriaReal && datos.importacionCompleta;
  const opciones: { id: Filtro; titulo: string; cantidad: number }[] = [
    { id: 'pendientes', titulo: 'Pendientes', cantidad: datos.pendientes },
    { id: 'todas', titulo: 'Todas', cantidad: datos.ocupados },
    { id: 'revisadas', titulo: 'Revisadas', cantidad: datos.revisados },
    { id: 'rechazadas', titulo: 'Rechazadas', cantidad: datos.rechazados },
  ];

  return <main className="pagina cat26">
    <header className="cat26-cab">
      <div>
        <Link to="/oficina" className="btn s fantasma"><ChevronLeft size={14} /> Volver a itinerarios</Link>
        <div className="rotulo" style={{ marginTop: 12 }}>Oficina · {itinerario.codigo} · Fase 3</div>
        <h1>Revisión de categorización</h1>
        <p>Comprueba cada clasificación anterior. Nada queda aprobado hasta que pulses Aceptar o elijas otra categoría.</p>
      </div>
    </header>
    <div className="cat26-resumen" role="status">
      <div><b>{datos.registrosTotales}</b><small>Filas del Excel</small></div>
      <div><b>{datos.ocupados}</b><small>Ocupados a revisar</small></div>
      <div><b>{datos.conCategoria}</b><small>Con clasificación previa</small></div>
      <div><b>{datos.sinCategoria}</b><small>Sin clasificación</small></div>
      <div><b>{datos.revisados} / {datos.ocupados}</b><small>Revisados</small></div>
    </div>
    <p className="cat26-nota">{datos.vacios} locales vacíos no se categorizan.
      Cada ficha corresponde a una fila del itinerario, aunque aún no esté vinculada a un local físico.</p>
    {!datos.importacionCompleta && <p className="t-info error" role="alert">
      <AlertTriangle size={16} /> La importación no coincide con sus filas originales. Guardado bloqueado hasta comprobar la integridad.</p>}
    {!permisos && <p className="t-info aviso" role="status">
      {capacidad.motivo || 'La sesión no tiene habilitada la categorización supervisada de 2026.'}</p>}
    {aviso && <p className="cat26-mensaje ok" role="status">{aviso}</p>}
    {error && <p className="cat26-mensaje error" role="alert">{error}</p>}

    <div className="cat26-controles">
      <div className="cat26-filtros" role="group" aria-label="Filtro de categorización">
        {opciones.map((op) => <button key={op.id} type="button"
          className={filtro === op.id ? 'btn s primario' : 'btn s'}
          disabled={guardando} aria-pressed={filtro === op.id}
          onClick={() => elegirFiltro(op.id)}>{op.titulo} <b>{op.cantidad}</b></button>)}
      </div>
      <label className="cat26-busca"><Search size={15} />
        <input value={busqueda} disabled={guardando}
          onChange={(e) => { setBusqueda(e.target.value); reset(); }}
          aria-label="Buscar establecimiento" placeholder="Buscar nombre, calle o fila…" />
      </label>
    </div>

    <div className="cat26-columnas">
      <section className="cat26-lista" aria-label="Establecimientos para categorizar">
        <div className="cat26-lista-cab">{recorrido.length} establecimiento(s) en esta vista</div>
        {recorrido.map((f) => <button type="button" key={f.id}
          className={'cat26-fila' + (actual?.id === f.id ? ' activa' : '')}
          disabled={guardando} aria-pressed={actual?.id === f.id}
          onClick={() => { setSeleccionado(f.id); setEditando(false); setError(''); setAviso(''); }}>
          <strong>{f.origen.nombre || 'Nombre pendiente'}</strong>
          <span>{f.origen.direccion}, {f.origen.numero} · fila {f.origen.registro.fila}</span>
          <small className={f.revisada ? 'ok' : f.revision?.estado === 'rechazada' ? 'rechazada' : ''}>
            {f.revisada ? '✓ Revisada' : f.revision?.estado === 'rechazada'
              ? 'Rechazada · pendiente de corregir'
              : f.tieneCategoria ? 'Clasificación por confirmar' : 'Sin clasificación'}
          </small>
        </button>)}
        {recorrido.length === 0 && <p className="t-info">No hay establecimientos con este filtro.</p>}
      </section>
      <section className="cat26-detalle" aria-label="Ficha de categorización">
        {actual ? <>
          <div className="cat26-detalle-cab">
            <div><small>{itinerario.codigo} · Fila {actual.origen.registro.fila}</small>
              <h2>{actual.origen.nombre}</h2>
              <p>{actual.origen.direccion}, {actual.origen.numero}</p>
              {streetView && <a className="cat26-street btn s" href={streetView.url}
                target="_blank" rel="noopener noreferrer" title={streetView.aviso}>Ver Street View</a>}
            </div>
            <div className="cat26-nav">
              <button type="button" className="btn s icono" disabled={guardando || indice === 0}
                aria-label="Anterior establecimiento" onClick={() => mover(indice - 1)}><ChevronLeft size={15} /></button>
              <span>{indice + 1} / {recorrido.length}</span>
              <button type="button" className="btn s icono"
                disabled={guardando || indice === recorrido.length - 1}
                aria-label="Siguiente establecimiento" onClick={() => mover(indice + 1)}><ChevronRight size={15} /></button>
            </div>
          </div>
          {actual.origen.incidencias.length > 0 && <p className="cat26-aviso">
            <AlertTriangle size={14} /> Hay {actual.origen.incidencias.length} aviso(s) pendiente(s) de Fase 1.
            <Link to="/oficina/revision-general">Revisarlos</Link>
          </p>}
          <div className="cat26-origen">
            <h3>Clasificación existente en el Excel</h3>
            {actual.tieneCategoria
              ? <dl>{CAMPOS.map(([campo,etiqueta]) =>
                  <div key={campo}><dt>{etiqueta}</dt><dd>{actual.existente[campo] || '—'}</dd></div>)}</dl>
              : <p>Este establecimiento no tiene categoría previa.</p>}
          </div>
          {actual.revisada && <div className="cat26-verificada">
            <CheckCircle2 size={17} />
            <div><strong>{actual.revision?.estado === 'corregida' ? 'Categoría corregida' : 'Categoría aceptada'}</strong>
              <p>{actual.revision?.nodoId
                ? rutaTexto(actual.revision.nodoId, actual.revision.descripcion) : ''}</p>
              <small>Confirmada manualmente · {actual.revision?.fecha?.slice(0,10)}</small>
            </div>
          </div>}
          {actual.equivalente && <div className="cat26-propuesta">
            <strong>Equivalencia en el catálogo oficial 2026</strong>
            <p>{rutaTexto(actual.equivalente.nodoId, actual.equivalente.descripcion)}</p>
          </div>}
          {actual.problemaEquivalencia && <p className="cat26-aviso">
            <AlertTriangle size={15} /> {actual.problemaEquivalencia}</p>}

          <div className="cat26-acciones">
            {actual.tieneCategoria && actual.equivalente && !actual.revisada &&
              <button type="button" className="btn primario" disabled={!permisos || guardando}
                onClick={() => void guardar('aceptar', actual.equivalente!.nodoId,
                  actual.equivalente!.descripcion ?? '')}>
                <Check size={15} /> {guardando ? 'Guardando…' : 'Aceptar categoría y siguiente'}
              </button>}
            {actual.tieneCategoria && !actual.revisada &&
              actual.revision?.estado !== 'rechazada' &&
              <button type="button" className="btn" disabled={!permisos || guardando}
                onClick={() => void guardar('rechazar')}><X size={15} /> Rechazar existente</button>}
            <button type="button" className="btn s" disabled={guardando}
              onClick={() => setEditando(!editando)}>
              {actual.tieneCategoria ? 'Elegir otra categoría' : 'Elegir categoría'}
              <ArrowRight size={14} />
            </button>
          </div>
          {(editando || !actual.tieneCategoria || actual.revision?.estado === 'rechazada') && (
            <div className="cat26-selector">
              <h3>Seleccionar categoría oficial de 2026</h3>
              <p>Busca por actividad o subgrupo y elige el resultado correcto. Se guarda al seleccionar.</p>
              {permisos ? <BuscadorClasificacion
                key={actual.id} catalogo={ID_CATALOGO_2026}
                nombreNegocio={actual.origen.nombre}
                autoFocus={false}
                etiqueta="Buscar categoría del catálogo oficial"
                onElegir={(e) => void guardar('corregir', e.opcion.nodoId, e.descripcion ?? '')}
                onCancelar={() => setEditando(false)}
              /> : <p className="muted">No está permitido guardar con esta sesión.</p>}
            </div>
          )}
        </> : <p className="muted">Elige un establecimiento para empezar.</p>}
      </section>
    </div>
  </main>;
}
