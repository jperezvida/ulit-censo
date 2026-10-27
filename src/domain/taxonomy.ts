import type { Id, NodoActividad } from './types';
import { COMERCIO_2026, EXCEPCIONES_ICM, GRUPOS_2026, HOSTELERIA_2026, ID_CATALOGO_2026, SERVICIOS_2026 } from './catalogo2026';

/**
 * Clasificación comercial PROVISIONAL de cuatro niveles.
 * Grupo de actividad › Grupo de comercio › Subgrupo de actividad › Actividad.
 *
 * ⚠️ Terminología de demostración. Debe sustituirse por la estructura y los
 * literales del censo original cuando se proporcionen (se importará con la misma forma).
 */
const ARBOL: [string, [string, [string, string[]][]][]][] = [
  ['Comercio', [
    ['Alimentación', [
      ['Alimentación general', ['Supermercado', 'Ultramarinos', 'Tienda de conveniencia']],
      ['Alimentación especializada', ['Carnicería', 'Panadería', 'Frutería', 'Pescadería', 'Pastelería']],
    ]],
    ['Equipamiento personal', [
      ['Moda y complementos', ['Moda mujer', 'Moda hombre', 'Moda infantil', 'Complementos']],
      ['Calzado y marroquinería', ['Zapatería', 'Marroquinería']],
      ['Joyería y óptica', ['Joyería', 'Óptica']],
    ]],
    ['Equipamiento del hogar', [
      ['Muebles y decoración', ['Muebles', 'Decoración', 'Iluminación']],
      ['Ferretería y bricolaje', ['Ferretería', 'Droguería']],
      ['Electrodomésticos y electrónica', ['Electrodomésticos', 'Telefonía']],
    ]],
    ['Otro comercio', [
      ['Salud y cuidado', ['Farmacia', 'Parafarmacia', 'Perfumería']],
      ['Cultura y ocio', ['Librería-papelería', 'Juguetería', 'Floristería']],
      ['Estancos y prensa', ['Estanco', 'Quiosco']],
    ]],
  ]],
  ['Servicios', [
    ['Servicios personales', [
      ['Cuidado personal', ['Peluquería', 'Estética', 'Barbería']],
      ['Salud', ['Clínica dental', 'Fisioterapia', 'Veterinaria']],
    ]],
    ['Servicios profesionales', [
      ['Inmobiliaria y seguros', ['Inmobiliaria', 'Seguros']],
      ['Gestión y asesoría', ['Gestoría', 'Asesoría', 'Autoescuela']],
    ]],
    ['Servicios financieros', [
      ['Banca', ['Oficina bancaria', 'Cajero']],
    ]],
  ]],
  ['Hostelería', [
    ['Restauración', [
      ['Bares y cafeterías', ['Bar', 'Cafetería']],
      ['Restaurantes', ['Restaurante', 'Comida para llevar']],
    ]],
    ['Alojamiento', [
      ['Alojamiento', ['Hotel', 'Hostal']],
    ]],
  ]],
];

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Catálogo FICTICIO de demostración (campañas sin catálogo oficial y datos 2025 simulados). */
export const ID_CATALOGO_DEMO = 'demo';

const TAXONOMIA_DEMO: NodoActividad[] = (() => {
  const out: NodoActividad[] = [];
  const codigos: Record<string, string> = { Comercio: 'C', Servicios: 'S', 'Hostelería': 'H' };
  for (const [g1, n2] of ARBOL) {
    const id1 = `a1-${slug(g1)}`;
    out.push({ id: id1, nivel: 1, nombre: g1, catalogo: ID_CATALOGO_DEMO, codigo: codigos[g1] });
    for (const [g2, n3] of n2) {
      const id2 = `${id1}.${slug(g2)}`;
      out.push({ id: id2, nivel: 2, nombre: g2, padreId: id1, catalogo: ID_CATALOGO_DEMO });
      for (const [g3, n4] of n3) {
        const id3 = `${id2}.${slug(g3)}`;
        out.push({ id: id3, nivel: 3, nombre: g3, padreId: id2, catalogo: ID_CATALOGO_DEMO });
        for (const g4 of n4) out.push({ id: `${id3}.${slug(g4)}`, nivel: 4, nombre: g4, padreId: id3, catalogo: ID_CATALOGO_DEMO });
      }
    }
  }
  return out;
})();

/** Palabras clave a partir de un texto del documento: «Pañuelos, bisutería, …, etc.» → [pañuelos, bisutería, …]. */
export function clavesDeTexto(t?: string): string[] {
  if (!t) return [];
  return t
    .split(/[,/;]|\s+y\s+|\.\.\.|…/)
    .map((x) => x.replace(/\betc\.?/gi, '').replace(/[().]/g, ' ').trim())
    .filter((x) => x.length > 1);
}

/** Catálogo oficial 2026 como nodos (ids con prefijo «c26.»). */
const TAXONOMIA_2026: NodoActividad[] = (() => {
  const out: NodoActividad[] = [];
  const C = ID_CATALOGO_2026;
  const sub = (padre: NodoActividad, sg: (typeof HOSTELERIA_2026)[number]) => {
    const n: NodoActividad = {
      id: `${padre.id}.${slug(sg.nombre)}`, nivel: 3, nombre: sg.nombre, padreId: padre.id, catalogo: C,
      ejemplos: sg.ejemplos ?? sg.ejemplosExcepcion, claves: [...(sg.ejemplos ?? []), ...(sg.ejemplosExcepcion ?? [])],
    };
    out.push(n);
    for (const [nombre, desc] of sg.actividades ?? []) {
      out.push({ id: `${n.id}.${slug(nombre)}`, nivel: 4, nombre, padreId: n.id, catalogo: C, descripcion: desc, claves: clavesDeTexto(desc) });
    }
  };
  const g = Object.fromEntries(GRUPOS_2026.map((x) => [x.codigo, { id: `c26.${x.codigo}`, nivel: 1 as const, nombre: x.nombre, catalogo: C, codigo: x.codigo }]));
  out.push(g.C);
  for (const gc of COMERCIO_2026) {
    const n: NodoActividad = { id: `c26.C.${gc.codigo}`, nivel: 2, nombre: gc.nombre, padreId: g.C.id, catalogo: C, codigo: gc.codigo };
    out.push(n);
    for (const sg of gc.subgrupos) sub(n, sg);
  }
  out.push(g.H);
  for (const sg of HOSTELERIA_2026) sub(g.H, sg);
  out.push(g.S);
  for (const sg of SERVICIOS_2026) sub(g.S, sg);
  // Excepciones ICM: palabras clave del destino (o del subgrupo si el documento no indica actividad).
  for (const e of EXCEPCIONES_ICM) {
    const destino = out.find((n) => {
      const ruta: string[] = [];
      let x: NodoActividad | undefined = n;
      while (x) {
        ruta.unshift(x.nombre);
        x = x.padreId ? out.find((y) => y.id === x!.padreId) : undefined;
      }
      return ruta.join('|') === e.destino.join('|');
    });
    if (!destino) throw new Error(`Excepción ICM sin destino en el catálogo: ${e.producto}`);
    destino.claves = [...new Set([...(destino.claves ?? []), ...e.claves])];
    destino.excepcion = `${e.producto}: ${e.nota}`;
  }
  return out;
})();

export const TAXONOMIA: NodoActividad[] = [...TAXONOMIA_DEMO, ...TAXONOMIA_2026];
export const NODOS_2026 = TAXONOMIA_2026;
export const TAXONOMIA_POR_ID: Record<Id, NodoActividad> = Object.fromEntries(TAXONOMIA.map((n) => [n.id, n]));

export const NIVELES_ACTIVIDAD = ['Grupo de actividad', 'Grupo de comercio', 'Subgrupo de actividad', 'Actividad'] as const;

/** Actividades (cuarto nivel) del catálogo de DEMOSTRACIÓN. */
export const ACTIVIDADES_HOJA = TAXONOMIA_DEMO.filter((n) => n.nivel === 4);

/** Ruta completa [nivel1, nivel2, nivel3, nivel4] de un nodo. */
export function rutaActividad(id?: Id): NodoActividad[] {
  const ruta: NodoActividad[] = [];
  let n = id ? TAXONOMIA_POR_ID[id] : undefined;
  while (n) {
    ruta.unshift(n);
    n = n.padreId ? TAXONOMIA_POR_ID[n.padreId] : undefined;
  }
  return ruta;
}

const HIJOS = new Map<Id, NodoActividad[]>();
for (const n of TAXONOMIA) if (n.padreId) HIJOS.set(n.padreId, [...(HIJOS.get(n.padreId) ?? []), n]);

/** Hijos de un nodo; sin padre, los grupos del catálogo indicado (por defecto el de demostración). */
export function hijosDe(padreId?: Id, catalogo: string = ID_CATALOGO_DEMO): NodoActividad[] {
  return padreId ? HIJOS.get(padreId) ?? [] : TAXONOMIA.filter((n) => n.nivel === 1 && n.catalogo === catalogo);
}

/** Niveles de una clasificación según el tipo de nodo (no todos los grupos tienen los cuatro). */
export function nivelesDe(id?: Id): { grupo?: NodoActividad; grupoComercio?: NodoActividad; subgrupo?: NodoActividad; actividad?: NodoActividad } {
  const out: ReturnType<typeof nivelesDe> = {};
  for (const n of rutaActividad(id)) {
    if (n.nivel === 1) out.grupo = n;
    else if (n.nivel === 2) out.grupoComercio = n;
    else if (n.nivel === 3) out.subgrupo = n;
    else out.actividad = n;
  }
  return out;
}

export function catalogoDeNodo(id?: Id): string | undefined {
  return id ? TAXONOMIA_POR_ID[id]?.catalogo : undefined;
}

export function grupoActividad(id?: Id): NodoActividad | undefined {
  return rutaActividad(id)[0];
}

/** Búsqueda exacta por nombre en el catálogo de DEMOSTRACIÓN (importaciones ficticias). */
export function buscarActividadPorNombre(nombre: string): NodoActividad | undefined {
  const s = slug(nombre);
  return ACTIVIDADES_HOJA.find((n) => slug(n.nombre) === s);
}

export const COLOR_GRUPO: Record<string, string> = {
  'a1-comercio': '#0065FE',
  'a1-servicios': '#C2255C',
  'a1-hosteleria': '#D9730D',
  'c26.C': '#0065FE',
  'c26.S': '#C2255C',
  'c26.H': '#D9730D',
};

/**
 * Grupo de actividad CANÓNICO (por código C/H/S) para comparar campañas que usan catálogos
 * distintos (p. ej. 2025 de demostración y 2026 oficial).
 */
export const GRUPOS_CANONICOS = [
  { codigo: 'C', nombre: 'Comercio', color: '#0065FE' },
  { codigo: 'H', nombre: 'Hostelería y Restauración', color: '#D9730D' },
  { codigo: 'S', nombre: 'Servicios', color: '#C2255C' },
] as const;
export function grupoCanonico(id?: Id): (typeof GRUPOS_CANONICOS)[number] | undefined {
  const g = rutaActividad(id)[0];
  return GRUPOS_CANONICOS.find((x) => x.codigo === g?.codigo);
}

/** Actividades (último nivel) del catálogo oficial 2026. */
export const ACTIVIDADES_2026 = TAXONOMIA_2026.filter((n) => n.nivel === 4);
