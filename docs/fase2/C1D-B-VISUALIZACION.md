# C1d-B · Dashboard estadístico y visualización

> **Alcance:** un dashboard sobre los datos del modelo, con datos ficticios.
> - Ninguna cifra se introduce a mano ni se inventa.
> - No se han empezado C2 ni C3.
> - La incorporación (C1d-A) se documenta en `C1D-A-INCORPORACION.md`.

## 1. Dónde está y cómo se organiza (rediseño)

Espacio **Visualización** en la barra superior (ruta `#/visualizacion`). El rediseño reorganiza la página como un cuadro de mando sobre una **retícula de 12 columnas**, con tarjetas KPI homogéneas y bloques de altura igualada por fila.

- **Cabecera compacta** (un único bloque, unos 100 px; bloque 2 de la revisión):
  - fila 1: **identificador del ámbito** (sección 6), nombre y etiqueta «escenario ficticio» si procede, **años** como control segmentado (con su estado: histórico, en curso o campaña cerrada) y los selectores **Tipo** y **Ámbito**;
  - fila 2, **filtros globales**: Franquicia (todos · Sí · No · pendiente o sin dato), Sector (fijo en las pestañas de sector), CP (solo si los datos lo traen), Calle; «Limpiar filtros» y el contador «N de M establecimientos observados».
- **Aviso de origen de los datos** en una línea, con el detalle desplegable (sección 3).
- **Pestañas con icono:** Resumen · Comercio · Servicios · Hostelería y restauración · Locales vacíos · Digitalización 1 · Digitalización 2 · Cobertura y calidad · Comparar.
- **Código:** `VisualizacionPage.tsx` (cabecera, filtros y pestañas), `resumen.tsx`, `mapa.tsx` (mapa territorial y matriz calle × sector), `sectores.tsx`, `vacios.tsx`, `digital.tsx`, `calidad.tsx` (Cobertura y Comparar), `comun.tsx` (contexto y ranking de calles) y `graficos.tsx` (componentes).
- **Color:** los tres sectores usan un orden fijo de tonos validado para daltonismo; «sin clasificar» y «vacíos» van en grises; los mapas de calor usan una sola tonalidad de claro a oscuro; las capas del mapa y las columnas de la matriz usan rampas secuenciales OKLCH de un solo tono, validadas con la guía de visualización (monótonas, pasos distinguibles, extremo claro visible) y con texto de contraste ≥ 4,9:1 en las celdas; las respuestas (Sí, No, Sin información, Pendiente) tienen su propia paleta validada y «No aplicable» en gris.

## 2. Qué se cuenta (no son cantidades equivalentes)

| Medida | Definición |
|---|---|
| **Registros censales** | Filas importadas (`RegistroOrigen`) de la campaña, sin contar las excluidas por una persona |
| **Registros sin establecimiento observado** | Registros censales cuyo local no está entre los observados y que no tienen observación propia sin local. Se calcula **registro a registro**, no restando, porque las observaciones manuales de la misma campaña no tienen registro de origen |
| **Establecimientos observados** | Unidad de los gráficos: los registros de Oficina de la campaña y las observaciones sin local identificado |
| **Locales físicos identificados** | Locales distintos entre los establecimientos observados |
| **Negocios** | Negocios distintos en establecimientos ocupados |
| **Locales vacíos** | Establecimientos observados con estado vacío |
| **Correspondencias pendientes** | Vínculos registro–local probables, dudosos o sin vínculo, con su desglose |

Ejemplo con el escenario ficticio, probado:
- 890 registros censales, 30 de ellos sin establecimiento observado;
- 860 establecimientos observados, de ellos 14 sin local;
- 846 locales (4 de ellos en 2 portales con varios locales, C1c-1);
- 620 negocios;
- 240 vacíos;
- 890 correspondencias pendientes: 846 probables, 12 dudosas y 32 sin vínculo.

Los establecimientos de Oficina coinciden con `filasOficina` (prueba), así que el dashboard y Oficina cuentan lo mismo.

## 3. Fuentes separadas y denominadores

- **Clasificación:**
  - «Clasificación 2026 confirmada»;
  - «Propuesta 2026 sin confirmar»;
  - «Texto histórico (sin convertir)»;
  - «Sin clasificar».

  En un histórico, el sector se lee del texto original de GrActividad, sin convertirlo al catálogo 2026.
- **Franquicia y digital:**
  - se distinguen **Sí, No, Sin información, No aplicable y Pendiente**;
  - la **adopción** (%) se calcula sobre las respuestas Sí/No;
  - siempre se muestra el **denominador**, los ocupados;
  - la revisión digital separa «Verificada», «Borrador o importada» y «Sin datos»: un dato importado **no** es una comprobación de 2026;
  - el origen de la franquicia se distingue entre comprobada, heredada e importada.
- **Origen de los datos (aviso calculado, `origenDatos`):** el aviso no es un texto fijo. Separa el **tipo de campaña** (histórico importado o campaña) del **origen real** de los datos:
  - clasificación: texto histórico sin convertir, confirmada en el modelo, propuesta sin confirmar o sin clasificar, con sus recuentos;
  - franquicia: comprobada, heredada, importada o sin dato;
  - presencia digital: verificada en el modelo, borrador o importada, sin datos.

  En un histórico, «confirmada» o «verificada» se refieren a esa campaña y no son comprobaciones de 2026. En datos de demostración (escenario ficticio o locales simulados), esos estados son ficticios. Nunca se afirma que una clasificación está sin convertir o sin confirmar si el modelo dice lo contrario.
- **Código postal:** solo si consta en el **origen** (registro importado). No se deduce de la calle ni del municipio. Con el demo de Medina, que no tiene CP, el filtro aparece deshabilitado.

## 4. Pestañas

| Pestaña | Contenido |
|---|---|
| **Resumen** (bloque 2) | **Primera pantalla a 1365 × 768:** cinco indicadores, el mapa territorial y los cuatro rankings.<br>• **Tira de 5 KPI:** establecimientos observados (locales físicos y sin local), tasa de ocupación (con medidor), locales vacíos, negocios y franquicias (Sí entre Sí/No).<br>• **Mapa territorial** (7 columnas), con capas Ocupación · Comercio · Servicios · Hostelería · Vacíos:<br>  – **puntos** por establecimiento solo si sus locales tienen **coordenadas verificadas** (`LocalFisico.coordVerificada`);<br>  – si no, **agregados por calle** sobre la geometría del callejero: color = % de la calle con cortes por **cuantiles** (solo calles con al menos 5 observados), grosor = establecimientos, etiquetas selectivas sin solaparse;<br>  – **sin geometría**: **matriz territorial calle × sector** (12 calles con más observados; cifra y % por celda, color por cuantiles de cada columna). Nunca un histograma presentado como mapa.<br>• **Cuatro rankings simultáneos** (top 5): comercio, servicios, hostelería y restauración, locales vacíos.<br>• **Selección vinculada:** pasar el cursor o pulsar una calle la resalta a la vez en el mapa (o la matriz) y en los cuatro rankings; la calle fijada muestra su composición y «Filtrar por esta calle».<br>• El mapa y los rankings **no aplican** los filtros de sector ni franquicia (comparan los cuatro grupos; los vacíos no tienen ninguno de los dos) y lo indican; sí el CP y la calle.<br>• **Distribución sectorial** sin gráficos repetidos: una barra con todos los grupos sobre una sola base (observados) y una tabla con % observados, % ocupados, franquicia, web y Google; pulsar un sector filtra.<br>• **Datos destacados** calculados y **Cómo leer estas cifras**. |
| **Comercio / Servicios / Hostelería** | • KPI: establecimientos, peso en ocupados, peso en observados, franquicias, web y Google.<br>• Subgrupos y actividades más frecuentes.<br>• Calles con más establecimientos del sector (recuento absoluto; «% de la calle» solo con 5 observados).<br>• **Concentración y lectura:** % del sector en sus 5 calles principales y hallazgos frente a los demás sectores.<br>• **Comparación con los otros sectores** (tabla con el sector resaltado).<br>• Franquicia y fuente de la clasificación.<br>• Por código postal, si hay CP. |
| **Locales vacíos** | Los filtros de **sector y franquicia no se aplican** (un local vacío no tiene ninguno de los dos); un aviso lo explica y ofrece «Quitar estos filtros».<br>• KPI: vacíos, tasa de vacío, fachada media, calles con vacíos, concentración y CP con más vacíos (o calle con mayor tasa).<br>• Calles con más vacíos\*.<br>• Histograma de fachada.<br>• Calles según su tasa de vacío.<br>• Vacíos por CP (con la relación vacíos/total por calle) o, sin CP, la relación vacíos/total en las calles con más locales.<br>• Mapa de tasa de vacío por calle si hay geometría. |
| **Digitalización 1** (presencia) | • Adopción de cada canal (web, Google, venta online, Instagram, Facebook, X) con denominador y pendientes.<br>• Estado de la revisión digital y completitud de las respuestas.<br>• Respuestas por canal (barras apiladas).<br>• **Tablas de calor** de adopción por sector, por franquicia y por CP.<br>• Mapa de calor por calle y mapa por calle (si hay geometría). |
| **Digitalización 2** (intensidad) | • KPI: Google Business, mediana de reseñas, respuesta a reseñas, seguidores de Instagram, índice de presencia y su cobertura.<br>• Histograma de reseñas; respuesta a reseñas (también por sector).<br>• Seguidores por red con **diagrama de caja** (P25–P75, mediana).<br>• Índice de presencia (0–6).<br>• Comparativas por sector y por franquicia (medianas e índice solo con 10 casos).<br>• **Lectura ejecutiva** calculada. |
| **Cobertura y calidad** | • KPI: registros censales, observados, sin establecimiento, con incidencias, pendientes de visita y calles con registros.<br>• **Trazabilidad:** filas importadas → excluidas → con establecimiento → observados → con local → sin local.<br>• Correspondencias registro–local, con su definición.<br>• **Estado del dato:** clasificación, franquicia, revisión digital y localización. |
| **Comparar** | Dos campañas cualesquiera (años o ámbitos), con los mismos filtros. La campaña secundaria se revalida al cambiar la principal: nunca es la misma y, si la elegida pasa a ser la principal o deja de existir, se elige otra y se avisa.<br>• Avisos automáticos (cobertura, histórico frente a campaña, fuentes de clasificación, campaña incompleta).<br>• **Ámbitos territoriales distintos:** la comparación es solo descriptiva. Las cifras se muestran lado a lado con sus denominadores, con un aviso, y **no se calculan diferencias** (ni en los KPI ni en la tabla).<br>• Con el mismo ámbito, KPI emparejados con la diferencia aritmética.<br>• Peso de cada sector y adopción digital en barras emparejadas.<br>• Tabla completa.<br>Siempre indica que **las diferencias no son aperturas ni cierres confirmados**. |

## 5. Criterios estadísticos

- **Calles más ocupadas o con más vacíos:** solo calles con **al menos 5 establecimientos observados** (`UMBRAL_CALLE`).
  - Con menos de 5, un porcentaje cambia 20 puntos o más por un solo local: no es fiable.
  - El título lleva un **asterisco** y la nota indica cuántas calles se consideran sobre el total.
  - Los rankings por sector usan recuento absoluto, sin porcentajes.
- **Mapa de calor:** una celda solo se colorea con **al menos 3 respuestas Sí/No** (`MIN_CELDA`); si no, «—».
- **Comparaciones por grupo:** solo grupos con **al menos 10** casos (`MIN_GRUPO`); si no, «datos insuficientes».
- **Índice de presencia digital (0–6):**
  - cuenta los canales con Sí entre web, Google, venta online, Instagram, Facebook y Twitter / X;
  - **solo** se calcula si los seis tienen respuesta Sí/No, y se indica cuántos ocupados lo tienen completo;
  - un pendiente nunca cuenta como «No».
- **Medianas y cuartiles** en reseñas y seguidores, que son distribuciones muy asimétricas.

## 6. Mapas, ámbitos e identificadores

- **No se inventan coordenadas.**
  - Un establecimiento solo se dibuja como **punto** si su local tiene **coordenadas verificadas** (`coordVerificada`: GPS de campo, catastro o comprobación manual, con fecha). Las coordenadas interpoladas sobre la calle de la demostración **no** cuentan: hoy ningún dato de demostración tiene coordenadas verificadas, así que el mapa del Resumen muestra agregados por calle (la vista de puntos está probada con datos de prueba).
  - El **mapa por calle** colorea la **geometría del callejero** con el valor agregado de sus establecimientos. Se usa en las campañas del demo de Medina (callejero simulado u OSM).
  - Si las calles no tienen geometría fiable, como las vías ficticias del escenario, no se dibuja ningún mapa: el Resumen muestra la **matriz territorial calle × sector** y Digitalización 1, el **mapa de calor por calle**, en tabla.
- **Ámbitos:** el modelo distingue municipio, barrio, eje comercial, zona de estudio y mercado municipal (`Municipio.ambito`, campo opcional, sin migración).
  - Solo hay datos de municipios.
  - Los demás tipos aparecen deshabilitados como «(sin datos)».
  - Comparar ámbitos distintos genera un aviso.
- **Escudos:** solo se mostrarían escudos o imágenes con **fuente y licencia verificadas** (registro `EMBLEMAS`).
  - Por ahora el registro está vacío: no se ha verificado ninguno y no se ha descargado ninguna imagen.
  - Se muestra un **identificador neutro** con las iniciales, con la aclaración «sin escudo verificado».
  - Para añadir uno: incorporarlo al repositorio junto con su fuente y su licencia, por ejemplo una ficha de Wikimedia Commons revisada, y registrarlo en `EMBLEMAS`.

## 7. Aislamiento del escenario ficticio

- El escenario de C1d-A vive en su propio municipio y no altera Medina ni Valladolid (prueba: las unidades de sus campañas son idénticas antes y después).
- Desde la etapa 1 del asistente, **«Reiniciar escenario»** lo elimina por completo.

## 8. Ampliación futura

- **Indicadores:**
  - se definen en listas (`VARIABLES_PRESENCIA`, `RESPUESTAS`, `SECTORES`);
  - se calculan con funciones puras en `src/domain/panel.ts`: `datosCampana`, `filtrar`, `resumen`, `distribucion`, `topCalles`, `rankingCalles`, `concentracion`, `perfilGrupos`, `bandasVacancia`, `respuestas`, `adopcion`, `matrizCalor`, `estadisticos`, `histograma`, `indicePresencia`, `compararGrupos`.
- **Gráficos genéricos** (`graficos.tsx`): `Kpi`, `Bloque`, `Conmutador`, `BarrasH`, `Apilada`, `Anillo`, `Ranking`, `BarrasPareadas`, `Histograma`, `Caja`, `TablaCalor`, `MatrizCalor`, `MapaCalles`, `Hallazgos` y `SinDatos`. Todos tienen estado «sin datos» y muestran números absolutos y denominadores.
- **Añadir un canal digital o un sector** solo requiere añadirlo a la lista correspondiente.

## 9. Cómo probarlo en Codespaces

1. `npm ci` y `npm run dev`; abre el puerto **5173**.
2. Pulsa **Visualización** en la barra superior. Se abre con Medina del Campo y la campaña del contexto.
3. Cambia entre las pestañas **2026** y **2025**. En 2026 (en curso) muchas respuestas aparecen como «Pendiente»: es lo que hay en el demo, no un error.
4. **Para ver el histórico ficticio:**
   - incorpóralo con el asistente de C1d-A (Datos → Incorporación controlada → … → Incorporar al modelo);
   - vuelve a Visualización y elige el ámbito **«Medina del Campo (escenario ficticio)»**.
5. **Prueba lo siguiente:**
   - en **Resumen** (campaña 2025 de Medina): cambia la capa del mapa (Ocupación, Comercio, Servicios, Hostelería, Vacíos); pulsa una calle en el mapa o en un ranking y comprueba que se resalta en el mapa y en los cuatro rankings; «Filtrar por esta calle» la aplica a todo el cuadro; «Limpiar filtros» lo quita todo;
   - en el **escenario ficticio** (sin geometría), el Resumen muestra la matriz calle × sector, vinculada a los rankings;
   - pulsa un sector en la tabla de «Distribución sectorial», que filtra todo; el mapa y los rankings indican que no aplican ese filtro;
   - **Franquicia: Sí** cambia el contador, por ejemplo «58 de 860» en el escenario;
   - **Locales vacíos:** CP 47400 y 47001, que solo existen en el escenario; con un filtro de sector o franquicia activo aparece el aviso de que no se aplican;
   - **Digitalización 1:** estado «Borrador o importada»; en el escenario no hay mapa por calle porque no tiene geometría; en las campañas de Medina sí;
   - **Comparar:** elige otra campaña y lee los avisos de comparabilidad; después pulsa en la pestaña de año de esa misma campaña y comprueba el aviso de cambio de selección.

## 10. Pruebas

| Archivo | Pruebas | Qué cubre |
|---|---:|---|
| `src/domain/panel.test.ts` | 15 | Origen real de los datos (tipo de campaña frente a origen de clasificación, franquicia y digital); solo coordenadas verificadas; cortes por cuantiles; coherencia entre composición por calle e indicadores con y sin filtros; medidas distintas; incidencias conservadas; ranking de calles (umbral, recuento por sector, composición); concentración; perfil por grupo con Sí entre Sí/No; calles por tasa de vacío; registros sin establecimiento con observaciones manuales en la misma campaña (sin resta ni negativos); clasificación histórica sin convertir; CP solo del origen; coincidencia con Oficina; sin contaminación; umbral de calles; denominadores y adopción; mapa de calor con mínimo; índice de presencia y grupos insuficientes; filtros |
| `src/workspaces/visualizacion/visualizacion.test.tsx` | 11 | Resumen: cinco indicadores, distribución sin gráficos repetidos, matriz calle × sector sin geometría, cuatro rankings simultáneos, selección vinculada matriz/mapa ↔ rankings, filtros no aplicados con aviso, mapa por calle con capas y escala, ficha de la calle y «Filtrar por esta calle», puntos solo con coordenadas verificadas; aviso de origen calculado; Comparar entre ámbitos distintos sin diferencias; ámbito, año y emblema neutro; tipos sin datos deshabilitados; CP deshabilitado sin datos; aviso del histórico e indicadores; filtros vinculados; vacíos con CP; estado digital importado; sin geometría inventada; mapa por calle con geometría; comparar con avisos; cambio del año principal con Comparar abierta; vacíos con filtros de sector y franquicia; rediseño (criterio del ranking, perfil de sectores, KPI y comparación sectorial, filtro de calle y «Limpiar filtros», trazabilidad de calidad) |

## 11. Limitaciones conocidas

- El demo de 2026 tiene pocas clasificaciones y pocas revisiones digitales, así que muchas cifras salen como «Sin clasificar» o «Pendiente». Es fiel a los datos.
- No hay barrios, ejes comerciales, zonas de estudio ni mercados en los datos de demostración.
- No se muestra ningún escudo hasta disponer de fuentes y licencias verificadas.
