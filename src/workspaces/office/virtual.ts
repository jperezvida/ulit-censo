import { observeElementRect, type Virtualizer } from '@tanstack/react-virtual';

/**
 * Observa el tamaño del contenedor virtualizado con un respaldo cuando el navegador informa
 * de alto 0 (pestaña oculta, primer render o entornos de prueba sin maquetación): así
 * siempre se pinta al menos una ventana de filas y el teclado sigue funcionando.
 */
export function observarRectConRespaldo(alto: number, ancho = 1200) {
  return <T extends Element>(instance: Virtualizer<T, Element>, cb: (rect: { width: number; height: number }) => void) =>
    observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : { width: rect.width || ancho, height: alto }));
}
