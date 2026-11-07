/**
 * Catálogo oficial `clasificacion-2026@v1`.
 *
 * Fuente ÚNICA: documento de procedimiento «Clasificación Censo 2026» de la Cátedra (transcrito
 * literalmente; el documento no se incorpora al repositorio). NO procede de las clasificaciones del
 * censo 2025, que contienen errores. Cuando el documento contradice las listas antiguas de `Hoja1`,
 * prevalece el documento; las ambigüedades reales se registran en DISCREPANCIAS_2026 para que las
 * resuelva la Cátedra, sin inventar categorías ni relaciones.
 *
 * Estructura por grupo de actividad (no siempre cuatro niveles):
 *  - Comercio (C): grupo › grupo de comercio › subgrupo › actividad.
 *  - Hostelería y Restauración (H): grupo › subgrupo › actividad (Discotecas: sin actividad).
 *  - Servicios (S): grupo › subgrupo, con una descripción de la actividad cuando corresponda.
 *    La columna «Actividad» del documento enumera EJEMPLOS («etc.»), no una lista cerrada.
 * En cualquier grupo, si el establecimiento no encaja en una actividad, se admite una breve
 * descripción dentro del subgrupo («Actividad y si no se ajusta a ninguna, breve descripción»).
 */

export const ID_CATALOGO_2026 = 'clasificacion-2026@v1';

/** Actividad: [nombre, descripción del documento (opcional)] */
type Act = [string, string?];
interface Sub {
  nombre: string;
  actividades?: Act[];
  /** Servicios: ejemplos de actividad del documento (se ofrecen como descripción). */
  ejemplos?: string[];
  /** Excepciones ICM asignadas a este subgrupo sin actividad concreta (véase EXCEPCIONES_ICM). */
  ejemplosExcepcion?: string[];
}
interface GrupoComercio {
  codigo: string;
  nombre: string;
  subgrupos: Sub[];
}

export const GRUPOS_2026 = [
  { codigo: 'C', nombre: 'Comercio' },
  { codigo: 'H', nombre: 'Hostelería y Restauración' },
  { codigo: 'S', nombre: 'Servicios' },
] as const;

export const COMERCIO_2026: GrupoComercio[] = [
  {
    codigo: 'A', nombre: 'Alimentación',
    subgrupos: [
      { nombre: 'Carnes', actividades: [['Carnicería'], ['Charcutería'], ['Pollería'], ['Casquería']] },
      { nombre: 'Pescados y mariscos', actividades: [['Pescadería'], ['Marisco']] },
      { nombre: 'Fruta y verdura', actividades: [['Frutería']] },
      { nombre: 'Pan y Lácteos', actividades: [['Panadería'], ['Pastelería'], ['Heladería'], ['Quesería']] },
      {
        nombre: 'Alimentación Seca',
        actividades: [
          ['Comida preparada'], ['Congelados'], ['Golosinas'], ['Productos delicatesen'],
          ['Ultramarinos', 'Conservas / Encurtidos y frutos secos'],
          ['Bebidas', 'Vinotecas / Cervezas / Cafés / Tés, etc.'],
          ['Dietética', 'Herbolarios / Tiendas especializadas, alergias, etc.'],
        ],
      },
      { nombre: 'Gran establecimiento', actividades: [['Supermercados', 'Menos de 2.500 metros cuadrados'], ['Hipermercados', 'Más de 2.500 metros cuadrados']] },
    ],
  },
  {
    codigo: 'EP', nombre: 'Equipamiento Personal',
    subgrupos: [
      {
        nombre: 'Ropa',
        actividades: [
          ['Moda', 'Moda en general, peletería, etc.'], ['Moda Hombre'], ['Moda Mujer'], ['Moda deportiva'], ['Moda infantil y bebé'],
          ['Mercería y lencería'], ['Segunda mano'], ['Trabajo'], ['Ceremonia'],
        ],
      },
      { nombre: 'Calzado', actividades: [['Calzado'], ['Calzado Hombre'], ['Calzado Mujer'], ['Calzado infantil']] },
      {
        nombre: 'Complementos',
        actividades: [['Accesorios', 'Pañuelos, bisutería, cinturones, bolsos, accesorios y fundas de móvil'], ['Joyerías']],
        ejemplosExcepcion: ['Artículos de viaje de cuero o imitación de cuero'],
      },
    ],
  },
  {
    codigo: 'EH', nombre: 'Equipamiento del Hogar',
    subgrupos: [
      { nombre: 'Electrodomésticos', actividades: [['Electrodomésticos', 'Tiendas de pequeño y gran electrodoméstico']] },
      { nombre: 'Mobiliario', actividades: [['Mobiliario', 'Muebles de hogar, de cocina y baño']] },
      { nombre: 'Ropa del hogar', actividades: [['Ropa del hogar', 'Cortinas, alfombras, toallas, ropa de cama, etc.']] },
      {
        nombre: 'Materiales de construcción',
        actividades: [['Cristalerías'], ['Puertas y ventanas'], ['Materiales de obra', 'Yesos, cementos, escayolas, aislantes, etc.'], ['Revestimientos', 'Parqué, azulejos, baldosas, pinturas, papel pintado, etc.']],
      },
      { nombre: 'Iluminación y electricidad', actividades: [['Iluminación y electricidad', 'Lámparas, material eléctrico, etc.']] },
      { nombre: 'Decoración y enmarcación', actividades: [['Decoración y enmarcación', 'Cuadros, láminas, enmarcación, decoración etc.']] },
      { nombre: 'Bricolaje y ferreterías', actividades: [['Bricolaje y ferreterías', 'Bricolaje, ferretería, toldos y persianas, etc.']] },
      { nombre: 'Bazar y menaje', actividades: [['Bazar', 'Menaje de hogar, bazar tradicional, chino, cuchillerías,...']] },
    ],
  },
  {
    codigo: 'OE', nombre: 'Otros equipamientos',
    subgrupos: [
      { nombre: 'Vehículos y maquinaria', actividades: [['Concesionarios', 'Concesionarios de coches, motos'], ['Repuestos'], ['Maquinaria', 'Maquinaria agrícola e industrial'], ['Bicis y patinetes']] },
      {
        nombre: 'Perfumería y droguería',
        actividades: [['Perfumería y cosmética', 'Perfumería, productos cosméticos, jabones'], ['Droguería', 'Productos de limpieza'], ['Artículos peluquería', 'Productos de peluquería profesional']],
      },
      { nombre: 'Estancos', actividades: [['Estancos']] },
      { nombre: 'Salud', actividades: [['Farmacias'], ['Ortopedias', 'Ortopedias, Bazares geriátricos'], ['Ópticas'], ['Audífonos']] },
      {
        nombre: 'Ocio',
        actividades: [
          ['Floristería y jardinería', 'Floristerías y artículos para jardín'],
          ['Jugueterías', 'Jugueterías / Tiendas de juegos especializadas, etc.'],
          ['Papelería, prensa y librería', 'Papelerías, librerías, quioscos, Copisterías'],
          ['Coleccionismo', 'Artículos de colección y segunda mano, antigüedades, galerías de arte'],
          ['Música', 'Instrumentos, partituras, cd´s y música reproducible, etc.'],
          ['Informática', 'Ordenadores y material informático'],
          ['Fotografía y audiovisual'],
        ],
      },
      { nombre: 'Otros bienes', actividades: [['Regalos'], ['Mascotas', 'Mascotas, accesorios y comida'], ['Oficina', 'Muebles y equipamiento'], ['Otros', 'Sex-shop, Tienda de productos de cannabis legal, etc.']] },
      // En el documento figura dentro de la tabla de «Otros equipamientos» (véase DISCREPANCIAS_2026).
      { nombre: 'Grandes Almacenes', actividades: [['Corte Inglés']] },
    ],
  },
];

export const HOSTELERIA_2026: Sub[] = [
  { nombre: 'Bares y cafeterías', actividades: [['Bar'], ['Cafetería'], ['Taberna'], ['Bodega'], ['Chocolatería'], ['Pub'], ['Otros', 'Bar musical, karaoke']] },
  { nombre: 'Restaurantes', actividades: [['Tradicional'], ['Comida rápida', 'Hamburguesería, Pizzería, Kebab'], ['Internacional', 'Italiano, japonés, griego, chino, etc.'], ['Otros'], ['Catering']] },
  { nombre: 'Hoteles y hospedaje', actividades: [['Hotel'], ['Hostal'], ['Pensión'], ['B&B'], ['Residencia estudiantil'], ['Albergue'], ['Pisos turísticos']] },
  { nombre: 'Discotecas' },
];

/** Servicios: subgrupo y EJEMPLOS de actividad tal como figuran en el documento. */
export const SERVICIOS_2026: Sub[] = [
  { nombre: 'Banca y finanzas', ejemplos: ['Bancos', 'Servicios financieros'] },
  {
    nombre: 'Servicios médicos',
    ejemplos: ['Consultas médicas', 'Clínica dental', 'Fisioterapia', 'Podología', 'Nutrición', 'Cirugía estética', 'Psicotécnicos carnets de conducir', 'Psicología', 'Logopedia', 'Residencias de ancianos'],
  },
  {
    nombre: 'Otros servicios profesionales',
    ejemplos: ['Asesorías', 'Abogados', 'Seguros', 'Espacios de trabajo compartidos', 'Colegios profesionales', 'Servicios a empresas', 'Servicios funerarios'],
  },
  { nombre: 'Educación', ejemplos: ['Colegios', 'Institutos', 'Centros universitarios', 'Guarderías', 'Academias', 'Autoescuelas'] },
  { nombre: 'Práctica deportiva', ejemplos: ['Gimnasios', 'Pistas', 'Polideportivos', 'Pilates', 'Barre Studios', 'Centros deportivos', 'Entrenadores personales'] },
  { nombre: 'Correos y mensajería', ejemplos: ['Oficinas de correos y empresas de mensajería', 'Microhubs de reparto y logística'] },
  { nombre: 'Loterías y apuestas', ejemplos: ['Loterías y apuestas del Estado', 'Casinos y casas privadas de apuestas'] },
  {
    nombre: 'Organismos Oficiales',
    ejemplos: ['Organismo gubernamental (ministerio, hacienda, ayuntamiento…)', 'Organismo autonómico', 'Organismo municipal', 'Oficina de turismo', 'Policía', 'Guardia Civil', 'Bomberos'],
  },
  { nombre: 'Asociaciones', ejemplos: ['Vecinales', 'De enfermedades', 'Discapacidad', 'ONGs', 'Políticas'] },
  { nombre: 'Comunicaciones', ejemplos: ['Sedes de periódicos', 'Radio', 'TV', 'Revista'] },
  { nombre: 'Agencias de viajes' },
  { nombre: 'Inmobiliarias' },
  { nombre: 'Instalaciones y suministros', ejemplos: ['De gas', 'Agua', 'Electricidad', 'Combustible'] },
  { nombre: 'Construcción', ejemplos: ['Contratistas', 'Servicios de pintura', 'Fontanería', 'Pintor', 'Carpintero', 'Albañilería'] },
  { nombre: 'Limpiezas', ejemplos: ['Todo tipo de servicios de limpieza', 'Agencias de empleadas del hogar', 'Lavanderías'] },
  { nombre: 'Tintorerías' },
  { nombre: 'Peluquerías', ejemplos: ['Peluquería', 'Peluquería masculina', 'Peluquería femenina'] },
  { nombre: 'Estética y belleza', ejemplos: ['Depilación', 'Rayos uva', 'Tratamientos capilares', 'Estéticos', 'Piercing', 'Tatuajes', 'Manicura', 'Masajes no terapéuticos'] },
  { nombre: 'Telefonía', ejemplos: ['Proveedor', 'Reparaciones', 'Locutorios'] },
  { nombre: 'Reparaciones', ejemplos: ['Electrodomésticos', 'Ropa', 'Calzado', 'Teléfonos'] },
  { nombre: 'Automóvil', ejemplos: ['Autolavado', 'Gasolinera', 'Alquiler de vehículos', 'Parking privado', 'Taller mecánico'] },
  { nombre: 'Ocio y cines', ejemplos: ['Cines', 'Teatros', 'Estadios', 'Salas de exposiciones', 'Escape Room', 'Salón de juegos', 'Bibliotecas', 'Club'] },
  { nombre: 'Religiosos', ejemplos: ['Iglesias y conventos'] },
  { nombre: 'Patrimonio histórico', ejemplos: ['Monumentos y museos'] },
  { nombre: 'Mascotas', ejemplos: ['Clínica veterinaria', 'Peluquería canina', 'Otros'] },
  { nombre: 'Almacenaje y guardamuebles', ejemplos: ['Trasteros', 'Lockers'] },
];

/**
 * Productos «en rojo» del documento: el ICM los agrupa de otra forma y la Cátedra los ha
 * reasignado. Se usan como palabras clave del destino indicado.
 */
export const EXCEPCIONES_ICM: { producto: string; claves: string[]; destino: string[]; nota: string }[] = [
  { producto: 'Tabaco', claves: ['tabaco', 'productos de tabaco'], destino: ['Comercio', 'Otros equipamientos', 'Estancos', 'Estancos'], nota: 'ICM: Alimentación (bebidas y tabacos) → Otros equipamientos' },
  { producto: 'Ordenadores', claves: ['ordenadores'], destino: ['Comercio', 'Otros equipamientos', 'Ocio', 'Informática'], nota: 'ICM: Equipamiento del hogar → Otros equipamientos' },
  { producto: 'Papeles pintados', claves: ['papeles pintados', 'papel pintado'], destino: ['Comercio', 'Equipamiento del Hogar', 'Materiales de construcción', 'Revestimientos'], nota: 'ICM: Otros bienes → Equipamiento del hogar (Materiales de construcción)' },
  { producto: 'Revestimiento de suelos (alfombras, moquetas, etc.)', claves: ['revestimiento de suelos', 'alfombras', 'moquetas'], destino: ['Comercio', 'Equipamiento del Hogar', 'Ropa del hogar', 'Ropa del hogar'], nota: 'ICM: Otros bienes → Equipamiento del hogar (Ropa de hogar)' },
  { producto: 'Bisutería', claves: ['bisutería'], destino: ['Comercio', 'Equipamiento Personal', 'Complementos', 'Accesorios'], nota: 'ICM: Otros bienes → Equipamiento personal (Complementos)' },
  { producto: 'Artículos de viaje de cuero o imitación de cuero', claves: ['artículos de viaje', 'maletas', 'marroquinería de viaje'], destino: ['Comercio', 'Equipamiento Personal', 'Complementos'], nota: 'ICM: Otros bienes → Equipamiento personal (Complementos); el documento no indica actividad: se clasifica con descripción' },
];

/** Grupo de comercio y variantes literales en `Hoja1` o en el propio documento (para importar). */
export const VARIANTES_NOMBRE: Record<string, string[]> = {
  'Otros equipamientos': ['Otro Equipamiento', 'Otros Equipamientos', 'Otro equipamiento (OE)', 'Otros equipamientos (EO)'],
  'Equipamiento del Hogar': ['Equipamiento del hogar'],
  'Equipamiento Personal': ['Equipamiento personal', 'Equipo personal'],
  'Hostelería y Restauración': ['Hostelería', 'Hostelería y Restauración (HR)'],
};

/**
 * Listas de `Hoja1` de los Excel de referencia (solo nombres de categorías, sin datos censales).
 * Se usan exclusivamente para calcular las discrepancias con el documento 2026.
 */
export const HOJA1_SUBGRUPOS = [
  'Agencias de Viajes', 'Alimentación Seca', 'Asociaciones', 'Automóvil', 'Banca y Finanzas', 'Bares y Cafeterías', 'Bazar y Menaje', 'Bricolaje y ferreterías', 'Calzado', 'Carnes',
  'Complementos', 'Comunicaciones', 'Construcción', 'Correos y Mensajería', 'Decoración y enmarcación', 'Discotecas', 'Educación', 'Electrodomésticos', 'Estancos', 'Estética y Belleza',
  'Fruta y Verdura', 'Gran Establecimiento', 'Grandes Almacenes', 'Hoteles y Hospedaje', 'Iluminación y Electricidad', 'Inmobiliarias', 'Instalaciones y suministros', 'Limpiezas',
  'Loterías y apuestas', 'Materiales de Construcción', 'Mobiliario', 'Ocio', 'Ocio y Cines', 'Organismos Oficiales', 'Otros Bienes', 'Otros servicios Profesionales', 'Pan y Lácteos',
  'Patrimonio Histórico', 'Peluquerías', 'Perfumería y droguería', 'Pescados y Mariscos', 'Práctica Deportiva', 'Religiosos', 'Reparaciones', 'Restaurantes', 'Ropa', 'Ropa del Hogar',
  'Salud', 'Servicios Médicos', 'Telefonía', 'Tintorerías', 'Vehículos y Maquinaria',
];
export const HOJA1_ACTIVIDADES = [
  'Academias', 'Accesorios', 'Agencias Empleadas del Hogar', 'Agua', 'Albañilería', 'Alquiler de Vehículos', 'Artículos de Peluquería', 'Asesorías', 'Asociación de Discapacidad',
  'Asociación de Enfermedades', 'Asociación Vecinal', 'Audífonos', 'Autoescuelas', 'Autolavado', 'B&B', 'Bancos', 'Bar', 'Bazar', 'Bebidas', 'Biblioteca', 'Bicis y Patinetes', 'Bodega',
  'Bricolaje y Ferreterías', 'Cafetería', 'Calzado', 'Calzado Hombre', 'Calzado Infantil', 'Calzado Mujer', 'Carnicería', 'Casinos y Casas Privadas de Apuestas', 'Casquería', 'Catering',
  'Centros Universitarios', 'Ceremonia', 'Charcutería', 'Chocolatería', 'Cines', 'Cirugía estética', 'Coleccionismo', 'Colegios', 'Colegios Profesionales', 'Combustible',
  'Comida preparada', 'Comida Rápida', 'Concesionarios', 'Congelados', 'Consultas Médicas', 'Contratistas', 'Corte Inglés', 'Cristalerías', 'Decoración y Enmarcación', 'Depilación',
  'Dietética', 'Droguería', 'Electricidad', 'Electrodomésticos', 'Escape Room', 'Estancos', 'Estéticos', 'Farmacias', 'Fisioterapia', 'Floristerías y jardinerías', 'Fontanería',
  'Fotografía y Audiovisual', 'Frutería', 'Gas', 'Gasolinera', 'Gimnasios', 'Golosinas', 'Heladería', 'Hipermercados', 'Hostal', 'Hotel', 'Iglesias y Conventos',
  'Iluminación y Eelctricidad', 'Informática', 'Institutos', 'Italiano', 'Joyerías', 'Jugueterías', 'Locutorios', 'Loterías y Apuestas del Estado', 'Manicura', 'Maquinaria', 'Marisco',
  'Masajes no Terapéuticos', 'Mascotas', 'Materiales de Obra', 'Mercería y Lencería', 'Mobiliario', 'Moda', 'Moda Hombre', 'Moda Infantil', 'Moda Mujer', 'Monumentos y Museos', 'Música',
  'Nutrición', 'Oficina', 'Oficina de Turismo', 'Oficinas de Correos y Empresas de Mensajería', 'ONG', 'Ópticas', 'Organismo Autonómico', 'Organismo Gubernamental', 'Organismo Municipal',
  'Ortopedias', 'Otros', 'Panadería', 'Papelería, Prensa y Librería', 'Parking Privado', 'Pastelería', 'Pensión', 'Perfumería y Cosmética', 'Pescadería', 'Piercing', 'Pistas', 'Podología',
  'Polideportivos', 'Pollería', 'Porveedor', 'Producción delicatesen', 'Psicotécnicos Carnet de Conducir', 'Pub', 'Puertas y Ventanas', 'Radio', 'Rayos Uva', 'Regalos', 'Reparaciones',
  'Repuestos', 'Residencia Estudiantil', 'Revestimientos', 'Ropa', 'Ropa del Hogar', 'Salas de Exposiciones', 'Salón de Juegos', 'Sedes de Periódicos', 'Segunda Mano', 'Seguros',
  'Servicios a Empresas', 'Servicios de Limpieza', 'Servicios de Pintura', 'Servicios Financieros', 'Servicios Funerarios', 'Supermercados', 'Taberna', 'Taller Mecánico', 'Teatros',
  'Teléfonos', 'Trabajo', 'Tradicional', 'Tratamientos Capilares', 'TV', 'Ultramarinos',
];

export interface Discrepancia {
  id: string;
  tema: string;
  documento: string;
  otraFuente: string;
  decisionProvisional: string;
}

/** Ambigüedades y contradicciones reales que debe resolver la Cátedra. */
export const DISCREPANCIAS_2026: Discrepancia[] = [
  { id: 'D01', tema: 'Nombre del grupo de comercio OE', documento: '«Otro Equipamiento (OE)» en la tabla de grupos y «Otros equipamientos (EO)» en la de subgrupos', otraFuente: 'Hoja1: «Otros Equipamientos»', decisionProvisional: '«Otros equipamientos», código OE; se aceptan las variantes al importar' },
  { id: 'D02', tema: 'Grandes Almacenes', documento: 'Figura al final de la tabla de «Otros equipamientos» (actividad «Corte Inglés»)', otraFuente: 'Hoja1: subgrupo «Grandes Almacenes» sin grupo de comercio', decisionProvisional: 'Se mantiene en Otros equipamientos; confirmar el grupo de comercio' },
  { id: 'D03', tema: 'Restaurantes › Internacional', documento: '«Internacional» (italiano, japonés, griego, chino…)', otraFuente: 'Hoja1: «Italiano»', decisionProvisional: 'Prevalece el documento: «Internacional»; «italiano» es palabra clave' },
  { id: 'D04', tema: 'Hoteles y hospedaje: Albergue y Pisos turísticos', documento: 'Incluidos como actividades', otraFuente: 'No figuran en Hoja1', decisionProvisional: 'Prevalece el documento' },
  { id: 'D05', tema: 'Mascotas', documento: 'Subgrupo de Servicios (clínica veterinaria, peluquería canina) y actividad de Comercio › Otros bienes (mascotas, accesorios y comida)', otraFuente: '—', decisionProvisional: 'Se mantienen ambos; el buscador obliga a elegir' },
  { id: 'D06', tema: 'Almacenaje y guardamuebles', documento: 'Subgrupo de Servicios', otraFuente: 'No figura en Hoja1', decisionProvisional: 'Prevalece el documento' },
  { id: 'D07', tema: 'Artículos de viaje de cuero (excepción ICM)', documento: 'Asignados a Equipamiento personal (Complementos) sin actividad concreta', otraFuente: '—', decisionProvisional: 'Subgrupo Complementos con descripción; confirmar si corresponde a «Accesorios»' },
  { id: 'D08', tema: '«Otros» repetido en Hostelería', documento: 'Bares y cafeterías › Otros (bar musical, karaoke) y Restaurantes › Otros', otraFuente: 'Hoja1: un único «Otros»', decisionProvisional: 'Dos actividades distintas; el buscador obliga a elegir por la ruta' },
  { id: 'D09', tema: 'Erratas de Hoja1', documento: '«Iluminación y electricidad», «Proveedor»', otraFuente: 'Hoja1: «Iluminación y Eelctricidad», «Porveedor»', decisionProvisional: 'Prevalece el documento; las variantes se reconocen al importar' },
  { id: 'D10', tema: 'Moda infantil', documento: '«Moda infantil y bebé»', otraFuente: 'Hoja1: «Moda Infantil»', decisionProvisional: 'Prevalece el documento' },
  { id: 'D11', tema: 'Servicios: «Actividad» como ejemplos', documento: 'La columna «Actividad» de Servicios enumera ejemplos con «etc.»', otraFuente: 'Hoja1 los trata como actividades cerradas (p. ej. «Asociación Vecinal», «Organismo Municipal»)', decisionProvisional: 'Subgrupo obligatorio + descripción de la actividad (sugerida a partir de los ejemplos); confirmar en qué columna del Excel municipal va la descripción (C3)' },
  { id: 'D12', tema: 'Supermercados / Hipermercados', documento: 'Menos / más de 2.500 m²', otraFuente: '—', decisionProvisional: 'Exactamente 2.500 m² no está definido' },
  { id: 'D13', tema: 'Parafarmacia', documento: 'No figura; Salud tiene «Farmacias»', otraFuente: 'El censo 2025 la clasificaba de varias formas', decisionProvisional: 'No se equipara a Farmacias: queda sin sugerencia automática hasta que la Cátedra decida (posible descripción en Salud)' },
  { id: 'D14', tema: 'Producción / productos delicatesen', documento: '«Productos delicatesen»', otraFuente: 'Hoja1: «Producción delicatesen»', decisionProvisional: 'Prevalece el documento' },
];
