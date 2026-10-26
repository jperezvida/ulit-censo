import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownUp, ArrowLeft, ChevronDown, ChevronUp, Clock, FileUp, GripVertical, Pencil, Plus, Printer, Route,
  Smartphone, Trash2, X,
} from 'lucide-react';
import type { BaseDatos } from '../../domain/db';
import { direccionVigente, situacionPrevia } from '../../domain/consultas';
import { asignacionDelAmbito, detectarSolapes, estadoTramo, estimarCarga, progresoItinerario } from '../../domain/planificacion';
import {
  actualizarTramo, alternarCalle, crearItinerario, editarItinerario, eliminarItinerario, moverTramo, ordenarItinerario, siguienteCodigo,
} from '../../domain/itinerarios';
import { useContextoTerritorio } from './contextoTerritorio';
import type { Id, Itinerario } from '../../domain/types';
import { Avatar, Avatares, Barra, EstadoCob, Pct, Sim, fmt } from '../../components/ui';
import { formatoDistancia } from '../../domain/geo';
import { COLORES_IT } from '../../data/semilla';
import { crearItinerario as crearItinerarioEspacio } from '../../domain/campanaOperativa';
import { personaEspacio, PREFIJO } from '../../domain/espacios';
import { ImportarKML } from './ImportarKML';

export function revisionItinerario(db: BaseDatos, it: Itinerario) {
  const calles = new Set(it.tramos.map((t) => t.calleId));
  const revs = Object.values(db.revisiones).filter((r) => r.campanaId === it.campanaId && db.locales[r.localId] && calles.has(direccionVigente(db.locales[r.localId]).calleId));
  const n = revs.length;
  return {
    n,
    cat: revs.filter((r) => r.categorizacion === 'revisado').length,
    dig: revs.filter((r) => r.digital === 'revisado').length,
    val: revs.filter((r) => r.validacion === 'aprobada').length,
  };
}

interface Props {
  itinerarios: Itinerario[];
  itSel: Id | null;
  setItSel: (id: Id | null) => void;
  editando: boolean;
  setEditando: (v: boolean) => void;
  puedeEditar: boolean;
  onCalle: (id: Id) => void;
  resaltar: (ids: Id[] | null) => void;
  resaltando: Id[] | null;
  onImprimir: (id: Id) => void;
  sinPrevios: Set<Id>;
  /** Escritura verificada exclusiva del espacio de ensayo. Nunca usa el almacén de demostración. */
  modificarEnsayo?: (cambio: (db: BaseDatos) => BaseDatos, descripcion: string, itinerarioId?: Id) => Promise<boolean>;
  ocupadoEnsayo?: string | null;
}

export function PanelPlan(p: Props) {
  const { db, campana, ix, aplicar, demo } = useContextoTerritorio();
  const [kml, setKml] = useState(false);
  const asig = useMemo(() => (campana ? asignacionDelAmbito(campana, p.itinerarios, db.calles) : null), [campana, p.itinerarios, db.calles]);
  const solapes = useMemo(() => detectarSolapes(p.itinerarios), [p.itinerarios]);
  const it = p.itSel ? db.itinerarios[p.itSel] : undefined;

  if (!campana || !asig) return null;

  if (it) return <DetalleItinerario {...p} it={it} />;

  const nuevo = async () => {
    if (!campana || p.ocupadoEnsayo) return;
    const codigo = siguienteCodigo(p.itinerarios.map((i) => i.codigo));
    let id = '';
    const cambio = (d: BaseDatos) => {
      if (Object.values(d.itinerarios).some((it) => it.campanaId === campana.id && it.codigo === codigo))
        throw new Error('El código del itinerario ha cambiado. Vuelva a abrir el espacio.');
      if (p.modificarEnsayo) {
        // G4: IDs con prefijo de espacio; el creador antiguo es exclusivo de la demostración.
        const r = crearItinerarioEspacio(d, campana.id, { codigo, nombre: `Itinerario ${codigo.slice(3)}` },
          { prefijo: PREFIJO.ensayo, porId: personaEspacio(d)!.id });
        id = r.itinerarioId;
        return r.db;
      }
      const r = crearItinerario(d, campana.id, { codigo, nombre: `Itinerario ${codigo.slice(3)}`, color: COLORES_IT[p.itinerarios.length % COLORES_IT.length] });
      id = r.id;
      return r.db;
    };
    if (p.modificarEnsayo) {
      if (!await p.modificarEnsayo(cambio, `${codigo} creado`)) return;
    } else {
      aplicar(cambio, `${codigo} creado`);
    }
    if (id) p.setItSel(id);
    p.setEditando(demo);
  };

  const conmutar = (ids: Id[]) => p.resaltar(p.resaltando && p.resaltando.join() === ids.join() ? null : ids);

  return (
    <div className="t-lista">
      <div className="t-cab">
        <div className="rotulo">02 · Planificación · {campana.nombre}</div>
        {campana.tipo === 'historico-importado' ? (
          <div className="t-info">
            Censo importado sin itinerarios: aquí solo se consulta su cobertura (calles con registros). Para planificar, cambia a una campaña en curso.
          </div>
        ) : (
          <div className="fila" style={{ marginTop: 6 }}>
            <b className="num" style={{ fontSize: 22 }}>{p.itinerarios.length}</b>
            <span className="muted">de ~{campana.itinerariosPrevistos ?? p.itinerarios.length} itinerarios previstos</span>
            <span className="esp" />
            <Pct v={asig.completa.length / Math.max(1, campana.ambitoCalleIds.length)} />
          </div>
        )}
      </div>

      <div className="t-alertas">
        <AlertaFila
          on={!!p.resaltando && p.resaltando.join() === asig.sinAsignar.join()}
          tono={asig.sinAsignar.length ? 'aviso' : 'ok'}
          n={asig.sinAsignar.length}
          txt="calles del ámbito sin asignar"
          onClick={() => conmutar(asig.sinAsignar)}
        />
        {asig.parcial.length > 0 && <AlertaFila tono="aviso" n={asig.parcial.length} txt="asignadas solo en parte (tramo o acera)" onClick={() => conmutar(asig.parcial)} on={p.resaltando?.join() === asig.parcial.join()} />}
        <AlertaFila tono={solapes.length ? 'error' : 'ok'} n={solapes.length} txt="solapes entre itinerarios" onClick={() => conmutar([...new Set(solapes.map((s) => s.calleId))])} on={p.resaltando?.join() === [...new Set(solapes.map((s) => s.calleId))].join()} />
        <AlertaFila tono="info" n={p.sinPrevios.size} txt="calles sin locales anteriores" onClick={() => conmutar([...p.sinPrevios])} on={p.resaltando?.join() === [...p.sinPrevios].join()} />
        {solapes.length > 0 && p.resaltando?.join() === [...new Set(solapes.map((s) => s.calleId))].join() && (
          <ul className="t-solapes">
            {solapes.slice(0, 8).map((s, i) => (
              <li key={i}>
                <button className="enlace" onClick={() => p.onCalle(s.calleId)}>{db.calles[s.calleId]?.nombre}</button> · {s.detalle}
              </li>
            ))}
          </ul>
        )}
        {p.resaltando && p.resaltando.length > 0 && p.resaltando.length <= 40 && !(solapes.length > 0 && p.resaltando.join() === [...new Set(solapes.map((s) => s.calleId))].join()) && (
          <ul className="t-solapes">
            {p.resaltando.map((id) => (
              <li key={id}>
                <button className="enlace" onClick={() => p.onCalle(id)}>{db.calles[id]?.nombre}</button>
                {campana && <span className="muted"> · {situacionCorta(db, campana.id, id, ix)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="t-its">
        {p.itinerarios.map((i) => (
          <TarjetaIt key={i.id} it={i} onClick={() => p.setItSel(i.id)} />
        ))}
        {campana.tipo !== 'historico-importado' &&
          Array.from({ length: Math.max(0, (campana.itinerariosPrevistos ?? 0) - p.itinerarios.length) }).map((_, i) => (
            <div key={i} className="t-it-hueco">Itinerario pendiente de diseñar</div>
          ))}
      </div>

      {(p.puedeEditar || p.modificarEnsayo) && (
        <div className="fila" style={{ padding: '4px 16px 16px', flexWrap: 'wrap' }}>
          <button className="btn primario" disabled={!!p.ocupadoEnsayo} onClick={() => void nuevo()}>
            <Plus size={15} /> Nuevo itinerario
          </button>
          {demo && <button className="btn" onClick={() => setKml(true)}>
            <FileUp size={15} /> Importar KML/KMZ
          </button>}
        </div>
      )}
      {!p.puedeEditar && demo && campana.tipo !== 'historico-importado' && <p className="muted" style={{ padding: '0 16px', fontSize: 12 }}>Activa el rol Coordinador para editar itinerarios.</p>}
      {kml && <ImportarKML onCerrar={() => setKml(false)} onCreado={(id) => { setKml(false); p.setItSel(id); }} />}
    </div>
  );
}

function situacionCorta(db: BaseDatos, campanaId: Id, calleId: Id, ix: ReturnType<typeof useContextoTerritorio>['ix']) {
  const s = situacionPrevia(db, db.campanas[campanaId], calleId, ix.obs);
  return { 'con-registros': 'con registros', 'no-censada': 'no censada', 'censada-sin-locales': 'censada sin locales', 'sin-informacion': 'sin información', 'pendiente-relacionar': 'pendiente de relacionar' }[s];
}

function AlertaFila({ tono, n, txt, onClick, on }: { tono: 'ok' | 'aviso' | 'error' | 'info'; n: number; txt: string; onClick: () => void; on?: boolean }) {
  return (
    <button className={`t-alerta ${tono} ${on ? 'on' : ''}`} onClick={onClick} disabled={n === 0}>
      <b className="num">{n}</b>
      <span>{txt}</span>
      <span className="esp" />
      {n > 0 && <span className="t-alerta-ver">{on ? 'Ocultar' : 'Ver'}</span>}
    </button>
  );
}

function TarjetaIt({ it, onClick }: { it: Itinerario; onClick: () => void }) {
  const { db, campana, ix } = useContextoTerritorio();
  const prog = progresoItinerario(db, it);
  const carga = useMemo(() => estimarCarga(db, campana!, it.tramos, ix.obs), [db, campana, it.tramos, ix.obs]);
  const rev = useMemo(() => revisionItinerario(db, it), [db, it]);
  return (
    <button className="t-it" style={{ ['--c' as string]: it.color }} onClick={onClick}>
      <div className="fila">
        <span className="t-it-cod mono">{it.codigo}</span>
        <b className="t-it-nom">{it.nombre}</b>
        <span className="esp" />
        <Avatares personas={it.asignadosIds.map((id) => db.personas[id])} size={20} />
      </div>
      <div className="t-it-meta">
        <span>{it.tramos.length} calles</span>
        <span>{formatoDistancia(carga.longitudM)}</span>
        <span>{fmt(carga.localesPrevios)} loc. ant.</span>
        <span title="Estimación orientativa">≈{Math.round(carga.horas)} h</span>
      </div>
      <Barra
        partes={[
          { v: prog.porEstado['completada-con-locales'], color: 'var(--e-con)', titulo: 'Completadas con locales' },
          { v: prog.porEstado['completada-sin-locales'], color: 'var(--e-sin)', titulo: 'Completadas sin locales' },
          { v: prog.porEstado['parcial-incidencias'], color: 'var(--e-parcial)', titulo: 'Parciales' },
          { v: prog.porEstado['en-curso'], color: 'var(--e-curso)', titulo: 'En curso' },
          { v: prog.porEstado.pendiente, color: '#e1e6ee', titulo: 'Pendientes' },
        ]}
      />
      <div className="t-it-fases">
        <EstadoFase t="Campo" ok={prog.campoTerminado} parcial={prog.completadas > 0} />
        <EstadoFase t="Categoría" ok={rev.n > 0 && rev.cat === rev.n} parcial={rev.cat > 0} />
        <EstadoFase t="Digital" ok={rev.n > 0 && rev.dig === rev.n} parcial={rev.dig > 0} />
        <EstadoFase t="Validación" ok={rev.n > 0 && rev.val === rev.n} parcial={rev.val > 0} />
      </div>
      {it.escenarioDemo && prog.completadas > 0 && <Sim texto="Progreso simulado" title={it.escenarioDemo} />}
    </button>
  );
}

function EstadoFase({ t, ok, parcial }: { t: string; ok: boolean; parcial: boolean }) {
  return (
    <span className={`t-fase ${ok ? 'ok' : parcial ? 'parcial' : ''}`} title={`${t}: ${ok ? 'terminado' : parcial ? 'en curso' : 'pendiente'}`}>
      <i />
      {t}
    </span>
  );
}

function DetalleItinerario(p: Props & { it: Itinerario }) {
  const { it } = p;
  const { db, campana, ix, aplicar, demo } = useContextoTerritorio();
  const nav = useNavigate();
  const [arrastre, setArrastre] = useState<number | null>(null);
  const [personas, setPersonas] = useState(false);
  const gestionable = p.puedeEditar || !!p.modificarEnsayo;
  const [nombreEnsayo, setNombreEnsayo] = useState(it.nombre);
  useEffect(() => { setNombreEnsayo(it.nombre); }, [it.id, it.nombre]);
  const operar = (cambio: (d: BaseDatos) => BaseDatos, descripcion: string, silencioso = true) => {
    if (p.modificarEnsayo) void p.modificarEnsayo(cambio, descripcion, it.id);
    else aplicar(cambio, descripcion, { silencioso });
  };
  const guardarNombre = () => {
    if (demo || !p.modificarEnsayo || p.ocupadoEnsayo) return;
    const nombre = nombreEnsayo.trim();
    if (!nombre) { setNombreEnsayo(it.nombre); return; }
    if (nombre !== it.nombre) operar((d) => editarItinerario(d, it.id, { nombre }), 'Nombre actualizado');
  };
  const carga = useMemo(() => estimarCarga(db, campana!, it.tramos, ix.obs), [db, campana, it.tramos, ix.obs]);
  const prog = progresoItinerario(db, it);
  const rev = useMemo(() => revisionItinerario(db, it), [db, it]);
  const investigadores = Object.values(db.personas).filter((x) => x.roles.includes('investigador'));
  const solapesIt = useMemo(() => detectarSolapes(Object.values(db.itinerarios).filter((x) => x.campanaId === it.campanaId)).filter((s) => s.itinerarios.includes(it.id)), [db.itinerarios, it]);

  return (
    <div className="t-detalle" style={{ ['--c' as string]: it.color }}>
      <div className="t-det-cab">
        <button className="btn fantasma s" onClick={() => { p.setItSel(null); p.setEditando(false); }}>
          <ArrowLeft size={14} /> Itinerarios
        </button>
        <div className="fila" style={{ marginTop: 8 }}>
          <input type="color" className="t-color" value={it.color} disabled={!gestionable || !!p.ocupadoEnsayo} onChange={(e) => operar((d) => editarItinerario(d, it.id, { color: e.target.value }), 'Color cambiado')} title="Color del itinerario" />
          <span className="t-it-cod mono">{it.codigo}</span>
          <input
            className="t-nombre" aria-label="Nombre del itinerario"
            value={demo ? it.nombre : nombreEnsayo}
            disabled={!gestionable || !!p.ocupadoEnsayo}
            onChange={(e) => demo ? operar((d) => editarItinerario(d, it.id, { nombre: e.target.value }), 'Nombre') : setNombreEnsayo(e.target.value)}
            onBlur={guardarNombre}
            onKeyDown={(e) => { if (!demo && e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </div>
        {it.escenarioDemo && <div className="t-demo"><Sim texto="Escenario de demostración" /> {it.escenarioDemo}</div>}
        <div className="fila" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>Asignados</span>
          {it.asignadosIds.map((id) => (
            <span key={id} className="chip" style={{ paddingLeft: 2 }}>
              <Avatar p={db.personas[id]} size={18} /> {db.personas[id]?.nombre.split(' ')[0]}
            </span>
          ))}
          {p.puedeEditar && (
            <span style={{ position: 'relative' }}>
              <button className="btn s fantasma" onClick={() => setPersonas(!personas)}>
                <Pencil size={13} />
              </button>
              {personas && (
                <div className="menu panel-flotante" onMouseLeave={() => setPersonas(false)}>
                  {investigadores.map((x) => (
                    <label key={x.id} className="menu-item check">
                      <input
                        type="checkbox"
                        checked={it.asignadosIds.includes(x.id)}
                        onChange={(e) => aplicar((d) => editarItinerario(d, it.id, { asignadosIds: e.target.checked ? [...it.asignadosIds, x.id] : it.asignadosIds.filter((y) => y !== x.id) }), 'Asignación actualizada', { silencioso: true })}
                      />
                      <Avatar p={x} size={20} /> {x.nombre}
                    </label>
                  ))}
                </div>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="t-cifras">
        <div><b className="num">{it.tramos.length}</b><span>calles</span></div>
        <div><b className="num">{formatoDistancia(carga.longitudM)}</b><span>de calle</span></div>
        <div><b className="num">{fmt(carga.localesPrevios)}</b><span>locales ant.</span></div>
        <div><b className="num">{carga.callesSinPrevios}</b><span>sin previos</span></div>
        <div title="Estimación orientativa: recorrido de ambas aceras a 2,5 km/h + 1,5 min por local anterior + 4 min/100 m en calles sin registros"><b className="num">≈{carga.horas.toFixed(1)} h</b><span><Clock size={11} /> carga est.</span></div>
      </div>

      <div className="t-fases-det">
        <FaseLinea t="Trabajo de campo" v={prog.total ? prog.completadas / prog.total : 0} d={`${prog.completadas}/${prog.total} calles · ${prog.porEstado['parcial-incidencias']} parciales`} />
        <FaseLinea t="Categorización" v={rev.n ? rev.cat / rev.n : 0} d={`${rev.cat}/${rev.n} registros`} />
        <FaseLinea t="Presencia digital" v={rev.n ? rev.dig / rev.n : 0} d={`${rev.dig}/${rev.n} registros`} />
        <FaseLinea t="Validación" v={rev.n ? rev.val / rev.n : 0} d={`${rev.val}/${rev.n} aprobados`} />
        {prog.campoTerminado && rev.val < rev.n && <div className="t-info aviso">Campo terminado ≠ censo terminado: queda revisión de oficina.</div>}
      </div>

      <div className="t-acciones">
        {p.puedeEditar && (
          <button className={`btn s ${p.editando ? 'activo' : 'primario'}`} onClick={() => p.setEditando(!p.editando)}>
            <Route size={14} /> {p.editando ? 'Editando en mapa' : 'Editar en mapa'}
          </button>
        )}
        {gestionable && (
          <button className="btn s" disabled={!!p.ocupadoEnsayo} onClick={() => operar((d) => ordenarItinerario(d, it.id), 'Orden sugerido por proximidad', false)} title="Reordenar por recorrido de vecino más cercano">
            <ArrowDownUp size={14} /> Ordenar
          </button>
        )}
        {demo && <button className="btn s" onClick={() => p.onImprimir(it.id)}>
          <Printer size={14} /> Hoja de campo
        </button>}
        {demo && <button className="btn s" onClick={() => nav(`/campo/it/${it.id}`)}>
          <Smartphone size={14} /> Campo
        </button>}
      </div>

      {solapesIt.length > 0 && (
        <div className="t-info error">
          <AlertTriangle size={14} /> {solapesIt.length} solape(s): {solapesIt.map((s) => db.calles[s.calleId]?.nombre).join(', ')}
        </div>
      )}

      <div className="rotulo" style={{ margin: '14px 16px 6px' }}>Calles numeradas{gestionable ? ' · arrastra para reordenar' : ''}</div>
      {it.tramos.length === 0 && <div className="t-info">Sin calles todavía. Selecciona una calle en el mapa para planificarla.</div>}
      <ol className="t-tramos">
        {it.tramos.map((t, i) => {
          const c = db.calles[t.calleId];
          const estado = estadoTramo(db, it.campanaId, t);
          const sinPrev = p.sinPrevios.has(t.calleId);
          return (
            <li
              key={t.calleId}
              draggable={gestionable && !p.ocupadoEnsayo}
              onDragStart={() => setArrastre(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (arrastre !== null && arrastre !== i) operar((d) => moverTramo(d, it.id, arrastre, i), 'Orden actualizado');
                setArrastre(null);
              }}
              className={arrastre === i ? 'arrastrando' : ''}
            >
              {gestionable && <GripVertical size={14} className="t-asa" />}
              <span className="t-num" style={{ background: it.color }}>{t.orden}</span>
              <button className="t-tramo-nom" onClick={() => p.onCalle(t.calleId)}>
                <span>{c?.nombre ?? '¿?'}</span>
                <span className="t-tags">
                  {sinPrev && <span className="tag sinprev" title="Sin locales en el censo anterior">sin previos</span>}
                  {t.acera !== 'ambas' && <span className="tag">{t.acera === 'par' ? 'pares' : 'impares'}</span>}
                  {t.segmentoIds?.length ? <span className="tag">{t.segmentoIds.length}/{c?.segmentos.length} seg.</span> : null}
                  {t.etiqueta && <span className="tag azul">{t.etiqueta}</span>}
                  {c?.procedencia === 'manual' && <span className="tag">omisión</span>}
                </span>
              </button>
              <EstadoCob e={estado} corto />
              <select
                className="t-resp"
                value={t.responsableId ?? ''}
                disabled={!p.puedeEditar}
                title="Responsable de la calle"
                onChange={(e) => aplicar((d) => actualizarTramo(d, it.id, t.calleId, { responsableId: e.target.value || undefined }), 'Responsable asignado', { silencioso: true })}
              >
                <option value="">—</option>
                {it.asignadosIds.map((id) => (
                  <option key={id} value={id}>{db.personas[id]?.iniciales}</option>
                ))}
              </select>
              {gestionable && (
                <span className="t-mov">
                  <button onClick={() => operar((d) => moverTramo(d, it.id, i, i - 1), 'Subida')} disabled={i === 0 || !!p.ocupadoEnsayo} aria-label="Subir"><ChevronUp size={12} /></button>
                  <button onClick={() => operar((d) => moverTramo(d, it.id, i, i + 1), 'Bajada')} disabled={i === it.tramos.length - 1 || !!p.ocupadoEnsayo} aria-label="Bajar"><ChevronDown size={12} /></button>
                </span>
              )}
              {p.puedeEditar && p.editando && (
                <button className="btn fantasma s icono" onClick={() => aplicar((d) => alternarCalle(d, it.id, t.calleId).db, `${c?.nombre} quitada`)} aria-label="Quitar">
                  <X size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {p.puedeEditar && (
        <div style={{ padding: '8px 16px 24px' }}>
          <button
            className="btn s peligro fantasma"
            onClick={() => {
              if (confirm(`¿Eliminar ${it.codigo}? Las calles quedarán sin asignar; los locales y el histórico no se modifican.`)) {
                aplicar((d) => eliminarItinerario(d, it.id), `${it.codigo} eliminado`);
                p.setItSel(null);
              }
            }}
          >
            <Trash2 size={13} /> Eliminar itinerario
          </button>
        </div>
      )}
    </div>
  );
}

function FaseLinea({ t, v, d }: { t: string; v: number; d: string }) {
  return (
    <div className="t-fase-linea">
      <div className="fila">
        <span>{t}</span>
        <span className="esp" />
        <span className="muted num" style={{ fontSize: 11.5 }}>{d}</span>
      </div>
      <Pct v={v} color={v >= 1 ? 'var(--e-ok)' : 'var(--azul)'} alto={5} />
    </div>
  );
}
