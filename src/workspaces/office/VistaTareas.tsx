import { useEffect, useState } from 'react';
import type { FilaOficina } from '../../domain/oficina';
import type { Id } from '../../domain/types';
import { PanelRevision, type Pestana } from './PanelRevision';
import { TablaRevision } from './tabla/TablaRevision';
import { siguientePendiente, type Tarea } from './tareas';

/**
 * Modo por tareas: tabla de revisión rápida con la ficha a demanda.
 *  - Ficha lateral compacta (consulta rápida).
 *  - Ficha ampliada: ocupa el área central; la tabla se conserva montada (cursor, orden y
 *    desplazamiento intactos) y vuelve al reducir.
 * La pestaña activa y la posición se conservan al ampliar, reducir o cambiar de establecimiento.
 */
export function VistaTareas({ tarea, filas, todas, sel, onSel, onCronologia, pestana, onPestana, ampliada, onAmpliada }: {
  tarea: Tarea;
  filas: FilaOficina[];
  /** Todas las filas del itinerario (la ficha puede abrirse aunque el filtro la oculte). */
  todas: FilaOficina[];
  sel: Id | null;
  onSel: (id: Id | null) => void;
  onCronologia: (id: Id) => void;
  pestana: Pestana;
  onPestana: (p: Pestana) => void;
  ampliada: boolean;
  onAmpliada: (v: boolean) => void;
}) {
  const [fichaId, setFichaId] = useState<Id | null>(null);
  const f = fichaId ? filas.find((x) => x.localId === fichaId) ?? todas.find((x) => x.localId === fichaId) : undefined;
  const i = f ? filas.indexOf(f) : -1;
  useEffect(() => {
    if (!f && ampliada) onAmpliada(false);
  }, [f, ampliada, onAmpliada]);
  const ir = (x?: FilaOficina) => {
    if (!x) return;
    onSel(x.localId);
    setFichaId(x.localId);
  };
  return (
    <div className={`ofi-tareas-cuerpo ${f ? 'con-ficha' : ''} ${f && ampliada ? 'ampliada' : ''}`}>
      <div className="ofi-tabla-zona" hidden={!!f && ampliada}>
        <TablaRevision
          key={tarea}
          filas={filas}
          tarea={tarea}
          sel={sel}
          onSel={(id) => { onSel(id); if (fichaId && fichaId !== id) setFichaId(id); }}
          onAbrirFicha={(id) => {
            setFichaId(id);
            onPestana(tarea === 'digital' ? 'digital' : tarea === 'incidencias' ? 'conciliacion' : pestana);
          }}
          onCronologia={onCronologia}
        />
      </div>
      {f && (
        <PanelRevision
          key={f.localId}
          fila={f}
          variante={ampliada ? 'pagina' : 'panel'}
          pestana={pestana}
          onPestana={onPestana}
          ampliada={ampliada}
          onAmpliar={onAmpliada}
          onCerrar={() => { setFichaId(null); onAmpliada(false); }}
          onAnterior={() => ir(filas[i - 1])}
          onSiguiente={() => ir(filas[i + 1])}
          onSiguientePendiente={() => ir(siguientePendiente(filas, i, tarea))}
          onCronologia={() => onCronologia(f.localId)}
          posicion={i >= 0 ? `${i + 1} / ${filas.length}` : 'fuera del filtro'}
        />
      )}
    </div>
  );
}
