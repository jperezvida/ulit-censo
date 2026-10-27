import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { EstadoCobertura, FaseEstado, Persona, Procedencia } from '../domain/types';
import { ESTADO_COBERTURA_TXT } from '../domain/consultas';
import { useStore } from '../store/store';

export function Sim({ texto = 'Simulado', title }: { texto?: string; title?: string }) {
  return (
    <span className="chip sim" title={title ?? 'Dato de demostración: no procede de la Cátedra'}>
      {texto}
    </span>
  );
}

export function SelloProcedencia({ p }: { p: Procedencia }) {
  if (p === 'osm') return <span className="chip real" title="Geometría y nombre de OpenStreetMap (ODbL)">OSM real</span>;
  if (p === 'simulado') return <Sim />;
  if (p === 'importado') return <span className="chip">Importado</span>;
  return <span className="chip azul">Manual</span>;
}

export function Avatar({ p, size = 24 }: { p?: Persona; size?: number }) {
  if (!p) return null;
  return (
    <span className="avatar" style={{ background: p.color, width: size, height: size, fontSize: size * 0.4 }} title={`${p.nombre} (persona ficticia)`}>
      {p.iniciales}
    </span>
  );
}

export function Avatares({ personas, size }: { personas: (Persona | undefined)[]; size?: number }) {
  return (
    <span className="avatares">
      {personas.filter(Boolean).map((p) => (
        <Avatar key={p!.id} p={p} size={size} />
      ))}
    </span>
  );
}

export function EstadoCob({ e, corto }: { e: EstadoCobertura; corto?: boolean }) {
  return (
    <span className="fila" style={{ gap: 6 }} title={ESTADO_COBERTURA_TXT[e]}>
      <span className={`marca-cob ${e}`} />
      {!corto && <span style={{ fontSize: 12.5 }}>{ESTADO_COBERTURA_TXT[e]}</span>}
    </span>
  );
}

const FASE_TXT: Record<FaseEstado, string> = { pendiente: 'Pendiente', 'en-curso': 'En curso', terminado: 'Terminado', 'no-aplica': 'No aplica' };
const FASE_CLASE: Record<FaseEstado, string> = { pendiente: '', 'en-curso': 'aviso', terminado: 'ok', 'no-aplica': '' };

export function Fase({ e }: { e: FaseEstado }) {
  return (
    <span className={`chip ${FASE_CLASE[e]}`}>
      <span className="punto" />
      {FASE_TXT[e]}
    </span>
  );
}

export function Barra({ partes, alto = 6 }: { partes: { v: number; color: string; titulo?: string }[]; alto?: number }) {
  const total = Math.max(1, partes.reduce((a, p) => a + p.v, 0));
  return (
    <div className="barra" style={{ height: alto }}>
      {partes.map((p, i) => (
        <span key={i} title={p.titulo} style={{ width: `${(p.v / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}

export function Pct({ v, color = 'var(--azul)', alto = 6 }: { v: number; color?: string; alto?: number }) {
  return (
    <div className="barra" style={{ height: alto }}>
      <span style={{ width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`, background: color }} />
    </div>
  );
}

export function Modal({ titulo, sub, onCerrar, children, pie, ancho }: { titulo: ReactNode; sub?: ReactNode; onCerrar: () => void; children: ReactNode; pie?: ReactNode; ancho?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div className="velo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className={`modal ${ancho ? 'ancho' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-cab">
          <div className="esp">
            <h2>{titulo}</h2>
            {sub && <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{sub}</div>}
          </div>
          <button className="btn fantasma icono" onClick={onCerrar} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="modal-cuerpo scroll-fino">{children}</div>
        {pie && <div className="modal-pie">{pie}</div>}
      </div>
    </div>
  );
}

export function Segmentado<T extends string>({ valor, opciones, onCambio }: { valor: T; opciones: { v: T; t: ReactNode }[]; onCambio: (v: T) => void }) {
  return (
    <div className="segmentado" role="tablist">
      {opciones.map((o) => (
        <button key={o.v} className={o.v === valor ? 'on' : ''} onClick={() => onCambio(o.v)} role="tab" aria-selected={o.v === valor}>
          {o.t}
        </button>
      ))}
    </div>
  );
}

export function Avisos() {
  const avisos = useStore((s) => s.avisos);
  const deshacer = useStore((s) => s.deshacer);
  const quitar = useStore((s) => s.quitarAviso);
  return (
    <div className="toasts" aria-live="polite">
      {avisos.map((a) => (
        <div key={a.id} className={`toast ${a.tipo}`}>
          <span>{a.texto}</span>
          {a.deshacer && (
            <button
              onClick={() => {
                deshacer();
                quitar(a.id);
              }}
            >
              Deshacer
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function Metrica({ etq, valor, sub }: { etq: ReactNode; valor: ReactNode; sub?: ReactNode }) {
  return (
    <div className="metrica">
      <div className="metrica-etq">{etq}</div>
      <div className="metrica-v num">{valor}</div>
      {sub && <div className="metrica-sub">{sub}</div>}
    </div>
  );
}

export const fmt = (n: number) => n.toLocaleString('es-ES');
export const fmtFecha = (s?: string) => (s ? new Date(s).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : 'fecha no disponible');
