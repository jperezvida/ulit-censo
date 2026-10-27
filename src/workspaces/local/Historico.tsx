import { useMemo } from 'react';
import type { BaseDatos } from '../../domain/db';
import { kNC } from '../../domain/db';
import { anioDe, observacionesDeLocal, ocupacionesDeLocal } from '../../domain/consultas';
import { TIPO_OBS_TXT } from '../../domain/campo';
import { rutaActividad } from '../../domain/taxonomy';
import type { Id, Observacion } from '../../domain/types';
import { fmtFecha } from '../../components/ui';

const FUENTE_TXT = { 'campo-app': 'App de campo', papel: 'Papel', importacion: 'Importación', oficina: 'Oficina' } as const;

/**
 * Línea temporal del LOCAL FÍSICO.
 * Cada observación se muestra con su PROPIA instantánea (negocio y situación en ese momento),
 * de modo que varios cambios dentro de una misma campaña no se confunden.
 */
export function Historico({ db, localId }: { db: BaseDatos; localId: Id }) {
  const datos = useMemo(() => {
    const l = db.locales[localId];
    const obs = observacionesDeLocal(db, localId);
    const ocus = ocupacionesDeLocal(db, localId);
    const campIds = [...new Set([...obs.map((o) => o.campanaId), ...ocus.map((o) => o.desdeCampanaId)])].sort((a, b) => anioDe(db, a) - anioDe(db, b));
    const vinculos = Object.values(db.vinculos).filter((v) => v.localId === localId || v.candidatos?.some((c) => c.localId === localId));
    return { l, obs, ocus, campIds, vinculos };
  }, [db, localId]);
  const { l, obs, ocus, campIds, vinculos } = datos;
  if (!l) return null;

  /** Negocio de la observación: su instantánea; para datos antiguos sin instantánea, el nombre registrado. */
  const negocioDeObs = (o: Observacion) => (o.datos.negocioId ? db.negocios[o.datos.negocioId] : undefined);

  return (
    <div className="historico">
      {l.direcciones.length > 1 && (
        <div className="hist-nota">
          Numeración: {l.direcciones.map((d) => `${db.calles[d.calleId]?.nombre} ${d.numero ?? 's/n'}${d.sufijo ? ' ' + d.sufijo : ''}${d.desdeCampanaId ? ` (desde ${db.campanas[d.desdeCampanaId]?.anio})` : ''}`).join(' → ')}
        </div>
      )}
      <ol className="hist-linea">
        {campIds.map((cid) => {
          const camp = db.campanas[cid];
          const obsC = obs.filter((o) => o.campanaId === cid);
          // Ocupaciones que empezaron en esta campaña sin observación propia (p. ej. históricos sin detalle)
          const sinObs = ocus.filter((o) => o.desdeCampanaId === cid && !obsC.some((x) => x.id === o.desdeObservacionId));
          return (
            <li key={cid} className="campana">
              <div className="hist-anio mono">{camp?.anio}</div>
              <div className="hist-cuerpo">
                {obsC.map((o) => {
                  const neg = negocioDeObs(o);
                  const cla = neg ? db.clasificaciones[kNC(neg.id, cid)] : undefined;
                  const ruta = rutaActividad(cla?.actividadId);
                  const dig = neg ? db.digital[kNC(neg.id, cid)] : undefined;
                  return (
                    <div key={o.id} className={`hist-evento ${o.datos.vacio ? 'vacio' : ''}`}>
                      <div className="hist-tit">
                        {o.datos.vacio ? (
                          <b className="muted">Vacío{o.datos.metrosFachada ? ` · ${o.datos.metrosFachada} m de fachada` : ''}</b>
                        ) : (
                          <b>{o.datos.nombre ?? neg?.nombre ?? 'Negocio sin nombre'}</b>
                        )}
                        {neg && <span className="hist-act">{ruta.map((r) => r.nombre).join(' › ') || 'Sin clasificar en esta campaña'}{cla && !cla.confirmada ? ' (sin confirmar)' : ''}</span>}
                      </div>
                      <div className="hist-obs">
                        <span className={`chip ${o.tipo === 'confirmado' ? '' : o.tipo === 'dudoso' || o.tipo === 'posible-desaparicion' ? 'dudoso' : 'azul'}`}>{TIPO_OBS_TXT[o.tipo]}</span>
                        <span className="muted">
                          {o.fecha ? fmtFecha(o.fecha) : 'sin fecha'} · {FUENTE_TXT[o.fuente]}{o.investigadorId ? ` · ${db.personas[o.investigadorId]?.nombre}` : ''} · {o.verificacion === 'verificada' ? 'verificada' : 'pendiente de verificar'}
                        </span>
                        {o.nota && <span className="hist-nota-obs">“{o.nota}”</span>}
                      </div>
                      {neg && dig && (
                        <div className="hist-dig">
                          <span className={`chip ${dig.estado === 'verificada' ? 'ok' : 'aviso'}`}>{dig.estado === 'verificada' ? `Digital verificada ${fmtFecha(dig.verificadaEn)}` : 'Digital en borrador'}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {sinObs.map((oc) => (
                  <div key={oc.id} className="hist-evento">
                    <b>{oc.negocioId ? db.negocios[oc.negocioId]?.nombre : 'Vacío'}</b>
                    <span className="muted"> · ocupación registrada sin observación detallada</span>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="hist-ocupaciones">
        <div className="rotulo">Ocupaciones del local</div>
        {ocus.map((o) => (
          <div key={o.id} className="hist-ocu">
            <span className="mono">{db.campanas[o.desdeCampanaId]?.anio}{o.hastaCampanaId ? `–${db.campanas[o.hastaCampanaId]?.anio}` : '→'}</span>
            <span>{o.negocioId ? db.negocios[o.negocioId]?.nombre : `Vacío${o.metrosFachada ? ` (${o.metrosFachada} m)` : ''}`}</span>
            {o.hastaObservacionId && <span className="muted">sustituida por una observación posterior</span>}
          </div>
        ))}
      </div>
      {vinculos.length > 0 && (
        <div className="hist-vinculos">
          <div className="rotulo">Correspondencias</div>
          {vinculos.map((v) => (
            <div key={v.id} className="hist-vinc">
              <span className={`chip ${v.confianza === 'confirmada' ? 'ok' : v.confianza === 'sin-vinculo' ? '' : 'dudoso'}`}>{v.confianza}</span>
              <span>{v.criterio}</span>
              {v.origen.tipo === 'registro' && db.registros[v.origen.id] && (
                <details>
                  <summary className="muted">Fila original {db.registros[v.origen.id].fila} de {db.importaciones[db.registros[v.origen.id].importacionId]?.archivo}</summary>
                  <table className="tabla">
                    <tbody>
                      {Object.entries(db.registros[v.origen.id].datos).filter(([, x]) => x).map(([k, x]) => (
                        <tr key={k}><td className="muted">{k}</td><td>{x}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
