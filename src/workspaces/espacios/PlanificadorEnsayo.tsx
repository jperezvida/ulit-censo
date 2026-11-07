import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { claseCampana } from '../../domain/municipios';
import { useEspacios } from '../../store/espacios';
import { TerritorioEnsayoPage } from '../territory/TerritorioPage';

/** Ruta del ensayo: monta el mismo planificador cartográfico que usa la demostración. */
export function PlanificadorEnsayo({ ruta }: { ruta: string }) {
  const db = useEspacios((s) => s.db!);
  const [seccion, campanaId, itinerarioId, extra] = ruta.split('/');
  const campana = db.campanas[campanaId];
  const itinerario = db.itinerarios[itinerarioId];
  const municipio = campana && db.municipios[campana.municipioId];
  if (seccion !== 'planificar' || extra || !campana || !itinerario || !municipio
    || itinerario.campanaId !== campana.id || claseCampana(campana) !== 'operativa') {
    return <div className="t-info error" role="alert">No se encuentra un itinerario operativo de este espacio. <Link to="/espacios/ensayo">Volver al ensayo</Link>.</div>;
  }
  return <section className="col" style={{ gap: 12 }} aria-label="Planificación en mapa del ensayo">
    <div className="fila"><Link to="/espacios/ensayo" className="btn s"><ArrowLeft size={14} /> Volver a itinerarios</Link></div>
    <p className="muted" style={{ margin: 0 }}>{municipio.nombre} · {campana.nombre} · {itinerario.codigo}. Seleccione una calle en el mapa para asignarla completa, ambas aceras. Planificarla no significa que esté censada.</p>
    <div className="tarjeta" style={{ height: 'min(70vh, 720px)', minHeight: 450, position: 'relative', overflow: 'hidden' }}>
      <TerritorioEnsayoPage campanaId={campanaId} itinerarioId={itinerarioId} />
    </div>
  </section>;
}
