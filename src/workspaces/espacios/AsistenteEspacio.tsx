import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Lock, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import { fmt } from '../../components/ui';
import { useEspacios, requisitosIncorporacion, CONFIRMACION_REAL_HABILITADA } from '../../store/espacios';
import { prepararIncorporacion } from '../../domain/incorporacionXlsx';
import { periodoDe, planificarIncorporacion, type DecisionesIncorporacion, type DestinoIncorporacion } from '../../domain/incorporacion';
import { itemsRevision, MOTIVO_TXT, previsualizarDeshacer } from '../../domain/incorporacionDemo';
import { conciliacionCalles, diagnosticoAgregado, ESTADO_CALLE_TXT, recuentoRegistros, senales, type EstadoCalle } from '../../domain/c1e';
import { municipioDeEspacio, personaEspacio, SHA256_ORIGINAL_MEDINA_2025, type TipoEspacio } from '../../domain/espacios';
import { esArchivoSintetico } from '../../data/xlsxSinteticoC1e';
import { RevisionGrupos } from '../imports/incorporacion/RevisionGrupos';
import { Decisiones } from '../imports/incorporacion/Decisiones';
import { ContextoIncorporacion } from '../imports/incorporacion/contextoIncorporacion';
import { firmaInterpretacion, hoy } from '../imports/incorporacion/estadoAsistente';
import { useAsistenteEspacio, useSeleccionEspacio, type EtapaEspacio } from './estadoAsistenteEspacio';
import { campanasDestino, campanasOperativas, destinoElegido, FormCampana } from './MunicipiosCampanas';
import { crearItinerario, itinerariosDe } from '../../domain/campanaOperativa';
import { callejeroDe } from '../../domain/municipios';
import { leerBytes } from './leerArchivo';
import { PasoColumnas } from './PasoColumnas';
import type { BaseDatos } from '../../domain/db';

const ETAPAS: { n: EtapaEspacio; t: string; d: string }[] = [
  { n: 1, t: 'Destino y archivo', d: 'Dónde y qué Excel' },
  { n: 2, t: 'Columnas', d: 'Cómo se lee' },
  { n: 3, t: 'Diagnóstico', d: 'Recuentos y avisos' },
  { n: 4, t: 'Decisiones', d: 'Resolver lo pendiente' },
  { n: 5, t: 'Vista previa', d: 'Revisar y confirmar' },
  { n: 6, t: 'Resultado', d: 'Incorporado' },
];

const errorTexto = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mb = (n: number) => `${(n / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 2 })} MB`;

async function sha256(bytes: Uint8Array): Promise<string> {
  const h = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** ¿Es el censo histórico 2025 de Medina del Campo (el caso de la solicitud C1e)? */
const esCasoC1e = (tipo: TipoEspacio, d: DestinoIncorporacion | null) => !!d && d.municipioId === municipioDeEspacio(tipo) && d.anio === 2025;

/**
 * Decisión de periodo de trabajo de campo. Para Medina 2025 es la autorizada en la solicitud C1e
 * (fechas de 2024 en el censo 2025); para otro destino la toma, si la marca, la persona responsable.
 */
const periodoPropuesto = (db: BaseDatos, tipo: TipoEspacio, d: DestinoIncorporacion, desde?: string): DecisionesIncorporacion['periodoTrabajo'] => ({
  porId: personaEspacio(db)?.id ?? '', fecha: hoy(), desde: desde ?? (esCasoC1e(tipo, d) ? '2024-01-01' : `${d.anio}-01-01`), hasta: `${d.anio}-12-31`,
  motivo: esCasoC1e(tipo, d)
    ? 'Autorizado por la Cátedra en la solicitud C1e (23-10-2026): el censo 2025 incluye visitas de 2024; se conservan las fechas originales.'
    : `Decisión de ${personaEspacio(db)?.nombre ?? 'la persona responsable'}: el trabajo de campo del censo ${d.anio} empezó antes del año natural; se conservan las fechas originales.`,
});

/** G2 · Destino del asistente: municipio y campaña histórica elegidos (o null si no hay ninguna disponible). */
function useDestino(tipo: TipoEspacio): DestinoIncorporacion | null {
  const db = useEspacios((s) => s.db!);
  const sel = useSeleccionEspacio();
  return useMemo(() => {
    const { municipioId, campana, itinerario } = destinoElegido(db, tipo, sel);
    if (sel.modo === 'operativo') return municipioId && campana && itinerario ? { municipioId, anio: campana.anio, nombre: campana.nombre, campanaId: campana.id, itinerarioId: itinerario.id } : null;
    return municipioId && campana ? { municipioId, anio: campana.anio, nombre: campana.nombre, campanaId: campana.id } : null;
  }, [db, tipo, sel]);
}

/**
 * C1e · Asistente de incorporación en un espacio aislado. Reutiliza C1a (lectura segura), C1b
 * (interpretación), C1c (plan, aplicación atómica, deshacer) y las decisiones de C1d. El archivo se
 * elige y se procesa en ESTE navegador: no se sube a ningún servidor.
 */
export function AsistenteEspacio({ tipo }: { tipo: TipoEspacio }) {
  const st = useAsistenteEspacio();
  const db = useEspacios((s) => s.db!);
  const persona = personaEspacio(db);
  const elegido = useDestino(tipo);
  const destino = useMemo<DestinoIncorporacion>(() => elegido ?? { municipioId: '', anio: 0 }, [elegido]);
  const autorizado = !!persona && (persona.roles.includes('coordinador') || persona.roles.includes('administrador'));
  const puedeIr = (n: EtapaEspacio) => n === 1 || (n === 2 && !!st.archivo && !!elegido && !st.aplicado) || (n <= 5 && !!st.preparado && !st.aplicado) || (n === 6 && !!st.aplicado);

  const recalcular = async (decisiones: DecisionesIncorporacion = st.decisiones, forzar = false, lectura = st.lectura) => {
    const firma = `${destino.campanaId}|${destino.itinerarioId ?? ''}|${firmaInterpretacion(decisiones)}|${lectura ? JSON.stringify([lectura.perfil.id, lectura.perfil.version, lectura.perfil.columnas, lectura.hoja, lectura.filaCabecera]) : ''}`;
    if (!forzar && st.preparado && firma === st.interpretadoCon) {
      try {
        st.set({ decisiones, preparado: { ...st.preparado, plan: planificarIncorporacion(useEspacios.getState().db!, st.preparado.resultado, destino, decisiones) }, error: null, revisada: false });
      } catch (e) {
        st.set({ decisiones, error: errorTexto(e) });
      }
      return;
    }
    if (!st.archivo) return st.set({ error: 'Seleccione primero el archivo.' });
    st.set({ decisiones, cargando: 'Leyendo e interpretando el archivo en este navegador (lectura segura C1a + interpretación C1b)…', error: null, revisada: false });
    try {
      const r = await prepararIncorporacion(useEspacios.getState().db!, st.archivo.bytes, st.archivo.nombre, destino, decisiones, lectura ? { perfil: lectura.perfil, hoja: lectura.hoja, filaCabecera: lectura.filaCabecera } : {});
      useAsistenteEspacio.getState().set({ preparado: r, interpretadoCon: firma, cargando: null });
    } catch (e) {
      useAsistenteEspacio.getState().set({ cargando: null, preparado: null, error: errorTexto(e) });
    }
  };

  return (
    <ContextoIncorporacion.Provider value={{ db, personaId: persona?.id ?? '', autorizado, destino }}>
      <div className="col" style={{ gap: 12 }}>
        <ol className="inc-pasos" aria-label="Etapas">
          {ETAPAS.map((e) => (
            <li key={e.n} className={`${st.etapa === e.n ? 'on' : ''} ${st.etapa > e.n ? 'hecho' : ''}`}>
              <button disabled={!puedeIr(e.n)} onClick={() => st.set({ etapa: e.n })} aria-current={st.etapa === e.n ? 'step' : undefined}>
                <span className="inc-num">{st.etapa > e.n ? <CheckCircle2 size={14} /> : e.n}</span>
                <span><b>{e.t}</b><span className="muted">{e.d}</span></span>
              </button>
            </li>
          ))}
        </ol>
        {st.cargando && <div className="t-info inc-progreso" role="status"><span className="inc-spinner" /> {st.cargando}</div>}
        {st.error && <div className="t-info error" role="alert"><AlertTriangle size={15} /> {st.error}</div>}

        {st.etapa === 1 && <EtapaArchivo tipo={tipo} destino={elegido} onAnalizar={() => st.set({ etapa: 2, error: null })} />}
        {st.etapa === 2 && st.archivo && <PasoColumnas onContinuar={async (lectura) => {
          useAsistenteEspacio.getState().set({ lectura });
          await recalcular(useAsistenteEspacio.getState().decisiones, true, lectura);
          if (!useAsistenteEspacio.getState().error) useAsistenteEspacio.getState().set({ etapa: 3 });
        }} />}
        {st.etapa === 3 && st.preparado && <EtapaDiagnostico destino={destino} />}
        {st.etapa === 4 && st.preparado && <Decisiones resultado={st.preparado.resultado} plan={st.preparado.plan} decisiones={st.decisiones} onCambiar={(d) => recalcular(d)} />}
        {st.etapa === 5 && st.preparado && <EtapaVistaPrevia tipo={tipo} destino={destino} />}
        {st.etapa === 6 && st.aplicado && <EtapaResultado />}

        {st.etapa > 2 && st.etapa < 6 && (
          <div className="inc-nav fila">
            <button className="btn" onClick={() => st.set({ etapa: (st.etapa - 1) as EtapaEspacio })}><ArrowLeft size={15} /> Anterior</button>
            <span className="esp" />
            {st.etapa < 5 && <button className="btn primario" onClick={() => st.set({ etapa: (st.etapa + 1) as EtapaEspacio })}>Siguiente: {ETAPAS[st.etapa].t} <ArrowRight size={15} /></button>}
          </div>
        )}
      </div>
    </ContextoIncorporacion.Provider>
  );
}

function EtapaArchivo({ tipo, destino, onAnalizar }: { tipo: TipoEspacio; destino: DestinoIncorporacion | null; onAnalizar: () => void }) {
  const st = useAsistenteEspacio();
  const db = useEspacios((s) => s.db!);
  const a = st.archivo;
  const p = st.decisiones.periodoTrabajo;
  const elegir = async (f?: File) => {
    st.reiniciar();
    if (!f) return;
    useAsistenteEspacio.getState().set({ cargando: 'Calculando la huella SHA-256 en este navegador…', decisiones: { periodoTrabajo: destino && esCasoC1e(tipo, destino) ? periodoPropuesto(db, tipo, destino) : undefined } });
    try {
      const bytes = await leerBytes(f);
      useAsistenteEspacio.getState().set({ archivo: { nombre: f.name, tamano: f.size, sha256: await sha256(bytes), sintetico: esArchivoSintetico(bytes), bytes }, cargando: null });
    } catch (e) {
      useAsistenteEspacio.getState().set({ cargando: null, error: `No se ha podido leer el archivo: ${errorTexto(e)}` });
    }
  };
  const bloqueo = !a ? null
    : tipo === 'real' && a.sintetico ? 'Este archivo lo ha generado la aplicación (sintético o ficticio): no se admite en el espacio de datos reales. Úselo en el espacio de ensayo.'
    : tipo === 'ensayo' && a.sha256 === SHA256_ORIGINAL_MEDINA_2025 ? 'Este es el archivo AUTÉNTICO del censo (su SHA-256 coincide con el del diagnóstico agregado): no se usa en el ensayo. Use el espacio de datos reales.'
    : null;
  return (
    <div className="inc-rejilla">
      <Destino tipo={tipo} destino={destino} />
      <section className="tarjeta inc-bloque" aria-label="Archivo de origen">
        <h3><FileSpreadsheet size={16} /> 2. Archivo de origen</h3>
        <label className="campo">
          <span>Seleccione el XLSX {tipo === 'real' ? 'auténtico del censo' : 'sintético de ensayo'}</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Archivo XLSX del censo" onChange={(e) => void elegir(e.target.files?.[0])} />
        </label>
        <p className="muted">El archivo se lee y se procesa <b>en este navegador</b>: no se sube a ningún servidor. Sus bytes solo se mantienen en memoria mientras dure esta sesión y nunca se guardan.</p>
        {a && (
          <dl className="inc-dl" aria-label="Identificación del archivo">
            <dt>Archivo</dt><dd>{a.nombre}</dd>
            <dt>Tamaño</dt><dd>{mb(a.tamano)}</dd>
            <dt>SHA-256</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{a.sha256}</dd>
            <dt>Diagnóstico agregado</dt>
            <dd>{a.sha256 === SHA256_ORIGINAL_MEDINA_2025 ? <span className="chip ok">Coincide con la huella del archivo auténtico</span> : <span className="chip aviso">No coincide con la huella del archivo auténtico</span>}</dd>
            <dt>Marca de sintético</dt><dd>{a.sintetico ? <span className="chip sim">Archivo SINTÉTICO</span> : 'No'}</dd>
          </dl>
        )}
        {bloqueo && <div className="t-info error" role="alert"><XCircle size={15} /> {bloqueo}</div>}
      </section>

      {destino && (
        <section className="tarjeta inc-bloque" aria-label="Qué se hará">
          <h3>Qué se hará</h3>
          {destino.itinerarioId ? (
            <ul className="inc-lista">
              <li>Se incorpora como itinerario <b>{db.itinerarios[destino.itinerarioId]?.codigo}</b> de la campaña operativa <b>«{destino.nombre}»</b> ({destino.anio}) de <b>{db.municipios[destino.municipioId]?.nombre}</b>. No se crea ninguna campaña y la campaña no se modifica.</li>
              <li>Lo incorporado por <b>otros itinerarios se conserva</b>. Si una fila coincide con ellos (posible duplicado o contradicción), se señala y queda para la conciliación: nada se fusiona solo.</li>
              <li>Cada fila conserva su archivo, su número de fila, su itinerario y su fecha real. Varios establecimientos en el mismo portal son <b>locales independientes</b>.</li>
            </ul>
          ) : (
            <ul className="inc-lista">
              <li>Se incorpora en la campaña histórica <b>«{destino.nombre}»</b> ({destino.anio}) de <b>{db.municipios[destino.municipioId]?.nombre}</b>. No se toca la demostración, el otro espacio ni otros municipios.</li>
              <li><b>Ninguna campaña operativa se modifica</b> (en Medina del Campo, 2026 sigue intacta).</li>
              <li>Clasificaciones, franquicias, Google, redes y comercio electrónico se conservan como <b>históricos</b>.</li>
              <li>Cada fila conserva sus valores originales. Varios establecimientos en el mismo portal son <b>locales independientes</b>.</li>
            </ul>
          )}
          <label className="fila" style={{ alignItems: 'flex-start', gap: 8 }}>
            <input type="checkbox" aria-label="Aplicar el periodo de trabajo de campo" checked={!!p} onChange={(e) => st.set({ decisiones: { ...st.decisiones, periodoTrabajo: e.target.checked ? periodoPropuesto(db, tipo, destino) : undefined }, preparado: null })} />
            <span><b>Periodo de trabajo de campo:</b> del <input className="input" style={{ width: 140, display: 'inline-block' }} type="date" aria-label="Inicio del periodo" value={p?.desde ?? periodoPropuesto(db, tipo, destino)!.desde} disabled={!p} onChange={(e) => st.set({ decisiones: { ...st.decisiones, periodoTrabajo: periodoPropuesto(db, tipo, destino, e.target.value) }, preparado: null })} /> al {destino.anio}-12-31.
              <span className="muted"> Marque esta opción si el censo incluye visitas anteriores a {destino.anio}: se conservan sus fechas originales. Decisión trazada: {personaEspacio(db)?.nombre}, {hoy()}.</span></span>
          </label>
        </section>
      )}

      <div className="inc-nav fila inc-ancho">
        <span className="muted esp">Persona: {personaEspacio(db)?.nombre}</span>
        <button className="btn primario" disabled={!destino || !a || !!bloqueo || !!st.cargando} onClick={onAnalizar}>Siguiente: columnas <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}

/** G2 · Paso 1: municipio y campaña histórica de destino, ANTES de elegir el archivo. */
function Destino({ tipo, destino }: { tipo: TipoEspacio; destino: DestinoIncorporacion | null }) {
  const db = useEspacios((s) => s.db!);
  const soloMemoria = useEspacios((s) => s.soloMemoria);
  const sel = useSeleccionEspacio();
  const st = useAsistenteEspacio();
  const [nueva, setNueva] = useState(false);
  const { municipioId, campana: campOp, itinerario } = destinoElegido(db, tipo, sel);
  const opciones = municipioId ? campanasDestino(db, municipioId) : [];
  const operativas = municipioId ? campanasOperativas(db, municipioId) : [];
  const its = sel.modo === 'operativo' && campOp ? itinerariosDe(db, campOp.id) : [];
  const cj = municipioId ? callejeroDe(db, municipioId) : null;
  const modificar = useEspacios((s) => s.modificar);
  const [codigo, setCodigo] = useState('');
  const [errorIt, setErrorIt] = useState<string | null>(null);
  const cambiar = (p: { modo?: 'historico' | 'operativo'; municipioId?: string; campanaId?: string | null; itinerarioId?: string | null }) => {
    sel.elegir(p);
    // Otro destino: hay que volver a analizar; el periodo propuesto depende del destino.
    const d = destinoElegido(db, tipo, { ...useSeleccionEspacio.getState() });
    const nuevo = d.municipioId && d.campana && useSeleccionEspacio.getState().modo === 'historico' ? { municipioId: d.municipioId, anio: d.campana.anio, campanaId: d.campana.id } : null;
    st.set({ preparado: null, decisiones: { ...st.decisiones, periodoTrabajo: nuevo && esCasoC1e(tipo, nuevo) ? periodoPropuesto(db, tipo, nuevo) : undefined } });
  };
  return (
    <section className="tarjeta inc-bloque" aria-label="Destino">
      <h3>1. Destino</h3>
      {!soloMemoria && (
        <div className="segmentado" role="radiogroup" aria-label="Qué se incorpora">
          <button role="radio" aria-checked={sel.modo === 'historico'} className={sel.modo === 'historico' ? 'on' : ''} onClick={() => cambiar({ modo: 'historico', campanaId: null, itinerarioId: null })}>Censo histórico</button>
          <button role="radio" aria-checked={sel.modo === 'operativo'} className={sel.modo === 'operativo' ? 'on' : ''} onClick={() => cambiar({ modo: 'operativo', campanaId: null, itinerarioId: null })}>Itinerario de una campaña operativa</button>
        </div>
      )}
      <div className="destino-ctrl">
        <label className="campo">
          <span>Municipio</span>
          <select className="input" aria-label="Municipio de destino" value={municipioId ?? ''} disabled={soloMemoria} onChange={(e) => cambiar({ municipioId: e.target.value, campanaId: null })}>
            {Object.values(db.municipios).map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.provincia})</option>)}
          </select>
        </label>
        {sel.modo === 'operativo' ? (
          <>
            <label className="campo">
              <span>Campaña operativa</span>
              <select className="input" aria-label="Campaña de destino" value={campOp?.id ?? ''} disabled={!operativas.length} onChange={(e) => cambiar({ campanaId: e.target.value, itinerarioId: null })}>
                {!campOp && <option value="">— No hay ninguna campaña operativa —</option>}
                {operativas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.anio})</option>)}
              </select>
            </label>
            <label className="campo">
              <span>Itinerario</span>
              <select className="input" aria-label="Itinerario de destino" value={itinerario?.id ?? ''} disabled={!its.length} onChange={(e) => cambiar({ itinerarioId: e.target.value })}>
                {!itinerario && <option value="">— La campaña no tiene itinerarios —</option>}
                {its.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.nombre}</option>)}
              </select>
            </label>
          </>
        ) : (
          <label className="campo">
            <span>Campaña histórica</span>
            <select className="input" aria-label="Campaña de destino" value={destino?.campanaId ?? ''} disabled={!opciones.length} onChange={(e) => cambiar({ campanaId: e.target.value })}>
              {!destino && <option value="">— No hay ninguna campaña histórica vacía —</option>}
              {opciones.map(({ c, motivo }) => <option key={c.id} value={c.id} disabled={!!motivo}>{c.nombre} ({c.anio}){motivo ? ' · ya tiene datos' : ''}</option>)}
            </select>
          </label>
        )}
      </div>
      {sel.modo === 'operativo' && campOp && !soloMemoria && (
        <div className="fila cj-fila-acc">
          <input className="input" aria-label="Código del nuevo itinerario" placeholder="Nuevo itinerario, p. ej. IT1" value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          <button className="btn s" disabled={!codigo.trim()} onClick={async () => {
            let creado = '';
            const r = await modificar('Creando el itinerario…', (x, ctx) => { const c = crearItinerario(x, campOp.id, { codigo }, ctx); creado = c.itinerarioId; return c.db; });
            setErrorIt(r.ok ? null : r.error ?? null);
            if (r.ok) { setCodigo(''); cambiar({ itinerarioId: creado }); }
          }}>Añadir itinerario</button>
        </div>
      )}
      {errorIt && <div className="t-info error" role="alert">{errorIt}</div>}
      {sel.modo === 'operativo' && !campOp && <p className="muted" style={{ margin: 0 }}>Cree primero la campaña operativa en «Campañas» (tipo «Operativa»).</p>}
      {cj && (cj.disponible
        ? <p className="muted" style={{ margin: 0 }}>Callejero: {cj.texto}.</p>
        : <div className="t-info aviso" role="note"><AlertTriangle size={15} /> <div><b>Este municipio no tiene callejero todavía.</b> Los registros se incorporan y se conservan, pero sin vínculo con calles ni locales: la conciliación territorial queda pendiente.</div></div>)}
      {municipioId && !soloMemoria && sel.modo === 'historico' && (nueva
        ? <FormCampana municipioId={municipioId} soloHistorica onCerrar={(id) => { setNueva(false); if (id) cambiar({ municipioId, campanaId: id }); }} />
        : <button className="btn s" style={{ alignSelf: 'flex-start' }} onClick={() => setNueva(true)}>Crear una campaña histórica</button>)}
      {!destino && !nueva && sel.modo === 'historico' && <p className="muted" style={{ margin: 0 }}>Cree primero la campaña histórica en la que se incorporará el Excel (por ejemplo, «Censo 2023 · histórico»).</p>}
    </section>
  );
}

function EtapaDiagnostico({ destino }: { destino: DestinoIncorporacion }) {
  const { preparado, decisiones, lectura } = useAsistenteEspacio();
  const db = useEspacios((s) => s.db!);
  const { resultado, plan } = preparado!;
  const ref = lectura?.referencia;
  const diag = useMemo(() => diagnosticoAgregado(resultado, ref), [resultado, ref]);
  const calles = useMemo(() => conciliacionCalles(db, resultado, destino.municipioId, decisiones), [db, resultado, destino.municipioId, decisiones]);
  const cj = callejeroDe(db, destino.municipioId);
  const sen = useMemo(() => senales(resultado), [resultado]);
  const items = useMemo(() => itemsRevision(resultado, plan, decisiones), [resultado, plan, decisiones]);
  const [verCalles, setVerCalles] = useState<EstadoCalle | null>('pendiente');
  return (
    <div className="col" style={{ gap: 12 }}>
      <section className="tarjeta inc-bloque" aria-label="Diagnóstico agregado">
        <h3>{ref ? 'Diagnóstico frente al informe de referencia' : 'Diagnóstico del archivo'}</h3>
        <p className="muted">Recuentos sobre los valores ORIGINALES del archivo, sin depurar. Hojas: {diag.hojas.map((h) => `«${h.nombre}» (${h.rol}${h.usada ? ', origen de los registros' : ', no se importa'})`).join(' · ')}. Perfil: {lectura?.perfil.nombre ?? '—'}.</p>
        {!ref
          ? <p className="muted" style={{ margin: 0 }}>Sin informe de referencia con el que comparar: se muestran los recuentos del archivo.</p>
          : diag.diferencias.length === 0
            ? <div className="t-info ok"><CheckCircle2 size={15} /> Los {diag.indicadores.filter((i) => i.esperado !== undefined).length} indicadores coinciden con el informe de referencia.</div>
            : <div className="t-info aviso" role="alert"><AlertTriangle size={15} /> {diag.diferencias.length} indicador(es) no coinciden con el informe de referencia: revíselos antes de continuar.</div>}
        <div className="tabla-scroll">
          <table className="tabla ap-tabla" aria-label="Indicadores del archivo">
            <thead><tr><th>Indicador</th><th className="num">Archivo</th>{ref && <><th className="num">Informe</th><th /></>}</tr></thead>
            <tbody>{diag.indicadores.map((i) => (
              <tr key={i.clave} className={i.coincide === false ? 'aviso' : ''}><td>{i.etiqueta}{i.nota && <div className="muted ind-nota">{i.nota}</div>}</td><td className="num">{typeof i.valor === 'number' ? fmt(i.valor) : i.valor}</td>{ref && <><td className="num muted">{i.esperado === undefined ? '—' : typeof i.esperado === 'number' ? fmt(i.esperado) : i.esperado}</td><td>{i.coincide === undefined ? null : i.coincide ? <CheckCircle2 size={14} aria-label="coincide" /> : <AlertTriangle size={14} aria-label="no coincide" />}</td></>}</tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta inc-bloque" aria-label="Conciliación de calles">
        <h3>Calles: coincidencias y denominaciones pendientes</h3>
        {cj.disponible
          ? <p className="muted">Callejero de {db.municipios[destino.municipioId]?.nombre}: {cj.texto}. No se aproxima ni se inventa ninguna correspondencia: lo que no coincide queda pendiente y su registro se conserva sin vínculo territorial. Las propuestas, con su fuente, se revisan y confirman en <b>Decisiones → Calles</b>.</p>
          : <div className="t-info aviso" role="note"><AlertTriangle size={15} /> <div><b>{db.municipios[destino.municipioId]?.nombre} no tiene callejero todavía:</b> ninguna denominación se puede conciliar. Todos los registros se conservan y su vínculo territorial queda pendiente.</div></div>}
        <div className="ap-resumen">
          {(['literal', 'normalizada', 'conciliada', 'pendiente', 'sin-correspondencia', 'ambigua', 'vacia'] as EstadoCalle[]).filter((e) => calles.porEstado[e].denominaciones || e === 'pendiente').map((e) => (
            <button key={e} className={`ap-celda ${verCalles === e ? 'on' : ''}`} onClick={() => setVerCalles(verCalles === e ? null : e)} aria-pressed={verCalles === e}>
              <span className="muted">{ESTADO_CALLE_TXT[e]}</span><b>{calles.porEstado[e].denominaciones}</b><span className="muted">{fmt(calles.porEstado[e].filas)} filas</span>
            </button>
          ))}
        </div>
        {verCalles && (
          <table className="tabla ap-tabla" aria-label={`Denominaciones: ${ESTADO_CALLE_TXT[verCalles]}`}>
            <thead><tr><th>Denominación en el archivo</th><th>Calle del callejero</th><th className="num">Filas</th></tr></thead>
            <tbody>{calles.denominaciones.filter((d) => d.estado === verCalles).map((d) => <tr key={d.literal}><td>{d.literal || '(vacía)'}</td><td>{d.calle ?? '—'}</td><td className="num">{fmt(d.filas)}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      <section className="tarjeta inc-bloque" aria-label="Señales">
        <h3>Datos que se señalan (ningún registro se elimina)</h3>
        <table className="tabla ap-tabla">
          <thead><tr><th>Señal</th><th>Gravedad</th><th className="num">Filas</th></tr></thead>
          <tbody>{sen.map((x) => <tr key={x.tipo}><td>{x.titulo}</td><td>{x.gravedad}</td><td className="num">{fmt(x.filas)}</td></tr>)}</tbody>
        </table>
        <p className="muted">«Long fachada» es longitud en <b>metros lineales</b>, no superficie.</p>
      </section>
      {plan.bloqueos.length > 0 && <div className="t-info error" role="alert"><Lock size={15} /> <div><b>Bloqueante:</b> {plan.bloqueos.map((b) => b.mensaje).join(' ')}</div></div>}
      <RevisionGrupos items={items} />
    </div>
  );
}

const ENTIDADES: [string, string][] = [
  ['campanas', 'Campaña histórica nueva'], ['registros', 'Registros de origen (todas las filas)'], ['locales', 'Locales físicos (uno por establecimiento censado con dirección inequívoca)'], ['negocios', 'Negocios (nombre literal)'],
  ['observaciones', 'Observaciones históricas'], ['ocupaciones', 'Ocupaciones del año histórico'], ['vinculos', 'Correspondencias registro–local'],
  ['franquicias', 'Franquicias históricas'], ['digital', 'Presencia digital histórica (borrador)'], ['clasificaciones', 'Clasificaciones propuestas, sin confirmar'],
];

function EtapaVistaPrevia({ tipo, destino }: { tipo: TipoEspacio; destino: DestinoIncorporacion }) {
  const st = useAsistenteEspacio();
  const esp = useEspacios();
  const { resultado, plan } = st.preparado!;
  const a = st.archivo!;
  const rec = recuentoRegistros(plan);
  const ref = st.lectura?.referencia;
  const diag = useMemo(() => diagnosticoAgregado(resultado, ref), [resultado, ref]);
  const req = requisitosIncorporacion({ tipo, db: esp.db!, huella: esp.huella, respaldoVerificado: esp.respaldoVerificado, almacenamiento: esp.almacenamiento, plan, vistaPreviaRevisada: st.revisada, sintetico: a.sintetico, soloMemoria: esp.soloMemoria });
  const listo = req.every((r) => r.ok);
  const per = periodoDe(destino.anio, st.decisiones);
  const persona = personaEspacio(esp.db!);
  const incorporar = async () => {
    st.set({ error: null });
    const r = await esp.incorporar({ resultado, destino, decisiones: st.decisiones, plan, requisitos: req });
    if (!r.ok) return st.set({ error: r.error ?? 'No se ha incorporado nada.' });
    st.set({ etapa: 6, aplicado: { importacionId: r.importacionId!, campanaId: r.campanaId!, creadas: r.creadas! } });
  };
  return (
    <div className="inc-rejilla">
      <section className="tarjeta inc-bloque" aria-label="Identificación">
        <h3>Identificación</h3>
        <dl className="inc-dl">
          <dt>Persona</dt><dd>{persona?.nombre}</dd>
          <dt>Fecha</dt><dd>{new Date().toLocaleString('es-ES')}</dd>
          <dt>Fichero</dt><dd>{a.nombre} · {mb(a.tamano)}</dd>
          <dt>SHA-256</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{a.sha256}</dd>
          <dt>Perfil y hoja</dt><dd>{plan.perfil.id} v{plan.perfil.version} · hoja «{plan.hoja}»</dd>
          <dt>Destino</dt><dd>{plan.destino.nombre}{plan.destino.itinerario ? ` · itinerario ${plan.destino.itinerario.codigo}` : ''} · <span className="mono">{plan.destino.campanaId}</span></dd>
          <dt>Periodo</dt><dd>{per.desde} – {per.hasta}</dd>
          <dt>Decisiones</dt><dd>{[
            st.decisiones.periodoTrabajo && 'periodo de trabajo de campo',
            `${plan.decisiones.reglasAutorizadas.length} regla(s) autorizada(s)`, `${plan.decisiones.diccionarioAprobado.length} texto(s) «sin información»`,
            `${plan.decisiones.exclusiones} exclusión(es)`, `${plan.decisiones.correspondencias} correspondencia(s)`, `${plan.decisiones.equivalenciasClasificacion} equivalencia(s)`,
            `${plan.decisiones.calles ?? 0} conciliación(es) de calle`, `${plan.decisiones.revisionesBloque ?? 0} revisión(es) en bloque`,
          ].filter(Boolean).join(' · ')}</dd>
        </dl>
      </section>

      <section className="tarjeta inc-bloque" aria-label="Recuento de registros">
        <h3>Registros antes de confirmar</h3>
        <div className="ap-resumen">
          <div><span className="muted">Preparados</span><b>{fmt(rec.preparados)}</b><span className="muted">de {fmt(rec.total)} filas</span></div>
          <div><span className="muted">Vinculados</span><b>{fmt(rec.vinculados)}</b><span className="muted">con local físico</span></div>
          <div><span className="muted">Pendientes</span><b>{fmt(rec.pendientes)}</b><span className="muted">sin local, se conservan</span></div>
          <div><span className="muted">Excluidos</span><b>{fmt(rec.excluidos)}</b><span className="muted">por decisión</span></div>
          <div><span className="muted">Bloqueados</span><b>{fmt(rec.bloqueados)}</b><span className="muted">{rec.bloqueados ? 'plan bloqueado' : 'ninguno'}</span></div>
        </div>
        <ul className="inc-lista">
          {Object.entries(rec.pendientesPorMotivo).map(([m, n]) => <li key={m}>{fmt(n ?? 0)} · {MOTIVO_TXT[m]?.titulo ?? m}</li>)}
          <li>{fmt(plan.mismoPortal.locales)} locales en {fmt(plan.mismoPortal.portales)} portales compartidos: cada uno es un local independiente.</li>
        </ul>
      </section>

      <section className="tarjeta inc-bloque" aria-label="Se crearía">
        <h3>Se crearía</h3>
        <table className="tabla ap-tabla"><tbody>{ENTIDADES.map(([k, t]) => <tr key={k}><td>{t}</td><td className="num">{fmt((plan.nuevas as Record<string, number>)[k] ?? 0)}</td></tr>)}</tbody></table>
        <p className="muted">Ninguna entidad existente se modifica. No se generan coordenadas: la posición de cada local queda pendiente (se muestra su calle).</p>
      </section>

      <section className="tarjeta inc-bloque" aria-label="Pendientes y advertencias">
        <h3>Pendientes y advertencias</h3>
        <ul className="inc-lista">
          {plan.pendientes.map((x) => <li key={x}>{x}</li>)}
          {(plan.cruces ?? []).map((x) => <li key={`${x.fila}-${x.tipo}`} className="aviso">Fila {x.fila}: {x.tipo === 'posible-duplicado' ? 'posible duplicado' : 'contradicción'} con {x.itinerario} ({x.detalle}).</li>)}
          {diag.diferencias.map((d) => <li key={d.clave} className="aviso">No coincide con el informe: {d.etiqueta} ({String(d.valor)} frente a {String(d.esperado)}).</li>)}
          {a.sha256 !== SHA256_ORIGINAL_MEDINA_2025 && tipo === 'real' && <li className="aviso">El SHA-256 del archivo no es el del diagnóstico agregado.</li>}
          <li>No se toca ninguna campaña operativa (en Medina del Campo, 2026 sigue intacta).</li>
        </ul>
      </section>

      <section className="tarjeta inc-bloque inc-ancho" aria-label="Confirmación">
        <h3>Requisitos para incorporar</h3>
        <ul className="inc-lista req-lista">
          {req.map((r) => <li key={r.id} className={!r.ok ? 'no' : r.aviso ? 'aviso' : 'ok'}>{!r.ok ? <XCircle size={14} aria-label="no cumplido" /> : r.aviso ? <AlertTriangle size={14} aria-label="revisar" /> : <CheckCircle2 size={14} aria-label="cumplido" />} {r.texto}</li>)}
        </ul>
        <label className="fila inc-confirmar">
          <input type="checkbox" checked={st.revisada} onChange={(e) => st.set({ revisada: e.target.checked })} aria-label="He revisado la vista previa" />
          <span>He revisado la vista previa completa: identificación, diagnóstico, calles, recuentos, pendientes y advertencias.</span>
        </label>
        {esp.soloMemoria && (
          <div className="t-info aviso" role="note"><Lock size={15} /> <div><b>Análisis sin guardar.</b> Esta vista previa vive solo en la memoria de esta pestaña: no se ha guardado ningún registro y al cerrarla no queda nada.</div></div>
        )}
        {tipo === 'real' && !CONFIRMACION_REAL_HABILITADA && (
          <div className="t-info aviso" role="note"><Lock size={15} /> <div><b>C1e-B · Detenido aquí.</b> La incorporación del censo real no se puede confirmar hasta que revisemos juntos esta vista previa. No se ha incorporado nada.</div></div>
        )}
        <div className="fila">
          <span className="esp" />
          <button className="btn primario" disabled={!listo || !!esp.ocupado} onClick={incorporar}><ShieldCheck size={15} /> {esp.ocupado ?? 'Incorporar al espacio'}</button>
        </div>
      </section>
    </div>
  );
}

function EtapaResultado() {
  const st = useAsistenteEspacio();
  const esp = useEspacios();
  const a = st.aplicado!;
  const imp = esp.db!.importaciones[a.importacionId];
  const deshecha = imp?.estado === 'descartada';
  const vista = !deshecha ? previsualizarDeshacer(esp.db!, a.importacionId, personaEspacio(esp.db!)!.id) : null;
  const deshacer = async () => {
    if (!confirm('Se retirará exactamente lo creado por esta incorporación. La traza se conserva marcada como «deshecha». ¿Continuar?')) return;
    const r = await esp.deshacer(a.importacionId);
    if (!r.ok) st.set({ error: r.error ?? null });
  };
  return (
    <div className="inc-rejilla">
      <section className="tarjeta inc-bloque inc-ancho" aria-label="Resultado">
        {deshecha ? <div className="t-info aviso"><Undo2 size={15} /> Incorporación deshecha. Su traza se conserva.</div> : <div className="t-info ok"><CheckCircle2 size={15} /> Incorporación aplicada como una única operación y guardada con verificación.</div>}
        <div className="t-info aviso"><AlertTriangle size={15} /> Descargue y compruebe ahora un <b>respaldo nuevo</b>: el anterior ya no corresponde al estado actual.</div>
        <div className="ap-resumen">
          {Object.entries(a.creadas).filter(([, n]) => n).map(([k, n]) => <div key={k}><span className="muted">{k}</span><b>{fmt(n)}</b></div>)}
        </div>
        <dl className="inc-dl"><dt>Importación</dt><dd className="mono">{a.importacionId}</dd><dt>Campaña</dt><dd className="mono">{a.campanaId}</dd></dl>
        <div className="fila">
          {!deshecha && <button className="btn peligro" disabled={!vista?.permitido || !!esp.ocupado} title={vista?.conflictos.join(' · ')} onClick={deshacer}><Undo2 size={15} /> Deshacer la incorporación</button>}
          <span className="esp" />
          <button className="btn" onClick={() => st.reiniciar()}>Cerrar el asistente</button>
        </div>
      </section>
    </div>
  );
}
