import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, ChevronRight, CloudOff, Download, Monitor, RefreshCw, Sun, Wifi,
} from 'lucide-react';
import { useStore } from '../../store/store';
import { itinerariosDe, localesPrevios, situacionPrevia } from '../../domain/consultas';
import { estadoTramo, progresoItinerario } from '../../domain/planificacion';
import { resumenCalle, type Contexto } from '../../domain/campo';
import type { Id, Itinerario } from '../../domain/types';
import { Avatar, EstadoCob, Pct } from '../../components/ui';
import { CapturaCalle } from './CapturaCalle';
import { MiniMapa } from './MiniMapa';
import '../../styles/campo.css';

export function useCtxCampo(campanaId: Id): () => Contexto {
  const prefs = useStore((s) => s.prefs);
  return () => ({ campanaId, investigadorId: prefs.campoPersonaId, fecha: new Date().toISOString(), fuente: 'campo-app', sinConexion: prefs.sinConexion });
}

export default function CampoApp() {
  const prefs = useStore((s) => s.prefs);
  const [ancho, setAncho] = useState(window.innerWidth);
  useEffect(() => {
    const r = () => setAncho(window.innerWidth);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  const enMarco = ancho > 640;
  const app = (
    <div className={`movil ${prefs.modoSol ? 'sol' : ''}`}>
      <Routes>
        <Route index element={<Inicio />} />
        <Route path="it/:itId" element={<VistaItinerario />} />
        <Route path="it/:itId/calle/:calleId" element={<CapturaCalle />} />
      </Routes>
    </div>
  );
  if (!enMarco) return app;
  return (
    <div className="escaparate">
      <div className="escaparate-nota">
        <Link to="/territorio" className="btn s oscuro-borde"><Monitor size={14} /> Volver al escritorio</Link>
        <h2>App de campo</h2>
        <p>Vista móvil para el investigador: pocas pulsaciones, calle recordada, sin pedir lo que ya existe.</p>
        <ul>
          <li>Abre esta misma dirección en un teléfono para usarla a pantalla completa.</li>
          <li>Los cambios se reflejan al instante en Territorio y Oficina.</li>
          <li>El modo sin conexión es una <b>simulación</b>: no existe todavía motor de sincronización.</li>
        </ul>
      </div>
      <div className="telefono">
        <div className="telefono-muesca" />
        {app}
      </div>
    </div>
  );
}

export function BarraEstado() {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const db = useStore((s) => s.db!);
  const aplicar = useStore((s) => s.aplicar);
  // Cola del dispositivo de este investigador (cada móvil tiene la suya)
  const mia = db.colaSync.filter((s) => s.estado === 'en-cola' && s.observacionId && db.observaciones[s.observacionId]?.investigadorId === prefs.campoPersonaId);
  const pendientes = mia.length;
  const sincronizar = () => {
    const ids = new Set(mia.map((s) => s.id));
    const obsIds = new Set(mia.map((s) => s.observacionId));
    aplicar(
      (d) => ({
        ...d,
        observaciones: Object.fromEntries(Object.entries(d.observaciones).map(([k, o]) => [k, obsIds.has(o.id) ? { ...o, sync: 'sincronizada' as const } : o])),
        colaSync: d.colaSync.filter((s) => !ids.has(s.id)),
      }),
      `${pendientes} registro(s) sincronizados · simulación`,
    );
  };
  return (
    <div className={`m-estado ${prefs.sinConexion ? 'off' : ''}`}>
      <button className="m-red" onClick={() => setPrefs({ sinConexion: !prefs.sinConexion })} title="Simular pérdida de cobertura">
        {prefs.sinConexion ? <CloudOff size={14} /> : <Wifi size={14} />}
        {prefs.sinConexion ? 'Sin conexión (simulado)' : 'Conectado'}
      </button>
      {pendientes > 0 && (
        <button className="m-pend" onClick={sincronizar} disabled={prefs.sinConexion} title={prefs.sinConexion ? 'Se sincronizará al recuperar conexión' : 'Sincronizar ahora'}>
          <RefreshCw size={13} /> {pendientes} sin sincronizar
        </button>
      )}
      <span className="esp" />
      <button className={`m-sol ${prefs.modoSol ? 'on' : ''}`} onClick={() => setPrefs({ modoSol: !prefs.modoSol })} title="Modo sol: alto contraste para exterior" aria-pressed={prefs.modoSol}>
        <Sun size={15} />
      </button>
    </div>
  );
}

function Inicio() {
  const db = useStore((s) => s.db!);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const nav = useNavigate();
  const persona = db.personas[prefs.campoPersonaId];
  const [descarga, setDescarga] = useState<number | null>(null);
  const [descargado, setDescargado] = useState(false);
  const mios = useMemo(() => {
    const camp = Object.values(db.campanas).filter((c) => c.estados.campo !== 'terminado' && c.tipo !== 'historico-importado');
    return camp.flatMap((c) => itinerariosDe(db, c.id)).filter((i) => i.asignadosIds.includes(prefs.campoPersonaId));
  }, [db, prefs.campoPersonaId]);
  const investigadores = Object.values(db.personas).filter((p) => p.roles.includes('investigador'));

  const descargar = () => {
    setDescarga(0);
    let v = 0;
    const t = setInterval(() => {
      v += 0.09 + Math.random() * 0.08;
      if (v >= 1) {
        clearInterval(t);
        setDescarga(null);
        setDescargado(true);
      } else setDescarga(v);
    }, 160);
  };
  const nPrevios = mios.reduce((a, it) => a + it.tramos.reduce((b, t) => b + localesPrevios(db, db.campanas[it.campanaId].campanaReferenciaId, t.calleId).length, 0), 0);

  return (
    <div className="m-pantalla">
      <BarraEstado />
      <header className="m-cab-inicio">
        <div className="fila">
          <Avatar p={persona} size={40} />
          <div className="esp">
            <div className="m-hola">Hola, {persona?.nombre.split(' ')[0]}</div>
            <select className="m-persona" value={prefs.campoPersonaId} onChange={(e) => setPrefs({ campoPersonaId: e.target.value })} aria-label="Investigador (demo)">
              {investigadores.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre} · ficticio</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <section className="m-tarjeta m-salida">
        <div className="fila">
          <Download size={18} />
          <b className="esp">Preparar salida</b>
          {descargado && <span className="chip ok"><Check size={12} /> Disponible sin conexión</span>}
        </div>
        <ul className="m-paquete">
          <li>{mios.length} itinerario(s) asignado(s)</li>
          <li>{mios.reduce((a, i) => a + i.tramos.length, 0)} calles · {nPrevios} locales anteriores</li>
          <li>Clasificación de actividades y datos auxiliares</li>
          <li>Cartografía de la zona <span className="muted">(proveedor con licencia offline · pendiente)</span></li>
        </ul>
        {descarga !== null ? (
          <Pct v={descarga} alto={8} />
        ) : (
          <button className="m-btn secundario" onClick={descargar}>{descargado ? 'Actualizar paquete' : 'Descargar para trabajar sin cobertura'}</button>
        )}
        <p className="m-nota">Simulación: el paquete no se guarda realmente para uso offline en este prototipo.</p>
      </section>

      <div className="m-rotulo">Mis itinerarios</div>
      {mios.length === 0 && <p className="m-nota" style={{ padding: '0 16px' }}>No tienes itinerarios asignados en campañas en curso.</p>}
      {mios.map((it) => (
        <TarjetaItinerario key={it.id} it={it} onClick={() => nav(`/campo/it/${it.id}`)} />
      ))}
    </div>
  );
}

function TarjetaItinerario({ it, onClick }: { it: Itinerario; onClick: () => void }) {
  const db = useStore((s) => s.db!);
  const pr = progresoItinerario(db, it);
  const camp = db.campanas[it.campanaId];
  return (
    <button className="m-tarjeta m-it" onClick={onClick} style={{ ['--c' as string]: it.color }}>
      <div className="fila">
        <span className="m-it-cod">{it.codigo}</span>
        <b className="esp">{it.nombre}</b>
        <ChevronRight size={18} />
      </div>
      <div className="m-nota">{db.municipios[camp.municipioId]?.nombre} · {camp.nombre} · {it.tramos.length} calles</div>
      <div className="fila">
        <div className="esp"><Pct v={pr.pct} color={it.color} alto={8} /></div>
        <b className="num">{pr.completadas}/{pr.total}</b>
      </div>
    </button>
  );
}

function VistaItinerario() {
  const { itId } = useParams();
  const db = useStore((s) => s.db!);
  const prefs = useStore((s) => s.prefs);
  const nav = useNavigate();
  const it = itId ? db.itinerarios[itId] : undefined;
  const [soloMias, setSoloMias] = useState(true);
  if (!it) return <div className="m-pantalla"><p style={{ padding: 16 }}>Itinerario no encontrado. <Link to="/campo">Volver</Link></p></div>;
  const camp = db.campanas[it.campanaId];
  const pr = progresoItinerario(db, it);
  const hayResponsables = it.tramos.some((t) => t.responsableId);
  const tramos = it.tramos.filter((t) => !soloMias || !hayResponsables || !t.responsableId || t.responsableId === prefs.campoPersonaId);
  const siguiente = tramos.find((t) => estadoTramo(db, it.campanaId, t) === 'en-curso') ?? tramos.find((t) => estadoTramo(db, it.campanaId, t) === 'pendiente');

  return (
    <div className="m-pantalla">
      <BarraEstado />
      <header className="m-cab" style={{ ['--c' as string]: it.color }}>
        <button className="m-atras" onClick={() => nav('/campo')} aria-label="Volver"><ArrowLeft size={20} /></button>
        <div className="esp">
          <div className="m-sub">{it.codigo} · {camp.nombre}</div>
          <h1>{it.nombre}</h1>
        </div>
      </header>
      <MiniMapa it={it} onCalle={(id) => nav(`/campo/it/${it.id}/calle/${id}`)} />
      <div className="m-resumen">
        <div><b className="num">{pr.completadas}</b><span>completadas</span></div>
        <div><b className="num">{pr.porEstado['en-curso']}</b><span>en curso</span></div>
        <div><b className="num">{pr.porEstado.pendiente}</b><span>pendientes</span></div>
        <div><b className="num">{pr.porEstado['parcial-incidencias']}</b><span>parciales</span></div>
      </div>
      {siguiente && (
        <button className="m-btn primario m-continuar" onClick={() => nav(`/campo/it/${it.id}/calle/${siguiente.calleId}`)}>
          Continuar: {siguiente.orden}. {db.calles[siguiente.calleId]?.nombre}
        </button>
      )}
      {hayResponsables && (
        <div className="m-filtro">
          <button className={soloMias ? 'on' : ''} onClick={() => setSoloMias(true)}>Mis calles</button>
          <button className={!soloMias ? 'on' : ''} onClick={() => setSoloMias(false)}>Todo el itinerario</button>
        </div>
      )}
      <ol className="m-calles">
        {tramos.map((t) => {
          const c = db.calles[t.calleId];
          const e = estadoTramo(db, it.campanaId, t);
          const r = resumenCalle(db, it.campanaId, t.calleId);
          const sit = situacionPrevia(db, camp, t.calleId);
          return (
            <li key={t.calleId}>
              <button onClick={() => nav(`/campo/it/${it.id}/calle/${t.calleId}`)}>
                <span className="m-num" style={{ background: it.color }}>{t.orden}</span>
                <span className="esp">
                  <b>{c?.nombre}</b>
                  <span className="m-nota">
                    {sit === 'con-registros' ? `${r.previos} locales anteriores` : 'Sin registros anteriores'}
                    {t.acera !== 'ambas' && ` · solo ${t.acera === 'par' ? 'pares' : 'impares'}`}
                    {t.responsableId && t.responsableId !== prefs.campoPersonaId && ` · ${db.personas[t.responsableId]?.nombre.split(' ')[0]}`}
                  </span>
                </span>
                <EstadoCob e={e} corto />
                <ChevronRight size={16} />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function pasoCalle(it: Itinerario, calleId: Id, delta: number): Id | undefined {
  const i = it.tramos.findIndex((t) => t.calleId === calleId);
  return it.tramos[i + delta]?.calleId;
}

