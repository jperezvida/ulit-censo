import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BarChart3, ChevronDown, Database, FolderKanban, Inbox, Map, PieChart, ShieldCheck, Smartphone } from 'lucide-react';
import { useContexto, useFichaLocal } from '../store/contexto';
import { useFuenteOficina } from '../store/fuenteOficina';
import { FichaLocal } from '../workspaces/local/FichaLocal';

const AREAS = [
  { to: '/campanas', txt: 'Campañas', icono: FolderKanban },
  { to: '/territorio', txt: 'Territorio', icono: Map },
  { to: '/oficina', txt: 'Oficina', icono: Inbox },
  { to: '/datos', txt: 'Datos', icono: Database },
  { to: '/analisis', txt: 'Análisis', icono: BarChart3 },
  { to: '/visualizacion', txt: 'Visualización', icono: PieChart },
];

/** La barra ORIGINAL de la app completa, sin bifurcaciones de demo/espacios. */
export function Shell() {
  const { db, municipio, campana, campanas } = useContexto();
  const fuente = useFuenteOficina();
  const ficha = useFichaLocal();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const admin = fuente?.roles.includes('administrador') ?? false;

  return <div className="shell">
    <header className="barra-sup">
      <NavLink to="/campanas" className="marca-ulit" title="ULIT Censo · aplicación completa">
        <b>ULIT</b><span>Censo</span>
      </NavLink>
      <div className="ctx-wrap">
        <button className="ctx" onClick={() => setMenu(!menu)} aria-haspopup="menu">
          <span className="ctx-mun">{municipio.nombre}</span>
          <span className="ctx-camp mono">{campana?.nombre ?? '—'}</span>
          <ChevronDown size={14}/>
        </button>
        {menu && <div className="menu panel-flotante" role="menu" onMouseLeave={() => setMenu(false)}>
          {Object.values(db.municipios).map((m) => <div key={m.id} className="menu-grupo">
            <div className="rotulo sin-linea">{m.nombre}</div>
            {Object.values(db.campanas).filter((c) => c.municipioId===m.id).sort((a,b) => b.anio-a.anio)
              .map((c) => <button key={c.id} className={`menu-item ${c.id===campana?.id?'on':''}`}
                onClick={() => { fuente?.elegirCampana?.(c.id); setMenu(false); }}>
                <span>{c.nombre}</span><span className="muted mono">{c.tipo==='historico-importado'?'importado':c.tipo}</span>
              </button>)}
          </div>)}
          <div className="menu-nota muted">{campanas.length} campañas en {municipio.nombre}</div>
        </div>}
      </div>
      <nav className="espacios" aria-label="Espacios de trabajo">
        {AREAS.map(({to,txt,icono:I}) => <NavLink key={to} to={to} className={({isActive})=>`espacio ${isActive?'on':''}`}>
          <I size={16}/><span>{txt}</span>
        </NavLink>)}
      </nav>
      <div className="barra-der">
        <span className="mono ocultar-m version-app" title={`Versión en ejecución: commit ${import.meta.env.VITE_COMMIT??'?'}`}>
          v {String(import.meta.env.VITE_COMMIT??'').slice(0,7)}
        </span>
        <span className="chip real sim-global" title="Datos auténticos de Supabase, escritura ordinaria bloqueada">
          Datos reales · consulta
        </span>
        {admin && <button className="btn s oscuro-borde" onClick={() => nav('/administracion')} title="Administración y respaldos (en esta aplicación)" aria-label="Administración y respaldos">
          <ShieldCheck size={16}/></button>}
        <span className="btn s oscuro-borde" aria-disabled="true" title="Campo móvil: aún no habilitado con datos reales"><Smartphone size={16}/></span>
      </div>
    </header>
    <main className="contenido"><Outlet /></main>
    <nav className="nav-inferior" aria-label="Espacios">
      {AREAS.map(({to,txt,icono:I}) => <NavLink key={to} to={to} className={({isActive})=>isActive?'on':''}>
        <I size={19}/><span>{txt}</span>
      </NavLink>)}
    </nav>
    {ficha.abierto && db.locales[ficha.abierto] && <FichaLocal localId={ficha.abierto} onCerrar={ficha.cerrar}/>}
  </div>;
}
