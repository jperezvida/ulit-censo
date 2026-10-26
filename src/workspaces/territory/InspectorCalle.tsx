import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Scissors, X } from 'lucide-react';
import { useFichaLocal } from '../../store/contexto';
import { useContextoTerritorio } from './contextoTerritorio';
import { coberturaCalle, direccionVigente, itinerariosDe, localesPrevios, negocioEn, ESTADO_COBERTURA_TXT, SITUACION_TXT, situacionPrevia } from '../../domain/consultas';
import { ACERA_TXT, actualizarTramo, alternarCalle, asegurarEnAmbito, fijarSituacionPrevia, marcarCalleRevisada, quitarDeAmbito } from '../../domain/itinerarios';
import { kCC } from '../../domain/db';
import type { Acera, Id, Itinerario, SituacionPrevia } from '../../domain/types';
import { EstadoCob, SelloProcedencia, fmtFecha } from '../../components/ui';
import { formatoDistancia } from '../../domain/geo';

export function InspectorCalle({
  calleId, itActual, editando, dividiendo, setDividiendo, onCerrar, onIt, onAlternarEnsayo, ocupadoEnsayo, errorEnsayo, guardadoEnsayo,
}: {
  calleId: Id;
  itActual?: Itinerario;
  editando: boolean;
  dividiendo: boolean;
  setDividiendo: (v: boolean) => void;
  onCerrar: () => void;
  onIt: (id: Id) => void;
  onAlternarEnsayo?: () => Promise<void>;
  ocupadoEnsayo?: string | null;
  errorEnsayo?: string | null;
  guardadoEnsayo?: string | null;
}) {
  const { db, campana, referencia, personaId, ix, aplicar, puedeEditar, demo } = useContextoTerritorio();
  const ficha = useFichaLocal();
  const nav = useNavigate();
  const calle = db.calles[calleId];
  const previos = useMemo(() => localesPrevios(db, referencia?.id ?? (campana?.tipo === 'historico-importado' ? campana.id : undefined), calleId, ix.obs), [db, referencia, campana, calleId, ix.obs]);
  if (!campana || !calle) return null;
  const enAmbito = campana.ambitoCalleIds.includes(calleId);
  const ampliacion = campana.ampliacionCalleIds.includes(calleId);
  const sit = situacionPrevia(db, campana, calleId, ix.obs);
  const manual = db.situacionesPrevias[kCC(campana.id, calleId)];
  const cob = coberturaCalle(db, campana.id, calleId);
  const cobDet = db.coberturas[`${campana.id}|${calleId}|ambas`];
  const its = itinerariosDe(db, campana.id).filter((i) => i.tramos.some((t) => t.calleId === calleId));
  const tramoActual = itActual?.tramos.find((t) => t.calleId === calleId);
  const revisada = db.callesRevisadasPlan[kCC(campana.id, calleId)];

  return (
    <aside className="t-inspector panel-flotante scroll-fino">
      <div className="fila" style={{ alignItems: 'flex-start' }}>
        <div className="esp">
          <div className="rotulo sin-linea">{calle.tipoVia} · {calle.segmentos.length} segmento(s)</div>
          <h3 className="t-insp-nom">{calle.nombre}</h3>
          <div className="fila" style={{ flexWrap: 'wrap', marginTop: 4 }}>
            <SelloProcedencia p={calle.procedencia} />
            <span className="chip mono">{formatoDistancia(calle.longitudM)}</span>
            {ampliacion && <span className="chip aviso" title="Incorporada al ámbito en esta campaña">Ampliación {campana.anio}</span>}
          </div>
        </div>
        <button className="btn fantasma icono s" onClick={onCerrar} aria-label="Cerrar">
          <X size={16} />
        </button>
      </div>

      {!demo && itActual && <div className="t-insp-bloque destacado" style={{ ['--c' as string]: itActual.color }}>
        <b>{tramoActual ? `En ${itActual.codigo}` : `Aún no está en ${itActual.codigo}`}</b>
        {onAlternarEnsayo ? <button className="btn s primario" disabled={!!ocupadoEnsayo} onClick={() => void onAlternarEnsayo()}>{ocupadoEnsayo ?? (tramoActual ? 'Quitar calle completa' : 'Asignar calle completa')}</button>
          : <span className="muted">Solo la persona coordinadora puede cambiar la planificación.</span>}
        {errorEnsayo && <div className="t-info error" role="alert">{errorEnsayo} Si otra pestaña cambió el espacio, vuelva al inicio y ábralo de nuevo.</div>}
        {guardadoEnsayo && <div className="t-info ok" role="status">{guardadoEnsayo}</div>}
      </div>}

      {editando && itActual && (
        <div className="t-insp-bloque destacado" style={{ ['--c' as string]: itActual.color }}>
          {tramoActual ? (
            <>
              <div className="fila">
                <b>En {itActual.codigo}</b>
                <span className="muted">· nº {tramoActual.orden}</span>
                <span className="esp" />
                <button className="btn s" onClick={() => aplicar((d) => alternarCalle(d, itActual.id, calleId).db, `${calle.nombre} quitada de ${itActual.codigo}`)}>Quitar</button>
              </div>
              <details className="t-avanzado" open={dividiendo || tramoActual.acera !== 'ambas' || !!tramoActual.segmentoIds?.length}>
                <summary>Avanzado: aceras y división de la calle</summary>
                <div className="campo" style={{ marginTop: 8 }}>
                  <span className="etq">Aceras asignadas</span>
                  <select className="input" value={tramoActual.acera} onChange={(e) => aplicar((d) => actualizarTramo(d, itActual.id, calleId, { acera: e.target.value as Acera }), 'Aceras actualizadas', { silencioso: true })}>
                    {(['ambas', 'par', 'impar'] as Acera[]).map((a) => (
                      <option key={a} value={a}>{ACERA_TXT[a]}</option>
                    ))}
                  </select>
                </div>
                <div className="fila" style={{ marginTop: 8 }}>
                  <button className={`btn s ${dividiendo ? 'activo' : ''}`} onClick={() => setDividiendo(!dividiendo)} disabled={calle.segmentos.length < 2}>
                    <Scissors size={13} /> {dividiendo ? 'Dividiendo: pulsa segmentos' : 'Dividir por segmentos'}
                  </button>
                  {tramoActual.segmentoIds?.length ? (
                    <button className="btn s fantasma" onClick={() => aplicar((d) => actualizarTramo(d, itActual.id, calleId, { segmentoIds: undefined }), 'Calle completa', { silencioso: true })}>Volver a calle completa</button>
                  ) : null}
                </div>
                <p className="muted" style={{ fontSize: 11.5, margin: '6px 0 0' }}>
                  {tramoActual.segmentoIds?.length ? `${tramoActual.segmentoIds.length} de ${calle.segmentos.length} segmentos en este itinerario.` : 'Calle completa: todos los segmentos.'} El procedimiento habitual es censar la calle completa.
                </p>
                <div className="campo" style={{ marginTop: 8 }}>
                  <span className="etq">Etiqueta de planificación</span>
                  <input className="input" placeholder="p. ej. Censar desde cero" value={tramoActual.etiqueta ?? ''} onChange={(e) => aplicar((d) => actualizarTramo(d, itActual.id, calleId, { etiqueta: e.target.value || undefined }), 'Etiqueta', { silencioso: true })} />
                </div>
              </details>
            </>
          ) : (
            <div className="fila">
              <span>No está en {itActual.codigo}</span>
              <span className="esp" />
              <button className="btn s primario" onClick={() => aplicar((d) => alternarCalle(d, itActual.id, calleId).db, `${calle.nombre} añadida a ${itActual.codigo}`)}>Añadir calle completa</button>
            </div>
          )}
        </div>
      )}

      <div className="t-insp-bloque">
        <div className="rotulo">Ámbito y situación anterior</div>
        <div className="fila" style={{ justifyContent: 'space-between' }}>
          <span>{enAmbito ? `En el ámbito de ${campana.nombre}` : 'Fuera del ámbito de la campaña'}</span>
          {puedeEditar && (enAmbito ? (
            <button className="btn s fantasma" onClick={() => aplicar((d) => quitarDeAmbito(d, campana.id, calleId), 'Calle retirada del ámbito')}>Retirar</button>
          ) : (
            <button className="btn s" onClick={() => aplicar((d) => asegurarEnAmbito(d, campana.id, calleId), 'Calle añadida al ámbito (ampliación)')}>Añadir al ámbito</button>
          ))}
        </div>
        <div className="campo" style={{ marginTop: 8 }}>
          <span className="etq">Situación respecto a {referencia?.nombre ?? 'campañas anteriores'}</span>
          <select
            className="input"
            value={manual ?? ''}
            disabled={!puedeEditar || sit === 'con-registros' && !manual}
            onChange={(e) => aplicar((d) => fijarSituacionPrevia(d, campana.id, calleId, (e.target.value || null) as SituacionPrevia | null), 'Situación anterior fijada', { silencioso: true })}
          >
            <option value="">Automática: {SITUACION_TXT[sit]}</option>
            {(['no-censada', 'censada-sin-locales', 'sin-informacion', 'pendiente-relacionar'] as SituacionPrevia[]).map((s) => (
              <option key={s} value={s}>{SITUACION_TXT[s]}</option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 11.5 }}>Que no haya filas en el Excel anterior no significa que la calle no tuviera locales.</span>
        </div>
        {sit !== 'con-registros' && enAmbito && (
          <label className="t-revisada">
            <input type="checkbox" checked={!!revisada} disabled={!puedeEditar} onChange={(e) => aplicar((d) => marcarCalleRevisada(d, campana.id, calleId, personaId, e.target.checked), e.target.checked ? 'Calle marcada como revisada' : 'Revisión retirada')} />
            <span>
              <b>Calle sin registros previos revisada</b>
              <br />
              <span className="muted">{revisada ? `${db.personas[revisada.porId]?.nombre ?? ''} · ${fmtFecha(revisada.fecha)}` : 'Confirma que se ha comprobado su situación'}</span>
            </span>
            {revisada && <CheckCircle2 size={16} color="var(--e-ok)" />}
          </label>
        )}
      </div>

      <div className="t-insp-bloque">
        <div className="rotulo">Cobertura {campana.anio}</div>
        <EstadoCob e={cob.estado} />
        {cob.aceras.par || cob.aceras.impar ? (
          <div className="muted" style={{ fontSize: 12 }}>Par: {cob.aceras.par ? ESTADO_COBERTURA_TXT[cob.aceras.par] : 'pendiente'} · Impar: {cob.aceras.impar ? ESTADO_COBERTURA_TXT[cob.aceras.impar] : 'pendiente'}</div>
        ) : null}
        {cobDet?.porId && (
          <div className="muted" style={{ fontSize: 12 }}>
            {db.personas[cobDet.porId]?.nombre} · {fmtFecha(cobDet.fecha)}
            {cobDet.aceraParRecorrida !== undefined && ` · par ${cobDet.aceraParRecorrida ? '✓' : '✗'} impar ${cobDet.aceraImparRecorrida ? '✓' : '✗'}`}
            {cobDet.nota && <div>“{cobDet.nota}”</div>}
          </div>
        )}
        <div className="fila" style={{ flexWrap: 'wrap', marginTop: 4 }}>
          {its.length ? its.map((i) => {
            const t = i.tramos.find((x) => x.calleId === calleId)!;
            return (
              <button key={i.id} className="chip" style={{ borderColor: i.color, color: i.color, cursor: 'pointer' }} onClick={() => onIt(i.id)}>
                {i.codigo} · {t.acera === 'ambas' ? 'ambas' : t.acera}{t.segmentoIds?.length ? ` · ${t.segmentoIds.length} seg.` : ''}
              </button>
            );
          }) : <span className="muted" style={{ fontSize: 12 }}>Sin itinerario asignado</span>}
        </div>
      </div>

      <div className="t-insp-bloque">
        <div className="rotulo">Locales anteriores ({previos.length})</div>
        {previos.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Ningún local vinculado a esta calle en {referencia?.nombre ?? 'la campaña anterior'}.</p>
        ) : (
          <ul className="t-previos">
            {previos.slice(0, 14).map((l) => {
              const n = negocioEn(db, l.id, referencia?.id ?? campana.id, ix.ocu);
              const d = direccionVigente(l);
              return (
                <li key={l.id}>
                  <button disabled={!demo} onClick={() => ficha.abrir(l.id)}>
                    <span className="mono num">{d.numero ?? 's/n'}{d.sufijo ? ` ${d.sufijo}` : ''}</span>
                    <span className={n ? '' : 'muted'}>{n?.nombre ?? 'Vacío'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {demo && previos.length > 0 && (
          <button className="btn s" onClick={() => nav(`/oficina?calle=${calleId}`)}>Ver en la bandeja de oficina</button>
        )}
      </div>
      {calle.refsFuente.length > 0 && <div className="muted mono" style={{ fontSize: 10.5, padding: '0 2px' }}>{calle.refsFuente.slice(0, 3).join(' · ')}{calle.refsFuente.length > 3 ? ' …' : ''}</div>}
    </aside>
  );
}
