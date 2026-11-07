import { useMemo, useState } from 'react';
import { AlertTriangle, BookMarked, CheckCircle2, ClipboardCopy, FileUp, Map as MapIcon, MapPinPlus, Search, X, XCircle } from 'lucide-react';
import { fmt } from '../../components/ui';
import { useEspacios } from '../../store/espacios';
import {
  altaCalle, anadirAlias, anadirReferencia, aplicarCarga, callesDe, corregirCalle, FORMA_TXT, formaDe, nombreDeAlta, planificarCarga, rechazarCalle, referenciasDe,
  resumenCallejero, retirarAlias, retirarReferencia, TIPO_ALIAS_TXT, TIPOS_VIA_ALTA, usosDeCalle, validarAltaCalle, validarCalle, type AccionVia, type PlanCarga,
} from '../../domain/callejeros';
import { consultaOverpassMunicipio, leerFuenteCallejero, type LecturaCallejero } from '../../domain/fuentesCallejero';
import type { AliasCalle, Calle, Id } from '../../domain/types';
import { leerTexto } from './leerArchivo';

/**
 * G3 · Callejero de un municipio: cargas desde fuentes verificables (con vista previa), altas manuales
 * supervisadas, alias y nombres históricos, y referencias de denominación. Todo con traza.
 */

type Panel = null | 'cargar' | 'alta' | 'vias' | 'referencias';

export function CallejeroMunicipio({ municipioId }: { municipioId: Id }) {
  const db = useEspacios((s) => s.db!);
  const [panel, setPanel] = useState<Panel>(null);
  const mun = db.municipios[municipioId];
  const r = resumenCallejero(db, municipioId);
  const cargas = mun.callejero?.cargas ?? [];
  const alternar = (p: Panel) => setPanel(panel === p ? null : p);
  return (
    <section className="tarjeta inc-bloque" aria-label="Callejero">
      <div className="fila mun-cab">
        <h2 style={{ margin: 0 }}><MapIcon size={18} /> Callejero de {mun.nombre}</h2>
        <span className="esp" />
        <div className="fila cj-acciones">
          <button className={`btn s ${panel === 'cargar' ? 'primario' : ''}`} aria-pressed={panel === 'cargar'} onClick={() => alternar('cargar')}><FileUp size={14} /> Cargar callejero</button>
          <button className={`btn s ${panel === 'alta' ? 'primario' : ''}`} aria-pressed={panel === 'alta'} onClick={() => alternar('alta')}><MapPinPlus size={14} /> Añadir calle o plaza</button>
          <button className={`btn s ${panel === 'vias' ? 'primario' : ''}`} aria-pressed={panel === 'vias'} onClick={() => alternar('vias')}><Search size={14} /> Ver vías</button>
          <button className={`btn s ${panel === 'referencias' ? 'primario' : ''}`} aria-pressed={panel === 'referencias'} onClick={() => alternar('referencias')}><BookMarked size={14} /> Referencias</button>
        </div>
      </div>
      <div className="col-resumen" aria-label="Resumen del callejero">
        <span className={`chip ${r.vias ? 'ok' : 'aviso'}`}>{r.vias ? `${fmt(r.vias)} vías` : 'Sin callejero'}</span>
        {r.vias > 0 && <span className="chip">{fmt(r.plazas)} plazas y espacios</span>}
        {r.sinGeometria > 0 && <span className="chip">{fmt(r.sinGeometria)} sin geometría</span>}
        {r.manuales > 0 && <span className="chip">{fmt(r.manuales)} añadidas a mano</span>}
        {r.propuestas > 0 && <span className="chip aviso">{fmt(r.propuestas)} alta(s) por validar</span>}
        {r.alias > 0 && <span className="chip">{fmt(r.alias)} alias</span>}
        <span className="muted">{fmt(r.segmentos)} segmentos identificados</span>
      </div>
      {!r.vias && <p className="muted" style={{ margin: 0 }}>Cargue el callejero desde OpenStreetMap o desde el callejero oficial del ayuntamiento, o añada las vías una a una. Mientras no haya callejero, la conciliación territorial queda pendiente.</p>}
      {cargas.length > 0 && (
        <div className="tabla-scroll">
          <table className="tabla ap-tabla cj-cargas" aria-label="Cargas del callejero">
            <thead><tr><th>Fecha</th><th>Fuente</th><th>Datos a</th><th>Versión</th><th>Resultado</th></tr></thead>
            <tbody>{cargas.map((c) => (
              <tr key={c.id}>
                <td>{c.fecha.slice(0, 10)}<div className="muted">{db.personas[c.porId]?.nombre ?? c.porId}</div></td>
                <td>{c.fuente}<div className="muted mono cj-archivo">{c.tipo === 'osm' ? 'OSM' : 'Oficial'} · {c.archivo} · {c.sha256.slice(0, 12)}…</div></td>
                <td>{c.fechaDatos?.slice(0, 10) ?? '—'}</td>
                <td>{c.version ?? '—'}</td>
                <td>{c.resumen.nuevas} nuevas · {c.resumen.actualizadas} actualizadas{c.resumen.conflictos ? ` · ${c.resumen.conflictos} por revisar` : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {mun.callejero?.limite && <p className="muted" style={{ margin: 0 }}>Límite administrativo verificado: {mun.callejero.limite.nombre ?? mun.nombre}{mun.callejero.limite.ine ? ` (INE ${mun.callejero.limite.ine})` : ''} · <span className="mono">{mun.callejero.limite.fuente}</span></p>}
      {panel === 'cargar' && <CargarCallejero municipioId={municipioId} onCerrar={() => setPanel('vias')} />}
      {panel === 'alta' && <AltaVia municipioId={municipioId} onCerrar={() => setPanel('vias')} />}
      {panel === 'vias' && <ListaVias municipioId={municipioId} />}
      {panel === 'referencias' && <Referencias municipioId={municipioId} />}
    </section>
  );
}

// ───────────── Cargar ─────────────

const ACCION_TXT: Record<AccionVia, string> = { nueva: 'Nueva', actualizada: 'Actualizada', 'sin-cambios': 'Sin cambios', conflicto: 'Por revisar' };

function CargarCallejero({ municipioId, onCerrar }: { municipioId: Id; onCerrar: () => void }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const mun = db.municipios[municipioId];
  const [tipo, setTipo] = useState<'osm' | 'oficial'>('osm');
  const [archivo, setArchivo] = useState<{ nombre: string; texto: string; lectura: LecturaCallejero } | null>(null);
  const [fuente, setFuente] = useState('OpenStreetMap (Overpass API)');
  const [fechaDatos, setFechaDatos] = useState('');
  const [version, setVersion] = useState('');
  const [licencia, setLicencia] = useState('ODbL 1.0');
  const [ver, setVer] = useState<AccionVia>('nueva');
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const consulta = consultaOverpassMunicipio({ nombre: mun.nombre, ine: mun.ine });
  const lectura = archivo?.lectura.ok ? archivo.lectura : null;
  const plan: PlanCarga | null = useMemo(() => (lectura && archivo ? planificarCarga(db, municipioId, lectura, { contenido: archivo.texto }) : null), [db, municipioId, lectura, archivo]);
  const cambiarTipo = (t: 'osm' | 'oficial') => {
    setTipo(t);
    setArchivo(null);
    setMsg(null);
    setFuente(t === 'osm' ? 'OpenStreetMap (Overpass API)' : '');
    setLicencia(t === 'osm' ? 'ODbL 1.0' : '');
  };
  const aplicar = async () => {
    if (!lectura || !archivo) return;
    const r = await modificar('Aplicando la carga del callejero…', (d, ctx) => aplicarCarga(d, municipioId, lectura, { archivo: archivo.nombre, contenido: archivo.texto, fuente, fechaDatos: fechaDatos || undefined, version, licencia }, ctx).db);
    if (!r.ok) return setMsg({ ok: false, texto: r.error ?? 'No se ha aplicado.' });
    setMsg({ ok: true, texto: 'Carga aplicada y guardada.' });
    setArchivo(null);
    onCerrar();
  };
  const aplicable = !!plan && !plan.repetida && plan.resumen.nuevas + plan.resumen.actualizadas > 0 && fuente.trim().length >= 3;
  return (
    <div className="mun-form" role="group" aria-label="Cargar callejero">
      <div className="segmentado" role="radiogroup" aria-label="Fuente del callejero">
        <button role="radio" aria-checked={tipo === 'osm'} className={tipo === 'osm' ? 'on' : ''} onClick={() => cambiarTipo('osm')}>OpenStreetMap</button>
        <button role="radio" aria-checked={tipo === 'oficial'} className={tipo === 'oficial' ? 'on' : ''} onClick={() => cambiarTipo('oficial')}>Callejero oficial</button>
      </div>
      {tipo === 'osm' ? (
        <>
          <ol className="inc-lista cj-pasos">
            <li>Copie la consulta. Obtiene las calles, plazas y espacios con nombre <b>dentro del límite administrativo</b> de {mun.nombre}{mun.ine ? ` (INE ${mun.ine})` : ''}.</li>
            <li>Ejecútela en <b>overpass-turbo.eu</b> y use «Exportar» → «datos sin procesar» (raw data). ULIT no se conecta a ningún servicio externo: el archivo lo aporta usted.</li>
            <li>Seleccione aquí el archivo. Se comprueba que el límite es el de {mun.nombre} y que cada vía cae dentro.</li>
          </ol>
          {!mun.ine && <div className="t-info aviso" role="note"><AlertTriangle size={15} /> <div>El municipio no tiene código INE: la consulta usa el nombre y podría haber municipios homónimos (el archivo se rechazaría).</div></div>}
          <div className="cj-consulta">
            <textarea className="input mono" readOnly aria-label="Consulta de Overpass" rows={6} value={consulta} />
            <button className="btn s" onClick={() => void navigator.clipboard?.writeText(consulta)}><ClipboardCopy size={14} /> Copiar la consulta</button>
          </div>
        </>
      ) : (
        <p className="muted" style={{ margin: 0 }}>CSV (separado por «;», «,» o tabulador) o GeoJSON con el <b>nombre</b> de la vía y, si los tiene, su <b>tipo</b>, su <b>código</b> y el <b>municipio</b> (si viene, debe ser {mun.nombre}{mun.ine ? ` o ${mun.ine}` : ''}). Las vías sin geometría se incorporan igualmente: existen aunque no estén dibujadas.</p>
      )}
      <label className="campo"><span>Archivo</span>
        <input type="file" aria-label="Archivo del callejero" accept={tipo === 'osm' ? '.json,application/json' : '.csv,.txt,.tsv,.json,.geojson'} onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          setMsg(null);
          if (!f) return setArchivo(null);
          const texto = await leerTexto(f);
          const l = leerFuenteCallejero(texto, f.name, tipo, { nombre: mun.nombre, ine: mun.ine });
          setArchivo({ nombre: f.name, texto, lectura: l });
          if (l.ok && l.fechaDatos) setFechaDatos(l.fechaDatos.slice(0, 10));
        }} />
      </label>
      <div className="col-ctrl">
        <label className="campo"><span>Fuente (organismo, servicio o dirección web)</span><input className="input" aria-label="Fuente del callejero" value={fuente} onChange={(e) => setFuente(e.target.value)} placeholder="p. ej. Ayuntamiento de …, callejero municipal" /></label>
        <label className="campo"><span>Fecha de los datos</span><input className="input" type="date" aria-label="Fecha de los datos" value={fechaDatos} onChange={(e) => setFechaDatos(e.target.value)} /></label>
        <label className="campo"><span>Versión (opcional)</span><input className="input" aria-label="Versión del callejero" value={version} onChange={(e) => setVersion(e.target.value)} /></label>
        <label className="campo"><span>Licencia (opcional)</span><input className="input" aria-label="Licencia del callejero" value={licencia} onChange={(e) => setLicencia(e.target.value)} /></label>
      </div>
      {archivo && !archivo.lectura.ok && <div className="t-info error" role="alert"><XCircle size={15} /> <div>{archivo.lectura.motivo}</div></div>}
      {plan && (
        <div className="col" style={{ gap: 8 }} aria-label="Vista previa de la carga">
          <b>Vista previa (todavía no se ha cambiado nada)</b>
          <div className="ap-resumen cj-resumen">
            {(['nueva', 'actualizada', 'sin-cambios', 'conflicto'] as AccionVia[]).map((a) => (
              <button key={a} className={`ap-celda ${ver === a ? 'on' : ''}`} aria-pressed={ver === a} onClick={() => setVer(a)}>
                <span className="muted">{ACCION_TXT[a]}</span><b>{plan.vias.filter((v) => v.accion === a).length}</b>
              </button>
            ))}
            <div className="ap-celda"><span className="muted">Plazas y espacios</span><b>{plan.resumen.plazas}</b></div>
            <div className="ap-celda"><span className="muted">Agrupadas (mismo nombre)</span><b>{plan.resumen.agrupadas}</b></div>
            <div className="ap-celda"><span className="muted">Descartadas</span><b>{plan.resumen.descartadas}</b></div>
          </div>
          {plan.avisos.length > 0 && <ul className="inc-lista">{plan.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
          <div className="tabla-scroll cj-lista">
            <table className="tabla ap-tabla" aria-label={`Vías: ${ACCION_TXT[ver]}`}>
              <thead><tr><th>Vía</th><th>Forma</th><th className="num">Segmentos</th>{ver === 'conflicto' && <th>Motivo</th>}</tr></thead>
              <tbody>{plan.vias.filter((v) => v.accion === ver).slice(0, 200).map((v) => (
                <tr key={`${v.nombre}-${v.calleId ?? ''}`}><td>{v.nombre}</td><td>{FORMA_TXT[v.forma]}</td><td className="num">{v.segmentos}{v.conservados ? ` (+${v.conservados} en uso)` : ''}</td>{ver === 'conflicto' && <td className="muted">{v.motivo}</td>}</tr>
              ))}</tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: 0 }}>Nada se borra: las vías que ya existen conservan su identificador (y con él locales, observaciones e itinerarios). Un cambio de nombre en la fuente no renombra la vía: queda «por revisar».</p>
          {msg && <div className={`t-info ${msg.ok ? 'ok' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.texto}</div>}
          <div className="fila"><span className="esp" /><button className="btn primario" disabled={!aplicable || !!ocupado} onClick={aplicar}><CheckCircle2 size={15} /> Aplicar la carga</button></div>
        </div>
      )}
    </div>
  );
}

// ───────────── Alta manual ─────────────

function AltaVia({ municipioId, onCerrar }: { municipioId: Id; onCerrar: () => void }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const [d, setD] = useState({ nombre: '', tipoVia: 'Plaza', fuenteDocumental: '', geometria: '', nota: '' });
  const [error, setError] = useState<string | null>(null);
  const datos = { municipioId, ...d };
  const v = d.nombre.trim() ? validarAltaCalle(db, datos) : { errores: [], parecidas: [], avisos: [] };
  const campo = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  return (
    <div className="mun-form" role="group" aria-label="Añadir calle o plaza">
      <b>Añadir una calle, plaza o espacio que falte</b>
      <div className="col-ctrl">
        <label className="campo"><span>Tipo de vía</span>
          <select className="input" aria-label="Tipo de vía" value={d.tipoVia} onChange={campo('tipoVia')}>{TIPOS_VIA_ALTA.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label className="campo"><span>Nombre</span><input className="input" aria-label="Nombre de la vía" value={d.nombre} onChange={campo('nombre')} placeholder="p. ej. Mayor de la Hispanidad" /></label>
      </div>
      {d.nombre.trim() && <p className="muted" style={{ margin: 0 }}>Se registrará como «<b>{nombreDeAlta(d)}</b>» en {db.municipios[municipioId].nombre}.</p>}
      <label className="campo"><span>Fuente documental (obligatoria)</span><input className="input" aria-label="Fuente documental" value={d.fuenteDocumental} onChange={campo('fuenteDocumental')} placeholder="p. ej. Nomenclátor municipal, acuerdo de pleno de 12-03-1992" /></label>
      <label className="campo"><span>Geometría (opcional): pares «latitud, longitud», uno por línea, o un GeoJSON</span>
        <textarea className="input mono" rows={3} aria-label="Geometría opcional" value={d.geometria} onChange={campo('geometria')} placeholder="Déjelo vacío si no tiene coordenadas comprobadas: no se inventan." />
      </label>
      <label className="campo"><span>Nota (opcional)</span><input className="input" aria-label="Nota del alta" value={d.nota} onChange={campo('nota')} /></label>
      {v.parecidas.length > 0 && <div className="t-info aviso" role="note"><AlertTriangle size={15} /> <div>Nombres parecidos en el callejero: {v.parecidas.join(', ')}. Compruebe que no es la misma vía (si lo es, registre el nombre como alias).</div></div>}
      {v.avisos.map((a) => <div key={a} className="t-info aviso" role="note"><AlertTriangle size={15} /> <div>{a}</div></div>)}
      {(error || v.errores[0]) && <div className="t-info error" role="alert">{error ?? v.errores[0]}</div>}
      <p className="muted" style={{ margin: 0 }}>El alta queda como <b>propuesta</b>, con quién y cuándo. No se usa en la conciliación hasta que una persona de coordinación la <b>valide</b>.</p>
      <div className="fila"><span className="esp" />
        <button className="btn primario" disabled={!d.nombre.trim() || v.errores.length > 0 || !!ocupado} onClick={async () => {
          const r = await modificar('Registrando el alta…', (x, ctx) => altaCalle(x, datos, ctx).db);
          if (!r.ok) return setError(r.error ?? 'No se ha registrado.');
          onCerrar();
        }}><MapPinPlus size={15} /> Proponer el alta</button>
      </div>
    </div>
  );
}

// ───────────── Vías ─────────────

type Filtro = 'todas' | 'propuestas' | 'plazas' | 'sin-geometria' | 'manuales' | 'con-alias';
const FILTRO_TXT: Record<Filtro, string> = { todas: 'Todas', propuestas: 'Altas por validar', plazas: 'Plazas y espacios', 'sin-geometria': 'Sin geometría', manuales: 'Añadidas a mano', 'con-alias': 'Con alias' };

function procedenciaTxt(c: Calle) {
  if (c.alta) return c.alta.estado === 'validada' ? 'Manual · validada' : c.alta.estado === 'propuesta' ? 'Manual · por validar' : 'Manual · rechazada';
  return c.procedencia === 'osm' ? 'OpenStreetMap' : 'Callejero oficial';
}

function ListaVias({ municipioId }: { municipioId: Id }) {
  const db = useEspacios((s) => s.db!);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [abierta, setAbierta] = useState<Id | null>(null);
  const forma = (c: Calle) => c.forma ?? formaDe(c.segmentos);
  const vias = callesDe(db, municipioId).filter((c) => {
    if (q.trim() && !`${c.nombre} ${(c.alias ?? []).map((a) => a.nombre).join(' ')}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) return false;
    if (filtro === 'propuestas') return c.alta?.estado === 'propuesta';
    if (filtro === 'plazas') return ['area', 'punto'].includes(forma(c)) || /^plaza\b/i.test(c.nombre);
    if (filtro === 'sin-geometria') return forma(c) === 'sin-geometria';
    if (filtro === 'manuales') return !!c.alta;
    if (filtro === 'con-alias') return (c.alias ?? []).some((a) => !a.retirado);
    return true;
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return (
    <div className="col" style={{ gap: 8 }} aria-label="Vías del callejero">
      <div className="col-ctrl">
        <label className="campo"><span>Buscar</span><input className="input" aria-label="Buscar vía" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o alias" /></label>
        <label className="campo"><span>Mostrar</span>
          <select className="input" aria-label="Filtro de vías" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>{(Object.keys(FILTRO_TXT) as Filtro[]).map((f) => <option key={f} value={f}>{FILTRO_TXT[f]}</option>)}</select>
        </label>
      </div>
      {vias.length === 0 ? <p className="muted">Ninguna vía con este filtro.</p> : (
        <div className="tabla-scroll cj-lista">
          <table className="tabla ap-tabla cj-vias" aria-label="Lista de vías">
            <thead><tr><th>Vía</th><th>Forma</th><th>Procedencia</th><th /></tr></thead>
            <tbody>{vias.slice(0, 150).map((c) => (
              <FilaVia key={c.id} c={c} abierta={abierta === c.id} onAbrir={() => setAbierta(abierta === c.id ? null : c.id)} />
            ))}</tbody>
          </table>
        </div>
      )}
      {vias.length > 150 && <p className="muted" style={{ margin: 0 }}>Se muestran 150 de {fmt(vias.length)}: afine la búsqueda.</p>}
    </div>
  );
}

function FilaVia({ c, abierta, onAbrir }: { c: Calle; abierta: boolean; onAbrir: () => void }) {
  const alias = (c.alias ?? []).filter((a) => !a.retirado);
  return (
    <>
      <tr className={c.alta?.estado === 'propuesta' ? 'aviso' : ''}>
        <td>{c.nombre}{alias.length > 0 && <div className="muted cj-alias">también: {alias.map((a) => a.nombre).join(' · ')}</div>}</td>
        <td>{FORMA_TXT[c.forma ?? formaDe(c.segmentos)]}</td>
        <td>{procedenciaTxt(c)}</td>
        <td><button className="btn s" aria-expanded={abierta} aria-label={`Ficha de ${c.nombre}`} onClick={onAbrir}>{abierta ? 'Cerrar' : 'Ficha'}</button></td>
      </tr>
      {abierta && <tr className="cj-ficha-fila"><td colSpan={4}><FichaVia c={c} /></td></tr>}
    </>
  );
}

function FichaVia({ c }: { c: Calle }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const [error, setError] = useState<string | null>(null);
  const [alias, setAlias] = useState<{ nombre: string; tipo: AliasCalle['tipo']; fuente: string; desde: string; hasta: string }>({ nombre: '', tipo: 'historico', fuente: '', desde: '', hasta: '' });
  const [motivo, setMotivo] = useState('');
  const [corr, setCorr] = useState<{ nombre: string; fuenteDocumental: string; geometria: string } | null>(null);
  const hacer = async (mensaje: string, f: Parameters<typeof modificar>[1]) => {
    setError(null);
    const r = await modificar(mensaje, f);
    if (!r.ok) setError(r.error ?? 'No se ha guardado.');
    return r.ok;
  };
  const persona = (id?: Id) => (id ? db.personas[id]?.nombre ?? id : '—');
  const usos = usosDeCalle(db, c.id);
  return (
    <div className="cj-ficha" role="group" aria-label={`Ficha de la vía ${c.nombre}`}>
      <dl className="inc-dl">
        <dt>Identificador</dt><dd className="mono">{c.id}</dd>
        <dt>Procedencia</dt><dd>{procedenciaTxt(c)}{c.codigoVia ? ` · código ${c.codigoVia}` : ''}{c.refsFuente.length ? ` · ${c.refsFuente.length} elemento(s) de la fuente` : ''}</dd>
        <dt>Segmentos</dt><dd>{c.segmentos.length ? <span className="mono">{c.segmentos.slice(0, 6).map((s) => `${s.id} (${s.tipo ?? 'linea'})`).join(' · ')}{c.segmentos.length > 6 ? ' …' : ''}</span> : 'Sin geometría (la vía existe aunque no esté dibujada)'}</dd>
        {c.alta && c.segmentos.length > 0 && <><dt>Pertenencia</dt><dd>{c.alta.pertenencia === 'verificada'
          ? <span className="chip ok">Dentro del límite municipal (comprobado con el perímetro)</span>
          : c.alta.pertenencia === 'no-verificada'
            ? <span className="chip aviso">No verificada: el municipio no tenía límite administrativo con geometría</span>
            : <span className="chip aviso">No comprobada con el perímetro (alta anterior a esta comprobación)</span>}</dd></>}
        {c.alta && <><dt>Alta</dt><dd>Propuesta por {persona(c.alta.porId)} el {c.alta.fecha.slice(0, 10)} · fuente: {c.alta.fuenteDocumental}{c.alta.validacion ? ` · ${c.alta.estado === 'validada' ? 'validada' : 'rechazada'} por ${persona(c.alta.validacion.porId)} el ${c.alta.validacion.fecha.slice(0, 10)}${c.alta.validacion.nota ? ` (${c.alta.validacion.nota})` : ''}` : ''}</dd></>}
        <dt>En uso</dt><dd>{usos ? `${usos} referencia(s): locales, observaciones o itinerarios` : 'No'}</dd>
      </dl>
      {c.alta?.estado === 'propuesta' && (
        <div className="fila cj-fila-acc">
          <button className="btn s primario" disabled={!!ocupado} onClick={() => void hacer('Validando el alta…', (d, ctx) => validarCalle(d, c.id, { porId: ctx.porId }))}><CheckCircle2 size={14} /> Validar el alta</button>
          <input className="input" aria-label="Motivo del rechazo" placeholder="Motivo del rechazo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <button className="btn s peligro" disabled={!motivo.trim() || !!ocupado} onClick={() => void hacer('Rechazando el alta…', (d, ctx) => rechazarCalle(d, c.id, { porId: ctx.porId, motivo }))}><XCircle size={14} /> Rechazar</button>
        </div>
      )}
      {c.alta && c.alta.estado !== 'rechazada' && (corr ? (
        <div className="col" style={{ gap: 6 }}>
          <div className="col-ctrl">
            <label className="campo"><span>Nombre</span><input className="input" aria-label="Corregir el nombre" value={corr.nombre} onChange={(e) => setCorr({ ...corr, nombre: e.target.value })} /></label>
            <label className="campo"><span>Fuente documental</span><input className="input" aria-label="Corregir la fuente" value={corr.fuenteDocumental} onChange={(e) => setCorr({ ...corr, fuenteDocumental: e.target.value })} /></label>
          </div>
          <label className="campo"><span>Geometría (vacía = sin geometría)</span><textarea className="input mono" rows={2} aria-label="Corregir la geometría" value={corr.geometria} onChange={(e) => setCorr({ ...corr, geometria: e.target.value })} /></label>
          <div className="fila"><span className="esp" /><button className="btn s" onClick={() => setCorr(null)}>Cancelar</button>
            <button className="btn s primario" disabled={!!ocupado} onClick={async () => {
              const ok = await hacer('Guardando la corrección…', (d, ctx) => corregirCalle(d, c.id, {
                ...(corr.nombre.trim() !== c.nombre ? { nombre: corr.nombre } : {}),
                ...(corr.fuenteDocumental.trim() !== c.alta!.fuenteDocumental ? { fuenteDocumental: corr.fuenteDocumental } : {}),
                ...(corr.geometria.trim() ? { geometria: corr.geometria } : {}),
              }, { porId: ctx.porId }));
              if (ok) setCorr(null);
            }}>Guardar la corrección</button></div>
        </div>
      ) : <div><button className="btn s" onClick={() => setCorr({ nombre: c.nombre, fuenteDocumental: c.alta!.fuenteDocumental, geometria: '' })}>Corregir</button></div>)}
      <div className="col" style={{ gap: 6 }}>
        <b>Nombres históricos, alternativos y alias</b>
        {(c.alias ?? []).length === 0 ? <span className="muted">Ninguno.</span> : (
          <ul className="inc-lista">{(c.alias ?? []).map((a) => (
            <li key={`${a.nombre}-${a.fecha}`} className={a.retirado ? 'muted' : ''}>
              <b>{a.nombre}</b> · {TIPO_ALIAS_TXT[a.tipo]}{a.desde || a.hasta ? ` (${a.desde ?? '…'}–${a.hasta ?? '…'})` : ''} · fuente: {a.fuente} · {persona(a.porId)}, {a.fecha.slice(0, 10)}
              {a.retirado ? ` · retirado el ${a.retirado.fecha.slice(0, 10)}` : <button className="btn s fantasma" aria-label={`Retirar el alias ${a.nombre}`} onClick={() => void hacer('Retirando el alias…', (d, ctx) => retirarAlias(d, c.id, a.nombre, { porId: ctx.porId }))}><X size={13} /></button>}
            </li>
          ))}</ul>
        )}
        <div className="col-ctrl">
          <label className="campo"><span>Denominación</span><input className="input" aria-label="Nuevo alias" value={alias.nombre} onChange={(e) => setAlias({ ...alias, nombre: e.target.value })} /></label>
          <label className="campo"><span>Tipo</span><select className="input" aria-label="Tipo de alias" value={alias.tipo} onChange={(e) => setAlias({ ...alias, tipo: e.target.value as AliasCalle['tipo'] })}>{(Object.keys(TIPO_ALIAS_TXT) as AliasCalle['tipo'][]).map((t) => <option key={t} value={t}>{TIPO_ALIAS_TXT[t]}</option>)}</select></label>
          <label className="campo"><span>Fuente</span><input className="input" aria-label="Fuente del alias" value={alias.fuente} onChange={(e) => setAlias({ ...alias, fuente: e.target.value })} placeholder="p. ej. Callejero de 1975" /></label>
          <label className="campo"><span>Vigente hasta (opcional)</span><input className="input" aria-label="Vigente hasta" value={alias.hasta} onChange={(e) => setAlias({ ...alias, hasta: e.target.value })} placeholder="aaaa" /></label>
        </div>
        <div><button className="btn s" disabled={!alias.nombre.trim() || alias.fuente.trim().length < 3 || !!ocupado} onClick={async () => {
          const ok = await hacer('Registrando el alias…', (d, ctx) => anadirAlias(d, c.id, { nombre: alias.nombre, tipo: alias.tipo, fuente: alias.fuente, ...(alias.hasta ? { hasta: alias.hasta } : {}) }, { porId: ctx.porId }));
          if (ok) setAlias({ nombre: '', tipo: 'historico', fuente: '', desde: '', hasta: '' });
        }}>Registrar la denominación</button></div>
      </div>
      {(c.historial ?? []).length > 0 && (
        <details><summary>Historial ({c.historial!.length})</summary>
          <ul className="inc-lista">{c.historial!.map((h, i) => <li key={i}>{h.fecha.slice(0, 10)} · {persona(h.porId)} · {h.detalle}</li>)}</ul>
        </details>
      )}
      {error && <div className="t-info error" role="alert">{error}</div>}
    </div>
  );
}

// ───────────── Referencias ─────────────

function Referencias({ municipioId }: { municipioId: Id }) {
  const db = useEspacios((s) => s.db!);
  const modificar = useEspacios((s) => s.modificar);
  const ocupado = useEspacios((s) => s.ocupado);
  const lista = referenciasDe(db, municipioId);
  const [r, setR] = useState<{ denominacion: string; oficial: string; nota: string; fuente: string; respaldo: 'pendiente' | 'documentado' }>({ denominacion: '', oficial: '', nota: '', fuente: '', respaldo: 'pendiente' });
  const [error, setError] = useState<string | null>(null);
  const existe = (oficial: string) => callesDe(db, municipioId).some((c) => c.nombre.toLowerCase() === oficial.toLowerCase() && (!c.alta || c.alta.estado === 'validada'));
  return (
    <div className="col" style={{ gap: 8 }} aria-label="Referencias de denominación">
      <p className="muted" style={{ margin: 0 }}>Una referencia dice a qué vía oficial corresponde una denominación que aparece en los censos (p. ej. «Plaza Mayor» → «Plaza Mayor de la Hispanidad»). Solo orienta la conciliación: cada vínculo lo confirma una persona.</p>
      {lista.length === 0 ? <p className="muted">Ninguna referencia.</p> : (
        <ul className="inc-lista">{lista.map((x) => (
          <li key={x.denominacion}>
            «{x.denominacion}» → <b>«{x.oficial}»</b> {existe(x.oficial) ? <span className="chip ok">en el callejero</span> : <span className="chip aviso">no está en el callejero</span>}{' '}
            {x.respaldo === 'documentado' ? <span className="chip ok">con respaldo documental</span> : <span className="chip aviso">pendiente de respaldo documental</span>}
            <div className="muted">{x.nota} · fuente: {x.fuente} · {x.fecha.slice(0, 10)}</div>
            <button className="btn s fantasma" aria-label={`Retirar la referencia ${x.denominacion}`} onClick={async () => { const res = await modificar('Retirando la referencia…', (d, ctx) => retirarReferencia(d, municipioId, x.denominacion, { porId: ctx.porId })); if (!res.ok) setError(res.error ?? null); }}><X size={13} /> Retirar</button>
          </li>
        ))}</ul>
      )}
      <div className="col-ctrl">
        <label className="campo"><span>Denominación en los censos</span><input className="input" aria-label="Denominación de la referencia" value={r.denominacion} onChange={(e) => setR({ ...r, denominacion: e.target.value })} /></label>
        <label className="campo"><span>Vía oficial</span><input className="input" aria-label="Vía oficial" value={r.oficial} onChange={(e) => setR({ ...r, oficial: e.target.value })} /></label>
        <label className="campo"><span>Fuente</span><input className="input" aria-label="Fuente de la referencia" value={r.fuente} onChange={(e) => setR({ ...r, fuente: e.target.value })} /></label>
        <label className="campo"><span>Nota (opcional)</span><input className="input" aria-label="Nota de la referencia" value={r.nota} onChange={(e) => setR({ ...r, nota: e.target.value })} /></label>
        <label className="campo"><span>Respaldo</span>
          <select className="input" aria-label="Respaldo de la referencia" value={r.respaldo} onChange={(e) => setR({ ...r, respaldo: e.target.value as 'pendiente' | 'documentado' })}>
            <option value="pendiente">Pendiente de respaldo documental</option>
            <option value="documentado">Con respaldo documental (indíquelo en la fuente)</option>
          </select>
        </label>
      </div>
      {error && <div className="t-info error" role="alert">{error}</div>}
      <div><button className="btn s" disabled={!r.denominacion.trim() || !r.oficial.trim() || r.fuente.trim().length < 3 || !!ocupado} onClick={async () => {
        const res = await modificar('Registrando la referencia…', (d, ctx) => anadirReferencia(d, municipioId, r, { porId: ctx.porId }));
        if (!res.ok) return setError(res.error ?? null);
        setError(null);
        setR({ denominacion: '', oficial: '', nota: '', fuente: '', respaldo: 'pendiente' });
      }}>Registrar la referencia</button></div>
    </div>
  );
}
