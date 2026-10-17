import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import PanelItinerarios from './PanelItinerarios';
import EspacioOficina from './EspacioOficina';

/** Enlaces antiguos de la bandeja (?vista=…) → vista general municipal con la tarea equivalente. */
const VISTA_A_TAREA: Record<string, string> = { categorizar: 'categorizacion', digital: 'digital', dudosos: 'incidencias', errores: 'incidencias', duplicados: 'incidencias' };

function Entrada() {
  const [params] = useSearchParams();
  if (params.get('vista') || params.get('calle') || params.get('sel')) {
    const p = new URLSearchParams();
    p.set('tarea', VISTA_A_TAREA[params.get('vista') ?? ''] ?? 'todos');
    p.set('filtro', params.get('vista') ? 'pendientes' : 'todos');
    for (const k of ['calle', 'sel']) if (params.get(k)) p.set(k, params.get(k)!);
    return <Navigate to={`/oficina/municipal?${p}`} replace />;
  }
  return <PanelItinerarios />;
}

/** Oficina: primero los itinerarios; la vista general municipal queda como opción secundaria. */
export default function OficinaPage() {
  return (
    <Routes>
      <Route index element={<Entrada />} />
      <Route path="it/:itId" element={<EspacioOficina />} />
      <Route path="municipal" element={<EspacioOficina municipal />} />
      <Route path="*" element={<Navigate to="/oficina" replace />} />
    </Routes>
  );
}
