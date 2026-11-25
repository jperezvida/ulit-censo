import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Globe2, Instagram, Facebook,
  ScanSearch, LoaderCircle, ShieldCheck, FileDown, AlertCircle,
} from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { clienteServidor } from '../../store/clienteSupabase';
import {
  CAMPOS_DIGITALES_EXCEL, REDES_RADAR,
  negociosPilotoRadar, enlacesBusquedaRadar, interpretarPresenciaExcel,
  leerBorradoresRadar, guardarBorradoresRadar, resumenPilotoRadar,
  normalizarPerfilRadar, enlaceCandidatoRadar, validarHallazgosRadar, nombreCompatibleRadar,
  type BorradoresRadar, type BorradorRadar, type HallazgoRadar, type RedRadar,
} from '../../domain/radarDigitalIT1';
import '../../styles/radar-digital.css';

const REDES: Record<RedRadar,{nombre:string; icono:typeof Globe2}> = {
  instagram:{nombre:'Instagram',icono:Instagram},
  facebook:{nombre:'Facebook',icono:Facebook},
  twitter:{nombre:'X / Twitter',icono:Globe2},
};
const VACIO: BorradorRadar = {
  sitioWeb:'',webValidada:false,redesValidadas:{},ventaOnline:'pendiente',
  estado:'pendiente',actualizado:'',
};
const etiquetaExcel=(valor:string) => {
  const estado=interpretarPresenciaExcel(valor);
  return estado==='si'?'Sí':estado==='no'?'No':'Sin dato';
};
const enlace=(url:string, texto:string) => {
  try {
    const u=new URL(url);
    if(u.protocol!=='https:' || u.username || u.password) throw Error('Enlace inseguro');
    return <a href={u.toString()} target="_blank" rel="noopener noreferrer">
      {texto}<ExternalLink size={13} aria-hidden="true"/>
    </a>;
  } catch {
    return <span className="radar-falta">{texto}: enlace descartado por seguridad</span>;
  }
};

function exportarJSON(data:unknown){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='ulit-radar-digital-it1-piloto.json';
  document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(url);
}

export default function RadarDigitalIT1() {
  const {db,campana}=useContexto();
  const fuente=useFuenteOficina();
  const negocios=useMemo(()=>campana?negociosPilotoRadar(db,campana.id):[],[db,campana?.id]);
  const [seleccion,setSeleccion]=useState(0);
  const [borradores,setBorradores]=useState<BorradoresRadar>(
    ()=>campana?leerBorradoresRadar(campana.id):{});
  const [analizandoId,setAnalizandoId]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [avisoLocal,setAvisoLocal]=useState(false);

  useEffect(()=>{
    setBorradores(campana?leerBorradoresRadar(campana.id):{});
    setSeleccion(0);
  },[campana?.id]);

  const n=negocios[Math.min(seleccion,Math.max(0,negocios.length-1))];
  const draft=n?borradores[n.id]??VACIO:VACIO;
  const resumen=resumenPilotoRadar(negocios,borradores);
  const buscar=n?enlacesBusquedaRadar(n):null;

  const actualizar=(id:string,cambio:Partial<BorradorRadar> |
      ((vigente:BorradorRadar)=>Partial<BorradorRadar>|null))=>{
    setBorradores((anterior)=>{
      const previo=anterior[id]??VACIO;
      const aplicado=typeof cambio==='function'?cambio(previo):cambio;
      if(!aplicado) return anterior;
      const siguiente={...anterior,[id]:{
        ...previo,...aplicado,actualizado:new Date().toISOString(),
      }};
      if(campana && !guardarBorradoresRadar(campana.id,siguiente)) setAvisoLocal(true);
      return siguiente;
    });
  };
  const confirmarLote=()=>{
    if(!n || !draft.hallazgo) return;
    actualizar(n.id,validarHallazgosRadar(draft));
  };
  const confirmarWebManual=()=>{
    if(!n || !draft.sitioWeb.trim()) return;
    try {
      const url=new URL(draft.sitioWeb.trim());
      if(url.protocol!=='https:' || !url.hostname.includes('.') || url.username || url.password)
        throw Error('URL no válida');
      actualizar(n.id,{webValidada:!draft.webValidada,estado:'pendiente'});
      setError('');
    } catch {
      setError('Comprueba e introduce una dirección HTTPS completa antes de validar la web.');
    }
  };
  const pegarEnlace=async()=>{
    try {
      if(!navigator.clipboard?.readText) throw Error('not supported');
      const texto=await navigator.clipboard.readText();
      if(!texto.trim()) throw Error('empty');
      webCambio(texto.trim());
    } catch {
      setError('No se pudo leer el portapapeles. Pega el enlace en el campo con Ctrl+V.');
    }
  };
  const actualizarPerfil=(red:RedRadar,texto:string)=>{
    if(!n) return;
    actualizar(n.id,{
      perfilesManuales:{...draft.perfilesManuales,[red]:texto},
      redesValidadas:{...draft.redesValidadas,[red]:false},
      estado:'pendiente',
    });
  };
  const webCambio=(valor:string)=>{
    if(!n) return;
    actualizar(n.id,{
      sitioWeb:valor, hallazgo:undefined, webValidada:false,
      redesValidadas:{...Object.fromEntries(REDES_RADAR.map(red=>[red,
        !!draft.perfilesManuales?.[red] && draft.redesValidadas[red]===true]))},
      ventaOnline:'pendiente',estado:'pendiente',
    });
    setError('');
  };
  const analizar=async()=>{
    if(!n || !draft.sitioWeb.trim() || analizandoId) return;
    setError('');
    let url:string;
    try{
      const valor=draft.sitioWeb.trim();
      const parse=new URL(/^https?:\/\//i.test(valor)?valor:'https://'+valor);
      if(parse.protocol!=='https:' || !parse.hostname.includes('.'))
        throw new Error('Debe ser una dirección HTTPS pública.');
      url=parse.toString();
    }catch{return setError('Introduce una URL HTTPS pública válida.');}
    setAnalizandoId(n.id);
    try {
      const cliente=clienteServidor();
      const sesion=await cliente?.auth.getSession();
      const jwt=sesion?.data.session?.access_token;
      if(!jwt) throw Error('La sesión no está disponible; vuelve a iniciar sesión.');
      const respuesta=await fetch('/api/radar-web',{
        method:'POST',
        headers:{'content-type':'application/json','authorization':'Bearer '+jwt},
        body:JSON.stringify({url}),
      });
      const payload=await respuesta.json() as {error?:string; hallazgo?:HallazgoRadar};
      if(!respuesta.ok || !payload.hallazgo)
        throw Error(payload.error||'No se ha podido leer la web.');
      // No sobreescribir la selección del usuario: resultado vinculado al registro de partida.
      const solicitado=draft.sitioWeb.trim();
      actualizar(n.id,(vigente)=>vigente.sitioWeb.trim()!==solicitado ? null : ({
        sitioWeb:url,hallazgo:payload.hallazgo,webValidada:false,
        redesValidadas:Object.fromEntries(REDES_RADAR.map(red=>[
          red, !!vigente.perfilesManuales?.[red] && vigente.redesValidadas[red]===true,
        ])),estado:'pendiente',
      }));
    }catch(e){setError(e instanceof Error?e.message:'Análisis no disponible.');}
    finally{setAnalizandoId(null);}
  };

  const compatibilidad=n&&draft.hallazgo
    ? nombreCompatibleRadar(n.nombre,draft.hallazgo.titulo) : null;
  const candidatos=REDES_RADAR.map(red=>({red,datos:enlaceCandidatoRadar(draft,red)}));
  const porValidar=candidatos.filter(({red,datos})=>!!datos && draft.redesValidadas[red]!==true).length +
    (draft.hallazgo&&!draft.webValidada?1:0);
  const irSiguientePendiente=()=>{
    const siguiente=negocios.findIndex((item,i)=>
      i>seleccion && borradores[item.id]?.estado!=='revisado');
    const primerPendiente=negocios.findIndex(item=>borradores[item.id]?.estado!=='revisado');
    setSeleccion(siguiente>=0?siguiente:primerPendiente>=0?primerPendiente:
      Math.min(seleccion+1,negocios.length-1));
    setError('');
  };
  const terminarInvestigacion=()=>{
    if(!n) return;
    const terminada=draft.estado!=='revisado';
    actualizar(n.id,{estado:terminada?'revisado':'pendiente'});
    if(terminada){
      const siguiente=negocios.findIndex((item,i)=>i>seleccion && borradores[item.id]?.estado!=='revisado');
      if(siguiente>=0){setSeleccion(siguiente);setError('');}
    }
  };
  const listaResultados=negocios.map((negocio,i)=>({
    id:negocio.id,nombre:negocio.nombre,
    datosExcel:negocio.datosExcel,
    ...borradores[negocio.id],
    seleccion:i,
  }));
  if(!campana || campana.anio!==2026 || !fuente?.soloLectura)
    return <main className="pagina"><p>El piloto del Radar Digital solo está disponible en la Oficina real de 2026.</p></main>;
  return <main className="pagina radar-piloto">
    <header className="radar-cab">
      <Link className="btn s fantasma" to="/oficina"><ArrowLeft size={15}/> Volver a Oficina</Link>
      <div className="rotulo">Oficina · IT1 · Fase 4 · Piloto sin coste adicional</div>
      <h1><ScanSearch size={26} aria-hidden="true"/> Radar Digital</h1>
      <p>Investigación asistida de 10 negocios. Busca la web oficial, analiza sus enlaces y valida las evidencias.</p>
      <div className="radar-advertencia" role="note"><ShieldCheck size={17}/>
        <span><b>Ensayo independiente.</b> Los resultados se guardan solo como borrador en este navegador.
          No modifican el censo, no convierten «no encontrado» en «No» y no requieren APIs de pago.</span>
      </div>
    </header>

    <div className="radar-progreso" role="status" aria-label="Progreso del piloto">
      <span><b>{resumen.total}</b> negocios del piloto</span>
      <span><b>{resumen.finalizados}</b> revisados en este navegador</span>
      <span><b>{resumen.conWeb}</b> webs validadas</span>
      <button type="button" className="btn s" onClick={()=>exportarJSON({
        formato:'ulit-radar-digital-piloto-v1',campanaId:campana.id,
        descripcion:'Evidencias de trabajo; sin escribir en el censo',
        negocios:listaResultados,
      })}><FileDown size={15}/> Exportar resultados</button>
    </div>

    <div className="radar-disposicion">
      <aside className="radar-lista" aria-label="Negocios del piloto">
        <div className="radar-lista-titulo">10 negocios del Excel IT1</div>
        {negocios.map((item,i)=><button type="button" key={item.id}
          className={'radar-fila'+(i===seleccion?' activo':'')}
          aria-current={i===seleccion?'step':undefined}
          onClick={()=>{setSeleccion(i);setError('');}}>
          <span className="radar-ordinal">{i+1}</span>
          <span className="radar-fila-nombre">{item.nombre}<small>{item.direccion}, {item.numero}</small></span>
          {borradores[item.id]?.estado==='revisado'
            ? <CheckCircle2 size={17} color="#18835b" aria-label="Revisado"/>
            : <span className="radar-punto-pendiente" aria-label="Pendiente"/>}
        </button>)}
      </aside>

      <section className="radar-detalle" aria-label="Investigación del establecimiento">
        {!n?<p>No hay negocios ocupados para este piloto.</p>:<>
          <div className="radar-negocio">
            <span className="rotulo">NEGOCIO {seleccion+1} DE {negocios.length} · FILA {n.fila}</span>
            <h2>{n.nombre}</h2>
            <p>{n.direccion}, {n.numero} · Medina del Campo</p>
          </div>
          <div className="radar-pasos-trabajo">
            <div className="radar-bloque">
              <h3><span>1</span> Encontrar la web oficial</h3>
              <p className="radar-ayuda">Búsquedas ya preparadas con nombre, calle y municipio.</p>
              <div className="radar-buscadores">
                {buscar && <>
                  {enlace(buscar.web,'Buscar web oficial')}
                  {enlace(buscar.google,'Buscar ficha de Google')}
                  {enlace(buscar.instagram,'Buscar Instagram')}
                  {enlace(buscar.facebook,'Buscar Facebook')}
                </>}
              </div>
              <label htmlFor="radar-web-oficial">Web candidata (pégala aquí cuando la identifiques)</label>
              <div className="radar-web-form">
                <input id="radar-web-oficial" type="url" value={draft.sitioWeb}
                  placeholder="https://www.ejemplo.es" autoComplete="off"
                  onChange={e=>webCambio(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void analizar();}}}/>
                <button type="button" className="btn radar-pegar" onClick={()=>void pegarEnlace()}>
                  Pegar enlace
                </button>
                <button type="button" className="btn primario" disabled={!!analizandoId||!draft.sitioWeb.trim()}
                  onClick={()=>void analizar()}>
                  {analizandoId===n.id?<LoaderCircle size={16} className="radar-giro"/>:<ScanSearch size={16}/>}
                  {analizandoId===n.id?'Analizando…':'Analizar web'}
                </button>
              </div>
              <p className="radar-ayuda">El análisis es puntual, sin rastreo masivo: una sola web HTTPS que tú has elegido. Algunas webs pueden bloquear la lectura.</p>
              {error && <p className="radar-error" role="alert"><AlertCircle size={15}/>{error}</p>}
            </div>

            <div className="radar-bloque">
              <h3><span>2</span> Revisar evidencias encontradas</h3>
              {draft.hallazgo ? <>
                <div className="radar-modelo">
                  <div className="radar-modelo-fuente">
                    <span className="radar-modelo-etiqueta">Fuente consultada</span>
                    {enlace(draft.hallazgo.urlFinal,'Página analizada')}
                    {draft.hallazgo.analizadoEn && <small>
                      Analizada: {new Date(draft.hallazgo.analizadoEn).toLocaleString('es-ES')}
                    </small>}
                  </div>
                  {draft.hallazgo.titulo && <p className="radar-modelo-titulo">
                    Título de la página: <b>{draft.hallazgo.titulo}</b>
                  </p>}
                  {compatibilidad===true && <p className="radar-concordancia">El nombre aparece en el título: indicio orientativo.</p>}
                  {compatibilidad===false && <p className="radar-discrepancia">
                    El título no coincide claramente con el nombre del comercio. Comprueba la dirección.
                  </p>}
                  <label className="radar-verificar">
                    <input type="checkbox" checked={draft.webValidada}
                      onChange={e=>actualizar(n.id,{webValidada:e.target.checked,estado:'pendiente'})}/>
                    Web oficial verificada por mí
                  </label>
                </div>
                <div className="radar-lote">
                  <span><b>{porValidar}</b> propuestas sin confirmar</span>
                  <button type="button" className="btn primario" disabled={porValidar===0}
                    onClick={confirmarLote}>
                    <CheckCircle2 size={16}/> Confirmar web y enlaces comprobados
                  </button>
                </div>
                <p className="radar-ayuda">La confirmación agrupada es una decisión tuya: abre los enlaces antes de aceptarlos.</p>
              </> : <div className="radar-sin-evidencia">
                <p>Sin análisis automático. Puedes comprobar la web y los perfiles manualmente.</p>
                {draft.sitioWeb.trim() && <div className="radar-sin-analisis-acciones">
                  {(() => {
                    try {
                      const u=new URL(draft.sitioWeb);
                      return u.protocol==='https:' && u.hostname.includes('.') ? enlace(u.toString(),'Abrir web candidata') : null;
                    } catch { return null; }
                  })()}
                  <button type="button" className="btn s" onClick={confirmarWebManual}>
                    {draft.webValidada ? 'Desmarcar web verificada':'He comprobado que es la web oficial'}
                  </button>
                </div>}
              </div>}
              <div className="radar-redes">
                <h4>Perfiles sociales <small>Solo los que hayas encontrado y comprobado</small></h4>
                {candidatos.map(({red,datos})=>{
                  const Icono=REDES[red].icono;
                  return <div className="radar-resultado" key={red}>
                    <Icono size={16} aria-hidden="true"/>
                    <b>{REDES[red].nombre}</b>
                    {datos ? <>
                      {enlace(datos.url,'Abrir perfil propuesto')}
                      <span className="radar-origen">{datos.origen==='web'?'Enlazado desde la web':'Encontrado manualmente'}</span>
                      <label><input type="checkbox" checked={draft.redesValidadas[red]===true}
                        onChange={e=>actualizar(n.id,{
                          redesValidadas:{...draft.redesValidadas,[red]:e.target.checked},
                          estado:'pendiente',
                        })}/> Confirmado</label>
                    </> : <span className="radar-falta">Sin enlace identificado · No equivale a ausencia</span>}
                  </div>;
                })}
                <details className="radar-manuales">
                  <summary>Añadir perfiles encontrados manualmente</summary>
                  <p>Introduce la URL completa del perfil correspondiente a este comercio. No se confirma automáticamente.</p>
                  {REDES_RADAR.map(red=><div className="radar-manual-fila" key={red}>
                    <label htmlFor={`radar-manual-${red}`}>{REDES[red].nombre}</label>
                    <input id={`radar-manual-${red}`} type="url"
                      placeholder={red==='instagram'?'https://www.instagram.com/negocio/':
                        red==='facebook'?'https://www.facebook.com/negocio/':'https://x.com/negocio/'}
                      value={draft.perfilesManuales?.[red]??''}
                      onChange={e=>actualizarPerfil(red,e.target.value)} />
                    {!!draft.perfilesManuales?.[red] && !normalizarPerfilRadar(red,draft.perfilesManuales[red]!) &&
                      <small className="radar-error-inline">Dirección de perfil no válida</small>}
                  </div>)}
                </details>
              </div>
              <div className="radar-venta">
                <b>Venta online</b>
                {draft.hallazgo ? draft.hallazgo.indiciosVenta.length
                  ? <p>Indicios detectados: {draft.hallazgo.indiciosVenta.join(' · ')}. Comprueba si realmente permite comprar.</p>
                  : <p>No se han detectado indicios. Esto no significa que no venda online.</p>
                  : <p>Puedes comprobarla manualmente aunque no haya web analizada.</p>}
                <label>Comprobación humana
                  <select value={draft.ventaOnline} onChange={e=>actualizar(n.id,{
                    ventaOnline:e.target.value as BorradorRadar['ventaOnline'],estado:'pendiente',
                  })}>
                    <option value="pendiente">Pendiente</option>
                    <option value="si">Sí, permite comprar online</option>
                    <option value="no">No vende online</option>
                  </select>
                </label>
              </div>
              <details className="radar-excel">
                <summary>Ver valores originales del Excel (sin cambios)</summary>
                <div>{CAMPOS_DIGITALES_EXCEL.map(c=><span key={c.clave}>
                  {c.etiqueta}: <strong>{etiquetaExcel(n.datosExcel[c.clave])}</strong>
                </span>)}</div>
              </details>
            </div>
          </div>
          <div className="radar-pie">
            <button type="button" className={'btn '+(draft.estado==='revisado'?'':'primario')}
              onClick={terminarInvestigacion}>
              <CheckCircle2 size={16}/>{draft.estado==='revisado'?'Volver a pendiente':'Marcar investigación revisada y avanzar'}
            </button>
            <span>«Revisada» significa investigación realizada, no que todos los datos estén confirmados en el censo.</span>
            <button className="btn" type="button" disabled={negocios.length<2}
              onClick={irSiguientePendiente}>Siguiente pendiente <ArrowRight size={15}/></button>
          </div>
        </>}
      </section>
    </div>
    {avisoLocal && <p role="alert" className="radar-error">El navegador impidió guardar el borrador local. Exporta los resultados antes de cerrar.</p>}
  </main>;
}
