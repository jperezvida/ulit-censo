import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AlertTriangle, LockKeyhole, RefreshCw } from 'lucide-react';
import { FuenteOficinaContext } from '../../store/fuenteOficina';
import { clienteServidor } from '../../store/clienteSupabase';
import { AlmacenSupabase } from '../../store/almacenSupabase';
import { verificarEspacio, personaEspacio } from '../../domain/espacios';
import type { BaseDatos } from '../../domain/db';
import type { Rol } from '../../domain/types';

const ESPACIO_REAL = 'real-medina-del-campo-2026';

interface Lectura {
  db: BaseDatos;
  personaId: string;
  rol: Rol;
  version: number;
}

/**
 * ÚNICA aplicación de usuario: provee datos auténticos a TODOS los componentes
 * originales (Campañas, Territorio, Oficina, Datos, Análisis, Visualización).
 * No inicializa nunca la base ficticia ni copia datos del servidor a la demo.
 */
export default function AplicacionUnica() {
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sinSesion, setSinSesion] = useState(false);
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [campanaId, setCampanaId] = useState('');

  const recargar = useCallback(async () => {
    const cliente = clienteServidor();
    if (!cliente) throw new Error('No está configurada la conexión institucional a Supabase.');
    const { data, error: falloSesion } = await cliente.auth.getSession();
    if (falloSesion) throw new Error('No se ha podido validar la sesión.');
    if (!data.session?.user) { setSinSesion(true); throw new Error('Inicie sesión para entrar en ULIT Censo.'); }
    setSinSesion(false);
    const { db, info } = await new AlmacenSupabase(cliente, ESPACIO_REAL).leer();
    if (!db || info.tipo !== 'real' || info.espacioId !== ESPACIO_REAL ||
        db.meta.espacioId !== ESPACIO_REAL || verificarEspacio(db, 'real').length ||
        personaEspacio(db)?.id !== info.personaId ||
        !['administrador','coordinador','revisor','investigador'].includes(info.rol)) {
      throw new Error('La cuenta no tiene acceso a un espacio auténtico verificable.');
    }
    setLectura({ db, rol: info.rol as Rol, personaId: info.personaId, version: info.version });
  }, []);

  useEffect(() => {
    let vigente = true;
    void recargar().catch((e) => { if (vigente) { setLectura(null); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [recargar]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    const cliente = clienteServidor();
    if (!cliente || !correo || !contrasena) return;
    setCargando(true); setError(null);
    try {
      const { error: fallo } = await cliente.auth.signInWithPassword({ email: correo, password: contrasena });
      if (fallo) throw new Error('No se ha podido iniciar sesión con esa cuenta.');
      await recargar();
      setContrasena('');
    } catch (e) { setLectura(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { setCargando(false); }
  };

  const reintentar = async () => {
    setCargando(true); setError(null);
    try { await recargar(); }
    catch (e) { setLectura(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { setCargando(false); }
  };

  const actual = lectura?.db.campanas[campanaId] ? campanaId :
    Object.values(lectura?.db.campanas ?? {}).sort((a,b) => b.anio - a.anio)[0]?.id ?? '';
  const fuente = useMemo(() => lectura && actual ? ({
    db: lectura.db, campanaId: actual, personaId: lectura.personaId,
    roles: [lectura.rol] as Rol[], soloLectura: true as const,
    versionReal: lectura.version, elegirCampana: setCampanaId, recargarReal: recargar,
    // Ninguna escritura genérica sobre datos auténticos. IT1/2026 utiliza RPC específica.
    aplicar: () => false,
  }) : null, [lectura, actual, recargar]);

  if (cargando) return <main className="pagina" role="status"><h1>ULIT Censo</h1><p>Verificando sesión y datos auténticos…</p></main>;
  if (!fuente) return <main className="pagina" style={{ maxWidth: 640, margin: '44px auto' }}>
    <div className="marca-ulit grande"><b>ULIT</b><span>Censo</span></div>
    <h1>Acceso a ULIT Censo</h1>
    <p>Una única aplicación completa, conectada al servidor de la Cátedra.</p>
    {error && <div role="alert" className="t-info error"><AlertTriangle size={16} />{error}</div>}
    {sinSesion ? <form onSubmit={(e) => void entrar(e)} className="tarjeta" style={{ padding: 20 }}>
      <label className="campo"><span>Correo de la cuenta autorizada</span>
        <input className="input" type="email" autoComplete="username" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
      </label>
      <label className="campo"><span>Contraseña</span>
        <input className="input" type="password" autoComplete="current-password" required value={contrasena} onChange={(e) => setContrasena(e.target.value)} />
      </label>
      <button className="btn primario" type="submit"><LockKeyhole size={15} /> Entrar en ULIT Censo</button>
    </form> : <button className="btn primario" onClick={() => void reintentar()}><RefreshCw size={16}/> Comprobar acceso de nuevo</button>}
    <p className="muted">Si no se puede verificar el acceso, nunca se muestran datos ficticios en sustitución de los reales.</p>
  </main>;
  return <FuenteOficinaContext.Provider value={fuente}><Outlet /></FuenteOficinaContext.Provider>;
}
