/** Normalización de nombres para comparar calles y negocios entre fuentes. */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,;:'"`´()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PREFIJOS_VIA = [
  'calle', 'c', 'cl', 'c/', 'avenida', 'av', 'avda', 'plaza', 'pl', 'pza', 'paseo', 'pº', 'po', 'travesia', 'trv',
  'ronda', 'camino', 'carretera', 'ctra', 'callejon', 'pasaje', 'glorieta', 'costanilla', 'cuesta', 'rua',
];
const ARTICULOS = ['de', 'del', 'la', 'las', 'el', 'los'];

/** Clave de calle: sin tipo de vía ni artículos iniciales ("C/ de los Mostenes" → "mostenes"). */
export function claveCalle(nombre: string): string {
  let palabras = normalizar(nombre.replace(/\//g, ' / ')).split(' ').filter((w) => w && w !== '/');
  if (palabras.length > 1 && PREFIJOS_VIA.includes(palabras[0])) palabras = palabras.slice(1);
  while (palabras.length > 1 && ARTICULOS.includes(palabras[0])) palabras = palabras.slice(1);
  return palabras.join(' ');
}

/** Similitud 0..1 basada en bigramas (Dice). Suficiente para proponer, nunca para decidir. */
export function similitud(a: string, b: string): number {
  const x = normalizar(a).replace(/\s/g, '');
  const y = normalizar(b).replace(/\s/g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigramas = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const bx = bigramas(x);
  const by = bigramas(y);
  let inter = 0;
  for (const [k, v] of bx) inter += Math.min(v, by.get(k) ?? 0);
  return (2 * inter) / (x.length - 1 + y.length - 1 || 1);
}

export function tipoVia(nombre: string): string {
  const p = normalizar(nombre).split(' ')[0];
  if (['avenida', 'av', 'avda'].includes(p)) return 'Avenida';
  if (['plaza', 'pl', 'pza'].includes(p)) return 'Plaza';
  if (['paseo', 'po'].includes(p)) return 'Paseo';
  if (['travesia', 'trv'].includes(p)) return 'Travesía';
  if (['ronda'].includes(p)) return 'Ronda';
  if (['camino'].includes(p)) return 'Camino';
  if (['carretera', 'ctra'].includes(p)) return 'Carretera';
  return 'Calle';
}
