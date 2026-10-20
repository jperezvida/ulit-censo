import { useState } from 'react';
import { CheckCircle2, Download, FileSearch, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Modal, fmt } from '../../components/ui';
import { descargar } from '../../domain/exportacion';
import { CONFIG_TERRITORIAL } from '../../domain/territorio';
import type { InformeEstructural } from '../../domain/xlsx/analisis';

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

  const leer = async (f: File) => {
    setCargando(true);
    setError(null);
    try {
      const { analizarXlsx } = await import('../../domain/xlsx/analisis');
      setInforme(await analizarXlsx(new Uint8Array(await f.arrayBuffer()), f.name, { territorio: municipio ? CONFIG_TERRITORIAL[municipio] : undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal
      ancho
      titulo="Análisis previo de un Excel (C1a)"
      sub="Identifica la hoja de datos, las columnas, los tipos y los perfiles compatibles. Solo lectura: no importa negocios, no crea locales ni modifica campañas. El archivo no se guarda ni se envía."
      onCerrar={onCerrar}
      pie={
        informe && (
          <>
            <span className="muted esp"><ShieldCheck size={13} /> El informe no contiene nombres de negocio ni direcciones.</span>
            <button className="btn" onClick={() => setInforme(null)}>Analizar otro</button>
            <button className="btn primario" onClick={() => descargar(`${informe.archivo.nombre}.informe-estructural.json`, JSON.stringify(informe, null, 2), 'application/json')}>
              <Download size={15} /> Descargar informe
            </button>
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
          <label className="kml-drop">
            <FileSearch size={26} />
            <b>{cargando ? 'Analizando…' : 'Selecciona un archivo .xlsx'}</b>
            <span className="muted">Se admiten los formatos de 27 columnas (censo municipal) y 28 columnas (itinerario de Medina 2026).</span>
            <input type="file" aria-label="Archivo xlsx" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} />
          </label>
          {error && <div className="t-info error" role="alert">{error}</div>}
        </div>
      ) : (
        <Informe inf={informe} />
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
