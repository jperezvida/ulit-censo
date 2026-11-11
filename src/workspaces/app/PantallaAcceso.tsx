import { useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import '../../styles/acceso.css';

interface Props {
  cargando: boolean;
  faseCarga: string;
  sinSesion: boolean;
  error: string | null;
  correo: string;
  contrasena: string;
  onCorreo: (valor: string) => void;
  onContrasena: (valor: string) => void;
  onEntrar: (evento: FormEvent<HTMLFormElement>) => void;
  onReintentar: () => void;
}

/** Acceso de la aplicación real. La decoración no es un mapa ni muestra datos del censo. */
export default function PantallaAcceso({
  cargando, faseCarga, sinSesion, error, correo, contrasena,
  onCorreo, onContrasena, onEntrar, onReintentar,
}: Props) {
  const [claveVisible, setClaveVisible] = useState(false);

  return <main className="acceso" aria-label="Acceso a ULIT Censo">
    <div className="acceso-marco">
      <section className="acceso-presentacion" aria-label="ULIT Censo">
        <div className="acceso-identidad">
          <div className="marca-ulit acceso-marca"><b>ULIT</b><span>Censo</span></div>
          <span className="acceso-producto">CÁTEDRA DE INNOVACIÓN PARA EL COMERCIO</span>
        </div>

        <div className="acceso-mensaje">
          <div className="acceso-eyebrow"><span className="acceso-punto"/> PLATAFORMA DE GESTIÓN</div>
          <h2>El comercio,<br/><em>dato a dato.</em></h2>
          <p>Un espacio de trabajo para conocer, revisar y analizar la actividad comercial.</p>
        </div>

        <svg className="acceso-cartografia" viewBox="0 0 460 270" fill="none" aria-hidden="true" focusable="false">
          <defs>
            <pattern id="ul-ac-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" stroke="#9AC9FF" strokeOpacity=".09" strokeWidth="1"/>
            </pattern>
            <linearGradient id="ul-ac-line" x1="25" y1="220" x2="390" y2="20" gradientUnits="userSpaceOnUse">
              <stop stopColor="#66B6FF" stopOpacity=".18"/>
              <stop offset="1" stopColor="#78CAFF" stopOpacity=".86"/>
            </linearGradient>
          </defs>
          <rect width="460" height="270" fill="url(#ul-ac-grid)"/>
          <path d="M -20 217 L 91 175 L 142 213 L 205 151 L 279 183 L 345 94 L 477 118"
            stroke="url(#ul-ac-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M 30 100 L 106 133 L 180 65 L 259 108 L 346 43 L 466 74"
            stroke="#D7EAFF" strokeOpacity=".22" strokeWidth="1.3" strokeDasharray="5 9"/>
          <path d="M 142 213 L 180 65 M 205 151 L 259 108 M 279 183 L 345 94"
            stroke="#8AC8FF" strokeOpacity=".24" strokeWidth="1.3" strokeDasharray="4 7"/>
          {[[91,175],[142,213],[205,151],[279,183],[345,94]].map(([x,y], i) =>
            <g key={i}>
              <circle cx={x} cy={y} r="12" fill="#58B3FF" fillOpacity=".10"/>
              <circle cx={x} cy={y} r="4" fill="#A7DBFF"/>
              <circle cx={x} cy={y} r="2" fill="#fff"/>
            </g>)}
          <rect x="278" y="24" width="136" height="34" rx="9" fill="#fff" fillOpacity=".08"
            stroke="#fff" strokeOpacity=".13"/>
          <circle cx="295" cy="41" r="4" fill="#65D7B0"/>
          <text x="309" y="45" fill="#D9EAFF" fontSize="11" fontFamily="Inter, sans-serif">Trabajo de campo</text>
          <rect x="24" y="219" width="127" height="34" rx="9" fill="#fff" fillOpacity=".08"
            stroke="#fff" strokeOpacity=".13"/>
          <circle cx="40" cy="236" r="4" fill="#73B9FF"/>
          <text x="54" y="240" fill="#D9EAFF" fontSize="11" fontFamily="Inter, sans-serif">Revisión y análisis</text>
        </svg>

        <div className="acceso-pie-presentacion">
          <span>MEDINA DEL CAMPO <span className="acceso-separador">/</span> CENSO 2026</span>
          <span className="acceso-pin" aria-hidden="true"><span/></span>
        </div>
      </section>

      <section className="acceso-panel" aria-label="Identificación">
        <div className="acceso-panel-interior">
          <div className="acceso-mobile-brand"><div className="marca-ulit grande"><b>ULIT</b><span>Censo</span></div></div>
          <div className="acceso-caption"><ShieldCheck size={16} aria-hidden="true"/> ACCESO INSTITUCIONAL</div>
          {cargando ? <div className="acceso-cargando" role="status" aria-live="polite">
            <div className="acceso-circulo" aria-hidden="true"/>
            <h1>Preparando tu espacio</h1>
            <p>{faseCarga}</p>
            <div className="acceso-barra" aria-hidden="true"><span/></div>
            <small>Conexión segura con los datos de la Cátedra.</small>
          </div> : <>
            <h1>{sinSesion ? 'Bienvenido de nuevo' : 'Comprobar acceso'}</h1>
            <p className="acceso-intro">{sinSesion
              ? 'Accede con tu cuenta autorizada para continuar trabajando en ULIT Censo.'
              : 'No hemos podido completar el acceso. Puedes comprobar de nuevo la conexión con el servidor.'}</p>
            {error && (!sinSesion || error !== 'Inicie sesión para entrar en ULIT Censo.') &&
              <div className="acceso-error" role="alert"><AlertCircle size={18} aria-hidden="true"/><span>{error}</span></div>}
            {sinSesion ? <form className="acceso-formulario" onSubmit={onEntrar}>
              <div className="acceso-campo">
                <label htmlFor="acceso-correo">Correo de la cuenta autorizada</label>
                <input id="acceso-correo" type="email" autoComplete="username" required
                  value={correo} onChange={e => onCorreo(e.target.value)}
                  placeholder="tu.correo@institucion.es" />
              </div>
              <div className="acceso-campo">
                <label htmlFor="acceso-contrasena">Contraseña</label>
                <div className="acceso-clave">
                  <input id="acceso-contrasena" type={claveVisible ? 'text' : 'password'}
                    autoComplete="current-password" required value={contrasena}
                    onChange={e => onContrasena(e.target.value)} placeholder="Introduce tu contraseña" />
                  <button type="button" className="acceso-ver-clave"
                    aria-label={claveVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={claveVisible} onClick={() => setClaveVisible(x => !x)}>
                    {claveVisible ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}
                  </button>
                </div>
              </div>
              <button className="acceso-entrar" type="submit">
                <LockKeyhole size={17} aria-hidden="true"/>
                <span>Entrar en ULIT Censo</span>
                <ArrowRight size={17} aria-hidden="true"/>
              </button>
            </form> : <button className="acceso-entrar" type="button" onClick={onReintentar}>
              <RefreshCw size={18} aria-hidden="true"/>
              <span>Comprobar acceso de nuevo</span>
              <ArrowRight size={17} aria-hidden="true"/>
            </button>}
          </>}
          <div className="acceso-privacidad">
            <ShieldCheck size={17} aria-hidden="true"/>
            <p>Acceso protegido. Solo se muestran datos reales a las cuentas autorizadas.</p>
          </div>
        </div>
      </section>
    </div>
    <div className="acceso-footer">ULIT Censo <span aria-hidden="true">·</span> Herramienta de trabajo de la Cátedra de Innovación para el Comercio</div>
  </main>;
}
