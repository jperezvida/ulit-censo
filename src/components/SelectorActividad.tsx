import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ACTIVIDADES_HOJA, NIVELES_ACTIVIDAD, hijosDe, rutaActividad } from '../domain/taxonomy';
import { normalizar } from '../domain/text';
import type { Id } from '../domain/types';

/** Selector jerárquico de 4 niveles con búsqueda rápida por actividad. */
export function SelectorActividad({ valor, onCambio, compacto }: { valor?: Id; onCambio: (id: Id) => void; compacto?: boolean }) {
  const ruta = rutaActividad(valor);
  const [sel, setSel] = useState<(Id | undefined)[]>([ruta[0]?.id, ruta[1]?.id, ruta[2]?.id, ruta[3]?.id]);
  const [q, setQ] = useState('');
  const sugerencias = useMemo(() => {
    const n = normalizar(q);
    if (n.length < 2) return [];
    return ACTIVIDADES_HOJA.filter((a) => rutaActividad(a.id).some((x) => normalizar(x.nombre).includes(n))).slice(0, 7);
  }, [q]);
  const fijar = (nivel: number, id: Id) => {
    const nuevo = [...sel.slice(0, nivel), id, undefined, undefined, undefined].slice(0, 4);
    setSel(nuevo);
    if (nivel === 3) onCambio(id);
  };
  return (
    <div className={`sel-act ${compacto ? 'compacto' : ''}`}>
      <div className="sel-act-busca">
        <Search size={14} />
        <input placeholder="Buscar actividad (p. ej. «pelu», «bar»)" value={q} onChange={(e) => setQ(e.target.value)} />
        {sugerencias.length > 0 && (
          <div className="sel-act-sug panel-flotante">
            {sugerencias.map((a) => {
              const r = rutaActividad(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => {
                    setSel(r.map((x) => x.id));
                    setQ('');
                    onCambio(a.id);
                  }}
                >
                  <b>{a.nombre}</b>
                  <span className="muted">{r.slice(0, 3).map((x) => x.nombre).join(' › ')}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="sel-act-niveles">
        {NIVELES_ACTIVIDAD.map((etq, i) => {
          const opciones = i === 0 ? hijosDe() : sel[i - 1] ? hijosDe(sel[i - 1]) : [];
          return (
            <label key={etq} className="campo">
              <span className="etq">{i + 1}. {etq}</span>
              <select className="input" value={sel[i] ?? ''} disabled={!opciones.length} onChange={(e) => fijar(i, e.target.value)}>
                <option value="">—</option>
                {opciones.map((o) => (
                  <option key={o.id} value={o.id}>{o.nombre}</option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: 11, margin: 0 }}>Clasificación provisional de demostración; se sustituirá por la terminología del censo original.</p>
    </div>
  );
}
