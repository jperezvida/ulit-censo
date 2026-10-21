/**
 * C1b · Catálogo de REGLAS de interpretación y de TIPOS de incidencia.
 *
 * Cada celda interpretada indica la regla aplicada, de modo que cualquier resultado puede
 * rastrearse hasta su valor original y su justificación. Hay tres clases de regla:
 *  - «lectura»: el valor ya tiene la forma esperada (0/1, entero, fecha de Excel…); no se transforma.
 *  - «transformacion»: cambia la representación con una regla EXPLÍCITA e inequívoca ("1" → 1).
 *    Se aplican solo las que define la especificación de C1b.
 *  - «propuesta»: transformaciones plausibles pero no inequívocas o que dependen de una decisión de
 *    la Cátedra («3,5 m», «sin dato»…). Por defecto NO se aplican: la celda queda «pendiente» con
 *    el valor propuesto a la vista. Solo se aplican si se autorizan expresamente en las opciones.
 */

export type ClaseRegla = 'lectura' | 'transformacion' | 'propuesta' | 'estado';

export interface Regla {
  id: string;
  clase: ClaseRegla;
  descripcion: string;
  /** Quién respalda la regla: la especificación de C1b o una decisión todavía pendiente. */
  respaldo: 'especificacion-c1b' | 'pendiente-catedra' | 'pendiente-informatica';
  /** Decisión pendiente a la que remite (numeración de C1-PREPARACION-IMPORTADOR, sección 12). */
  decision?: string;
}

const r = (id: string, clase: ClaseRegla, descripcion: string, respaldo: Regla['respaldo'] = 'especificacion-c1b', decision?: string): Regla => ({ id, clase, descripcion, respaldo, decision });

export const REGLAS: Record<string, Regla> = Object.fromEntries(
  [
    // Estados sin valor
    r('celda-vacia', 'estado', 'Celda vacía: se conserva vacía (nunca pasa a No, 0 ni a una fecha).'),
    r('solo-espacios', 'estado', 'Texto formado solo por espacios: se trata como vacío; el original se conserva.'),
    r('no-aplica-local-vacio', 'estado', 'Campo de negocio vacío en un local vacío: no aplica.'),
    r('no-aplica-local-ocupado', 'estado', 'Long fachada vacía en un local ocupado: no aplica (solo se mide en locales vacíos).'),
    r('no-aplica-red-no', 'estado', 'Seguidores, reseñas o respuesta vacíos cuando la red o Google figura como No: no aplica.'),
    r('no-aplica-fuera-de-comercio', 'estado', '«Gr Comercio» vacío fuera de Comercio: no aplica.'),
    r('territorio-no-se-usa', 'estado', 'El municipio no utiliza este campo territorial: no aplica y no se rellena.'),
    r('territorio-ausente-historico', 'estado', 'Campo territorial vacío en un histórico: se conserva ausente, sin deducirlo de la calle ni de otro campo.'),
    r('error-excel', 'estado', 'Valor de error de Excel (#N/A, #¡VALOR!…): inválido.'),
    r('tipo-no-admitido', 'estado', 'Tipo de celda no admitido en la columna (p. ej. VERDADERO/FALSO o fecha en una columna 0/1).'),
    // Lectura directa
    r('texto-literal', 'lectura', 'Texto conservado literalmente (sin recortar ni corregir).'),
    r('binario-01', 'lectura', '0 → No, 1 → Sí.'),
    r('entero-no-negativo', 'lectura', 'Entero mayor o igual que 0 (el cero es un valor válido).'),
    r('decimal-no-negativo', 'lectura', 'Número mayor o igual que 0.'),
    r('fecha-excel', 'lectura', 'Fecha de Excel (número de serie con formato de fecha).'),
    r('portal-entero', 'lectura', 'Número de portal entero positivo.'),
    r('portal-sn', 'lectura', '«S/N»: sin número (distinto de número desconocido).'),
    r('cp-cinco-cifras', 'lectura', 'Código postal de 5 cifras, guardado como texto para no perder ceros iniciales.'),
    r('territorio-codigo', 'lectura', 'Código territorial conservado tal cual (no hay todavía tabla verificada para comprobar su dominio).'),
    r('redes-coincide', 'lectura', '«Nº redes» coincide con Instagram + Facebook + Twitter/X.'),
    // Transformaciones explícitas e inequívocas
    r('binario-texto-01', 'transformacion', '"0"/"1" guardado como texto (también "1,0"/"1.0") → No/Sí.'),
    r('entero-texto', 'transformacion', 'Entero guardado como texto, solo dígitos ("120" → 120).'),
    r('decimal-texto', 'transformacion', 'Número guardado como texto con hasta dos decimales ("3,5" → 3,5).'),
    r('portal-texto-entero', 'transformacion', 'Número de portal guardado como texto ("12" → 12).'),
    r('portal-sufijo', 'transformacion', 'Número con sufijo ("16 B" → número 16, sufijo B).'),
    r('fecha-texto-dma', 'transformacion', 'Fecha escrita como texto dd/mm/aaaa (también con «-» o «.»), comprobando que existe.'),
    r('fecha-texto-iso', 'transformacion', 'Fecha escrita como texto aaaa-mm-dd, comprobando que existe.'),
    r('texto-desde-numero', 'transformacion', 'Número en una columna de texto: se toma su representación decimal.'),
    // Propuestas que NO se aplican sin autorización
    r('fachada-con-unidad', 'propuesta', 'Medida con unidad de metros («3,5 m» → 3,5).', 'pendiente-catedra', '2'),
    r('diccionario-sin-informacion', 'propuesta', 'Texto que podría significar «sin información» («sin dato», «s/i»).', 'pendiente-catedra', '1'),
    r('fecha-serial-sin-formato', 'propuesta', 'Número sin formato de fecha en «Fecha censo»: podría ser un número de serie de Excel.', 'pendiente-catedra'),
    r('fecha-anio-dos-cifras', 'propuesta', 'Fecha con año de dos cifras («05/01/25» → 2025).', 'pendiente-catedra'),
    r('cp-cuatro-cifras', 'propuesta', 'Código postal de 4 cifras: probablemente perdió el cero inicial.', 'pendiente-informatica', 'informática 2'),
    r('fecha-fuera-de-campana', 'propuesta', 'Fecha válida pero fuera del periodo de la campaña: se conserva como propuesta.'),
    r('cp-distinto-del-fijo', 'propuesta', 'Código postal distinto del valor fijo del municipio: se conserva como propuesta.'),
    // Invalidez
    r('binario-fuera-de-dominio', 'estado', 'Número distinto de 0 y 1 en una columna 0/1 (4, 23, 83…): inválido; nunca pasa a Sí.'),
    r('binario-texto-no-reconocido', 'estado', 'Texto no reconocido en una columna 0/1 (incluidos «Sí»/«No»): inválido.'),
    r('numero-no-valido', 'estado', 'Número negativo o con decimales donde se espera un entero mayor o igual que 0.'),
    r('numero-texto-no-reconocido', 'estado', 'Texto que no es un número inequívoco.'),
    r('fecha-no-reconocida', 'estado', 'Texto que no es una fecha (p. ej. «FECHA PENDIENTE»): la fecha queda ausente.'),
    r('portal-no-reconocido', 'estado', 'Valor que no es un número de portal reconocible.'),
    r('cp-no-valido', 'estado', 'Valor que no es un código postal.'),
    r('redes-discrepa', 'estado', '«Nº redes» no coincide con Instagram + Facebook + Twitter/X: se conserva el original y se informa del calculado.'),
    r('redes-no-calculable', 'estado', 'Alguna de las tres redes es desconocida o inválida: no se calcula el total.'),
  ].map((x) => [x.id, x]),
);

export type Gravedad = 'error' | 'aviso' | 'info';
/** Quién debe actuar: la Cátedra (criterio general), una persona revisando el registro, o nadie. */
export type Decision = 'catedra' | 'revision' | 'informativa';

export interface TipoIncidencia {
  titulo: string;
  gravedad: Gravedad;
  decision: Decision;
  propuesta: string;
}

const t = (titulo: string, gravedad: Gravedad, decision: Decision, propuesta: string): TipoIncidencia => ({ titulo, gravedad, decision, propuesta });

export const TIPOS_INCIDENCIA = {
  'valor-error-excel': t('Valor de error de Excel', 'error', 'revision', 'Consultar el dato en el origen; la celda queda sin valor.'),
  'tipo-no-admitido': t('Tipo de celda no admitido', 'error', 'revision', 'Revisar el valor en el origen; no se convierte.'),
  'fecha-ausente': t('Fecha censo vacía', 'aviso', 'revision', 'La fecha queda ausente. No se sustituye por la fecha actual ni por otra inventada.'),
  'fecha-no-reconocida': t('Fecha censo no reconocida', 'error', 'revision', 'La fecha queda ausente. Completarla desde el parte de campo si existe; nunca con la fecha actual.'),
  'fecha-fuera-de-campana': t('Fecha fuera del periodo de la campaña', 'aviso', 'revision', 'Comprobar si es una errata o si el registro pertenece a otra campaña. No se corrige automáticamente.'),
  'fecha-serial-sin-formato': t('Número sin formato de fecha', 'aviso', 'catedra', 'Podría ser una fecha de Excel. Solo se convertirá si se autoriza la regla.'),
  'fecha-anio-dos-cifras': t('Fecha con año de dos cifras', 'aviso', 'catedra', 'Solo se completará el siglo si se autoriza la regla.'),
  'territorio-no-usado-con-valor': t('Campo territorial que el municipio no usa, con valor', 'aviso', 'revision', 'Se conserva como dato original sin usarlo.'),
  'territorio-obligatorio-ausente': t('Campo territorial obligatorio ausente', 'error', 'revision', 'Completar con una correspondencia territorial verificada o una asignación manual trazada. No se deduce de la calle.'),
  'cp-distinto-del-fijo': t('CP distinto del fijo del municipio', 'aviso', 'revision', 'Comprobar el origen. No se sustituye por el valor fijo.'),
  'cp-cuatro-cifras': t('CP de 4 cifras', 'aviso', 'catedra', 'Probable pérdida del cero inicial; requiere confirmar el criterio (tipo de CP con informática).'),
  'cp-no-valido': t('CP no válido', 'error', 'revision', 'Revisar el origen; la celda queda sin valor.'),
  'direccion-ausente': t('Dirección vacía', 'error', 'revision', 'Sin dirección no puede situarse el local: completar desde el origen o descartar en la conciliación.'),
  'numero-ausente': t('Número de portal desconocido', 'aviso', 'revision', 'Se distingue de «S/N». Completar en la conciliación o en campo.'),
  'numero-no-reconocido': t('Número de portal no reconocido', 'error', 'revision', 'Revisar el origen; se conserva el texto original.'),
  'local-vacio-ausente': t('«Local Vacío» sin valor', 'error', 'revision', 'Confirmar en campo si el local está vacío u ocupado. No se deduce de la falta de nombre.'),
  'local-vacio-invalido': t('«Local Vacío» con un valor distinto de 0 y 1', 'error', 'revision', 'Confirmar el estado del local. No se deduce de otros campos.'),
  'fachada-con-unidad': t('Long fachada con unidad', 'aviso', 'catedra', 'Se propone el número en metros; se aplicará solo si la Cátedra autoriza la regla.'),
  'fachada-no-valida': t('Long fachada no válida', 'error', 'revision', 'Revisar la medida en el origen.'),
  'fachada-en-ocupado': t('Long fachada en un local ocupado', 'aviso', 'catedra', 'Se conserva. Criterio pendiente de la Cátedra (decisión 2).'),
  'ocupado-sin-nombre': t('Local ocupado sin nombre', 'error', 'revision', 'Completar el nombre o revisar si el local está realmente ocupado. No se deduce que esté vacío.'),
  'vacio-con-datos-negocio': t('Local vacío con datos de negocio', 'error', 'revision', 'Revisar si el local está ocupado o si los datos son de un negocio anterior. No se elimina nada.'),
  'binario-invalido': t('Valor 0/1 imposible', 'error', 'revision', 'Queda sin respuesta (nunca pasa a Sí). Comprobar en el origen o en la revisión 2026.'),
  'binario-texto-no-reconocido': t('Texto en una columna 0/1', 'error', 'revision', 'Queda sin respuesta. Comprobar en el origen.'),
  'sin-dato-ocupado': t('Sin dato en un local ocupado', 'aviso', 'revision', 'Queda «sin información»: no se convierte en No ni en 0.'),
  'texto-sin-informacion-pendiente': t('Texto candidato a «sin información»', 'aviso', 'catedra', 'Pendiente del diccionario de equivalencias de la Cátedra (decisión 1). Mientras tanto no se interpreta.'),
  'numero-no-valido': t('Número no válido', 'error', 'revision', 'Revisar el origen; la celda queda sin valor.'),
  'numero-texto-no-reconocido': t('Texto en una columna numérica', 'error', 'revision', 'Revisar el origen; la celda queda sin valor.'),
  'seguidores-con-red-no': t('Seguidores con la red marcada No', 'aviso', 'revision', 'Contradicción: comprobar la red en la revisión digital 2026. No se corrige ninguno de los dos valores.'),
  'resenas-sin-google': t('Reseñas con Google Business No', 'aviso', 'revision', 'Contradicción: comprobar en la revisión digital 2026. No se corrige.'),
  'responde-sin-google': t('Responde reseñas con Google Business No', 'aviso', 'revision', 'Contradicción: comprobar en la revisión digital 2026. No se corrige.'),
  'redes-discrepa': t('«Nº redes» no coincide', 'aviso', 'revision', 'Se conserva el original y se usará el calculado (IG + FB + X) si se aprueba al aplicar.'),
  'redes-no-calculable': t('«Nº redes» no calculable', 'aviso', 'revision', 'Alguna red es desconocida o inválida: no se inventa el total.'),
  'clasificacion-incompleta': t('Clasificación histórica incompleta', 'aviso', 'revision', 'Se conserva el texto histórico. Clasificar en 2026 con «Partir de 2025» o manualmente.'),
  'clasificacion-incoherente': t('Clasificación histórica incoherente', 'aviso', 'revision', 'Se conserva el texto histórico sin reasignarlo. Clasificar en 2026 por decisión humana.'),
  'servicios-actividad-ejemplo': t('Servicios: actividad 2025 que en 2026 es un ejemplo de descripción', 'info', 'catedra', 'Diferencia de estructura, no error. Equivalencia pendiente de la Cátedra (decisión 3).'),
  'servicios-actividad-no-prevista': t('Servicios: actividad 2025 no prevista en 2026', 'aviso', 'catedra', 'Pendiente de la correspondencia 2025 → 2026 (decisión 3).'),
  'clasificacion-fuera-de-lista': t('Valor fuera de las listas históricas de Hoja1', 'info', 'informativa', 'Se conserva tal cual; puede ser una variante de escritura.'),
  'direccion-repetida': t('Varios establecimientos en el mismo portal', 'info', 'informativa', 'Se conservan todas las filas y cada una es un local físico distinto del mismo portal (bajos, locales interiores…): no se fusionan ni son una ambigüedad (corrección C1c-1).'),
  'posible-fila-de-totales': t('Posible fila de totales (heurística)', 'aviso', 'revision', 'Se conserva íntegra. Solo se excluirá de la aplicación operativa con una decisión humana explícita y trazada (C1d).'),
  'fila-duplicada-exacta': t('Fila idéntica a otra', 'aviso', 'revision', 'Posible duplicado exacto. Se conservan ambas filas hasta una decisión humana.'),
} satisfies Record<string, TipoIncidencia>;

export type IdTipoIncidencia = keyof typeof TIPOS_INCIDENCIA;

/**
 * Textos observados que PODRÍAN significar «sin información». Es una PROPUESTA para la Cátedra
 * (decisión 1): mientras no se apruebe, una celda con estos textos queda «pendiente».
 */
export const DICCIONARIO_SIN_INFORMACION_PROPUESTO = ['sin dato', 's/i'] as const;
