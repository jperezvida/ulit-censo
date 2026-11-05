import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Files, FileUp } from 'lucide-react';
import { useEspacios } from '../../store/espacios';
import { huellaBase, personaEspacio } from '../../domain/espacios';
import { itinerariosDe } from '../../domain/campanaOperativa';
import { itinerarioDesdeNombre, prepararLoteItinerarios, type LotePreparado } from '../../domain/loteItinerarios';
import { esArchivoSintetico } from '../../data/xlsxSinteticoC1e';
import { leerBytes } from './leerArchivo';
import type { Id } from '../../domain/types';

/**
 * Un único análisis para varios Excel de la misma campaña. Ningún archivo se
 * sube al servidor: solo se leen sus bytes en memoria. En ensayo se puede
 * confirmar todo de una sola vez; en real está en solo vista previa hasta que
 * exista una autorización específica para las operaciones de 2026.
 */
export function CargaLoteItinerarios({ campanaId }: { campanaId: Id }) {
  const db = useEspacios((s) => s.db!);
  const tipo = useEspacios((s) => s.tipo);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const itinerarios = itinerariosDe(db, campanaId);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [asignaciones, setAsignaciones] = useState<Record<number, Id>>({});
  const [partes, setPartes] = useState(false);
  const [analisis, setAnalisis] = useState<{ resultado: LotePreparado; huellaAntes: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  function elegir(files: FileList | null) {
    const lista = Array.from(files ?? []);
    setArchivos(lista);
    setAsignaciones(Object.fromEntries(lista.map((f, i) =>
      [i, itinerarioDesdeNombre(f.name, itinerarios) ?? ''],
    )));
    setPartes(false);
    setAnalisis(null);
    setError(null);
    setMensaje(null);
  }

  const asignados = archivos.length > 0 && archivos.every((_, i) => !!asignaciones[i]);

  async function analizar() {
    if (!asignados || cargando || ocupado) return;
    setCargando(true);
    setAnalisis(null);
    setError(null);
    try {
      const actual = useEspacios.getState().db;
      if (!actual) throw new Error('No hay un espacio abierto.');
      const huellaAntes = huellaBase(actual);
      const lote = [];
      for (const [i, archivo] of archivos.entries()) {
        const bytes = await leerBytes(archivo);
        if (tipo === 'ensayo' && !esArchivoSintetico(bytes))
          throw new Error('En el ensayo solo se admiten XLSX marcados como sintéticos. No se ha guardado ningún dato.');
        lote.push({ nombre: archivo.name, bytes, itinerarioId: asignaciones[i] });
      }
      const personaId = personaEspacio(actual)?.id;
      if (!personaId) throw new Error('Falta la persona responsable.');
      const resultado = await prepararLoteItinerarios(actual, campanaId, lote, personaId, partes);
      setAnalisis({ resultado, huellaAntes });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  async function incorporar() {
    if (tipo !== 'ensayo' || !analisis?.resultado.aplicable || !analisis.resultado.dbResultado || cargando || ocupado) return;
    setCargando(true);
    setError(null);
    try {
      const r = await modificar('Incorporando lote de itinerarios…', (actual) => {
        if (huellaBase(actual) !== analisis.huellaAntes)
          throw new Error('El espacio cambió desde el análisis: vuelva a analizar los Excel para no sobrescribir trabajo.');
        return analisis.resultado.dbResultado!;
      });
      if (!r.ok) throw new Error(r.error);
      setMensaje('Lote incorporado y guardado como una sola operación. Compruebe el nuevo respaldo externo.');
      setAnalisis(null);
      setArchivos([]);
      setAsignaciones({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }

  return <section className="tarjeta inc-bloque" aria-label="Incorporación de varios itinerarios">
    <h3><Files size={16} /> Incorporar varios Excel</h3>
    <p className="muted">Seleccione hasta 30 archivos de esta campaña. Se asignan a IT1, IT2… por su nombre; confirme cada correspondencia antes de analizar. Se revisan juntos, sin fusionar establecimientos ni descartar filas. Los archivos se procesan en este navegador.</p>
    <label className="campo">
      <span>Excel de los itinerarios (selección múltiple)</span>
      <input type="file" accept=".xlsx" multiple aria-label="Excel de los itinerarios" onChange={(e) => { elegir(e.target.files); e.target.value = ''; }} />
    </label>
    {archivos.length > 0 && <>
      <div className="tabla-scroll">
        <table className="tabla ap-tabla" aria-label="Asignación de archivos a itinerarios">
          <thead><tr><th>Archivo</th><th>Itinerario</th></tr></thead>
          <tbody>{archivos.map((a, i) => <tr key={i}>
            <td>{a.name}</td>
            <td><select className="input" aria-label={`Itinerario del archivo ${i + 1}`} value={asignaciones[i] ?? ''}
              onChange={(e) => { setAsignaciones((prev) => ({ ...prev, [i]: e.target.value })); setAnalisis(null); }}>
              <option value="">Elegir itinerario</option>
              {itinerarios.map((it) => <option key={it.id} value={it.id}>{it.codigo} · {it.nombre}</option>)}
            </select></td>
          </tr>)}</tbody>
        </table>
      </div>
      <label className="fila" style={{ alignItems: 'flex-start', gap: 8 }}>
        <input type="checkbox" aria-label="Permitir partes adicionales del mismo itinerario" checked={partes}
          onChange={(e) => { setPartes(e.target.checked); setAnalisis(null); }} />
        <span><b>Hay itinerarios divididos en varios Excel</b> (por ejemplo, IT5 parte 1 y parte 2). Cada archivo queda identificado por su huella; las versiones repetidas se bloquean.</span>
      </label>
      <button className="btn s" disabled={!asignados || archivos.length > 30 || cargando || !!ocupado} onClick={() => void analizar()}>
        <FileUp size={14} /> {cargando ? 'Analizando…' : `Analizar ${archivos.length} Excel`}
      </button>
    </>}
    {analisis && <>
      <div className={`t-info ${analisis.resultado.aplicable ? 'ok' : 'error'}`} role="status">
        {analisis.resultado.aplicable ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        {analisis.resultado.aplicable ? 'Todos los archivos son aplicables.' : 'Lote bloqueado: hay archivos que requieren revisión. No se ha guardado nada.'}
        {' '}Filas: {analisis.resultado.totalFilas}. Pendientes sin local: {analisis.resultado.totalPendientes}.
      </div>
      <div className="tabla-scroll">
        <table className="tabla ap-tabla" aria-label="Análisis conjunto de los itinerarios">
          <thead><tr><th>Archivo</th><th>IT</th><th>Filas</th><th>Con local</th><th>Pendientes</th><th>Cruces</th><th>Estado</th></tr></thead>
          <tbody>{analisis.resultado.archivos.map((a, i) => <tr key={i}>
            <td>{a.nombre}{a.avisos.length > 0 && <div className="muted">{a.avisos.join(' · ')}</div>}</td>
            <td>{a.itinerario}</td><td>{a.filas}</td><td>{a.vinculados}</td><td>{a.pendientes}</td><td>{a.cruces}</td>
            <td>{a.aplicable ? 'Preparado' : 'Bloqueado'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {tipo === 'ensayo' && <button className="btn primario" disabled={!analisis.resultado.aplicable || !!ocupado || cargando} onClick={() => void incorporar()}>
        Incorporar todos los Excel preparados
      </button>}
      {tipo !== 'ensayo' && <div className="t-info aviso">Espacio real: análisis sin guardar. La carga operativa 2026 requiere primero incorporar el histórico 2025 y habilitar su ruta de escritura autorizada; este botón NO se activa por revisar los archivos.</div>}
    </>}
    {mensaje && <div className="t-info ok" role="status"><CheckCircle2 size={14} /> {mensaje}</div>}
    {error && <div className="t-info error" role="alert"><AlertTriangle size={14} /> {error}</div>}
  </section>;
}
