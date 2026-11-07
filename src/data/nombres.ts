import type { Rng } from './rng';

/** Nombres comerciales FICTICIOS para la demostración. */
const COMPLEMENTOS = [
  'Alba', 'El Nogal', 'La Plaza', 'Castilla', 'Lucía', 'El Arco', 'Sol', 'Mayor', 'Hermanos Gil', 'Duero', 'Norte', 'El Rincón',
  'Central', 'Delia', 'Marcos', 'Isabel', 'La Esquina', 'Verde', 'Real', 'Aurora', 'Las Torres', 'Zapardiel', 'Victoria', 'Carmen',
  'El Mirador', 'Nuevo Estilo', 'Tres Hermanos', 'La Feria', 'El Puente', 'Olmedo', 'Laura', 'Teresa', 'San Antón', 'La Villa',
];

const PREFIJO: Record<string, string[]> = {
  Supermercado: ['Supermercado', 'Súper'],
  Ultramarinos: ['Ultramarinos', 'Comestibles'],
  'Tienda de conveniencia': ['Alimentación', 'Tienda 24h'],
  Carnicería: ['Carnicería', 'Carnes'],
  Panadería: ['Panadería', 'Horno'],
  Frutería: ['Frutería', 'Frutas'],
  Pescadería: ['Pescadería', 'Pescados'],
  Pastelería: ['Pastelería', 'Confitería'],
  'Moda mujer': ['Boutique', 'Moda'],
  'Moda hombre': ['Moda hombre', 'Sastrería'],
  'Moda infantil': ['Moda infantil', 'Peques'],
  Complementos: ['Complementos', 'Bisutería'],
  Zapatería: ['Zapatería', 'Calzados'],
  Marroquinería: ['Marroquinería', 'Bolsos'],
  Joyería: ['Joyería', 'Relojería'],
  Óptica: ['Óptica', 'Centro óptico'],
  Muebles: ['Muebles', 'Mobiliario'],
  Decoración: ['Decoración', 'Hogar'],
  Iluminación: ['Iluminación', 'Lámparas'],
  Ferretería: ['Ferretería', 'Suministros'],
  Droguería: ['Droguería', 'Limpieza'],
  Electrodomésticos: ['Electrodomésticos', 'Electro'],
  Telefonía: ['Telefonía', 'Móviles'],
  Farmacia: ['Farmacia'],
  Parafarmacia: ['Parafarmacia'],
  Perfumería: ['Perfumería'],
  'Librería-papelería': ['Librería', 'Papelería'],
  Juguetería: ['Juguetes', 'Juguetería'],
  Floristería: ['Floristería', 'Flores'],
  Estanco: ['Estanco nº'],
  Quiosco: ['Quiosco', 'Prensa'],
  Peluquería: ['Peluquería', 'Salón'],
  Estética: ['Centro de estética', 'Estética'],
  Barbería: ['Barbería'],
  'Clínica dental': ['Clínica dental'],
  Fisioterapia: ['Fisioterapia'],
  Veterinaria: ['Clínica veterinaria'],
  Inmobiliaria: ['Inmobiliaria'],
  Seguros: ['Seguros', 'Correduría'],
  Gestoría: ['Gestoría'],
  Asesoría: ['Asesoría'],
  Autoescuela: ['Autoescuela'],
  'Oficina bancaria': ['Banco Demo', 'Caja Demo'],
  Cajero: ['Cajero Demo'],
  Bar: ['Bar', 'Taberna'],
  Cafetería: ['Cafetería', 'Café'],
  Restaurante: ['Restaurante', 'Mesón', 'Asador'],
  'Comida para llevar': ['Comidas', 'Pizzería'],
  Hotel: ['Hotel'],
  Hostal: ['Hostal'],
};

export function nombreNegocio(rng: Rng, actividad: string): string {
  const p = rng.pick(PREFIJO[actividad] ?? [actividad]);
  if (p === 'Estanco nº') return `Estanco nº ${rng.int(1, 9)}`;
  return `${p} ${rng.pick(COMPLEMENTOS)}`;
}

export const CADENAS_FICTICIAS = ['Cadena Demo Norte', 'Franquicia Demo Sur', 'Grupo Demo Centro'];

export function slugRed(nombre: string): string {
  return nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 22);
}

const ARBOLES = ['Tilos', 'Mirlo', 'Jilguero', 'Sauce', 'Encina', 'Roble', 'Acebo', 'Brezo', 'Retama', 'Espliego', 'Tomillo', 'Romero', 'Cierzo', 'Ábrego', 'Solano', 'Lucero', 'Cometa', 'Veleta', 'Atalaya', 'Cantueso', 'Majuelo', 'Endrino', 'Serbal', 'Quejigo', 'Alcotán', 'Abubilla'];
const CALIF = ['', ' Alta', ' Baja', ' Nueva', ' Vieja'];

/** Nombres de calle FICTICIOS para el municipio de demostración de volumen. */
export function nombresCallesFicticias(n: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (out.length < n) {
    const a = ARBOLES[i % ARBOLES.length];
    const c = CALIF[Math.floor(i / ARBOLES.length) % CALIF.length];
    const t = i % 9 === 0 ? 'Avenida' : i % 13 === 0 ? 'Plaza' : 'Calle';
    out.push(`${t} del ${a}${c}`);
    i++;
  }
  return out;
}
