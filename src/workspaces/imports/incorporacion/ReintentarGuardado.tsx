import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useStore } from '../../../store/store';

/**
 * Aviso de guardado fallido con un botón real de «Reintentar guardado». Reintentar solo vuelve a
 * escribir en el navegador la versión que ya está en memoria: nunca repite la operación de dominio.
 */
export function ReintentarGuardado({ error, onGuardado }: { error?: string; onGuardado: () => void }) {
  const reintentarGuardado = useStore((s) => s.reintentarGuardado);
  const [estado, setEstado] = useState<{ reintentando?: boolean; error?: string }>({});
  const reintentar = async () => {
    setEstado({ reintentando: true });
    const r = await reintentarGuardado();
    if (r.guardado) {
      setEstado({});
      onGuardado();
    } else setEstado({ error: r.error });
  };
  return (
    <div className="t-info error" role="alert" aria-label="Guardado fallido">
      <AlertTriangle size={15} />
      <div className="col" style={{ gap: 6 }}>
        <span><b>La operación está hecha, pero no se ha guardado.</b> {estado.error ?? error}</span>
        <div>
          <button className="btn s" disabled={estado.reintentando} onClick={reintentar}>
            <RefreshCw size={14} /> {estado.reintentando ? 'Guardando…' : 'Reintentar guardado'}
          </button>
        </div>
      </div>
    </div>
  );
}
