import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useStore } from './store/store';
import { Shell } from './components/Shell';
import { Avisos } from './components/ui';
import CampanasPage from './workspaces/campaigns/CampanasPage';
import TerritorioPage from './workspaces/territory/TerritorioPage';
import OficinaPage from './workspaces/office/OficinaPage';
import DatosPage from './workspaces/imports/DatosPage';
import AnalisisPage from './workspaces/analysis/AnalisisPage';
import HojaCampo from './workspaces/print/HojaCampo';
import CampoApp from './workspaces/field/CampoApp';

function Arranque() {
  const carga = useStore((s) => s.carga);
  const reintentar = useStore((s) => s.inicializar);
  return (
    <div className="arranque">
      <div className="arranque-caja">
        <div className="marca-ulit grande">
          <b>ULIT</b>
          <span>Censo</span>
        </div>
        <div className="arranque-reticula" aria-hidden />
        <p className="arranque-msg">{carga.fase === 'error' ? `Error: ${carga.mensaje}` : carga.mensaje || 'Preparando…'}</p>
        {carga.fase === 'error' ? (
          <button className="btn primario" onClick={() => reintentar(true)}>
            Reintentar
          </button>
        ) : (
          <div className="arranque-progreso">
            <span />
          </div>
        )}
        <p className="muted" style={{ fontSize: 12 }}>
          Prototipo navegable · datos de demostración · sin conexión a servicios productivos
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const fase = useStore((s) => s.carga.fase);
  const inicializar = useStore((s) => s.inicializar);
  useEffect(() => {
    if (fase === 'inicio') inicializar();
  }, [fase, inicializar]);

  return (
    <HashRouter>
      {fase !== 'lista' ? (
        <Arranque />
      ) : (
        <Routes>
          <Route path="/campo/*" element={<CampoApp />} />
          <Route path="/imprimir/:itId" element={<HojaCampo />} />
          <Route element={<Shell />}>
            <Route path="/" element={<Navigate to="/campanas" replace />} />
            <Route path="/campanas" element={<CampanasPage />} />
            <Route path="/territorio" element={<TerritorioPage />} />
            <Route path="/oficina/*" element={<OficinaPage />} />
            <Route path="/datos" element={<DatosPage />} />
            <Route path="/analisis" element={<AnalisisPage />} />
            <Route path="*" element={<Navigate to="/campanas" replace />} />
          </Route>
        </Routes>
      )}
      <Avisos />
    </HashRouter>
  );
}
