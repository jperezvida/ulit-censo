import { useMemo, useState } from 'react';
import type { FilaRevisionGeneral } from '../../domain/revisionGeneral';
import { datoRevisionGeneral, nombreEsMarcaDeVacio, propuestaVacioLimpio, revisarRegistroGeneral } from '../../domain/revisionGeneral';
import { deshacerLimpiezaVacio, guardarCorreccionRevisionGeneral, type CambioRevisionGeneralReal } from '../../store/revisionGeneralReal';

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

/** Revisión ágil: confirmación explícita, limpieza total y deshacer supervisado. */
export default function CorregirRevisionGeneral({ fila, habilitada, version, motivoBloqueo, onGuardada, onCancelar }: {
  fila: FilaRevisionGeneral;
  habilitada: boolean;
  version?: number;
  motivoBloqueo?: string;
  onGuardada: (cambio: CambioRevisionGeneralReal) => void;
  onCancelar: () => void;
}) {
  const actual = (clave: string) => datoRevisionGeneral(fila.registro, clave, fila.correccion?.valores);
  const estadoActual = actual('vacio');
  const nombreOriginal = actual('nombre');
  const tieneNombreComercial = !!nombreOriginal.trim() && !nombreEsMarcaDeVacio(nombreOriginal);
  const [estado, setEstado] = useState(estadoActual);
  const [fachada, setFachada] = useState(actual('fachada'));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const vacio = estado === '1';
  const puedeConfirmarOcupado = estadoActual === '1' && tieneNombreComercial;
  const ocupadoConFachada = estadoActual === '0' && actual('fachada').trim() !== '';
  const puedeDeshacer = fila.correccion?.tipoRevision === 'vaciar';
  const limpiezaPendiente = fila.incidencias.length > 0;
  const fachadaModificada = fachada.trim() !== actual('fachada');

  const valores = useMemo<Record<string, string>>(() => {
    if (estado === '0') {
      if (puedeConfirmarOcupado && estadoActual === '1') return { vacio: '0', fachada: '' };
      // El local YA está ocupado: limpiar únicamente la fachada de local vacío.
      if (ocupadoConFachada) return { fachada: '' };
      return {};
    }
    if (estado === '1' && metrosFachadaValidos(fachada)
      && (limpiezaPendiente || estadoActual !== '1' || fachadaModificada)) {
      return propuestaVacioLimpio(fachada);
    }
    return {};
  }, [estado, estadoActual, puedeConfirmarOcupado, ocupadoConFachada, limpiezaPendiente, fachadaModificada, fachada]);

  const tras = useMemo(() => revisarRegistroGeneral(
    fila.registro, { ...(fila.correccion?.valores ?? {}), ...valores },
  ), [fila, valores]);
  const sinCambios = Object.keys(valores).length === 0;
  const motivoAutomatico = descripcionAutomaticaCorreccion(valores, fila.correccion?.valores);
  const puedeGuardar = habilitada && !!version && !sinCambios && !guardando
    && (estado === '0' ? (puedeConfirmarOcupado || ocupadoConFachada) : metrosFachadaValidos(fachada));

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!puedeGuardar || !version) return;
    setGuardando(true);
    setError('');
    try {
      const cambio = await guardarCorreccionRevisionGeneral(fila.id, version, valores, motivoAutomatico);
      onGuardada(cambio);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setGuardando(false); }
  };

  const deshacer = async () => {
    if (!puedeDeshacer || !habilitada || !version || guardando) return;
    setGuardando(true);
    setError('');
    try {
      const cambio = await deshacerLimpiezaVacio(fila.id, version);
      onGuardada(cambio);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setGuardando(false); }
  };

  return <form className="rg-editor" aria-label="Corregir registro supervisadamente" onSubmit={(e) => void guardar(e)}>
    <h3>Datos de revisión</h3>
    <p>Confirma el estado, guarda y pasa al siguiente. El Excel importado y el histórico 2025 no se reescriben.</p>
    <div className="rg-opciones" role="group" aria-label="Estado actual confirmado">
      <button type="button" className={"rg-opcion" + (vacio ? " elegida" : "")}
        aria-pressed={vacio} onClick={() => setEstado('1')} disabled={guardando}>
        Local vacío
      </button>
      <button type="button" className={"rg-opcion" + (!vacio ? " elegida" : "")}
        aria-pressed={!vacio} disabled={guardando || (!tieneNombreComercial && estadoActual !== '0')}
        onClick={() => setEstado('0')}>
        Local ocupado
      </button>
    </div>
    <div className="rg-campos">
      <label><span>Nombre del negocio</span>
        <input className="input" value={vacio ? '' : nombreOriginal} disabled
          placeholder={vacio ? 'Vacío · sin nombre' : 'Nombre del negocio'} />
      </label>
      <label><span>Metros de fachada (solo vacíos)</span>
        <input className="input" value={vacio ? fachada : ''}
          onChange={(e) => setFachada(e.target.value)} disabled={!vacio || guardando}
          placeholder={vacio ? 'Ej.: 3,5' : 'No corresponde'} inputMode="decimal" />
      </label>
    </div>
    {vacio ? <p className="rg-previa">
      Al confirmar se conservarán dirección, número, fecha y metros.
      Se retirarán nombre, actividad, franquicia, redes, reseñas y observaciones del censo vigente.
    </p> : <p className="rg-previa ok">
      {ocupadoConFachada
        ? 'Este local ya está ocupado. Se quitarán únicamente los metros de fachada de local vacío; nombre, estado y datos del negocio no cambiarán.'
        : 'Se conservará el negocio y se retirarán los indicadores y metros de local vacío.'}
    </p>}
    <p className={tras.incidencias.length ? 'rg-previa aviso' : 'rg-previa ok'}>
      {sinCambios ? 'Sin cambios por guardar.' :
        'Tras confirmar: ' + (tras.incidencias.length
          ? tras.incidencias.length + ' aviso(s) pendiente(s)' : 'sin incoherencias detectadas') + '.'}
    </p>
    {!habilitada && <p className="rg-bloqueo" role="status">
      {motivoBloqueo || 'El guardado aún no está autorizado.'}
    </p>}
    {error && <p className="t-info error" role="alert">{error}</p>}
    <div className="rg-acciones">
      {puedeDeshacer && <button type="button" className="btn s"
        onClick={() => void deshacer()} disabled={!habilitada || !version || guardando}>
        Deshacer corrección
      </button>}
      <button className="btn s" type="button"
        disabled={guardando || (sinCambios && estado === estadoActual)}
        onClick={onCancelar}>Restablecer</button>
      <button className="btn s primario" type="submit" disabled={!puedeGuardar}>
        {guardando ? 'Guardando…' : vacio ? 'Confirmar vacío y limpiar · Siguiente' : ocupadoConFachada ? 'Quitar metros y siguiente' : 'Confirmar ocupado · Siguiente'}
      </button>
    </div>
  </form>;
}
