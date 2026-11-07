import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Server } from 'lucide-react';
import { clienteServidor } from '../../store/clienteSupabase';
import { AlmacenSupabase, misEspacios } from '../../store/almacenSupabase';
import { useEspacios } from '../../store/espacios';
import { borrarSeleccionRemota } from '../../store/seleccionRemota';

type Espacio = Awaited<ReturnType<typeof misEspacios>>[number];

/**
 * Acceso a los espacios guardados en el servidor de ULIT Censo (Supabase). Solo aparece si la compilación
 * lo configura. Inicia sesión con Supabase Auth; solo se listan los espacios de los que la cuenta es miembro.
 */
export function AccesoServidor() {
  const cliente = clienteServidor();
  const nav = useNavigate();
  const location = useLocation();
  // El retorno solo acepta un destino FIJO de la aplicación completa: no admite URLs arbitrarias.
  const retorno = new URLSearchParams(location.search).get('volver');
  const volverCompleta = retorno === 'real' || retorno === 'datos';
  const destinoCompleta = retorno === 'datos' ? '/real/datos' : '/real/campanas';
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [sesion, setSesion] = useState<string | null>(null);
  const [espacios, setEspacios] = useState<Espacio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!cliente) return;
    void cliente.auth.getSession().then(({ data }) => setSesion(data.session?.user.email ?? null));
  }, [cliente]);
  useEffect(() => {
    if (!cliente || !sesion) return;
    misEspacios(cliente).then(setEspacios, (e) => setError(String(e.message ?? e)));
  }, [cliente, sesion]);
  const accesoReal = !!sesion && espacios?.some((e) => e.tipo === 'real' && e.espacio_id === 'real-medina-del-campo-2026');
  useEffect(() => {
    // Solo retornar automáticamente cuando se llegó desde la aplicación completa
    // y el servidor ha confirmado pertenencia AL espacio real. El acceso auxiliar
    // ordinario sigue disponible para respaldos y tareas técnicas.
    if (volverCompleta && accesoReal) nav(destinoCompleta, { replace: true });
  }, [volverCompleta, accesoReal, destinoCompleta, nav]);
  if (!cliente) return null;
  const entrar = async () => {
    setError(null);
    const { data, error: e } = await cliente.auth.signInWithPassword({ email: correo.trim(), password: clave });
    if (e) return setError('No se ha podido iniciar sesión. Revise el correo y la contraseña.');
    setClave('');
    setSesion(data.user?.email ?? null);
  };
  const salir = async () => { await cliente.auth.signOut(); borrarSeleccionRemota(); useEspacios.getState().cerrar(); setSesion(null); setEspacios(null); };
  const abrir = async (x: Espacio) => {
    await useEspacios.getState().abrirRemoto(new AlmacenSupabase(cliente, x.espacio_id));
    nav(`/espacios/${x.tipo}`);
  };
  return (
    <section className="tarjeta col" aria-label="Espacios en el servidor" style={{ gap: 8 }}>
      <b><Server size={16} /> Espacios en el servidor de ULIT Censo</b>
      {!sesion ? (
        <form className="fila" style={{ gap: 6, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); void entrar(); }}>
          <input className="input" type="email" aria-label="Correo" placeholder="Correo" value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="username" />
          <input className="input" type="password" aria-label="Contraseña" placeholder="Contraseña" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" />
          <button className="btn s primario" type="submit" disabled={!correo || !clave}>Iniciar sesión</button>
        </form>
      ) : (
        <>
          <div className="fila" style={{ gap: 6, flexWrap: 'wrap' }}><span className="muted">Sesión: {sesion}</span><button className="btn s" onClick={() => void salir()}>Cerrar sesión</button>{accesoReal && <Link className="btn s primario" to={destinoCompleta}>Abrir la aplicación completa con datos reales</Link>}</div>
          {espacios && !espacios.length && <div className="t-info">Esta cuenta no pertenece a ningún espacio de ULIT Censo.</div>}
          <ul className="inc-lista" aria-label="Mis espacios en el servidor">
            {espacios?.map((x) => (
              <li key={x.espacio_id}>
                <b>{x.nombre}</b> · {x.tipo === 'real' ? 'datos reales' : 'ensayo'} · {x.rol} · versión {x.version}{x.tipo === 'real' ? (x.escritura_habilitada ? ' · preparación/autorización limitada' : ' · escritura no habilitada') : ''}{' '}
                <button className="btn s" onClick={() => void abrir(x)}>Abrir</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <div className="t-info error" role="alert">{error}</div>}
    </section>
  );
}
