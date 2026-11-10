import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Search, ShieldCheck } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { codigoItinerarioExcel, filaPreviaExcel, prepararExcelReal, validarDestinoExcel, type PreparacionExcelReal } from '../../domain/flujoExcelReal';
import { LIMITES_XLSX } from '../../domain/xlsx/lector';
import { leerBytes } from '../espacios/leerArchivo';
import { fmt } from '../../components/ui';
import { descargar } from '../../domain/exportacion';
import { clienteServidor } from '../../store/clienteSupabase';
import { consultarCapacidadExcel, descargarCopiaPreviaExcel, guardarExcelReal, prepararCambiosExcel, diagnosticarTamanoExcel, MAX_CAMBIOS_EXCEL_REAL, type DiagnosticoTamanoExcel, type CapacidadExcelReal, type GuardadoExcelReal } from '../../store/importacionExcelReal';

/**
 * Mismo importador de IT1. El Excel se procesa en memoria; únicamente las
 * ENTIDADES confirmadas viajan por la RPC acotada, tras respaldo externo.
 * Si 0009 no está instalada, solo se permite analizar: no se intenta guardar.
 */
export default function ExcelItinerariosReal() {
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [codigo, setCodigo] = useState('');
  const [parte, setParte] = useState(false);
  const [analisis, setAnalisis] = useState<PreparacionExcelReal | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [verTodas, setVerTodas] = useState(false);
  const [capacidad, setCapacidad] = useState<CapacidadExcelReal | null>(null);
  const [respaldo, setRespaldo] = useState<{id:string;version:number}|null>(null);
  const [respaldoConfirmado, setRespaldoConfirmado] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [guardado, setGuardado] = useState<GuardadoExcelReal | null>(null);
  const [avisoRecarga, setAvisoRecarga] = useState<string | null>(null);
  const [tamanoPlan, setTamanoPlan] = useState<DiagnosticoTamanoExcel | null>(null);

  const valida = useMemo(() => campana
    ? validarDestinoExcel(db, campana.id, codigo, parte)
    : { error: 'Seleccione la campaña de 2026.', yaIncorporado: false, itinerarioId: null, codigo: '' },
    [db, campana, codigo, parte]);
  const permitir = db.meta.espacio === 'real' && campana?.anio === 2026 &&
    campana?.tipo === 'actualizacion' && fuente?.soloLectura === true;
  const informe = analisis?.lote.archivos[0];
  const registros = useMemo(() => {
    if (!analisis) return [];
    const q = busqueda.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    return analisis.filasNuevas.filter((r) => {
      if (!q) return true;
      return Object.values({ ...filaPreviaExcel(r), ...r.datos }).join(' ').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(q);
    });
  }, [analisis, busqueda]);
  const visibles = verTodas ? registros : registros.slice(0, 50);

  async function analizar() {
    if (!permitir || !campana || !fuente || !archivo || !!valida.error || ocupado) return;
    setOcupado(true); setError(null); setAnalisis(null); setVerTodas(false); setBusqueda('');
    setCapacidad(null); setRespaldo(null); setRespaldoConfirmado(false); setConfirmado(false); setGuardado(null); setTamanoPlan(null);
    try {
      if (archivo.size === 0 || archivo.size > LIMITES_XLSX.maxBytesArchivo)
        throw new Error(`Archivo vacío o demasiado grande. Límite: ${fmt(LIMITES_XLSX.maxBytesArchivo / 1048576)} MB.`);
      const bytes = await leerBytes(archivo);
      const res = await prepararExcelReal(db, campana.id, fuente.personaId, archivo.name, bytes, codigo, parte);
      setAnalisis(res);
      if (res.lote.aplicable && res.lote.dbResultado) {
        // Mostrar cuántas entidades/bytes genera ESTE Excel, sin copiar su contenido.
        // El diagnóstico se conserva aunque el guardado se bloquee.
        setTamanoPlan(diagnosticarTamanoExcel(db, res.lote.dbResultado));
        prepararCambiosExcel(db, res.lote.dbResultado, res.codigo, res.huella, parte);
        const cliente = clienteServidor();
        if (cliente) setCapacidad(await consultarCapacidadExcel(cliente));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }


  async function prepararRespaldo() {
    if (!analisis?.lote.aplicable || !capacidad?.habilitada || !fuente?.versionReal ||
      capacidad.version !== fuente.versionReal || ocupado) return;
    const cliente=clienteServidor();
    if(!cliente) return setError('No hay conexión segura con Supabase.');
    setOcupado(true);setError(null);setRespaldo(null);setRespaldoConfirmado(false);setConfirmado(false);
    try {
      const b=await descargarCopiaPreviaExcel(cliente,db,fuente.versionReal,analisis.codigo);
      descargar(b.nombre,b.contenido,'application/json');
      setRespaldo({id:b.id,version:fuente.versionReal});
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setOcupado(false);}
  }

  async function guardar() {
    if(!analisis?.lote.aplicable || !analisis.lote.dbResultado || !informe ||
      !capacidad?.habilitada || !fuente?.recargarReal || !fuente.versionReal ||
      capacidad.version!==fuente.versionReal ||
      !respaldo || respaldo.version!==fuente.versionReal ||
      !respaldoConfirmado || !confirmado || ocupado) return;
    const cliente=clienteServidor();
    if(!cliente) return setError('No hay conexión segura con Supabase.');
    setOcupado(true);setError(null);setAvisoRecarga(null);
    try {
      const r=await guardarExcelReal(cliente,db,analisis.lote.dbResultado,
        fuente.versionReal,analisis.codigo,informe.sha256,parte);
      // La RPC ha confirmado el COMMIT. Desactivar cualquier posibilidad
      // de reenvío ANTES de recargar la fuente, que puede agotar su propio timeout.
      setGuardado(r);
      setArchivo(null);setAnalisis(null);setRespaldo(null);
      setCapacidad(null);setConfirmado(false);setRespaldoConfirmado(false);
      try {
        await fuente.recargarReal();
      } catch {
        setAvisoRecarga('El Excel se ha guardado en el servidor, pero la recarga de la pantalla ha fallado o agotado su tiempo. Actualice la página para consultar los datos. No repita la importación.');
      }
    }catch(e){
      setError((e instanceof Error?e.message:String(e))+
        ' No repita la importación sin consultar primero el estado del servidor y sus registros.');
    }finally{setOcupado(false);}
  }

  if (!permitir) return null;
  return (
    <section className="tarjeta dat-upload" aria-label="Subir Excel de itinerario">
      <div className="dat-upload-cab">
        <div>
          <div className="rotulo sin-linea">Nueva incorporación</div>
          <h2><FileSpreadsheet size={21} /> Subir Excel de itinerario</h2>
          <p>Seleccione el Excel de IT2, IT3 o cualquier otro itinerario de la campaña 2026 y revise su contenido antes de guardarlo.</p>
        </div>
        <span className="dat-upload-etapa">Análisis previo</span>
      </div>
      <div className="dat-pasos-subida" aria-label="Proceso de importación">
        <span><b>1</b> Seleccionar Excel</span>
        <span><b>2</b> Revisar datos</span>
        <span><b>3</b> Confirmar guardado</span>
      </div>
      <details className="dat-reglas">
        <summary>Seguridad y límites de esta operación</summary>
        <p>Los bytes del XLSX permanecen en esta pestaña. El servidor solo puede recibir las entidades revisadas y confirmadas si la migración 0009 está autorizada y activa.</p>
        <p>Máximo {fmt(MAX_CAMBIOS_EXCEL_REAL.entidades)} entidades, {(MAX_CAMBIOS_EXCEL_REAL.bytes/1048576).toFixed(2)} MiB y {fmt(MAX_CAMBIOS_EXCEL_REAL.filas)} filas por operación. IT2 se analiza y se guarda íntegro solo si sus relaciones y el servidor superan todas las validaciones.</p>
      </details>
      <div className="dat-subida-form">
        <label className="campo dat-archivo-input">
          <span>Seleccionar Excel de campo (.xlsx)</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Seleccionar Excel de itinerario"
            onChange={(e) => {
              const elegido = e.target.files?.[0] ?? null;
              setArchivo(elegido);
              setCodigo(elegido ? (codigoItinerarioExcel(elegido.name) ?? '') : '');
              setParte(false); setAnalisis(null); setError(null); setBusqueda(''); setVerTodas(false);
              setCapacidad(null);setRespaldo(null);setRespaldoConfirmado(false);setConfirmado(false);setGuardado(null);setTamanoPlan(null);
              e.target.value = '';
            }} />
        </label>
        {archivo && <>
          <p style={{ margin: 0 }}><b>{archivo.name}</b> · {fmt(archivo.size)} bytes</p>
          <label className="campo dat-codigo-input">
            <span>Itinerario al que pertenece (confírmelo)</span>
            <input className="input" value={codigo} maxLength={5} placeholder="IT2"
              aria-label="Código del itinerario"
              onChange={(e) => { setCodigo(e.target.value.toUpperCase().replace(/\s/g, '')); setAnalisis(null);setRespaldo(null);setCapacidad(null);setTamanoPlan(null); }} />
          </label>
          <div className="t-info">
            {valida.itinerarioId ? `Se utilizará el itinerario ${valida.codigo} existente en la campaña.`
              : `Se preparará ${valida.codigo || 'el itinerario elegido'} como itinerario nuevo. No se creará en el servidor hasta confirmar una importación autorizada.`}
          </div>
          <label className="fila" style={{ gap: 10, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={parte} onChange={(e) => { setParte(e.target.checked); setAnalisis(null);setCapacidad(null);setRespaldo(null);setTamanoPlan(null); }}
              aria-label="Parte adicional de un itinerario ya importado" />
            <span>Este archivo es una <b>parte adicional</b> de un itinerario ya incorporado (por ejemplo, IT5 parte 2). No marcar para sustituir o corregir el archivo original.</span>
          </label>
          {valida.error && <div className="t-info aviso" role="alert"><AlertTriangle size={15} />{valida.error}</div>}
          <div>
            <button className="btn primario" disabled={!!valida.error || ocupado} onClick={() => void analizar()}>
              {ocupado ? 'Leyendo y comparando…' : `Analizar Excel de ${valida.codigo || 'itinerario'}`}
            </button>
          </div>
        </>}
        {error && <div className="t-info error" role="alert"><AlertTriangle size={15} />{error}</div>}
      </div>
      {guardado && <div className="t-info ok" role="status"><CheckCircle2 size={16} />
        <span><b>{guardado.itinerario} guardado y confirmado por el servidor.</b> {fmt(guardado.filas)} filas nuevas, versión {guardado.version}. La escritura general vuelve a estar bloqueada. <Link to="/oficina/sin-local">Abrir los registros pendientes en Oficina</Link> · <Link to="/oficina">Ir a Oficina</Link>.</span>
      </div>}
      {(avisoRecarga || guardado?.verificacionPendiente) && <div className="t-info aviso" role="status">
        <AlertTriangle size={16}/><span>{avisoRecarga || 'El servidor confirmó la importación, pero la comprobación adicional de versión no ha respondido. Actualice la página para consultar el estado. No repita la importación.'}</span>
      </div>}
      {analisis && informe && <div className="col" style={{ gap: 14, marginTop: 18 }} aria-label="Resultado de análisis de itinerario">
        <div className={`t-info ${analisis.lote.aplicable ? 'ok' : 'aviso'}`} role="status">
          {analisis.lote.aplicable ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          <span>{analisis.lote.aplicable
            ? `Excel de ${analisis.codigo} preparado para revisión. Todavía NO está guardado.`
            : 'Hay incidencias que impiden incorporar este archivo. No se ha guardado.'}</span>
        </div>
        <div className="ap-resumen" aria-label="Resumen del Excel preparado">
          <div><span className="muted">Filas</span><b>{fmt(analisis.lote.totalFilas)}</b></div>
          <div><span className="muted">Con local propuesto</span><b>{fmt(informe.vinculados)}</b></div>
          <div><span className="muted">Pendientes</span><b>{fmt(analisis.lote.totalPendientes)}</b></div>
          <div><span className="muted">Cruces</span><b>{fmt(informe.cruces)}</b></div>
        </div>
        {tamanoPlan && <section aria-label="Diagnóstico de tamaño del plan" className={`t-info ${tamanoPlan.excedeEntidades || tamanoPlan.excedeBytes || tamanoPlan.excedeFilas ? 'aviso' : 'ok'}`}>
          <div style={{ width: '100%', minWidth: 0 }}>
            <strong>Dimensión real de la operación (no del archivo XLSX)</strong>
            <div className="ap-resumen" style={{ marginTop: 10, marginBottom: 10 }}>
              <div><span>Entidades nuevas</span><b>{fmt(tamanoPlan.entidades)} / {fmt(tamanoPlan.limiteEntidades)}</b></div>
              <div><span>Datos preparados</span><b>{(tamanoPlan.bytes / 1048576).toFixed(2)} / {(tamanoPlan.limiteBytes / 1048576).toFixed(2)} MiB</b></div>
              <div><span>Filas originales</span><b>{fmt(tamanoPlan.filas)} / {fmt(tamanoPlan.limiteFilas)}</b></div>
            </div>
            {(tamanoPlan.excedeEntidades || tamanoPlan.excedeBytes || tamanoPlan.excedeFilas) &&
              <p style={{ margin: '8px 0' }}><b>Guardado bloqueado por:</b> {[
                tamanoPlan.excedeEntidades ? 'número de entidades' : null,
                tamanoPlan.excedeBytes ? 'volumen de datos' : null,
                tamanoPlan.excedeFilas ? 'número de filas' : null,
              ].filter(Boolean).join(', ')}. El análisis se conserva; no se han enviado datos.</p>}
            <details>
              <summary>Ver desglose de entidades por tipo</summary>
              <p className="muted" style={{ margin: '8px 0' }}>
                {tamanoPlan.colecciones.map((c) => `${c.nombre}: ${fmt(c.cantidad)}`).join(' · ')}
              </p>
            </details>
          </div>
        </section>}
        <div className="muted" style={{ fontSize: 12 }}>
          Hoja analizada: {informe.nombre} · IT: {informe.itinerario} · SHA-256: <code>{informe.sha256 || 'No calculado'}</code>
        </div>
        {informe.avisos.length > 0 && <div>
          <b>Incidencias y decisiones pendientes ({informe.avisos.length})</b>
          <ul style={{ paddingLeft: 22, marginTop: 8 }}>{informe.avisos.slice(0, 15).map((aviso, i) => <li key={i}>{aviso}</li>)}</ul>
          {informe.avisos.length > 15 && <p className="muted">Hay {informe.avisos.length - 15} avisos adicionales. Es necesario revisarlos antes de incorporar.</p>}
        </div>}
        {(informe.detallesCruces?.length ?? 0) > 0 && <details className="t-info aviso">
          <summary><strong>Ver {fmt(informe.detallesCruces!.length)} cruces documentales con otros itinerarios</strong></summary>
          <p className="muted">Coincidencias por calle y portal en los archivos originales. No prueban que sea el mismo local ni autorizan cambios de estado. Pendientes de Oficina.</p>
          <ul style={{ paddingLeft: 22 }}>
            {informe.detallesCruces!.map((c, i) => <li key={i}>Fila {c.fila} · {c.detalle}</li>)}
          </ul>
        </details>}
        {analisis.filasNuevas.length > 0 && <>
          <h3 style={{ margin: 0 }}>Filas originales del Excel ({fmt(analisis.filasNuevas.length)})</h3>
          <label className="campo" style={{ maxWidth: 450 }}>
            <span>Buscar una fila, negocio, calle o actividad</span>
            <div className="fila" style={{ gap: 8 }}><Search size={15} /><input className="input" aria-label="Buscar en Excel preparado"
              value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setVerTodas(false); }} /></div>
          </label>
          <div className="tabla-scroll">
            <table className="tabla ap-tabla" aria-label="Vista previa de filas Excel">
              <thead><tr><th>Fila</th><th>Dirección</th><th>N.º</th><th>Establecimiento</th><th>Actividad</th><th>Estado original</th></tr></thead>
              <tbody>{visibles.map((r) => { const d = filaPreviaExcel(r); return <tr key={r.id}>
                <td>{d.fila}</td><td>{d.calle || '—'}</td><td>{d.numero || '—'}</td>
                <td>{d.negocio || '—'}</td><td>{d.actividad || '—'}</td>
                <td>{d.vacio === '1' ? 'Vacío según Excel' : d.vacio === '0' ? 'Ocupado según Excel' : 'Por revisar'}</td>
              </tr>; })}</tbody>
            </table>
          </div>
          <p className="muted">{fmt(registros.length)} filas coinciden con la búsqueda; mostrando {fmt(visibles.length)}. Los registros originales no se modifican ni se asocian automáticamente a 2025.</p>
          {registros.length > 50 && !verTodas && <button className="btn s" onClick={() => setVerTodas(true)}>Mostrar todas las filas del resultado</button>}
        </>}
        {!capacidad?.habilitada ? <div className="t-info aviso" role="status">
          <ShieldCheck size={17} />
          <span><b>Guardado todavía no disponible en este servidor.</b> La migración 0009 no está activada, el usuario carece de permisos o la base cambió. Puede revisar el Excel, pero no se creará ningún registro hasta completar las pruebas y autorizar la activación.</span>
        </div> : <section className="tarjeta inc-bloque" aria-label="Confirmar incorporación real" style={{padding:16}}>
          <h3 style={{marginTop:0}}>Incorporar {analisis.codigo} a la única aplicación</h3>
          <p>Esta operación añadirá {fmt(analisis.lote.totalFilas)} filas de origen, con {fmt(analisis.lote.totalPendientes)} pendientes de conciliación. Las entidades existentes y el histórico de 2025 no se alterarán.</p>
          <button className="btn s" disabled={ocupado} onClick={() => void prepararRespaldo()}>
            {ocupado ? 'Comprobando…' : respaldo ? 'Descargar de nuevo respaldo previo' : '1. Descargar respaldo previo y comprobarlo'}
          </button>
          {respaldo && <div className="col" style={{gap:10,marginTop:12}}>
            <p className="muted" style={{margin:0}}>Copia previa identificada: <code>{respaldo.id}</code> · versión {respaldo.version}. Confirme que el archivo JSON se ha descargado y está guardado fuera de Supabase.</p>
            <label className="fila" style={{gap:8,alignItems:'flex-start'}}>
              <input type="checkbox" checked={respaldoConfirmado} onChange={(e)=>setRespaldoConfirmado(e.target.checked)}
                aria-label="He guardado el respaldo externo" />
              He comprobado que conservo el respaldo previo fuera de Supabase.
            </label>
            <label className="fila" style={{gap:8,alignItems:'flex-start'}}>
              <input type="checkbox" checked={confirmado} onChange={(e)=>setConfirmado(e.target.checked)}
                aria-label="Autorizo incorporación del Excel" />
              He revisado el archivo y autorizo esta incorporación de {analisis.codigo}.
            </label>
            <button className="btn primario" disabled={ocupado || !confirmado || !respaldoConfirmado}
              onClick={() => void guardar()}>
              {ocupado ? 'Guardando y verificando…' : `2. Guardar Excel ${analisis.codigo} en Supabase`}
            </button>
          </div>}
        </section>}
      </div>}
    </section>
  );
}
