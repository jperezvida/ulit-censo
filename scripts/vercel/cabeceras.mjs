/**
 * Cabeceras HTTP de la vista previa de ULIT Censo (única fuente: las usan el despliegue en Vercel y el
 * servidor local de comprobación).
 *
 * La Content-Security-Policy hace que el NAVEGADOR impida enviar o cargar nada fuera del propio sitio,
 * salvo las teselas del mapa base (OpenFreeMap: solo coordenadas de tesela, nunca datos del censo).
 * Así, aunque se analice el Excel real en el navegador, su contenido no puede salir a servicios externos:
 * no hay analítica, ni barras de herramientas inyectadas, ni scripts de terceros, ni formularios.
 */
export const ORIGENES_EXTERNOS = ['https://tiles.openfreemap.org'];

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${ORIGENES_EXTERNOS.join(' ')}`,
  "font-src 'self' data:",
  `connect-src 'self' ${ORIGENES_EXTERNOS.join(' ')}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const CABECERAS = {
  'Content-Security-Policy': CSP,
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
};

/** Sin caché para lo que identifica la versión: una entrega nueva se ve al recargar. */
export const SIN_CACHE = ['/', '/index.html', '/version.json'];
