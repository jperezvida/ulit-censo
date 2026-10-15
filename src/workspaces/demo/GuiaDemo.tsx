import { useNavigate } from 'react-router-dom';
import { ArrowRight, RotateCcw, X } from 'lucide-react';
import { useStore } from '../../store/store';
import { localesPrevios, situacionPrevia } from '../../domain/consultas';
import { estadoTramo } from '../../domain/planificacion';
import type { Prefs } from '../../store/store';

interface Escenario {
  n: number;
  t: string;
  d: string;
  ir: () => { ruta: string; prefs?: Partial<Prefs> } | null;
}

const MEDINA: Partial<Prefs> = { municipioId: 'mun-medina', campanaId: 'camp-medina-2026' };

export function GuiaDemo({ onCerrar }: { onCerrar: () => void }) {
  const db = useStore((s) => s.db!);
  const setPrefs = useStore((s) => s.setPrefs);
  const inicializar = useStore((s) => s.inicializar);
  const nav = useNavigate();
  const itC = db.meta.itCampoTerminado;
  const itA = db.meta.itEnCurso ? db.itinerarios[db.meta.itEnCurso] : undefined;
  const camp = itA ? db.campanas[itA.campanaId] : undefined;
  const callesAna = itA?.tramos.filter((t) => t.responsableId === 'p-ana' && estadoTramo(db, itA.campanaId, t) !== 'completada-con-locales' && estadoTramo(db, itA.campanaId, t) !== 'completada-sin-locales') ?? [];
  const calleActualizar = callesAna.find((t) => camp && localesPrevios(db, camp.campanaReferenciaId, t.calleId).length > 0);
  const calleSinLocales = callesAna.find((t) => camp && situacionPrevia(db, camp, t.calleId) !== 'con-registros');
  const campo = (calle?: string) => (itA ? { ruta: `/campo/it/${itA.id}${calle ? `/calle/${calle}` : ''}`, prefs: { ...MEDINA, campoPersonaId: 'p-ana', sinConexion: false } } : null);

  const escenarios: Escenario[] = [
    { n: 1, t: 'Medina del Campo y sus campañas', d: 'Cartera de censos: 2025 importado y 2026 en curso con sus cuatro estados.', ir: () => ({ ruta: '/campanas', prefs: MEDINA }) },
    { n: 2, t: 'Crear un itinerario sobre el mapa', d: '«Nuevo itinerario» y pulsa calles: cada una entra completa (todos sus segmentos, ambas aceras). Arrastra para reordenar.', ir: () => ({ ruta: '/territorio', prefs: MEDINA }) },
    { n: 3, t: 'Incorporar calles sin locales anteriores', d: 'En «calles sin locales anteriores → Ver», abre una, añádela al itinerario y márcala como revisada.', ir: () => ({ ruta: '/territorio', prefs: MEDINA }) },
    { n: 4, t: 'Importación del censo 2025', d: 'Archivo original conservado fila a fila, con las filas cuya calle no se reconoce pendientes de relacionar.', ir: () => ({ ruta: '/datos', prefs: { ...MEDINA, campanaId: 'camp-medina-2025' } }) },
    { n: 5, t: 'Itinerario 2026 con el campo terminado', d: 'IT-C (demo): todas las calles cerradas, una parcial; categorización y digital pendientes.', ir: () => (itC ? { ruta: `/territorio?it=${itC}&capa=cobertura`, prefs: MEDINA } : null) },
    { n: 6, t: 'Actualización desde el móvil', d: 'Calle con locales anteriores: ✓ confirma de una pulsación; ✎ registra vacío, nuevo negocio, dudoso…', ir: () => campo(calleActualizar?.calleId) },
    { n: 7, t: 'Registrar un local nuevo', d: '«Local nuevo»: la calle se recuerda, el número avanza ±2 en la misma acera, «Guardar y siguiente».', ir: () => campo(calleActualizar?.calleId) },
    { n: 8, t: 'Calle censada sin locales', d: 'Calle sin registros previos: «Finalizar calle» declarando ambas aceras → «Completada sin locales».', ir: () => campo(calleSinLocales?.calleId) },
    { n: 9, t: 'Progreso de varios investigadores', d: 'Personas, calles cerradas, registros sin sincronizar y un conflicto simulado entre dos móviles.', ir: () => ({ ruta: '/territorio?tab=equipo', prefs: MEDINA }) },
    { n: 10, t: 'Bandeja de oficina', d: 'Vistas «Pendiente de categorizar» y «Presencia digital». Prueba J/K, C, G, A y la edición múltiple.', ir: () => ({ ruta: '/oficina?vista=categorizar', prefs: MEDINA }) },
    { n: 11, t: 'Histórico de un local', d: 'Valladolid (demo): zapatería 2023 → vacío 2024 → peluquería 2025, cada negocio con sus propios perfiles.', ir: () => (db.meta.localHistoricoValladolid ? { ruta: `/campanas?local=${db.meta.localHistoricoValladolid}`, prefs: { municipioId: 'mun-valladolid', campanaId: 'camp-vll-2025' } } : null) },
    { n: 12, t: 'Exportación: mapa y listado', d: 'Hoja de campo A4 del itinerario y Excel (CSV) con la estructura tradicional.', ir: () => (itC ? { ruta: `/imprimir/${itC}`, prefs: MEDINA } : null) },
  ];

  const ir = (e: Escenario) => {
    const r = e.ir();
    if (!r) return;
    if (r.prefs) setPrefs(r.prefs);
    nav(r.ruta);
    if (r.ruta.startsWith('/campo') || r.ruta.startsWith('/imprimir')) onCerrar();
  };

  return (
    <aside className="guia panel-flotante" aria-label="Guion de demostración">
      <div className="guia-cab">
        <div className="esp">
          <div className="rotulo sin-linea">Guion de demostración</div>
          <b>12 escenarios para probar</b>
        </div>
        <button className="btn fantasma icono s" onClick={onCerrar} aria-label="Cerrar"><X size={16} /></button>
      </div>
      <ol className="guia-lista scroll-fino">
        {escenarios.map((e) => (
          <li key={e.n}>
            <button onClick={() => ir(e)}>
              <span className="guia-n mono">{String(e.n).padStart(2, '0')}</span>
              <span className="esp">
                <b>{e.t}</b>
                <span className="muted">{e.d}</span>
              </span>
              <ArrowRight size={15} />
            </button>
          </li>
        ))}
        <li>
          <button onClick={() => { setPrefs({ municipioId: 'mun-medina', campanaId: 'camp-medina-2026' }); nav('/oficina?vista=dudosos'); }}>
            <span className="guia-n mono">+</span>
            <span className="esp"><b>Conciliación dudosa</b><span className="muted">Alta en campo con el mismo número que un local anterior: decide si es el mismo espacio.</span></span>
            <ArrowRight size={15} />
          </button>
        </li>
      </ol>
      <div className="guia-pie">
        <div className="muted" style={{ fontSize: 11.5 }}>
          Callejero: <b>{db.meta.fuenteCallejero === 'simulado' ? 'SIMULADO' : 'OpenStreetMap real'}</b> · {db.meta.detalleCallejero}
        </div>
        <button
          className="btn s"
          onClick={() => {
            if (confirm('Se borrarán los cambios hechos en esta demostración y se volverán a generar los datos (intentando cargar de nuevo el callejero real). ¿Continuar?')) {
              onCerrar();
              inicializar(true);
            }
          }}
        >
          <RotateCcw size={13} /> Restablecer demo
        </button>
      </div>
    </aside>
  );
}
