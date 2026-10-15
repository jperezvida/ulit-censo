import { useMemo } from 'react';
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useStore } from '../../store/store';
import { progresoItinerario } from '../../domain/planificacion';
import type { Id, Itinerario } from '../../domain/types';
import { Avatar, Barra, Sim, fmtFecha } from '../../components/ui';

export function EquipoPanel({ itinerarios, onIt }: { itinerarios: Itinerario[]; onIt: (id: Id) => void }) {
  const { db, campana } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const personas = useMemo(() => {
    if (!campana) return [];
    const obs = Object.values(db.observaciones).filter((o) => o.campanaId === campana.id && o.fuente !== 'importacion');
    const cobs = Object.values(db.coberturas).filter((c) => c.campanaId === campana.id);
    return Object.values(db.personas)
      .filter((p) => p.roles.includes('investigador'))
      .map((p) => {
        const its = itinerarios.filter((i) => i.asignadosIds.includes(p.id));
        const responsables = itinerarios.flatMap((i) => i.tramos.filter((t) => t.responsableId === p.id));
        const mias = obs.filter((o) => o.investigadorId === p.id);
        const completadas = cobs.filter((c) => c.porId === p.id && c.estado !== 'en-curso' && c.estado !== 'pendiente').length;
        const enCurso = cobs.filter((c) => c.porId === p.id && c.estado === 'en-curso').length;
        const ultima = mias.map((o) => o.fecha).sort().pop();
        const pendientesSync = mias.filter((o) => o.sync === 'local').length;
        return { p, its, responsables: responsables.length, obs: mias.length, completadas, enCurso, ultima, pendientesSync, nuevos: mias.filter((o) => o.tipo === 'nuevo-local').length };
      });
  }, [db, campana, itinerarios]);

  if (!campana) return null;
  const conflictos = db.colaSync.filter((s) => s.estado === 'conflicto');
  const enCola = db.colaSync.filter((s) => s.estado === 'en-cola');

  const resolver = (id: Id, decision: string) =>
    aplicar((d) => ({ ...d, colaSync: d.colaSync.filter((s) => s.id !== id) }), `Conflicto resuelto: ${decision}`);

  return (
    <div className="t-equipo">
      <div className="t-cab">
        <div className="rotulo">03 · Equipo · {campana.nombre}</div>
        <div className="fila" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          <Sim texto="Progreso simulado" title="Actividad de campo inventada para la demostración" />
          <Sim texto="Sincronización simulada" title="No existe todavía un motor de sincronización" />
        </div>
      </div>

      {(conflictos.length > 0 || enCola.length > 0) && (
        <div className="t-sync">
          <div className="rotulo">Sincronización</div>
          {conflictos.map((c) => (
            <div key={c.id} className="t-conflicto">
              <div className="fila">
                <AlertTriangle size={15} color="var(--e-error)" />
                <b>{c.descripcion}</b>
              </div>
              <p>{c.conflicto?.detalle}</p>
              <div className="fila" style={{ flexWrap: 'wrap' }}>
                <button className="btn s" onClick={() => resolver(c.id, 'se mantiene «Sin cambios» (Diego)')}>Mantener Diego</button>
                <button className="btn s" onClick={() => resolver(c.id, 'se mantiene «Vacío» (Ana)')}>Mantener Ana</button>
                <button className="btn s fantasma" onClick={() => resolver(c.id, 'enviado a oficina como dudoso')}>Enviar a oficina</button>
              </div>
            </div>
          ))}
          {enCola.length > 0 && (
            <div className="t-cola">
              <CloudOff size={14} /> {enCola.length} registro(s) capturados sin conexión, pendientes de sincronizar desde los dispositivos.
            </div>
          )}
        </div>
      )}

      <div className="rotulo" style={{ margin: '14px 16px 8px' }}>Investigadores</div>
      <div className="t-personas">
        {personas.map(({ p, its, responsables, obs, completadas, enCurso, ultima, pendientesSync, nuevos }) => (
          <div key={p.id} className="t-persona">
            <div className="fila">
              <Avatar p={p} size={30} />
              <div className="esp">
                <b>{p.nombre}</b>
                <div className="muted" style={{ fontSize: 11.5 }}>{p.roles.join(' · ')} · persona ficticia</div>
              </div>
              {pendientesSync > 0 && (
                <span className="chip aviso" title="Registros guardados en el dispositivo sin sincronizar">
                  <RefreshCw size={11} /> {pendientesSync}
                </span>
              )}
            </div>
            <div className="t-persona-cifras">
              <span><b className="num">{completadas}</b> calles cerradas</span>
              <span><b className="num">{enCurso}</b> en curso</span>
              <span><b className="num">{obs}</b> registros</span>
              <span><b className="num">{nuevos}</b> altas</span>
            </div>
            <div className="fila" style={{ flexWrap: 'wrap', gap: 6 }}>
              {its.map((i) => (
                <button key={i.id} className="chip" style={{ borderColor: i.color, color: i.color, cursor: 'pointer' }} onClick={() => onIt(i.id)}>{i.codigo}</button>
              ))}
              {responsables > 0 && <span className="muted" style={{ fontSize: 11.5 }}>responsable de {responsables} calles</span>}
              <span className="esp" />
              <span className="muted" style={{ fontSize: 11.5 }}>{ultima ? `últ. actividad ${fmtFecha(ultima)}` : 'sin actividad'}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rotulo" style={{ margin: '16px 16px 8px' }}>Progreso por itinerario</div>
      <div className="t-prog">
        {itinerarios.map((it) => {
          const pr = progresoItinerario(db, it);
          return (
            <button key={it.id} className="t-prog-fila" onClick={() => onIt(it.id)}>
              <span className="mono" style={{ color: it.color, fontWeight: 700, width: 44 }}>{it.codigo}</span>
              <div className="esp">
                <Barra
                  alto={10}
                  partes={[
                    { v: pr.porEstado['completada-con-locales'], color: 'var(--e-con)' },
                    { v: pr.porEstado['completada-sin-locales'], color: 'var(--e-sin)' },
                    { v: pr.porEstado['parcial-incidencias'], color: 'var(--e-parcial)' },
                    { v: pr.porEstado['en-curso'], color: 'var(--e-curso)' },
                    { v: pr.porEstado.pendiente, color: '#e1e6ee' },
                  ]}
                />
              </div>
              <span className="num muted" style={{ width: 56, textAlign: 'right', fontSize: 12 }}>{pr.completadas}/{pr.total}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
