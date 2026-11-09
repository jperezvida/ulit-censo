import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Search, ShieldCheck } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { codigoItinerarioExcel, filaPreviaExcel, prepararExcelReal, validarDestinoExcel, type PreparacionExcelReal } from '../../domain/flujoExcelReal';
import { LIMITES_XLSX } from '../../domain/xlsx/lector';
import { leerBytes } from '../espacios/leerArchivo';
import { fmt } from '../../components/ui';

/**
 * Misma aplicación completa, MISMO importador C1/G4 de IT1.
 * En esta etapa no habilita escritura: los bytes solo viven en la memoria
 * de esta pestaña y NO pasan a Supabase, IndexedDB, logs ni repositorio.
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
    try {
      if (archivo.size === 0 || archivo.size > LIMITES_XLSX.maxBytesArchivo)
        throw new Error(`Archivo vacío o demasiado grande. Límite: ${fmt(LIMITES_XLSX.maxBytesArchivo / 1048576)} MB.`);
      const bytes = await leerBytes(archivo);
      const res = await prepararExcelReal(db, campana.id, fuente.personaId, archivo.name, bytes, codigo, parte);
      setAnalisis(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }

  if (!permitir) return null;
  return (
    <section className="tarjeta inc-bloque" aria-label="Subir Excel de itinerario" style={{ maxWidth: 1100 }}>
      <h2 style={{ marginTop: 0 }}><FileSpreadsheet size={20} /> Subir Excel de itinerario</h2>
      <p>Seleccione el Excel de IT2, IT3 o cualquier otro itinerario de esta campaña. Se utilizará el mismo importador de IT1, sin crear otra aplicación.</p>
      <div className="t-info aviso" role="status">
        <ShieldCheck size={17} />
        <span><b>Preparación en esta pestaña, sin guardar.</b> Esta pantalla permite revisar ahora el archivo y sus filas. La incorporación definitiva se habilitará después de validar la operación segura del servidor. No se enviarán los bytes del Excel a Supabase.</span>
      </div>
      <div className="col" style={{ gap: 12, marginTop: 16 }}>
        <label className="campo">
          <span>Excel de campo (.xlsx)</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Seleccionar Excel de itinerario"
            onChange={(e) => {
              const elegido = e.target.files?.[0] ?? null;
              setArchivo(elegido);
              setCodigo(elegido ? (codigoItinerarioExcel(elegido.name) ?? '') : '');
              setParte(false); setAnalisis(null); setError(null); setBusqueda(''); setVerTodas(false);
              e.target.value = '';
            }} />
        </label>
        {archivo && <>
          <p style={{ margin: 0 }}><b>{archivo.name}</b> · {fmt(archivo.size)} bytes</p>
          <label className="campo" style={{ maxWidth: 270 }}>
            <span>Itinerario al que pertenece (confírmelo)</span>
            <input className="input" value={codigo} maxLength={5} placeholder="IT2"
              aria-label="Código del itinerario"
              onChange={(e) => { setCodigo(e.target.value.toUpperCase().replace(/\s/g, '')); setAnalisis(null); }} />
          </label>
          <div className="t-info">
            {valida.itinerarioId ? `Se utilizará el itinerario ${valida.codigo} existente en la campaña.`
              : `Se preparará ${valida.codigo || 'el itinerario elegido'} como itinerario nuevo. No se creará en el servidor hasta confirmar una importación autorizada.`}
          </div>
          <label className="fila" style={{ gap: 10, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={parte} onChange={(e) => { setParte(e.target.checked); setAnalisis(null); }}
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
        <div className="muted" style={{ fontSize: 12 }}>
          Hoja analizada: {informe.nombre} · IT: {informe.itinerario} · SHA-256: <code>{informe.sha256 || 'No calculado'}</code>
        </div>
        {informe.avisos.length > 0 && <div>
          <b>Incidencias y decisiones pendientes ({informe.avisos.length})</b>
          <ul style={{ paddingLeft: 22, marginTop: 8 }}>{informe.avisos.slice(0, 15).map((aviso, i) => <li key={i}>{aviso}</li>)}</ul>
          {informe.avisos.length > 15 && <p className="muted">Hay {informe.avisos.length - 15} avisos adicionales. Es necesario revisarlos antes de incorporar.</p>}
        </div>}
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
        <div className="t-info aviso">
          <ShieldCheck size={17} />
          <span><b>Siguiente etapa: incorporación autorizada a Supabase y trabajo directo en Oficina.</b> Todavía no existe una función general de guardado para IT2 y siguientes. Esta vista previa no debe interpretarse como una importación realizada.</span>
        </div>
      </div>}
    </section>
  );
}
