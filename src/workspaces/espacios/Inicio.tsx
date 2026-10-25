import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, CalendarPlus, CheckCircle2, FileUp, ListChecks, MapPinned, Plus, Route, Search, Settings2 } from 'lucide-react';
import { fmt } from '../../components/ui';
import { useEspacios } from '../../store/espacios';
import { municipioDeEspacio, type TipoEspacio } from '../../domain/espacios';
import { callejeroDe, claseCampana, motivoNoDestino } from '../../domain/municipios';
import { callesConObservaciones, censoConsolidado, crearItinerario, itinerariosDe, validarItinerario } from '../../domain/campanaOperativa';
import { CLASE_ESTADO_TXT, type FiltrosPendientes } from '../../domain/conciliacionPosterior';
import { localesCampana, resumenCampana, type ResumenCampana } from '../../domain/resumenCampana';
import type { BaseDatos } from '../../domain/db';
import type { Campana, Id } from '../../domain/types';
import { AsistenteEspacio } from './AsistenteEspacio';
import { ConciliacionPosterior } from './ConciliacionPosterior';
import { FormCampana, FormMunicipio } from './MunicipiosCampanas';
import { RespaldoTarjeta } from './Respaldo';
import { useAsistenteEspacio, useSeleccionEspacio } from './estadoAsistenteEspacio';

/**
 * UX1 · Pantalla de inicio sencilla: se elige municipio y campaña y se trabaja con cuatro accesos
 * (itinerarios, incorporar Excel, incidencias y censo). Reutiliza el importador, la conciliación y el
 * censo existentes; todas las comprobaciones siguen igual. La vista completa queda en «Vista completa».
 */
type Vista = 'itinerarios' | 'incorporar' | 'incidencias' | 'censo';
const VISTAS: { id: Vista; titulo: string; icono: typeof Route }[] = [
  { id: 'itinerarios', titulo: 'Itinerarios', icono: Route },
  { id: 'incorporar', titulo: 'Incorporar Excel', icono: FileUp },
  { id: 'incidencias', titulo: 'Incidencias', icono: ListChecks },
  { id: 'censo', titulo: 'Censo', icono: BarChart3 },
];

interface Preferencias { municipioId?: Id; campanaId?: Id; vista?: Vista }
const clave = (tipo: TipoEspacio) => `ulit-censo-inicio-${tipo}`;
function leerPreferencias(tipo: TipoEspacio): Preferencias {
  try { return JSON.parse(localStorage.getItem(clave(tipo)) ?? '{}') as Preferencias; } catch { return {}; }
}
function guardarPreferencias(tipo: TipoEspacio, p: Preferencias) {
  try { localStorage.setItem(clave(tipo), JSON.stringify(p)); } catch { /* solo comodidad: si falla, no pasa nada */ }
}

const porAnio = (a: Campana, b: Campana) => b.anio - a.anio || a.nombre.localeCompare(b.nombre, 'es');

/** Municipio y campaña efectivos: los elegidos si existen; si no, el municipio del espacio y su campaña más reciente (operativa primero). */
function seleccionValida(db: BaseDatos, tipo: TipoEspacio, p: Preferencias) {
  const municipioId = p.municipioId && db.municipios[p.municipioId] ? p.municipioId
    : db.municipios[municipioDeEspacio(tipo)] ? municipioDeEspacio(tipo) : Object.keys(db.municipios)[0] ?? null;
  const campanas = municipioId ? Object.values(db.campanas).filter((c) => c.municipioId === municipioId).sort(porAnio) : [];
  const campana = campanas.find((c) => c.id === p.campanaId) ?? campanas.find((c) => claseCampana(c) === 'operativa') ?? campanas[0] ?? null;
  return { municipioId, campana, campanas };
}

export function Inicio({ tipo }: { tipo: TipoEspacio }) {
  const db = useEspacios((s) => s.db!);
  const [pref, setPref] = useState<Preferencias>(() => leerPreferencias(tipo));
  const [alta, setAlta] = useState<'municipio' | 'campana' | null>(null);
  const [filtro, setFiltro] = useState<FiltrosPendientes>({});
  const { municipioId, campana, campanas } = seleccionValida(db, tipo, pref);
  const vista: Vista = pref.vista ?? 'itinerarios';
  const cambiar = (p: Preferencias) => {
    const n = { ...pref, ...p };
    setPref(n);
    guardarPreferencias(tipo, n);
  };
  const r = useMemo(() => (campana ? resumenCampana(db, campana.id) : null), [db, campana]);
  const mun = municipioId ? db.municipios[municipioId] : null;
  const cj = mun ? callejeroDe(db, mun.id) : null;

  // Cambiar de campaña reinicia el asistente (un archivo a medio analizar no pasa a otra campaña).
  useEffect(() => {
    useAsistenteEspacio.getState().reiniciar();
  }, [campana?.id]);

  if (!mun || alta === 'municipio') {
    return (
      <section className="tarjeta inc-bloque ux-vacio" aria-label="Primer paso">
        <h2><MapPinned size={18} /> {mun ? 'Nuevo municipio' : 'Empiece por el municipio'}</h2>
        <FormMunicipio onCerrar={(id) => { setAlta(null); if (id) cambiar({ municipioId: id, campanaId: undefined }); }} />
      </section>
    );
  }

  return (
    <div className="col ux-inicio" style={{ gap: 14 }}>
      <section className="tarjeta ux-contexto" aria-label="Municipio y campaña">
        <label className="campo">
          <span>Municipio</span>
          <select className="input" aria-label="Municipio" value={mun.id} onChange={(e) => cambiar({ municipioId: e.target.value, campanaId: undefined })}>
            {Object.values(db.municipios).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Campaña</span>
          <select className="input" aria-label="Campaña" value={campana?.id ?? ''} disabled={!campanas.length} onChange={(e) => cambiar({ campanaId: e.target.value })}>
            {!campanas.length && <option value="">Sin campañas</option>}
            {(['operativa', 'historica'] as const).map((k) => {
              const cs = campanas.filter((c) => claseCampana(c) === k);
              return cs.length > 0 && <optgroup key={k} label={k === 'operativa' ? 'En curso (operativas)' : 'Censos anteriores (históricas)'}>{cs.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</optgroup>;
            })}
          </select>
        </label>
        {campana && <span className={`chip ux-clase ux-${claseCampana(campana)}`}>{claseCampana(campana) === 'operativa' ? 'Operativa · en curso' : 'Histórica · censo anterior'}</span>}
        <span className="esp" />
        <div className="fila ux-acciones">
          <button className="btn s" onClick={() => setAlta(alta === 'campana' ? null : 'campana')}><CalendarPlus size={14} /> Campaña</button>
          <button className="btn s" onClick={() => setAlta('municipio')}><Plus size={14} /> Municipio</button>
        </div>
      </section>

      {alta === 'campana' && <FormCampana municipioId={mun.id} onCerrar={(id) => { setAlta(null); if (id) cambiar({ campanaId: id, vista: 'itinerarios' }); }} />}
      {cj && !cj.disponible && (
        <div className="t-info aviso" role="note"><AlertTriangle size={15} /> <div><b>{mun.nombre} no tiene callejero.</b> Se puede incorporar, pero las direcciones quedarán sin calle. <Link to={`/espacios/${tipo}/avanzado`}>Cargarlo en la vista completa</Link>.</div></div>
      )}

      {!campana || !r ? (
        alta !== 'campana' && (
          <section className="tarjeta inc-bloque ux-vacio" aria-label="Sin campañas">
            <h2>{mun.nombre} todavía no tiene campañas</h2>
            <p className="muted">Una campaña <b>operativa</b> es el censo que se está haciendo, con sus itinerarios. Una <b>histórica</b> guarda un censo ya terminado.</p>
            <button className="btn primario" onClick={() => setAlta('campana')}><CalendarPlus size={15} /> Crear la primera campaña</button>
          </section>
        )
      ) : (
        <>
          <nav className="ux-accesos" aria-label="Accesos">
            {VISTAS.map((v) => {
              const I = v.icono;
              const dato = indicador(v.id, r);
              return (
                <button key={v.id} className={`ux-acceso ${vista === v.id ? 'on' : ''} ${v.id === 'incidencias' && r.incidencias ? 'alerta' : ''}`} aria-pressed={vista === v.id} aria-label={v.titulo} onClick={() => { setFiltro({}); cambiar({ vista: v.id }); }}>
                  <I size={20} aria-hidden />
                  <span className="ux-acceso-tit">{v.titulo}</span>
                  <b className="ux-acceso-num">{dato.num}</b>
                  <span className="muted ux-acceso-sub">{dato.sub}</span>
                </button>
              );
            })}
          </nav>

          <section className="tarjeta inc-bloque ux-panel" aria-label={VISTAS.find((v) => v.id === vista)!.titulo}>
            {vista === 'itinerarios' && <PanelItinerarios campana={campana} r={r} onIncorporar={(itinerarioId) => { useSeleccionEspacio.getState().elegir({ itinerarioId }); cambiar({ vista: 'incorporar' }); }} onIncidencias={(itinerarioId) => { setFiltro({ itinerarioId }); cambiar({ vista: 'incidencias' }); }} />}
            {vista === 'incorporar' && <PanelIncorporar tipo={tipo} campana={campana} onCrearHistorica={() => setAlta('campana')} />}
            {vista === 'incidencias' && (r.archivos
              ? <>{r.incidencias === 0 && <div className="t-info ok"><CheckCircle2 size={15} /> Nada pendiente de revisar.</div>}<ConciliacionPosterior key={`${campana.id}-${JSON.stringify(filtro)}`} campanaId={campana.id} simple filtroInicial={filtro} /></>
              : <p className="muted">Todavía no hay ningún Excel incorporado en esta campaña.</p>)}
            {vista === 'censo' && <PanelCenso campana={campana} r={r} />}
          </section>
        </>
      )}

      <div className="ux-pie">
        <details className="ux-plegable">
          <summary>Copia de seguridad</summary>
          <RespaldoTarjeta tipo={tipo} />
        </details>
        <Link className="btn s" to={`/espacios/${tipo}/avanzado`}><Settings2 size={14} /> Vista completa</Link>
      </div>
    </div>
  );
}

function indicador(v: Vista, r: ResumenCampana): { num: string; sub: string } {
  switch (v) {
    case 'itinerarios': return r.clase === 'operativa' ? { num: fmt(r.itinerarios), sub: r.itinerariosSinExcel ? `${r.itinerariosSinExcel} sin Excel` : r.itinerarios ? 'todos con Excel' : 'ninguno todavía' } : { num: '—', sub: 'campaña histórica' };
    case 'incorporar': return { num: fmt(r.archivos), sub: r.archivos === 1 ? 'Excel incorporado' : 'Excel incorporados' };
    case 'incidencias': return { num: fmt(r.incidencias), sub: r.incidencias ? 'por resolver' : 'nada pendiente' };
    case 'censo': return { num: fmt(r.locales), sub: 'locales' };
  }
}

// ───────────── Itinerarios ─────────────

function PanelItinerarios({ campana, r, onIncorporar, onIncidencias }: { campana: Campana; r: ResumenCampana; onIncorporar: (id: Id) => void; onIncidencias: (id: Id) => void }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<Id | null>(null);
  if (r.clase !== 'operativa') return <p className="muted">Las campañas históricas no tienen itinerarios: el censo se incorpora de un único Excel.</p>;
  const desglose = censoConsolidado(db, campana.id).itinerarios;
  const problema = codigo.trim() ? validarItinerario(db, campana.id, codigo)[0] : undefined;
  return (
    <div className="col" style={{ gap: 10 }}>
      {desglose.length === 0 && <p className="muted" style={{ margin: 0 }}>Todavía no hay itinerarios. Cree el primero (por ejemplo, IT1).</p>}
      <ul className="ux-lista" aria-label="Itinerarios">
        {desglose.map((d) => {
          const it = d.itinerario;
          const archivo = d.archivos[0];
          return (
            <li key={it.id} className="ux-item">
              <div className="ux-item-cab">
                <span className="it-color" style={{ background: it.color }} />
                <b>{it.codigo}</b>
                {it.nombre !== `Itinerario ${it.codigo}` && <span className="muted">{it.nombre}</span>}
                <span className={`chip ${archivo ? 'ok' : 'aviso'}`}>{archivo ? `${fmt(d.registros)} filas` : 'Sin Excel'}</span>
                {d.pendientes > 0 && <span className="chip aviso">{d.pendientes} sin local</span>}
              </div>
              <div className="fila cj-fila-acc">
                {!archivo && <button className="btn s primario" onClick={() => onIncorporar(it.id)}><FileUp size={13} /> Incorporar su Excel</button>}
                {d.pendientes > 0 && <button className="btn s" onClick={() => onIncidencias(it.id)}><ListChecks size={13} /> Ver incidencias</button>}
                {archivo && <button className="btn s" aria-expanded={abierto === it.id} onClick={() => setAbierto(abierto === it.id ? null : it.id)}>{abierto === it.id ? 'Ocultar' : 'Consultar'}</button>}
              </div>
              {abierto === it.id && archivo && (
                <dl className="inc-dl ux-detalle" aria-label={`Detalle de ${it.codigo}`}>
                  <dt>Archivo</dt><dd>{archivo.archivo} · {archivo.fecha.slice(0, 10)}</dd>
                  <dt>Filas</dt><dd>{fmt(d.registros)} · {fmt(d.vinculados)} con local · {fmt(d.pendientes)} sin local</dd>
                  <dt>Fechas</dt><dd>{d.fechas ? `${d.fechas.desde} – ${d.fechas.hasta}` : 'sin fechas'}{d.sinFecha ? ` · ${d.sinFecha} sin fecha` : ''}</dd>
                  <dt>Calles</dt><dd>{callesConObservaciones(db, it.id).map((c) => c.nombre).join(', ') || '—'} <span className="muted">(con locales; no indica calle recorrida entera)</span></dd>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      <div className="fila cj-fila-acc ux-nuevo">
        <input className="input" aria-label="Código del itinerario" placeholder="Nuevo itinerario, p. ej. IT4" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
        <button className="btn s" disabled={!codigo.trim() || !!problema || !!ocupado} onClick={async () => {
          const res = await modificar('Creando el itinerario…', (x, ctx) => crearItinerario(x, campana.id, { codigo }, ctx).db);
          setError(res.ok ? null : res.error ?? null);
          if (res.ok) setCodigo('');
        }}><Plus size={13} /> Añadir itinerario</button>
      </div>
      {(problema || error) && <div className="t-info error" role="alert">{problema ?? error}</div>}
    </div>
  );
}

// ───────────── Incorporar ─────────────

function PanelIncorporar({ tipo, campana, onCrearHistorica }: { tipo: TipoEspacio; campana: Campana; onCrearHistorica: () => void }) {
  const db = useEspacios((s) => s.db!);
  const sel = useSeleccionEspacio();
  const aplicado = useAsistenteEspacio((s) => s.aplicado);
  const operativa = claseCampana(campana) === 'operativa';
  const its = operativa ? itinerariosDe(db, campana.id) : [];
  const motivo = operativa ? null : motivoNoDestino(db, campana.id, campana.municipioId, campana.anio);
  // El asistente usa la misma elección de destino que la vista completa: aquí la fija la campaña del inicio.
  const conExcel = new Set(Object.values(db.importaciones).filter((i) => i.campanaId === campana.id && i.estado === 'confirmada').map((i) => i.c1?.itinerario?.id));
  const itinerarioId = its.find((i) => i.id === sel.itinerarioId)?.id ?? its.find((i) => !conExcel.has(i.id))?.id ?? its[0]?.id ?? null;
  const listo = sel.municipioId === campana.municipioId && sel.campanaId === campana.id && sel.modo === (operativa ? 'operativo' : 'historico') && (!operativa || sel.itinerarioId === itinerarioId);
  useEffect(() => {
    if (!listo) sel.elegir({ modo: operativa ? 'operativo' : 'historico', municipioId: campana.municipioId, campanaId: campana.id, itinerarioId });
  });
  if (operativa && !its.length) return <p className="muted">Primero cree un itinerario en «Itinerarios»: cada Excel se incorpora en su itinerario.</p>;
  if (motivo && !aplicado) {
    return (
      <div className="col" style={{ gap: 8 }}>
        <p style={{ margin: 0 }}><CheckCircle2 size={15} /> Esta campaña histórica ya tiene su censo incorporado.</p>
        <p className="muted" style={{ margin: 0 }}>Para incorporar otro censo anterior, cree otra campaña histórica.</p>
        <button className="btn s" style={{ alignSelf: 'flex-start' }} onClick={onCrearHistorica}><CalendarPlus size={14} /> Nueva campaña histórica</button>
      </div>
    );
  }
  return listo ? <AsistenteEspacio tipo={tipo} simple /> : null;
}

// ───────────── Censo ─────────────

const POR_PAGINA = 50;

function PanelCenso({ campana, r }: { campana: Campana; r: ResumenCampana }) {
  const db = useEspacios((s) => s.db!);
  const [q, setQ] = useState('');
  const [n, setN] = useState(POR_PAGINA);
  const filas = useMemo(() => localesCampana(db, r.estados), [db, r.estados]);
  const t = q.trim().toLowerCase();
  const vis = t ? filas.filter((f) => `${f.calle} ${f.numero} ${f.nombre}`.toLowerCase().includes(t)) : filas;
  const operativa = r.clase === 'operativa';
  const censo = operativa ? censoConsolidado(db, campana.id) : null;
  if (!r.archivos) return <p className="muted">Todavía no hay ningún Excel incorporado en esta campaña.</p>;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="ux-cifras" aria-label="Resumen del censo">
        <div><b>{fmt(r.locales)}</b><span>locales</span></div>
        <div><b>{fmt(r.ocupados)}</b><span>ocupados</span></div>
        <div><b>{fmt(r.vacios)}</b><span>vacíos</span></div>
        <div><b>{fmt(r.dudosos + r.sinFecha)}</b><span>sin estado seguro</span></div>
        <div><b>{fmt(r.filas)}</b><span>filas de {fmt(r.archivos)} Excel</span></div>
      </div>
      {r.dudosos + r.sinFecha > 0 && <p className="muted" style={{ margin: 0 }}>«Sin estado seguro»: {r.dudosos} con datos que no coinciden y {r.sinFecha} sin fecha suficiente. No se cuentan como ocupados ni vacíos.</p>}
      <label className="campo ux-buscar">
        <span className="sr-only">Buscar</span>
        <Search size={14} aria-hidden />
        <input className="input" type="search" aria-label="Buscar un local" placeholder="Buscar calle, número o nombre" value={q} onChange={(e) => { setQ(e.target.value); setN(POR_PAGINA); }} />
      </label>
      <div className="tabla-scroll">
        <table className="tabla ap-tabla" aria-label="Locales">
          <thead><tr><th>Dirección</th><th>Nombre</th><th>Estado</th></tr></thead>
          <tbody>{vis.slice(0, n).map((f) => (
            <tr key={f.localId}>
              <td>{f.calle}, {f.numero}</td>
              <td>{f.nombre || <span className="muted">—</span>}</td>
              <td><span className={`chip ux-estado-${f.estado.clase}`} title={CLASE_ESTADO_TXT[f.estado.clase]}>{f.estado.clase === 'confirmado' ? (f.estado.valor === 'vacio' ? 'Vacío' : 'Ocupado') : f.estado.clase === 'dudoso' ? 'Dudoso' : 'Sin fecha'}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {vis.length > n && <button className="btn s" style={{ alignSelf: 'flex-start' }} onClick={() => setN(n + POR_PAGINA)}>Mostrar más ({fmt(vis.length - n)})</button>}
      {!vis.length && <p className="muted">Ningún local coincide con la búsqueda.</p>}
      {censo && (
        <details className="ux-plegable">
          <summary>Por itinerario y cruces</summary>
          <div className="tabla-scroll">
            <table className="tabla ap-tabla" aria-label="Por itinerario">
              <thead><tr><th>Itinerario</th><th className="num">Filas</th><th className="num">Con local</th><th className="num">Sin local</th><th>Fechas</th></tr></thead>
              <tbody>{censo.itinerarios.map((d) => <tr key={d.itinerario.id}><td>{d.itinerario.codigo}</td><td className="num">{fmt(d.registros)}</td><td className="num">{fmt(d.vinculados)}</td><td className="num">{fmt(d.pendientes)}</td><td>{d.fechas ? `${d.fechas.desde} – ${d.fechas.hasta}` : '—'}</td></tr>)}</tbody>
            </table>
          </div>
          <ul className="inc-lista">
            {censo.posiblesDuplicados.map((d) => <li key={`d-${d.portal}-${d.nombre}`}>Posible duplicado: «{d.nombre}», {d.portal} · {d.conciliado ? 'conciliado' : 'pendiente'}</li>)}
            {censo.contradicciones.map((x) => <li key={`c-${x.portal}`}>Datos que no coinciden: {x.portal} · {x.resuelta ? 'resuelto' : 'pendiente'}</li>)}
            {censo.mismoPortal.map((m) => <li key={`p-${m.portal}`}>{m.portal}: {m.locales} locales en el mismo portal</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
