import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, LockKeyhole } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { crearItinerario, itinerariosDe } from '../../domain/campanaOperativa';
import { prepararLoteItinerarios, type LotePreparado } from '../../domain/loteItinerarios';
import { esArchivoSintetico } from '../../data/xlsxSinteticoC1e';
import { leerBytes } from '../espacios/leerArchivo';
import { fmt } from '../../components/ui';

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

  const real = fuente?.soloLectura === true && db.meta.espacio === 'real';
  const operativa = campana?.tipo !== 'historico-importado' && campana?.anio === 2026;
  const it1 = campana ? itinerariosDe(db, campana.id).find((i) => i.codigo.toUpperCase() === 'IT1') : undefined;

  const analizar = async () => {
    if (!real || !operativa || !campana || !archivo || !fuente || ocupado) return;
    setOcupado(true);
    setError(null);
    setAnalisis(null);
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

  return <div className="pagina" aria-label="Datos reales e importación de IT1">
    <div className="pagina-cab">
      <div className="esp">
        <div className="rotulo sin-linea">05 · Datos e importaciones · campaña real</div>
        <h1>Incorporación de Excel · IT1</h1>
        <p>El mismo importador del proyecto, ahora dentro de la aplicación completa. Análisis del Excel auténtico, sin subir sus bytes al servidor.</p>
      </div>
    </div>
    <div className="t-info aviso" role="note">
      <LockKeyhole size={16} />
      <span><b>Consulta y diagnóstico, sin guardar todavía.</b> Supabase mantiene bloqueadas las escrituras de 2026. La incorporación definitiva exigirá autorización y verificación del servidor. El censo histórico 2025 no se modifica.</span>
    </div>
    {!real ? <div className="t-info error" role="alert">Abra esta página desde el espacio real de ULIT Censo.</div> :
      !operativa ? <div className="t-info" role="status">Seleccione primero «Censo Medina del Campo 2026» en la barra superior. El histórico 2025 se conserva intacto.</div> :
      <section className="tarjeta inc-bloque" aria-label="Analizar Excel real IT1" style={{ maxWidth: 950 }}>
        <h2><FileSpreadsheet size={19} /> IT1 · Censo Medina del Campo 2026</h2>
        <p className="muted">Seleccione el Excel de IT1 que tiene actualizado en su ordenador. Primero se revisan filas, direcciones, duplicados y bloqueos. No hay opción de escritura en este paso.</p>
        <label className="campo"><span>Excel IT1 (.xlsx)</span>
          <input aria-label="Excel auténtico IT1" type="file" accept=".xlsx"
            onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setAnalisis(null); setError(null); e.target.value = ''; }} />
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
          <p className="muted">No se ha incorporado nada. Esta vista previa permitirá comprobar el Excel antes de habilitar la ruta de escritura de IT1 en Supabase.</p>
        </div>}
        {error && <div className="t-info error" role="alert"><AlertTriangle size={16}/>{error}</div>}
      </section>}
  </div>;
}
