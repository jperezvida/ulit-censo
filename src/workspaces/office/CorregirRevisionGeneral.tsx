import { useMemo, useState } from 'react';
import type { FilaRevisionGeneral } from '../../domain/revisionGeneral';
import { datoRevisionGeneral, revisarRegistroGeneral } from '../../domain/revisionGeneral';
import { guardarCorreccionRevisionGeneral, type CambioRevisionGeneralReal } from '../../store/revisionGeneralReal';

const CLASIFICACION = ['grupoActividad', 'grupoComercio', 'subgrupo', 'actividad', 'descripcionActividad'];
/** Justificación técnica automática: conserva la auditoría sin pedir texto al revisor. */
export function descripcionAutomaticaCorreccion(
  valores: Record<string, string>, anteriores: Record<string, string> = {},
): string {
  const claves = new Set([...Object.keys(valores), ...Object.keys(anteriores)]);
  const cambiadas = [...claves].filter((clave) => valores[clave] !== anteriores[clave]);
  return `Revisión general 2026 · campos corregidos: ${cambiadas.join(', ') || 'sin cambios'}`.slice(0, 400);
}

/** Valida medidas positivas, enteras o con hasta tres decimales (coma o punto). */
export function metrosFachadaValidos(valor: string): boolean {
  const metros = valor.trim();
  return /^\d{1,5}([,.]\d{1,3})?$/.test(metros) && Number(metros.replace(',', '.')) > 0;
}

const DIGITAL = [
  'web', 'googleBusiness', 'ventaOnline', 'numResenas', 'respondeResenas',
  'instagram', 'seguidoresInstagram', 'facebook', 'seguidoresFacebook',
  'twitter', 'seguidoresTwitter', 'numRedes',
];

export function propuestaRevisionGeneral(
  fila: FilaRevisionGeneral,
  estado: string, nombre: string, fachada: string,
  quitarClasificacion: boolean, quitarFranquicia: boolean, quitarDigital: boolean,
): Record<string, string> {
  const valores: Record<string, string> = { ...(fila.correccion?.valores ?? {}) };
  const poner = (clave: string, nuevo: string) => {
    if (datoRevisionGeneral(fila.registro, clave) === nuevo) delete valores[clave];
    else valores[clave] = nuevo;
  };
  poner('vacio', estado);
  poner('nombre', nombre.trim());
  poner('fachada', fachada.trim());
  if (quitarClasificacion) for (const k of CLASIFICACION) poner(k, '');
  if (quitarFranquicia) poner('franquicia', '');
  if (quitarDigital) for (const k of DIGITAL) poner(k, '');
  return valores;
}

/** Una ficha, tres campos principales y controles opcionales según las incoherencias. */
export default function CorregirRevisionGeneral({ fila, habilitada, version, motivoBloqueo, onGuardada, onCancelar }: {
  fila: FilaRevisionGeneral;
  habilitada: boolean;
  version?: number;
  motivoBloqueo?: string;
  onGuardada: (cambio: CambioRevisionGeneralReal) => void;
  onCancelar: () => void;
}) {
  const actual = (clave: string) => datoRevisionGeneral(fila.registro, clave, fila.correccion?.valores);
  const [estado, setEstado] = useState(actual('vacio'));
  const nombre = actual('nombre');
  const [fachada, setFachada] = useState(actual('fachada'));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const vacio = estado === '1';
  const permitirOcupar = fila.estado === 'vacio' && !!nombre.trim();

  // Cambio de estado explícito: la decisión la toma una persona cuando existe
  // un negocio identificado. El servidor conserva nombre y datos del negocio.
  const valores = useMemo<Record<string, string>>(() => {
    const propuestos: Record<string, string> = {};
    if (estado === '0' && permitirOcupar) {
      propuestos.vacio = '0';
      propuestos.fachada = '';
    } else if (fachada.trim() !== actual('fachada')) {
      propuestos.fachada = fachada.trim();
    }
    return propuestos;
  }, [estado, fachada, permitirOcupar, fila]);

  const tras = useMemo(() => revisarRegistroGeneral(
    fila.registro, { ...(fila.correccion?.valores ?? {}), ...valores },
  ), [fila, valores]);
  const sinCambios = estado === actual('vacio')
    && (estado === '0' || fachada.trim() === actual('fachada'));
  const motivoAutomatico = descripcionAutomaticaCorreccion(valores, fila.correccion?.valores);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!habilitada || !version || sinCambios || guardando ||
      (estado === '0' ? !permitirOcupar : !metrosFachadaValidos(fachada))) return;
    setGuardando(true);
    setError('');
    try {
      const cambio = await guardarCorreccionRevisionGeneral(fila.id, version, valores, motivoAutomatico);
      onGuardada(cambio);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setGuardando(false); }
  };

  return <form className="rg-editor" aria-label="Corregir registro supervisadamente" onSubmit={(e) => void guardar(e)}>
    <h3>Datos de revisión</h3>
    <p>Corrige y guarda para pasar al siguiente. El Excel original se conserva intacto.</p>
    <div className="rg-campos">
      <label><span>Estado del local</span>
        <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)} disabled={!permitirOcupar} required>
          <option value="" disabled>Sin indicar</option>
          <option value="1">Local vacío</option>
          <option value="0">Local ocupado</option>
        </select>
      </label>
      <label><span>Nombre del negocio</span>
        <input className="input" value={nombre} disabled placeholder={vacio ? 'Sin nombre' : 'Nombre del negocio'} />
      </label>
      <label><span>Metros de fachada</span>
        <input className="input" value={vacio ? fachada : ''} onChange={(e) => setFachada(e.target.value)} disabled={!vacio}
          placeholder={vacio ? 'Ej.: 3,5' : 'Debe quedar vacío'} inputMode="decimal" />
      </label>
    </div>

    {estado === '0' && <p className="rg-previa ok">Se conservará «{nombre}» y se retirarán el 1 de «Local Vacío» y los metros de fachada. No se eliminará la información del negocio.</p>}

    <p className={tras.incidencias.length ? 'rg-previa aviso' : 'rg-previa ok'}>
      {sinCambios ? 'Sin cambios por guardar.' :
        `Tras guardar: ${tras.incidencias.length ? `${tras.incidencias.length} aviso(s) pendiente(s)` : 'sin incoherencias detectadas'}.`}
    </p>
    {!habilitada && <p className="rg-bloqueo" role="status">{motivoBloqueo || 'El guardado todavía no está autorizado.'}</p>}
    {error && <p className="t-info error" role="alert">{error}</p>}
    <div className="rg-acciones">
      <button className="btn s" type="button" onClick={onCancelar} disabled={guardando || sinCambios}>Restablecer</button>
      <button className="btn s primario" type="submit" disabled={!habilitada || !version || sinCambios || guardando ||
        (estado === '0' ? !permitirOcupar : !metrosFachadaValidos(fachada))}>
        {guardando ? 'Guardando…' : vacio ? 'Guardar y siguiente' : 'Confirmar ocupación y seguir'}
      </button>
    </div>
  </form>;
}
