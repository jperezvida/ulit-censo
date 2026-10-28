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
 */
function FuenteEspacio({ campanaId, children }: { campanaId: Id; children: ReactNode }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const [aviso, setAviso] = useState<{ t: 'ok' | 'error'; m: string } | null>(null);
  const cola = useRef<Promise<unknown>>(Promise.resolve());
  // Estado tras las operaciones aún en cola: valida cada nueva operación sobre lo ya pedido, no sobre lo ya escrito.
  const enCola = useRef<{ db: BaseDatos; n: number } | null>(null);
  const persona = personaEspacio(db);
  const aplicar: Aplicar = (fn, etiqueta, opciones) => {
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
    cola.current = cola.current.then(async () => {
      const r = await modificar(etiqueta, (actual: BaseDatos) => fn(actual));
      if (!r.ok) enCola.current = null;
      else if (enCola.current && --enCola.current.n === 0) enCola.current = null;
      setAviso(r.ok ? { t: 'ok', m: `Guardado: ${etiqueta}` } : { t: 'error', m: r.error ?? 'No se ha podido guardar.' });
    });
    return true;
  };
  const fuente: FuenteOficina = { db, campanaId, personaId: persona?.id ?? '', roles: persona?.roles ?? [], aplicar };
  return (
    <FuenteOficinaContext.Provider value={fuente}>
      {aviso && <div className={`t-info ${aviso.t === 'error' ? 'error' : ''}`} role={aviso.t === 'error' ? 'alert' : 'status'}>{aviso.m}</div>}
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
