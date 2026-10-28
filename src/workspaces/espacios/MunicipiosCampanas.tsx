import { useState } from 'react';
import { AlertTriangle, CalendarPlus, CheckCircle2, HardDrive, MapPinned, Plus, X } from 'lucide-react';
import { fmt } from '../../components/ui';
import { useEspacios } from '../../store/espacios';
import { BASE_INDEXEDDB, municipioDeEspacio, type TipoEspacio } from '../../domain/espacios';
import {
  callejeroDe, CLASE_CAMPANA_TXT, claseCampana, contenidoCampana, motivoNoDestino, TERRITORIO_INICIAL, TIPO_OPERATIVA_TXT, USOS_TERRITORIALES,
  validarCampana, validarMunicipio, type ClaseCampana, type TipoOperativa,
} from '../../domain/municipios';
import { configTerritorialDe } from '../../domain/territorio';
import type { ReglaTerritorial } from '../../domain/territorio';
import type { BaseDatos } from '../../domain/db';
import type { Campana, ConfigTerritorialMunicipio, Id } from '../../domain/types';
import { useAsistenteEspacio, useSeleccionEspacio } from './estadoAsistenteEspacio';
import { CallejeroMunicipio } from './CallejeroMunicipio';
import { CampanaOperativa } from './CampanaOperativa';
import { itinerariosDe } from '../../domain/campanaOperativa';

/**
 * G2 · Municipios y campañas de un espacio. Todo se guarda en la base del espacio en ESTE navegador:
 * no se comparte con otras personas ni se envía a ningún servidor.
 */

const ANIO_ACTUAL = new Date().getFullYear();
const porAnio = (a: Campana, b: Campana) => b.anio - a.anio || a.nombre.localeCompare(b.nombre, 'es');

/** Campañas históricas que pueden recibir una incorporación (vacías), de la más reciente a la más antigua. */
export const campanasDestino = (db: BaseDatos, municipioId: Id) =>
  Object.values(db.campanas).filter((c) => c.municipioId === municipioId && claseCampana(c) === 'historica').sort(porAnio)
    .map((c) => ({ c, motivo: motivoNoDestino(db, c.id, municipioId, c.anio) }));

/** G4 · Campañas OPERATIVAS de un municipio (destino de los Excel de itinerario). */
export const campanasOperativas = (db: BaseDatos, municipioId: Id) =>
  Object.values(db.campanas).filter((c) => c.municipioId === municipioId && claseCampana(c) === 'operativa').sort(porAnio);

/**
 * Municipio y campaña de destino efectivos: los elegidos o, si no hay elección válida, el municipio
 * piloto (o el primero) y su campaña histórica vacía más reciente. En modo operativo (G4), su campaña
 * operativa y el itinerario elegidos (o los primeros).
 */
export function destinoElegido(db: BaseDatos, tipo: TipoEspacio, sel: { modo?: 'historico' | 'operativo'; municipioId: Id | null; campanaId: Id | null; itinerarioId?: Id | null }) {
  const municipioId = sel.municipioId && db.municipios[sel.municipioId] ? sel.municipioId
    : db.municipios[municipioDeEspacio(tipo)] ? municipioDeEspacio(tipo) : Object.keys(db.municipios)[0] ?? null;
  if (!municipioId) return { municipioId: null, campana: null, itinerario: null };
  if (sel.modo === 'operativo') {
    const ops = campanasOperativas(db, municipioId);
    const campana = ops.find((c) => c.id === sel.campanaId) ?? ops[0] ?? null;
    const its = campana ? itinerariosDe(db, campana.id) : [];
    return { municipioId, campana, itinerario: its.find((i) => i.id === sel.itinerarioId) ?? its[0] ?? null };
  }
  const opciones = campanasDestino(db, municipioId);
  const elegida = opciones.find((o) => o.c.id === sel.campanaId && !o.motivo) ?? opciones.find((o) => !o.motivo);
  return { municipioId, campana: elegida?.c ?? null, itinerario: null };
}

export function MunicipiosCampanas({ tipo }: { tipo: TipoEspacio }) {
  const db = useEspacios((s) => s.db!);
  const sel = useSeleccionEspacio();
  const [alta, setAlta] = useState(false);
  const [nuevaCampana, setNuevaCampana] = useState(false);
  const [opAbierta, setOpAbierta] = useState<Id | null>(null);
  const { municipioId } = destinoElegido(db, tipo, sel);
  const municipios = Object.values(db.municipios).sort((a, b) => (a.id === municipioDeEspacio(tipo) ? -1 : b.id === municipioDeEspacio(tipo) ? 1 : a.nombre.localeCompare(b.nombre, 'es')));
  const mun = municipioId ? db.municipios[municipioId] : null;
  const callejero = mun ? callejeroDe(db, mun.id) : null;
  const campanas = mun ? Object.values(db.campanas).filter((c) => c.municipioId === mun.id).sort(porAnio) : [];
  const cfg = mun ? configTerritorialDe(db, mun.id) : undefined;
  return (
    <div className="col" style={{ gap: 14 }}>
      <section className="tarjeta inc-bloque" aria-label="Municipios">
        <div className="fila mun-cab">
          <h2 style={{ margin: 0 }}><MapPinned size={18} /> Municipios</h2>
          <span className="esp" />
          {!alta && <button className="btn s" onClick={() => setAlta(true)}><Plus size={14} /> Dar de alta un municipio</button>}
        </div>
        <p className="muted mun-donde"><HardDrive size={13} aria-hidden /> Se guardan en la base <b className="mono">{BASE_INDEXEDDB[tipo]}</b> de <b>este navegador</b>. No se comparten con otras personas de la Cátedra ni se envían a ningún servidor.</p>
        {alta && <FormMunicipio onCerrar={(id) => { setAlta(false); if (id) sel.elegir({ municipioId: id, campanaId: null }); }} />}
        <div className="mun-lista">
          {municipios.map((m) => {
            const cj = callejeroDe(db, m.id);
            const n = Object.values(db.campanas).filter((c) => c.municipioId === m.id).length;
            const on = m.id === municipioId;
            return (
              <button key={m.id} className={`mun-tarjeta ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => sel.elegir({ municipioId: m.id, campanaId: null })}>
                <b>{m.nombre}</b>
                <span className="muted">{m.provincia}{m.ine ? ` · INE ${m.ine}` : ''}</span>
                <span className={`chip ${cj.disponible ? 'ok' : 'aviso'}`}>{cj.disponible ? `Callejero: ${fmt(cj.calles)} calles` : 'Sin callejero'}</span>
                <span className="muted">{n} campaña{n === 1 ? '' : 's'}</span>
              </button>
            );
          })}
        </div>
      </section>

      {mun && <CallejeroMunicipio key={mun.id} municipioId={mun.id} />}

      {mun && (
        <section className="tarjeta inc-bloque" aria-label="Campañas">
          <div className="fila mun-cab">
            <h2 style={{ margin: 0 }}>Campañas de {mun.nombre}</h2>
            <span className="esp" />
            {!nuevaCampana && <button className="btn s" onClick={() => setNuevaCampana(true)}><CalendarPlus size={14} /> Nueva campaña</button>}
          </div>
          {callejero && !callejero.disponible && (
            <div className="t-info aviso" role="note"><AlertTriangle size={15} /> <div><b>{mun.nombre} todavía no tiene callejero.</b> Puede crear campañas e incorporar censos: los registros se conservan, pero su conciliación territorial (calles y locales) queda pendiente hasta que se cargue el callejero.</div></div>
          )}
          <p className="muted" style={{ margin: 0 }}>
            Territorio: CP {cfg ? USOS_TERRITORIALES[cfg.cp.uso].toLowerCase() : 'sin configurar'}{cfg?.cp.valorFijo ? ` (${cfg.cp.valorFijo})` : ''} · Distrito {cfg ? USOS_TERRITORIALES[cfg.distrito.uso].toLowerCase() : '—'} · Zona {cfg ? USOS_TERRITORIALES[cfg.zona.uso].toLowerCase() : '—'}
            {callejero?.disponible ? ` · Callejero: ${callejero.texto}` : ''}
          </p>
          {nuevaCampana && <FormCampana municipioId={mun.id} onCerrar={(id) => { setNuevaCampana(false); if (id) sel.elegir({ municipioId: mun.id, campanaId: id }); }} />}
          {campanas.length === 0 ? <p className="muted">Todavía no hay campañas. Cree una histórica para incorporar un censo ya realizado.</p> : (
            <div className="tabla-scroll">
              <table className="tabla ap-tabla camp-tabla" aria-label={`Campañas de ${mun.nombre}`}>
                <thead><tr><th>Campaña</th><th>Año</th><th>Tipo</th><th>Contenido</th><th /></tr></thead>
                <tbody>{campanas.map((c) => <FilaCampana key={c.id} c={c} abierta={opAbierta === c.id} onItinerarios={() => setOpAbierta(opAbierta === c.id ? null : c.id)} />)}</tbody>
              </table>
            </div>
          )}
          {opAbierta && db.campanas[opAbierta]?.municipioId === mun.id && <CampanaOperativa campanaId={opAbierta} />}
        </section>
      )}
    </div>
  );
}

function FilaCampana({ c, abierta, onItinerarios }: { c: Campana; abierta: boolean; onItinerarios: () => void }) {
  const db = useEspacios((s) => s.db!);
  const sel = useSeleccionEspacio();
  const cont = contenidoCampana(db, c.id);
  const clase = claseCampana(c);
  const destino = clase === 'historica' && !motivoNoDestino(db, c.id, c.municipioId, c.anio);
  return (
    <tr>
      <td>{c.nombre}</td>
      <td className="num">{c.anio}</td>
      <td>{CLASE_CAMPANA_TXT[clase].nombre}{clase === 'operativa' ? <span className="muted"> · {TIPO_OPERATIVA_TXT[c.tipo as TipoOperativa] ?? c.tipo}</span> : null}</td>
      <td>{cont.vacia ? <span className="muted">Vacía{destino ? ' · lista para incorporar' : ''}</span> : `${fmt(cont.registros)} registros · ${cont.importaciones.length} incorporación(es)`}</td>
      <td>{clase === 'operativa' && <button className={`btn s ${abierta ? 'primario' : ''}`} aria-expanded={abierta} onClick={onItinerarios}>Itinerarios y censo</button>}{destino && (
        <button className="btn s" onClick={() => {
          sel.elegir({ modo: 'historico', municipioId: c.municipioId, campanaId: c.id, itinerarioId: null });
          useAsistenteEspacio.getState().set({ preparado: null, etapa: 1 });
          document.querySelector('[aria-label="Incorporar un censo"]')?.scrollIntoView?.({ behavior: 'smooth' });
        }}>Incorporar un Excel aquí</button>
      )}</td>
    </tr>
  );
}

// ───────────── Formularios ─────────────

const USOS = Object.entries(USOS_TERRITORIALES) as [ReglaTerritorial['uso'], string][];

function ReglaCampo({ etiqueta, regla, onCambiar, conValor }: { etiqueta: string; regla: ReglaTerritorial; onCambiar: (r: ReglaTerritorial) => void; conValor?: boolean }) {
  return (
    <label className="campo">
      <span>{etiqueta}</span>
      <select className="input" aria-label={etiqueta} value={regla.uso} onChange={(e) => onCambiar({ ...regla, uso: e.target.value as ReglaTerritorial['uso'], ...(e.target.value === 'no-se-usa' ? { obligatorio: false } : {}) })}>
        {USOS.filter(([u]) => conValor || u !== 'fijo').map(([u, t]) => <option key={u} value={u}>{t}</option>)}
      </select>
      {regla.uso === 'fijo' && <input className="input" aria-label={`Valor único de ${etiqueta}`} placeholder="p. ej. 47400" value={regla.valorFijo ?? ''} onChange={(e) => onCambiar({ ...regla, valorFijo: e.target.value })} />}
    </label>
  );
}

export function FormMunicipio({ onCerrar }: { onCerrar: (municipioId?: Id) => void }) {
  const db = useEspacios((s) => s.db!);
  const alta = useEspacios((s) => s.altaMunicipio);
  const ocupado = useEspacios((s) => s.ocupado);
  const [nombre, setNombre] = useState('');
  const [provincia, setProvincia] = useState('');
  const [ine, setIne] = useState('');
  const [t, setT] = useState<ConfigTerritorialMunicipio>(TERRITORIO_INICIAL);
  const [error, setError] = useState<string | null>(null);
  const datos = { nombre, provincia, ine, territorio: t };
  const problemas = nombre.trim() && provincia.trim() ? validarMunicipio(db, datos) : [];
  return (
    <div className="mun-form" role="group" aria-label="Alta de municipio">
      <div className="fila mun-form-cab"><b>Nuevo municipio</b><span className="esp" /><button className="btn s fantasma" aria-label="Cerrar el alta" onClick={() => onCerrar()}><X size={14} /></button></div>
      <div className="col-ctrl">
        <label className="campo"><span>Nombre del municipio</span><input className="input" aria-label="Nombre del municipio" value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
        <label className="campo"><span>Provincia</span><input className="input" aria-label="Provincia" value={provincia} onChange={(e) => setProvincia(e.target.value)} /></label>
        <label className="campo"><span>Código INE (opcional)</span><input className="input" aria-label="Código INE" inputMode="numeric" maxLength={5} placeholder="5 cifras" value={ine} onChange={(e) => setIne(e.target.value)} /></label>
      </div>
      <p className="muted" style={{ margin: 0 }}>Cómo se usan los datos territoriales en este municipio (se pueden dejar como están):</p>
      <div className="col-ctrl">
        <ReglaCampo etiqueta="Código postal" regla={t.cp} conValor onCambiar={(cp) => setT({ ...t, cp })} />
        <ReglaCampo etiqueta="Distrito" regla={t.distrito} onCambiar={(distrito) => setT({ ...t, distrito })} />
        <ReglaCampo etiqueta="Zona" regla={t.zona} onCambiar={(zona) => setT({ ...t, zona })} />
      </div>
      <div className="t-info" role="note"><AlertTriangle size={15} /> <div>El municipio se crea <b>sin callejero</b>: no se inventa ninguno. Lo que se incorpore quedará pendiente de conciliación territorial hasta que se cargue su callejero.</div></div>
      {(error || problemas[0]) && <div className="t-info error" role="alert">{error ?? problemas[0]}</div>}
      <div className="fila">
        <span className="esp" />
        <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" disabled={!nombre.trim() || !provincia.trim() || problemas.length > 0 || !!ocupado} onClick={async () => {
          const r = await alta({ ...datos, ine: ine.trim() || undefined });
          if (!r.ok) return setError(r.error ?? 'No se ha dado de alta.');
          onCerrar(r.municipioId);
        }}><CheckCircle2 size={15} /> Dar de alta</button>
      </div>
    </div>
  );
}

export function FormCampana({ municipioId, soloHistorica, onCerrar }: { municipioId: Id; soloHistorica?: boolean; onCerrar: (campanaId?: Id) => void }) {
  const db = useEspacios((s) => s.db!);
  const crear = useEspacios((s) => s.crearCampana);
  const ocupado = useEspacios((s) => s.ocupado);
  const [clase, setClase] = useState<ClaseCampana>('historica');
  const [anio, setAnio] = useState(String(ANIO_ACTUAL - 1));
  const [nombre, setNombre] = useState<string | null>(null);
  const [tipoOp, setTipoOp] = useState<TipoOperativa>('actualizacion');
  const historicas = Object.values(db.campanas).filter((c) => c.municipioId === municipioId && claseCampana(c) === 'historica').sort(porAnio);
  const [referencia, setReferencia] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const nombreFinal = nombre ?? `Censo ${anio}${clase === 'historica' ? ' · histórico' : ''}`;
  const datos = { municipioId, anio: Number(anio), nombre: nombreFinal, clase, ...(clase === 'operativa' ? { tipoOperativa: tipoOp, ...(referencia ? { campanaReferenciaId: referencia } : {}) } : {}) };
  const problemas = validarCampana(db, datos);
  return (
    <div className="mun-form" role="group" aria-label="Nueva campaña">
      <div className="fila mun-form-cab"><b>Nueva campaña de {db.municipios[municipioId]?.nombre}</b><span className="esp" /><button className="btn s fantasma" aria-label="Cerrar la nueva campaña" onClick={() => onCerrar()}><X size={14} /></button></div>
      {!soloHistorica && (
        <div className="segmentado" role="radiogroup" aria-label="Tipo de campaña">
          {(['historica', 'operativa'] as ClaseCampana[]).map((k) => (
            <button key={k} role="radio" aria-checked={clase === k} className={clase === k ? 'on' : ''} onClick={() => setClase(k)}>{CLASE_CAMPANA_TXT[k].nombre}</button>
          ))}
        </div>
      )}
      <p className="muted" style={{ margin: 0 }}>{CLASE_CAMPANA_TXT[clase].ayuda} Puede haber varias campañas del mismo año con nombres distintos.</p>
      <div className="col-ctrl">
        <label className="campo"><span>Año</span><input className="input" type="number" aria-label="Año de la campaña" value={anio} onChange={(e) => setAnio(e.target.value)} /></label>
        <label className="campo"><span>Nombre</span><input className="input" aria-label="Nombre de la campaña" value={nombreFinal} onChange={(e) => setNombre(e.target.value)} /></label>
        {clase === 'operativa' && (
          <label className="campo"><span>Clase de censo</span>
            <select className="input" aria-label="Clase de censo" value={tipoOp} onChange={(e) => setTipoOp(e.target.value as TipoOperativa)}>
              {(Object.entries(TIPO_OPERATIVA_TXT) as [TipoOperativa, string][]).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </label>
        )}
        {clase === 'operativa' && (
          <label className="campo"><span>Censo anterior de referencia</span>
            <select className="input" aria-label="Censo anterior de referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)}>
              <option value="">Ninguno</option>
              {historicas.filter((c) => c.anio < Number(anio)).map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.anio})</option>)}
            </select>
          </label>
        )}
      </div>
      {(error || problemas[0]) && <div className="t-info error" role="alert">{error ?? problemas[0]}</div>}
      <div className="fila">
        <span className="esp" />
        <button className="btn" onClick={() => onCerrar()}>Cancelar</button>
        <button className="btn primario" disabled={problemas.length > 0 || !!ocupado} onClick={async () => {
          const r = await crear(datos);
          if (!r.ok) return setError(r.error ?? 'No se ha creado.');
          onCerrar(r.campanaId);
        }}><CheckCircle2 size={15} /> Crear la campaña</button>
      </div>
    </div>
  );
}
