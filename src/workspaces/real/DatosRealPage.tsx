import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, LockKeyhole } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { crearItinerario, itinerariosDe } from '../../domain/campanaOperativa';
import { prepararLoteItinerarios, type LotePreparado } from '../../domain/loteItinerarios';
import { esArchivoSintetico } from '../../data/xlsxSinteticoC1e';
import { leerBytes } from '../espacios/leerArchivo';
import { fmt } from '../../components/ui';
import { clienteServidor } from '../../store/clienteSupabase';
import { AlmacenSupabase } from '../../store/almacenSupabase';

/**
 * Reutiliza el intérprete G4 en la interfaz COMPLETA. El cliente prepara IT1
 * en MEMORIA: no crea itinerarios en el servidor ni escribe en IndexedDB.
 * La escritura real llegará por una operación de servidor separada y acotada.
 */
export default function DatosRealPage() {
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analisis, setAnalisis] = useState<LotePreparado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [guardado, setGuardado] = useState<string | null>(null);

  const real = fuente?.soloLectura === true && db.meta.espacio === 'real';
  const operativa = campana?.tipo !== 'historico-importado' && campana?.anio === 2026;
  const it1 = campana ? itinerariosDe(db, campana.id).find((i) => i.codigo.toUpperCase() === 'IT1') : undefined;

  const analizar = async () => {
    if (!real || !operativa || !campana || !archivo || !fuente || ocupado) return;
    setOcupado(true);
    setError(null);
    setAnalisis(null);
    setConfirmado(false);
    setGuardado(null);
    try {
      if (!/^.+\.xlsx$/i.test(archivo.name)) throw new Error('Seleccione un Excel .xlsx.');
      const bytes = await leerBytes(archivo);
      if (esArchivoSintetico(bytes)) throw new Error('Los archivos sintéticos no se admiten en la campaña real.');
      // Preparar el itinerario en RAM si todavía no existe: ningún guardado.
      const preparado = it1 ? { db, itinerarioId: it1.id } :
        crearItinerario(db, campana.id, { codigo: 'IT1', nombre: 'Itinerario IT1' }, { prefijo: 'real', porId: fuente.personaId });
      const lote = await prepararLoteItinerarios(preparado.db, campana.id,
        [{ nombre: archivo.name, bytes, itinerarioId: preparado.itinerarioId }], fuente.personaId, false);
      setAnalisis(lote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  };

  const guardarIt1 = async () => {
    const previsto = '7a6d4230a68370cc0bb0245ce68e8c56648be4d89e76531cc0edbd9ab341da61';
    const informe = analisis?.archivos[0];
    if (!real || !operativa || !confirmado || ocupado || !analisis?.aplicable ||
        !analisis.dbResultado || !informe || informe.sha256 !== previsto ||
        analisis.totalFilas !== 105 || analisis.totalPendientes !== 91 || informe.vinculados !== 14 ||
        fuente?.versionReal !== 3 || !fuente.recargarReal) {
      setError('No se cumplen los requisitos de la importación autorizada de IT1. No se ha escrito nada.');
      return;
    }
    const cliente = clienteServidor();
    if (!cliente) { setError('No se puede conectar con Supabase. No se ha escrito nada.'); return; }
    setOcupado(true);
    setError(null);
    try {
      const almacen = new AlmacenSupabase(cliente,'real-medina-del-campo-2026');
      await almacen.importarIt1_2026(db,analisis.dbResultado,informe.sha256);
      await fuente.recargarReal();
      setGuardado('IT1 guardado y verificado en Supabase: 105 filas. La escritura general sigue bloqueada. Las 91 pendientes se han conservado.');
      setArchivo(null);
      setAnalisis(null);
      setConfirmado(false);
    } catch (e) {
      // Si la red falla después del COMMIT, no volver a pulsar sin revisar el
      // espacio real: el servidor puede haber guardado correctamente.
      setError((e instanceof Error ? e.message : String(e)) + ' · No pulse otra vez: compruebe primero el estado de Supabase.');
    } finally { setOcupado(false); }
  };

  const informe = analisis?.archivos[0];
  const listoParaGuardar = !!analisis?.aplicable && !!analisis.dbResultado && !!informe &&
    informe.sha256 === '7a6d4230a68370cc0bb0245ce68e8c56648be4d89e76531cc0edbd9ab341da61' &&
    analisis.totalFilas === 105 && analisis.totalPendientes === 91 &&
    informe.vinculados === 14 && fuente?.versionReal === 3;

  return <div className="pagina" aria-label="Datos reales e importación de IT1">
    <div className="pagina-cab">
      <div className="esp">
        <div className="rotulo sin-linea">05 · Datos e importaciones · campaña real</div>
        <h1>Incorporación de Excel · IT1</h1>
        <p>El mismo importador del proyecto, ahora dentro de la aplicación completa. El archivo se analiza en memoria y el servidor recibe únicamente las entidades confirmadas, no los bytes del XLSX.</p>
      </div>
    </div>
    <div className="t-info aviso" role="note">
      <LockKeyhole size={16} />
      <span><b>IT1, escritura única y controlada.</b> La operación autorizada crea primero una copia íntegra, incorpora solamente 105 filas y cierra la escritura en la misma transacción. No modifica el histórico 2025 ni habilita escritura general.</span>
    </div>
    {!real ? <div className="t-info error" role="alert">Abra esta página desde el espacio real de ULIT Censo.</div> :
      !operativa ? <div className="t-info" role="status">Seleccione primero «Censo Medina del Campo 2026» en la barra superior. El histórico 2025 se conserva intacto.</div> :
      <section className="tarjeta inc-bloque" aria-label="Analizar Excel real IT1" style={{ maxWidth: 950 }}>
        <h2><FileSpreadsheet size={19} /> IT1 · Censo Medina del Campo 2026</h2>
        <p className="muted">Seleccione el Excel auténtico de IT1. Se revisan filas, direcciones y pendientes antes de ofrecer una confirmación explícita para guardar.</p>
        <label className="campo"><span>Excel IT1 (.xlsx)</span>
          <input aria-label="Excel auténtico IT1" type="file" accept=".xlsx"
            onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setAnalisis(null); setError(null); setGuardado(null); setConfirmado(false); e.target.value = ''; }} />
        </label>
        {archivo && <p>Archivo seleccionado: <b>{archivo.name}</b></p>}
        <button className="btn primario" disabled={!archivo || ocupado} onClick={() => void analizar()}>
          {ocupado ? 'Analizando Excel…' : 'Analizar IT1 sin guardar'}
        </button>
        {analisis && <div style={{ marginTop: 12 }}>
          <div className={`t-info ${analisis.aplicable ? 'ok' : 'error'}`} role="status">
            {analisis.aplicable ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}
            {analisis.aplicable ? 'Plan de incorporación calculado en memoria.' : 'Hay bloqueos o advertencias que impiden incorporar.'}
          </div>
          <div className="ap-resumen" aria-label="Diagnóstico IT1">
            <div><span className="muted">Filas</span><b>{fmt(analisis.totalFilas)}</b></div>
            <div><span className="muted">Pendientes sin local</span><b>{fmt(analisis.totalPendientes)}</b></div>
            <div><span className="muted">Con local</span><b>{fmt(analisis.archivos[0]?.vinculados ?? 0)}</b></div>
            <div><span className="muted">Cruces</span><b>{fmt(analisis.archivos[0]?.cruces ?? 0)}</b></div>
          </div>
          {analisis.archivos.map((a, i) => <div key={i}>
            <p><b>{a.nombre}</b> · SHA-256: <code>{a.sha256 || 'No calculado'}</code></p>
            {a.avisos.length > 0 && <ul>{a.avisos.map((v, n) => <li key={n}>{v}</li>)}</ul>}
          </div>)}
          {listoParaGuardar && <div className="tarjeta" style={{ marginTop: 14, padding: 16 }}>
            <h3>Confirmación final de IT1 · una sola operación</h3>
            <p>Se añadirán 105 registros de 2026 y 14 locales con dirección inequívoca. Los otros 91 registros se conservarán pendientes de conciliación, sin crear ni asignar locales por suposición.</p>
            <p>La copia interna de seguridad se crea antes de guardar. El histórico 2025 (889 registros) seguirá intacto.</p>
            <label className="fila" style={{ gap: 10, alignItems: 'center' }}>
              <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)}
                aria-label="He revisado y autorizo guardar IT1 de 2026" />
              <span>He revisado el diagnóstico y autorizo guardar exclusivamente IT1 de 2026.</span>
            </label>
            <button className="btn primario" disabled={!confirmado || ocupado} onClick={() => void guardarIt1()}>
              {ocupado ? 'Comprobando, respaldando y guardando…' : 'Incorporar IT1 al servidor (105 filas)'}
            </button>
          </div>}
          {!listoParaGuardar && <p className="t-info aviso">El archivo analizado no coincide exactamente con el IT1 aprobado para la primera carga. No se habilita la escritura.</p>}
        </div>}
        {guardado && <div className="t-info ok" role="status"><CheckCircle2 size={16}/>{guardado}</div>}
        {error && <div className="t-info error" role="alert"><AlertTriangle size={16}/>{error}</div>}
      </section>}
  </div>;
}
