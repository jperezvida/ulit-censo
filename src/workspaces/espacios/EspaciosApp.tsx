import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Eye, FileCheck2, FlaskConical, HardDrive, Lock, RotateCcw, ShieldCheck, Upload, XCircle } from 'lucide-react';
import { fmt } from '../../components/ui';
import { useEspacios } from '../../store/espacios';
import { BASE_INDEXEDDB, ESPACIO_TXT, personaEspacio, type TipoEspacio } from '../../domain/espacios';
import { ARCHIVO_SINTETICO_C1E, libroSinteticoC1e } from '../../data/xlsxSinteticoC1e';
import { AsistenteEspacio } from './AsistenteEspacio';
import { useAsistenteEspacio, useSeleccionEspacio } from './estadoAsistenteEspacio';
import { MunicipiosCampanas } from './MunicipiosCampanas';
import { leerTexto } from './leerArchivo';
import { comprobarGarantias, VERSION_EMBEBIDA, type ResultadoGarantias } from './garantiasNavegador';
import { entornoDe } from '../../domain/garantias';
import '../../styles/datos.css';
import '../../styles/incorporacion.css';
import '../../styles/espacios.css';

const MiB = 1024 * 1024;

/** Descarga un archivo generado en el navegador (respaldo o archivo sintético). */
function descargar(nombre: string, datos: BlobPart, tipo: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([datos], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


/**
 * C1e · Espacios AISLADOS (ensayo y datos reales), fuera de la demostración: otra pantalla, otro
 * almacenamiento y otra cabecera, para que nunca se confundan los datos reales con los ficticios.
 */
export default function EspaciosApp() {
  return (
    <div className="esp-app">
      <header className="esp-cab">
        <Link to="/espacios" className="marca-ulit"><b>ULIT</b><span>Censo</span></Link>
        <span className="esp-cab-tit">Espacios aislados · incorporación del censo real</span>
        <span className="esp" />
        <span className="mono esp-version" title={`Commit ${VERSION_EMBEBIDA.commit} · rama ${VERSION_EMBEBIDA.rama}`}>versión {VERSION_EMBEBIDA.commit.slice(0, 7)}</span>
        <NavLink to="/campanas" className="btn s oscuro-borde"><ArrowLeft size={14} /> Volver a la demostración</NavLink>
      </header>
      <main className="esp-cuerpo">
        <Routes>
          <Route index element={<Selector />} />
          <Route path="analisis" element={<AnalisisSinGuardar />} />
          <Route path=":tipo" element={<EspacioPage />} />
        </Routes>
      </main>
    </div>
  );
}

/** En la vista previa web no se guardan datos reales: el espacio real persistente solo funciona en el equipo propio. */
const REAL_PERSISTENTE_PERMITIDO = () => entornoDe(location.hostname) === 'local';

function Selector() {
  const realPersistente = REAL_PERSISTENTE_PERMITIDO();
  return (
    <div className="col" style={{ gap: 16 }}>
      <div>
        <h1>Espacios de trabajo independientes</h1>
        <p className="muted">La <b>demostración</b> (datos ficticios) sigue intacta en su propio almacenamiento. Los espacios de abajo usan cada uno su <b>propia base de datos</b> en este navegador y nunca se mezclan entre sí ni con la demostración.</p>
      </div>
      <div className="esp-tarjetas">
        <Link to="/espacios/analisis" className="tarjeta esp-tarjeta esp-real">
          <Eye size={22} />
          <b>Analizar el Excel real SIN GUARDAR (C1e-B)</b>
          <span className="muted">Seleccione el XLSX auténtico, analícelo en este navegador y consulte la vista previa. No se sube, no se incorpora y no se guarda ningún registro.</span>
          <span className="mono muted">solo en memoria</span>
        </Link>
        <Link to="/espacios/ensayo" className="tarjeta esp-tarjeta esp-ensayo">
          <FlaskConical size={22} />
          <b>{ESPACIO_TXT.ensayo.nombre}</b>
          <span className="muted">{ESPACIO_TXT.ensayo.descripcion}</span>
          <span className="mono muted">IndexedDB «{BASE_INDEXEDDB.ensayo}»</span>
        </Link>
        {realPersistente ? (
          <Link to="/espacios/real" className="tarjeta esp-tarjeta esp-real">
            <ShieldCheck size={22} />
            <b>{ESPACIO_TXT.real.nombre}</b>
            <span className="muted">{ESPACIO_TXT.real.descripcion}</span>
            <span className="mono muted">IndexedDB «{BASE_INDEXEDDB.real}»</span>
          </Link>
        ) : (
          <div className="tarjeta esp-tarjeta esp-desactivada" aria-disabled="true">
            <Lock size={22} />
            <b>{ESPACIO_TXT.real.nombre} (guardado)</b>
            <span className="muted">No disponible en la vista previa web: aquí no se guardan datos reales. Para revisar el Excel auténtico use «Analizar el Excel real SIN GUARDAR».</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * C1e-B · Análisis del Excel REAL sin guardar: primero se verifican en el navegador las garantías del
 * sitio (protección, sin transmisión a terceros, versión revisada); solo si se cumplen todas se permite
 * elegir el archivo. La base es temporal y vive solo en memoria; al salir se descarta.
 */
function AnalisisSinGuardar() {
  const esp = useEspacios();
  const reiniciarAsistente = useAsistenteEspacio((s) => s.reiniciar);
  const [g, setG] = useState<ResultadoGarantias | null>(null);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    esp.cerrar();
    reiniciarAsistente();
    useSeleccionEspacio.getState().reiniciar();
    void comprobarGarantias().then(setG);
    return () => {
      // Al salir no queda nada: ni el archivo, ni la interpretación, ni la base temporal.
      useEspacios.getState().cerrar();
      useAsistenteEspacio.getState().reiniciar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const abierta = esp.soloMemoria && esp.fase === 'listo' && !!esp.db;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="esp-banda esp-real" role="banner" aria-label="Espacio activo">
        <Eye size={18} />
        <b>ANÁLISIS DEL EXCEL REAL SIN GUARDAR</b>
        <span>Se procesa en este navegador · no se sube a ningún servidor · no se guarda ningún registro · la incorporación está bloqueada (C1e-B)</span>
      </div>
      <section className="tarjeta inc-bloque" aria-label="Garantías del sitio">
        <h3><ShieldCheck size={16} /> Garantías comprobadas en este navegador</h3>
        {!g ? <p className="muted" role="status">Comprobando protección, política de seguridad y versión…</p> : (
          <>
            <ul className="inc-lista req-lista">
              {g.garantias.map((x) => <li key={x.id} className={x.ok ? 'ok' : 'no'}>{x.ok ? <CheckCircle2 size={14} aria-label="cumplida" /> : <XCircle size={14} aria-label="no cumplida" />} {x.texto}</li>)}
            </ul>
            {g.ok
              ? <div className="t-info ok"><CheckCircle2 size={15} /> Garantías verificadas: puede analizar el Excel real en esta pestaña.</div>
              : <div className="t-info error" role="alert"><AlertTriangle size={15} /> No se habilita el análisis del Excel real: alguna garantía no se ha podido verificar (detalle arriba). No seleccione el archivo auténtico aquí.</div>}
            <p className="muted mono">Versión en ejecución: {VERSION_EMBEBIDA.commit} · rama {VERSION_EMBEBIDA.rama}</p>
          </>
        )}
      </section>
      {g?.ok && !abierta && (
        <section className="tarjeta inc-bloque" aria-label="Persona que analiza" style={{ maxWidth: 720 }}>
          <h3>Persona que analiza</h3>
          <p className="muted">Solo para identificar la vista previa en pantalla; no se guarda.</p>
          <label className="campo"><span>Nombre y apellidos</span><input className="input" aria-label="Nombre de quien analiza" value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
          {error && <div className="t-info error" role="alert">{error}</div>}
          <button className="btn primario" disabled={nombre.trim().length < 3 || esp.fase === 'cargando'} onClick={async () => {
            const r = await esp.abrirEnMemoria('real', { nombre, roles: ['coordinador'] });
            setError(r.ok ? null : r.error ?? 'No se ha podido preparar el análisis.');
          }}>Empezar el análisis</button>
        </section>
      )}
      {g?.ok && abierta && (
        <section className="tarjeta inc-bloque" aria-label="Analizar el censo histórico 2025">
          <h2 style={{ margin: 0 }}>Vista previa del censo histórico 2025</h2>
          <p className="muted">Mismo procedimiento que la incorporación (C1a, C1b, C1c y decisiones de C1d), detenido en la vista previa.</p>
          <AsistenteEspacio tipo="real" />
        </section>
      )}
    </div>
  );
}

function EspacioPage() {
  const { tipo: param } = useParams();
  const tipo = (param === 'real' || param === 'ensayo' ? param : null) as TipoEspacio | null;
  const esp = useEspacios();
  const reiniciarAsistente = useAsistenteEspacio((s) => s.reiniciar);
  const nav = useNavigate();
  const bloqueado = tipo === 'real' && !REAL_PERSISTENTE_PERMITIDO();
  useEffect(() => {
    if (!tipo) return void nav('/espacios', { replace: true });
    if (bloqueado) return;
    if (esp.tipo !== tipo || esp.soloMemoria) {
      reiniciarAsistente();
      useSeleccionEspacio.getState().reiniciar();
      void esp.abrir(tipo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);
  if (!tipo) return null;
  if (bloqueado) {
    return (
      <div className="t-info aviso" role="alert"><Lock size={15} /> <div><b>El espacio de datos reales (guardado) no está disponible en la vista previa web.</b> Aquí no se guardan datos reales. Para revisar el Excel auténtico use <Link to="/espacios/analisis">«Analizar el Excel real SIN GUARDAR»</Link>.</div></div>
    );
  }
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className={`esp-banda esp-${tipo}`} role="banner" aria-label="Espacio activo">
        {tipo === 'real' ? <ShieldCheck size={18} /> : <FlaskConical size={18} />}
        <b>{ESPACIO_TXT[tipo].nombre.toUpperCase()}</b>
        <span>{tipo === 'real' ? 'Censos auténticos · separado de la demostración y del ensayo' : 'Solo archivos SINTÉTICOS · separado de la demostración y del espacio real'}</span>
      </div>
      {esp.fase === 'cargando' && <div className="t-info" role="status">Abriendo el espacio…</div>}
      {esp.fase === 'error' && <div className="t-info error" role="alert"><AlertTriangle size={15} /> {esp.error}</div>}
      {esp.fase === 'sin-crear' && <Crear tipo={tipo} />}
      {esp.fase === 'listo' && esp.db && esp.tipo === tipo && <Espacio tipo={tipo} />}
    </div>
  );
}

function Crear({ tipo }: { tipo: TipoEspacio }) {
  const crear = useEspacios((s) => s.crear);
  const ocupado = useEspacios((s) => s.ocupado);
  const [nombre, setNombre] = useState('');
  const [conMedina, setConMedina] = useState(true);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="tarjeta inc-bloque" aria-label="Crear el espacio" style={{ maxWidth: 720 }}>
      <h3>Crear el {ESPACIO_TXT[tipo].nombre.toLowerCase()}</h3>
      <p className="muted">Se crea vacío, con la persona responsable. Después podrá dar de alta municipios, sus callejeros y sus campañas. No se copia nada de la demostración. Si ya existiera, no se sobrescribe.</p>
      <label className="campo">
        <span>Persona responsable (coordinación)</span>
        <input className="input" aria-label="Persona responsable" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellidos" />
      </label>
      <label className="fila" style={{ gap: 8, alignItems: 'flex-start' }}>
        <input type="checkbox" aria-label="Incluir Medina del Campo" checked={conMedina} onChange={(e) => setConMedina(e.target.checked)} />
        <span>Incluir <b>Medina del Campo</b> con su callejero real (instantánea de OpenStreetMap del proyecto). Es el caso de prueba del importador, no un requisito: puede trabajar solo con otros municipios.</span>
      </label>
      {error && <div className="t-info error" role="alert">{error}</div>}
      <button className="btn primario" disabled={nombre.trim().length < 3 || !!ocupado} onClick={async () => {
        const r = await crear({ nombre, roles: ['coordinador'] }, { incluirMedina: conMedina });
        setError(r.ok ? null : r.error ?? 'No se ha creado.');
      }}>{ocupado ?? 'Crear el espacio'}</button>
    </section>
  );
}

function Espacio({ tipo }: { tipo: TipoEspacio }) {
  const esp = useEspacios();
  const db = esp.db!;
  const persona = personaEspacio(db);
  const campanas = Object.values(db.campanas);
  const importaciones = Object.values(db.importaciones);
  const [generando, setGenerando] = useState(false);
  return (
    <div className="col" style={{ gap: 14 }}>
      <MunicipiosCampanas tipo={tipo} />
      <div className="inc-rejilla">
        <section className="tarjeta inc-bloque" aria-label="Estado del espacio">
          <h3>Estado</h3>
          <dl className="inc-dl">
            <dt>Responsable</dt><dd>{persona?.nombre}</dd>
            <dt>Creado</dt><dd>{db.meta.espacioCreado?.slice(0, 10)} · <span className="mono muted">{db.meta.espacioId?.slice(0, 8)}</span></dd>
            <dt>Municipios</dt><dd>{Object.keys(db.municipios).length}</dd>
            <dt>Campañas</dt><dd>{campanas.length || 'Ninguna todavía'}</dd>
            <dt>Registros</dt><dd>{fmt(Object.keys(db.registros).length)} · locales {fmt(Object.keys(db.locales).length)} · negocios {fmt(Object.keys(db.negocios).length)}</dd>
          </dl>
          {tipo === 'ensayo' && (
            <button className="btn s" disabled={generando} onClick={async () => {
              setGenerando(true);
              try { descargar(ARCHIVO_SINTETICO_C1E, await libroSinteticoC1e(Object.values(db.calles)) as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); } finally { setGenerando(false); }
            }}><Download size={14} /> {generando ? 'Generando…' : 'Descargar el archivo SINTÉTICO de ensayo'}</button>
          )}
        </section>
        <Almacenamiento tipo={tipo} />
        <RespaldoTarjeta tipo={tipo} />
        <section className="tarjeta inc-bloque" aria-label="Incorporaciones">
          <h3>Incorporaciones</h3>
          {importaciones.length === 0 ? <p className="muted">Ninguna.</p> : (
            <table className="tabla ap-tabla"><tbody>{importaciones.map((i) => (
              <tr key={i.id}><td>{i.archivo}<div className="mono muted">{i.huella.slice(0, 16)}…</div></td><td>{i.fecha.slice(0, 10)}</td><td>{i.estado === 'descartada' ? 'deshecha' : i.estado}</td><td className="num">{fmt(i.filas)} filas</td></tr>
            ))}</tbody></table>
          )}
        </section>
      </div>
      <section className="tarjeta inc-bloque" aria-label="Incorporar un censo">
        <h2 style={{ margin: 0 }}>Incorporar un censo histórico (Excel)</h2>
        <p className="muted">Primero el destino (municipio y campaña histórica), después el archivo. Un único importador: lectura segura (C1a), columnas (G1), interpretación (C1b), plan atómico y reversible (C1c) y decisiones trazadas (C1d). {tipo === 'real' ? 'En esta fase (C1e-B) se llega hasta la vista previa: la confirmación está bloqueada.' : 'Use archivos SINTÉTICOS.'}</p>
        <AsistenteEspacio tipo={tipo} />
      </section>
    </div>
  );
}

function Almacenamiento({ tipo }: { tipo: TipoEspacio }) {
  const a = useEspacios((s) => s.almacenamiento);
  const pedir = useEspacios((s) => s.solicitarPersistencia);
  const medir = useEspacios((s) => s.medirAlmacenamiento);
  return (
    <section className="tarjeta inc-bloque" aria-label="Almacenamiento">
      <h3><HardDrive size={16} /> Dónde se guarda</h3>
      <p className="muted">En la base IndexedDB <b className="mono">{BASE_INDEXEDDB[tipo]}</b> de <b>este navegador</b>, de este perfil y de esta dirección web. Otro navegador, otro equipo u otra dirección (p. ej., otra URL de Codespaces) no la ven. Borrar los datos del sitio la elimina. <b>No es un almacenamiento institucional:</b> conserve siempre un respaldo descargado.</p>
      <dl className="inc-dl">
        <dt>Uso / cuota</dt><dd>{a?.cuota !== undefined ? `${Math.round((a.usado ?? 0) / MiB)} MB de ${Math.round(a.cuota / MiB)} MB` : 'el navegador no lo informa'}</dd>
        <dt>Persistente</dt><dd>{a?.persistente ? <span className="chip ok">Sí</span> : <span className="chip aviso">No: el navegador podría borrarlo si le falta espacio</span>}</dd>
      </dl>
      <div className="fila">
        {!a?.persistente && <button className="btn s" onClick={() => void pedir()}>Pedir almacenamiento persistente</button>}
        <button className="btn s" onClick={() => void medir()}><RotateCcw size={13} /> Actualizar</button>
      </div>
    </section>
  );
}

function RespaldoTarjeta({ tipo }: { tipo: TipoEspacio }) {
  const esp = useEspacios();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const actual = !!esp.respaldoVerificado && esp.respaldoVerificado.huella === esp.huella;
  return (
    <section className="tarjeta inc-bloque" aria-label="Respaldo">
      <h3><FileCheck2 size={16} /> Respaldo externo</h3>
      <p>{actual ? <span className="chip ok">Respaldo comprobado del estado actual</span> : <span className="chip aviso">Sin respaldo comprobado del estado actual</span>}</p>
      <ol className="inc-lista">
        <li><button className="btn s" onClick={() => { const r = esp.prepararRespaldo(); descargar(r.nombreArchivo, r.texto, 'application/json'); setMsg({ ok: true, texto: `Descargado ${r.nombreArchivo}. Guárdelo fuera del navegador y compruébelo en el paso 2.` }); }}><Download size={14} /> 1. Descargar respaldo</button></li>
        <li>
          <label className="btn s"><Upload size={14} /> 2. Comprobar un respaldo
            <input type="file" accept=".json,application/json" hidden aria-label="Comprobar un respaldo" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              const r = await esp.verificarRespaldo(await leerTexto(f), f.name);
              setMsg(!r.ok ? { ok: false, texto: r.error! } : r.coincide ? { ok: true, texto: `Respaldo correcto y completo: coincide con el estado actual (${f.name}).` } : { ok: false, texto: 'Respaldo correcto, pero de un estado anterior: no sirve como respaldo del estado actual.' });
            }} />
          </label>
        </li>
        <li>
          <label className="btn s peligro"><Lock size={14} /> Restaurar desde un respaldo
            <input type="file" accept=".json,application/json" hidden aria-label="Restaurar desde un respaldo" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (!confirm(`Se sustituirá el contenido del ${ESPACIO_TXT[tipo].nombre.toLowerCase()} por el del respaldo «${f.name}». Antes se guarda una copia interna del estado actual. ¿Continuar?`)) return;
              const r = await esp.restaurar(await leerTexto(f));
              setMsg(r.ok ? { ok: true, texto: 'Respaldo restaurado y verificado.' } : { ok: false, texto: r.error! });
            }} />
          </label>
        </li>
      </ol>
      {msg && <div className={`t-info ${msg.ok ? 'ok' : 'error'}`} role="status">{msg.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.texto}</div>}
    </section>
  );
}
