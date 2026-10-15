import type { Id, NodoActividad } from './types';

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

export const TAXONOMIA: NodoActividad[] = (() => {
  const out: NodoActividad[] = [];
  for (const [g1, n2] of ARBOL) {
    const id1 = `a1-${slug(g1)}`;
    out.push({ id: id1, nivel: 1, nombre: g1 });
    for (const [g2, n3] of n2) {
      const id2 = `${id1}.${slug(g2)}`;
      out.push({ id: id2, nivel: 2, nombre: g2, padreId: id1 });
      for (const [g3, n4] of n3) {
        const id3 = `${id2}.${slug(g3)}`;
        out.push({ id: id3, nivel: 3, nombre: g3, padreId: id2 });
        for (const g4 of n4) out.push({ id: `${id3}.${slug(g4)}`, nivel: 4, nombre: g4, padreId: id3 });
      }
    }
  }
  return out;
})();

export const TAXONOMIA_POR_ID: Record<Id, NodoActividad> = Object.fromEntries(TAXONOMIA.map((n) => [n.id, n]));

export const NIVELES_ACTIVIDAD = ['Grupo de actividad', 'Grupo de comercio', 'Subgrupo de actividad', 'Actividad'] as const;

export const ACTIVIDADES_HOJA = TAXONOMIA.filter((n) => n.nivel === 4);

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

export function hijosDe(padreId?: Id): NodoActividad[] {
  return TAXONOMIA.filter((n) => (padreId ? n.padreId === padreId : n.nivel === 1));
}

export function grupoActividad(id?: Id): NodoActividad | undefined {
  return rutaActividad(id)[0];
}

export function buscarActividadPorNombre(nombre: string): NodoActividad | undefined {
  const s = slug(nombre);
  return ACTIVIDADES_HOJA.find((n) => slug(n.nombre) === s);
}

export const COLOR_GRUPO: Record<string, string> = {
  'a1-comercio': '#0065FE',
  'a1-servicios': '#8B5CF6',
  'a1-hosteleria': '#E8590C',
};
