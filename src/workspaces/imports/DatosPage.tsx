import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileCheck2, FileScan, FileSearch, FileSpreadsheet, FileUp, FlaskConical, GitMerge, Map as MapIcon, Undo2, Upload, Workflow } from 'lucide-react';
import { DeshacerIncorporacion } from './incorporacion/DeshacerIncorporacion';
import { InspectorExcel } from './InspectorExcel';
import { AnalisisPrevio } from './AnalisisPrevio';
import { useContexto } from '../../store/contexto';
import { useStore } from '../../store/store';
import { useFuenteOficina } from '../../store/fuenteOficina';
import DatosRealPage from '../real/DatosRealPage';
import { CAMPOS, compararImportacion, interpretarFilas, mapearCabecera, parsearCSV, type CampoCanonico, type ClaseDiff, type FilaDiff } from '../../domain/importacion';
import { aplicarResultadosPapel, importarCensoHistorico } from '../../domain/aplicarImportacion';
import { itinerariosDe } from '../../domain/consultas';
import { csvEjemploHistorico, csvEjemploItinerario } from '../../data/ejemplos';
import type { Importacion } from '../../domain/types';
import { columnasVistaImportacion, notaVisibleImportacion, resumenVinculosImportacion } from '../../domain/detalleImportacion';
import { Modal, Sim, fmt, fmtFecha } from '../../components/ui';
import '../../styles/datos.css';

const TIPOS: { t: Importacion['tipo']; titulo: string; d: string; icono: typeof Upload }[] = [
  { t: 'A-censo-historico', titulo: 'A · Censo histórico completo', d: 'Excel/CSV de un municipio sin itinerarios. Crea una campaña histórica y conserva cada fila original.', icono: FileSpreadsheet },
  { t: 'B-itinerarios-kml', titulo: 'B · Itinerarios de Google My Maps', d: 'KML/KMZ con trazados. Se comprueban calles y geometrías en el planificador.', icono: MapIcon },
  { t: 'C-excel-itinerario', titulo: 'C · Excel parcial de un itinerario', d: 'Resultados de campo pasados a limpio. Nunca toca calles ajenas al itinerario.', icono: FileCheck2 },
  { t: 'D-actualizacion', titulo: 'D · Actualización posterior', d: 'Archivo corregido: detecta lo que ya existe para no duplicar.', icono: Upload },
  { t: 'E-conciliacion', titulo: 'E · Conciliación histórica', d: 'Propuestas de correspondencia entre años, confirmadas o dudosas.', icono: GitMerge },
];

const CLASE_TXT: Record<ClaseDiff, { t: string; c: string }> = {
  nuevo: { t: 'Nuevo', c: 'azul' },
  'sin-cambios': { t: 'Sin cambios', c: 'ok' },
  modificado: { t: 'Modificado', c: 'aviso' },
  ambiguo: { t: 'Ambiguo: conciliar', c: 'dudoso' },
  'fuera-ambito': { t: 'Fuera del itinerario', c: '' },
  'calle-desconocida': { t: 'Calle no reconocida', c: 'error' },
  'posible-duplicado': { t: 'Posible duplicado', c: 'dudoso' },
};

export default function DatosPage() {
  const { db, municipio, campana } = useContexto();
  const soloReal = useFuenteOficina()?.soloLectura === true;
  const nav = useNavigate();
  const [sel, setSel] = useState<string | null>(null);
  const [asistente, setAsistente] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [analisis, setAnalisis] = useState(false);
  const imps = useMemo(() => Object.values(db.importaciones).filter((i) => i.municipioId === municipio.id).sort((a, b) => b.fecha.localeCompare(a.fecha)), [db.importaciones, municipio.id]);
  const imp = sel ? db.importaciones[sel] : imps[0];

  return (
    <div className={`pagina dat-page ${soloReal ? 'dat-page--real' : ''}`}>
      <div className="pagina-cab">
        <div className="esp">
          <div className="rotulo sin-linea">05 · Datos e importaciones</div>
          <h1>Procedencia de los datos</h1>
          <p>Antes de guardar, el Excel se analiza y se comprueba. Se conservan sus filas y celdas de origen, pero no los bytes del archivo XLSX. Una fila que desaparece nunca se interpreta automáticamente como un cierre.</p>
        </div>
        {!soloReal && <button className="btn" onClick={() => setInspector(true)}><FileSearch size={16} /> Inspeccionar estructura de Excel</button>}
        {!soloReal && <button className="btn primario" onClick={() => setAnalisis(true)} title="Lector XLSX de C1a: solo lectura, para los Excel de la Cátedra"><FileScan size={16} /> Análisis previo de importación</button>}
        {!soloReal && <button className="btn" onClick={() => nav('/datos/incorporar')} title="Asistente de incorporación controlada (C1d): solo escenarios ficticios generados por la aplicación"><Workflow size={16} /> Incorporación controlada <span className="tag naranja">demostración</span></button>}
        {!soloReal && <button className="btn fantasma" onClick={() => setAsistente(true)} title="Importador CSV antiguo con problemas conocidos de interpretación: solo para los ejemplos ficticios">
          <FlaskConical size={16} /> Importador CSV provisional <span className="tag naranja">demostración</span>
        </button>}
      </div>

      {soloReal && <div className="dat-operativa"><DatosRealPage /></div>}
      <section className="dat-historial" aria-label="Archivos incorporados">
        <div className="dat-section-heading">
          <div>
            <div className="rotulo sin-linea">Historial de importaciones</div>
            <h2>Archivos incorporados</h2>
            <p className="muted">Seleccione un archivo para consultar sus registros originales y el estado de sus vínculos.</p>
          </div>
          <span className="dat-total-archivos">{fmt(imps.length)} {imps.length === 1 ? 'archivo' : 'archivos'}</span>
        </div>
      <div className="dat-rejilla">
        <div className="dat-lista">
          {imps.length === 0 && <div className="vacio-estado tarjeta">Sin importaciones en {municipio.nombre}.</div>}
          {imps.map((i) => (
            <button key={i.id} type="button"
              aria-pressed={imp?.id === i.id}
              className={`dat-imp tarjeta ${imp?.id === i.id ? 'on' : ''}`}
              onClick={() => setSel(i.id)}>
              <div className="dat-archivo-cab">
                <span className="dat-archivo-icon"><FileSpreadsheet size={20} /></span>
                <span className="dat-archivo-nombre">
                  <strong>{i.archivo}</strong>
                  <small>{TIPOS.find((t) => t.t === i.tipo)?.titulo.slice(4)} · {fmtFecha(i.fecha)}</small>
                </span>
                {i.procedencia === 'simulado' ? <Sim texto="Simulado" /> : <span className="chip azul">Importado</span>}
              </div>
              <div className="dat-archivo-meta">
                <span><b>{fmt(i.filas)}</b> filas</span>
                {typeof i.resumen['locales creados'] === 'number' && <span><b>{fmt(i.resumen['locales creados'])}</b> locales nuevos</span>}
                {typeof i.resumen['observaciones'] === 'number' && <span><b>{fmt(i.resumen['observaciones'])}</b> observaciones</span>}
              </div>
            </button>
          ))}
        </div>
        {imp && <DetalleImportacion key={imp.id} imp={imp} />}
      </div>
      </section>
      {!soloReal && asistente && campana && <Asistente onCerrar={() => setAsistente(false)} />}
      {!soloReal && inspector && <InspectorExcel onCerrar={() => setInspector(false)} />}
      {!soloReal && analisis && <AnalisisPrevio municipioId={municipio.id} onCerrar={() => setAnalisis(false)} />}
    </div>
  );
}

function DetalleImportacion({ imp }: { imp: Importacion }) {
  const { db } = useContexto();
  const soloReal = useFuenteOficina()?.soloLectura === true;
  const [deshacer, setDeshacer] = useState(false);
  const registros = useMemo(() => Object.values(db.registros).filter((r) => r.importacionId === imp.id).sort((a, b) => a.fila - b.fila), [db.registros, imp.id]);
  const [todasLasColumnas, setTodasLasColumnas] = useState(false);
  const [todasLasFilas, setTodasLasFilas] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const resumen = useMemo(() => resumenVinculosImportacion(registros, Object.values(db.vinculos)),
    [registros, db.vinculos]);
  const columnas = useMemo(() => columnasVistaImportacion(registros, todasLasColumnas),
    [registros, todasLasColumnas]);
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es');
    return q ? registros.filter((r) =>
      Object.values(r.datos).some((v) => String(v).toLocaleLowerCase('es').includes(q))
      || String(r.fila).includes(q)) : registros;
  }, [registros, busqueda]);
  const visibles = todasLasFilas ? filtrados : filtrados.slice(0, 80);
  return (
    <div className="dat-detalle tarjeta">
      <div className="dat-detalle-cab">
        <div>
          <div className="rotulo sin-linea">Detalle del archivo seleccionado</div>
          <h3>{imp.archivo}</h3>
          <p className="muted">{notaVisibleImportacion(imp)}</p>
        </div>
        <span className="chip ok">{imp.estado}</span>
      </div>
      <details className="dat-traza">
        <summary>Ver trazabilidad y datos técnicos del archivo</summary>
        <div className="dat-traza-contenido">
          <div className="dat-huella"><b>SHA-256</b><code>{imp.huella}</code></div>
      {imp.c1 && (
        <div className="dat-c1" aria-label="Traza de la incorporación">
          <span className="chip">Perfil {imp.c1.perfil.id} v{imp.c1.perfil.version}</span>
          <span className="chip">Año {imp.c1.anio}</span>
          <span className="chip">Por {db.personas[imp.c1.porId]?.nombre ?? imp.c1.porId}</span>
          <span className="chip">Huellas {imp.c1.algoritmoHuellas ?? 'FNV-1a 32 bits'}</span>
          {imp.c1.deshecha ? <span className="chip aviso">Deshecha por {db.personas[imp.c1.deshecha.porId]?.nombre ?? imp.c1.deshecha.porId} · {fmtFecha(imp.c1.deshecha.fecha)}</span> : (
            !soloReal && <button className="btn s peligro" onClick={() => setDeshacer(true)}><Undo2 size={14} /> Deshacer la incorporación…</button>
          )}
        </div>
      )}
        </div>
      </details>
      {!soloReal && deshacer && <DeshacerIncorporacion importacionId={imp.id} onCerrar={() => setDeshacer(false)} />}
      <div className="dat-cifras">
        <div><b className="num">{fmt(imp.filas)}</b><span>filas del archivo</span></div>
        <div><b className="num">{fmt(registros.length)}</b><span>registros de origen conservados</span></div>
        <div><b className="num">{fmt(resumen.sinLocal)}</b><span>sin local · pendientes de conciliación</span></div>
        <div><b className="num">{fmt(resumen.conLocal)}</b><span>con local vinculado</span></div>
      </div>
      {resumen.noConfirmados > 0 && <p className="muted" style={{ fontSize: 12 }}>
        {fmt(resumen.noConfirmados)} vínculos sin confirmación definitiva: un local vinculado provisionalmente no equivale a una revisión de Oficina.
      </p>}
      {registros.length === 0 ? (
        <p className="muted">Las filas originales de esta importación no se incluyen en la demo de volumen.</p>
      ) : (
        <div>
          <div className="dat-herramientas">
            <label className="dat-buscar">
              <span className="muted" style={{ fontSize: 12, display: 'block' }}>Buscar por calle, negocio, fila o actividad</span>
              <input className="input" type="search" aria-label="Buscar filas del Excel importado"
                value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setTodasLasFilas(false); }}
                placeholder="Buscar en los registros…" />
            </label>
            <button className="btn s" type="button" aria-pressed={todasLasColumnas}
              onClick={() => setTodasLasColumnas((v) => !v)}>
              {todasLasColumnas ? 'Ver columnas principales' : `Ver todas las columnas originales (${Object.keys(registros[0]?.datos ?? {}).length})`}
            </button>
          </div>
          <div className="dat-tabla scroll-fino" role="region" aria-label="Registros originales del Excel" tabIndex={0}>
            <table className="tabla">
              <thead>
                <tr><th>Fila</th>{columnas.map((c) => <th key={c}>{c}</th>)}<th>Estado del vínculo</th></tr>
              </thead>
              <tbody>
                {visibles.map((r) => {
                  const v = resumen.porRegistro.get(r.id);
                  const tieneLocal = Boolean(v?.localId);
                  const confirmado = tieneLocal && v?.confianza === 'confirmada';
                  return <tr key={r.id} className={!tieneLocal ? 'dat-pend' : ''}>
                    <td className="mono muted">{r.fila}</td>
                    {columnas.map((c) => <td key={c}>{r.datos[c]}</td>)}
                    <td><span className={`chip ${confirmado ? 'ok' : tieneLocal ? 'azul' : 'aviso'}`}>
                      {v ? `${v.confianza} · ${tieneLocal ? 'con local' : 'sin local'}` : 'sin vínculo registrado'}
                    </span></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Mostrando {fmt(visibles.length)} de {fmt(filtrados.length)} filas coincidentes.
          </p>
          {filtrados.length > 80 && <button className="btn s" type="button"
            onClick={() => setTodasLasFilas((v) => !v)}>
            {todasLasFilas ? 'Mostrar solo las primeras 80' : `Mostrar las ${fmt(filtrados.length)} filas`}
          </button>}
        </div>
      )}
    </div>
  );
}

function Asistente({ onCerrar }: { onCerrar: () => void }) {
  const { db, municipio, campana, prefs } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const setPrefs = useStore((s) => s.setPrefs);
  const nav = useNavigate();
  const [tipo, setTipo] = useState<Importacion['tipo'] | null>(null);
  const [itId, setItId] = useState('');
  const [archivo, setArchivo] = useState<{ nombre: string; texto: string; simulado: boolean } | null>(null);
  const [mapa, setMapa] = useState<Partial<Record<CampoCanonico, number>>>({});
  const [anio, setAnio] = useState(2025);
  const its = campana ? itinerariosDe(db, campana.id) : [];
  const parsed = useMemo(() => (archivo ? parsearCSV(archivo.texto) : null), [archivo]);
  const calles = useMemo(() => Object.values(db.calles).filter((c) => c.municipioId === municipio.id), [db.calles, municipio.id]);
  const diff: FilaDiff[] = useMemo(() => {
    if (!parsed || !campana) return [];
    const filas = interpretarFilas(parsed.cabecera, parsed.filas, mapa, calles);
    if (tipo === 'A-censo-historico') return filas.map((f) => ({ ...f, clase: f.calleId ? 'nuevo' : 'calle-desconocida', detalle: f.calleId ? 'Se creará un local físico' : `“${f.calleTexto}” no está en el callejero` }) as FilaDiff);
    const limite = tipo === 'C-excel-itinerario' && itId ? new Set(db.itinerarios[itId]?.tramos.map((t) => t.calleId)) : undefined;
    return compararImportacion(db, campana.id, filas, limite);
  }, [parsed, mapa, calles, campana, tipo, itId, db]);
  const cuentas = diff.reduce<Record<string, number>>((a, f) => ({ ...a, [f.clase]: (a[f.clase] ?? 0) + 1 }), {});

  const cargarTexto = (nombre: string, texto: string, simulado: boolean) => {
    setArchivo({ nombre, texto, simulado });
    setMapa(mapearCabecera(parsearCSV(texto).cabecera));
  };

  const confirmar = () => {
    // Importador provisional: nunca incorpora archivos subidos (solo los ejemplos simulados).
    if (!campana || !archivo || !archivo.simulado) return;
    if (tipo === 'A-censo-historico') {
      let nueva = '';
      aplicar((d) => {
        const r = importarCensoHistorico(d, municipio.id, anio, `Censo ${anio} (importado)`, diff, archivo.nombre);
        nueva = r.campanaId;
        return r.db;
      }, `Campaña histórica ${anio} creada desde ${archivo.nombre}`);
      if (nueva) setPrefs({ campanaId: nueva });
    } else {
      aplicar((d) => aplicarResultadosPapel(d, campana.id, diff, archivo.nombre, tipo!, prefs.personaId).db, `Importación aplicada: ${cuentas.nuevo ?? 0} nuevos, ${cuentas.modificado ?? 0} modificados, ${cuentas['sin-cambios'] ?? 0} confirmados`);
    }
    onCerrar();
  };

  const paso = !tipo ? 1 : !archivo ? 2 : 3;
  return (
    <Modal
      ancho
      titulo="Importador CSV provisional · solo demostración"
      sub={`${municipio.nombre} · ${campana?.nombre} · solo se pueden incorporar los archivos de ejemplo simulados`}
      onCerrar={onCerrar}
      pie={
        paso === 3 && (
          <>
            <span className="muted esp">
              {!archivo?.simulado ? 'Solo previsualización: con el importador provisional no se incorporará nada.' : tipo === 'A-censo-historico' ? `Se creará la campaña «Censo ${anio} (importado)» con ${cuentas.nuevo ?? 0} locales.` : `Se aplicarán ${(cuentas.nuevo ?? 0) + (cuentas.modificado ?? 0) + (cuentas['sin-cambios'] ?? 0)} filas${cuentas.ambiguo ? ` y ${cuentas.ambiguo} quedarán pendientes de conciliación` : ''}; ${(cuentas['fuera-ambito'] ?? 0) + (cuentas['calle-desconocida'] ?? 0) + (cuentas['posible-duplicado'] ?? 0)} quedan sin aplicar.`}
            </span>
            <button className="btn" onClick={() => setArchivo(null)}>Atrás</button>
            <button
              className="btn primario"
              onClick={confirmar}
              disabled={!archivo?.simulado || !diff.length || (tipo === 'C-excel-itinerario' && !itId)}
              title={archivo?.simulado ? undefined : 'El importador provisional no incorpora archivos subidos: solo los ejemplos simulados'}
            >
              Confirmar incorporación
            </button>
          </>
        )
      }
    >
      <div className="t-info aviso" role="note" aria-label="Importador provisional" style={{ marginTop: 0 }}>
        <div>
        <b>Importador provisional de demostración: no apto para censos reales.</b> Tiene problemas conocidos de interpretación:
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          <li>convierte cualquier número distinto de 0 en «Sí» (p. ej. 83) y el vacío en «No»;</li>
          <li>asigna la columna «Franquicia» al nombre de cadena;</li>
          <li>deduce si un local está vacío a partir del nombre.</li>
        </ul>
        Solo se pueden <b>incorporar los archivos de ejemplo simulados</b>. Un archivo subido se puede previsualizar, pero no aplicar. Para los Excel de la Cátedra usa «Análisis previo de importación» (C1a); la importación real llegará con C1b–C1d.
        </div>
      </div>
      <ol className="dat-pasos">
        <li className={paso >= 1 ? 'on' : ''}>Tipo</li>
        <li className={paso >= 2 ? 'on' : ''}>Archivo</li>
        <li className={paso >= 3 ? 'on' : ''}>Revisión previa</li>
      </ol>
      {paso === 1 && (
        <div className="dat-tipos">
          {TIPOS.map(({ t, titulo, d, icono: I }) => (
            <button
              key={t}
              className="dat-tipo"
              onClick={() => {
                if (t === 'B-itinerarios-kml') {
                  onCerrar();
                  nav('/territorio');
                  useStore.getState().avisar('Usa «Importar KML/KMZ» en el panel de itinerarios.', 'info');
                } else if (t === 'E-conciliacion') {
                  onCerrar();
                  nav('/oficina?vista=dudosos');
                } else setTipo(t);
              }}
            >
              <I size={20} />
              <span className="esp"><b>{titulo}</b><span className="muted">{d}</span></span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      )}
      {paso === 2 && (
        <div className="col" style={{ gap: 12 }}>
          {tipo === 'C-excel-itinerario' && (
            <div className="campo">
              <label>Itinerario al que pertenece el archivo</label>
              <select className="input" value={itId} onChange={(e) => setItId(e.target.value)}>
                <option value="">Elige itinerario…</option>
                {its.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.nombre}</option>)}
              </select>
            </div>
          )}
          {tipo === 'A-censo-historico' && (
            <div className="campo" style={{ maxWidth: 200 }}>
              <label>Año del censo</label>
              <input className="input num" type="number" value={anio} onChange={(e) => setAnio(+e.target.value)} />
            </div>
          )}
          <label className="kml-drop">
            <FileUp size={26} />
            <b>Selecciona un CSV (exportado de Excel)</b>
            <span className="muted">Separador «;» o «,». Se procesa en el navegador. La calle puede figurar solo en la primera fila de cada bloque.</span>
            <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) cargarTexto(f.name, await f.text(), false); }} />
          </label>
          <button
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            disabled={tipo === 'C-excel-itinerario' && !itId}
            onClick={() => (tipo === 'A-censo-historico' ? cargarTexto('censo_historico_EJEMPLO_SIMULADO.csv', csvEjemploHistorico(db, municipio.id), true) : cargarTexto(`${db.itinerarios[itId]?.codigo ?? 'itinerario'}_EJEMPLO_SIMULADO.csv`, csvEjemploItinerario(db, db.itinerarios[itId || its[0]?.id]), true))}
          >
            <FlaskConical size={15} /> Usar un archivo de ejemplo (simulado)
          </button>
          <p className="muted" style={{ fontSize: 12 }}>Un CSV subido solo se previsualiza: este importador provisional no lo incorpora a la base de datos.</p>
        </div>
      )}
      {paso === 3 && parsed && (
        <div className="col" style={{ gap: 12 }}>
          <div className="fila" style={{ flexWrap: 'wrap' }}>
            <b>{archivo!.nombre}</b>
            {archivo!.simulado ? <Sim texto="Archivo simulado" /> : <span className="chip aviso" role="status">Solo previsualización: un archivo subido no se puede incorporar con el importador provisional</span>}
            <span className="muted">{parsed.filas.length} filas · separador «{parsed.separador === '\t' ? 'tab' : parsed.separador}»</span>
          </div>
          <details open={Object.keys(mapa).length < 4}>
            <summary className="rotulo sin-linea" style={{ cursor: 'pointer' }}>Correspondencia de columnas ({Object.keys(mapa).length} reconocidas)</summary>
            <div className="dat-mapeo">
              {(Object.keys(CAMPOS) as CampoCanonico[]).map((k) => (
                <label key={k} className="campo">
                  <span className="etq">{k}</span>
                  <select className="input" value={mapa[k] ?? ''} onChange={(e) => setMapa({ ...mapa, [k]: e.target.value === '' ? undefined : +e.target.value })}>
                    <option value="">— no importar —</option>
                    {parsed.cabecera.map((c, i) => <option key={i} value={i}>{c}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </details>
          <div className="fila" style={{ flexWrap: 'wrap' }}>
            {Object.entries(cuentas).map(([k, v]) => <span key={k} className={`chip ${CLASE_TXT[k as ClaseDiff].c}`}>{v} · {CLASE_TXT[k as ClaseDiff].t}</span>)}
          </div>
          <div className="dat-tabla scroll-fino" style={{ maxHeight: 340 }}>
            <table className="tabla">
              <thead><tr><th>Fila</th><th>Calle</th><th>Nº</th><th>Nombre</th><th>Resultado</th><th>Detalle</th></tr></thead>
              <tbody>
                {diff.map((f) => (
                  <tr key={f.fila}>
                    <td className="mono muted">{f.fila}</td>
                    <td>{f.calleTexto}{!f.bruto[parsed.cabecera[mapa.calle ?? 0]] && <span className="muted" title="La calle se arrastra desde la fila anterior"> ↧</span>}</td>
                    <td className="num">{f.numero ?? 's/n'}{f.sufijo ? ` ${f.sufijo}` : ''}</td>
                    <td>{f.vacio ? <i className="muted">Vacío{f.metros ? ` · ${f.metros} m` : ''}</i> : f.nombre}</td>
                    <td><span className={`chip ${CLASE_TXT[f.clase].c}`}>{CLASE_TXT[f.clase].t}</span></td>
                    <td style={{ fontSize: 12 }}>{f.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
