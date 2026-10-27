import { useState } from 'react';
import { Download, FileSearch, ShieldCheck } from 'lucide-react';
import { Modal, fmt } from '../../components/ui';
import { descargar } from '../../domain/exportacion';
import type { PerfilEstructural } from '../../domain/xlsx/perfil';

/**
 * Inspector estructural en el navegador: el Excel se lee localmente, no se guarda
 * en la aplicación ni se envía a ningún servidor. Solo se descarga el perfil (estructura).
 */
export function InspectorExcel({ onCerrar }: { onCerrar: () => void }) {
  const [perfil, setPerfil] = useState<PerfilEstructural | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const leer = async (f: File) => {
    setCargando(true);
    setError(null);
    try {
      const { perfilarXlsx } = await import('../../domain/xlsx/perfil');
      setPerfil(await perfilarXlsx(new Uint8Array(await f.arrayBuffer()), f.name));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal
      ancho
      titulo="Inspeccionar estructura de un Excel"
      sub="Lee el archivo en este navegador y genera un perfil sin nombres de negocio ni direcciones. El Excel no se guarda ni se envía."
      onCerrar={onCerrar}
      pie={
        perfil && (
          <>
            <span className="muted esp"><ShieldCheck size={13} /> Revisa el perfil antes de compartirlo.</span>
            <button className="btn primario" onClick={() => descargar(`${perfil.archivo.nombre}.perfil.json`, JSON.stringify(perfil, null, 2), 'application/json')}>
              <Download size={15} /> Descargar perfil.json
            </button>
          </>
        )
      }
    >
      {!perfil ? (
        <label className="kml-drop">
          <FileSearch size={26} />
          <b>{cargando ? 'Analizando…' : 'Selecciona un archivo .xlsx'}</b>
          <span className="muted">Se describen hojas, cabeceras exactas, tipos, formatos, celdas amarillas y listas de categorías.</span>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} />
        </label>
      ) : (
        <div className="col" style={{ gap: 14 }}>
          {perfil.avisos.map((a) => <div key={a} className="t-info aviso" style={{ margin: 0 }}>{a}</div>)}
          {perfil.hojas.map((h) => (
            <section key={h.nombre}>
              <div className="fila" style={{ marginBottom: 6, flexWrap: 'wrap' }}>
                <b>Hoja «{h.nombre}»</b>
                <span className="muted">{fmt(h.filasConDatos)} filas · {h.columnas.length} columnas · cabecera en fila {h.filaCabecera ?? '—'}</span>
                {!h.visible && <span className="chip">oculta</span>}
                {h.tuplasActividad && <span className="chip azul">{h.tuplasActividad.tuplas.length} combinaciones de actividad</span>}
              </div>
              <div className="dat-tabla scroll-fino" style={{ maxHeight: 280 }}>
                <table className="tabla">
                  <thead><tr><th>Col.</th><th>Cabecera exacta</th><th>Tipos</th><th>Vacías</th><th>Distintos</th><th>Amarillas</th><th>Valores</th></tr></thead>
                  <tbody>
                    {h.columnas.map((c) => (
                      <tr key={c.indice}>
                        <td className="mono">{c.letra}</td>
                        <td className="mono">«{c.cabecera}»</td>
                        <td style={{ fontSize: 12 }}>{Object.entries(c.tipos).filter(([k]) => k !== 'vacia').map(([k, v]) => `${k} ${v}`).join(' · ')}</td>
                        <td className="num">{c.vacias}</td>
                        <td className="num">{c.distintos}</td>
                        <td className="num">{c.rellenos.amarillo || ''}</td>
                        <td style={{ fontSize: 12 }}>{c.valores ? `${c.valores.slice(0, 4).map((v) => v.valor).join(', ')}${c.valores.length > 4 ? '…' : ''}` : <span className="muted">{c.motivoSinValores}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {error && <div className="t-info error">{error}</div>}
        </div>
      )}
      {error && !perfil && <div className="t-info error" style={{ marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}
