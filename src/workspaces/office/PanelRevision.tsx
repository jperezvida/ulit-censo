import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, Copy, ExternalLink, GitMerge, ShieldCheck, Undo2, X } from 'lucide-react';
import { useContexto, useFichaLocal } from '../../store/contexto';
import { useStore } from '../../store/store';
import { actualizarRevisiones, asignarActividad, editarNegocio, esDudosa, guardarMetrica, motivoNoAprobable, partirDeAnterior, type FilaOficina } from '../../domain/oficina';
import { digitalDe, negocioEn, ocupacionEn, textoDireccion } from '../../domain/consultas';
import { resolverVinculo } from '../../domain/conciliacion';
import { TIPO_OBS_TXT } from '../../domain/campo';
import { rutaActividad } from '../../domain/taxonomy';
import type { MetricaDigital } from '../../domain/types';
import { SelectorActividad } from '../../components/SelectorActividad';
import { Historico } from '../local/Historico';
import { fmtFecha } from '../../components/ui';

type Pestana = 'ficha' | 'digital' | 'historico' | 'conciliacion';

export function PanelRevision({ fila, onCerrar, onAnterior, onSiguiente, onAprobar, onDevolver, posicion }: {
  fila: FilaOficina;
  onCerrar: () => void;
  onAnterior: () => void;
  onSiguiente: () => void;
  onAprobar: () => void;
  onDevolver: () => void;
  posicion: string;
}) {
  const { db, campana, prefs } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const ficha = useFichaLocal();
  const vinculos = useMemo(
    () => Object.values(db.vinculos).filter((v) => v.localId === fila.localId && v.origen.tipo === 'observacion' && (v.confianza === 'dudosa' || v.confianza === 'probable')),
    [db.vinculos, fila.localId],
  );
  const [pestana, setPestana] = useState<Pestana>(esDudosa(fila) && vinculos.length ? 'conciliacion' : 'ficha');
  if (!campana) return null;
  const l = db.locales[fila.localId];
  const neg = fila.negocioId ? db.negocios[fila.negocioId] : undefined;
  const r = fila.rev;
  const motivo = motivoNoAprobable(fila);
  const ref = campana.campanaReferenciaId;
  const antes = ref ? negocioEn(db, fila.localId, ref) : null;
  const ocAntes = ref ? ocupacionEn(db, fila.localId, ref) : undefined;

  return (
    <aside className="of-panel" aria-label="Revisión del registro">
      <div className="of-panel-cab">
        <div className="fila">
          <span className="muted mono" style={{ fontSize: 11 }}>{posicion}</span>
          <span className="esp" />
          <button className="btn s fantasma icono" onClick={onAnterior} aria-label="Anterior (K)"><ArrowUp size={15} /></button>
          <button className="btn s fantasma icono" onClick={onSiguiente} aria-label="Siguiente (J)"><ArrowDown size={15} /></button>
          <button className="btn s fantasma icono" onClick={onCerrar} aria-label="Cerrar"><X size={15} /></button>
        </div>
        <h3>{fila.vacio ? 'Local vacío' : fila.nombre}</h3>
        <div className="muted" style={{ fontSize: 13 }}>{textoDireccion(db, l)}{fila.itinerario ? ` · ${fila.itinerario}` : ''}</div>
        <div className="of-estados4">
          <Estado t="Campo" ok={r.campo === 'terminado'} />
          <Estado t="Categoría" ok={fila.vacio || r.categorizacion === 'revisado'} na={fila.vacio} onClick={fila.vacio ? undefined : () => aplicar((d) => actualizarRevisiones(d, campana.id, [fila.localId], { categorizacion: r.categorizacion === 'revisado' ? 'pendiente' : 'revisado' }), 'Categorización actualizada', { silencioso: true })} />
          <Estado t="Digital" ok={fila.vacio || r.digital === 'revisado'} na={fila.vacio} onClick={fila.vacio ? undefined : () => aplicar((d) => actualizarRevisiones(d, campana.id, [fila.localId], { digital: r.digital === 'revisado' ? 'pendiente' : 'revisado' }), 'Revisión digital actualizada', { silencioso: true })} />
          <Estado t="Validación" ok={r.validacion === 'aprobada'} error={r.validacion === 'devuelta'} />
        </div>
        {r.validacion === 'devuelta' && <div className="t-info error" style={{ margin: '8px 0 0' }}>Devuelto: {r.motivoDevolucion}</div>}
        {fila.obs && (
          <div className="of-obs-det">
            <span className={`of-obs t-${fila.obs.tipo}`}>{TIPO_OBS_TXT[fila.obs.tipo]}</span>
            <span className="muted">{fmtFecha(fila.obs.fecha)} · {fila.obs.fuente === 'campo-app' ? 'app de campo' : fila.obs.fuente}{fila.obs.investigadorId ? ` · ${db.personas[fila.obs.investigadorId]?.nombre}` : ''}</span>
            {fila.obs.nota && <span className="of-nota">“{fila.obs.nota}”</span>}
          </div>
        )}
      </div>

      <div className="of-tabs">
        {(['ficha', 'digital', 'historico', 'conciliacion'] as Pestana[]).map((p) => (
          <button key={p} className={pestana === p ? 'on' : ''} onClick={() => setPestana(p)} disabled={p === 'digital' && fila.vacio}>
            {{ ficha: 'Ficha', digital: 'Digital', historico: 'Histórico', conciliacion: `Conciliación${vinculos.length ? ` (${vinculos.length})` : ''}` }[p]}
          </button>
        ))}
      </div>

      <div className="of-panel-cuerpo scroll-fino">
        {pestana === 'ficha' && (
          <div className="col" style={{ gap: 14 }}>
            {neg ? (
              <>
                <div className="campo">
                  <label>Nombre comercial</label>
                  <input className="input" value={neg.nombre} onChange={(e) => aplicar((d) => editarNegocio(d, neg.id, { nombre: e.target.value }), 'Nombre', { silencioso: true })} />
                </div>
                <div className="grid2">
                  <div className="campo">
                    <label>Cadena / franquicia</label>
                    <input className="input" value={neg.cadena ?? ''} placeholder="Independiente" onChange={(e) => aplicar((d) => editarNegocio(d, neg.id, { cadena: e.target.value || undefined }), 'Cadena', { silencioso: true })} />
                  </div>
                  <div className="campo">
                    <label>Descripción</label>
                    <input className="input" value={neg.descripcion ?? ''} onChange={(e) => aplicar((d) => editarNegocio(d, neg.id, { descripcion: e.target.value || undefined }), 'Descripción', { silencioso: true })} />
                  </div>
                </div>
                <div>
                  <div className="rotulo" style={{ marginBottom: 8 }}>Clasificación (4 niveles)</div>
                  <SelectorActividad key={fila.localId} valor={neg.actividadId} onCambio={(id) => aplicar((d) => asignarActividad(d, campana.id, [fila], id), 'Actividad asignada · categorización revisada')} />
                  {antes && antes.id !== neg.id && <p className="muted" style={{ fontSize: 12 }}>En {db.campanas[ref!]?.anio}: {antes.nombre} ({rutaActividad(antes.actividadId)[3]?.nombre ?? 'sin clasificar'}) — otro negocio.</p>}
                  {antes && antes.id === neg.id && <p className="muted" style={{ fontSize: 12 }}>Mismo negocio que en {db.campanas[ref!]?.anio}: actividad heredada, pendiente de confirmar.</p>}
                </div>
              </>
            ) : (
              <div className="t-info" style={{ margin: 0 }}>
                Local vacío{fila.metros ? ` · ${fila.metros} m de fachada` : ''}. {ocAntes?.negocioId ? `En ${db.campanas[ref!]?.anio} estaba ocupado por ${db.negocios[ocAntes.negocioId]?.nombre}.` : ''}
              </div>
            )}
            <label className="fila" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={!!r.pendienteComprobacion} onChange={(e) => aplicar((d) => actualizarRevisiones(d, campana.id, [fila.localId], { pendienteComprobacion: e.target.checked }), e.target.checked ? 'Pendiente de comprobación' : 'Comprobado')} />
              Pendiente de comprobación
            </label>
            {fila.errores.length > 0 && <div className="t-info error" style={{ margin: 0 }}>Errores: {fila.errores.join(' · ')}</div>}
            <button className="btn s fantasma" style={{ alignSelf: 'flex-start' }} onClick={() => ficha.abrir(fila.localId)}><ExternalLink size={13} /> Abrir ficha completa del local</button>
          </div>
        )}
        {pestana === 'digital' && neg && <Digital negocioId={neg.id} />}
        {pestana === 'historico' && <Historico db={db} localId={fila.localId} />}
        {pestana === 'conciliacion' && (
          <div className="col">
            {vinculos.length === 0 && <p className="muted">No hay correspondencias pendientes para este local.</p>}
            {vinculos.map((v) => (
              <div key={v.id} className="of-concilia">
                <div className="fila"><GitMerge size={15} /><b>¿Es el mismo espacio físico?</b><span className="chip dudoso">{v.confianza}</span></div>
                <p className="muted" style={{ margin: '4px 0 8px', fontSize: 12.5 }}>{v.criterio}. El sistema solo propone; la decisión es humana.</p>
                {(v.candidatos ?? []).map((c) => {
                  const lc = db.locales[c.localId];
                  if (!lc) return null;
                  const nAnt = ref ? negocioEn(db, c.localId, ref) : null;
                  return (
                    <div key={c.localId} className="of-comparar">
                      <div>
                        <div className="rotulo sin-linea">{db.campanas[ref ?? '']?.anio ?? 'Anterior'}</div>
                        <b>{nAnt?.nombre ?? 'Vacío'}</b>
                        <div className="muted">{textoDireccion(db, lc)}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>Estado: {lc.estado}</div>
                      </div>
                      <div>
                        <div className="rotulo sin-linea">{campana.anio} (campo)</div>
                        <b>{fila.vacio ? 'Vacío' : fila.nombre}</b>
                        <div className="muted">{textoDireccion(db, l)}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>Coincidencia {Math.round(c.puntuacion * 100)} %: {c.motivo}</div>
                      </div>
                      <div className="of-decision">
                        <button className="btn s" onClick={() => aplicar((d) => resolverVinculo(d, v.id, { tipo: 'mismo-local', localAnteriorId: c.localId }, prefs.personaId), 'Vinculado: mismo local físico (histórico unificado)')}>Mismo local</button>
                      </div>
                    </div>
                  );
                })}
                <div className="fila" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                  <button className="btn s" onClick={() => aplicar((d) => resolverVinculo(d, v.id, { tipo: 'distintos' }, prefs.personaId), 'Confirmado como local distinto')}>Son locales distintos</button>
                  <button className="btn s fantasma" onClick={() => aplicar((d) => resolverVinculo(d, v.id, { tipo: 'indeterminado' }, prefs.personaId), 'Queda indeterminado')}>Dejar indeterminado</button>
                </div>
              </div>
            ))}
            {(fila.obs?.tipo === 'posible-desaparicion' || fila.obs?.tipo === 'dudoso') && (
              <div className="t-info aviso" style={{ margin: 0 }}>
                Marcado en campo como «{TIPO_OBS_TXT[fila.obs.tipo]}». No se contabiliza como cierre hasta que se confirme.
                <button className="btn s" style={{ marginLeft: 'auto' }} onClick={() => aplicar((d) => actualizarRevisiones(d, campana.id, [fila.localId], { pendienteComprobacion: false }), 'Comprobación registrada')}>Comprobado</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="of-panel-pie">
        <button className="btn" onClick={onDevolver}><Undo2 size={14} /> Devolver</button>
        <span className="esp" />
        {motivo && <span className="muted" style={{ fontSize: 11.5 }} title="Requisitos para aprobar">Falta: {motivo}</span>}
        <button className="btn primario" onClick={onAprobar} disabled={!!motivo}><CheckCheck size={14} /> Aprobar</button>
      </div>
    </aside>
  );
}

function Estado({ t, ok, na, error, onClick }: { t: string; ok: boolean; na?: boolean; error?: boolean; onClick?: () => void }) {
  return (
    <button className={`of-e4 ${ok ? 'ok' : ''} ${error ? 'error' : ''}`} onClick={onClick} disabled={!onClick} title={onClick ? 'Pulsa para cambiar' : undefined}>
      <span className="of-e4-t"><i />{t}</span>
      <small>{na ? 'no aplica' : error ? 'devuelto' : ok ? (t === 'Campo' ? 'terminado' : t === 'Validación' ? 'aprobada' : 'revisado') : 'pendiente'}</small>
    </button>
  );
}

const CAMPOS: { k: keyof MetricaDigital; t: string; tipo: 'texto' | 'numero' | 'bool' }[] = [
  { k: 'web', t: 'Página web', tipo: 'texto' },
  { k: 'ventaOnline', t: 'Venta por internet', tipo: 'bool' },
  { k: 'googleBusiness', t: 'Google Business Profile', tipo: 'bool' },
  { k: 'valoracion', t: 'Valoración media', tipo: 'numero' },
  { k: 'numResenas', t: 'Nº de reseñas', tipo: 'numero' },
  { k: 'respondeResenas', t: 'Responde reseñas', tipo: 'bool' },
  { k: 'instagram', t: 'Instagram', tipo: 'texto' },
  { k: 'seguidoresInstagram', t: 'Seguidores Instagram', tipo: 'numero' },
  { k: 'facebook', t: 'Facebook', tipo: 'texto' },
  { k: 'otrasRedes', t: 'Otras redes', tipo: 'texto' },
];

function Digital({ negocioId }: { negocioId: string }) {
  const { db, campana } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const { actual, anterior } = digitalDe(db, negocioId, campana!.id);
  const neg = db.negocios[negocioId];
  const valor = (m: MetricaDigital | undefined, k: keyof MetricaDigital) => {
    const v = m?.[k];
    if (v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? 'Sí' : 'No';
    return String(v);
  };
  const cambiar = (k: keyof MetricaDigital, v: string | boolean | number | undefined) => aplicar((d) => guardarMetrica(d, negocioId, campana!.id, { [k]: v, verificada: false }), 'Dato digital', { silencioso: true });
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="fila" style={{ flexWrap: 'wrap' }}>
        {actual?.verificada ? (
          <span className="chip ok"><ShieldCheck size={12} /> Verificado {fmtFecha(actual.fechaComprobacion)}</span>
        ) : actual ? (
          <span className="chip aviso">Borrador {campana!.anio} · sin verificar</span>
        ) : (
          <span className="chip">Sin medición en {campana!.anio}</span>
        )}
        <span className="esp" />
        {anterior && !actual && (
          <button className="btn s" onClick={() => aplicar((d) => partirDeAnterior(d, negocioId, campana!.id, anterior), `Copiado de ${db.campanas[anterior.campanaId]?.anio} como borrador sin verificar`)}>
            <Copy size={13} /> Partir de {db.campanas[anterior.campanaId]?.anio}
          </button>
        )}
        <button
          className="btn s primario"
          onClick={() => aplicar((d) => actualizarRevisiones(guardarMetrica(d, negocioId, campana!.id, {}, true), campana!.id, Object.values(d.ocupaciones).filter((o) => o.negocioId === negocioId).map((o) => o.localId), { digital: 'revisado' }), `Presencia digital verificada en ${campana!.anio}`)}
        >
          <ShieldCheck size={13} /> Marcar verificado hoy
        </button>
      </div>
      {!anterior && <p className="muted" style={{ fontSize: 12, margin: 0 }}>{neg?.procedencia === 'manual' ? 'Negocio nuevo: no hereda perfiles del negocio que ocupaba antes el local.' : 'Sin mediciones anteriores de este negocio.'}</p>}
      <table className="tabla of-digital">
        <thead>
          <tr>
            <th>Variable</th>
            <th>{campana!.anio}</th>
            {anterior && <th title="Solo referencia: no se considera verificado en esta campaña">{db.campanas[anterior.campanaId]?.anio} <span className="muted">(ref.)</span></th>}
          </tr>
        </thead>
        <tbody>
          {CAMPOS.map(({ k, t, tipo }) => (
            <tr key={k}>
              <td className="muted">{t}</td>
              <td>
                {tipo === 'bool' ? (
                  <select className="input of-mini" value={actual?.[k] === undefined ? '' : actual?.[k] ? 'si' : 'no'} onChange={(e) => cambiar(k, e.target.value === '' ? undefined : e.target.value === 'si')}>
                    <option value="">—</option>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                ) : (
                  <input
                    className="input of-mini"
                    inputMode={tipo === 'numero' ? 'decimal' : undefined}
                    value={actual?.[k] === undefined ? '' : String(actual[k])}
                    onChange={(e) => cambiar(k, tipo === 'numero' ? (e.target.value === '' ? undefined : +e.target.value.replace(',', '.')) : e.target.value || undefined)}
                  />
                )}
              </td>
              {anterior && <td className="of-ref">{valor(anterior, k)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>Los valores de campañas anteriores nunca se presentan como verificados en esta. La actualización automática de seguidores queda fuera de esta fase.</p>
    </div>
  );
}
