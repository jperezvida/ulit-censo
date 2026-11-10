import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { auditarRevisionGeneral, type FilaRevisionGeneral } from '../../domain/revisionGeneral';
import '../../styles/revision-general.css';

type Filtro = 'incidencias' | 'vacios' | 'ocupados';
const TEXTO_ESTADO = { vacio: 'Vacío', ocupado: 'Ocupado', desconocido: 'Estado por confirmar' };

function ValorOriginal({ fila }: { fila: FilaRevisionGeneral }) {
  const datos = Object.entries(fila.registro.datos);
  const originales = fila.registro.original;
  const celdas = datos.length ? datos : Object.entries(originales ?? {}).map(([k, v]) =>
    [k, v.t === 'vacio' ? '' : v.t === 'booleano' ? (v.v ? '1' : '0') : String(v.v)] as [string, string]);
  return <details className="rg-original">
    <summary>Consultar todas las columnas del Excel original</summary>
    <dl>
      {celdas.map(([columna, valor]) => <div key={columna}><dt>{columna}</dt><dd>{valor || '—'}</dd></div>)}
    </dl>
  </details>;
}

/**
 * Una única bandeja muy sencilla: el motor revisa, la persona valida.
 * No hay escrituras ni supuestas correcciones locales que se perderían al recargar.
 */
export default function RevisionGeneral() {
  const { db, campana } = useContexto();
  const resultado = useMemo(() => campana ? auditarRevisionGeneral(db, campana.id) : null, [db, campana?.id]);
  const [filtro, setFiltro] = useState<Filtro>('incidencias');
  const [busqueda, setBusqueda] = useState('');
  const [itinerarioFiltro, setItinerarioFiltro] = useState('');
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [limite, setLimite] = useState(80);
  if (!campana || !resultado) return null;

  const opciones = [
    { clave: 'incidencias' as const, etiqueta: 'Con incidencias', total: resultado.conIncidencias },
    { clave: 'vacios' as const, etiqueta: 'Locales vacíos', total: resultado.filas.filter((f) => f.estado === 'vacio').length },
    { clave: 'ocupados' as const, etiqueta: 'Locales ocupados', total: resultado.filas.filter((f) => f.estado === 'ocupado').length },
  ];

  const itinerarios = [...new Set(resultado.filas.map((f) => f.itinerario))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const texto = busqueda.trim().toLocaleLowerCase('es');
  const filtradas = resultado.filas.filter((f) =>
    (!itinerarioFiltro || f.itinerario === itinerarioFiltro)
    && (filtro === 'incidencias' ? f.incidencias.length > 0 : filtro === 'vacios' ? f.estado === 'vacio' : f.estado === 'ocupado')
    && (!texto || [f.direccion, f.numero, f.nombre, f.itinerario, f.archivo, String(f.registro.fila), ...f.incidencias.map((i) => i.titulo)]
      .join(' ').toLocaleLowerCase('es').includes(texto))
  );
  const indice = Math.max(0, filtradas.findIndex((f) => f.id === seleccionado));
  const activa = filtradas[indice];
  const pasar = (pos: number) => setSeleccionado(filtradas[pos]?.id ?? null);
  const elegirFiltro = (f: Filtro) => { setFiltro(f); setSeleccionado(null); setLimite(80); };

  return <main className="pagina rg-pagina">
    <div className="pagina-cab">
      <div>
        <Link to="/oficina" className="btn s fantasma"><ChevronLeft size={14} /> Volver a Oficina</Link>
        <div className="rotulo" style={{ marginTop: 14 }}>Oficina · {campana.nombre} · Fase 1</div>
        <h1>Revisión general</h1>
        <p>La aplicación comprueba automáticamente los locales de los Excel incorporados y te muestra únicamente lo que merece revisión.</p>
      </div>
    </div>

    <div className="rg-resumen" role="status">
      <span><b>{resultado.examinadas}</b> registros comprobados</span>
      <span className={resultado.conIncidencias ? 'rg-alerta' : ''}><b>{resultado.conIncidencias}</b> con incidencias</span>
      <span><b>{resultado.sinIncidencias}</b> sin incidencias detectadas</span>
    </div>
    <p className="rg-aviso">Comprobación de coherencia, no validación definitiva. Los avisos pueden solaparse en una misma fila; no se modifican Excel, registros ni datos reales. Las correcciones se habilitarán únicamente mediante guardado autorizado y trazable.</p>

    <div className="rg-controles">
      <div className="rg-filtros" role="group" aria-label="Filtrar revisión general">
        {opciones.map((op) => <button key={op.clave} type="button"
          className={filtro === op.clave ? 'btn s primario' : 'btn s'}
          aria-pressed={filtro === op.clave} onClick={() => elegirFiltro(op.clave)}>
          {op.etiqueta} <b>{op.total}</b>
        </button>)}
      </div>
      {itinerarios.length > 1 && <select className="input rg-itinerario" aria-label="Filtrar por itinerario" value={itinerarioFiltro}
        onChange={(e) => { setItinerarioFiltro(e.target.value); setSeleccionado(null); setLimite(80); }}>
        <option value="">Todos los itinerarios</option>
        {itinerarios.map((codigo) => <option key={codigo} value={codigo}>{codigo} · {resultado.filas.filter((f) => f.itinerario === codigo && f.incidencias.length).length} con incidencias</option>)}
      </select>}
      <label className="rg-buscador"><Search size={15} /><input aria-label="Buscar por calle, negocio, itinerario o fila" placeholder="Buscar calle, negocio o fila…"
        value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setSeleccionado(null); setLimite(80); }} /></label>
    </div>

    {resultado.examinadas === 0 && <div className="t-info">No hay filas de Excel confirmadas en esta campaña. La revisión comenzará cuando se incorporen sus itinerarios.</div>}
    {resultado.examinadas > 0 && <div className="rg-doscolumnas">
      <section className="rg-listado" aria-label="Registros para revisar">
        <div className="rg-listado-cab">{filtradas.length} filas en esta vista</div>
        {filtradas.slice(0, limite).map((f) => <button key={f.id} type="button"
          className={`rg-fila ${activa?.id === f.id ? 'seleccionada' : ''}`}
          aria-pressed={activa?.id === f.id} onClick={() => setSeleccionado(f.id)}>
          <span className="rg-fila-arriba"><b>{f.nombre || (f.estado === 'vacio' ? 'Local vacío' : 'Sin nombre')}</b>
            <span className={f.incidencias.length ? 'rg-chip-alerta' : 'rg-chip-ok'}>{f.incidencias.length ? `${f.incidencias.length} aviso(s)` : 'Sin incidencias'}</span></span>
          <span className="rg-fila-abajo">{f.direccion}, {f.numero} · {f.itinerario} · fila {f.registro.fila}</span>
        </button>)}
        {filtradas.length === 0 && <div className="t-info">No hay registros con estos filtros.</div>}
        {filtradas.length > limite && <button className="btn s rg-mas" onClick={() => setLimite((v) => v + 80)}>
          Mostrar más ({filtradas.length - limite} restantes)
        </button>}
      </section>

      <section className="rg-detalle" aria-label="Detalle de la revisión">
        {activa ? <>
          <div className="rg-detalle-cab">
            <div><small>{activa.itinerario} · Fila {activa.registro.fila} · {TEXTO_ESTADO[activa.estado]}</small>
              <h2>{activa.nombre || (activa.estado === 'vacio' ? 'Local vacío' : 'Nombre sin consignar')}</h2>
              <p>{activa.direccion}, {activa.numero}</p></div>
            <div className="rg-paginacion">
              <button className="btn s icono" aria-label="Registro anterior" onClick={() => pasar(indice - 1)} disabled={indice === 0}><ChevronLeft size={15} /></button>
              <span>{indice + 1} / {filtradas.length}</span>
              <button className="btn s icono" aria-label="Registro siguiente" onClick={() => pasar(indice + 1)} disabled={indice === filtradas.length - 1}><ChevronRight size={15} /></button>
            </div>
          </div>
          {activa.incidencias.length ? <div className="rg-incidencias">
            {activa.incidencias.map((inc) => <div className="rg-incidencia" key={inc.tipo}>
              <AlertTriangle size={17} /><div><b>{inc.titulo}</b><p>{inc.detalle}</p></div>
            </div>)}
          </div> : <div className="rg-sin-inc"><CheckCircle2 size={17} /> No se han detectado contradicciones en esta fila.</div>}
          <ValorOriginal fila={activa} />
          <p className="rg-origen">Origen: {activa.archivo} · fila {activa.registro.fila}. Los datos permanecen intactos.</p>
        </> : <p className="muted">Selecciona una fila para ver su comprobación.</p>}
      </section>
    </div>}
  </main>;
}
