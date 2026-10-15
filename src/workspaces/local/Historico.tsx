import { useMemo } from 'react';
import type { BaseDatos } from '../../domain/db';
import { kMet } from '../../domain/db';
import { anioDe, observacionesDeLocal } from '../../domain/consultas';
import { TIPO_OBS_TXT } from '../../domain/campo';
import { rutaActividad } from '../../domain/taxonomy';
import type { Id } from '../../domain/types';
import { fmtFecha } from '../../components/ui';

const FUENTE_TXT = { 'campo-app': 'App de campo', papel: 'Papel', importacion: 'Importación', oficina: 'Oficina' } as const;

/**
 * Línea temporal del LOCAL FÍSICO: por campaña, qué negocio lo ocupaba (o si estaba vacío),
 * qué se observó y con qué fuente, y la presencia digital del negocio en esa campaña.
 */
export function Historico({ db, localId }: { db: BaseDatos; localId: Id }) {
  const datos = useMemo(() => {
    const l = db.locales[localId];
    const obs = observacionesDeLocal(db, localId);
    const ocus = Object.values(db.ocupaciones).filter((o) => o.localId === localId);
    const campIds = [...new Set([...obs.map((o) => o.campanaId), ...ocus.map((o) => o.desdeCampanaId)])].sort((a, b) => anioDe(db, a) - anioDe(db, b));
    const vinculos = Object.values(db.vinculos).filter((v) => v.localId === localId || v.candidatos?.some((c) => c.localId === localId));
    return { l, obs, ocus, campIds, vinculos };
  }, [db, localId]);
  const { l, obs, ocus, campIds, vinculos } = datos;
  if (!l) return null;

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
          const anio = camp?.anio ?? 0;
          const oc = ocus
            .filter((o) => anioDe(db, o.desdeCampanaId) <= anio && (!o.hastaCampanaId || anio <= anioDe(db, o.hastaCampanaId)))
            .sort((a, b) => anioDe(db, b.desdeCampanaId) - anioDe(db, a.desdeCampanaId))[0];
          const neg = oc?.negocioId ? db.negocios[oc.negocioId] : undefined;
          const ruta = rutaActividad(neg?.actividadId);
          const obsC = obs.filter((o) => o.campanaId === cid);
          const m = neg ? db.metricas[kMet(neg.id, cid)] : undefined;
          return (
            <li key={cid} className={neg ? 'ocupado' : 'vacio'}>
              <div className="hist-anio mono">{anio}</div>
              <div className="hist-cuerpo">
                <div className="hist-tit">
                  {neg ? <b>{neg.nombre}</b> : <b className="muted">Vacío{oc?.metrosFachada ? ` · ${oc.metrosFachada} m de fachada` : ''}</b>}
                  {neg && <span className="hist-act">{ruta.map((r) => r.nombre).join(' › ') || 'Sin clasificar'}</span>}
                </div>
                {obsC.map((o) => (
                  <div key={o.id} className="hist-obs">
                    <span className={`chip ${o.tipo === 'confirmado' ? '' : o.tipo === 'dudoso' || o.tipo === 'posible-desaparicion' ? 'dudoso' : 'azul'}`}>{TIPO_OBS_TXT[o.tipo]}</span>
                    <span className="muted">
                      {fmtFecha(o.fecha)} · {FUENTE_TXT[o.fuente]}{o.investigadorId ? ` · ${db.personas[o.investigadorId]?.nombre}` : ''} · {o.verificacion === 'verificada' ? 'verificada' : 'pendiente de verificar'}
                    </span>
                    {o.nota && <span className="hist-nota-obs">“{o.nota}”</span>}
                  </div>
                ))}
                {neg && (
                  <div className="hist-dig">
                    {m ? (
                      <>
                        <span className={`chip ${m.verificada ? 'ok' : 'aviso'}`}>{m.verificada ? `Digital verificada ${fmtFecha(m.fechaComprobacion)}` : 'Digital sin verificar'}</span>
                        <span className="muted">{[m.web && 'web', m.googleBusiness && `Google ${m.valoracion ?? ''}★ (${m.numResenas ?? 0})`, m.instagram && `IG ${m.seguidoresInstagram ?? '?'} seg.`].filter(Boolean).join(' · ') || 'sin presencia registrada'}</span>
                      </>
                    ) : (
                      <span className="muted">Sin medición digital en {anio}</span>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
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
