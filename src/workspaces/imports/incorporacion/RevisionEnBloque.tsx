import { useMemo } from 'react';
import { CheckCircle2, Undo2 } from 'lucide-react';
import { fmt } from '../../../components/ui';
import type { DecisionesIncorporacion, PlanIncorporacion } from '../../../domain/incorporacion';
import { CLASE_REVISION_TXT, gruposEnBloque, itemsRevision, type GrupoEnBloque } from '../../../domain/incorporacionDemo';
import type { ResultadoInterpretacion } from '../../../domain/xlsx/interpretacion';
import { useCtxIncorporacion } from './contextoIncorporacion';
import type { Id } from '../../../domain/types';

/**
 * Revisión EN BLOQUE: para cada grupo de incidencias del mismo tipo que solo requiere revisión humana,
 * una persona puede marcarlo como revisado con un clic (queda quién y cuándo). Se conservan los valores
 * originales; no cambia ningún dato ni ninguna interpretación.
 */
export function RevisionEnBloque({ resultado, plan, decisiones, onCambiar, firma, sinPermiso }: {
  resultado: ResultadoInterpretacion;
  plan: PlanIncorporacion;
  decisiones: DecisionesIncorporacion;
  onCambiar: (d: DecisionesIncorporacion) => void;
  firma: { porId: Id; fecha: string };
  sinPermiso?: string;
}) {
  const { db } = useCtxIncorporacion();
  // Los grupos se calculan SIN las revisiones en bloque, para poder mostrar también los ya revisados.
  const grupos = useMemo(() => gruposEnBloque(itemsRevision(resultado, plan, { ...decisiones, revisionesBloque: [] })), [resultado, plan, decisiones]);
  const hechas = decisiones.revisionesBloque ?? [];
  const registrar = (g: GrupoEnBloque) => onCambiar({ ...decisiones, revisionesBloque: [...hechas.filter((r) => r.tipo !== g.tipo), { tipo: g.tipo, filas: g.filas, ...firma }] });
  return (
    <div className="col" style={{ gap: 10 }} aria-label="Revisión en bloque">
      <p className="muted" style={{ margin: 0 }}>
        Grupos que solo requieren una revisión humana. Marcarlos como revisados <b>no cambia ningún dato</b>: se conservan los valores originales y su interpretación (o la ausencia de valor), y queda constancia de quién y cuándo. Las cuestiones de la Cátedra, las filas de totales y los duplicados se deciden aparte, fila a fila.
      </p>
      {!grupos.length && <div className="vacio-estado tarjeta">No hay grupos que revisar en bloque.</div>}
      {grupos.map((g) => {
        const r = hechas.find((x) => x.tipo === g.tipo);
        return (
          <section key={g.tipo} className="tarjeta dec-tarjeta" aria-label={`Grupo ${g.titulo}`}>
            <div className="fila"><b className="esp">{g.titulo}</b><span className={`chip clase-${g.clase}`}>{CLASE_REVISION_TXT[g.clase].titulo}</span><span className="chip">{fmt(g.filas.length)} fila(s)</span></div>
            <p className="muted" style={{ margin: 0 }}>{g.propuesta}</p>
            <p className="muted mono" style={{ margin: 0, fontSize: 11.5 }}>Filas: {g.filas.slice(0, 30).join(', ')}{g.filas.length > 30 ? '…' : ''}</p>
            {r ? (
              <div className="fila">
                <span className="muted dec-nota esp"><CheckCircle2 size={13} /> Revisado en bloque · {db.personas[r.porId]?.nombre ?? r.porId} · {r.fecha}{r.motivo ? ` · «${r.motivo}»` : ''}</span>
                <button className="btn s" onClick={() => onCambiar({ ...decisiones, revisionesBloque: hechas.filter((x) => x !== r) })}><Undo2 size={13} /> Retirar</button>
              </div>
            ) : sinPermiso ? <span className="muted dec-nota">{sinPermiso}</span> : <div><button className="btn s" onClick={() => registrar(g)}><CheckCircle2 size={14} /> Marcar como revisado</button></div>}
          </section>
        );
      })}
    </div>
  );
}
