import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { auditarCalidad2026, ETIQUETAS_CALIDAD, type CodigoIncidenciaCalidad } from '../../domain/auditoriaCalidad2026';
import { fmt } from '../../components/ui';
import '../../styles/oficina-b2.css';

/** Revisión automática segura: datos originales sin alteraciones ni escrituras. */
export default function RevisionGeneral2026() {
  const { db, campana } = useContexto();
  const [it, setIt] = useState('');
  const [tipo, setTipo] = useState('');
  const [q, setQ] = useState('');
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const informe = useMemo(() => campana?.anio === 2026
    ? auditarCalidad2026(db, campana.id) : null, [db, campana]);
  const lista = useMemo(() => (informe?.filas ?? []).filter((fila) =>
    (!it || fila.itinerario === it) &&
    (!tipo || fila.incidencias.some((i) => i.codigo === tipo)) &&
    (!q.trim() || [fila.nombre, fila.calle, fila.numero, fila.itinerario, fila.registro.fila,
      ...fila.incidencias.map((i) => i.texto)].join(' ').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q.trim().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase()))
  ), [informe, it, tipo, q]);
  const activa = lista.find((x) => x.id === seleccion) ?? lista[0];
  const pos = activa ? lista.findIndex((x) => x.id === activa.id) : -1;
  const codigos = Object.keys(ETIQUETAS_CALIDAD) as CodigoIncidenciaCalidad[];
  const opciones = codigos.filter((codigo) => informe?.filas.some((fila) =>
    fila.incidencias.some((i) => i.codigo === codigo)));
  const itinerarios = [...new Set((informe?.filas ?? []).map((x) => x.itinerario))].sort();

  if (!campana || campana.anio !== 2026 || campana.tipo === 'historico-importado')
    return <div className="pagina"><Link className="btn s" to="/oficina">Volver a Oficina</Link>
      <p>Selecciona la campaña de campo de 2026.</p></div>;

  return <div className="pagina" style={{ maxWidth: 1100 }}>
    <div className="pagina-cab"><div>
      <Link to="/oficina" className="btn s fantasma"><ChevronLeft size={15}/> Oficina</Link>
      <div className="rotulo sin-linea" style={{ marginTop: 12 }}>Censo 2026 · Fase 1</div>
      <h1>Revisión general</h1>
      <p>La aplicación comprueba automáticamente las filas y señala lo que necesita revisión.</p>
    </div></div>
    <div className="ap-resumen" aria-label="Resumen de la revisión automática">
      <div><span className="muted">Registros analizados</span><b>{fmt(informe?.total ?? 0)}</b></div>
      <div><span className="muted">Sin incidencias detectadas</span><b>{fmt(informe?.conformes ?? 0)}</b></div>
      <div><span className="muted">Por revisar</span><b>{fmt(informe?.filas.length ?? 0)}</b></div>
    </div>
    <div className="t-info" role="status">
      <CheckCircle2 size={16}/>
      <span>Comprobación automática de los Excel originales. No se han modificado datos.
        Los registros sin incidencias no están validados definitivamente.</span>
    </div>
    <section className="tarjeta" style={{ marginTop: 12, padding: 14 }}>
      <div className="fila" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="campo" style={{ minWidth: 125, flex: 1 }}>
          <span>Itinerario</span>
          <select className="input" aria-label="Filtrar por itinerario" value={it}
            onChange={(e) => { setIt(e.target.value); setSeleccion(null); }}>
            <option value="">Todos</option>
            {itinerarios.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="campo" style={{ minWidth: 200, flex: 2 }}>
          <span>Problema</span>
          <select className="input" aria-label="Filtrar por tipo de problema" value={tipo}
            onChange={(e) => { setTipo(e.target.value); setSeleccion(null); }}>
            <option value="">Todos</option>
            {opciones.map((c) => <option key={c} value={c}>{ETIQUETAS_CALIDAD[c]}</option>)}
          </select>
        </label>
        <label className="campo" style={{ minWidth: 190, flex: 2 }}>
          <span>Buscar</span>
          <span className="fila" style={{ alignItems: 'center', gap: 6 }}>
            <Search size={15}/>
            <input className="input" type="search" placeholder="Nombre, calle, fila…"
              aria-label="Buscar incidencia" value={q}
              onChange={(e) => { setQ(e.target.value); setSeleccion(null); }}/>
          </span>
        </label>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>{lista.length} registros con estos filtros</p>
    </section>
    {lista.length === 0 ? <section className="tarjeta" style={{ padding: 20, marginTop: 12 }}>
      <CheckCircle2 size={20}/><b>Sin incidencias con estos filtros</b>
    </section> : <div className="calidad-rejilla" style={{ display: 'grid', gridTemplateColumns: 'minmax(240px,1fr) minmax(320px,1.35fr)', gap: 12, marginTop: 12, alignItems: 'start' }}>
      <section className="tarjeta" style={{ padding: 6, maxHeight: 530, overflowY: 'auto' }} aria-label="Incidencias encontradas">
        {lista.map((fila) => <button key={fila.id} type="button" aria-pressed={activa?.id === fila.id}
          onClick={() => setSeleccion(fila.id)}
          style={{ display: 'block', width: '100%', padding: 12, borderRadius: 7, margin: '2px 0',
            textAlign: 'left', border: '1px solid #c5cbd3',
            background: activa?.id === fila.id ? '#e9f2ff' : 'transparent', color: 'inherit', cursor: 'pointer' }}>
          <b>{fila.nombre || 'Local sin nombre'}</b>
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            {fila.itinerario} · Fila {fila.registro.fila} · {fila.calle}, {fila.numero || 's/n'}
          </div>
          <div style={{ fontSize: 12, marginTop: 5 }}>
            <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }}/>
            {fila.incidencias.length === 1 ? fila.incidencias[0].texto : fila.incidencias.length + ' cuestiones por comprobar'}
          </div>
        </button>)}
      </section>
      <section className="tarjeta" style={{ padding: 18 }} aria-label="Detalle de la incidencia">
        <div className="fila" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span className="muted">Registro {pos + 1} de {lista.length}</span>
          <div className="fila" style={{ gap: 5 }}>
            <button className="btn s" disabled={pos <= 0} onClick={() => setSeleccion(lista[pos-1].id)} aria-label="Anterior incidencia"><ChevronLeft size={16}/></button>
            <button className="btn s" disabled={pos >= lista.length-1} onClick={() => setSeleccion(lista[pos+1].id)} aria-label="Siguiente incidencia"><ChevronRight size={16}/></button>
          </div>
        </div>
        <h2>{activa.nombre || 'Local sin nombre'}</h2>
        <p className="muted">{activa.itinerario} · Fila {activa.registro.fila} · {activa.calle}, {activa.numero || 's/n'}</p>
        <h3>Qué hay que comprobar</h3>
        {activa.incidencias.map((inc) => <div key={inc.codigo}
          className={inc.severidad === 'error' ? 't-info error' : 't-info aviso'}
          style={{ marginBottom: 8 }}>
          <AlertTriangle size={16}/><span>{inc.texto}</span>
        </div>)}
        <h3>Datos del Excel</h3>
        <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(130px,1fr) 1.5fr', gap: '7px 12px' }}>
          {Array.from(new Set(['Nombre del negocio','Local Vacío','Long fachada',
            ...activa.incidencias.flatMap((inc) => inc.campos)])).map((campo) => <div key={campo} style={{ display: 'contents' }}>
              <dt className="muted">{campo}</dt>
              <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{activa.registro.datos[campo]?.trim() || '—'}</dd>
            </div>)}
        </dl>
        <p className="muted" style={{ fontSize: 12 }}>
          Vista de revisión sin cambios. Las decisiones y correcciones requerirán escritura
          autorizada, con trazabilidad y conservando el Excel de origen.</p>
      </section>
    </div>}
    <style>{'@media(max-width:740px){.calidad-rejilla{grid-template-columns:1fr !important}}'}</style>
  </div>;
}
