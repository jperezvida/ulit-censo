import type { FilaOficina } from '../../domain/oficina';
import type { Id } from '../../domain/types';
import { ListaRegistros } from './ListaRegistros';
import { PanelRevision } from './PanelRevision';
import type { Tarea } from './tareas';

/** Modo por tareas (versión provisional de B2: lista + panel; B3 la sustituye por la tabla editable). */
export function VistaTareas({ tarea, filas, sel, onSel }: { tarea: Tarea; filas: FilaOficina[]; sel: Id | null; onSel: (id: Id | null) => void; onCronologia: (id: Id) => void }) {
  const f = filas.find((x) => x.localId === sel);
  const i = f ? filas.indexOf(f) : -1;
  return (
    <div className="ofi-establecimiento">
      <ListaRegistros filas={filas} sel={sel} onSel={onSel} etiqueta="Registros de la tarea" />
      <div className="ofi-ficha">
        {f && (
          <PanelRevision
            key={f.localId}
            variante="pagina"
            fila={f}
            pestanaInicial={tarea === 'digital' ? 'digital' : 'ficha'}
            onCerrar={() => onSel(null)}
            onAnterior={() => filas[i - 1] && onSel(filas[i - 1].localId)}
            onSiguiente={() => filas[i + 1] && onSel(filas[i + 1].localId)}
            posicion=""
          />
        )}
      </div>
    </div>
  );
}
