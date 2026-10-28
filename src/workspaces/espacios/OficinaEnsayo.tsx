import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ListChecks } from 'lucide-react';
import { useEspacios } from '../../store/espacios';
import { FuenteOficinaContext, type Aplicar, type FuenteOficina } from '../../store/fuenteOficina';
import { personaEspacio } from '../../domain/espacios';
import { claseCampana } from '../../domain/municipios';
import { estadoOficina } from '../../domain/bloqueo';
import { pendientesCampana } from '../../domain/conciliacionPosterior';
import { estadosItinerario } from '../../domain/resumenCampana';
import type { BaseDatos } from '../../domain/db';
import type { Id } from '../../domain/types';
import { OficinaContext, useFilas, type CtxOficina } from '../office/contextoOficina';
import { ListaRegistros } from '../office/ListaRegistros';
import { PanelRevision } from '../office/PanelRevision';
import { ConciliacionPosterior } from './ConciliacionPosterior';
import '../../styles/oficina-b2.css';

/**
 * Oficina para un itinerario de una campaña OPERATIVA del espacio de ensayo: la lista de registros y la
 * ficha de revisión de Oficina (clasificación, franquicia, presencia digital), con los datos del espacio.
 * Las filas sin conciliar no entran en la lista de establecimientos: se cuentan aparte y se resuelven con
 * la conciliación posterior (G5).
 */
export function OficinaEnsayoRutas() {
  return <Routes><Route path="oficina/:campanaId/:itId" element={<Validar />} /><Route path="*" element={<NoValida />} /></Routes>;
}

const NoValida = () => <div className="t-info error" role="alert">No se encuentra un itinerario operativo de este espacio. <Link to="/espacios/ensayo">Volver al ensayo</Link>.</div>;

function Validar() {
  const db = useEspacios((s) => s.db!);
  const { campanaId = '', itId = '' } = useParams();
  const campana = db.campanas[campanaId];
  const it = db.itinerarios[itId];
  if (!campana || !it || it.campanaId !== campana.id || claseCampana(campana) !== 'operativa' || !db.municipios[campana.municipioId]) return <NoValida />;
  return <FuenteEspacio campanaId={campanaId}><OficinaItinerario campanaId={campanaId} itinerarioId={itId} /></FuenteEspacio>;
}

/**
 * Adaptación mínima: Oficina escribe con `aplicar` (síncrono) y el espacio guarda con `modificar`
 * (asíncrono, con escritura verificada). La operación se valida primero sobre la base actual para avisar
 * del error al momento; después se guarda en cola, recalculándose sobre la base vigente al escribir.
 *
 * Si una escritura falla, la cola se DETIENE: las operaciones siguientes (que pueden depender de ella) no
 * se guardan ni se anuncian como guardadas, y no se aceptan otras nuevas. La persona ve qué falló y qué
 * queda sin guardar, y elige: reintentar esas operaciones en orden sobre lo guardado, o descartarlas y
 * recuperar el estado guardado.
 */
interface Operacion { fn: (db: BaseDatos) => BaseDatos; etiqueta: string }
function FuenteEspacio({ campanaId, children }: { campanaId: Id; children: ReactNode }) {
  const db = useEspacios((s) => s.db!);
  const tipo = useEspacios((s) => s.tipo);
  const modificar = useEspacios((s) => s.modificar);
  const [aviso, setAviso] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const [fallo, setFallo] = useState<{ error: string; sinGuardar: string[] } | null>(null);
  const cola = useRef<Promise<unknown>>(Promise.resolve());
  // Estado tras las operaciones aún en cola: valida cada nueva operación sobre lo ya pedido, no sobre lo ya escrito.
  const enCola = useRef<{ db: BaseDatos; n: number } | null>(null);
  // Operaciones pedidas y aún no guardadas (en orden). Tras un fallo quedan aquí para reintentar o descartar.
  const pendientes = useRef<Operacion[]>([]);
  const detenida = useRef(false);
  const persona = personaEspacio(db);

  const encolar = (op: Operacion) => {
    cola.current = cola.current.then(async () => {
      if (detenida.current) return; // tras un fallo no se guarda nada más
      const r = await modificar(op.etiqueta, (actual: BaseDatos) => op.fn(actual));
      if (!r.ok) {
        detenida.current = true;
        enCola.current = null;
        const sinGuardar = pendientes.current.map((x) => x.etiqueta);
        setFallo({ error: r.error ?? 'No se ha podido guardar.', sinGuardar });
        setAviso(null);
        return;
      }
      pendientes.current = pendientes.current.filter((x) => x !== op);
      if (enCola.current && --enCola.current.n === 0) enCola.current = null;
      setAviso({ t: 'ok', m: `Guardado: ${op.etiqueta}` });
    });
  };

  const aplicar: Aplicar = (fn, etiqueta, opciones) => {
    if (detenida.current) {
      setAviso({ t: 'error', m: 'No se guardan más cambios hasta resolver el fallo anterior (reintentar o recuperar lo guardado).' });
      return false;
    }
    const base = enCola.current?.db ?? useEspacios.getState().db!;
    let previsto: BaseDatos;
    try {
      previsto = fn(base);
      if (previsto === base) return false;
    } catch (e) {
      if (!opciones?.sinAvisoError) setAviso({ t: 'error', m: e instanceof Error ? e.message : String(e) });
      return false;
    }
    enCola.current = { db: previsto, n: (enCola.current?.n ?? 0) + 1 };
    const op = { fn, etiqueta };
    pendientes.current = [...pendientes.current, op];
    encolar(op);
    return true;
  };

  /** Vuelve a intentar, en orden, lo que quedó sin guardar (cada operación se recalcula sobre lo guardado). */
  const reintentar = () => {
    const ops = pendientes.current;
    detenida.current = false;
    setFallo(null);
    enCola.current = ops.length ? { db: useEspacios.getState().db!, n: ops.length } : null;
    for (const op of ops) encolar(op);
  };
  /** Descarta lo no guardado y vuelve a leer el espacio tal como está guardado. */
  const recuperar = async () => {
    await cola.current;
    pendientes.current = [];
    enCola.current = null;
    if (tipo) await useEspacios.getState().abrir(tipo);
    // Al volver a abrir el espacio, la Oficina se monta de nuevo con lo guardado.
    detenida.current = false;
    setFallo(null);
  };

  const fuente: FuenteOficina = { db, campanaId, personaId: persona?.id ?? '', roles: persona?.roles ?? [], aplicar };
  return (
    <FuenteOficinaContext.Provider value={fuente}>
      {fallo ? (
        <div className="t-info error col" role="alert" aria-label="Fallo al guardar" style={{ gap: 6 }}>
          <span><b>No se ha podido guardar.</b> {fallo.error}</span>
          <span>Quedan {fallo.sinGuardar.length} cambio(s) sin guardar: {fallo.sinGuardar.join(' · ')}. No se guardará nada más hasta resolverlo.</span>
          <div className="fila" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn s" onClick={reintentar}>Reintentar guardar</button>
            <button className="btn s" onClick={() => void recuperar()}>Descartar y recuperar lo guardado</button>
          </div>
        </div>
      ) : aviso && <div className={`t-info ${aviso.t === 'error' ? 'error' : ''}`} role={aviso.t === 'error' ? 'alert' : 'status'}>{aviso.m}</div>}
      {children}
    </FuenteOficinaContext.Provider>
  );
}

function OficinaItinerario({ campanaId, itinerarioId }: { campanaId: Id; itinerarioId: Id }) {
  const db = useEspacios((s) => s.db!);
  const campana = db.campanas[campanaId];
  const it = db.itinerarios[itinerarioId];
  const filas = useFilas(itinerarioId);
  const [params, setParams] = useSearchParams();
  const sel = params.get('sel');
  const elegir = (id: Id | null) => setParams((p) => { if (id) p.set('sel', id); else p.delete('sel'); return p; }, { replace: true });
  const estados = useMemo(() => estadosItinerario(db, itinerarioId), [db, itinerarioId]);
  const sinConciliar = useMemo(() => pendientesCampana(db, campanaId, { itinerarioId }).length, [db, campanaId, itinerarioId]);
  const estado = estadoOficina(db, itinerarioId);
  const bloqueado = estado === 'revision-cerrada' || estado === 'validado';
  const persona = personaEspacio(db);
  const ctx: CtxOficina = { campana, itinerario: it, alcance: { itinerarioId }, bloqueado, personaId: persona?.id ?? '' };
  const idx = filas.findIndex((f) => f.localId === sel);
  const fila = idx >= 0 ? filas[idx] : undefined;
  const mover = (d: number) => { const f = filas[Math.max(0, Math.min(filas.length - 1, idx + d))]; if (f) elegir(f.localId); };

  return (
    <section className="tarjeta col ofe" aria-label={`Oficina de ${it.codigo}`}>
      <div className="fila" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Link className="btn s" to="/espacios/ensayo"><ArrowLeft size={14} /> Volver al inicio</Link>
        <h2 style={{ margin: 0 }}>Oficina · {it.codigo} · {campana.nombre}</h2>
      </div>
      <div className="ux-item-cab" aria-label={`Estados de ${it.codigo}`}>
        {[estados.campo, estados.oficina, estados.validacion].map((x) => <span key={x.texto} className={`chip ${x.hecho ? 'ok' : ''}`}>{x.texto}</span>)}
      </div>
      <p className="muted" style={{ margin: 0 }}>{filas.length} establecimiento(s) con local · {sinConciliar} fila(s) sin conciliar (no cuentan como revisadas). Los cambios se guardan solo en esta campaña del espacio de ensayo.</p>
      {sinConciliar > 0 && (
        <details className="ux-plegable" aria-label="Filas sin conciliar">
          <summary><ListChecks size={13} /> Resolver {sinConciliar} fila(s) sin conciliar (G5)</summary>
          <ConciliacionPosterior campanaId={campanaId} simple filtroInicial={{ itinerarioId }} />
        </details>
      )}
      <OficinaContext.Provider value={ctx}>
        <div className="ofi-establecimiento ofe-cuerpo">
          <ListaRegistros filas={filas} sel={sel} onSel={elegir} etiqueta={`Establecimientos de ${it.codigo}`} />
          {fila ? (
            <PanelRevision
              key={fila.localId} fila={fila} posicion={`${idx + 1} de ${filas.length}`}
              onCerrar={() => elegir(null)} onAnterior={() => mover(-1)} onSiguiente={() => mover(1)}
            />
          ) : <div className="t-info" style={{ margin: 12 }}>Elija un establecimiento para abrir su ficha.</div>}
        </div>
      </OficinaContext.Provider>
    </section>
  );
}
