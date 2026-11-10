import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import type { BaseDatos } from '../../domain/db';
import type { Id, Itinerario } from '../../domain/types';
import { csvRevisionGeneral, exportarRevisionGeneral } from '../../domain/exportacionRevisionGeneral';
import { descargar } from '../../domain/exportacion';
import { fmt } from '../../components/ui';

export function ExportacionTrabajo2026({ db, campanaId, its, municipio }: {
  db: BaseDatos;
  campanaId: Id;
  its: Itinerario[];
  municipio: string;
}) {
  const [it, setIt] = useState('');
  const trabajo = useMemo(() => exportarRevisionGeneral(db, campanaId, it || undefined), [db, campanaId, it]);
  const { resumen } = trabajo;
  const nombre = `${municipio.replace(/\s+/g, '_')}_2026_trabajo_revision_${it ? its.find((x) => x.id === it)?.codigo ?? 'it' : 'todos'}.csv`;

  return <section className="tarjeta an-bloque">
    <h3>Excel de trabajo 2026 · con correcciones</h3>
    <p className="muted">Incluye todas las filas de los itinerarios incorporados, tanto si están conciliadas
      como si no. Cada fila mantiene su identificación, origen y, cuando exista, el cambio autorizado.
      Este archivo <b>no es el censo final de locales únicos</b>.</p>
    <div className="fila" style={{ flexWrap: 'wrap', gap: 10 }}>
      <select className="input" style={{ maxWidth: 290 }} aria-label="Itinerario para exportar el trabajo 2026"
        value={it} onChange={(e) => setIt(e.target.value)}>
        <option value="">Todos los itinerarios</option>
        {its.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
      </select>
      <button className="btn primario" type="button" disabled={!resumen.filas}
        onClick={() => descargar(nombre, csvRevisionGeneral(trabajo))}>
        <Download size={15} /> Descargar trabajo 2026 ({fmt(resumen.filas)} filas)
      </button>
    </div>
    <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
      {fmt(resumen.vacios)} vacíos · {fmt(resumen.ocupados)} ocupados ·
      {' '}{fmt(resumen.conIncidencias)} filas con avisos pendientes ·
      {' '}{fmt(resumen.conCorreccion)} filas con correcciones registradas.
    </p>
    <p className="muted" style={{ fontSize: 12 }}>
      Formato CSV para Excel, separador «;» y UTF-8. Conserva las 28 columnas del itinerario
      y añade las referencias de origen, cambios y avisos para que la revisión sea comprobable.
      {' '}<Link to="/oficina/revision-general">Ir a Revisión general</Link>.
    </p>
  </section>;
}

