import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { BarChart3, ChevronDown, Compass, Database, FolderKanban, Inbox, Map, PieChart, Smartphone, UserCog } from 'lucide-react';
import { useStore } from '../store/store';
import { useContexto, useFichaLocal } from '../store/contexto';
import type { Rol } from '../domain/types';
import { FichaLocal } from '../workspaces/local/FichaLocal';
import { GuiaDemo } from '../workspaces/demo/GuiaDemo';

const ESPACIOS = [
  { to: '/campanas', txt: 'Campañas', icono: FolderKanban },
  { to: '/territorio', txt: 'Territorio', icono: Map },
  { to: '/oficina', txt: 'Oficina', icono: Inbox },
  { to: '/datos', txt: 'Datos', icono: Database },
  { to: '/analisis', txt: 'Análisis', icono: BarChart3 },
  { to: '/visualizacion', txt: 'Visualización', icono: PieChart },
];

const ROLES: { r: Rol; t: string; d: string }[] = [
  { r: 'administrador', t: 'Administrador', d: 'Configuración y control general' },
  { r: 'coordinador', t: 'Coordinador', d: 'Campañas, itinerarios y equipos' },
  { r: 'investigador', t: 'Investigador', d: 'Trabajo de campo' },
  { r: 'revisor', t: 'Revisor', d: 'Oficina, validación y calidad' },
];

export function Shell() {
  const { db, municipio, campana, campanas, prefs } = useContexto();
  const setPrefs = useStore((s) => s.setPrefs);
  const ficha = useFichaLocal();
  const nav = useNavigate();
  const [menu, setMenu] = useState<'ctx' | 'rol' | null>(null);

  return (
    <div className="shell">
      <header className="barra-sup">
        <NavLink to="/campanas" className="marca-ulit" title="ULIT Censo · prototipo">
          <b>ULIT</b>
          <span>Censo</span>
        </NavLink>

        <div className="ctx-wrap">
          <button className="ctx" onClick={() => setMenu(menu === 'ctx' ? null : 'ctx')} aria-haspopup="menu">
            <span className="ctx-mun">{municipio.nombre}</span>
            <span className="ctx-camp mono">{campana?.nombre ?? '—'}</span>
            <ChevronDown size={14} />
          </button>
          {menu === 'ctx' && (
            <div className="menu panel-flotante" role="menu" onMouseLeave={() => setMenu(null)}>
              {Object.values(db.municipios).map((m) => (
                <div key={m.id} className="menu-grupo">
                  <div className="rotulo sin-linea">{m.nombre}</div>
                  {Object.values(db.campanas)
                    .filter((c) => c.municipioId === m.id)
                    .sort((a, b) => b.anio - a.anio)
                    .map((c) => (
                      <button
                        key={c.id}
                        className={`menu-item ${c.id === campana?.id ? 'on' : ''}`}
                        onClick={() => {
                          setPrefs({ municipioId: m.id, campanaId: c.id });
                          setMenu(null);
                        }}
                      >
                        <span>{c.nombre}</span>
                        <span className="muted mono">{c.tipo === 'historico-importado' ? 'importado' : c.tipo}</span>
                      </button>
                    ))}
                </div>
              ))}
              <div className="menu-nota muted">{campanas.length} campañas en {municipio.nombre}</div>
            </div>
          )}
        </div>

        <nav className="espacios" aria-label="Espacios de trabajo">
          {ESPACIOS.map(({ to, txt, icono: I }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `espacio ${isActive ? 'on' : ''}`}>
              <I size={16} />
              <span>{txt}</span>
            </NavLink>
          ))}
        </nav>

        <div className="barra-der">
          <span className="chip sim sim-global" title="Todos los locales, negocios, personas, itinerarios y resultados son ficticios">
            Datos simulados
          </span>
          <button className="btn s oscuro-borde" onClick={() => nav('/campo')} title="Abrir la app de campo (móvil)">
            <Smartphone size={15} />
            <span className="ocultar-m">Campo</span>
          </button>
          <button className="btn s oscuro-borde" onClick={() => setPrefs({ guiaAbierta: !prefs.guiaAbierta })} title="Guion de demostración">
            <Compass size={15} />
            <span className="ocultar-m">Guion</span>
          </button>
          <div className="ctx-wrap">
            <button className="btn s oscuro-borde" onClick={() => setMenu(menu === 'rol' ? null : 'rol')} title="Rol de demostración">
              <UserCog size={15} />
              <span className="ocultar-m">{prefs.roles.map((r) => r[0].toUpperCase() + r.slice(1, 5)).join(' · ')}</span>
            </button>
            {menu === 'rol' && (
              <div className="menu panel-flotante derecha" role="menu" onMouseLeave={() => setMenu(null)}>
                <div className="rotulo sin-linea">Persona de demostración (sin autenticación)</div>
                <label className="menu-item">
                  <select className="input" aria-label="Persona de escritorio" value={prefs.personaId} onChange={(e) => setPrefs({ personaId: e.target.value })}>
                    {Object.values(db.personas).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </label>
                <div className="rotulo sin-linea">Roles de demostración (sin autenticación)</div>
                {ROLES.map(({ r, t, d }) => (
                  <label key={r} className="menu-item check">
                    <input
                      type="checkbox"
                      checked={prefs.roles.includes(r)}
                      onChange={(e) => {
                        const roles = e.target.checked ? [...prefs.roles, r] : prefs.roles.filter((x) => x !== r);
                        setPrefs({ roles: roles.length ? roles : [r] });
                      }}
                    />
                    <span>
                      <b>{t}</b>
                      <br />
                      <span className="muted">{d}</span>
                    </span>
                  </label>
                ))}
                <div className="menu-nota muted">Una persona puede tener varios roles.</div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="contenido">
        <Outlet />
      </main>

      <nav className="nav-inferior" aria-label="Espacios">
        {ESPACIOS.map(({ to, txt, icono: I }) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'on' : '')}>
            <I size={19} />
            <span>{txt}</span>
          </NavLink>
        ))}
        <NavLink to="/campo">
          <Smartphone size={19} />
          <span>Campo</span>
        </NavLink>
      </nav>

      {ficha.abierto && db.locales[ficha.abierto] && <FichaLocal localId={ficha.abierto} onCerrar={ficha.cerrar} />}
      {prefs.guiaAbierta && <GuiaDemo onCerrar={() => setPrefs({ guiaAbierta: false })} />}
    </div>
  );
}
