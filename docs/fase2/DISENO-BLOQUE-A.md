# ULIT Censo · Fase 2 · Bloque A: auditoría y diseño

**Estado:** aprobado con decisiones (B0 y B1 implementados). **La §12 recoge el procedimiento funcional confirmado por la Cátedra y prevalece sobre lo anterior en caso de conflicto.** B2–B5, C y D no se programan sin autorización expresa.

**Rama:** `claude/fase2-oficina-itinerarios`, creada a partir de `claude/inspiring-cori-0ljncm`.

**Regla que no cambia:** ningún archivo censal real entra en el repositorio. Tampoco en pruebas, capturas ni documentación.

---

## 1. Auditoría del código actual

### 1.1 Oficina (`OficinaPage`, `PanelRevision`, `domain/oficina.ts`)

| Hallazgo | Consecuencia |
|---|---|
| La bandeja construye las filas de **todo el municipio** (`filasOficina`). El itinerario es solo un filtro más. | No reproduce el trabajo real, que se hace por itinerarios. |
| Cada cambio se edita en un panel lateral con formularios, y la tabla no es editable. | Hay demasiados clics por registro: no compite con Excel. |
| Cada pulsación de tecla en un campo genera un `aplicar()` y una entrada en la pila de deshacer. | Deshacer va letra a letra y se guarda con cada tecla. |
| La clasificación se hace con un buscador y cuatro desplegables encadenados; no hay actividades recientes ni avisos. | Es lenta, y una clasificación heredada errónea pasa desapercibida. |
| **«Marcar verificado hoy» verifica aunque haya variables sin comprobar.** | Es el defecto que detectasteis en las pruebas. |
| **Al editar un dato verificado, la métrica pasa a `verificada:false`, pero `Revision.digital` sigue en `revisado`.** | El estado general queda incoherente (el otro defecto detectado). |
| Los atributos digitales son `boolean \| undefined`. | No se distingue «no» de «no aplica» ni de «sin información», ni se guarda quién comprobó cada variable. |
| La métrica no registra quién la verificó. | Falta trazabilidad. |
| Los itinerarios no tienen un estado de oficina ni se bloquean. | No hay cierre ni protección frente a ediciones accidentales. |

### 1.2 Importaciones (`domain/importacion.ts`, `aplicarImportacion.ts`, `DatosPage`)

- **Solo admite CSV.** No lee XLSX, hojas ni estilos, así que el amarillo es invisible.
- **Casa locales solo por calle + número + sufijo** (y similitud de nombre). No detecta:
  - cambios de numeración;
  - locales que dejan de figurar en el archivo (posible desaparición);
  - contradicciones entre campos, como «vacío = 1» con nombre de negocio.
- **Ya corregido en la fase 1:** las cabeceras de Medina, las fechas inventadas y los casos ambiguos.
- **El resultado se aplica de golpe sobre la campaña.** No existe la entidad «Excel del itinerario» como lote revisable con su propio estado.

### 1.3 Clasificación (`domain/taxonomy.ts`)

- **El catálogo es inventado** y sus identificadores se derivan del texto. Hoy nada impide exportar esas categorías.
- **No hay versión de catálogo** ni marca de origen (real / demo).

### 1.4 Exportación (`domain/exportacion.ts`)

- **Solo hay CSV,** con columnas inventadas (`COLUMNAS_TRADICIONALES`).
- **No hay perfiles,** ni tipos por columna, ni codificación de estados, ni pruebas de estructura.
- **No existe la consolidación municipal.**

### 1.5 Histórico temporal (el caso Bar Delia → Perfumería Sol)

Causa raíz en el **modelo**, no solo en la presentación:

1. `Ocupacion` mide su duración en **campañas** (`desdeCampanaId`/`hastaCampanaId`). Dentro de una misma campaña no caben dos negocios.
2. `cerrarOcupacion()` **borra** la ocupación si se creó en la misma campaña. El negocio intermedio desaparece.
3. `Observacion.datos` guarda el nombre como texto, pero no el `negocioId` ni la situación (ocupado/vacío) del momento.
4. `Historico.tsx` busca «la ocupación vigente en el año de la campaña» y cuelga de ella todas las observaciones de ese año. Por eso los dos eventos de 2026 aparecen bajo el último negocio.

### 1.6 Lo que se conserva

- La separación entre calle, local, negocio, ocupación, observación, fila de origen y vínculo.
- Las operaciones como funciones puras `BaseDatos → BaseDatos`, el deshacer y la persistencia local.
- Territorio, Campo, Hoja de campo y el editor detallado actual, que pasa a ser el «modo detalle» para incidencias y conciliación.

---

## 2. Arquitectura de Oficina por itinerarios

### 2.1 Navegación

```
/oficina                         → Panel de itinerarios de la campaña (vista de entrada)
/oficina/it/:itId                → Revisión rápida del itinerario (tabla editable)
/oficina/it/:itId?vista=…        → pendientes, contradicciones, digital, categorías…
/oficina/it/:itId/validar        → Comprobación previa y cierre del itinerario
/oficina/municipio               → Vista municipal transversal (lo que hoy es Oficina)
/oficina/consolidar              → Consolidación municipal y exportación (bloque C)
```

**Panel de itinerarios.** Una tarjeta por itinerario con cinco indicadores independientes:

- campo realizado;
- categorización revisada;
- digital revisada;
- incidencias pendientes;
- validación final.

Cada tarjeta lleva tres accesos directos: «Abrir pendientes», «Abrir contradicciones» y «Cerrar revisión» (provisional hasta el bloque C).

### 2.2 Estado de oficina del itinerario (nuevo)

```
en-revision → revision-cerrada (provisional, bloqueada) → validado (definitivo, bloque C)
      ↑                    │                                   │
      └──── reabierto ←────┴───────────────────────────────────┘   (con motivo, quién y cuándo)
```

- **Revisión cerrada ≠ validado.** El cierre provisional registra quién hace la revisión final y cuándo, y bloquea la edición, pero **no habilita la exportación municipal**. La validación definitiva se rechaza mientras no existan los controles del bloque C (véase §12.8).
- **Cerrado o validado = bloqueado.** Cualquier operación de dominio que toque un local de una calle del itinerario se rechaza en el propio dominio (no solo en la interfaz), salvo que antes se reabra explícitamente.
- **Aislamiento entre itinerarios.** Las operaciones reciben el `itinerarioId` de contexto y no pueden modificar locales de calles ajenas. Hay prueba específica de esto.

### 2.3 Registro de trabajo del itinerario

Cada local revisado en un itinerario y campaña tiene un registro de trabajo (ampliación de `Revision`):

- un **estado por eje**: campo, categoría, digital, incidencias y validación;
- **contradicciones calculadas**, con la regla que las dispara;
- un **origen**: Excel del itinerario (lote importado), app de campo o papel;
- un **enlace a la fila de origen** del Excel del itinerario, para la trazabilidad.

---

## 3. Modo de revisión rápida

### 3.1 Tabla editable (componente propio sobre `@tanstack/react-virtual`, sin dependencias nuevas)

**Columnas.** Son configurables, se pueden fijar a la izquierda (por defecto Calle, Nº y Nombre) y la configuración se guarda por usuario.

**Teclado (coherente con Excel):**

| Tecla | Acción |
|---|---|
| Flechas | Mover la celda activa |
| Escribir | Empezar a editar, reemplazando el contenido |
| F2 / doble clic | Editar sin borrar el contenido |
| Enter | Confirmar y bajar · Mayús+Enter: confirmar y subir |
| Tab | Confirmar y pasar a la derecha · Mayús+Tab: confirmar y pasar a la izquierda |
| Esc | Cancelar la edición |
| Espacio | Marcar la fila |
| Mayús+flechas | Seleccionar un rango |
| Ctrl+C / Ctrl+V | Copiar y pegar en todas las celdas seleccionadas (con validación por tipo) |
| Ctrl+D | Copiar hacia abajo |
| Ctrl+Z / Ctrl+Y | Deshacer y rehacer, **por confirmación de celda**, no por pulsación |

**Guardado.**

- Cada confirmación de celda es una operación de dominio y se guarda al instante, de forma optimista.
- Cada fila muestra su estado: guardada, pendiente de revisar o con contradicción.
- La barra inferior indica el progreso del itinerario y si hay cambios sin sincronizar (persistencia local).

**Vistas rápidas.** Pendientes de categoría, pendientes digitales, contradicciones, amarillo del Excel, ambiguos, nuevos y todo.

**Búsqueda.** Filtra al instante sobre el itinerario: nombre, calle, número y actividad.

**El editor detallado sigue disponible** con Ctrl+Enter o con el icono de la fila. Sirve para conciliación, histórico y notas.

### 3.2 Respuestas rápidas (variables de estado)

Valor interno de cada atributo de este tipo:

```ts
type Respuesta = 'si' | 'no' | 'pendiente' | 'na' | 'sin-info';
//                1     0      (vacío)     N      ?
```

**En celdas de tipo respuesta:**

- `1` = sí, `0` = no, `N` = no aplicable (solo si la variable lo admite), `?` = sin información disponible.
- Supr devuelve la celda a *pendiente*.
- Pulsar `1` o `0` registra el valor **y avanza a la celda de abajo**, para recorrer una columna sin soltar el teclado.

**Una celda pendiente no es un 0.** El color y el icono los diferencian siempre.

**El tipo de cada columna viene del perfil** (§5), comprobado en los Excel reales. No se aplica 1/0 a nombres, direcciones ni cantidades. Las cantidades (reseñas, valoración, seguidores) son celdas numéricas, cuyo valor además puede estar «pendiente» o «sin información».

### 3.3 Autocompletado de actividades

- **Un único campo** combinado en la celda «Actividad»:
  - busca sin distinguir mayúsculas ni tildes, sobre los cuatro niveles;
  - da prioridad a las coincidencias al inicio de palabra;
  - muestra la ruta completa «Grupo › Comercio › Subgrupo › **Actividad**».
- **Sugerencias.** Con el campo vacío aparecen primero las actividades recientes (por usuario) y las frecuentes (en el itinerario).
- **Teclado:** ↑/↓ para moverse, Enter para confirmar, Esc para salir.
- **Al confirmar** se rellenan los cuatro niveles y la categorización queda revisada. Se puede cambiar volviendo a abrir la celda.
- **Sugerencia por nombre del negocio.** Por ejemplo, «Farmacia X» sugiere «Farmacia». Se muestra con estilo de *sugerencia* y **nunca se aplica sin un Enter explícito**.
- **Avisos de clasificación sospechosa**, que se calculan sin modificar nada:
  - la actividad heredada no existe en el catálogo;
  - la combinación de cuatro niveles es incoherente (por ejemplo, un subgrupo que no pertenece a ese grupo);
  - el nombre contradice la actividad (palabra clave fuerte de otra rama);
  - local vacío con actividad;
  - ocupado sin actividad.
- **Catálogo versionado** (`catalogo-actividades@v1`) con origen `real` o `demo`. **El exportador rechaza cualquier categoría que no pertenezca a un catálogo `real`.**

### 3.4 Aprovechar la campaña anterior

**Columnas «2025» de solo lectura**, que se pueden mostrar u ocultar (actividad, web, reseñas…). Aparecen solo cuando el negocio es el **mismo** (mismo `negocioId`, con vínculo confirmado).

**Acciones:**

- «Partir de 2025» en una fila o en las filas seleccionadas: copia los valores como **borrador**, con origen `heredado`. **No los verifica.**
- La categoría heredada también entra como borrador y se revisa si hay aviso de sospecha.

**Garantías:**

- Si el negocio es distinto, no hay columnas «2025» ni posibilidad de heredar. Está cubierto por pruebas.
- Un local que no aparece en el Excel del itinerario se clasifica como «no figura en el archivo / posible desaparición». No es un cierre.

---

## 4. Revisión digital con trazabilidad

**Modelo nuevo** (sustituye a `MetricaDigital`):

```ts
interface DatoDigital {           // una variable de un negocio en una campaña
  valor?: string | number;        // URL, nº de reseñas, valoración…
  respuesta: Respuesta;           // si / no / pendiente / na / sin-info
  origen: 'manual' | 'heredado-borrador' | 'google-maps-manual' | 'importado';
  porId?: Id; fecha?: string;     // quién y cuándo se comprobó
}
interface RevisionDigital {
  negocioId; campanaId;
  datos: Record<VariableDigital, DatoDigital>;
  estado: 'sin-datos' | 'solo-historico' | 'borrador' | 'verificada';
  verificadaPor?: Id; verificadaEn?: string;
  invalidadaPor?: { variable, porId, fecha }; // reapertura automática
}
```

- **Variables obligatorias.** Las define el perfil de trabajo. No se puede verificar mientras alguna esté en `pendiente`. Las respuestas `na` y `sin-info` permiten verificar, pero se informan.
- **Cambio después de verificar.** Si cambia una variable relevante tras la verificación, el estado pasa a `borrador` y `Revision.digital` vuelve a `pendiente`, con el motivo registrado. Así se elimina la incoherencia actual.
- **Ausencia confirmada.** «No tiene web» es `respuesta:'no'`, con la persona y la fecha de comprobación. «No he mirado» es `pendiente`.

---

## 5. Archivos reales y perfiles de exportación

### 5.1 Incorporación segura de los Excel reales

**Opción recomendada: inspector estructural local.**

1. Añadiría un script `npm run perfilar -- <archivo.xlsx>`. También puede ser una pestaña «Inspeccionar archivo» en Datos que funcione solo en el navegador.
2. El inspector produce un `perfil.json` **sin datos personales** que contiene:
   - hojas y nombres exactos de columnas, con su orden;
   - tipo dominante por columna (texto, entero, decimal, fecha, 0/1, 0.0/1.0);
   - porcentaje de celdas vacías;
   - **valores distintos solo en columnas categóricas** (por debajo de un umbral, como la taxonomía o Distrito);
   - recuento de celdas amarillas por columna.
3. Lo ejecutáis en vuestro equipo o en Codespaces y me pasáis el JSON. Los nombres de negocio y las direcciones nunca salen de vuestro equipo.

**Alternativa.** Subís los archivos a esta sesión en la nube. Quedarían fuera de git, en un directorio temporal, y se borrarían al terminar. Necesito vuestra confirmación expresa de que vuestra política de datos permite procesarlos en este entorno.

**Dentro de la aplicación:**

- Los XLSX se leen **siempre en el navegador**.
- La aplicación no los envía a ningún servidor.
- La fila original se guarda inmutable como `RegistroOrigen` en el almacenamiento local, junto con su huella.
- Se añadirá `datos-reales/` al `.gitignore`, y una comprobación previa al commit rechazará ficheros `*.xlsx` fuera de `src/**/fixtures/` (solo fixtures sintéticos).

### 5.2 Lectura y escritura XLSX

- **ExcelJS 4.4.0:** lee valores, tipos y **rellenos de celda** (el amarillo) y escribe XLSX nativo con tipos y formatos.
  - `npm audit` solo señala `uuid` (moderado). Afecta a una función de esa librería que ExcelJS no usa. Se puede forzar una versión corregida con `overrides`.
- **SheetJS (`xlsx` en npm) se descarta.** La versión publicada tiene vulnerabilidades altas sin corregir en npm.

### 5.3 Perfiles versionados

```ts
interface PerfilIntercambio {
  id: 'medina-2025-historico' | 'itinerario-trabajo' | 'municipal-2026';
  version: string;                 // semver
  estado: 'historico' | 'en-uso' | 'pendiente-confirmar';
  hoja: string;
  columnas: {
    nombre: string;                // EXACTO, incluidos espacios y mayúsculas
    tipo: 'texto' | 'entero' | 'decimal' | 'respuesta01' | 'respuesta01dec' | 'categoria' | 'fecha';
    origen: CampoCanonico;         // de dónde sale el valor
    codificacion?: { si: string|number; no: string|number; pendiente: null|''; na: null|''; sinInfo: null|'' };
    obligatorio: boolean;
    catalogo?: 'actividades@v1' | 'distritos' | …;
  }[];
}
```

**Tres perfiles, generados a partir del perfil estructural de los archivos reales** (nunca escritos por intuición):

| Perfil | Origen | Estructura |
|---|---|---|
| `medina-2025-historico` | `CENSO COMPLETO MEDINA 2025` | 27 columnas, con `Distrito` y `Zona` |
| `itinerario-trabajo` | `ITINERARIO 1 MEDINA` | 28 columnas, con `Municipio`, `itinerario` y `Orden Par` |
| `municipal-2026` | Copia del de 2025 | `estado: pendiente-confirmar` hasta que informática lo valide |

**Las columnas se importan y exportan por nombre exacto,** nunca por posición. La correspondencia entre perfiles se declara campo a campo. Las columnas que existen solo en un perfil se informan, no se adivinan.

**Pruebas de contrato.**

- Se exporta un conjunto sintético y se vuelve a leer con ExcelJS.
- Se comprueba que coinciden exactamente el nombre de la hoja, las cabeceras, el orden, el tipo de celda y la codificación de cada estado.
- Hay una prueba por perfil.

---

## 6. Importar el Excel real del itinerario

**El importador crea un «lote de itinerario» revisable.** No se aplica en silencio.

1. **Lectura.** Lee el XLSX en el navegador, elige la hoja y aplica el perfil `itinerario-trabajo` por nombres de cabecera. Marca las celdas amarillas como **anotación auxiliar**.
2. **Comparación prudente.** Compara con la campaña de referencia **solo sobre las calles del itinerario**, que se toman de la columna `itinerario` y del plan:

| Clase | Regla |
|---|---|
| Sin cambios aparentes | Misma dirección, un único candidato y el mismo negocio |
| Cambio de negocio | Misma dirección, un único candidato y otro nombre |
| Ahora vacío | Indicador «Local Vacío» = 1 donde antes había un negocio |
| Nuevo local | Sin candidato en esa dirección |
| Cambio de numeración | Mismo nombre y calle, otro número cercano en la misma acera; **se propone, no se aplica** |
| No figura en el archivo | Local de 2025 en una calle del itinerario que no aparece. Queda como *posible desaparición*, pendiente; **nunca como cierre** |
| Ambiguo | Varios candidatos en la dirección; va a conciliación |
| Contradicción | Vacío = 1 con nombre; ocupado sin nombre; actividad en local vacío; número no válido |
| Marcado amarillo | Etiqueta adicional sobre la fila; nunca dispara una acción |

3. **Confirmación.** Al confirmar se generan observaciones con `fuente:'papel'`, **sin fecha inventada**. El censo original no se toca. Las calles de otros itinerarios quedan fuera.

---

## 7. Validación del itinerario y consolidación municipal

### 7.1 Comprobación previa del itinerario

| Comprobación | Severidad |
|---|---|
| Registros sin categoría del catálogo real | **Bloqueante** |
| Revisión digital no verificada (variables obligatorias pendientes) | **Bloqueante** |
| Contradicciones abiertas | **Bloqueante** |
| Correspondencias históricas sin resolver | Bloqueante, o *justificable* con nota |
| Posibles duplicados | Advertencia |
| Incidencias de campo abiertas | Advertencia, *justificable* |
| Calles del itinerario sin cobertura confirmada | **Bloqueante**, o *justificable* (por ejemplo, calle en obras) |
| Columnas obligatorias del perfil vacías | **Bloqueante** |

- **Validar** requiere cero bloqueantes. Las justificaciones se guardan con su autor y fecha.
- **Reabrir** exige un motivo. Al reabrir, se invalida el consolidado que incluyese ese itinerario.

### 7.2 Consolidación municipal

Pasos:

1. Itinerarios de la campaña y su estado.
2. Cobertura: calles del ámbito sin itinerario o sin validar.
3. Solapes de calles entre itinerarios.
4. Duplicados entre itinerarios (dirección y nombre parecidos).
5. **Informe previo** con errores y advertencias.
6. **Previsualización** de filas y columnas según el perfil elegido.
7. **Generación del XLSX.**

Garantías:

- **Nunca se rellenan zonas pendientes con datos de 2025.**
- Cada fila del consolidado lleva una trazabilidad interna (itinerario, local, observación y fila de origen). Opcionalmente, va en una hoja auxiliar «Trazabilidad» que no forma parte del contrato con informática.
- **Exportación provisional:**
  - solo incluye los itinerarios validados;
  - el nombre del archivo empieza por `PROVISIONAL_`;
  - lleva una hoja «Avisos» y un ID de consolidado.
- **Exportación final:** exige que todos los itinerarios del ámbito estén validados y que no queden bloqueantes.

---

## 8. Asistencia para Google Maps (bloque D)

- **Botón «Buscar en Google Maps»** por fila (atajo `G`). Abre la búsqueda pública oficial con nombre, calle, número y municipio. Es un enlace, no *scraping*.
  - URL: `https://www.google.com/maps/search/?api=1&query=<nombre, calle número, municipio>`
- **Mini-formulario de registro rápido:**
  - valoración, nº de reseñas y «responde a reseñas» (1/0/?);
  - «No localizado» y «Varias coincidencias»; esta última deja el registro *pendiente*.
- **Campañas separadas.** Lo que se registra en 2026 no toca 2025.
- **Propuesta técnica aparte sobre Google Places API** (documento independiente, sin claves y sin conexión):
  - qué campos ofrece: valoración, nº de reseñas, web y estado del negocio. Las respuestas del propietario a las reseñas no aparecen como dato estructurado, así que esa comprobación sigue siendo manual;
  - costes orientativos por tipo de llamada, para verificarlos con la tarifa vigente;
  - **condiciones de uso que restringen almacenar el contenido**, salvo el `place_id`. Esto choca con conservar las valoraciones como serie histórica y debe revisarse jurídicamente antes de integrar nada.

---

## 9. Corrección del modelo temporal (bloque D, con la migración preparada en B)

- **`Observacion`** añade `negocioId` y `situacion` (ocupado/vacío) como **instantánea** del momento.
- **`Ocupacion`** cambia de duración por campaña a **intervalos por evento** (`desdeObservacionId`, `hastaObservacionId`, más campaña). Una campaña puede tener varias ocupaciones sucesivas; nunca se borra una ocupación intermedia.
- **El histórico se dibuja como secuencia de eventos.** Cada evento muestra su propia instantánea (Bar Delia 2025 → confirmación sep. 2026 «Bar Delia» → sustitución oct. 2026 «Perfumería Sol»).
- **Migración de datos:** sube `VERSION_DATOS` y regenera la demo. No hay datos reales que migrar.

---

## 10. Plan de implementación

| Paso | Contenido | Pruebas clave |
|---|---|---|
| **B0** | Inspector estructural (script + pestaña) · ExcelJS · `.gitignore` y comprobación de XLSX | El perfil no contiene filas de datos |
| **B1** | Modelo: `Respuesta`, `RevisionDigital`, estado de itinerario y bloqueo, aislamiento entre itinerarios, instantánea en observaciones | Pendiente ≠ 0; cambiar tras verificar reabre; un itinerario no altera otro; un itinerario validado no se puede editar |
| **B2** | Panel de itinerarios en Oficina y vista municipal · **vista por tareas y vista por establecimiento** (§12.2) · cierre provisional · ubicar eventos de cronología incierta | — |
| **B3** | Tabla editable por teclado (navegación, edición, copiar/pegar, deshacer por celda, columnas fijas), usada por la vista por tareas | Pruebas de interacción con Testing Library |
| **B4** | Catálogo 2026 por estructura de grupo (§12.5) · autocompletado de actividades y avisos de sospecha | «clín» → actividades del catálogo; las sugerencias no se aplican sin Enter |
| **B5** | Respuestas 1/0/N/?, franquicias como tarea propia, acciones masivas atómicas, comparación y «Partir de 2025», avisos de clasificación (implementado; véase `OFICINA-RAPIDA.md` §7) | Lo heredado queda en borrador; negocio distinto ⇒ no se hereda; ninguna acción masiva verifica ni aprueba |
| **C1** | Perfiles versionados (a partir del perfil real) · lectura y comparación del XLSX del itinerario | Amarillo = solo etiqueta; ambiguo no aplicado; el origen sigue intacto |
| **C2** | Validación de itinerario (bloqueantes, advertencias, justificaciones, reapertura) | — |
| **C3** | Consolidación municipal y XLSX nativo (provisional / final) | **Contrato de estructura exacta por perfil**; no se rellena con 2025; sin duplicados |
| **D1** | Asistencia Google Maps + documento sobre Places API | — |
| **D2** | Histórico temporal | Caso Bar Delia → Perfumería Sol |
| **D3** | Rendimiento (división del paquete) y ajustes de experiencia | — |

Cada paso es un commit (o varios) con pruebas, comprobación de tipos y compilación en verde. La PR de seguimiento, en borrador, apunta a `claude/inspiring-cori-0ljncm`.

---

## 11. Decisiones que necesito antes de empezar

1. **¿Cómo inspecciono los Excel reales?** Recomiendo el perfil estructural local; la alternativa es subirlos a esta sesión con vuestra autorización expresa.
2. **Catálogo de actividades.** ¿Existe una lista maestra oficial de los cuatro niveles, o el catálogo inicial se obtiene de los valores del Excel de 2025 y lo depuráis vosotros? Ese Excel tiene errores, así que lo segundo exige una revisión previa.
3. **Variables digitales obligatorias.** ¿Cuáles lo son? ¿Cuándo es «no aplicable» la respuesta a reseñas, por ejemplo si no hay reseñas?
4. **Perfil municipal 2026.** Mientras informática no lo confirme, ¿partimos de la estructura de 2025? ¿Las columnas propias del itinerario (`Municipio`, `itinerario`, `Orden Par`) deben pasar al consolidado o quedarse internas?

---

## 12. Procedimiento funcional confirmado (octubre de 2026)

Aclaraciones de la Cátedra tras revisar B0 y B1. Fuentes: conversación con la Cátedra, el documento de procedimiento «Clasificación Censo 2026» y el perfil estructural sin registros de Medina 2025 y del Itinerario 1 de 2026. **Ninguno de esos archivos se incorpora al repositorio**: aquí solo se resume lo necesario para el diseño.

### 12.1 Unidad de trabajo

**El itinerario.** Se trabaja por itinerarios y al final se consolida en un único Excel municipal para informática y Power BI.

### 12.2 Organización de Oficina: flexible según la persona

Hay dos formas reales de trabajar y la Oficina rápida debe admitir las dos sobre los mismos datos:

- **Vista por tareas (columnas).** Pasadas sucesivas sobre todo el itinerario: primero se categorizan todos los negocios; después se revisan las franquicias; después la presencia digital. Cada pasada muestra solo las columnas de esa tarea, con su progreso propio («Categorización 41/57»).
- **Vista por establecimiento.** Ficha de un establecimiento con todas sus tareas y avance al siguiente.

Requisitos:

- cambiar de vista conserva el filtro y el registro seleccionado;
- el estado de cada tarea es independiente (`categorizacion`, `franquicia`, `digital`), así se puede completar una tarea entera sin tocar las demás;
- ninguna vista impone un orden de tareas.

### 12.3 Revisión digital

Se revisa **manualmente cada año para todos los establecimientos**. Los datos del año anterior se muestran como referencia (columna de solo lectura o «Partir de 2025» como borrador), **nunca se dan por comprobados**. Esto ya está en B1: lo heredado no permite verificar hasta que se confirma dato a dato.

### 12.4 Participantes y revisión final

- Pueden trabajar alumnos en prácticas u otras personas del equipo.
- **No se impone separación entre autor y revisor.** Una misma persona puede categorizar y hacer la revisión final.
- Cada cambio guarda quién y cuándo (ya en B1: `porId` y `fecha` en clasificación y datos digitales).
- **Revisión final:** se registra quién la realiza y cuándo con independencia de quién hizo el trabajo previo. En B1 es el **cierre provisional** del itinerario (`cerrarRevisionItinerario`), que no requiere persona distinta.

### 12.5 Clasificación y categorización 2026

**Referencia funcional:** el documento «Clasificación Censo 2026». La lista de `Hoja1` de los Excel solo indica valores permitidos por columna y **no** define qué combinaciones son correctas. El censo 2025 contiene clasificaciones erróneas: **no se convierten en reglas del catálogo**.

**Estructura por grupo de actividad** (no siempre cuatro niveles):

| Grupo de actividad | Gr Comercio | Subgrupo | Actividad / Descripción |
|---|---|---|---|
| **Comercio** (C) | Obligatorio: Alimentación (A), Equipamiento del Hogar (EH), Equipamiento Personal (EP), Otros equipamientos (OE) | Obligatorio | Actividad de la tabla; descripción opcional (p. ej. Ultramarinos → «Conservas / Encurtidos y frutos secos») |
| **Hostelería y Restauración** (HR) | No se usa | Obligatorio | Actividad cuando el subgrupo la tiene (Bares y cafeterías, Restaurantes, Hoteles y hospedaje). **Discotecas** no tiene actividades. «Otros», «Comida rápida» e «Internacional» llevan descripción (bar musical, karaoke; hamburguesería, pizzería, kebab; italiano, japonés…) |
| **Servicios** (S) | No se usa | Obligatorio | **Subgrupo + breve descripción de actividad** (los ejemplos de la tabla, como «Bancos, servicios financieros», orientan pero no son una lista cerrada) |

Reglas para el diseño:

- **Si un negocio no encaja en una actividad predefinida, se admite una breve descripción.** No se rechaza automáticamente un texto que no figure literalmente en las listas: se marca como «descripción libre» para revisión.
- **Excepciones de agrupación del ICM** que el catálogo debe respetar (productos «en rojo» del documento):
  - Tabaco → Otros equipamientos (Estancos).
  - Ordenadores → Otros equipamientos (Ocio › Informática).
  - Papeles pintados → Equipamiento del hogar (Materiales de construcción › Revestimientos).
  - Revestimiento de suelos (alfombras, moquetas…) → Equipamiento del hogar (Ropa del hogar).
  - Bisutería → Equipamiento personal (Complementos).
  - Artículos de viaje de cuero o imitación → Equipamiento personal (Complementos).
- **Normas de cumplimentación** del documento: Distrito y Zona «No rellenar» (Medina); Dirección sin la palabra «calle»; Local vacío 0/1; Long fachada solo si el local está vacío; respuestas 0 = No, 1 = Sí; **Nº redes = Instagram + Facebook + Twitter** (valor calculado, no se teclea).
- **Diferencias entre el documento y `Hoja1`** que debe resolver la Cátedra (el código no decide): «Internacional» en el documento frente a «Italiano» en `Hoja1`; «Albergue» y «Pisos turísticos» no figuran en `Hoja1`; «Mascotas» aparece como subgrupo de Servicios y como actividad de Otros bienes; «Almacenaje y guardamuebles» no figura en `Hoja1`; `Hoja1` contiene «Ocio» y «Ocio y Cines», «Gran Establecimiento» y «Grandes Almacenes»; erratas en `Hoja1` («Iluminación y Eelctricidad», «Porveedor»); «Otro Equipamiento (OE)» / «Otros equipamientos (EO)» / «Otros Equipamientos».
- **Valores de 2025 fuera de lista** (según el perfil): subgrupos «Bancas y finanzas» y «Peluquerias»; 15 actividades (p. ej. «Asesorias», «Veterinario», «Residencias de ancianos»). Se tratarán con una **tabla de equivalencias** confirmada por una persona, nunca de forma automática.

**Implementado en B4** (`src/domain/catalogo2026.ts`, `buscador.ts`, `clasificacion.ts`, `migraciones.ts`; detalle en `CATALOGO-2026.md`). Modelo: catálogo versionado `clasificacion-2026@v1` con nodos tipados (grupo, grupo de comercio, subgrupo, actividad), reglas de niveles obligatorios **por grupo**, descripciones de apoyo, excepciones y equivalencias. **Ya en B1:** `ClasificacionCampana.descripcion` y `clasificar()` deja de exigir siempre el cuarto nivel: acepta un nodo sin hijos o un subgrupo con descripción. El catálogo actual sigue siendo de demostración.

### 12.6 Distrito, Zona y CP

- **Medina del Campo:** Distrito y Zona no se cumplimentan (en 2025 las 889 filas están vacías), aunque las columnas figuran en el Excel final. CP sí (numérico).
- **Valladolid:** se usan y son **códigos numéricos**. Ejemplo de estructura: Distrito `5`, Zona `3`, CP `47003`, dirección Conde Ansúrez.
- **Modelo previsto:** tabla de **correspondencia territorial** versionada por municipio y validada por la Cátedra, por **tramo de calle** (calle + rango de números + paridad) → {distrito, zona, CP}. **No se presupone que una calle completa pertenezca a la misma zona.**
- Autocompletado desde la correspondencia (origen `correspondencia`) con **corrección manual** registrada (origen `manual`, quién y cuándo). Sin correspondencia, la celda queda vacía y con aviso; nunca se inventa.
- En la exportación son números; en Medina, celdas vacías.

### 12.7 Formato de entrega

- El Excel completo de **Medina 2025 es la referencia provisional de compatibilidad** (27 columnas, hoja `Datos`), sabiendo que contiene errores.
- Cabeceras exactas, incluidas las rarezas: «Gr Comercio» con espacios finales en 2025 (sin ellos en el itinerario), «Google My Bussines», «Twitter»/«Segu T», «Nº redes».
- El Excel de itinerario 2026 (hoja `Datos 25`, 28 columnas) sustituye Distrito y Zona por «Municipio», «itinerario» y añade «Orden Par»: **esas columnas organizativas no pasan al Excel final**.
- **El archivo final no incorpora columnas ni hojas adicionales sin autorización de informática.**
- Anomalías visibles en el perfil de 2025 (valores 4, 23, 247 o 379 en columnas 0/1; texto en columnas numéricas): el importador las marcará como incidencia; no las convertirá en 1.

### 12.8 Validación provisional (implementado en esta corrección de B1)

- `cerrarRevisionItinerario` → estado `revision-cerrada`: bloquea la edición en esa campaña y registra quién y cuándo. Etiqueta: «Revisión cerrada (provisional, no apta para exportación municipal)».
- `validarItinerario` (definitiva) consulta `controlesValidacion`. Hasta el bloque C devuelve `disponibles: false` y la validación **se rechaza siempre** sin cambiar el estado.
- La consolidación municipal (C3) solo aceptará itinerarios `validado`.

### 12.9 Correcciones técnicas de B0 y B1 (esta revisión)

1. **Ocupante vigente frente a histórico.** `localesDeNegocio` distingue `todos` (cualquier ocupación del negocio en la campaña: sirve para bloqueo y alcance) de `vigentes` (donde es el ocupante al final de la campaña: los únicos cuyos estados de revisión se actualizan). Revisar Bar Delia tras la llegada de Perfumería Sol ya no cambia la revisión de Perfumería Sol. Un negocio que no consta en la campaña no se puede revisar en ella.
2. **Cronología efectiva.** Las ocupaciones guardan la fecha real del evento (`desdeFecha`) y se ordenan por ella; el orden de introducción solo desempata con la misma fecha y hora. Un evento introducido tarde (papel) se inserta en su lugar como etapa intermedia. Una confirmación con fecha registra el negocio de esa fecha. Si la fecha falta o no decide (mismo día sin hora), el evento queda con **cronología incierta**: se registra, no altera las ocupaciones y deja el registro «pendiente de comprobación» hasta que la oficina le asigna fecha (`ubicarEnCronologia`, que guarda quién y cuándo). El importador lee «Fecha censo» (número de serie de Excel o fecha escrita).
3. **Aislamiento.** Las operaciones de Campo reciben el itinerario de trabajo (`Contexto.alcance`; la app de campo lo pasa siempre). `registrarLocalNuevo` comprueba bloqueo y alcance por **dirección** (calle y acera según la paridad del número), no por calle completa, y solo propone candidatos de conciliación del mismo itinerario y no cerrados. `resolverVinculo` comprueba los dos locales. Un negocio asociado a locales de varios itinerarios no se modifica desde uno solo. La planificación de calles de un itinerario cerrado queda bloqueada en su campaña. Todas las comprobaciones son previas: una operación rechazada no deja cambios parciales, tampoco una importación.
4. **Privacidad del inspector.** El perfil solo enumera valores de una **lista explícita de columnas autorizadas** (catálogo, códigos territoriales, respuestas 0/1). El resto (p. ej. «Cadena», «Observaciones», «Fecha censo») aporta solo estructura y estadística.
5. **Validación provisional** (§12.8).

---

## 13. B2 y B3 implementados (octubre de 2026)

Detalle de uso y pruebas manuales en [`OFICINA-RAPIDA.md`](OFICINA-RAPIDA.md).

### 13.1 B2 · Oficina organizada por itinerarios

- **Pertenencia por ámbito efectivo** (`domain/ambito.ts`): calle, acera según la paridad del número y segmento más cercano cuando el tramo se limita a segmentos. La usan `filasOficina` y las comprobaciones de bloqueo y alcance. Si no se puede situar un local en un segmento, figura en todos los itinerarios posibles y se marca la incidencia «Pertenece a varios itinerarios»: nunca desaparece.
- **Seguimiento completo.** `filasOficina` incluye los locales de la campaña de referencia aún no visitados (`situacion: 'pendiente-visita'`). `callesDeItinerario` conserva la cobertura de las calles sin locales.
- **Entrada por itinerarios** con progreso independiente:
  - campo y calles;
  - categorización;
  - digital;
  - franquicias, marcada como «pendiente de B5», sin progreso inventado;
  - incidencias, cronología incierta y revisión final.
- **Vista municipal** como opción secundaria. Los enlaces antiguos `?vista=` siguen funcionando.
- **Dos modos sobre los mismos datos.** «Por tareas» y «Por establecimientos» con «Siguiente pendiente». El modo y las columnas se guardan por persona (`prefs.oficina[personaId]`).
- **Cierre provisional, reapertura con motivo y validación definitiva** explicada como no disponible.
- **Asignación de fechas** a observaciones de cronología incierta.
- **Solo lectura** para las campañas históricas o validadas.

### 13.2 B3 · Tabla de revisión rápida

- **Componente propio** (`office/tabla/TablaRevision.tsx`) sobre `@tanstack/react-virtual`, sin dependencias nuevas.
- **Columnas** fijables, configurables y ordenables. El cursor se guarda por (local, columna), así que sobrevive a la virtualización, al filtrado y al desplazamiento horizontal.
- **Columnas declarativas** (`office/tabla/columnas.tsx`): texto, presentación, motivo de no edición, intérprete y operación de dominio. **Así se incorporarán B4 y B5.**
- **Cambios atómicos** (`aplicarCambiosCeldas`): primero se valida todo y luego se aplica en orden. Cualquier fallo descarta la operación completa y marca las celdas.
- **Deshacer y rehacer por operación confirmada** (`pilaDeshacer` / `pilaRehacer`). Las fichas guardan al confirmar, no en cada pulsación. La barra inferior indica el guardado.

### 13.3 Rendimiento medido

| Medida | Resultado |
|---|---|
| Filas y resúmenes, 5.040 registros | ≈ 80 ms |
| Tabla, 3.200 registros | Solo se pintan las filas visibles |
| Pulsación de flecha en Chromium (compilación de producción) | Mediana ≈ 13 ms |

### 13.4 Presencia digital · decisiones confirmadas (20/10/2026)

1. **Twitter / X** se comprueba cada año y hay que registrar **Sí o No**. «Sin información» se guarda, pero no permite verificar. Si existe, se piden los seguidores; si no pueden obtenerse, se admite «sin información» y **nunca se inventa un cero**.
2. **Facebook** y sus seguidores siguen el mismo criterio condicional (`exigeSiNo` en `domain/digital.ts`).
   **Instagram** sigue exactamente el mismo criterio (decisión del 20/10/2026). Así, una revisión es verificable si y solo si **Nº redes** tiene un total definitivo. Lo comprueba una prueba que recorre las 64 combinaciones de respuestas.
3. **Valoración media** de Google es un campo adicional **opcional**: no bloquea la verificación.
4. **Otras redes** es un campo opcional que tampoco bloquea la verificación.
5. **Nº redes** = Instagram + Facebook + Twitter / X. Solo hay total si las tres están contestadas con Sí o No; con alguna pendiente o «sin información» queda **sin determinar**, porque «sin información» no equivale a «No».
6. Los campos adicionales (`VARIABLES_ADICIONALES`) **no pasarán al Excel municipal definitivo** si no figuran en la plantilla acordada con informática. Se resolverá en el exportador oficial (C3). El CSV provisional de la fase 1 no se ha modificado.
