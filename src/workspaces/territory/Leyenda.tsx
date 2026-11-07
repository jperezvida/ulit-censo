import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Capa } from './capas';
import { COLOR_GRUPO, TAXONOMIA } from '../../domain/taxonomy';

export function Leyenda({ capa }: { capa: Capa }) {
  const [abierta, setAbierta] = useState(true);
  return (
    <div className="t-leyenda panel-flotante">
      <button className="t-leyenda-cab" onClick={() => setAbierta(!abierta)}>
        <span className="rotulo sin-linea">Leyenda · {capa === 'plan' ? 'planificación' : capa === 'cobertura' ? 'cobertura territorial' : 'actividad comercial'}</span>
        {abierta ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {abierta && (
        <div className="t-leyenda-cuerpo">
          {capa === 'plan' && (
            <>
              <Linea color="var(--azul)" t="Asignada (color del itinerario)" />
              <Linea color="#5f6f86" dash t="En el ámbito, sin asignar" />
              <Linea color="#e03131" t="Solape entre itinerarios" />
              <Linea color="#aab4c3" t="Fuera del ámbito" fino />
              <Linea color="#8a97ab" puntos t="Sin locales anteriores (punteado blanco)" />
            </>
          )}
          {capa === 'cobertura' && (
            <>
              <Linea color="#8a97ab" dash t="Pendiente" />
              <Linea color="#f59f00" t="En curso" />
              <Linea color="#12a873" t="Completada con locales" />
              <Linea color="#0b9aa8" dash fino2 t="Completada sin locales" />
              <Linea color="#f0563a" dash t="Parcial / incidencias" />
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>La cobertura se declara al finalizar cada calle; no se deduce del nº de locales.</p>
            </>
          )}
          {capa === 'actividad' && (
            <>
              {TAXONOMIA.filter((n) => n.nivel === 1).map((n) => (
                <Punto key={n.id} color={COLOR_GRUPO[n.id]} t={n.nombre} />
              ))}
              <Punto color="#fff" borde="#5c6b80" t="Vacío" />
              <Punto color="#fff" borde="#ae3ec9" t="Dudoso / posible desaparición" />
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 11 }}>Opaco: comprobado en esta campaña · translúcido: dato anterior. Pulsa un punto para ver la ficha.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Linea({ color, t, dash, fino, puntos, fino2 }: { color: string; t: string; dash?: boolean; fino?: boolean; puntos?: boolean; fino2?: boolean }) {
  const bg = dash
    ? `repeating-linear-gradient(90deg, ${color} 0 ${fino2 ? 3 : 7}px, transparent ${fino2 ? 3 : 7}px ${fino2 ? 6 : 11}px)`
    : puntos
      ? `radial-gradient(circle, #fff 1.4px, transparent 1.6px) 0 50% / 7px 5px repeat-x, ${color}`
      : color;
  return (
    <div className="fila" style={{ gap: 8, fontSize: 12 }}>
      <span style={{ width: 26, height: fino ? 2 : 5, borderRadius: 3, background: bg, flex: 'none' }} />
      {t}
    </div>
  );
}
function Punto({ color, t, borde = '#fff' }: { color: string; t: string; borde?: string }) {
  return (
    <div className="fila" style={{ gap: 8, fontSize: 12 }}>
      <span style={{ width: 11, height: 11, borderRadius: '50%', background: color, border: `2px solid ${borde}`, boxShadow: '0 0 0 1px #c9d1dd', flex: 'none', margin: '0 7px' }} />
      {t}
    </div>
  );
}
