import { Link, Route, Routes, useParams } from 'react-router-dom';
import { claseCampana } from '../../domain/municipios';
import { useEspacios } from '../../store/espacios';
import { CampoEnsayo as ContextoCampoEnsayo } from '../field/contextoCampo';
import { CampoRutasEnsayo } from '../field/CampoApp';

/**
 * Campo para un itinerario del espacio de ensayo (solo lectura): las mismas pantallas de Campo, con los
 * datos del ensayo. Solo se abre un itinerario de una campaña OPERATIVA del espacio y de su municipio.
 */
export function CampoEnsayoRutas() {
  return <Routes><Route path="campo/:campanaId/:itId/*" element={<Validar />} /><Route path="*" element={<NoValida />} /></Routes>;
}

const NoValida = () => <div className="t-info error" role="alert">No se encuentra un itinerario operativo de este espacio. <Link to="/espacios/ensayo">Volver al ensayo</Link>.</div>;

function Validar() {
  const db = useEspacios((s) => s.db!);
  const { campanaId = '', itId = '' } = useParams();
  const campana = db.campanas[campanaId];
  const it = db.itinerarios[itId];
  if (!campana || !it || it.campanaId !== campana.id || claseCampana(campana) !== 'operativa' || !db.municipios[campana.municipioId]) return <NoValida />;
  return <ContextoCampoEnsayo campanaId={campanaId} itinerarioId={itId}><CampoRutasEnsayo /></ContextoCampoEnsayo>;
}
