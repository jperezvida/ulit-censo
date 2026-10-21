import { useMemo, useState } from 'react';
import { ShieldAlert, Undo2 } from 'lucide-react';
import { Modal, fmt } from '../../../components/ui';
import { useStore } from '../../../store/store';
import { deshacerIncorporacion } from '../../../domain/incorporacion';
import { previsualizarDeshacer, puedeDecidir } from '../../../domain/incorporacionDemo';
import type { ColeccionIncorporada, Id } from '../../../domain/types';

const COL_TXT: Record<ColeccionIncorporada, string> = {
  campanas: 'Campaña histórica', registros: 'Registros de origen (filas)', locales: 'Locales físicos', negocios: 'Negocios', observaciones: 'Registros históricos (observaciones)',
  ocupaciones: 'Ocupaciones', vinculos: 'Correspondencias registro–local', franquicias: 'Franquicias históricas', digital: 'Presencia digital histórica', clasificaciones: 'Clasificaciones propuestas',
};

/**
 * Deshacer una incorporación: muestra antes qué se eliminará y qué trazabilidad permanecerá, y
 * ensaya la operación. Si hay cambios posteriores, se bloquea y explica los conflictos sin tocar nada.
 */
export function DeshacerIncorporacion({ importacionId, onCerrar, onHecho }: { importacionId: Id; onCerrar: () => void; onHecho?: () => void }) {
  const db = useStore((s) => s.db!);
  const prefs = useStore((s) => s.prefs);
  const aplicarConGuardado = useStore((s) => s.aplicarConGuardado);
  const persona = db.personas[prefs.personaId];
  const vista = useMemo(() => previsualizarDeshacer(db, importacionId, prefs.personaId), [db, importacionId, prefs.personaId]);
  const [ok, setOk] = useState(false);
  const [estado, setEstado] = useState<{ cargando?: boolean; error?: string }>({});
  const autorizado = puedeDecidir(prefs.roles);

  const confirmar = async () => {
    setEstado({ cargando: true });
    const r = await aplicarConGuardado((d) => deshacerIncorporacion(d, importacionId, prefs.personaId), `Incorporación deshecha: ${vista.archivo}`);
    if (!r.aplicado) return setEstado({ error: r.error ?? 'No se ha podido deshacer.' });
    if (!r.guardado) return setEstado({ error: r.error });
    onHecho?.();
    onCerrar();
  };

  return (
    <Modal
      titulo="Deshacer la incorporación"
      sub={`${vista.archivo}${vista.campana ? ` · ${vista.campana}` : ''}`}
      onCerrar={onCerrar}
      pie={
        <>
          <span className="muted esp">Lo hace: {persona?.nombre ?? prefs.personaId}</span>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn peligro" disabled={!vista.permitido || !ok || !autorizado || estado.cargando} onClick={confirmar}>
            <Undo2 size={15} /> {estado.cargando ? 'Deshaciendo…' : 'Deshacer la incorporación'}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }} aria-label="Vista previa del deshacer">
        {!vista.permitido ? (
          <div className="t-info error" role="alert">
            <div>
              <b>No se puede deshacer.</b> No se ha modificado nada.
              <ul className="inc-lista">{vista.conflictos.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          </div>
        ) : (
          <>
            <section>
              <h4 className="ap-tit">Se eliminará exactamente lo que creó la incorporación</h4>
              <table className="tabla ap-tabla">
                <tbody>{Object.entries(vista.eliminara).filter(([, n]) => n).map(([k, n]) => <tr key={k}><td>{COL_TXT[k as ColeccionIncorporada]}</td><td className="num">{fmt(n!)}</td></tr>)}</tbody>
              </table>
            </section>
            <section>
              <h4 className="ap-tit">Se conservará</h4>
              <ul className="inc-lista">{vista.conservara.map((c) => <li key={c}>{c}</li>)}</ul>
            </section>
            {!autorizado && <div className="t-info aviso">Deshacer requiere el rol de coordinación o administración.</div>}
            <label className="fila inc-confirmar">
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} aria-label="Confirmo que quiero deshacer" />
              <span>Entiendo que se eliminarán estos datos y que el historial de Ctrl+Z se vaciará.</span>
            </label>
          </>
        )}
        {estado.error && <div className="t-info error" role="alert"><ShieldAlert size={15} /> {estado.error}</div>}
      </div>
    </Modal>
  );
}
