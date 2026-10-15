import { useMemo, useState } from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import { FileUp, FlaskConical } from 'lucide-react';
import { Modal, Sim } from '../../components/ui';
import { useContexto } from '../../store/contexto';
import { useStore } from '../../store/store';
import { casarTrazosKML, parsearKML, type CoincidenciaKML } from '../../domain/importacion';
import { distanciaPuntoLinea } from '../../domain/geo';
import { crearItinerario, siguienteCodigo } from '../../domain/itinerarios';
import { itinerariosDe } from '../../domain/consultas';
import { asignacionDelAmbito } from '../../domain/planificacion';
import { COLORES_IT } from '../../data/semilla';
import type { Id, TramoPlan } from '../../domain/types';

/** KML de ejemplo SIMULADO generado a partir de calles sin asignar del callejero cargado. */
function kmlEjemplo(calles: { nombre: string; coords: [number, number][] }[]): string {
  const pm = (nombre: string, coords: [number, number][]) =>
    `<Placemark><name>${nombre}</name><LineString><coordinates>${coords.map((c) => `${c[0]},${c[1]},0`).join(' ')}</coordinates></LineString></Placemark>`;
  const partes = calles.map((c, i) => {
    if (i === 1) return pm(`C/ ${c.nombre.replace(/^Calle (de la |del |de )?/i, '')}`, c.coords); // variante de nombre
    if (i === 3) return pm(`Tramo ${i + 1}`, c.coords.map(([x, y]) => [x + 0.00004, y + 0.00003] as [number, number])); // solo geometría
    return pm(c.nombre, c.coords);
  });
  const c0 = calles[0]?.coords[0] ?? [-4.91, 41.31];
  partes.push(pm('Callejón sin nombre (ejemplo)', [[c0[0] + 0.004, c0[1] + 0.003], [c0[0] + 0.0046, c0[1] + 0.0034]]));
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Itinerario de ejemplo (SIMULADO)</name><Folder><name>Itinerario de ejemplo</name>${partes.join('')}</Folder></Document></kml>`;
}

export function ImportarKML({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: (id: Id) => void }) {
  const { db, municipio, campana } = useContexto();
  const aplicar = useStore((s) => s.aplicar);
  const [archivo, setArchivo] = useState<string | null>(null);
  const [res, setRes] = useState<CoincidenciaKML[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulado, setSimulado] = useState(false);
  const calles = useMemo(() => Object.values(db.calles).filter((c) => c.municipioId === municipio.id), [db.calles, municipio.id]);

  const procesar = (xml: string, nombre: string, sim: boolean) => {
    try {
      const trazos = parsearKML(xml);
      if (!trazos.length) throw new Error('El archivo no contiene líneas (LineString).');
      setRes(casarTrazosKML(trazos, calles, distanciaPuntoLinea));
      setArchivo(nombre);
      setSimulado(sim);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const leer = async (f: File) => {
    if (f.name.toLowerCase().endsWith('.kmz')) {
      const zip = unzipSync(new Uint8Array(await f.arrayBuffer()));
      const kml = Object.keys(zip).find((k) => k.toLowerCase().endsWith('.kml'));
      if (!kml) return setError('El KMZ no contiene ningún .kml');
      procesar(strFromU8(zip[kml]), f.name, false);
    } else procesar(await f.text(), f.name, false);
  };

  const ejemplo = () => {
    if (!campana) return;
    const asig = asignacionDelAmbito(campana, itinerariosDe(db, campana.id), db.calles);
    const libres = asig.sinAsignar.map((id) => db.calles[id]).filter((c) => c.segmentos.length).slice(0, 6);
    procesar(kmlEjemplo(libres.map((c) => ({ nombre: c.nombre, coords: c.segmentos.flatMap((s) => s.coords) as [number, number][] }))), 'itinerario_ejemplo_SIMULADO.kml', true);
  };

  const casadas = res?.filter((r) => r.calleIds.length) ?? [];
  const crear = () => {
    if (!campana || !res) return;
    const ids = [...new Set(casadas.flatMap((r) => r.calleIds))];
    const tramos: TramoPlan[] = ids.map((calleId, i) => ({ calleId, acera: 'ambas', orden: i + 1 }));
    const its = itinerariosDe(db, campana.id);
    const codigo = siguienteCodigo(its.map((i) => i.codigo));
    let id = '';
    aplicar((d) => {
      const r = crearItinerario(d, campana.id, {
        codigo, nombre: archivo?.replace(/\.km[lz]$/i, '') ?? codigo, color: COLORES_IT[its.length % COLORES_IT.length], origen: 'kml', tramos,
        notas: `Importado de ${archivo}. ${res.length - casadas.length} trazo(s) sin coincidencia.`,
      });
      id = r.id;
      return r.db;
    }, `${codigo} creado desde KML`);
    onCreado(id);
  };

  return (
    <Modal
      ancho
      titulo="Importar itinerario desde Google My Maps"
      sub="KML o KMZ exportado de My Maps. Se comprueba cada trazo contra el callejero antes de crear nada."
      onCerrar={onCerrar}
      pie={
        res && (
          <>
            <span className="muted esp">{casadas.length} de {res.length} trazos relacionados con el callejero</span>
            <button className="btn" onClick={() => setRes(null)}>Otro archivo</button>
            <button className="btn primario" disabled={!casadas.length} onClick={crear}>Crear itinerario</button>
          </>
        )
      }
    >
      {!res ? (
        <div className="kml-entrada">
          <label className="kml-drop">
            <FileUp size={26} />
            <b>Selecciona un archivo .kml o .kmz</b>
            <span className="muted">El archivo se procesa en el navegador; no se envía a ningún servidor.</span>
            <input type="file" accept=".kml,.kmz,application/vnd.google-earth.kml+xml" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} />
          </label>
          <button className="btn" onClick={ejemplo}>
            <FlaskConical size={15} /> Probar con un KML de ejemplo (simulado)
          </button>
          {error && <div className="t-info error">{error}</div>}
          <p className="muted" style={{ fontSize: 12 }}>Los cuatro mapas reales de My Maps no están en este entorno. Cuando se aporten, este mismo asistente los incorporará como itinerarios de la campaña sin alterar el histórico.</p>
        </div>
      ) : (
        <>
          <div className="fila" style={{ marginBottom: 10 }}>
            <b>{archivo}</b>
            {simulado && <Sim texto="KML simulado" />}
          </div>
          <table className="tabla">
            <thead>
              <tr>
                <th>Trazo</th>
                <th>Resultado</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {res.map((r, i) => (
                <tr key={i}>
                  <td>{r.trazo.nombre}<div className="muted mono" style={{ fontSize: 10.5 }}>{r.trazo.coords.length} vértices</div></td>
                  <td>
                    <span className={`chip ${r.metodo === 'nombre' ? 'ok' : r.metodo === 'geometria' ? 'azul' : 'error'}`}>
                      {r.metodo === 'nombre' ? 'Por nombre' : r.metodo === 'geometria' ? 'Por geometría' : 'Sin coincidencia'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12.5 }}>{r.detalle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
