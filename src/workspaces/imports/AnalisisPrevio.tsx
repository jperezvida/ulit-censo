import { useState } from 'react';
import { CheckCircle2, Download, FileSearch, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Modal, fmt } from '../../components/ui';
import { descargar } from '../../domain/exportacion';
import { CONFIG_TERRITORIAL } from '../../domain/territorio';
import type { InformeEstructural } from '../../domain/xlsx/analisis';
import type { InformeInterpretacion } from '../../domain/xlsx/informeInterpretacion';

const ROL_TXT = { datos: 'Datos', listas: 'Listas (Hoja1)', resumen: 'Resumen (no es fuente)', otra: 'Otra' } as const;
const COINC_TXT = { exacta: 'exacta', espacios: 'difiere en espacios', mayusculas: 'difiere en mayúsculas', tildes: 'difiere en tildes (revisar)', alias: 'alias admitido' } as const;

/**
 * C1a · Informe estructural previo. El archivo se lee en este navegador y se descarta al cerrar:
 * no se guarda, no se envía y no importa nada (ni negocios, ni locales, ni cambios en campañas).
 */
export function AnalisisPrevio({ municipioId, onCerrar }: { municipioId: string; onCerrar: () => void }) {
  const [informe, setInforme] = useState<InformeEstructural | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [municipio, setMunicipio] = useState<string>(CONFIG_TERRITORIAL[municipioId] ? municipioId : '');
  const [anio, setAnio] = useState('');
  // Bytes del archivo SOLO en memoria (para C1b); se descartan al cerrar o analizar otro.
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [interpretacion, setInterpretacion] = useState<InformeInterpretacion | null>(null);

  const interpretar = async () => {
    if (!bytes || !informe) return;
    setCargando(true);
    setError(null);
    try {
      const [{ interpretarXlsx }, { informeInterpretacion }] = await Promise.all([import('../../domain/xlsx/interpretacion'), import('../../domain/xlsx/informeInterpretacion')]);
      const cfg = municipio ? CONFIG_TERRITORIAL[municipio] : undefined;
      const res = await interpretarXlsx(bytes, informe.archivo.nombre, { territorio: cfg, periodo: /^\d{4}$/.test(anio) ? { desde: `${anio}-01-01`, hasta: `${anio}-12-31` } : undefined });
      setInterpretacion(informeInterpretacion(res, cfg?.municipio));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };
  const otro = () => {
    setInforme(null);
    setInterpretacion(null);
    setBytes(null);
  };

  const leer = async (f: File) => {
    setCargando(true);
    setError(null);
    try {
      // Límite de tamaño ANTES de leer el archivo en memoria.
      const { LIMITES_XLSX } = await import('../../domain/xlsx/lector');
      if (f.size > LIMITES_XLSX.maxBytesArchivo) {
        throw new Error(`El archivo ocupa ${(f.size / 1048576).toFixed(1)} MB y el máximo admitido es ${LIMITES_XLSX.maxBytesArchivo / 1048576} MB. No se ha leído.`);
      }
      const { analizarXlsx } = await import('../../domain/xlsx/analisis');
      const b = new Uint8Array(await f.arrayBuffer());
      setInforme(await analizarXlsx(b, f.name, { territorio: municipio ? CONFIG_TERRITORIAL[municipio] : undefined }));
      setBytes(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal
      ancho
      titulo="Análisis previo de un Excel (C1a · C1b)"
      sub="Identifica la hoja de datos, las columnas, los tipos y los perfiles compatibles. Solo lectura: no importa negocios, no crea locales ni modifica campañas. El archivo no se guarda ni se envía."
      onCerrar={onCerrar}
      pie={
        informe && (
          <>
            <span className="muted esp"><ShieldCheck size={13} /> El informe no contiene nombres de negocio ni direcciones.</span>
            <button className="btn" onClick={otro}>Analizar otro</button>
            <button className="btn" onClick={() => descargar(`${informe.archivo.nombre}.informe-estructural.json`, JSON.stringify(informe, null, 2), 'application/json')}>
              <Download size={15} /> Informe estructural
            </button>
            {interpretacion ? (
              <button className="btn primario" onClick={() => descargar(`${informe.archivo.nombre}.informe-interpretacion.json`, JSON.stringify(interpretacion, null, 2), 'application/json')}>
                <Download size={15} /> Informe de interpretación
              </button>
            ) : (
              <button className="btn primario" disabled={!informe.perfilPropuesto || !bytes || cargando} onClick={interpretar} title={informe.perfilPropuesto ? 'Interpreta cada celda sin importar nada' : 'Requiere un perfil compatible'}>
                <FileSearch size={15} /> {cargando ? 'Interpretando…' : 'Interpretar valores (C1b)'}
              </button>
            )}
          </>
        )
      }
    >
      {!informe ? (
        <div className="col" style={{ gap: 12 }}>
          <label className="campo" style={{ maxWidth: 360 }}>
            <span>Municipio de destino (reglas de Distrito, Zona y CP)</span>
            <select className="input" value={municipio} onChange={(e) => setMunicipio(e.target.value)} aria-label="Municipio de destino">
              <option value="">Sin configuración territorial</option>
              {Object.values(CONFIG_TERRITORIAL).map((c) => <option key={c.municipioId} value={c.municipioId}>{c.municipio}</option>)}
            </select>
          </label>
          <label className="campo" style={{ maxWidth: 360 }}>
            <span>Año de la campaña (opcional: comprueba las fechas en C1b)</span>
            <input className="input" inputMode="numeric" maxLength={4} value={anio} onChange={(e) => setAnio(e.target.value.replace(/\D/g, ''))} aria-label="Año de la campaña" placeholder="p. ej. 2025" />
          </label>
          <label className="kml-drop">
            <FileSearch size={26} />
            <b>{cargando ? 'Analizando…' : 'Selecciona un archivo .xlsx'}</b>
            <span className="muted">Se admiten los formatos de 27 columnas (censo municipal) y 28 columnas (itinerario de Medina 2026). Por seguridad: hasta 25 MB y 250 MB descomprimidos.</span>
            <input type="file" aria-label="Archivo xlsx" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} />
          </label>
          {error && <div className="t-info error" role="alert">{error}</div>}
        </div>
      ) : (
        <>
          {error && <div className="t-info error" role="alert">{error}</div>}
          {interpretacion && <Interpretacion inf={interpretacion} />}
          <Informe inf={informe} />
        </>
      )}
    </Modal>
  );
}

function Informe({ inf }: { inf: InformeEstructural }) {
  const perfil = inf.perfiles.find((p) => p.perfilId === inf.perfilPropuesto);
  return (
    <div className="col ap" style={{ gap: 14 }} aria-label="Informe estructural">
      <section className="ap-resumen">
        <div><span className="muted">Archivo</span><b>{inf.archivo.nombre}</b><span className="muted mono">{fmt(inf.archivo.bytes)} bytes · SHA-256 {inf.archivo.sha256.slice(0, 12)}…</span></div>
        <div><span className="muted">Hoja de datos</span><b>{inf.hojaDatos ?? '—'}</b><span className="muted">{inf.eleccionHoja === 'automatica' ? 'identificada por su estructura' : inf.eleccionHoja === 'ambigua' ? 'varias candidatas: hay que elegir' : 'no encontrada'}</span></div>
        <div><span className="muted">Perfil compatible</span><b>{perfil ? perfil.nombre : 'Ninguno'}</b><span className="muted">{perfil ? `${perfil.encontradas}/${perfil.total} columnas · orden ${perfil.ordenIgual ? 'igual' : 'distinto'}` : ''}</span></div>
        <div><span className="muted">Filas</span><b>{fmt(inf.filas.conDatos)}</b><span className="muted">cabecera en fila {inf.filas.filaCabecera ?? '—'}{inf.filas.enBlancoIntercaladas ? ` · ${inf.filas.enBlancoIntercaladas} en blanco` : ''}</span></div>
        <div><span className="muted">Lector</span><b>{inf.lector.motor === 'exceljs' ? 'ExcelJS' : 'ExcelJS + adaptación'}</b><span className="muted">{inf.lector.adaptaciones.length ? `${inf.lector.adaptaciones.length} parte(s) con prefijo adaptadas en memoria` : 'sin adaptaciones'}</span></div>
      </section>

      <section>
        <h4 className="ap-tit">Hojas del libro</h4>
        <table className="tabla ap-tabla">
          <thead><tr><th>#</th><th>Hoja</th><th>Papel</th><th>Filas</th><th>Columnas</th><th>Motivo</th></tr></thead>
          <tbody>{inf.hojas.map((h) => <tr key={h.nombre}><td>{h.posicion}</td><td><b>{h.nombre}</b>{!h.visible && <span className="chip"> oculta</span>}</td><td>{ROL_TXT[h.rol]}</td><td className="num">{fmt(h.filas)}</td><td className="num">{h.columnas}</td><td className="muted" style={{ fontSize: 12 }}>{h.motivo}</td></tr>)}</tbody>
        </table>
      </section>

      <section>
        <h4 className="ap-tit">Perfiles</h4>
        <div className="ap-perfiles">
          {inf.perfiles.map((p) => (
            <div key={p.perfilId} className={`ap-perfil ${p.compatible ? 'ok' : ''}`}>
              <div className="fila">{p.compatible ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}<b>{p.nombre}</b><span className="muted">v{p.version} · {p.encontradas}/{p.total}</span></div>
              {p.faltan.length > 0 && <div className="muted">Faltan: {p.faltan.map((x) => `«${x.trim()}»`).join(', ')}</div>}
              {p.sobran.length > 0 && <div className="muted">Sobran: {p.sobran.map((x) => `«${x.trim()}»`).join(', ')}</div>}
              {p.duplicadas.length > 0 && <div className="muted">Repetidas: {p.duplicadas.join(', ')}</div>}
              {p.diferencias.map((d) => <div key={d.cabeceraArchivo} className="muted">«{d.cabeceraArchivo.trim()}» → «{d.cabeceraPerfil.trim()}»: {COINC_TXT[d.coincidencia]}</div>)}
            </div>
          ))}
        </div>
      </section>

      {inf.territorio && (
        <section>
          <h4 className="ap-tit">Territorio · {inf.territorio.municipio}</h4>
          <ul className="ap-lista">{inf.territorio.campos.map((c) => <li key={c.campo} className={`ap-${c.estado}`}>{c.mensaje}</li>)}</ul>
        </section>
      )}

      <section>
        <h4 className="ap-tit">Columnas de «{inf.hojaDatos}»</h4>
        <div className="dat-tabla scroll-fino" style={{ maxHeight: 300 }}>
          <table className="tabla ap-tabla">
            <thead><tr><th>Col.</th><th>Cabecera original</th><th>Perfil · tipo esperado</th><th>Tipos detectados</th><th>Formatos</th><th>Vacías</th><th>No encajan</th><th>Variantes</th></tr></thead>
            <tbody>
              {inf.columnas.map((c) => {
                const malas = Object.entries(c.discordantes);
                return (
                  <tr key={c.indice}>
                    <td className="mono">{c.letra}</td>
                    <td className="mono">«{c.cabecera.trimEnd()}»{c.espaciosSobrantes ? <div><span className="chip" title="Espacios al final de la cabecera original (se conservan)">+{c.espaciosSobrantes} esp.</span></div> : null}</td>
                    <td>{c.perfil ? <>{c.perfil.clave}<span className="muted"> · {c.perfil.tipoEsperado}</span>{c.perfil.coincidencia !== 'exacta' ? <div className="muted">{COINC_TXT[c.perfil.coincidencia]}</div> : null}</> : <span className="muted">—</span>}</td>
                    <td style={{ fontSize: 12 }}>{Object.entries(c.tipos).map(([k, v]) => `${k} ${v}`).join(' · ')}</td>
                    <td style={{ fontSize: 12 }}>{Object.keys(c.formatos).join(' · ')}</td>
                    <td className="num">{c.vacias}</td>
                    <td style={{ fontSize: 12 }} className={malas.length ? 'ap-mal' : ''}>{malas.map(([k, v]) => `${v} ${k}`).join(' · ')}</td>
                    <td style={{ fontSize: 12 }}>{Object.entries(c.variantes).map(([k, v]) => `${v} ${k}`).join(' · ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {inf.direccionesRepetidas && (
        <section>
          <h4 className="ap-tit">Direcciones repetidas</h4>
          <p className="muted" style={{ margin: 0 }}><b>{inf.direccionesRepetidas.grupos}</b> grupo(s) de calle y número en <b>{inf.direccionesRepetidas.filas}</b> filas. {inf.direccionesRepetidas.nota}</p>
        </section>
      )}

      <section>
        <h4 className="ap-tit">Avisos ({inf.avisos.length})</h4>
        <ul className="ap-lista">{inf.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
      </section>
      <section className="ap-garantias" aria-label="Garantías">
        {inf.garantias.map((g) => <div key={g}><ShieldCheck size={13} /> {g}</div>)}
      </section>
    </div>
  );
}

const ESTADO_TXT = { valido: 'Válido', transformado: 'Transformado', vacio: 'Vacío', 'no-aplica': 'No aplica', pendiente: 'Pendiente', invalido: 'Inválido' } as const;
const DECISION_TXT = { catedra: 'Cátedra', revision: 'Revisión', informativa: '—' } as const;

/** C1b · Resumen de la interpretación (sin nombres ni direcciones). No importa nada. */
function Interpretacion({ inf }: { inf: InformeInterpretacion }) {
  const c = inf.celdas;
  const pct = (n: number) => `${((100 * n) / (c.total || 1)).toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`;
  return (
    <div className="col ap" style={{ gap: 14 }} aria-label="Interpretación de valores">
      <section className="ap-resumen">
        <div><span className="muted">Registros</span><b>{fmt(inf.filas.registros)}</b><span className="muted">{inf.filas.locales.ocupado} ocupados · {inf.filas.locales.vacio} vacíos{inf.filas.locales.desconocido ? ` · ${inf.filas.locales.desconocido} sin estado` : ''}{inf.filas.candidatasExcluir.length ? ` · ${inf.filas.candidatasExcluir.length} posible(s) total(es) conservado(s), por confirmar` : ''}</span></div>
        <div><span className="muted">Celdas sin revisión</span><b>{fmt(c.sinRevision)}</b><span className="muted">{pct(c.sinRevision)} de {fmt(c.total)}</span></div>
        <div><span className="muted">Requieren revisión</span><b>{fmt(c.requierenRevision)}</b><span className="muted">{pct(c.requierenRevision)}</span></div>
        <div><span className="muted">Incidencias</span><b>{fmt(inf.incidencias.total)}</b><span className="muted">{inf.incidencias.porGravedad.error} error · {inf.incidencias.porGravedad.aviso} aviso · {inf.incidencias.porGravedad.info} info</span></div>
        <div><span className="muted">Nº redes</span><b>{inf.redes.coinciden} coinciden</b><span className="muted">{inf.redes.discrepan} discrepan · {inf.redes.noCalculables} sin calcular</span></div>
      </section>
      <section>
        <h4 className="ap-tit">Estados de las celdas</h4>
        <p className="muted" style={{ margin: 0 }}>{(Object.keys(ESTADO_TXT) as (keyof typeof ESTADO_TXT)[]).map((k) => `${ESTADO_TXT[k]} ${fmt(c.porEstado[k])}`).join(' · ')}</p>
      </section>
      <section>
        <h4 className="ap-tit">Incidencias por tipo</h4>
        <div className="dat-tabla scroll-fino" style={{ maxHeight: 260 }}>
          <table className="tabla ap-tabla" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup><col style={{ width: '26%' }} /><col style={{ width: 92 }} /><col style={{ width: 76 }} /><col style={{ width: 64 }} /><col style={{ width: '20%' }} /><col /></colgroup>
            <thead><tr><th>Tipo</th><th>Gravedad</th><th>Decide</th><th className="num">Celdas</th><th>Columnas</th><th>Propuesta</th></tr></thead>
            <tbody className="ap-ajuste">
              {inf.incidencias.porTipo.map((t) => (
                <tr key={t.tipo}><td>{t.titulo}</td><td className={t.gravedad === 'error' ? 'ap-mal' : ''}>{t.gravedad}</td><td>{DECISION_TXT[t.decision]}</td><td className="num">{fmt(t.n)}</td><td style={{ fontSize: 12 }}>{t.columnas.map((x) => `«${x}»`).join(', ')}</td><td className="muted" style={{ fontSize: 12 }}>{t.propuesta}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {inf.decisionesPendientes.length > 0 && (
        <section>
          <h4 className="ap-tit">Pendiente de decisión (no se ha aplicado)</h4>
          <ul className="ap-lista">{inf.decisionesPendientes.map((d) => <li key={d.decision}>Decisión {d.decision}: {d.descripcion} · {fmt(d.celdas)} celda(s)</li>)}</ul>
        </section>
      )}
      <section className="ap-garantias" aria-label="Garantías de la interpretación">
        {inf.garantias.map((g) => <div key={g}><ShieldCheck size={13} /> {g}</div>)}
      </section>
    </div>
  );
}
