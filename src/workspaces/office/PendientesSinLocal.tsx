import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import type { RegistroOrigen } from '../../domain/types';
import { Modal } from '../../components/ui';
import '../../styles/pendientes-sin-local.css';

function normalizarClave(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Solo lee las cabeceras auténticas del Excel; no calcula nombres ni direcciones. */
function datoOriginal(registro: RegistroOrigen, cabeceras: string[]): string {
  for (const cabecera of cabeceras) {
    const clave = Object.keys(registro.datos).find((k) => normalizarClave(k) === normalizarClave(cabecera));
    if (clave) return registro.datos[clave]?.trim() ?? '';
  }
  return '';
}

export function vistaBreveRegistro(registro: RegistroOrigen) {
  const calle = datoOriginal(registro, ['Dirección', 'Direccion']);
  const numero = datoOriginal(registro, ['Num']);
  const negocio = datoOriginal(registro, ['Nombre del negocio']);
  const actividad = datoOriginal(registro, ['Actividad']);
  const vacio = datoOriginal(registro, ['Local Vacío']);
  return {
    calle: calle || 'Sin calle consignada',
    numero: numero || '—',
    negocio: negocio || (vacio === '1' ? 'Local vacío (según Excel)' : 'Sin nombre consignado'),
    actividad: actividad || 'Sin actividad consignada',
  };
}

/**
 * Consulta de filas originales sin vínculo con local físico.
 * No crea locales, no asigna equivalencias y no ejecuta RPC de escritura.
 */
export default function PendientesSinLocal() {
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const [busqueda, setBusqueda] = useState('');
  const [itFiltro, setItFiltro] = useState('');
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

  const opcionesIt = useMemo(() => {
    const ids = [...new Set(filas.map((r) => r.itinerarioId ?? ''))];
    return ids.sort((a, b) => (db.itinerarios[a]?.codigo ?? a).localeCompare(db.itinerarios[b]?.codigo ?? b));
  }, [filas, db.itinerarios]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es');
    return filas.filter((r) => {
      if (itFiltro && (r.itinerarioId || '_sin-itinerario') !== itFiltro) return false;
      if (!q) return true;
      return [r.fila, db.itinerarios[r.itinerarioId ?? '']?.codigo, ...Object.values(r.datos)]
        .join(' ').toLocaleLowerCase('es').includes(q);
    });
  }, [filas, busqueda, itFiltro, db.itinerarios]);

  const activa = visibles.find((r) => r.id === seleccionado) ?? null;

  if (!campana) return null;
  return (
    <div className="pagina psl">
      <div className="pagina-cab">
        <div>
          <Link className="btn s fantasma" to="/oficina"><ChevronLeft size={14} /> Volver a Oficina</Link>
          <div className="rotulo" style={{ marginTop: 14 }}>Oficina · {campana.nombre}</div>
          <h1>Registros sin local asociado</h1>
          <p>Filas auténticas del Excel pendientes de vincular con un local físico.</p>
        </div>
      </div>
      <div className="t-info" role="status">
        {filas.length} registros pendientes de asociación · consulta sin cambios.
        {fuente?.soloLectura ? ' La revisión y conciliación siguen bloqueadas.' : ' La asociación requiere conciliación humana.'}
      </div>

      <div className="psl-controles">
        <div className="of-busca psl-busca">
          <Search size={15} />
          <input aria-label="Buscar registros sin local" placeholder="Buscar calle, negocio, actividad o fila…"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        {opcionesIt.length > 1 && <select className="input psl-it" aria-label="Filtrar por itinerario" value={itFiltro} onChange={(e) => setItFiltro(e.target.value)}>
          <option value="">Todos los itinerarios</option>
          {opcionesIt.map((id) => <option key={id} value={id || '_sin-itinerario'}>
            {id ? db.itinerarios[id]?.codigo ?? id : 'Sin itinerario'}
          </option>)}
        </select>}
        <span className="muted psl-contador">{visibles.length} de {filas.length} filas</span>
      </div>

      <div className="psl-tabla-scroll">
        <table className="psl-tabla">
          <thead><tr><th>Origen</th><th>Dirección</th><th>N.º</th><th>Establecimiento</th><th>Actividad</th><th><span className="psl-sr">Detalle</span></th></tr></thead>
          <tbody>
            {visibles.map((r) => {
              const datos = vistaBreveRegistro(r);
              const codigo = db.itinerarios[r.itinerarioId ?? '']?.codigo ?? 'Sin itinerario';
              return <tr key={r.id}>
                <td className="psl-origen">{codigo} · fila {r.fila}</td>
                <td>{datos.calle}</td>
                <td className="psl-num">{datos.numero}</td>
                <td className="psl-negocio">{datos.negocio}</td>
                <td>{datos.actividad}</td>
                <td><button className="btn s" onClick={() => setSeleccionado(r.id)} aria-label={`Ver detalle de ${codigo} · fila ${r.fila}`}>Ver ficha</button></td>
              </tr>;
            })}
          </tbody>
        </table>
        {visibles.length === 0 && <div className="t-info">No hay registros que coincidan con estos filtros.</div>}
      </div>

      {activa && <Modal
        titulo={`Detalle de la fila ${activa.fila}`}
        sub={`${db.itinerarios[activa.itinerarioId ?? '']?.codigo ?? 'Sin itinerario'} · ${db.importaciones[activa.importacionId]?.archivo ?? 'Excel importado'} · Consulta sin cambios`}
        onCerrar={() => setSeleccionado(null)}
        ancho
      >
        <p className="muted">Valores originales de las columnas importadas. La fila sigue pendiente de conciliación humana.</p>
        <dl className="psl-detalle">
          {Object.entries(activa.datos).map(([columna, valor]) => (
            <div key={columna} className="psl-detalle-fila">
              <dt>{columna}</dt><dd>{valor || '—'}</dd>
            </div>
          ))}
        </dl>
      </Modal>}
    </div>
  );
}
