import { useEffect, useRef, useState } from 'react';
import { Map as MLMap, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';

// Worker de MapLibre servido tal cual desde public/maplibre (ver scripts/copiar-maplibre.mjs).
setWorkerUrl(new URL('maplibre/maplibre-gl-worker.mjs', document.baseURI).href);
import { estiloBase } from './estilo';
import type { LngLat } from '../../domain/types';

/**
 * Contenedor del mapa. Si el mapa base no carga (sin red), las capas propias
 * del censo se siguen dibujando sobre el fondo neutro.
 */
export function MapaBase({
  centro, zoom = 15, onListo, className, interactivo = true, preservarDibujo = false,
}: {
  centro: LngLat;
  zoom?: number;
  onListo: (m: MLMap) => void;
  className?: string;
  interactivo?: boolean;
  preservarDibujo?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sinBase, setSinBase] = useState(false);
  const listo = useRef(onListo);
  listo.current = onListo;

  useEffect(() => {
    if (!ref.current) return;
    let mapa: MLMap | undefined;
    try {
      mapa = new MLMap({
        container: ref.current,
        style: estiloBase(),
        center: centro,
        zoom,
        attributionControl: { compact: true },
        interactive: interactivo,
        canvasContextAttributes: { preserveDrawingBuffer: preservarDibujo },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch (e) {
      console.warn('Mapa no disponible', e);
      setSinBase(true);
      return;
    }
    if (interactivo) mapa.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    mapa.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    let errores = 0;
    mapa.on('error', () => {
      errores++;
      if (errores > 3) setSinBase(true);
    });
    // «style.load» basta para añadir capas propias y no depende de que carguen las teselas remotas.
    let iniciado = false;
    const iniciar = () => {
      if (iniciado) return;
      iniciado = true;
      listo.current(mapa!);
    };
    mapa.once('style.load', iniciar);
    mapa.once('load', iniciar);
    return () => mapa?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`mapa ${className ?? ''}`}>
      <div ref={ref} className="mapa-lienzo" />
      {sinBase && (
        <div className="mapa-sin-base" title="El navegador no pudo cargar las teselas de OpenFreeMap">
          Mapa base no disponible · se muestran solo las capas del censo
        </div>
      )}
    </div>
  );
}
