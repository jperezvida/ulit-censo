import { useState } from 'react';
import { CheckCircle2, Lightbulb } from 'lucide-react';
import { useStore } from '../../store/store';
import { catalogoDeCampana, clasificacionAnterior, clasificacionEn, clasificar, partirDeClasificacionAnterior } from '../../domain/clasificacion';
import { rutaTexto, sugerirPorNombre } from '../../domain/buscador';
import { nivelesDe } from '../../domain/taxonomy';
import type { Alcance } from '../../domain/bloqueo';
import type { FilaOficina } from '../../domain/oficina';
import type { Id } from '../../domain/types';
import { BuscadorClasificacion } from './BuscadorClasificacion';
import { CampoConfirmado } from './PanelRevision';

const ORIGEN_TXT = { importado: 'Importada', heredado: 'Copiada de una campaña anterior', migrado: 'Migrada desde otro catálogo', manual: 'Confirmada' } as const;

/**
 * Clasificación en la ficha: niveles completos según el grupo (no siempre cuatro), descripción,
 * estado de confirmación, propuestas por el nombre (se aplican solo al pulsarlas) y buscador.
 */
export function SelectorClasificacion({ fila, campanaId, personaId, alcance, bloqueado }: { fila: FilaOficina; campanaId: Id; personaId: Id; alcance?: Alcance; bloqueado: boolean }) {
  const db = useStore((s) => s.db!);
  const aplicar = useStore((s) => s.aplicar);
  const [k, setK] = useState(0);
  const negocioId = fila.negocioId!;
  const catalogo = catalogoDeCampana(db, campanaId);
  const cla = clasificacionEn(db, negocioId, campanaId);
  const ant = clasificacionAnterior(db, negocioId, campanaId);
  const niv = nivelesDe(cla?.actividadId);
  const sugerencias = cla ? [] : sugerirPorNombre(catalogo, fila.nombre).sugerencias;
  const fijar = (nodoId: Id, descripcion: string | undefined, etiqueta: string) =>
    aplicar((d) => clasificar(d, negocioId, campanaId, nodoId, personaId, { alcance, descripcion }), etiqueta);

  return (
    <div className="scl">
      <div className="scl-cab">
        <span className="rotulo sin-linea">Clasificación {catalogo === 'demo' ? '(catálogo de demostración)' : '2026'}</span>
        {cla && (
          <span className={`chip ${cla.confirmada ? 'ok' : 'aviso'}`}>
            {cla.confirmada ? <><CheckCircle2 size={11} /> {ORIGEN_TXT.manual}</> : `${ORIGEN_TXT[cla.origen]} · sin confirmar`}
          </span>
        )}
        {cla && !cla.confirmada && (
          <button className="btn s" disabled={bloqueado} onClick={() => fijar(cla.actividadId, cla.descripcion, 'Clasificación confirmada')}>Confirmar</button>
        )}
      </div>
      {cla ? (
        <dl className="scl-niveles">
          <dt>Grupo</dt><dd>{niv.grupo?.nombre ?? '—'}</dd>
          {niv.grupoComercio && (<><dt>Grupo de comercio</dt><dd>{niv.grupoComercio.nombre}</dd></>)}
          <dt>Subgrupo</dt><dd>{niv.subgrupo?.nombre ?? '—'}</dd>
          {(niv.actividad || niv.grupo?.codigo !== 'S') && (<><dt>Actividad</dt><dd>{niv.actividad?.nombre ?? <span className="muted">— (con descripción)</span>}</dd></>)}
        </dl>
      ) : (
        <p className="muted scl-nada">Sin clasificar en esta campaña.</p>
      )}
      {cla?.migracion && <p className="muted scl-nota">Procede de «{rutaTexto(cla.migracion.desdeActividadId)}» ({cla.migracion.criterio}). Revísala y confírmala.</p>}
      {sugerencias.length > 0 && !bloqueado && (
        <div className="scl-sug" aria-label="Propuestas según el nombre">
          <Lightbulb size={13} />
          <span className="muted">Propuesta por el nombre{sugerencias.length > 1 ? ' (elige una)' : ''}:</span>
          {sugerencias.map((s) => (
            <button key={s.clave} className="btn s" title={`${s.ruta} · ${s.motivo}`} onClick={() => fijar(s.nodoId, s.descripcion, `Clasificación: ${s.etiqueta}`)}>
              {s.etiqueta}{s.descripcion && s.tipo !== 'ejemplo' ? ` · ${s.descripcion}` : ''}
            </button>
          ))}
        </div>
      )}
      {!cla && ant && (
        <div className="scl-sug">
          <span className="muted">En {db.campanas[ant.campanaId]?.anio}: {rutaTexto(ant.actividadId)}</span>
          <button className="btn s" disabled={bloqueado} onClick={() => {
            const ok = aplicar((d) => partirDeClasificacionAnterior(d, negocioId, campanaId, personaId, { alcance }), 'Clasificación anterior copiada como borrador');
            if (!ok) useStore.getState().avisar('La clasificación anterior no tiene un equivalente único en el catálogo de esta campaña: clasifica con el buscador.', 'info');
          }}>Partir de {db.campanas[ant.campanaId]?.anio}</button>
        </div>
      )}
      {!bloqueado && (
        <BuscadorClasificacion
          key={k}
          catalogo={catalogo}
          nombreNegocio={fila.nombre}
          autoFocus={false}
          etiqueta="Buscar clasificación"
          onElegir={(e) => {
            fijar(e.opcion.nodoId, e.descripcion, `Clasificación: ${e.opcion.etiqueta}`);
            setK((x) => x + 1);
          }}
          onCancelar={() => setK((x) => x + 1)}
        />
      )}
      {cla && (
        <label className="campo scl-desc">
          <span>Descripción {niv.subgrupo && !niv.actividad ? '(obligatoria si el subgrupo tiene actividades)' : '(opcional)'}</span>
          <CampoConfirmado
            etiqueta="Descripción de la actividad"
            valor={cla.descripcion ?? ''}
            disabled={bloqueado}
            placeholder="Breve descripción si no encaja en una actividad"
            onGuardar={(v) => fijar(cla.actividadId, v.trim() || undefined, 'Descripción de la actividad')}
          />
        </label>
      )}
    </div>
  );
}
