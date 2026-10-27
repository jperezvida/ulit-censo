import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom no implementa el desplazamiento de elementos (lo usa la tabla virtualizada).
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo(this: Element, a?: ScrollToOptions | number, b?: number) {
    const o = typeof a === 'object' ? a : { left: a, top: b };
    if (o.left !== undefined) (this as HTMLElement).scrollLeft = o.left;
    if (o.top !== undefined) (this as HTMLElement).scrollTop = o.top;
  } as Element['scrollTo'];
}
