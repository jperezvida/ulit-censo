import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Clock, Lock } from 'lucide-react';
import type { FilaOficina } from '../../domain/oficina';
import type { Id } from '../../domain/types';
import { observarRectConRespaldo } from './virtual';

const ALTO = 52;

/**
 * Lista compacta de registros (modo por establecimiento). Virtualizada; se mueve con ↑/↓
 * cuando tiene el foco y conserva el registro seleccionado al filtrar.
 */
export function ListaRegistros({ filas, sel, onSel, etiqueta }: { filas: FilaOficina[]; sel: Id | null; onSel: (id: Id) => void; etiqueta: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({ count: filas.length, getScrollElement: () => ref.current, estimateSize: () => ALTO, overscan: 10, observeElementRect: observarRectConRespaldo(600) });
  const idx = filas.findIndex((f) => f.localId === sel);
  useEffect(() => {
    if (idx >= 0) virt.scrollToIndex(idx, { align: 'auto' });
  }, [idx, virt]);
  return (
    <div
      ref={ref}
      className="ofi-lista scroll-fino"
      role="listbox"
      tabIndex={0}
      aria-label={etiqueta}
      aria-activedescendant={sel ? `reg-${sel}` : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const i = Math.max(0, Math.min(filas.length - 1, (idx < 0 ? -1 : idx) + (e.key === 'ArrowDown' ? 1 : -1)));
        if (filas[i]) onSel(filas[i].localId);
      }}
    >
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((vi) => {
          const f = filas[vi.index];
          return (
            <div
              key={f.localId}
              id={`reg-${f.localId}`}
              role="option"
              aria-selected={f.localId === sel}
              className={`ofi-lista-item ${f.localId === sel ? 'on' : ''}`}
              style={{ transform: `translateY(${vi.start}px)`, height: ALTO }}
              onClick={() => onSel(f.localId)}
            >
              <span className="mono ofi-num">{f.numero ?? 's/n'}{f.sufijo ? ` ${f.sufijo}` : ''}</span>
              <span className="ofi-lista-txt">
                <b className={f.vacio ? 'muted' : ''}>{f.vacio ? 'Vacío' : f.nombre}</b>
                <span className="muted">{f.calle}{f.actividad ? ` · ${f.actividad}` : ''}</span>
              </span>
              <span className="ofi-lista-marcas">
                {f.situacion === 'pendiente-visita' && <span className="chip">sin visitar</span>}
                {f.cronologiaIncierta.length > 0 && <Clock size={12} aria-label="Cronología incierta" />}
                {f.bloqueado && <Lock size={12} aria-label="Bloqueado" />}
                <Puntos f={f} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Puntos({ f }: { f: FilaOficina }) {
  const r = f.rev;
  const p = (ok: boolean, na: boolean, t: string) => <i className={`e ${na ? 'na' : ok ? 'ok' : ''}`} title={t} />;
  return (
    <span className="ofi-puntos">
      {p(r.campo === 'terminado', false, `Campo: ${r.campo}`)}
      {p(r.categorizacion === 'revisado', f.vacio, `Categorización: ${f.vacio ? 'no aplica' : r.categorizacion}`)}
      {p(r.digital === 'revisado', f.vacio, `Digital: ${f.vacio ? 'no aplica' : r.digital}`)}
    </span>
  );
}
