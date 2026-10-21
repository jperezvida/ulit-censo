import { useMemo, useState, type ReactNode } from 'react';
import { BarChart3, Briefcase, DoorOpen, FilterX, GitCompareArrows, LayoutDashboard, ShieldCheck, ShoppingBag, UtensilsCrossed, Wifi } from 'lucide-react';
import { useStore } from '../../store/store';
import { fmt } from '../../components/ui';
import { ambitos, datosCampana, distribucion, filtrar, origenDatos, SECTORES, TIPO_AMBITO_TXT, type FiltrosPanel, type Sector } from '../../domain/panel';
import type { Id, TipoAmbito } from '../../domain/types';
import { Emblema } from './graficos';
import { Resumen } from './resumen';
import { SectorTab } from './sectores';
import { Vacios } from './vacios';
import { Digital1, Digital2 } from './digital';
import { Cobertura, Comparar } from './calidad';
import { AvisoOrigen, type Contexto } from './comun';
import '../../styles/visualizacion.css';

export type Pestana = 'resumen' | 'comercio' | 'servicios' | 'hosteleria' | 'vacios' | 'digital1' | 'digital2' | 'cobertura' | 'comparar';
const SECTOR_DE: Partial<Record<Pestana, Sector>> = { comercio: 'Comercio', servicios: 'Servicios', hosteleria: 'Hostelería y Restauración' };
const TIPOS: TipoAmbito[] = ['municipio', 'barrio', 'eje-comercial', 'zona-estudio', 'mercado'];
const PESTANAS: { v: Pestana; t: string; i: ReactNode }[] = [
  { v: 'resumen', t: 'Resumen', i: <LayoutDashboard size={15} /> },
  { v: 'comercio', t: 'Comercio', i: <ShoppingBag size={15} /> },
  { v: 'servicios', t: 'Servicios', i: <Briefcase size={15} /> },
  { v: 'hosteleria', t: 'Hostelería y restauración', i: <UtensilsCrossed size={15} /> },
  { v: 'vacios', t: 'Locales vacíos', i: <DoorOpen size={15} /> },
  { v: 'digital1', t: 'Digitalización 1', i: <Wifi size={15} /> },
  { v: 'digital2', t: 'Digitalización 2', i: <BarChart3 size={15} /> },
  { v: 'cobertura', t: 'Cobertura y calidad', i: <ShieldCheck size={15} /> },
  { v: 'comparar', t: 'Comparar', i: <GitCompareArrows size={15} /> },
];

/**
 * Cuadro de mando. Todo se calcula sobre el modelo (ninguna cifra a mano), con los denominadores a
 * la vista y las fuentes separadas (histórico importado, propuesta, confirmado).
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
  const origen = useMemo(() => (datos ? origenDatos(datos) : null), [datos]);
  const cps = useMemo(() => (datos ? distribucion(datos.unidades, (u) => u.cp, '__sin__') : []), [datos]);
  const calles = useMemo(() => {
    const m = new Map<Id, { nombre: string; n: number }>();
    for (const u of datos?.unidades ?? []) m.set(u.calleId, { nombre: u.calle, n: (m.get(u.calleId)?.n ?? 0) + 1 });
    return [...m].map(([id, c]) => ({ id, ...c })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [datos]);
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

  if (!ambito || !campana || !datos || !origen) return <div className="pagina"><div className="vacio-estado tarjeta">No hay campañas con datos que visualizar.</div></div>;
  const hayCp = cps.some((c) => c.clave !== '__sin__');
  const hayFiltros = !!(filtros.cp || filtros.calleId || filtros.franquicia || filtros.sector);
  const ctx: Contexto = { db, datos, unidades, filtros, setFiltros, hayCp };

  return (
    <div className="pagina vz">
      <header className="vz-cab2">
        <div className="vz-cab2-fila">
          <Emblema municipio={ambito} tamano={38} />
          <div className="vz-cab2-tit">
            <h1>{ambito.nombre}{ambito.escenarioDemo && <span className="vz-etiqueta-esc">escenario ficticio</span>}</h1>
            <span>{TIPO_AMBITO_TXT[ambito.tipo]} · cuadro de mando calculado sobre el modelo</span>
          </div>
          <div className="vz-anios2" role="tablist" aria-label="Año y campaña">
            {ambito.campanas.map((c) => (
              <button key={c.id} role="tab" aria-selected={c.id === campana.id} className={c.id === campana.id ? 'on' : ''} onClick={() => { setCampanaId(c.id); setFiltros({}); }} title={c.nombre}>
                <b>{c.anio}</b><span className="vh">{c.nombre}</span>
                <span className="muted">{c.tipo === 'historico-importado' ? 'histórico' : c.estados.campo === 'terminado' ? 'campaña cerrada' : 'en curso'}</span>
              </button>
            ))}
          </div>
          <label className="vz-f">
            <span>Tipo</span>
            <select className="input" aria-label="Tipo de ámbito" value={tipo} onChange={(e) => { const t = e.target.value as TipoAmbito; setTipo(t); const a = lista.find((x) => x.tipo === t); if (a) cambiarAmbito(a.id); }}>
              {TIPOS.map((t) => <option key={t} value={t} disabled={!lista.some((a) => a.tipo === t)}>{TIPO_AMBITO_TXT[t]}{lista.some((a) => a.tipo === t) ? '' : ' (sin datos)'}</option>)}
            </select>
          </label>
          <label className="vz-f">
            <span>Ámbito</span>
            <select className="input vz-f-ancho" aria-label="Ámbito" value={ambito.id} onChange={(e) => cambiarAmbito(e.target.value)}>
              {delTipo.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </label>
        </div>

        <div className="vz-cab2-filtros" role="group" aria-label="Filtros">
          <label className="vz-f">
            <span>Franquicia</span>
            <select className={`input ${filtros.franquicia ? 'activo' : ''}`} aria-label="Filtro de franquicia" value={filtros.franquicia ?? ''} onChange={(e) => setFiltros({ ...filtros, franquicia: (e.target.value || undefined) as FiltrosPanel['franquicia'] })}>
              <option value="">Todos</option><option value="si">Franquicia: Sí</option><option value="no">Franquicia: No</option><option value="pendiente">Pendiente o sin dato</option>
            </select>
          </label>
          <label className="vz-f">
            <span>Sector</span>
            <select className={`input ${sectorPestana || filtros.sector ? 'activo' : ''}`} aria-label="Filtro de sector" value={sectorPestana ?? filtros.sector ?? ''} disabled={!!sectorPestana} title={sectorPestana ? 'Fijado por la pestaña' : undefined} onChange={(e) => setFiltros({ ...filtros, sector: (e.target.value || undefined) as Sector | undefined })}>
              <option value="">Todos</option>{SECTORES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="vz-f">
            <span>CP</span>
            <select className={`input ${filtros.cp ? 'activo' : ''}`} aria-label="Filtro de código postal" value={filtros.cp ?? ''} disabled={!hayCp} onChange={(e) => setFiltros({ ...filtros, cp: e.target.value || undefined })} title={hayCp ? undefined : 'Estos datos no incluyen código postal: no se deduce'}>
              <option value="">{hayCp ? 'Todos' : 'Sin datos de CP'}</option>
              {cps.filter((c) => c.clave !== '__sin__').map((c) => <option key={c.clave} value={c.clave}>{c.clave} ({fmt(c.n)})</option>)}
              {hayCp && cps.some((c) => c.clave === '__sin__') && <option value="__sin__">Sin CP en el origen</option>}
            </select>
          </label>
          <label className="vz-f">
            <span>Calle</span>
            <select className={`input vz-f-ancho ${filtros.calleId ? 'activo' : ''}`} aria-label="Filtro de calle" value={filtros.calleId ?? ''} onChange={(e) => setFiltros({ ...filtros, calleId: e.target.value || undefined })}>
              <option value="">Todas ({fmt(calles.length)})</option>
              {calles.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({fmt(c.n)})</option>)}
            </select>
          </label>
          <button className="btn s fantasma vz-limpiar" disabled={!hayFiltros} onClick={() => setFiltros({})}><FilterX size={14} /> Limpiar filtros</button>
          <div className="vz-contador" aria-live="polite">
            <span><b className="num">{fmt(unidades.length)}</b> de {fmt(datos.unidades.length)} establecimientos observados</span>
          </div>
        </div>
      </header>

      <AvisoOrigen origen={origen} />

      <nav className="vz-pestanas" role="tablist" aria-label="Cuadros de mando">
        {PESTANAS.map((p) => (
          <button key={p.v} role="tab" aria-selected={pestana === p.v} className={pestana === p.v ? 'on' : ''} onClick={() => setPestana(p.v)}>{p.i}{p.t}</button>
        ))}
      </nav>

      <div className="vz-grid">
        {pestana === 'resumen' && <Resumen {...ctx} />}
        {sectorPestana && <SectorTab sector={sectorPestana} {...ctx} />}
        {pestana === 'vacios' && <Vacios {...ctx} />}
        {pestana === 'digital1' && <Digital1 {...ctx} />}
        {pestana === 'digital2' && <Digital2 {...ctx} />}
        {pestana === 'cobertura' && <Cobertura {...ctx} />}
        {pestana === 'comparar' && <Comparar {...ctx} />}
      </div>
    </div>
  );
}
