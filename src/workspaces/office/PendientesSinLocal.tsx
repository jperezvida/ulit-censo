import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Search } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useFuenteOficina } from '../../store/fuenteOficina';
import type { RegistroOrigen } from '../../domain/types';
import { CLARIDAD_TXT, pendientesCampana, type Pendiente } from '../../domain/conciliacionPosterior';
import { clienteServidor } from '../../store/clienteSupabase';
import { conciliacionDisponible, guardarDecisionIt1, type AccionReal } from '../../store/conciliacionReal';
import { Modal } from '../../components/ui';
import '../../styles/pendientes-sin-local.css';

function normalizarClave(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Solo lee las cabeceras auténticas del Excel; no calcula nombres ni direcciones. */
function datoOriginal(registro: RegistroOrigen, cabeceras: string[]): string {
  for (const cabecera of cabeceras) {
    const clave = Object.keys(registro.datos).find((k) => normalizarClave(k) === normalizarClave(cabecera));
    if (clave) return registro.datos[clave]?.trim() ?? '';
  }
  return '';
}

export function vistaBreveRegistro(registro: RegistroOrigen) {
  const calle = datoOriginal(registro, ['Dirección', 'Direccion']);
  const numero = datoOriginal(registro, ['Num']);
  const negocio = datoOriginal(registro, ['Nombre del negocio']);
  const actividad = datoOriginal(registro, ['Actividad']);
  const vacio = datoOriginal(registro, ['Local Vacío']);
  return {
    calle: calle || 'Sin calle consignada',
    numero: numero || '—',
    negocio: negocio || (vacio === '1' ? 'Local vacío (según Excel)' : 'Sin nombre consignado'),
    actividad: actividad || 'Sin actividad consignada',
  };
}

/**
 * Consulta de filas originales sin vínculo con local físico.
 * No crea locales, no asigna equivalencias y no ejecuta RPC de escritura.
 */
export default function PendientesSinLocal() {
  const { db, campana } = useContexto();
  const fuente = useFuenteOficina();
  const [busqueda, setBusqueda] = useState('');
  const [itFiltro, setItFiltro] = useState('');
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [vista, setVista] = useState<'pendientes' | 'resueltos'>('pendientes');
  const [disponible, setDisponible] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [destino, setDestino] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [distintoConfirmado, setDistintoConfirmado] = useState(false);
  const [errorDecision, setErrorDecision] = useState<string | null>(null);
  const [resultadoDecision, setResultadoDecision] = useState<string | null>(null);

  const rolPuede = !!fuente?.roles.some((r) => ['administrador', 'coordinador', 'revisor'].includes(r));
  const esIt1Real = !!fuente?.versionReal && campana?.anio === 2026 && campana.tipo === 'actualizacion';
  useEffect(() => {
    let vivo = true;
    setDisponible(false);
    if (!rolPuede || !esIt1Real) return () => { vivo = false; };
    const cliente = clienteServidor();
    if (!cliente) return () => { vivo = false; };
    void conciliacionDisponible(cliente, fuente!.versionReal!)
      .then((valor) => { if (vivo) setDisponible(valor); })
      .catch(() => { if (vivo) setDisponible(false); });
    return () => { vivo = false; };
  }, [rolPuede, esIt1Real, fuente?.versionReal]);

  const filas = useMemo(() => {
    if (!campana) return [];
    const importaciones = new Set(Object.values(db.importaciones)
      .filter((i) => i.campanaId === campana.id && i.estado === 'confirmada')
      .map((i) => i.id));
    const asociados = new Set(Object.values(db.vinculos)
      .filter((v) => v.origen.tipo === 'registro' && v.localId)
      .map((v) => v.origen.id));
    return Object.values(db.registros)
      .filter((r) => importaciones.has(r.importacionId) && !asociados.has(r.id) && !r.exclusion)
      .sort((a, b) => (a.itinerarioId ?? '').localeCompare(b.itinerarioId ?? '') || a.fila - b.fila);
  }, [db, campana]);

  const resueltos = useMemo(() => {
    if (!campana) return [];
    return Object.values(db.vinculos).filter((v) => v.localId && (v.conciliaciones ?? [])
      .some((d) => d.campanaId === campana.id && !d.deshecha))
      .map((v) => db.registros[v.origen.id]).filter((r): r is RegistroOrigen => !!r &&
        !!r.itinerarioId && db.importaciones[r.importacionId]?.campanaId === campana.id)
      .sort((a, b) => a.fila - b.fila);
  }, [db, campana]);

  // Reutilizar G5: nunca se aplica una correspondencia calculada por el sistema.
  const pendientesG5 = useMemo(() => {
    if (!campana) return new Map<string, Pendiente>();
    return new Map(pendientesCampana(db, campana.id).map((p) => [p.registroId, p]));
  }, [db, campana]);
  const conObservacion = useMemo(() => filas.filter((r) => !!pendientesG5.get(r.id)?.observacionId).length, [filas, pendientesG5]);

  const opcionesIt = useMemo(() => {
    const ids = [...new Set(filas.map((r) => r.itinerarioId ?? ''))];
    return ids.sort((a, b) => (db.itinerarios[a]?.codigo ?? a).localeCompare(db.itinerarios[b]?.codigo ?? b));
  }, [filas, db.itinerarios]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLocaleLowerCase('es');
    return (vista === 'pendientes' ? filas : resueltos).filter((r) => {
      if (itFiltro && (r.itinerarioId || '_sin-itinerario') !== itFiltro) return false;
      if (!q) return true;
      return [r.fila, db.itinerarios[r.itinerarioId ?? '']?.codigo, ...Object.values(r.datos)]
        .join(' ').toLocaleLowerCase('es').includes(q);
    });
  }, [filas, resueltos, vista, busqueda, itFiltro, db.itinerarios]);

  const activa = visibles.find((r) => r.id === seleccionado) ?? null;
  const propuestaActiva = activa ? pendientesG5.get(activa.id) : undefined;
  const hayLocalEnMismoPortal = !!propuestaActiva?.candidatos.some((c) => c.mismoPortal);
  const decisionActiva = activa ? db.vinculos[`vin-${activa.id}`]?.conciliaciones?.filter((d) =>
    !d.deshecha && d.campanaId === campana?.id).at(-1) : undefined;

  const abrirFicha = (id: string) => {
    setSeleccionado(id); setMotivo(''); setDestino(''); setConfirmado(false); setDistintoConfirmado(false);
    setErrorDecision(null); setResultadoDecision(null);
  };

  const ejecutar = async (accion: AccionReal, localId?: string) => {
    if (!fuente?.versionReal || !fuente.recargarReal || !activa || !disponible || !rolPuede || guardando) return;
    if (!confirmado) { setErrorDecision('Confirme expresamente la decisión antes de guardarla.'); return; }
    const cliente = clienteServidor();
    if (!cliente) { setErrorDecision('No hay conexión verificada con Supabase.'); return; }
    setGuardando(true); setErrorDecision(null); setResultadoDecision(null);
    try {
      const respuesta = await guardarDecisionIt1(cliente, {
        versionEsperada: fuente.versionReal, registroId: activa.id, accion,
        ...(localId ? { localId } : {}), motivo,
        ...(accion === 'local-nuevo' ? { localDistintoConfirmado: distintoConfirmado } : {}),
      });
      // No se presupone éxito hasta tener versión de servidor y releer el espacio.
      await fuente.recargarReal();
      setResultadoDecision(`Decisión guardada y datos recargados · versión ${respuesta.version}.`);
      setSeleccionado(null); setConfirmado(false); setDistintoConfirmado(false); setMotivo(''); setDestino('');
      if (accion === 'vincular' || accion === 'local-nuevo') setVista('resueltos');
      if (accion === 'deshacer') setVista('pendientes');
    } catch (error) {
      setErrorDecision(error instanceof Error ? error.message : String(error));
    } finally { setGuardando(false); }
  };

  if (!campana) return null;
  return (
    <div className="pagina psl">
      <div className="pagina-cab">
        <div>
          <Link className="btn s fantasma" to="/oficina"><ChevronLeft size={14} /> Volver a Oficina</Link>
          <div className="rotulo" style={{ marginTop: 14 }}>Oficina · {campana.nombre}</div>
          <h1>Registros sin local asociado</h1>
          <p>Filas auténticas del Excel pendientes de vincular con un local físico.</p>
        </div>
      </div>
      <div className="t-info" role="status">
        {filas.length} registros pendientes de asociación · {resueltos.length} conciliados en G5.
        {disponible ? ' Decisiones individuales supervisadas habilitadas.' : ' Consulta sin cambios: el servidor no ha habilitado la conciliación.'}
      </div>

      <p className="muted psl-ayuda">{conObservacion} filas con observación para comparar con el histórico · {filas.length - conObservacion} sin observación asociada: requieren revisión previa. Las propuestas nunca vinculan por sí solas.</p>
      {resultadoDecision && <div className="t-info" role="status">{resultadoDecision}</div>}
      <div className="psl-controles">
        <div className="psl-vistas" role="group" aria-label="Vista de conciliación">
          <button className={`btn s ${vista === 'pendientes' ? 'primario' : ''}`} onClick={() => { setVista('pendientes'); setSeleccionado(null); }}>Pendientes ({filas.length})</button>
          <button className={`btn s ${vista === 'resueltos' ? 'primario' : ''}`} onClick={() => { setVista('resueltos'); setSeleccionado(null); }}>Conciliados ({resueltos.length})</button>
        </div>
        <div className="of-busca psl-busca">
          <Search size={15} />
          <input aria-label="Buscar registros sin local" placeholder="Buscar calle, negocio, actividad o fila…"
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        {opcionesIt.length > 1 && <select className="input psl-it" aria-label="Filtrar por itinerario" value={itFiltro} onChange={(e) => setItFiltro(e.target.value)}>
          <option value="">Todos los itinerarios</option>
          {opcionesIt.map((id) => <option key={id} value={id || '_sin-itinerario'}>
            {id ? db.itinerarios[id]?.codigo ?? id : 'Sin itinerario'}
          </option>)}
        </select>}
        <span className="muted psl-contador">{visibles.length} de {vista === 'pendientes' ? filas.length : resueltos.length} filas</span>
      </div>

      <div className="psl-tabla-scroll">
        <table className="psl-tabla">
          <thead><tr><th>Origen</th><th>Dirección</th><th>N.º</th><th>Establecimiento</th><th>Actividad</th><th>Comparación 2025</th><th><span className="psl-sr">Detalle</span></th></tr></thead>
          <tbody>
            {visibles.map((r) => {
              const datos = vistaBreveRegistro(r);
              const codigo = db.itinerarios[r.itinerarioId ?? '']?.codigo ?? 'Sin itinerario';
              const pendiente = pendientesG5.get(r.id);
              const resuelto = vista === 'resueltos';
              return <tr key={r.id}>
                <td className="psl-origen">{codigo} · fila {r.fila}</td>
                <td>{datos.calle}</td>
                <td className="psl-num">{datos.numero}</td>
                <td className="psl-negocio">{datos.negocio}</td>
                <td>{datos.actividad}</td>
                <td className="psl-propuesta">{resuelto ? 'Conciliado con decisión humana' : pendiente?.observacionId ? (pendiente.candidatos.length
                  ? `${CLARIDAD_TXT[pendiente.claridad]} · ${pendiente.candidatos.length} candidato(s)`
                  : 'Sin candidatos en la calle') : 'Revisar calle/observación'}</td>
                <td><button className="btn s" onClick={() => abrirFicha(r.id)} aria-label={`Ver detalle de ${codigo} · fila ${r.fila}`}>Ver ficha</button></td>
              </tr>;
            })}
          </tbody>
        </table>
        {visibles.length === 0 && <div className="t-info">No hay registros que coincidan con estos filtros.</div>}
      </div>

      {activa && <Modal
        titulo={`Detalle de la fila ${activa.fila}`}
        sub={`${db.itinerarios[activa.itinerarioId ?? '']?.codigo ?? 'Sin itinerario'} · ${db.importaciones[activa.importacionId]?.archivo ?? 'Excel importado'} · ${disponible ? 'Conciliación supervisada' : 'Consulta sin cambios'}`}
        onCerrar={() => setSeleccionado(null)}
        ancho
      >
        <p className="muted">Valores originales de las columnas importadas. No se alteran al conciliar.</p>
        {decisionActiva && <div className="t-info" role="status">Última decisión vigente: {decisionActiva.accion} · {decisionActiva.fecha.slice(0, 10)} · {decisionActiva.motivo ?? 'Sin nota'}</div>}
        <div className="psl-comparacion">
          <h3>Propuestas de conciliación con 2025 (G5)</h3>
          {!propuestaActiva?.observacionId ? <div className="t-info aviso">Esta fila no tiene observación asociada. Antes de comparar locales hay que verificar su calle y sus datos de campo. No se propondrá ningún vínculo sin esa comprobación.</div>
            : propuestaActiva.candidatos.length === 0 ? <div className="t-info">G5 no encuentra locales candidatos en la misma calle reconocida. Revisar la dirección antes de crear o vincular un local.</div>
            : <div className="psl-candidatos">{propuestaActiva.candidatos.map((c) => <article key={c.localId} className="tarjeta psl-candidato">
                <div className="fila" style={{ flexWrap: 'wrap' }}><b>{c.portal}</b> <span className="chip">{c.mismoPortal ? 'Mismo portal' : 'Otra numeración'}</span>{c.yaVinculado && <span className="chip aviso">Ya vinculado en 2026</span>}</div>
                <div className="muted">Referencia 2025: {c.referencia?.nombre ?? (c.referencia?.vacio ? 'Local vacío' : 'Sin nombre verificado')} · {c.referencia?.actividad ?? 'Sin actividad consignada'}</div>
                <div>Coincidencia de nombre: {c.nombre} · {c.nivel}</div>
                <ul className="muted">{c.motivos.map((motivo, i) => <li key={i}>{motivo}</li>)}</ul>
              </article>)}</div>}
          <p className="muted">Propuestas informativas. Ni compartir portal ni coincidir en el nombre demuestra que sea el mismo local físico. Guardado pendiente de habilitar con autorización del servidor.</p>
        </div>
        {disponible && <section className="psl-acciones" aria-label="Conciliación supervisada">
          <h3>Decisión supervisada · IT1</h3>
          {decisionActiva ? <>
            <p>La decisión registrada puede deshacerse si ningún dato posterior depende de ella. El servidor comprobará todas las dependencias.</p>
            <label className="campo"><span>Motivo obligatorio para deshacer (mínimo 8 caracteres)</span>
              <textarea className="input" rows={3} value={motivo} maxLength={600}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Explique por qué revierte la decisión y qué ha verificado" /></label>
            <p className="muted">Un revisor solo puede deshacer sus propias decisiones. Administración y coordinación pueden revertir decisiones ajenas.</p>
            <label className="psl-check"><input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} /> Confirmo que quiero deshacer esta decisión.</label>
            <button className="btn" disabled={guardando || !confirmado || motivo.trim().length < 8} onClick={() => void ejecutar('deshacer')}>Deshacer la última decisión</button>
          </> : <>
            <p>Revise las celdas originales y los candidatos de 2025. Coincidir en dirección o nombre no garantiza identidad física.</p>
            <label className="campo"><span>Justificación obligatoria (mínimo 8 caracteres)</span>
              <textarea className="input" rows={3} value={motivo} maxLength={600} onChange={(e) => setMotivo(e.target.value)} placeholder="Indique la comprobación realizada en campo o por documentación" /></label>
            {propuestaActiva?.observacionId && propuestaActiva.candidatos.some((c) => c.referencia && !c.yaVinculado) && <label className="campo"><span>Vincular al MISMO local físico de 2025 (decisión humana)</span>
              <select className="input" value={destino} onChange={(e) => setDestino(e.target.value)}>
                <option value="">Seleccione el local comprobado…</option>
                {propuestaActiva.candidatos.filter((c) => c.referencia && !c.yaVinculado).map((c) => <option key={c.localId} value={c.localId}>{c.portal} · {c.referencia?.nombre ?? (c.referencia?.vacio ? 'Vacío' : 'Sin nombre')} · {c.mismoPortal ? 'Mismo portal' : 'Otra numeración'}</option>)}
              </select></label>}
            {propuestaActiva?.puedeCrearLocal && hayLocalEnMismoPortal && <label className="psl-check">
              <input type="checkbox" checked={distintoConfirmado} onChange={(e) => setDistintoConfirmado(e.target.checked)} />
              He comprobado en campo que se trata de un <strong>local físico distinto</strong>, aunque ya existe otro local en este mismo portal.
            </label>}
            <label className="psl-check"><input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} /> Confirmo que he revisado la información y que esta es una decisión humana, no automática.</label>
            <div className="fila psl-botones">
              {destino && <button className="btn primario" disabled={guardando || !confirmado || motivo.trim().length < 8} onClick={() => void ejecutar('vincular', destino)}>Confirmar mismo local físico</button>}
              {propuestaActiva?.puedeCrearLocal && <button className="btn" disabled={guardando || !confirmado || motivo.trim().length < 8 || (hayLocalEnMismoPortal && !distintoConfirmado)} onClick={() => void ejecutar('local-nuevo')}>Crear local físico distinto</button>}
              <button className="btn" disabled={guardando || !confirmado || motivo.trim().length < 8} onClick={() => void ejecutar('mantener-pendiente')}>Mantener pendiente con motivo</button>
            </div>
          </>}
          {guardando && <div className="t-info">Guardando y verificando el resultado…</div>}
          {errorDecision && <div className="t-info error" role="alert">{errorDecision}</div>}
        </section>}
        <dl className="psl-detalle">
          {Object.entries(activa.datos).map(([columna, valor]) => (
            <div key={columna} className="psl-detalle-fila">
              <dt>{columna}</dt><dd>{valor || '—'}</dd>
            </div>
          ))}
        </dl>
      </Modal>}
    </div>
  );
}
