import { useMemo, useState } from 'react';
import type { FilaRevisionGeneral } from '../../domain/revisionGeneral';
import { datoRevisionGeneral, revisarRegistroGeneral } from '../../domain/revisionGeneral';
import { guardarCorreccionRevisionGeneral } from '../../store/revisionGeneralReal';

const CLASIFICACION = ['grupoActividad', 'grupoComercio', 'subgrupo', 'actividad', 'descripcionActividad'];
/** Justificación técnica automática: conserva la auditoría sin pedir texto al revisor. */
export function descripcionAutomaticaCorreccion(
  valores: Record<string, string>, anteriores: Record<string, string> = {},
): string {
  const claves = new Set([...Object.keys(valores), ...Object.keys(anteriores)]);
  const cambiadas = [...claves].filter((clave) => valores[clave] !== anteriores[clave]);
  return `Revisión general 2026 · campos corregidos: ${cambiadas.join(', ') || 'sin cambios'}`.slice(0, 400);
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
  onGuardada: () => Promise<void>;
  onCancelar: () => void;
}) {
  const actual = (clave: string) => datoRevisionGeneral(fila.registro, clave, fila.correccion?.valores);
  const [estado, setEstado] = useState(actual('vacio'));
  const [nombre, setNombre] = useState(actual('nombre'));
  const [fachada, setFachada] = useState(actual('fachada'));
  const [quitarClasificacion, setQuitarClasificacion] = useState(false);
  const [quitarFranquicia, setQuitarFranquicia] = useState(false);
  const [quitarDigital, setQuitarDigital] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const tipos = new Set(fila.incidencias.map((x) => x.tipo));
  const vacio = estado === '1';

  const valores = useMemo(() =>
    propuestaRevisionGeneral(fila, estado, nombre, fachada, quitarClasificacion, quitarFranquicia, quitarDigital),
    [fila, estado, nombre, fachada, quitarClasificacion, quitarFranquicia, quitarDigital]);

  const tras = useMemo(() => revisarRegistroGeneral(fila.registro, valores), [fila.registro, valores]);
  const sinCambios = JSON.stringify(Object.entries(valores).sort()) ===
    JSON.stringify(Object.entries(fila.correccion?.valores ?? {}).sort());
  const motivoAutomatico = descripcionAutomaticaCorreccion(valores, fila.correccion?.valores);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!habilitada || !version || sinCambios || guardando) return;
    setGuardando(true);
    setError('');
    try {
      await guardarCorreccionRevisionGeneral(fila.id, version, valores, motivoAutomatico);
      await onGuardada();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setGuardando(false); }
  };

  return <form className="rg-editor" aria-label="Corregir registro supervisadamente" onSubmit={(e) => void guardar(e)}>
    <h3>Corregir esta fila</h3>
    <p>Los datos del Excel no se modifican. Guardaremos únicamente la corrección y quién la realizó.</p>
    <div className="rg-campos">
      <label><span>Estado del local</span>
        <select className="input" value={estado} onChange={(e) => setEstado(e.target.value)} required>
          <option value="" disabled>Sin indicar</option>
          <option value="1">Local vacío</option>
          <option value="0">Local ocupado</option>
        </select>
      </label>
      <label><span>Nombre del negocio</span>
        <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={vacio ? 'Sin nombre' : 'Nombre del negocio'} />
      </label>
      <label><span>Metros de fachada</span>
        <input className="input" value={fachada} onChange={(e) => setFachada(e.target.value)}
          placeholder={vacio ? 'Ej.: 3,5' : 'Debe quedar vacío'} inputMode="decimal" />
      </label>
    </div>

    {vacio && (tipos.has('vacio-con-clasificacion') || tipos.has('vacio-con-franquicia') || tipos.has('vacio-con-digital')) &&
      <fieldset className="rg-quitar"><legend>Datos del negocio anterior</legend>
        {tipos.has('vacio-con-clasificacion') && <label><input type="checkbox" checked={quitarClasificacion} onChange={(e) => setQuitarClasificacion(e.target.checked)} />
          Quitar la categorización de esta fila</label>}
        {tipos.has('vacio-con-franquicia') && <label><input type="checkbox" checked={quitarFranquicia} onChange={(e) => setQuitarFranquicia(e.target.checked)} />
          Quitar el indicador de franquicia</label>}
        {tipos.has('vacio-con-digital') && <label><input type="checkbox" checked={quitarDigital} onChange={(e) => setQuitarDigital(e.target.checked)} />
          Quitar los datos digitales asociados al negocio anterior</label>}
        <small>Solo cambia el valor efectivo de 2026; las celdas de origen y el historial permanecen intactos.</small>
      </fieldset>}

    <p className={tras.incidencias.length ? 'rg-previa aviso' : 'rg-previa ok'}>
      Después de esta corrección: {tras.incidencias.length ? `${tras.incidencias.length} aviso(s) pendiente(s)` : 'sin incoherencias detectadas'}.
    </p>
    {!habilitada && <p className="rg-bloqueo" role="status">{motivoBloqueo || 'El guardado todavía no está autorizado.'}</p>}
    {error && <p className="t-info error" role="alert">{error}</p>}
    <div className="rg-acciones">
      <button className="btn s" type="button" onClick={onCancelar} disabled={guardando}>Cancelar</button>
      <button className="btn s primario" type="submit" disabled={!habilitada || !version || sinCambios || guardando ||
        !['0','1'].includes(estado)}>
        {guardando ? 'Verificando guardado…' : 'Guardar corrección'}
      </button>
    </div>
  </form>;
}
