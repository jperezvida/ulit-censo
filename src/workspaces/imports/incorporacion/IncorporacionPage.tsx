import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Database, FlaskConical, Lock, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react';
import { Modal, Sim, fmt } from '../../../components/ui';
import { useStore } from '../../../store/store';
import { planificarIncorporacion, type DecisionesIncorporacion } from '../../../domain/incorporacion';
import { aplicarEscenario, destinoEscenario, ESCENARIOS_DEMO, itemsRevision, prepararEscenario, puedeDecidir, reglasPropuestas, textosDiccionario } from '../../../domain/incorporacionDemo';
import { MUNICIPIO_DEMO, prepararMunicipioDemo, reiniciarEscenarioDemo } from '../../../data/escenarioIncorporacion';
import { RevisionGrupos } from './RevisionGrupos';
import { Decisiones } from './Decisiones';
import { DeshacerIncorporacion } from './DeshacerIncorporacion';
import { ReintentarGuardado } from './ReintentarGuardado';
import { firmaInterpretacion, useAsistente, type Etapa } from './estadoAsistente';
import '../../../styles/datos.css';
import '../../../styles/incorporacion.css';

const ETAPAS: { n: Etapa; t: string; d: string }[] = [
  { n: 1, t: 'Origen y destino', d: 'Qué se incorpora y dónde' },
  { n: 2, t: 'Diagnóstico', d: 'Analizar los datos' },
  { n: 3, t: 'Decisiones', d: 'Resolver lo pendiente' },
  { n: 4, t: 'Confirmación', d: 'Revisar y confirmar' },
  { n: 5, t: 'Resultado', d: 'Incorporado' },
];

const errorTexto = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * C1d · Asistente de incorporación controlada (DEMOSTRACIÓN). Analizar (C1a + C1b) → plan (C1c)
 * → resolver decisiones → confirmar → resultado. Solo admite escenarios ficticios generados por la
 * aplicación: no hay forma de subir un archivo para incorporarlo.
 */
export default function IncorporacionPage() {
  const st = useAsistente();
  const db = useStore((s) => s.db!);
  const nav = useNavigate();
  const puedeIr = (n: Etapa) => n === 1 || (n <= 4 && !!st.preparado && !st.aplicado) || (n === 5 && !!st.aplicado);

  /** Recalcula: reinterpreta si cambian reglas o diccionario; si no, solo replanifica (instantáneo). */
  const recalcular = async (decisiones: DecisionesIncorporacion = st.decisiones, forzar = false) => {
    const firma = firmaInterpretacion(decisiones);
    if (!forzar && st.preparado && firma === st.interpretadoCon) {
      try {
        const plan = planificarIncorporacion(db, st.preparado.resultado, destinoEscenario(st.escenarioId, st.anio, st.nombre), decisiones);
        st.set({ decisiones, preparado: { ...st.preparado, plan }, error: null });
      } catch (e) {
        st.set({ decisiones, error: errorTexto(e) });
      }
      return;
    }
    st.set({ decisiones, cargando: 'Analizando el archivo del escenario (lectura segura e interpretación)…', error: null });
    try {
      const r = await prepararEscenario(db, st.escenarioId, st.anio, decisiones, st.nombre);
      useAsistente.getState().set({ preparado: r, interpretadoCon: firma, cargando: null });
    } catch (e) {
      useAsistente.getState().set({ cargando: null, error: errorTexto(e) });
    }
  };

  return (
    <div className="pagina inc">
      <div className="pagina-cab">
        <div className="esp">
          <div className="rotulo sin-linea">05 · Datos · Incorporación controlada</div>
          <h1>Incorporar un censo histórico <span className="tag naranja">demostración</span></h1>
          <p>Analizar, resolver, confirmar e incorporar, en este orden. En esta fase solo se pueden incorporar <b>escenarios ficticios generados por la aplicación</b>: la incorporación de censos reales no está habilitada.</p>
        </div>
        <button className="btn" onClick={() => nav('/datos')}><Database size={15} /> Volver a Datos</button>
      </div>

      <ol className="inc-pasos" aria-label="Etapas">
        {ETAPAS.map((e) => (
          <li key={e.n} className={`${st.etapa === e.n ? 'on' : ''} ${st.etapa > e.n || (e.n === 5 && st.aplicado) ? 'hecho' : ''}`}>
            <button disabled={!puedeIr(e.n)} onClick={() => st.set({ etapa: e.n })} aria-current={st.etapa === e.n ? 'step' : undefined}>
              <span className="inc-num">{st.etapa > e.n ? <CheckCircle2 size={14} /> : e.n}</span>
              <span><b>{e.t}</b><span className="muted">{e.d}</span></span>
            </button>
          </li>
        ))}
      </ol>

      {st.cargando && <div className="t-info inc-progreso" role="status"><span className="inc-spinner" /> {st.cargando}</div>}
      {st.error && <div className="t-info error" role="alert"><AlertTriangle size={15} /> {st.error}</div>}

      {st.etapa === 1 && <Etapa1 onAnalizar={() => recalcular(st.decisiones, true).then(() => !useAsistente.getState().error && useAsistente.getState().set({ etapa: 2 }))} />}
      {st.etapa === 2 && st.preparado && <Etapa2 />}
      {st.etapa === 3 && st.preparado && <Decisiones resultado={st.preparado.resultado} plan={st.preparado.plan} decisiones={st.decisiones} onCambiar={(d) => recalcular(d)} />}
      {st.etapa === 4 && st.preparado && <Etapa4 recalcular={() => recalcular(st.decisiones, true)} />}
      {st.etapa === 5 && st.aplicado && <Etapa5 />}

      {st.etapa > 1 && st.etapa < 5 && (
        <div className="inc-nav fila">
          <button className="btn" onClick={() => st.set({ etapa: (st.etapa - 1) as Etapa })}><ArrowLeft size={15} /> Anterior</button>
          <span className="esp" />
          {st.etapa < 4 && <button className="btn primario" onClick={() => st.set({ etapa: (st.etapa + 1) as Etapa })}>Siguiente: {ETAPAS[st.etapa].t} <ArrowRight size={15} /></button>}
        </div>
      )}
    </div>
  );
}

function Etapa1({ onAnalizar }: { onAnalizar: () => void }) {
  const st = useAsistente();
  const db = useStore((s) => s.db!);
  const prefs = useStore((s) => s.prefs);
  const aplicarConGuardado = useStore((s) => s.aplicarConGuardado);
  const [reiniciar, setReiniciar] = useState(false);
  /** Operación de la etapa 1 aplicada en memoria pero sin guardar (se reintenta sin repetirla). */
  const [sinGuardar, setSinGuardar] = useState<{ que: 'preparar' | 'reiniciar'; error?: string } | null>(null);
  const [reiniciando, setReiniciando] = useState(false);
  const preparar = async () => {
    const r = await aplicarConGuardado((d) => prepararMunicipioDemo(d), 'Escenario ficticio preparado');
    if (!r.aplicado) st.set({ error: r.error ?? null });
    else if (!r.guardado) setSinGuardar({ que: 'preparar', error: r.error });
  };
  const confirmarReinicio = async () => {
    setReiniciando(true);
    const r = await aplicarConGuardado((d) => reiniciarEscenarioDemo(d), 'Escenario ficticio reiniciado');
    setReiniciando(false);
    if (!r.aplicado) return st.set({ error: r.error ?? null });
    // El asistente ya no puede apuntar a datos eliminados, se haya guardado o no.
    st.reiniciar();
    if (!r.guardado) return setSinGuardar({ que: 'reiniciar', error: r.error });
    setReiniciar(false);
  };
  const esc = ESCENARIOS_DEMO[st.escenarioId];
  const preparado = !!db.municipios[MUNICIPIO_DEMO.id];
  const actuales = Object.values(db.campanas).filter((c) => c.municipioId === MUNICIPIO_DEMO.id);
  const plan = st.preparado?.plan;
  const reimp = plan?.bloqueos.find((b) => b.codigo === 'reimportacion-identica' || b.codigo === 'archivo-distinto');
  const cambiar = (p: Partial<{ anio: number; nombre: string }>) => st.set({ ...p, preparado: null, interpretadoCon: '' });

  return (
    <div className="inc-rejilla">
      <section className="tarjeta inc-bloque">
        <h3>Municipio de destino</h3>
        <select className="input" aria-label="Municipio" value={MUNICIPIO_DEMO.id} onChange={() => undefined}>
          {Object.values(db.municipios).filter((m) => m.id !== MUNICIPIO_DEMO.id).map((m) => <option key={m.id} value={m.id} disabled>{m.nombre} — incorporación real no habilitada</option>)}
          <option value={MUNICIPIO_DEMO.id}>{MUNICIPIO_DEMO.nombre}</option>
        </select>
        <p className="muted">Municipio ficticio y aislado, con las reglas territoriales de Medina (sin Distrito ni Zona; CP 47400) y un callejero de «vías ficticias» sin geometría. No comparte datos con Medina ni con Valladolid.</p>
        {!preparado ? (
          <button className="btn primario" onClick={preparar}><FlaskConical size={15} /> Preparar escenario ficticio</button>
        ) : (
          <div className="fila" style={{ flexWrap: 'wrap' }}>
            <span className="chip ok">Escenario preparado</span>
            <span className="muted esp" style={{ minWidth: 160 }}>{actuales.length} campaña(s) en el municipio ficticio</span>
            <button className="btn s peligro" disabled={!!sinGuardar} onClick={() => setReiniciar(true)}><RotateCcw size={14} /> Reiniciar escenario</button>
          </div>
        )}
        {sinGuardar?.que === 'preparar' && <ReintentarGuardado error={sinGuardar.error} onGuardado={() => setSinGuardar(null)} />}
      </section>

      <section className="tarjeta inc-bloque">
        <h3>Archivo de origen</h3>
        <div className="fila"><b className="esp">{esc.archivo}</b><Sim texto="Ficticio" /></div>
        <p className="muted">{esc.descripcion}</p>
        <dl className="inc-dl">
          <dt>Origen</dt><dd>Generado por la aplicación (no se puede subir un archivo para incorporarlo)</dd>
          <dt>SHA-256</dt><dd className="mono">{plan ? `${plan.archivo.sha256.slice(0, 32)}…` : 'se calcula al analizar'}</dd>
          <dt>Perfil detectado</dt><dd>{plan ? `${plan.perfil.id} · versión ${plan.perfil.version} · hoja «${plan.hoja}»` : 'se detecta al analizar'}</dd>
          <dt>Duplicados</dt><dd>{!plan ? 'se comprueba al analizar' : reimp ? <span className="chip aviso">{reimp.mensaje}</span> : <span className="chip ok">Sin incorporaciones previas de este archivo en este ámbito</span>}</dd>
        </dl>
      </section>

      <section className="tarjeta inc-bloque">
        <h3>Destino: campaña histórica nueva</h3>
        <label className="campo">
          <span>Año histórico</span>
          <select className="input" aria-label="Año histórico" value={st.anio} onChange={(e) => cambiar({ anio: Number(e.target.value) })}>
            {esc.aniosPermitidos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Nombre de la campaña (opcional)</span>
          <input className="input" aria-label="Nombre de la campaña" placeholder={`Censo ${st.anio} · histórico importado`} value={st.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} />
        </label>
        <dl className="inc-dl">
          <dt>Identificador</dt><dd className="mono">{plan?.destino.campanaId ?? 'se asigna al analizar'}</dd>
        </dl>
      </section>

      <section className="tarjeta inc-bloque inc-historico" aria-label="Histórico frente a campaña actual">
        <h3><ShieldCheck size={16} /> Histórico, no campaña actual</h3>
        <ul className="inc-lista">
          <li>Se crea una campaña <b>histórica nueva</b>. No se modifica ninguna campaña existente; en particular, <b>no se toca 2026</b>.</li>
          <li>Los datos de {st.anio} son una <b>referencia</b>: nada queda revisado, verificado ni validado para 2026.</li>
          <li>La franquicia y la presencia digital se guardan como históricas (origen «importado»). La revisión 2026 sigue pendiente.</li>
          <li>Las clasificaciones de {st.anio} se conservan como texto: no se convierten al catálogo 2026.</li>
        </ul>
      </section>

      <div className="inc-nav fila inc-ancho">
        <span className="muted esp">Persona: {db.personas[prefs.personaId]?.nombre}</span>
        <button className="btn primario" disabled={!preparado || !!st.cargando} onClick={onAnalizar}>Analizar el archivo <ArrowRight size={15} /></button>
      </div>

      {reiniciar && (
        <Modal
          titulo="Reiniciar el escenario ficticio"
          onCerrar={() => !sinGuardar && setReiniciar(false)}
          pie={
            sinGuardar?.que === 'reiniciar' ? (
              <span className="muted esp">El escenario se ha eliminado en memoria, pero todavía no está guardado.</span>
            ) : (
              <>
                <button className="btn" onClick={() => setReiniciar(false)}>Cancelar</button>
                <button className="btn peligro" disabled={reiniciando} onClick={confirmarReinicio}>{reiniciando ? 'Reiniciando…' : 'Reiniciar'}</button>
              </>
            )
          }
        >
          {sinGuardar?.que === 'reiniciar' && (
            <ReintentarGuardado error={sinGuardar.error} onGuardado={() => { setSinGuardar(null); setReiniciar(false); st.set({ error: null }); useStore.getState().avisar('Escenario ficticio reiniciado y guardado', 'ok'); }} />
          )}
          <p>Se eliminará <b>todo</b> lo que pertenece al municipio ficticio «{MUNICIPIO_DEMO.nombre}»: su callejero, sus campañas, incorporaciones, registros, locales y negocios. Ningún otro municipio ni campaña se modifica. El historial de Ctrl+Z se vaciará.</p>
        </Modal>
      )}
    </div>
  );
}

function Etapa2() {
  const { preparado, decisiones } = useAsistente();
  const { resultado, plan } = preparado!;
  const items = useMemo(() => itemsRevision(resultado, plan, decisiones), [resultado, plan, decisiones]);
  const cuenta = useMemo(() => {
    const locales = { vacio: 0, ocupado: 0, desconocido: 0 };
    const celdas = { correctas: 0, vacias: 0, pendientes: 0, invalidas: 0 };
    for (const f of resultado.filas) {
      locales[f.local]++;
      for (const c of Object.values(f.celdas)) {
        if (c.estado === 'invalido') celdas.invalidas++;
        else if (c.estado === 'pendiente') celdas.pendientes++;
        else if (c.estado === 'vacio' || c.estado === 'no-aplica') celdas.vacias++;
        else celdas.correctas++;
      }
    }
    const g = { error: 0, aviso: 0, info: 0 };
    for (const i of resultado.incidencias) g[i.gravedad]++;
    return { locales, celdas, g };
  }, [resultado]);
  const sinTerritorio = (plan.correspondencias.porMotivo['calle-sin-correspondencia'] ?? 0) + (plan.correspondencias.porMotivo['calle-ambigua'] ?? 0);
  return (
    <div className="col" style={{ gap: 12 }}>
      <section className="ap-resumen" aria-label="Diagnóstico">
        <div><span className="muted">Filas del archivo</span><b>{fmt(plan.registros.previstos)}</b><span className="muted">todas se conservan</span></div>
        <div><span className="muted">Locales</span><b>{fmt(cuenta.locales.ocupado)} ocupados · {fmt(cuenta.locales.vacio)} vacíos</b><span className="muted">{cuenta.locales.desconocido} sin estado conocido</span></div>
        <div><span className="muted">Celdas</span><b>{fmt(cuenta.celdas.correctas)} válidas</b><span className="muted">{fmt(cuenta.celdas.vacias)} vacías o no aplicables · {cuenta.celdas.pendientes} pendientes · {cuenta.celdas.invalidas} inválidas</span></div>
        <div><span className="muted">Incidencias</span><b>{fmt(resultado.incidencias.length)}</b><span className="muted">{cuenta.g.error} error · {cuenta.g.aviso} aviso · {cuenta.g.info} información</span></div>
        <div><span className="muted">Sin correspondencia territorial</span><b>{fmt(sinTerritorio)}</b><span className="muted">calle no encontrada en el callejero</span></div>
        <div><span className="muted">Posibles filas de totales</span><b>{plan.registros.candidatasExcluir.length}</b><span className="muted">se deciden en la etapa 3</span></div>
      </section>
      {plan.bloqueos.length > 0 && <div className="t-info error" role="alert"><Lock size={15} /> <div><b>Bloqueante:</b> {plan.bloqueos.map((b) => b.mensaje).join(' ')}</div></div>}
      <RevisionGrupos items={items} />
    </div>
  );
}

const ENTIDADES: [keyof ReturnType<typeof nuevas>, string][] = [
  ['campanas', 'Campaña histórica nueva'], ['registros', 'Registros de origen (todas las filas)'], ['locales', 'Locales físicos nuevos'], ['negocios', 'Negocios'],
  ['observaciones', 'Registros históricos (observaciones)'], ['ocupaciones', 'Ocupaciones del año histórico'], ['vinculos', 'Correspondencias registro–local'],
  ['franquicias', 'Franquicias históricas (origen «importado»)'], ['digital', 'Presencia digital histórica (borrador)'], ['clasificaciones', 'Clasificaciones 2026 propuestas, sin confirmar'],
];
const nuevas = () => ({ campanas: 0, registros: 0, locales: 0, negocios: 0, observaciones: 0, ocupaciones: 0, vinculos: 0, franquicias: 0, digital: 0, clasificaciones: 0 });

function Etapa4({ recalcular }: { recalcular: () => Promise<void> }) {
  const st = useAsistente();
  const db = useStore((s) => s.db!);
  const prefs = useStore((s) => s.prefs);
  const aplicarConGuardado = useStore((s) => s.aplicarConGuardado);
  const [ok, setOk] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  // Al entrar en la confirmación, el plan se recalcula sobre la base actual.
  useEffect(() => {
    void recalcular();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { resultado, plan } = st.preparado!;
  const autorizado = puedeDecidir(prefs.roles);
  const existentes = plan.filas.filter((f) => f.ocupacion && !f.localNuevo).length;
  const pendientesInc = resultado.incidencias.filter((i) => !(st.decisiones.exclusiones ?? []).some((e) => e.fila === i.fila)).length;

  const incorporar = async () => {
    setAplicando(true);
    st.set({ error: null });
    try {
      const base = useStore.getState().db!;
      const r = await aplicarEscenario(base, st.escenarioId, st.anio, resultado, st.decisiones, plan, prefs.personaId, st.nombre);
      const g = await aplicarConGuardado((actual) => {
        if (actual !== base) throw new Error('Los datos han cambiado mientras se preparaba la incorporación: vuelve a calcular el plan.');
        return r.db;
      }, `Censo histórico incorporado: ${plan.archivo.nombre}`);
      if (!g.aplicado) throw new Error(g.error ?? 'No se ha aplicado nada.');
      st.set({
        etapa: 5, aplicado: {
          importacionId: r.importacionId, campanaId: r.campanaId, creadas: r.creadas, guardado: g.guardado, errorGuardado: g.error,
          pendientes: { ambiguas: plan.correspondencias.ambigua, sinVinculo: plan.correspondencias['sin-vinculo'], incidencias: pendientesInc },
        },
      });
    } catch (e) {
      st.set({ error: `No se ha incorporado nada. ${errorTexto(e)}` });
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="inc-rejilla">
      <section className="tarjeta inc-bloque" aria-label="Entidades que se crearán">
        <h3>Se crearía</h3>
        <table className="tabla ap-tabla">
          <tbody>{ENTIDADES.map(([k, t]) => <tr key={k}><td>{t}</td><td className="num">{fmt(plan.nuevas[k])}</td></tr>)}</tbody>
        </table>
        <p className="muted">Destino: <b>{plan.destino.nombre}</b> ({plan.municipio.nombre}, {plan.destino.anio}).</p>
      </section>
      <section className="tarjeta inc-bloque" aria-label="Cambios en datos existentes">
        <h3>Cambios sobre datos existentes</h3>
        <p><b>Ninguna entidad existente se modifica.</b></p>
        {existentes > 0 && <p className="muted">{existentes} ocupación(es) histórica(s) nueva(s) en locales que ya existían, por decisión registrada.</p>}
        <h3 style={{ marginTop: 12 }}>Quedará pendiente</h3>
        <ul className="inc-lista">
          <li>{fmt(pendientesInc)} incidencia(s) conservadas con su registro de origen.</li>
          <li>{plan.correspondencias.ambigua} correspondencia(s) ambigua(s) sin local y {plan.correspondencias['sin-vinculo']} registro(s) sin vínculo.</li>
          {reglasPropuestas(resultado).filter((r) => !(st.decisiones.reglasAutorizadas ?? []).some((x) => x.regla === r.regla)).map((r) => <li key={r.regla}>Sin autorizar por la Cátedra: {r.descripcion} ({r.celdas.length} celda(s)).</li>)}
          {textosDiccionario(resultado).filter((t) => !(st.decisiones.diccionarioAprobado ?? []).some((x) => x.texto.toLowerCase() === t.texto.toLowerCase())).map((t) => <li key={t.texto}>Sin aprobar por la Cátedra: «{t.texto}» como «sin información» ({t.celdas.length} celda(s)).</li>)}
          <li>Las clasificaciones de {plan.destino.anio} sin equivalencia se conservan como texto histórico.</li>
        </ul>
      </section>
      <section className="tarjeta inc-bloque inc-ancho" aria-label="Confirmación">
        {plan.bloqueos.length > 0 ? (
          <div className="t-info error" role="alert"><Lock size={15} /> <div><b>No se puede incorporar:</b><ul className="inc-lista">{plan.bloqueos.flatMap((b) => [b.mensaje, ...b.detalles]).map((x) => <li key={x}>{x}</li>)}</ul></div></div>
        ) : (
          <>
            <p className="muted">Firma del plan: <span className="mono">{plan.firma.slice(0, 24)}…</span>. Al incorporar, se recalcula el plan y se comprueba que la firma coincide; si algo ha cambiado, no se aplica nada.</p>
            <p>Confirma: <b>{db.personas[prefs.personaId]?.nombre}</b> · {new Date().toLocaleDateString('es-ES')}</p>
            {!autorizado && <div className="t-info aviso">Confirmar la incorporación requiere el rol de coordinación o administración.</div>}
            <label className="fila inc-confirmar">
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} aria-label="Confirmo la incorporación" />
              <span>He revisado el plan. Entiendo que se creará una campaña <b>histórica</b> nueva, que nada quedará verificado para 2026 y que el historial de Ctrl+Z se vaciará (la incorporación se revierte con «Deshacer la incorporación»).</span>
            </label>
            <div className="fila">
              <span className="esp" />
              <button className="btn primario" disabled={!ok || !autorizado || aplicando || !!st.cargando} onClick={incorporar}>
                <CheckCircle2 size={15} /> {aplicando ? 'Incorporando…' : 'Incorporar al modelo'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Etapa5() {
  const st = useAsistente();
  const db = useStore((s) => s.db!);
  const setPrefs = useStore((s) => s.setPrefs);
  const nav = useNavigate();
  const [deshacer, setDeshacer] = useState(false);
  const a = st.aplicado!;
  const guardadoOk = () => st.set({ aplicado: { ...a, guardado: true, errorGuardado: undefined } });
  const imp = db.importaciones[a.importacionId];
  const deshecha = imp?.estado === 'descartada';
  return (
    <div className="inc-rejilla">
      <section className="tarjeta inc-bloque inc-ancho" aria-label="Resultado">
        {deshecha ? <div className="t-info aviso"><Undo2 size={15} /> Esta incorporación se ha deshecho. Su registro se conserva en Datos como «deshecha».</div> : <div className="t-info ok"><CheckCircle2 size={15} /> Incorporación aplicada como una única operación.</div>}
        {!a.guardado && <ReintentarGuardado error={a.errorGuardado} onGuardado={guardadoOk} />}
        {a.guardado && !deshecha && <p className="muted"><ShieldCheck size={13} /> Guardado en el almacenamiento de este navegador.</p>}
        <div className="ap-resumen">
          <div><span className="muted">Registros incorporados</span><b>{fmt(a.creadas.registros)}</b><span className="muted">todas las filas, con su original</span></div>
          <div><span className="muted">Locales creados</span><b>{fmt(a.creadas.locales)}</b><span className="muted">solo con dirección inequívoca o decisión</span></div>
          <div><span className="muted">Negocios creados</span><b>{fmt(a.creadas.negocios)}</b><span className="muted">nombre literal, sin cadena</span></div>
          <div><span className="muted">Correspondencias pendientes</span><b>{fmt(a.pendientes.ambiguas + a.pendientes.sinVinculo)}</b><span className="muted">{a.pendientes.ambiguas} ambiguas · {a.pendientes.sinVinculo} sin vínculo</span></div>
          <div><span className="muted">Incidencias conservadas</span><b>{fmt(a.pendientes.incidencias)}</b><span className="muted">en los registros de origen</span></div>
        </div>
        <dl className="inc-dl">
          <dt>Identificador de la importación</dt><dd className="mono">{a.importacionId}</dd>
          <dt>Campaña histórica</dt><dd>{db.campanas[a.campanaId]?.nombre ?? '—'} <span className="mono muted">{a.campanaId}</span></dd>
        </dl>
        <div className="fila" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => { setPrefs({ municipioId: MUNICIPIO_DEMO.id, campanaId: a.campanaId }); nav('/datos'); }}><Database size={15} /> Ver en el historial de Datos</button>
          {!deshecha && <button className="btn peligro" disabled={!a.guardado} title={a.guardado ? undefined : 'Guarda primero la incorporación'} onClick={() => setDeshacer(true)}><Undo2 size={15} /> Deshacer la incorporación…</button>}
          <span className="esp" />
          <button className="btn primario" onClick={() => st.reiniciar()}>Nueva demostración</button>
        </div>
      </section>
      {deshacer && <DeshacerIncorporacion importacionId={a.importacionId} onCerrar={() => setDeshacer(false)} />}
    </div>
  );
}
