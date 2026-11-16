import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { revisionCategorizacionIt1, type FilaCategorizacion, type ValoresCategorizacion } from '../../domain/revisionCategorizacionIt1';
import { ID_CATALOGO_2026 } from '../../domain/catalogo2026';
import { rutaActividad } from '../../domain/taxonomy';
import { validarSeleccion } from '../../domain/clasificacion';
import { BuscadorClasificacion, type Eleccion } from './BuscadorClasificacion';
import { capacidadCategorizacionIt1, guardarCategoriaIt1, type AccionCategoria } from '../../store/categorizacionIt1Real';
import type { CapacidadRevisionGeneral } from '../../store/revisionGeneralReal';
import { streetViewParaRevision } from '../../domain/streetViewRevision';
import '../../styles/categorizacion-it1.css';

type Filtro = 'pendientes' | 'rechazadas' | 'aceptadas' | 'todas';
const CAMPOS: {clave:keyof ValoresCategorizacion;nombre:string}[] = [
  {clave:'grupoActividad',nombre:'Grupo de actividad'},
  {clave:'grupoComercio',nombre:'Grupo de comercio'},
  {clave:'subgrupo',nombre:'Subgrupo'},
  {clave:'actividad',nombre:'Actividad'},
  {clave:'descripcionActividad',nombre:'Descripción'},
];

function categoriaDeSeleccion(e: Eleccion): ValoresCategorizacion {
  validarSeleccion(ID_CATALOGO_2026,e.opcion.nodoId,e.descripcion);
  const ruta = rutaActividad(e.opcion.nodoId);
  const nivel = (n:number) => ruta.find((v)=>v.nivel===n)?.nombre ?? '';
  return {
    grupoActividad:nivel(1),
    grupoComercio:nivel(1)==='Comercio'?nivel(2):'',
    subgrupo:nivel(3),
    actividad:nivel(4),
    descripcionActividad:e.descripcion?.trim() ?? '',
  };
}

function CategoriaActual({fila}:{fila:FilaCategorizacion}) {
  return <dl className="ci-categoria">
    {CAMPOS.map((campo)=><div key={campo.clave}>
      <dt>{campo.nombre}</dt>
      <dd>{fila.valoresCategoria[campo.clave] || <span className="muted">Sin indicar</span>}</dd>
    </div>)}
  </dl>;
}

/**
 * La fase 3 no utiliza el contador genérico de locales conciliados: las 105 filas
 * originales del IT1 están presentes, incluso las 39 que son locales vacíos.
 * Ninguna categoría importada se da por validada sin un clic humano guardado.
 */
export default function CategorizacionIt1() {
  const {db,campana} = useContexto();
  const fuente = useFuenteOficina();
  const resultado = useMemo(() => campana ? revisionCategorizacionIt1(db,campana.id) : null,[db,campana?.id]);
  const [filtro,setFiltro] = useState<Filtro>('pendientes');
  const [busqueda,setBusqueda] = useState('');
  const [seleccionado,setSeleccionado] = useState<string|null>(null);
  const [cambio,setCambio] = useState(false);
  const [nuevaCategoria,setNuevaCategoria] = useState<ValoresCategorizacion|null>(null);
  const [guardando,setGuardando] = useState(false);
  const [error,setError] = useState('');
  const [mensaje,setMensaje] = useState('');
  const [capacidad,setCapacidad] = useState<CapacidadRevisionGeneral>({habilitada:false,motivo:'Comprobando permiso…'});
  useEffect(()=>{
    if (!fuente?.soloLectura || campana?.anio!==2026) return;
    let vigente=true;
    void capacidadCategorizacionIt1().then((r)=>{if(vigente)setCapacidad(r);})
      .catch(()=>{if(vigente)setCapacidad({habilitada:false,motivo:'No se pudo verificar el guardado.'});});
    return ()=>{vigente=false;};
  },[fuente?.soloLectura,campana?.id,campana?.anio]);

  if (!campana || !resultado) return null;
  const lista=resultado.ocupados.filter((fila)=>
    (filtro==='todas' || (filtro==='pendientes' && fila.decision!=='aceptada')
      || (filtro==='rechazadas' && fila.decision==='rechazada')
      || (filtro==='aceptadas' && fila.decision==='aceptada'))
    && (!busqueda || [fila.nombre,fila.direccion,fila.numero,String(fila.registro.fila)]
      .join(' ').toLocaleLowerCase('es').includes(busqueda.trim().toLocaleLowerCase('es')))
  );
  const indice=Math.max(0,lista.findIndex((f)=>f.id===seleccionado));
  const fila=lista[indice];
  const sv=fila?streetViewParaRevision(db,campana.id,fila):null;

  const ir=(id:string|null)=>{
    if(guardando)return;
    setSeleccionado(id);setCambio(false);setNuevaCategoria(null);setError('');setMensaje('');
  };
  const guardar=async(accion:AccionCategoria)=>{
    if(!fila||!fuente?.versionReal||!fuente.aplicarCorreccionReal||!capacidad.habilitada||guardando)return;
    setError('');setGuardando(true);
    const anterior=lista.map((f)=>f.id);
    try {
      const res=await guardarCategoriaIt1(fila.id,fuente.versionReal,accion,
        accion==='asignar'?nuevaCategoria??undefined:undefined);
      fuente.aplicarCorreccionReal(res);
      setCambio(false);setNuevaCategoria(null);
      // Si la fila desaparece de «Pendientes», continuar con la siguiente fila
      // sin volver a leer las entidades completas de Supabase.
      const siguiente=anterior.slice(indice+1).find((id)=>id!==fila.id)
        ?? anterior.slice(0,indice).find((id)=>id!==fila.id);
      setSeleccionado(siguiente??fila.id);
      setMensaje(accion==='aceptar'?'Categoría existente aceptada.'
        :accion==='rechazar'?'Categoría rechazada. Queda pendiente de sustituir.'
        :'Nueva categoría guardada y confirmada.');
    } catch(e) {
      setError(e instanceof Error?e.message:String(e));
    } finally {setGuardando(false);}
  };

  const ready=resultado.registrosOrigen===105 && resultado.ocupados.length+resultado.vacios+resultado.desconocidos===105
    && !resultado.duplicadas.length && !resultado.faltantes.length;
  return <main className="pagina ci-pagina">
    <Link className="btn s fantasma" to="/oficina"><ArrowLeft size={14}/> Volver a Oficina</Link>
    <header className="ci-cab">
      <div className="rotulo">Oficina · Medina del Campo 2026 · IT1 · Fase 3</div>
      <h1>Revisar categorización</h1>
      <p>Cada negocio debe revisarse. Una clasificación importada nunca se acepta automáticamente.</p>
    </header>
    <div className="ci-resumen" role="status">
      <span><b>{resultado.registrosOrigen}</b> filas IT1</span>
      <span><b>{resultado.ocupados.length}</b> ocupados</span>
      <span><b>{resultado.vacios}</b> vacíos, no se categorizan</span>
      <span><b>{resultado.aceptadas}</b> validados</span>
      <span className={resultado.pendientes?'ci-alerta':''}><b>{resultado.pendientes}</b> por revisar</span>
    </div>
    {!ready && <p role="alert" className="t-info aviso">
      La comprobación del IT1 requiere atención: {resultado.duplicadas.length} filas repetidas,
      {' '}{resultado.faltantes.length} ausentes y {resultado.desconocidos} estados sin confirmar.
      No se ha dado por completo el itinerario.
    </p>}
    <p className="muted ci-subresumen">
      {resultado.existentes} ocupados con categoría previa · {resultado.sinCategoria} sin categoría.
      Las {resultado.registrosOrigen} filas del Excel se conservan, y las decisiones se guardan por separado.
    </p>
    {mensaje && <p className="ci-mensaje" role="status">{mensaje}</p>}
    <div className="ci-filtros">
      {([
        ['pendientes', 'Por revisar', resultado.pendientes],
        ['rechazadas', 'Rechazadas', resultado.rechazadas],
        ['aceptadas', 'Aceptadas', resultado.aceptadas],
        ['todas', 'Todos los ocupados', resultado.ocupados.length],
      ] as [Filtro,string,number][]).map(([clave,etiqueta,total])=>
        <button key={clave} className={'btn s '+(filtro===clave?'primario':'')} type="button"
          disabled={guardando} aria-pressed={filtro===clave}
          onClick={()=>{setFiltro(clave);ir(null);}}>{etiqueta} <b>{total}</b></button>)}
      <label className="ci-busqueda"><Search size={14}/>
        <input disabled={guardando} aria-label="Buscar local del IT1" placeholder="Calle, negocio o fila…"
          value={busqueda} onChange={(e)=>{setBusqueda(e.target.value);ir(null);}}/>
      </label>
    </div>
    <div className="ci-columnas">
      <section className="ci-lista" aria-label="Locales ocupados IT1">
        <div className="ci-lista-titulo">{lista.length} negocios en esta vista</div>
        {lista.map((f)=><button type="button" key={f.id} disabled={guardando}
          className={'ci-item '+(fila?.id===f.id?'seleccionado':'')}
          onClick={()=>ir(f.id)}>
          <span><b>{f.nombre||'Ocupado sin nombre'}</b>
            <small>{f.direccion}, {f.numero} · fila {f.registro.fila}</small>
          </span>
          <span className={'ci-estado ci-'+f.decision}>{f.decision==='aceptada'?'Revisada':f.decision==='rechazada'?'Rechazada':'Pendiente'}</span>
        </button>)}
        {!lista.length && <p className="muted">No hay registros en este filtro.</p>}
      </section>
      <section className="ci-detalle" aria-label="Detalle de categorización">
        {fila ? <>
          <div className="ci-detalle-cab">
            <div><small>IT1 · Fila {fila.registro.fila} · Ocupado</small><h2>{fila.nombre}</h2>
              <p>{fila.direccion}, {fila.numero}</p>
              {sv && <a href={sv.url} target="_blank" rel="noopener noreferrer"
                className="btn s ci-sv">Ver Street View</a>}
            </div>
            <div className="ci-nav">
              <button type="button" className="btn s icono" aria-label="Categoría anterior"
                disabled={guardando||indice===0} onClick={()=>ir(lista[indice-1].id)}>
                <ChevronLeft size={15}/></button>
              <span>{indice+1} / {lista.length}</span>
              <button type="button" className="btn s icono" aria-label="Categoría siguiente"
                disabled={guardando||indice===lista.length-1} onClick={()=>ir(lista[indice+1].id)}>
                <ChevronRight size={15}/></button>
            </div>
          </div>
          <h3>{fila.tieneCategoria?'Categorización existente':'Sin categoría en el Excel'}</h3>
          <CategoriaActual fila={fila}/>
          {fila.decision==='aceptada' && <p className="ci-confirmada"><Check size={14}/> Categoría revisada y aceptada por una persona.</p>}
          {fila.decision==='rechazada' && <p className="ci-rechazada">Categoría anterior rechazada: elige la correcta para cerrar esta ficha.</p>}
          {error && <p role="alert" className="t-info error">{error}</p>}
          {!capacidad.habilitada && <p className="t-info aviso" role="status">{capacidad.motivo}</p>}
          <div className="ci-acciones">
            {fila.tieneCategoria && fila.decision!=='aceptada' && <button type="button"
              className="btn primario" disabled={guardando||!capacidad.habilitada}
              onClick={()=>void guardar('aceptar')}><Check size={15}/> Aceptar categoría y siguiente</button>}
            {fila.tieneCategoria && fila.decision!=='rechazada' && <button type="button"
              className="btn s" disabled={guardando||!capacidad.habilitada}
              onClick={()=>void guardar('rechazar')}><X size={15}/> Rechazar categoría</button>}
            <button type="button" className="btn s" disabled={guardando}
              onClick={()=>{setCambio(!cambio);setNuevaCategoria(null);}}>
              {cambio?'Cerrar selección':fila.tieneCategoria?'Cambiar categoría':'Asignar categoría'}
            </button>
          </div>
          {(cambio||fila.decision==='rechazada'||!fila.tieneCategoria)&&
            <div className="ci-nueva">
              <h3>Elegir categoría del catálogo oficial 2026</h3>
              <BuscadorClasificacion key={fila.id} catalogo={ID_CATALOGO_2026}
                nombreNegocio={fila.nombre} autoFocus={false} etiqueta="Buscar nueva categoría"
                onElegir={(e)=>{try{setNuevaCategoria(categoriaDeSeleccion(e));setError('');}
                  catch(error){setError(error instanceof Error?error.message:String(error));}}}/>
              {nuevaCategoria && <>
                <dl>{CAMPOS.filter(c=>nuevaCategoria[c.clave]).map(c=><div key={c.clave}>
                  <dt>{c.nombre}</dt><dd>{nuevaCategoria[c.clave]}</dd></div>)}</dl>
                <button className="btn primario" type="button" disabled={guardando||!capacidad.habilitada}
                  onClick={()=>void guardar('asignar')}>
                  Guardar nueva categoría y siguiente <ArrowRight size={14}/>
                </button>
              </>}
            </div>}
        </> : <p className="muted">Selecciona un negocio del IT1 para revisar su categoría.</p>}
      </section>
    </div>
  </main>;
}
