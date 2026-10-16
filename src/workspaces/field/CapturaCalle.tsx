import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Ban, Check, ChevronLeft, ChevronRight, CircleHelp, Flag, LocateFixed, Minus, PencilLine, Plus, Store, Undo2, X,
} from 'lucide-react';
import { useStore } from '../../store/store';
import { direccionVigente, localesPrevios, ocupacionEn, situacionPrevia, SITUACION_TXT } from '../../domain/consultas';
import {
  TIPO_OBS_TXT, confirmarSinCambios, finalizarCalle, marcarDudoso, marcarPosibleDesaparicion, modificarLocal, registrarLocalNuevo,
  registrarNuevoNegocio, registrarVacio, resumenCalle, siguienteNumero, validarFinalizacion, type ResultadoCalle,
} from '../../domain/campo';
import { estadoTramo } from '../../domain/planificacion';
import { puntoEnLinea, desplazarPerpendicular } from '../../domain/geo';
import { rutaActividad } from '../../domain/taxonomy';
import { clasificacionEn } from '../../domain/clasificacion';
import type { Id, LocalFisico, Observacion } from '../../domain/types';
import { EstadoCob } from '../../components/ui';
import { BarraEstado, pasoCalle, useCtxCampo } from './CampoApp';

type Hoja =
  | { tipo: 'nuevo' }
  | { tipo: 'acciones'; local: LocalFisico }
  | { tipo: 'modificar'; local: LocalFisico }
  | { tipo: 'vacio'; local: LocalFisico }
  | { tipo: 'negocio'; local: LocalFisico }
  | { tipo: 'nota'; local: LocalFisico; clase: 'dudoso' | 'incidencia' | 'desaparicion' }
  | { tipo: 'finalizar' };

export function CapturaCalle() {
  const { itId, calleId } = useParams();
  const db = useStore((s) => s.db!);
  const aplicar = useStore((s) => s.aplicar);
  const avisar = useStore((s) => s.avisar);
  const nav = useNavigate();
  const it = itId ? db.itinerarios[itId] : undefined;
  const calle = calleId ? db.calles[calleId] : undefined;
  const ctx = useCtxCampo(it?.campanaId ?? '');
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [pestana, setPestana] = useState<'anteriores' | 'hoy'>('anteriores');
  const camp = it ? db.campanas[it.campanaId] : undefined;

  const previos = useMemo(() => (camp && calle ? localesPrevios(db, camp.campanaReferenciaId, calle.id) : []), [db, camp, calle]);
  const obsHoy = useMemo(
    () => (camp && calle ? Object.values(db.observaciones).filter((o) => o.campanaId === camp.id && o.calleId === calle.id).sort((a, b) => (b.registrado ?? b.fecha ?? '').localeCompare(a.registrado ?? a.fecha ?? '')) : []),
    [db.observaciones, camp, calle],
  );
  const porLocal = useMemo(() => {
    const m = new Map<Id, Observacion>();
    for (const o of [...obsHoy].reverse()) if (o.localId) m.set(o.localId, o);
    return m;
  }, [obsHoy]);

  if (!it || !calle || !camp) return <div className="m-pantalla"><p style={{ padding: 16 }}>Calle no encontrada.</p></div>;
  const tramo = it.tramos.find((t) => t.calleId === calle.id);
  const estado = tramo ? estadoTramo(db, it.campanaId, tramo) : 'pendiente';
  const sit = situacionPrevia(db, camp, calle.id);
  const revisados = previos.filter((l) => porLocal.has(l.id)).length;
  const nuevos = obsHoy.filter((o) => o.tipo === 'nuevo-local');
  const ant = pasoCalle(it, calle.id, -1);
  const sig = pasoCalle(it, calle.id, 1);
  const ir = (id?: Id) => id && nav(`/campo/it/${it.id}/calle/${id}`, { replace: true });

  const ultimoNumero = (() => {
    const ns = nuevos.map((o) => o.datos.numero).filter((n): n is number => n !== null);
    return ns.length ? ns[0] : null;
  })();

  const accion = (fn: Parameters<typeof aplicar>[0], txt: string) => {
    aplicar(fn, txt);
    setHoja(null);
  };

  return (
    <div className="m-pantalla m-captura">
      <BarraEstado />
      <header className="m-cab m-cab-calle" style={{ ['--c' as string]: it.color }}>
        <button className="m-atras" onClick={() => nav(`/campo/it/${it.id}`)} aria-label="Volver al itinerario"><ArrowLeft size={20} /></button>
        <div className="esp" style={{ minWidth: 0 }}>
          <div className="m-sub">{it.codigo} · calle {tramo?.orden ?? '–'} de {it.tramos.length}</div>
          <h1 className="m-calle-nom">{calle.nombre}</h1>
        </div>
        <button className="m-atras" disabled={!ant} onClick={() => ir(ant)} aria-label="Calle anterior"><ChevronLeft size={20} /></button>
        <button className="m-atras" disabled={!sig} onClick={() => ir(sig)} aria-label="Calle siguiente"><ChevronRight size={20} /></button>
      </header>
      <div className="m-calle-info">
        <EstadoCob e={estado} />
        <span className="esp" />
        {tramo?.acera !== 'ambas' && <span className="chip aviso">Solo acera {tramo?.acera}</span>}
        {sit !== 'con-registros' && <span className="chip azul">{tramo?.etiqueta ?? 'Censar desde cero'}</span>}
      </div>

      <div className="m-tabs">
        <button className={pestana === 'anteriores' ? 'on' : ''} onClick={() => setPestana('anteriores')}>
          Anteriores <span className="num">{revisados}/{previos.length}</span>
        </button>
        <button className={pestana === 'hoy' ? 'on' : ''} onClick={() => setPestana('hoy')}>
          Registrado <span className="num">{obsHoy.length}</span>
        </button>
      </div>

      <div className="m-lista">
        {pestana === 'anteriores' && previos.length === 0 && (
          <div className="m-vacia">
            <Store size={28} />
            <b>Sin locales en el censo anterior</b>
            <span>{SITUACION_TXT[sit]}. Recorre ambas aceras y registra lo que encuentres con «Local nuevo». Si no hay ninguno, finaliza la calle como «sin locales».</span>
          </div>
        )}
        {pestana === 'anteriores' &&
          previos.map((l) => {
            const d = direccionVigente(l);
            const o = porLocal.get(l.id);
            const oc = ocupacionEn(db, l.id, camp.campanaReferenciaId!);
            const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
            const act = rutaActividad(clasificacionEn(db, neg?.id, camp.campanaReferenciaId!)?.actividadId);
            return (
              <div key={l.id} className={`m-local ${o ? 'hecho' : ''}`}>
                <div className="m-local-num">
                  {d.numero ?? 's/n'}
                  {d.sufijo && <small>{d.sufijo}</small>}
                </div>
                <div className="m-local-datos">
                  <b>{neg?.nombre ?? 'Vacío'}</b>
                  <span>{neg ? act[3]?.nombre ?? 'Sin clasificar' : `${oc?.metrosFachada ?? '?'} m de fachada`} · {d.numero && d.numero % 2 === 0 ? 'par' : 'impar'}</span>
                  {o && (
                    <span className={`m-resultado t-${o.tipo}`}>
                      {TIPO_OBS_TXT[o.tipo]}
                      {o.tipo === 'nuevo-negocio' && `: ${o.datos.nombre}`}
                      {o.sync === 'local' && ' · sin sincronizar'}
                    </span>
                  )}
                </div>
                {o ? (
                  <button className="m-icono" onClick={() => setHoja({ tipo: 'acciones', local: l })} aria-label="Cambiar"><PencilLine size={18} /></button>
                ) : (
                  <div className="m-local-acc">
                    <button className="m-ok" onClick={() => accion((x) => confirmarSinCambios(x, ctx(), l.id), `Nº ${d.numero}: sin cambios`)} aria-label="Sin cambios">
                      <Check size={22} />
                    </button>
                    <button className="m-icono" onClick={() => setHoja({ tipo: 'acciones', local: l })} aria-label="Registrar cambios">
                      <PencilLine size={18} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        {pestana === 'hoy' &&
          (obsHoy.length === 0 ? (
            <div className="m-vacia"><span>Todavía no hay registros en esta calle.</span></div>
          ) : (
            obsHoy.map((o) => (
              <div key={o.id} className="m-reg">
                <span className="m-local-num s">{o.datos.numero ?? 's/n'}{o.datos.sufijo ? <small>{o.datos.sufijo}</small> : null}</span>
                <span className="esp">
                  <b>{o.datos.vacio ? `Vacío${o.datos.metrosFachada ? ` · ${o.datos.metrosFachada} m` : ''}` : o.datos.nombre}</b>
                  <span className="m-nota">{TIPO_OBS_TXT[o.tipo]} · {o.fecha ? new Date(o.fecha).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : 'sin fecha'} · {db.personas[o.investigadorId ?? '']?.iniciales}{o.nota ? ` · “${o.nota}”` : ''}</span>
                </span>
                {o.sync === 'local' && <CloudBadge />}
              </div>
            ))
          ))}
      </div>

      <div className="m-pie">
        <button className="m-btn secundario" onClick={() => setHoja({ tipo: 'finalizar' })}>
          <Flag size={18} /> Finalizar calle
        </button>
        <button className="m-btn primario grande" onClick={() => setHoja({ tipo: 'nuevo' })}>
          <Plus size={20} /> Local nuevo
        </button>
      </div>

      {hoja?.tipo === 'nuevo' && (
        <HojaNuevo
          calleNombre={calle.nombre}
          sugerido={siguienteNumero(ultimoNumero) ?? (previos.length ? null : 1)}
          onCerrar={() => setHoja(null)}
          onGuardar={(n, seguir) => {
            let cand = 0;
            const seg = calle.segmentos[0];
            const coord = seg ? (() => { const { p, dir } = puntoEnLinea(seg.coords, Math.random()); return desplazarPerpendicular(p, dir, (n.numero ?? 1) % 2 ? 9 : -9); })() : undefined;
            const ok = aplicar((x) => {
              const r = registrarLocalNuevo(x, ctx(), { calleId: calle.id, ...n, coord });
              cand = r.candidatos;
              return r.db;
            }, 'Local nuevo', { silencioso: true });
            if (ok) avisar(`Guardado nº ${n.numero ?? 's/n'}${n.sufijo ? ' ' + n.sufijo : ''}${cand ? ' · posible correspondencia con un local anterior: se revisará en oficina' : ''}`, 'ok', true);
            if (!seguir) setHoja(null);
            setPestana('hoy');
          }}
        />
      )}
      {hoja?.tipo === 'acciones' && (
        <Hoja titulo={`Nº ${direccionVigente(hoja.local).numero ?? 's/n'} · ¿qué ha cambiado?`} onCerrar={() => setHoja(null)}>
          <div className="m-acciones">
            <BotonAccion icono={<Check />} t="Sin cambios" onClick={() => accion((x) => confirmarSinCambios(x, ctx(), hoja.local.id), 'Sin cambios')} />
            <BotonAccion icono={<PencilLine />} t="Corregir datos" d="Mismo negocio: nombre, metros o número" onClick={() => setHoja({ tipo: 'modificar', local: hoja.local })} />
            <BotonAccion icono={<Ban />} t="Ahora está vacío" onClick={() => setHoja({ tipo: 'vacio', local: hoja.local })} />
            <BotonAccion icono={<Store />} t="Hay otro negocio" d="No hereda los perfiles del anterior" onClick={() => setHoja({ tipo: 'negocio', local: hoja.local })} />
            <BotonAccion icono={<X />} t="No se localiza el local" d="Posible desaparición física (no es un cierre)" onClick={() => setHoja({ tipo: 'nota', local: hoja.local, clase: 'desaparicion' })} />
            <BotonAccion icono={<CircleHelp />} t="Caso dudoso" onClick={() => setHoja({ tipo: 'nota', local: hoja.local, clase: 'dudoso' })} />
            <BotonAccion icono={<AlertTriangle />} t="Comunicar incidencia" onClick={() => setHoja({ tipo: 'nota', local: hoja.local, clase: 'incidencia' })} />
          </div>
        </Hoja>
      )}
      {hoja?.tipo === 'modificar' && (
        <HojaModificar local={hoja.local} onCerrar={() => setHoja(null)} onGuardar={(c) => accion((x) => modificarLocal(x, ctx(), hoja.local.id, c), 'Datos corregidos')} />
      )}
      {hoja?.tipo === 'vacio' && (
        <HojaTexto titulo="Local vacío" etq="Metros de fachada" numerico rapidos={['3', '4', '5', '6', '8', '10', '12']} onCerrar={() => setHoja(null)} onGuardar={(v) => accion((x) => registrarVacio(x, ctx(), hoja.local.id, v ? +v : undefined), 'Registrado como vacío')} />
      )}
      {hoja?.tipo === 'negocio' && (
        <HojaTexto titulo="Nuevo negocio en el local" etq="Nombre del establecimiento" obligatorio onCerrar={() => setHoja(null)} onGuardar={(v) => accion((x) => registrarNuevoNegocio(x, ctx(), hoja.local.id, v), `Nuevo negocio: ${v}`)} />
      )}
      {hoja?.tipo === 'nota' && (
        <HojaTexto
          titulo={hoja.clase === 'desaparicion' ? 'Posible desaparición física' : hoja.clase === 'dudoso' ? 'Caso dudoso' : 'Incidencia'}
          etq="Observación"
          multilinea
          obligatorio={hoja.clase !== 'desaparicion'}
          onCerrar={() => setHoja(null)}
          onGuardar={(v) =>
            accion(
              (x) => (hoja.clase === 'desaparicion' ? marcarPosibleDesaparicion(x, ctx(), hoja.local.id, v || undefined) : marcarDudoso(x, ctx(), hoja.local.id, v, hoja.clase === 'dudoso' ? 'dudoso' : 'incidencia')),
              hoja.clase === 'desaparicion' ? 'Marcado: posible desaparición (pendiente de revisión)' : 'Registrado para revisión',
            )
          }
        />
      )}
      {hoja?.tipo === 'finalizar' && (
        <HojaFinalizar
          calleId={calle.id}
          campanaId={camp.id}
          acera={tramo?.acera ?? 'ambas'}
          previosPendientes={previos.filter((l) => !porLocal.has(l.id))}
          onCerrar={() => setHoja(null)}
          onConfirmar={(o) => {
            const ok = aplicar((x) => finalizarCalle(x, ctx(), calle.id, { ...o, acera: tramo?.acera ?? 'ambas' }), `${calle.nombre}: calle finalizada`);
            if (ok) {
              setHoja(null);
              const pendiente = it.tramos.find((t) => t.calleId !== calle.id && estadoTramo(useStore.getState().db!, it.campanaId, t) === 'pendiente');
              if (pendiente) ir(pendiente.calleId);
              else nav(`/campo/it/${it.id}`);
            }
          }}
          onRevisar={() => {
            setHoja(null);
            setPestana('anteriores');
          }}
        />
      )}
    </div>
  );
}

function CloudBadge() {
  return <span className="chip aviso" title="Guardado en el dispositivo, pendiente de sincronizar (simulación)">en cola</span>;
}

function Hoja({ titulo, children, onCerrar, pie }: { titulo: ReactNode; children: ReactNode; onCerrar: () => void; pie?: ReactNode }) {
  return (
    <div className="m-velo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="m-hoja" role="dialog" aria-modal="true">
        <div className="m-hoja-asa" />
        <div className="m-hoja-cab">
          <b>{titulo}</b>
          <button className="m-atras" onClick={onCerrar} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <div className="m-hoja-cuerpo">{children}</div>
        {pie && <div className="m-hoja-pie">{pie}</div>}
      </div>
    </div>
  );
}

function BotonAccion({ icono, t, d, onClick }: { icono: ReactNode; t: string; d?: string; onClick: () => void }) {
  return (
    <button className="m-accion" onClick={onClick}>
      <span className="m-accion-ic">{icono}</span>
      <span className="esp">
        <b>{t}</b>
        {d && <span className="m-nota">{d}</span>}
      </span>
      <ChevronRight size={16} />
    </button>
  );
}

function HojaNuevo({ calleNombre, sugerido, onCerrar, onGuardar }: {
  calleNombre: string;
  sugerido: number | null;
  onCerrar: () => void;
  onGuardar: (n: { numero: number | null; sufijo?: string; vacio: boolean; nombre?: string; metrosFachada?: number; nota?: string }, seguir: boolean) => void;
}) {
  const [numero, setNumero] = useState<string>(sugerido !== null ? String(sugerido) : '');
  const [sufijo, setSufijo] = useState('');
  const [vacio, setVacio] = useState(false);
  const [nombre, setNombre] = useState('');
  const [metros, setMetros] = useState('');
  const [nota, setNota] = useState('');
  const [verNota, setVerNota] = useState(false);
  const [gps, setGps] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const valido = numero.trim() !== '' && (vacio || nombre.trim() !== '');
  const guardar = (seguir: boolean) => {
    if (!valido) return;
    onGuardar({ numero: numero ? parseInt(numero, 10) : null, sufijo: sufijo || undefined, vacio, nombre: vacio ? undefined : nombre.trim(), metrosFachada: vacio && metros ? +metros : undefined, nota: nota || undefined }, seguir);
    if (seguir) {
      const n = parseInt(numero, 10);
      setNumero(Number.isFinite(n) ? String(n + 2) : '');
      setSufijo('');
      setNombre('');
      setMetros('');
      setNota('');
      setVerNota(false);
      setTimeout(() => ref.current?.focus(), 50);
    }
  };
  const paso = (d: number) => setNumero((v) => String(Math.max(1, (parseInt(v, 10) || 0) + d)));
  return (
    <Hoja
      titulo="Local nuevo"
      onCerrar={onCerrar}
      pie={
        <>
          <button className="m-btn secundario" disabled={!valido} onClick={() => guardar(false)}>Guardar</button>
          <button className="m-btn primario grande" disabled={!valido} onClick={() => guardar(true)}>Guardar y siguiente</button>
        </>
      }
    >
      <div className="m-calle-fija">
        <span className="m-nota">Calle (se recuerda)</span>
        <b>{calleNombre}</b>
      </div>
      <div className="m-numero">
        <button onClick={() => paso(-2)} aria-label="Restar 2"><Minus size={20} /></button>
        <input inputMode="numeric" pattern="[0-9]*" value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))} aria-label="Número" placeholder="nº" />
        <button onClick={() => paso(2)} aria-label="Sumar 2"><Plus size={20} /></button>
        <div className="m-sufijos">
          {['', 'B', 'C', 'dup.'].map((s) => (
            <button key={s || 'n'} className={sufijo === s ? 'on' : ''} onClick={() => setSufijo(s)}>{s || '—'}</button>
          ))}
        </div>
      </div>
      <p className="m-nota" style={{ margin: '-4px 0 8px' }}>±2 mantiene la acera. Usa B/C/dup. si hay varios locales con el mismo número.</p>
      <div className="m-toggle">
        <button className={!vacio ? 'on' : ''} onClick={() => setVacio(false)}><Store size={18} /> Ocupado</button>
        <button className={vacio ? 'on vacio' : ''} onClick={() => setVacio(true)}><Ban size={18} /> Vacío</button>
      </div>
      {!vacio ? (
        <input ref={ref} className="m-input" placeholder="Nombre del establecimiento" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && guardar(true)} />
      ) : (
        <>
          <input className="m-input" inputMode="decimal" placeholder="Metros de fachada" value={metros} onChange={(e) => setMetros(e.target.value.replace(/[^\d.,]/g, '').replace(',', '.'))} />
          <div className="m-rapidos">
            {['3', '4', '5', '6', '8', '10', '12'].map((m) => (
              <button key={m} className={metros === m ? 'on' : ''} onClick={() => setMetros(m)}>{m} m</button>
            ))}
          </div>
        </>
      )}
      <div className="fila" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <button className={`m-chip ${verNota ? 'on' : ''}`} onClick={() => setVerNota(!verNota)}>+ Observación</button>
        <button className={`m-chip ${gps ? 'on' : ''}`} onClick={() => setGps(!gps)} title="Ayuda opcional; en el prototipo la posición es aproximada sobre la calle">
          <LocateFixed size={14} /> {gps ? 'Posición aproximada ✓' : 'Añadir posición'}
        </button>
        <button className="m-chip" disabled title="Fotografía opcional: en estudio">Foto (en estudio)</button>
      </div>
      {verNota && <textarea className="m-input" style={{ height: 70, marginTop: 8 }} placeholder="Incidencia u observación" value={nota} onChange={(e) => setNota(e.target.value)} />}
    </Hoja>
  );
}

function HojaModificar({ local, onCerrar, onGuardar }: { local: LocalFisico; onCerrar: () => void; onGuardar: (c: { nombre?: string; metrosFachada?: number; numero?: number | null; sufijo?: string; nota?: string }) => void }) {
  const db = useStore((s) => s.db!);
  const d = direccionVigente(local);
  const oc = Object.values(db.ocupaciones).find((o) => o.localId === local.id && !o.hastaCampanaId);
  const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
  const [nombre, setNombre] = useState(neg?.nombre ?? '');
  const [numero, setNumero] = useState(String(d.numero ?? ''));
  const [sufijo, setSufijo] = useState(d.sufijo ?? '');
  const [metros, setMetros] = useState(oc?.metrosFachada ? String(oc.metrosFachada) : '');
  const [nota, setNota] = useState('');
  return (
    <Hoja
      titulo="Corregir datos"
      onCerrar={onCerrar}
      pie={
        <button
          className="m-btn primario grande"
          onClick={() =>
            onGuardar({
              nombre: neg && nombre !== neg.nombre ? nombre : undefined,
              metrosFachada: metros && +metros !== oc?.metrosFachada ? +metros : undefined,
              numero: numero !== String(d.numero ?? '') || sufijo !== (d.sufijo ?? '') ? (numero ? +numero : null) : undefined,
              sufijo: sufijo || undefined,
              nota: nota || undefined,
            })
          }
        >
          Guardar cambios
        </button>
      }
    >
      <p className="m-nota">Solo se guarda lo que cambies. Si es otro negocio, usa «Hay otro negocio».</p>
      {neg && (
        <label className="m-campo">Nombre
          <input className="m-input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </label>
      )}
      <div className="fila">
        <label className="m-campo esp">Número
          <input className="m-input" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="m-campo" style={{ width: 90 }}>Sufijo
          <input className="m-input" value={sufijo} onChange={(e) => setSufijo(e.target.value)} />
        </label>
      </div>
      {!neg && (
        <label className="m-campo">Metros de fachada
          <input className="m-input" inputMode="decimal" value={metros} onChange={(e) => setMetros(e.target.value)} />
        </label>
      )}
      <label className="m-campo">Observación
        <input className="m-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional" />
      </label>
    </Hoja>
  );
}

function HojaTexto({ titulo, etq, onCerrar, onGuardar, numerico, rapidos, multilinea, obligatorio }: { titulo: string; etq: string; onCerrar: () => void; onGuardar: (v: string) => void; numerico?: boolean; rapidos?: string[]; multilinea?: boolean; obligatorio?: boolean }) {
  const [v, setV] = useState('');
  return (
    <Hoja titulo={titulo} onCerrar={onCerrar} pie={<button className="m-btn primario grande" disabled={obligatorio && !v.trim()} onClick={() => onGuardar(v.trim())}>Guardar</button>}>
      <label className="m-campo">{etq}
        {multilinea ? (
          <textarea className="m-input" style={{ height: 90 }} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
        ) : (
          <input className="m-input" inputMode={numerico ? 'decimal' : undefined} value={v} onChange={(e) => setV(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && (!obligatorio || v.trim()) && onGuardar(v.trim())} />
        )}
      </label>
      {rapidos && (
        <div className="m-rapidos">
          {rapidos.map((r) => (
            <button key={r} className={v === r ? 'on' : ''} onClick={() => setV(r)}>{r} m</button>
          ))}
        </div>
      )}
    </Hoja>
  );
}

function HojaFinalizar({ calleId, campanaId, acera, previosPendientes, onCerrar, onConfirmar, onRevisar }: {
  calleId: Id;
  campanaId: Id;
  acera: 'ambas' | 'par' | 'impar';
  previosPendientes: LocalFisico[];
  onCerrar: () => void;
  onConfirmar: (o: { par: boolean; impar: boolean; resultado: ResultadoCalle; nota?: string }) => void;
  onRevisar: () => void;
}) {
  const db = useStore((s) => s.db!);
  const r = resumenCalle(db, campanaId, calleId);
  const [par, setPar] = useState(acera === 'impar');
  const [impar, setImpar] = useState(acera === 'par');
  const sugerido: ResultadoCalle = r.activosEstaCampana > 0 ? 'completada-con-locales' : 'completada-sin-locales';
  const [resultado, setResultado] = useState<ResultadoCalle>(sugerido);
  const [nota, setNota] = useState('');
  const v = validarFinalizacion(db, campanaId, calleId, { acera, par, impar, resultado });
  const opciones: { v: ResultadoCalle; t: string; d: string }[] = [
    { v: 'completada-con-locales', t: 'Completada con locales', d: `${r.activosEstaCampana} locales registrados` },
    { v: 'completada-sin-locales', t: 'Completada sin locales', d: 'Recorrida entera: no hay establecimientos' },
    { v: 'parcial-incidencias', t: 'Parcial o con incidencias', d: 'Falta algún tramo, acera o portal' },
  ];
  return (
    <Hoja
      titulo={`Finalizar ${db.calles[calleId]?.nombre}`}
      onCerrar={onCerrar}
      pie={<button className="m-btn primario grande" disabled={!v.ok} onClick={() => onConfirmar({ par, impar, resultado, nota: nota || undefined })}>Confirmar recorrido</button>}
    >
      <div className="m-aceras">
        {acera !== 'impar' && (
          <button className={par ? 'on' : ''} onClick={() => setPar(!par)} aria-pressed={par}>
            <span className="m-check">{par && <Check size={18} />}</span>
            Acera par recorrida
          </button>
        )}
        {acera !== 'par' && (
          <button className={impar ? 'on' : ''} onClick={() => setImpar(!impar)} aria-pressed={impar}>
            <span className="m-check">{impar && <Check size={18} />}</span>
            Acera impar recorrida
          </button>
        )}
      </div>
      <div className="m-opciones">
        {opciones.map((o) => (
          <label key={o.v} className={resultado === o.v ? 'on' : ''}>
            <input type="radio" name="resultado" checked={resultado === o.v} onChange={() => setResultado(o.v)} />
            <span className={`marca-cob ${o.v}`} />
            <span className="esp">
              <b>{o.t}</b>
              <span className="m-nota">{o.d}</span>
            </span>
          </label>
        ))}
      </div>
      {resultado === 'parcial-incidencias' && <input className="m-input" placeholder="¿Qué ha quedado pendiente?" value={nota} onChange={(e) => setNota(e.target.value)} />}
      {previosPendientes.length > 0 && (
        <div className="m-alerta">
          <AlertTriangle size={16} />
          <span className="esp">{previosPendientes.length} local(es) anterior(es) sin revisar: {previosPendientes.slice(0, 4).map((l) => direccionVigente(l).numero).join(', ')}{previosPendientes.length > 4 ? '…' : ''}</span>
          <button className="m-chip" onClick={onRevisar}><Undo2 size={13} /> Revisar</button>
        </div>
      )}
      {!v.ok && <div className="m-error">{v.motivo}</div>}
    </Hoja>
  );
}
