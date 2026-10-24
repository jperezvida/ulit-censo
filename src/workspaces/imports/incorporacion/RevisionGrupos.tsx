import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { fmt } from '../../../components/ui';
import { agruparRevision, CLASE_REVISION_TXT, ESTADO_REVISION_TXT, filtrarRevision, resumenClases, type ClaseRevision, type EstadoRevision, type ItemRevision } from '../../../domain/incorporacionDemo';

const GRAVEDAD_TXT = { error: 'Error', aviso: 'Aviso', info: 'Información', pendiente: 'Pendiente' } as const;
type Grav = keyof typeof GRAVEDAD_TXT;
const POR_PAGINA = 25;

export function ChipEstado({ e }: { e: EstadoRevision }) {
  return <span className={`chip est-${e}`}>{ESTADO_REVISION_TXT[e]}</span>;
}

/**
 * Revisión por GRUPOS: no obliga a recorrer las filas una a una. Se elige un grupo (tipo de
 * incidencia o de correspondencia), se filtra por gravedad o estado y se busca por calle, número,
 * negocio o número de fila. Cada fila muestra el valor original, la interpretación y la regla.
 */
export function RevisionGrupos({ items }: { items: ItemRevision[] }) {
  const [clase, setClase] = useState<ClaseRevision | null>(null);
  const [grupo, setGrupo] = useState<string | undefined>();
  const clases = useMemo(() => resumenClases(items), [items]);
  const [gravedades, setGravedades] = useState<Grav[]>([]);
  const [estado, setEstado] = useState<EstadoRevision | ''>('');
  const [texto, setTexto] = useState('');
  const [pagina, setPagina] = useState(0);
  const filtrados = useMemo(() => filtrarRevision(items, { clases: clase ? [clase] : [], gravedades, estados: estado ? [estado] : [], texto }), [items, clase, gravedades, estado, texto]);
  const grupos = useMemo(() => agruparRevision(filtrados), [filtrados]);
  const visibles = useMemo(() => (grupo ? filtrados.filter((i) => i.grupo === grupo) : filtrados), [filtrados, grupo]);
  const paginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const alternar = (g: Grav) => {
    setGravedades((x) => (x.includes(g) ? x.filter((y) => y !== g) : [...x, g]));
    setPagina(0);
  };

  return (
    <div className="rev" aria-label="Revisión por grupos">
      <div className="ap-resumen rev-clases" role="group" aria-label="Clases de revisión">
        {(['error', 'comprobar', 'informativo'] as ClaseRevision[]).map((c) => (
          <button key={c} className={`ap-celda clase-${c} ${clase === c ? 'on' : ''}`} aria-pressed={clase === c} title={CLASE_REVISION_TXT[c].explicacion}
            onClick={() => { setClase(clase === c ? null : c); setGrupo(undefined); setPagina(0); }}>
            <span className="muted">{CLASE_REVISION_TXT[c].titulo}</span>
            <b>{fmt(clases[c].total)}</b>
            <span className="muted">{c === 'informativo' ? `${fmt(clases[c].grupos)} grupo(s) · sin acción` : `${fmt(clases[c].pendientes)} pendiente(s) · ${fmt(clases[c].resueltos)} resuelto(s) · ${fmt(clases[c].grupos)} grupo(s)`}</span>
          </button>
        ))}
      </div>
      {clase && <p className="muted" style={{ margin: '0 0 6px' }}>{CLASE_REVISION_TXT[clase].explicacion}</p>}
      <div className="rev-filtros fila">
        <div className="fila" role="group" aria-label="Gravedad">
          {(Object.keys(GRAVEDAD_TXT) as Grav[]).map((g) => (
            <button key={g} className={`chip rev-g ${g} ${gravedades.includes(g) ? 'on' : ''}`} aria-pressed={gravedades.includes(g)} onClick={() => alternar(g)}>{GRAVEDAD_TXT[g]}</button>
          ))}
        </div>
        <select className="input" aria-label="Estado de revisión" value={estado} onChange={(e) => { setEstado(e.target.value as EstadoRevision | ''); setPagina(0); }}>
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADO_REVISION_TXT) as EstadoRevision[]).map((e) => <option key={e} value={e}>{ESTADO_REVISION_TXT[e]}</option>)}
        </select>
        <label className="rev-buscar fila">
          <Search size={14} />
          <input className="input" placeholder="Calle, número, negocio o nº de fila" aria-label="Buscar en la revisión" value={texto} onChange={(e) => { setTexto(e.target.value); setPagina(0); }} />
        </label>
        <span className="muted esp" style={{ textAlign: 'right' }}>{fmt(filtrados.length)} de {fmt(items.length)}</span>
      </div>
      <div className="rev-cuerpo">
        <ul className="rev-grupos scroll-fino" aria-label="Grupos">
          <li><button className={!grupo ? 'on' : ''} onClick={() => { setGrupo(undefined); setPagina(0); }}><b>Todos los grupos</b><span className="num">{fmt(filtrados.length)}</span></button></li>
          {grupos.map((g) => (
            <li key={g.grupo}>
              <button className={grupo === g.grupo ? 'on' : ''} onClick={() => { setGrupo(g.grupo); setPagina(0); }} aria-label={`Grupo ${g.titulo}`}>
                <span className={`rev-punto ${g.gravedad}`} />
                <span className="esp">{g.titulo}</span>
                <span className="num">{fmt(g.total)}</span>
                <span className="rev-mini">
                  {(Object.entries(g.porEstado) as [EstadoRevision, number][]).filter(([, n]) => n).map(([e, n]) => <span key={e} className={`est-${e}`} title={ESTADO_REVISION_TXT[e]}>{n}</span>)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="rev-tabla">
          <div className="dat-tabla scroll-fino" style={{ maxHeight: 420 }}>
            <table className="tabla ap-tabla rev-t">
              <thead><tr><th>Fila</th><th>Calle · nº</th><th>Negocio</th><th>Columna</th><th>Original</th><th>Interpretación</th><th>Regla</th><th>Estado</th></tr></thead>
              <tbody>
                {visibles.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA).map((i) => (
                  <tr key={i.clave}>
                    <td className="mono">{i.fila || '—'}</td>
                    <td>{i.calle ?? '—'} {i.numero ? `· ${i.numero}` : ''}</td>
                    <td>{i.negocio ?? <span className="muted">—</span>}</td>
                    <td>{i.cabecera ?? <span className="muted">{i.titulo}</span>}</td>
                    <td className="mono">{i.original ?? '—'}</td>
                    <td>{i.interpretacion ?? <span className="muted">{i.mensaje}</span>}</td>
                    <td className="rev-regla" title={i.reglaTxt}>{i.regla ? <><code>{i.regla}</code>{i.reglaTxt && <div className="muted">{i.reglaTxt}</div>}</> : <span className="muted">{i.propuesta}</span>}</td>
                    <td><ChipEstado e={i.estado} /></td>
                  </tr>
                ))}
                {!visibles.length && <tr><td colSpan={8} className="muted">Nada que mostrar con estos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="fila rev-pag">
            <button className="btn s" disabled={pag === 0} onClick={() => setPagina(pag - 1)}>Anterior</button>
            <span className="muted">Página {pag + 1} de {paginas}</span>
            <button className="btn s" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)}>Siguiente</button>
          </div>
        </div>
      </div>
    </div>
  );
}
