import { useNavigate } from 'react-router-dom';
import { Inbox, MapPin, X } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { direccionVigente, textoDireccion } from '../../domain/consultas';
import { Historico } from './Historico';
import { SelloProcedencia } from '../../components/ui';
import type { Id } from '../../domain/types';
import '../../styles/oficina.css';

const ESTADO_TXT = { activo: 'Activo', 'posible-desaparicion': 'Posible desaparición (pendiente de revisión)', desaparecido: 'Desaparecido', dividido: 'Dividido', fusionado: 'Fusionado' } as const;

/** Ficha del local físico: se abre como panel lateral desde cualquier espacio. */
export function FichaLocal({ localId, onCerrar }: { localId: Id; onCerrar: () => void }) {
  const { db, campana } = useContexto();
  const nav = useNavigate();
  const l = db.locales[localId];
  if (!l) return null;
  const d = direccionVigente(l);
  return (
    <div className="velo-lateral" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <aside className="ficha-lateral" role="dialog" aria-label="Ficha del local">
        <div className="ficha-cab">
          <div className="esp">
            <div className="rotulo sin-linea">Local físico · <span className="mono">{l.id.slice(-10)}</span></div>
            <h2>{textoDireccion(db, l)}</h2>
            <div className="fila" style={{ flexWrap: 'wrap', marginTop: 6 }}>
              <SelloProcedencia p={l.procedencia} />
              <span className={`chip ${l.estado === 'activo' ? '' : 'dudoso'}`}>{ESTADO_TXT[l.estado]}</span>
              {l.coord && <span className="chip mono"><MapPin size={11} /> {l.coord[1].toFixed(5)}, {l.coord[0].toFixed(5)}</span>}
            </div>
          </div>
          <button className="btn fantasma icono" onClick={onCerrar} aria-label="Cerrar"><X size={18} /></button>
        </div>
        <p className="ficha-expl">
          El local es el <b>espacio físico</b>. Cada campaña registra qué negocio lo ocupaba o si estaba vacío. Los perfiles digitales pertenecen a cada negocio y no se heredan.
        </p>
        <div className="ficha-cuerpo scroll-fino">
          <Historico db={db} localId={localId} />
        </div>
        <div className="ficha-pie">
          <button className="btn" onClick={() => nav(`/territorio?capa=actividad`)} disabled={!l.coord}>Ver en el mapa</button>
          <button className="btn primario" onClick={() => nav(`/oficina?calle=${d.calleId}&sel=${l.id}`)} disabled={!campana}>
            <Inbox size={15} /> Revisar en Oficina
          </button>
        </div>
      </aside>
    </div>
  );
}
