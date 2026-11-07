import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Avisos } from './components/ui';
import AplicacionUnica from './workspaces/app/AplicacionUnica';
import CampanasPage from './workspaces/campaigns/CampanasPage';
import TerritorioPage from './workspaces/territory/TerritorioPage';
import OficinaPage from './workspaces/office/OficinaPage';
import DatosPage from './workspaces/imports/DatosPage';
import AnalisisPage from './workspaces/analysis/AnalisisPage';
import VisualizacionPage from './workspaces/visualizacion/VisualizacionPage';
import AdministracionPage from './workspaces/app/AdministracionPage';

/**
 * Una sola aplicación: son EXACTAMENTE las rutas de la interfaz completa
 * original. Las antiguas vistas de ensayo/espacios/real no son navegables.
 * Los datos ficticios no se inicializan ni se exponen.
 */
export default function App() {
  return <HashRouter>
    <Routes>
      <Route path="/espacios/*" element={<Navigate to="/campanas" replace />} />
      <Route path="/real/*" element={<Navigate to="/campanas" replace />} />
      <Route path="/campo/*" element={<Navigate to="/campanas" replace />} />
      <Route path="/*" element={<AplicacionUnica />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="campanas" replace />} />
          <Route path="campanas" element={<CampanasPage />} />
          <Route path="territorio" element={<TerritorioPage />} />
          <Route path="oficina/*" element={<OficinaPage />} />
          <Route path="datos" element={<DatosPage />} />
          <Route path="analisis" element={<AnalisisPage />} />
          <Route path="visualizacion" element={<VisualizacionPage />} />
          <Route path="administracion" element={<AdministracionPage />} />
          <Route path="*" element={<Navigate to="/campanas" replace />} />
        </Route>
      </Route>
    </Routes>
    <Avisos />
  </HashRouter>;
}
