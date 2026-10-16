import { useState } from 'react';
import type { FilaOficina } from '../../domain/oficina';
import type { Id } from '../../domain/types';
import { PanelRevision, type Pestana } from './PanelRevision';
import { TablaRevision } from './tabla/TablaRevision';
import type { Tarea } from './tareas';

/** Modo por tareas: tabla de revisión rápida con la ficha completa a demanda. */
export function VistaTareas({ tarea, filas, todas, sel, onSel, onCronologia }: {
  tarea: Tarea;
  filas: FilaOficina[];
  /** Todas las filas del itinerario (la ficha puede abrirse aunque el filtro la oculte). */
  todas: FilaOficina[];
  sel: Id | null;
  onSel: (id: Id | null) => void;
  onCronologia: (id: Id) => void;
}) {
  const [ficha, setFicha] = useState<{ id: Id; pestana?: Pestana } | null>(null);
  const f = ficha ? filas.find((x) => x.localId === ficha.id) ?? todas.find((x) => x.localId === ficha.id) : undefined;
  const i = f ? filas.indexOf(f) : -1;
  return (
    <div className={`ofi-tareas-cuerpo ${f ? 'con-ficha' : ''}`}>
      <TablaRevision
        key={tarea}
        filas={filas}
        tarea={tarea}
        sel={sel}
        onSel={(id) => { onSel(id); if (ficha && ficha.id !== id) setFicha({ id }); }}
        onAbrirFicha={(id) => setFicha({ id, pestana: tarea === 'digital' ? 'digital' : tarea === 'incidencias' ? 'conciliacion' : 'ficha' })}
        onCronologia={onCronologia}
      />
      {f && (
        <PanelRevision
          key={f.localId}
          fila={f}
          pestanaInicial={ficha?.pestana}
          onCerrar={() => setFicha(null)}
          onAnterior={() => filas[i - 1] && (onSel(filas[i - 1].localId), setFicha({ id: filas[i - 1].localId }))}
          onSiguiente={() => filas[i + 1] && (onSel(filas[i + 1].localId), setFicha({ id: filas[i + 1].localId }))}
          posicion={i >= 0 ? `${i + 1} / ${filas.length}` : ''}
        />
      )}
    </div>
  );
}
