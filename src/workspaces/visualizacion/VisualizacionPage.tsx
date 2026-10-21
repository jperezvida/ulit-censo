import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store/store';
import { Segmentado, fmt } from '../../components/ui';
import { ambitos, datosCampana, distribucion, filtrar, SECTORES, TIPO_AMBITO_TXT, type FiltrosPanel, type Sector } from '../../domain/panel';
import type { Id, TipoAmbito } from '../../domain/types';
import { Emblema } from './graficos';
import { Comparar, Cobertura, Digital1, Digital2, Resumen, SectorTab, Vacios } from './secciones';
import '../../styles/visualizacion.css';

export type Pestana = 'resumen' | 'comercio' | 'servicios' | 'hosteleria' | 'vacios' | 'digital1' | 'digital2' | 'cobertura' | 'comparar';
const SECTOR_DE: Partial<Record<Pestana, Sector>> = { comercio: 'Comercio', servicios: 'Servicios', hosteleria: 'Hostelería y Restauración' };
const TIPOS: TipoAmbito[] = ['municipio', 'barrio', 'eje-comercial', 'zona-estudio', 'mercado'];

/**
 * C1d-B · Dashboard estadístico. Todo se calcula sobre el modelo (ninguna cifra a mano), con los
 * denominadores a la vista y las fuentes separadas (histórico importado, propuesta, confirmado).
 */
export default function VisualizacionPage() {
  const db = useStore((s) => s.db!);
  const prefs = useStore((s) => s.prefs);
  const lista = useMemo(() => ambitos(db), [db]);
  const [tipo, setTipo] = useState<TipoAmbito>('municipio');
  const delTipo = lista.filter((a) => a.tipo === tipo);
  const [ambitoId, setAmbitoId] = useState<Id>(() => (lista.find((a) => a.id === prefs.municipioId) ?? lista[0])?.id);
  const ambito = delTipo.find((a) => a.id === ambitoId) ?? delTipo[0];
  const [campanaId, setCampanaId] = useState<Id | undefined>(() => (ambito?.campanas.find((c) => c.id === prefs.campanaId) ?? ambito?.campanas[0])?.id);
  const campana = ambito?.campanas.find((c) => c.id === campanaId) ?? ambito?.campanas[0];
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const [filtros, setFiltros] = useState<FiltrosPanel>({});

  const datos = useMemo(() => (campana ? datosCampana(db, campana.id) : null), [db, campana]);
  const cps = useMemo(() => (datos ? distribucion(datos.unidades, (u) => u.cp, '__sin__') : []), [datos]);
  const sectorPestana = SECTOR_DE[pestana];
  const enVacios = pestana === 'vacios';
  // En «Locales vacíos» no se aplican sector ni franquicia (los vacíos no los tienen; se explica en la pestaña).
  const unidades = useMemo(
    () => (datos ? filtrar(datos.unidades, enVacios ? { ...filtros, sector: undefined, franquicia: undefined } : { ...filtros, sector: sectorPestana ?? filtros.sector }) : []),
    [datos, filtros, sectorPestana, enVacios],
  );
  const cambiarAmbito = (id: Id) => {
    setAmbitoId(id);
    setCampanaId(lista.find((a) => a.id === id)?.campanas[0]?.id);
    setFiltros({});
  };

  if (!ambito || !campana || !datos) return <div className="pagina"><div className="vacio-estado tarjeta">No hay campañas con datos que visualizar.</div></div>;
  const hayCp = cps.some((c) => c.clave !== '__sin__');
  const calleFiltro = filtros.calleId ? db.calles[filtros.calleId]?.nombre : undefined;

  return (
    <div className="pagina vz">
      <div className="vz-cab">
        <Emblema municipio={ambito} />
        <div className="esp">
          <div className="rotulo sin-linea">07 · Visualización · {TIPO_AMBITO_TXT[ambito.tipo]}</div>
          <h1>{ambito.nombre}{ambito.escenarioDemo && <span className="tag naranja">escenario ficticio</span>}</h1>
          <p className="muted">Cifras calculadas sobre los datos del modelo, siempre con su denominador. Los datos de la demostración son ficticios.</p>
        </div>
        <label className="campo vz-sel">
          <span>Tipo de ámbito</span>
          <select className="input" aria-label="Tipo de ámbito" value={tipo} onChange={(e) => { const t = e.target.value as TipoAmbito; setTipo(t); const a = lista.find((x) => x.tipo === t); if (a) cambiarAmbito(a.id); }}>
            {TIPOS.map((t) => <option key={t} value={t} disabled={!lista.some((a) => a.tipo === t)}>{TIPO_AMBITO_TXT[t]}{lista.some((a) => a.tipo === t) ? '' : ' (sin datos)'}</option>)}
          </select>
        </label>
        <label className="campo vz-sel">
          <span>Ámbito</span>
          <select className="input" aria-label="Ámbito" value={ambito.id} onChange={(e) => cambiarAmbito(e.target.value)}>
            {delTipo.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </label>
      </div>

      <div className="vz-anios" role="tablist" aria-label="Año y campaña">
        {ambito.campanas.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === campana.id} className={c.id === campana.id ? 'on' : ''} onClick={() => { setCampanaId(c.id); setFiltros({}); }}>
            <b>{c.anio}</b><span>{c.nombre}</span>
            <span className="muted">{c.tipo === 'historico-importado' ? 'histórico' : c.estados.campo === 'terminado' ? 'campaña cerrada' : 'en curso'}</span>
          </button>
        ))}
      </div>

      <div className="vz-filtros fila" aria-label="Filtros">
        <label className="fila">
          <span className="muted">Franquicia</span>
          <select className="input" aria-label="Filtro de franquicia" value={filtros.franquicia ?? ''} onChange={(e) => setFiltros({ ...filtros, franquicia: (e.target.value || undefined) as FiltrosPanel['franquicia'] })}>
            <option value="">Todos</option><option value="si">Franquicia: Sí</option><option value="no">Franquicia: No</option><option value="pendiente">Pendiente o sin dato</option>
          </select>
        </label>
        <label className="fila">
          <span className="muted">Sector</span>
          <select className="input" aria-label="Filtro de sector" value={sectorPestana ?? filtros.sector ?? ''} disabled={!!sectorPestana} onChange={(e) => setFiltros({ ...filtros, sector: (e.target.value || undefined) as Sector | undefined })}>
            <option value="">Todos</option>{SECTORES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="fila">
          <span className="muted">Código postal</span>
          <select className="input" aria-label="Filtro de código postal" value={filtros.cp ?? ''} disabled={!hayCp} onChange={(e) => setFiltros({ ...filtros, cp: e.target.value || undefined })} title={hayCp ? undefined : 'Estos datos no incluyen código postal: no se deduce'}>
            <option value="">{hayCp ? 'Todos' : 'Sin datos de CP'}</option>
            {cps.filter((c) => c.clave !== '__sin__').map((c) => <option key={c.clave} value={c.clave}>{c.clave} ({fmt(c.n)})</option>)}
            {hayCp && cps.some((c) => c.clave === '__sin__') && <option value="__sin__">Sin CP en el origen</option>}
          </select>
        </label>
        {calleFiltro && <span className="chip azul">Calle: {calleFiltro} <button className="vz-quitar" aria-label="Quitar filtro de calle" onClick={() => setFiltros({ ...filtros, calleId: undefined })}><X size={12} /></button></span>}
        <span className="esp" />
        <span className="muted">{fmt(unidades.length)} de {fmt(datos.unidades.length)} establecimientos observados</span>
      </div>

      {datos.historica && (
        <div className="t-info aviso vz-aviso" role="note">
          <b>Histórico importado ({campana.anio}).</b> Es una referencia: nada está revisado ni verificado para 2026. La clasificación es el texto original de {campana.anio} (sin convertir al catálogo 2026) y la franquicia y la presencia digital tienen origen «importado».
        </div>
      )}

      <Segmentado
        valor={pestana}
        onCambio={setPestana}
        opciones={[
          { v: 'resumen', t: 'Resumen' }, { v: 'comercio', t: 'Comercio' }, { v: 'servicios', t: 'Servicios' }, { v: 'hosteleria', t: 'Hostelería y restauración' },
          { v: 'vacios', t: 'Locales vacíos' }, { v: 'digital1', t: 'Digitalización 1' }, { v: 'digital2', t: 'Digitalización 2' }, { v: 'cobertura', t: 'Cobertura y calidad' }, { v: 'comparar', t: 'Comparar' },
        ]}
      />
      <div className="vz-rejilla">
        {pestana === 'resumen' && <Resumen datos={datos} unidades={unidades} filtros={filtros} setFiltros={setFiltros} />}
        {sectorPestana && <SectorTab sector={sectorPestana} datos={datos} unidades={unidades} setFiltros={setFiltros} filtros={filtros} />}
        {pestana === 'vacios' && <Vacios unidades={unidades} hayCp={hayCp} setFiltros={setFiltros} filtros={filtros} />}
        {pestana === 'digital1' && <Digital1 unidades={unidades} />}
        {pestana === 'digital2' && <Digital2 unidades={unidades} />}
        {pestana === 'cobertura' && <Cobertura datos={datos} unidades={unidades} />}
        {pestana === 'comparar' && <Comparar datos={datos} filtros={filtros} />}
      </div>
    </div>
  );
}
