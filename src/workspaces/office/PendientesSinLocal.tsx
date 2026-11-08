import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';

/** Registros originales de una campaña sin vínculo a un local físico.
 * Consulta estricta: no permite modificar, conciliar ni crear locales.
 */
export default function PendientesSinLocal() {
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const [busqueda, setBusqueda] = useState('');
  const [seleccionado, setSeleccionado] = useState<string | null>(null);

  const filas = useMemo(() => {
    if (!campana) return [];
    const importaciones = new Set(Object.values(db.importaciones)
      .filter((i) => i.campanaId === campana.id && i.estado === 'confirmada')
      .map((i) => i.id));
    const asociados = new Set(Object.values(db.vinculos)
      .filter((v) => v.origen.tipo === 'registro' && v.localId)
      .map((v) => v.origen.id));
    return Object.values(db.registros)
      .filter((r) => importaciones.has(r.importacionId) && !asociados.has(r.id) && !r.exclusion)
      .sort((a, b) => (a.itinerarioId ?? '').localeCompare(b.itinerarioId ?? '') || a.fila - b.fila);
  }, [db, campana]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es');
    if (!q) return filas;
    return filas.filter((r) => [r.fila, db.itinerarios[r.itinerarioId ?? '']?.codigo,
      ...Object.values(r.datos)].join(' ').toLocaleLowerCase('es').includes(q));
  }, [filas, busqueda, db.itinerarios]);
  const activa = visibles.find((r) => r.id === seleccionado) ?? null;

  if (!campana) return null;
  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div>
          <Link className="btn s fantasma" to="/oficina"><ChevronLeft size={14} /> Volver a Oficina</Link>
          <div className="rotulo" style={{ marginTop: 14 }}>Oficina · {campana.nombre}</div>
          <h1>Registros sin local asociado</h1>
          <p>Filas auténticas de Excel sin vinculación a un local físico. No se deduce ninguna correspondencia.</p>
        </div>
      </div>
      <div className="t-info" role="status">
        {filas.length} registros pendientes de asociación · consulta sin cambios.
        {fuente?.soloLectura ? ' La revisión y conciliación siguen bloqueadas.' : ' La asociación se realizará mediante el procedimiento de conciliación.'}
      </div>
      <div className="of-busca" style={{ maxWidth: 500, margin: '16px 0' }}>
        <Search size={15} />
        <input aria-label="Buscar registros sin local" placeholder="Buscar por calle, actividad, negocio o fila…"
          value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      </div>
      <div className="muted" style={{ marginBottom: 10 }}>{visibles.length} de {filas.length} filas</div>
      <div className="ofi-tarjetas">
        {visibles.map((r) => {
          const itinerario = db.itinerarios[r.itinerarioId ?? ''];
          const imp = db.importaciones[r.importacionId];
          return (
            <button key={r.id} className="tarjeta" style={{ padding: 14, textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setSeleccionado(seleccionado === r.id ? null : r.id)}
              aria-expanded={seleccionado === r.id}>
              <b>{itinerario?.codigo ?? 'Sin itinerario'} · fila {r.fila}</b>
              <div className="muted">{imp?.archivo ?? 'Excel importado'}</div>
              <div style={{ marginTop: 6, overflowWrap: 'anywhere' }}>
                {Object.entries(r.datos).filter(([, v]) => v.trim()).slice(0, 3)
                  .map(([k, v]) => `${k}: ${v}`).join(' · ') || 'Fila sin valores de texto'}
              </div>
            </button>
          );
        })}
      </div>
      {activa && (
        <section className="tarjeta" style={{ padding: 18, marginTop: 18 }}>
          <h2>Detalle de la fila {activa.fila}</h2>
          <p className="muted">Celdas conservadas en la importación. Pendiente de conciliación humana.</p>
          <dl>
            {Object.entries(activa.datos).map(([columna, valor]) => (
              <div key={columna} style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) 2fr', padding: '7px 0', borderBottom: '1px solid var(--borde, #ddd)' }}>
                <dt>{columna}</dt><dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{valor || '—'}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
