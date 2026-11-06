import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { AlertTriangle, LockKeyhole } from 'lucide-react';
import { Shell } from '../../components/Shell';
import CampanasPage from '../campaigns/CampanasPage';
import DatosRealPage from './DatosRealPage';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import { clienteServidor } from '../../store/clienteSupabase';
import { AlmacenSupabase } from '../../store/almacenSupabase';
import { verificarEspacio, personaEspacio } from '../../domain/espacios';
import type { BaseDatos } from '../../domain/db';
import type { Rol } from '../../domain/types';

const MEDINA_REAL = 'real-medina-del-campo-2026';

interface LecturaReal {
  db: BaseDatos;
  personaId: string;
  rol: Rol;
  version: number;
}

/**
 * Primera unión, SOLO CONSULTA, de la interfaz completa con los datos auténticos.
 * No adapta ni copia la base real a la demostración: usa su mismo modelo de dominio
 * y la RPC autenticada de Supabase. Las demás áreas permanecen sin escrituras.
 */
export default function RealApp() {
  const [lectura, setLectura] = useState<LecturaReal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [campanaId, setCampanaId] = useState('');

  useEffect(() => {
    let vigente = true;
    const cargar = async () => {
      setCargando(true);
      setError(null);
      try {
        const cliente = clienteServidor();
        if (!cliente) throw new Error('Este despliegue no tiene configurada la conexión a Supabase.');
        const { data, error: errorSesion } = await cliente.auth.getSession();
        if (errorSesion || !data.session?.user) throw new Error('No hay una sesión autorizada. Entre primero en «Espacios en el servidor» para iniciar sesión.');
        const remoto = new AlmacenSupabase(cliente, MEDINA_REAL);
        const { db, info } = await remoto.leer();
        if (!db || info.tipo !== 'real' || info.espacioId !== MEDINA_REAL || db.meta.espacioId !== MEDINA_REAL) {
          throw new Error('El espacio leído no coincide con el censo real de Medina. No se muestra ninguna base alternativa.');
        }
        const problemas = verificarEspacio(db, 'real');
        if (problemas.length || personaEspacio(db)?.id !== info.personaId) {
          throw new Error('No se ha podido verificar la identidad o integridad del espacio real.');
        }
        const rol = info.rol as Rol;
        if (!['administrador', 'coordinador', 'revisor', 'investigador'].includes(rol)) {
          throw new Error('La cuenta no dispone de un rol válido en ULIT Censo.');
        }
        if (vigente) setLectura({ db, personaId: info.personaId, rol, version: info.version });
      } catch (e) {
        if (vigente) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (vigente) setCargando(false);
      }
    };
    void cargar();
    return () => { vigente = false; };
  }, []);

  const elegida = lectura?.db.campanas[campanaId] ? campanaId
    : Object.values(lectura?.db.campanas ?? {}).sort((a, b) => b.anio - a.anio)[0]?.id ?? '';
  const fuente = useMemo(() => lectura && elegida ? ({
    db: lectura.db,
    campanaId: elegida,
    personaId: lectura.personaId,
    roles: [lectura.rol] as Rol[],
    soloLectura: true as const,
    elegirCampana: setCampanaId,
    // Guardia de seguridad: NUNCA escribe ni en IndexedDB demo ni en Supabase.
    aplicar: () => false,
  }) : null, [lectura, elegida]);

  if (cargando) return <main className="pagina" role="status"><h1>Abriendo ULIT Censo con datos reales…</h1><p>Verificando sesión y lectura de Supabase.</p></main>;
  if (error || !fuente) {
    return <main className="pagina">
      <h1>Acceso al censo real</h1>
      <p role="alert"><AlertTriangle size={16} /> {error ?? 'No hay campañas reales disponibles.'}</p>
      <p>Los datos simulados no sustituyen nunca a los reales cuando falla el acceso.</p>
      <Link className="btn primario" to="/espacios?volver=real">Iniciar sesión y volver a la aplicación completa</Link>
    </main>;
  }
  return <FuenteOficinaContext.Provider value={fuente}>
    <Routes>
      <Route element={<Shell />}>
        <Route path="campanas" element={<>
          <div className="pagina" style={{ paddingBottom: 0 }} role="status">
            <div className="t-info ok"><LockKeyhole size={16} />
              <span><b>DATOS REALES · SOLO CONSULTA.</b> Lectura verificada de Supabase, versión {lectura!.version}. La aplicación completa es la definitiva; aún no están habilitados los cambios ni los módulos restantes.</span>
            </div>
          </div>
          <CampanasPage />
        </>} />
        <Route path="datos" element={<DatosRealPage />} />
        <Route path="*" element={<Navigate to="campanas" replace />} />
      </Route>
    </Routes>
  </FuenteOficinaContext.Provider>;
}
