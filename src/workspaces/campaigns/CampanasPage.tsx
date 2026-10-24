import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarRange, FileSpreadsheet, MapPinned, Plus, Route, Users } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useStore } from '../../store/store';
import type { BaseDatos } from '../../domain/db';
import { coberturaCalle, esCompletada, itinerariosDe } from '../../domain/consultas';
import { asignacionDelAmbito, progresoItinerario } from '../../domain/planificacion';
import type { Campana, FaseEstado, TipoCampana } from '../../domain/types';
import { Avatares, Fase, Modal, Pct, Sim, fmt } from '../../components/ui';
import { formatoDistancia } from '../../domain/geo';
import '../../styles/campanas.css';

const TIPO_TXT: Record<TipoCampana, string> = {
  nuevo: 'Censo nuevo',
  actualizacion: 'Actualización',
  mixto: 'Actualización + ampliación',
  'historico-importado': 'Histórico importado',
};

export function metricasCampana(db: BaseDatos, c: Campana) {
  const its = itinerariosDe(db, c.id);
  const asig = asignacionDelAmbito(c, its, db.calles);
  const km = c.ambitoCalleIds.reduce((a, id) => a + (db.calles[id]?.longitudM ?? 0), 0);
  const completadas = c.ambitoCalleIds.filter((id) => esCompletada(coberturaCalle(db, c.id, id).estado)).length;
  const revs = Object.values(db.revisiones).filter((r) => r.campanaId === c.id);
  const cat = revs.filter((r) => r.categorizacion === 'revisado').length;
  const dig = revs.filter((r) => r.digital === 'revisado').length;
  const val = revs.filter((r) => r.validacion === 'aprobada').length;
  const personas = [...new Set(its.flatMap((i) => i.asignadosIds))].map((id) => db.personas[id]);
  const terminados = its.filter((i) => progresoItinerario(db, i).campoTerminado).length;
  return { its, asig, km, completadas, revs: revs.length, cat, dig, val, personas, terminados };
}

export default function CampanasPage() {
  const { db, municipio, campana } = useContexto();
  const setPrefs = useStore((s) => s.setPrefs);
  const nav = useNavigate();
  const [nueva, setNueva] = useState(false);
  const campanas = useMemo(() => Object.values(db.campanas).filter((c) => c.municipioId === municipio.id).sort((a, b) => b.anio - a.anio), [db, municipio.id]);

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div className="esp">
          <div className="rotulo sin-linea">01 · Municipios y campañas</div>
          <h1>Cartera de censos</h1>
          <p>Cada campaña tiene cuatro estados independientes. Un campo terminado no es un censo terminado.</p>
        </div>
        <button className="btn primario" onClick={() => setNueva(true)}>
          <Plus size={16} /> Nueva campaña
        </button>
      </div>

      <div className="municipios">
        {Object.values(db.municipios).map((m) => {
          const cs = Object.values(db.campanas).filter((c) => c.municipioId === m.id);
          const locales = Object.values(db.locales).filter((l) => l.municipioId === m.id).length;
          const on = m.id === municipio.id;
          return (
            <button
              key={m.id}
              className={`municipio tarjeta ${on ? 'on' : ''}`}
              onClick={() => setPrefs({ municipioId: m.id, campanaId: cs.sort((a, b) => b.anio - a.anio)[0]?.id })}
            >
              <div className="fila">
                <MapPinned size={18} />
                <b>{m.nombre}</b>
                <span className="esp" />
                {m.id === 'mun-medina' ? <span className="chip azul">Caso piloto</span> : <Sim texto="Demo de volumen" />}
              </div>
              <div className="municipio-datos mono">
                {m.centro ? `${m.centro[1].toFixed(4)}° N · ${Math.abs(m.centro[0]).toFixed(4)}° O` : 'Sin coordenadas'}
              </div>
              <div className="fila" style={{ gap: 18, marginTop: 6 }}>
                <span>
                  <b className="num">{cs.length}</b> <span className="muted">campañas</span>
                </span>
                <span>
                  <b className="num">{fmt(locales)}</b> <span className="muted">locales físicos</span>
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6, textAlign: 'left' }}>
                Callejero:{' '}
                {m.fuenteCallejero === 'osm' ? (
                  <span className="chip real">OSM real</span>
                ) : m.fuenteCallejero === 'simulado' ? (
                  <Sim texto="Geometría simulada" />
                ) : (
                  <span className="chip">Sin geometría</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="rotulo" style={{ margin: '28px 0 12px' }}>
        Campañas de {municipio.nombre}
      </div>
      <div className="linea-tiempo">
        {campanas.map((c) => (
          <TarjetaCampana
            key={c.id}
            c={c}
            activa={c.id === campana?.id}
            onAbrir={(destino) => {
              setPrefs({ campanaId: c.id });
              nav(destino);
            }}
          />
        ))}
      </div>
      {nueva && <NuevaCampana onCerrar={() => setNueva(false)} />}
    </div>
  );
}

function TarjetaCampana({ c, activa, onAbrir }: { c: Campana; activa: boolean; onAbrir: (destino: string) => void }) {
  const { db } = useContexto();
  const m = useMemo(() => metricasCampana(db, c), [db, c]);
  const nAmbito = c.ambitoCalleIds.length;
  const fases: { k: keyof Campana['estados']; t: string; v: number; detalle: string }[] = [
    {
      k: 'planificacion', t: 'Planificación',
      v: c.tipo === 'historico-importado' ? 1 : nAmbito ? m.asig.completa.length / nAmbito : 0,
      detalle: c.tipo === 'historico-importado' ? 'Sin itinerarios (censo importado)' : db.municipios[c.municipioId]?.fuenteCallejero === 'sin-geometria' ? 'Itinerarios no incluidos en la demo de volumen' : `${m.its.length} de ~${c.itinerariosPrevistos ?? m.its.length} itinerarios · ${m.asig.sinAsignar.length} calles sin asignar`,
    },
    {
      k: 'campo', t: 'Trabajo de campo', v: c.estados.campo === 'terminado' ? 1 : nAmbito ? m.completadas / nAmbito : 0,
      detalle: c.tipo === 'historico-importado' ? 'Recogido fuera de la aplicación' : `${m.completadas}/${nAmbito} calles completadas · ${m.terminados} itinerario(s) con campo terminado`,
    },
    { k: 'revision', t: 'Revisión de oficina', v: m.revs ? (m.cat + m.dig) / (2 * m.revs) : 0, detalle: `Categorización ${m.cat}/${m.revs} · Digital ${m.dig}/${m.revs}` },
    { k: 'validacion', t: 'Validación', v: m.revs ? m.val / m.revs : 0, detalle: `${fmt(m.val)} de ${fmt(m.revs)} registros aprobados` },
  ];
  return (
    <article className={`campana tarjeta ${activa ? 'activa' : ''}`}>
      <div className="campana-anio mono">{c.anio}</div>
      <div className="campana-cuerpo">
        <div className="fila" style={{ flexWrap: 'wrap' }}>
          <h3>{c.nombre}</h3>
          <span className="chip">{TIPO_TXT[c.tipo]}</span>
          {c.procedencia === 'simulado' && <Sim texto="Contenido simulado" />}
          <span className="esp" />
          {activa && <span className="chip azul">Campaña activa</span>}
        </div>
        <div className="campana-meta">
          <span><CalendarRange size={14} /> {c.periodo.inicio}{c.periodo.fin ? ` → ${c.periodo.fin}` : ' → en curso'}</span>
          <span><Route size={14} /> {fmt(nAmbito)} calles · {formatoDistancia(m.km)}</span>
          {c.ampliacionCalleIds.length > 0 && (
            <span className="chip aviso" title="Calles incorporadas respecto a la campaña anterior: en los análisis se separan de la evolución real">
              +{c.ampliacionCalleIds.length} calles por ampliación
            </span>
          )}
          {m.personas.length > 0 && (
            <span className="fila" style={{ gap: 6 }}>
              <Users size={14} /> <Avatares personas={m.personas} size={20} />
            </span>
          )}
          {c.encargo && <span className="muted">{c.encargo}</span>}
        </div>
        <div className="fases">
          {fases.map((f) => (
            <div key={f.k} className="fase">
              <div className="fila">
                <span className="fase-t">{f.t}</span>
                <span className="esp" />
                <Fase e={c.estados[f.k] as FaseEstado} />
              </div>
              <Pct v={f.v} color={f.v >= 1 ? 'var(--e-ok)' : 'var(--azul)'} />
              <div className="fase-d">{f.detalle}</div>
            </div>
          ))}
        </div>
        <div className="fila" style={{ flexWrap: 'wrap', marginTop: 4 }}>
          {c.tipo !== 'historico-importado' && db.municipios[c.municipioId]?.fuenteCallejero !== 'sin-geometria' && (
            <button className="btn primario s" onClick={() => onAbrir('/territorio')}>
              <Route size={14} /> Planificar territorio
            </button>
          )}
          <button className="btn s" onClick={() => onAbrir('/oficina')}>
            Bandeja de oficina <ArrowRight size={14} />
          </button>
          {c.tipo === 'historico-importado' && (
            <button className="btn s" onClick={() => onAbrir('/datos')}>
              <FileSpreadsheet size={14} /> Ver importación
            </button>
          )}
          <button className="btn s fantasma" onClick={() => onAbrir('/analisis')}>
            Análisis
          </button>
        </div>
      </div>
    </article>
  );
}

function NuevaCampana({ onCerrar }: { onCerrar: () => void }) {
  const { db, municipio, campanas } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const setPrefs = useStore((s) => s.setPrefs);
  const ultima = campanas[campanas.length - 1];
  const [anio, setAnio] = useState((ultima?.anio ?? 2026) + 1);
  const [tipo, setTipo] = useState<TipoCampana>('actualizacion');
  const [ref, setRef] = useState(ultima?.id ?? '');
  const [heredar, setHeredar] = useState(true);
  const [previstos, setPrevistos] = useState(7);
  const crear = () => {
    const id = `camp-${municipio.id.slice(4)}-${anio}-${Date.now().toString(36)}`;
    const base = ref ? db.campanas[ref] : undefined;
    aplicar(
      (d) => ({
        ...d,
        campanas: {
          ...d.campanas,
          [id]: {
            id, municipioId: municipio.id, anio, nombre: `Censo ${anio}`, tipo, periodo: { inicio: `${anio}-01-15` },
            ambitoCalleIds: heredar && base ? [...base.ambitoCalleIds] : [], ampliacionCalleIds: [],
            campanaReferenciaId: tipo === 'nuevo' ? undefined : ref || undefined, itinerariosPrevistos: previstos,
            estados: { planificacion: 'pendiente', campo: 'pendiente', revision: 'pendiente', validacion: 'pendiente' },
            procedencia: 'manual',
          },
        },
      }),
      `Campaña ${anio} creada`,
    );
    setPrefs({ campanaId: id });
    onCerrar();
  };
  return (
    <Modal
      titulo="Nueva campaña"
      sub={`${municipio.nombre} · los itinerarios de campañas anteriores no se modifican`}
      onCerrar={onCerrar}
      pie={
        <>
          <button className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn primario" onClick={crear}>Crear campaña</button>
        </>
      }
    >
      <div className="grid2">
        <div className="campo">
          <label>Año</label>
          <input className="input num" type="number" value={anio} onChange={(e) => setAnio(+e.target.value)} />
        </div>
        <div className="campo">
          <label>Tipo de trabajo</label>
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value as TipoCampana)}>
            <option value="nuevo">Censo nuevo</option>
            <option value="actualizacion">Actualización</option>
            <option value="mixto">Mixto (actualización + ampliación)</option>
          </select>
        </div>
        <div className="campo">
          <label>Campaña de referencia</label>
          <select className="input" value={ref} onChange={(e) => setRef(e.target.value)} disabled={tipo === 'nuevo'}>
            {campanas.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label>Itinerarios previstos</label>
          <input className="input num" type="number" value={previstos} onChange={(e) => setPrevistos(+e.target.value)} />
        </div>
      </div>
      <label className="fila" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={heredar} onChange={(e) => setHeredar(e.target.checked)} />
        Partir del ámbito territorial de la campaña de referencia (se podrá ampliar en Territorio)
      </label>
    </Modal>
  );
}
