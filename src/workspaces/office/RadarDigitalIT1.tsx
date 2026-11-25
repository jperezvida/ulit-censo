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
const enlace=(url:string, texto:string) => <a href={url} target="_blank" rel="noopener noreferrer">
  {texto}<ExternalLink size={13} aria-hidden="true"/>
</a>;

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

  const actualizar=(id:string,cambio:Partial<BorradorRadar>)=>{
    setBorradores((anterior)=>{
      const previo=anterior[id]??VACIO;
      const siguiente={...anterior,[id]:{
        ...previo,...cambio,actualizado:new Date().toISOString(),
      }};
      if(campana && !guardarBorradoresRadar(campana.id,siguiente)) setAvisoLocal(true);
      return siguiente;
    });
  };
  const confirmarLote=()=>{
    if(!n || !draft.hallazgo) return;
    actualizar(n.id,validarHallazgosRadar(draft));
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
      actualizar(n.id,{
        sitioWeb:url,hallazgo:payload.hallazgo,webValidada:false,
        redesValidadas:Object.fromEntries(REDES_RADAR.map(red=>[
          red, !!draft.perfilesManuales?.[red] && draft.redesValidadas[red]===true,
        ])),estado:'pendiente',
      });
    }catch(e){setError(e instanceof Error?e.message:'Análisis no disponible.');}
    finally{setAnalizandoId(null);}
  };

  const compatibilidad=n&&draft.hallazgo
    ? nombreCompatibleRadar(n.nombre,draft.hallazgo.titulo) : null;
  const candidatos=REDES_RADAR.map(red=>({red,datos:enlaceCandidatoRadar(draft,red)}));
  const porValidar=candidatos.filter(({red,datos})=>!!datos && draft.redesValidadas[red]!==true).length +
    (draft.hallazgo&&!draft.webValidada?1:0);
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
                <button type="button" className="btn primario" disabled={analizando||!draft.sitioWeb.trim()}
                  onClick={()=>void analizar()}>
                  {analizando?<LoaderCircle size={16} className="radar-giro"/>:<ScanSearch size={16}/>}
                  {analizando?'Analizando…':'Analizar web'}
                </button>
              </div>
              <p className="radar-ayuda">El análisis es puntual, sin rastreo masivo: una sola web HTTPS que tú has elegido. Algunas webs pueden bloquear la lectura.</p>
              {error && <p className="radar-error" role="alert"><AlertCircle size={15}/>{error}</p>}
            </div>

            <div className="radar-bloque">
              <h3><span>2</span> Revisar evidencias encontradas</h3>
              {!draft.hallazgo
                ? <p className="radar-sin-evidencia">Aún no hay resultados de análisis. También puedes investigar manualmente con los enlaces de búsqueda.</p>
                : <>
                  <div className="radar-resultado">
                    <Globe2 size={16}/>
                    {enlace(draft.hallazgo.urlFinal,'Página analizada')}
                    <label><input type="checkbox" checked={draft.webValidada}
                      onChange={e=>actualizar(n.id,{webValidada:e.target.checked,estado:'pendiente'})}/>
                      Web oficial verificada por mí</label>
                  </div>
                  {REDES_RADAR.map(red=>{
                    const item=draft.hallazgo?.redes[red];
                    const Icono=REDES[red].icono;
                    return <div className="radar-resultado" key={red}>
                      <Icono size={16}/>
                      <b>{REDES[red].nombre}</b>
                      {item ? <>
                        {enlace(item,'Perfil enlazado desde la web')}
                        <label><input type="checkbox" checked={draft.redesValidadas[red]===true}
                          onChange={e=>actualizar(n.id,{
                            redesValidadas:{...draft.redesValidadas,[red]:e.target.checked},
                            estado:'pendiente',
                          })}/> Confirmado</label>
                      </> : <span className="radar-falta">No aparece enlazado; no significa que no exista</span>}
                    </div>;
                  })}
                  <div className="radar-venta">
                    <b>Posible venta online</b>
                    {draft.hallazgo.indiciosVenta.length
                      ? <p>{draft.hallazgo.indiciosVenta.join(' · ')}</p>
                      : <p>No se han detectado indicios; no implica que no venda.</p>}
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
                </>}
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
              onClick={()=>actualizar(n.id,{estado:draft.estado==='revisado'?'pendiente':'revisado'})}>
              <CheckCircle2 size={16}/>{draft.estado==='revisado'?'Volver a pendiente':'Marcar investigación revisada'}
            </button>
            <span>«Revisada» no significa que tenga web ni valida el censo.</span>
            <button className="btn" type="button" disabled={seleccion>=negocios.length-1}
              onClick={()=>{setSeleccion(x=>Math.min(x+1,negocios.length-1));setError('');}}>
              Siguiente <ArrowRight size={15}/>
            </button>
          </div>
        </>}
      </section>
    </div>
    {avisoLocal && <p role="alert" className="radar-error">El navegador impidió guardar el borrador local. Exporta los resultados antes de cerrar.</p>}
  </main>;
}
