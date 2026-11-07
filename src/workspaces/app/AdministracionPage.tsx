import { useState } from 'react';
import { Download, FileCheck2, LockKeyhole, LogOut, Upload } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import { clienteServidor } from '../../store/clienteSupabase';
import { crearRespaldo, comprobarRespaldo } from '../../domain/respaldo';
import { sha256Texto } from '../../domain/sha256';
import { descargar } from '../espacios/Respaldo';

/**
 * Herramientas administrativas DENTRO de la aplicación completa.
 * Sustituye el antiguo espacio auxiliar como destino visible.
 * Solo descarga y comprueba; no restaura ni abre escrituras.
 */
export default function AdministracionPage() {
  const { db } = useContexto();
  const fuente = useFuenteOficina();
  const [resultado, setResultado] = useState('');
  const [error, setError] = useState('');
  const administrador = fuente?.roles.includes('administrador') === true;

  const descargarRespaldo = () => {
    setError(''); setResultado('');
    try {
      if (!administrador || db.meta.espacio !== 'real') throw new Error('Acceso de administración requerido.');
      const respaldo = crearRespaldo(db, 'real');
      descargar(respaldo.nombreArchivo, respaldo.texto, 'application/json');
      setResultado(`Archivo descargado: ${respaldo.nombreArchivo}. Selecciónelo en «Comprobar respaldo» antes de darlo por válido.`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const comprobar = async (file?: File) => {
    if (!file) return;
    setError(''); setResultado('');
    try {
      if (!administrador || db.meta.espacio !== 'real') throw new Error('Acceso de administración requerido.');
      const texto = await file.text();
      const result = comprobarRespaldo(texto, 'real');
      if (!result.ok) throw new Error(result.motivo);
      if (result.sobre.espacioId !== db.meta.espacioId ||
          sha256Texto(JSON.stringify(result.db)) !== sha256Texto(JSON.stringify(db))) {
        throw new Error('El archivo es válido, pero NO coincide con el estado actual. No sustituye al respaldo actualizado.');
      }
      setResultado(`Respaldo correcto y completo: coincide con el estado actual (${file.name}).`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const salir = async () => {
    await clienteServidor()?.auth.signOut();
    // Descartar de la memoria de React la lectura real inmediatamente.
    window.location.reload();
  };

  return <div className="pagina">
    <div className="pagina-cab">
      <div className="esp">
        <div className="rotulo sin-linea">Administración · espacio real</div>
        <h1>Seguridad y respaldos</h1>
        <p>Herramientas de administración en la misma aplicación. No existe un segundo entorno de trabajo.</p>
      </div>
    </div>
    {!administrador ? <div className="t-info aviso" role="alert"><LockKeyhole size={16}/> Los respaldos están reservados al administrador del espacio.</div> :
      <>
        <section className="tarjeta" style={{ padding: 20, maxWidth: 950 }}>
          <h2><FileCheck2 size={20}/> Respaldo externo de datos reales</h2>
          <p>Este respaldo incluye los registros originales de 2025 y los itinerarios de 2026 guardados en Supabase. No se comparte con la demostración.</p>
          <p>Estado del servidor: <b>{Object.keys(db.registros).length} registros</b> · {Object.keys(db.importaciones).length} importaciones · {Object.keys(db.itinerarios).length} itinerarios · versión {fuente?.versionReal}.</p>
          <div className="fila" style={{ flexWrap: 'wrap', gap: 12 }}>
            <button className="btn primario" onClick={descargarRespaldo}><Download size={16}/> 1. Descargar respaldo</button>
            <label className="btn"><Upload size={16}/> 2. Comprobar respaldo
              <input type="file" accept=".json,application/json" hidden aria-label="Comprobar respaldo" onChange={(e) => {
                const file = e.target.files?.[0]; e.target.value = '';
                void comprobar(file);
              }} />
            </label>
          </div>
          <p className="muted">La comprobación solo lee el archivo. No restaura, elimina ni modifica ningún registro.</p>
          {resultado && <div className="t-info ok" role="status">{resultado}</div>}
          {error && <div className="t-info error" role="alert">{error}</div>}
        </section>
      </>
    }
    <div style={{ marginTop: 20 }}><button className="btn" onClick={() => void salir()}><LogOut size={16}/> Cerrar sesión</button></div>
  </div>;
}
