import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileCheck2, FileSpreadsheet, FileUp, FlaskConical, GitMerge, Map as MapIcon, Upload } from 'lucide-react';
import { useContexto } from '../../store/contexto';
import { useStore } from '../../store/store';
import { CAMPOS, compararImportacion, interpretarFilas, mapearCabecera, parsearCSV, type CampoCanonico, type ClaseDiff, type FilaDiff } from '../../domain/importacion';
import { aplicarResultadosPapel, importarCensoHistorico } from '../../domain/aplicarImportacion';
import { itinerariosDe } from '../../domain/consultas';
import { csvEjemploHistorico, csvEjemploItinerario } from '../../data/ejemplos';
import type { Importacion } from '../../domain/types';
import { Modal, Sim, fmt, fmtFecha } from '../../components/ui';
import '../../styles/datos.css';

const TIPOS: { t: Importacion['tipo']; titulo: string; d: string; icono: typeof Upload }[] = [
  { t: 'A-censo-historico', titulo: 'A · Censo histórico completo', d: 'Excel/CSV de un municipio sin itinerarios. Crea una campaña histórica y conserva cada fila original.', icono: FileSpreadsheet },
  { t: 'B-itinerarios-kml', titulo: 'B · Itinerarios de Google My Maps', d: 'KML/KMZ con trazados. Se comprueban calles y geometrías en el planificador.', icono: MapIcon },
  { t: 'C-excel-itinerario', titulo: 'C · Excel parcial de un itinerario', d: 'Resultados de campo pasados a limpio. Nunca toca calles ajenas al itinerario.', icono: FileCheck2 },
  { t: 'D-actualizacion', titulo: 'D · Actualización posterior', d: 'Archivo corregido: detecta lo que ya existe para no duplicar.', icono: Upload },
  { t: 'E-conciliacion', titulo: 'E · Conciliación histórica', d: 'Propuestas de correspondencia entre años, confirmadas o dudosas.', icono: GitMerge },
];

const CLASE_TXT: Record<ClaseDiff, { t: string; c: string }> = {
  nuevo: { t: 'Nuevo', c: 'azul' },
  'sin-cambios': { t: 'Sin cambios', c: 'ok' },
  modificado: { t: 'Modificado', c: 'aviso' },
  ambiguo: { t: 'Ambiguo: conciliar', c: 'dudoso' },
  'fuera-ambito': { t: 'Fuera del itinerario', c: '' },
  'calle-desconocida': { t: 'Calle no reconocida', c: 'error' },
  'posible-duplicado': { t: 'Posible duplicado', c: 'dudoso' },
};

export default function DatosPage() {
  const { db, municipio, campana } = useContexto();
  const [sel, setSel] = useState<string | null>(null);
  const [asistente, setAsistente] = useState(false);
  const imps = useMemo(() => Object.values(db.importaciones).filter((i) => i.municipioId === municipio.id).sort((a, b) => b.fecha.localeCompare(a.fecha)), [db.importaciones, municipio.id]);
  const imp = sel ? db.importaciones[sel] : imps[0];

  return (
    <div className="pagina">
      <div className="pagina-cab">
        <div className="esp">
          <div className="rotulo sin-linea">05 · Datos e importaciones</div>
          <h1>Procedencia de los datos</h1>
          <p>Todo lo que entra se revisa antes de incorporarse. Los archivos originales se conservan fila a fila; una fila que desaparece nunca se interpreta como un cierre.</p>
        </div>
        <button className="btn primario" onClick={() => setAsistente(true)}><Upload size={16} /> Nueva importación</button>
      </div>

      <div className="dat-rejilla">
        <div className="dat-lista">
          {imps.length === 0 && <div className="vacio-estado tarjeta">Sin importaciones en {municipio.nombre}.</div>}
          {imps.map((i) => (
            <button key={i.id} className={`dat-imp tarjeta ${imp?.id === i.id ? 'on' : ''}`} onClick={() => setSel(i.id)}>
              <div className="fila">
                <span className="chip mono">{i.tipo.slice(0, 1)}</span>
                <b className="esp">{i.archivo}</b>
                {i.procedencia === 'simulado' ? <Sim texto="Simulado" /> : <span className="chip azul">Importado</span>}
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {TIPOS.find((t) => t.t === i.tipo)?.titulo.slice(4)} · {fmtFecha(i.fecha)} · {fmt(i.filas)} filas · {db.campanas[i.campanaId ?? '']?.nombre}
              </div>
              <div className="fila" style={{ flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(i.resumen).map(([k, v]) => <span key={k} className="chip">{v} {k}</span>)}
              </div>
            </button>
          ))}
        </div>
        {imp && <DetalleImportacion imp={imp} />}
      </div>
      {asistente && campana && <Asistente onCerrar={() => setAsistente(false)} />}
    </div>
  );
}

function DetalleImportacion({ imp }: { imp: Importacion }) {
  const { db } = useContexto();
  const registros = useMemo(() => Object.values(db.registros).filter((r) => r.importacionId === imp.id).sort((a, b) => a.fila - b.fila), [db.registros, imp.id]);
  const vincPorReg = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of Object.values(db.vinculos)) if (v.origen.tipo === 'registro') m.set(v.origen.id, v.confianza);
    return m;
  }, [db.vinculos]);
  const columnas = registros[0] ? Object.keys(registros[0].datos).slice(0, 9) : [];
  const sinVinculo = registros.filter((r) => vincPorReg.get(r.id) !== 'confirmada').length;
  return (
    <div className="dat-detalle tarjeta">
      <div className="fila" style={{ flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>{imp.archivo}</h3>
        <span className="chip mono" title="Huella del archivo original">#{imp.huella}</span>
        <span className="chip ok">{imp.estado}</span>
      </div>
      {imp.nota && <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>{imp.nota}</p>}
      <div className="dat-cifras">
        <div><b className="num">{fmt(imp.filas)}</b><span>filas del archivo</span></div>
        <div><b className="num">{fmt(registros.length)}</b><span>registros de origen conservados</span></div>
        <div><b className="num">{fmt(sinVinculo)}</b><span>pendientes de relacionar</span></div>
      </div>
      {registros.length === 0 ? (
        <p className="muted">Las filas originales de esta importación no se incluyen en la demo de volumen.</p>
      ) : (
        <div className="dat-tabla scroll-fino">
          <table className="tabla">
            <thead>
              <tr><th>Fila</th>{columnas.map((c) => <th key={c}>{c}</th>)}<th>Vínculo</th></tr>
            </thead>
            <tbody>
              {registros.slice(0, 80).map((r) => (
                <tr key={r.id} className={vincPorReg.get(r.id) !== 'confirmada' ? 'dat-pend' : ''}>
                  <td className="mono muted">{r.fila}</td>
                  {columnas.map((c) => <td key={c}>{r.datos[c]}</td>)}
                  <td><span className={`chip ${vincPorReg.get(r.id) === 'confirmada' ? 'ok' : 'error'}`}>{vincPorReg.get(r.id) ?? '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {registros.length > 80 && <p className="muted" style={{ fontSize: 12 }}>Mostrando 80 de {fmt(registros.length)} filas.</p>}
        </div>
      )}
    </div>
  );
}

function Asistente({ onCerrar }: { onCerrar: () => void }) {
  const { db, municipio, campana, prefs } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const setPrefs = useStore((s) => s.setPrefs);
  const nav = useNavigate();
  const [tipo, setTipo] = useState<Importacion['tipo'] | null>(null);
  const [itId, setItId] = useState('');
  const [archivo, setArchivo] = useState<{ nombre: string; texto: string; simulado: boolean } | null>(null);
  const [mapa, setMapa] = useState<Partial<Record<CampoCanonico, number>>>({});
  const [anio, setAnio] = useState(2025);
  const its = campana ? itinerariosDe(db, campana.id) : [];
  const parsed = useMemo(() => (archivo ? parsearCSV(archivo.texto) : null), [archivo]);
  const calles = useMemo(() => Object.values(db.calles).filter((c) => c.municipioId === municipio.id), [db.calles, municipio.id]);
  const diff: FilaDiff[] = useMemo(() => {
    if (!parsed || !campana) return [];
    const filas = interpretarFilas(parsed.cabecera, parsed.filas, mapa, calles);
    if (tipo === 'A-censo-historico') return filas.map((f) => ({ ...f, clase: f.calleId ? 'nuevo' : 'calle-desconocida', detalle: f.calleId ? 'Se creará un local físico' : `“${f.calleTexto}” no está en el callejero` }) as FilaDiff);
    const limite = tipo === 'C-excel-itinerario' && itId ? new Set(db.itinerarios[itId]?.tramos.map((t) => t.calleId)) : undefined;
    return compararImportacion(db, campana.id, filas, limite);
  }, [parsed, mapa, calles, campana, tipo, itId, db]);
  const cuentas = diff.reduce<Record<string, number>>((a, f) => ({ ...a, [f.clase]: (a[f.clase] ?? 0) + 1 }), {});

  const cargarTexto = (nombre: string, texto: string, simulado: boolean) => {
    setArchivo({ nombre, texto, simulado });
    setMapa(mapearCabecera(parsearCSV(texto).cabecera));
  };

  const confirmar = () => {
    if (!campana || !archivo) return;
    if (tipo === 'A-censo-historico') {
      let nueva = '';
      aplicar((d) => {
        const r = importarCensoHistorico(d, municipio.id, anio, `Censo ${anio} (importado)`, diff, archivo.nombre);
        nueva = r.campanaId;
        return r.db;
      }, `Campaña histórica ${anio} creada desde ${archivo.nombre}`);
      if (nueva) setPrefs({ campanaId: nueva });
    } else {
      aplicar((d) => aplicarResultadosPapel(d, campana.id, diff, archivo.nombre, tipo!, prefs.personaId).db, `Importación aplicada: ${cuentas.nuevo ?? 0} nuevos, ${cuentas.modificado ?? 0} modificados, ${cuentas['sin-cambios'] ?? 0} confirmados`);
    }
    onCerrar();
  };

  const paso = !tipo ? 1 : !archivo ? 2 : 3;
  return (
    <Modal
      ancho
      titulo="Nueva importación"
      sub={`${municipio.nombre} · ${campana?.nombre} · nada se incorpora sin revisar la previsualización`}
      onCerrar={onCerrar}
      pie={
        paso === 3 && (
          <>
            <span className="muted esp">
              {tipo === 'A-censo-historico' ? `Se creará la campaña «Censo ${anio} (importado)» con ${cuentas.nuevo ?? 0} locales.` : `Se aplicarán ${(cuentas.nuevo ?? 0) + (cuentas.modificado ?? 0) + (cuentas['sin-cambios'] ?? 0)} filas${cuentas.ambiguo ? ` y ${cuentas.ambiguo} quedarán pendientes de conciliación` : ''}; ${(cuentas['fuera-ambito'] ?? 0) + (cuentas['calle-desconocida'] ?? 0) + (cuentas['posible-duplicado'] ?? 0)} quedan sin aplicar.`}
            </span>
            <button className="btn" onClick={() => setArchivo(null)}>Atrás</button>
            <button className="btn primario" onClick={confirmar} disabled={!diff.length || (tipo === 'C-excel-itinerario' && !itId)}>Confirmar incorporación</button>
          </>
        )
      }
    >
      <ol className="dat-pasos">
        <li className={paso >= 1 ? 'on' : ''}>Tipo</li>
        <li className={paso >= 2 ? 'on' : ''}>Archivo</li>
        <li className={paso >= 3 ? 'on' : ''}>Revisión previa</li>
      </ol>
      {paso === 1 && (
        <div className="dat-tipos">
          {TIPOS.map(({ t, titulo, d, icono: I }) => (
            <button
              key={t}
              className="dat-tipo"
              onClick={() => {
                if (t === 'B-itinerarios-kml') {
                  onCerrar();
                  nav('/territorio');
                  useStore.getState().avisar('Usa «Importar KML/KMZ» en el panel de itinerarios.', 'info');
                } else if (t === 'E-conciliacion') {
                  onCerrar();
                  nav('/oficina?vista=dudosos');
                } else setTipo(t);
              }}
            >
              <I size={20} />
              <span className="esp"><b>{titulo}</b><span className="muted">{d}</span></span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      )}
      {paso === 2 && (
        <div className="col" style={{ gap: 12 }}>
          {tipo === 'C-excel-itinerario' && (
            <div className="campo">
              <label>Itinerario al que pertenece el archivo</label>
              <select className="input" value={itId} onChange={(e) => setItId(e.target.value)}>
                <option value="">Elige itinerario…</option>
                {its.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.nombre}</option>)}
              </select>
            </div>
          )}
          {tipo === 'A-censo-historico' && (
            <div className="campo" style={{ maxWidth: 200 }}>
              <label>Año del censo</label>
              <input className="input num" type="number" value={anio} onChange={(e) => setAnio(+e.target.value)} />
            </div>
          )}
          <label className="kml-drop">
            <FileUp size={26} />
            <b>Selecciona un CSV (exportado de Excel)</b>
            <span className="muted">Separador «;» o «,». Se procesa en el navegador. La calle puede figurar solo en la primera fila de cada bloque.</span>
            <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) cargarTexto(f.name, await f.text(), false); }} />
          </label>
          <button
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            disabled={tipo === 'C-excel-itinerario' && !itId}
            onClick={() => (tipo === 'A-censo-historico' ? cargarTexto('censo_historico_EJEMPLO_SIMULADO.csv', csvEjemploHistorico(db, municipio.id), true) : cargarTexto(`${db.itinerarios[itId]?.codigo ?? 'itinerario'}_EJEMPLO_SIMULADO.csv`, csvEjemploItinerario(db, db.itinerarios[itId || its[0]?.id]), true))}
          >
            <FlaskConical size={15} /> Usar un archivo de ejemplo (simulado)
          </button>
          <p className="muted" style={{ fontSize: 12 }}>Preparado para el CSV real del censo 2025: las columnas se reconocen por su nombre y se pueden reasignar antes de confirmar.</p>
        </div>
      )}
      {paso === 3 && parsed && (
        <div className="col" style={{ gap: 12 }}>
          <div className="fila" style={{ flexWrap: 'wrap' }}>
            <b>{archivo!.nombre}</b>
            {archivo!.simulado && <Sim texto="Archivo simulado" />}
            <span className="muted">{parsed.filas.length} filas · separador «{parsed.separador === '\t' ? 'tab' : parsed.separador}»</span>
          </div>
          <details open={Object.keys(mapa).length < 4}>
            <summary className="rotulo sin-linea" style={{ cursor: 'pointer' }}>Correspondencia de columnas ({Object.keys(mapa).length} reconocidas)</summary>
            <div className="dat-mapeo">
              {(Object.keys(CAMPOS) as CampoCanonico[]).map((k) => (
                <label key={k} className="campo">
                  <span className="etq">{k}</span>
                  <select className="input" value={mapa[k] ?? ''} onChange={(e) => setMapa({ ...mapa, [k]: e.target.value === '' ? undefined : +e.target.value })}>
                    <option value="">— no importar —</option>
                    {parsed.cabecera.map((c, i) => <option key={i} value={i}>{c}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </details>
          <div className="fila" style={{ flexWrap: 'wrap' }}>
            {Object.entries(cuentas).map(([k, v]) => <span key={k} className={`chip ${CLASE_TXT[k as ClaseDiff].c}`}>{v} · {CLASE_TXT[k as ClaseDiff].t}</span>)}
          </div>
          <div className="dat-tabla scroll-fino" style={{ maxHeight: 340 }}>
            <table className="tabla">
              <thead><tr><th>Fila</th><th>Calle</th><th>Nº</th><th>Nombre</th><th>Resultado</th><th>Detalle</th></tr></thead>
              <tbody>
                {diff.map((f) => (
                  <tr key={f.fila}>
                    <td className="mono muted">{f.fila}</td>
                    <td>{f.calleTexto}{!f.bruto[parsed.cabecera[mapa.calle ?? 0]] && <span className="muted" title="La calle se arrastra desde la fila anterior"> ↧</span>}</td>
                    <td className="num">{f.numero ?? 's/n'}{f.sufijo ? ` ${f.sufijo}` : ''}</td>
                    <td>{f.vacio ? <i className="muted">Vacío{f.metros ? ` · ${f.metros} m` : ''}</i> : f.nombre}</td>
                    <td><span className={`chip ${CLASE_TXT[f.clase].c}`}>{CLASE_TXT[f.clase].t}</span></td>
                    <td style={{ fontSize: 12 }}>{f.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
