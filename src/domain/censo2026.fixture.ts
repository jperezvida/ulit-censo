import type { FilaSintetica } from '../data/xlsxItinerarios';

/** Censo 2025 SINTÉTICO: sin Olmo 1 (será alta en 2026), Olmo 7 con otro nombre, y Real 8, que IT1 de 2026 no recoge. */
export const FILAS_2025: FilaSintetica[] = [
  { calle: 'Calle del Olmo', num: 3, nombre: 'PANADERÍA SINTÉTICA', fecha: '2025-03-02' },
  { calle: 'Calle del Olmo', num: 3, nombre: 'PELUQUERÍA SINTÉTICA', fecha: '2025-03-02' },
  { calle: 'Calle del Olmo', num: 5, vacio: true, fachada: 6.5, fecha: '2025-03-03' },
  { calle: 'Calle del Olmo', num: 7, nombre: 'DROGUERÍA SINTÉTICA', fecha: '2025-03-03' },
  { calle: 'Calle Real', num: 2, nombre: 'ESTANCO SINTÉTICO', fecha: '2025-03-04' },
  { calle: 'Calle Real', num: 8, nombre: 'ZAPATERÍA SINTÉTICA', fecha: '2025-03-04' },
];
