# C1d-B · Dashboard estadístico y visualización

> **Alcance:** un dashboard sobre los datos del modelo, con datos ficticios.
> - Ninguna cifra se introduce a mano ni se inventa.
> - No se han empezado C2 ni C3.
> - La incorporación (C1d-A) se documenta en `C1D-A-INCORPORACION.md`.

## 1. Dónde está

Nuevo espacio **Visualización** en la barra superior (ruta `#/visualizacion`).

- **Cabecera:**
  - **identificador del ámbito** (sección 6);
  - nombre y tipo de ámbito, con la etiqueta «escenario ficticio» si procede;
  - selectores **Tipo de ámbito** y **Ámbito**.
- **Pestañas globales de año:** una por campaña del ámbito, con su estado (histórico, en curso o campaña cerrada).
- **Filtros globales:** se aplican a todas las pestañas.
  - **Franquicia:** todos · Sí · No · pendiente o sin dato.
  - **Sector:** fijo en las pestañas de sector.
  - **Código postal:** solo si los datos lo traen.
  - **Calle:** se activa pulsando una calle en las tablas o barras.

  El contador indica «N de M establecimientos observados».
- **Pestañas:** Resumen · Comercio · Servicios · Hostelería y restauración · Locales vacíos · Digitalización 1 · Digitalización 2 · Cobertura y calidad · Comparar.

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
- 860 establecimientos observados, de ellos 18 sin local;
- 842 locales;
- 620 negocios;
- 240 vacíos;
- 890 correspondencias pendientes: 842 probables, 16 dudosas y 32 sin vínculo.

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
- **Histórico importado:** un aviso fijo recuerda que es una **referencia, no verificada para 2026**.
- **Código postal:** solo si consta en el **origen** (registro importado). No se deduce de la calle ni del municipio. Con el demo de Medina, que no tiene CP, el filtro aparece deshabilitado.

## 4. Pestañas

| Pestaña | Contenido |
|---|---|
| **Resumen** | Indicadores con denominador:<br>• registros, establecimientos, locales, negocios y vacíos;<br>• ocupación;<br>• franquicias Sí entre Sí/No, con las pendientes;<br>• correspondencias pendientes.<br>Gráficos y tablas:<br>• distribución por sector (pulsar una barra filtra) y fuente de la clasificación;<br>• **calles con más locales ocupados\***;<br>• datos destacados calculados (calle con más ocupados, sector mayoritario, adopción de web, fachada media);<br>• periodo de observación;<br>• ocupados frente a vacíos. |
| **Comercio / Servicios / Hostelería** | • establecimientos del sector y su peso entre los ocupados;<br>• franquicias;<br>• adopción de web, Google y venta online;<br>• subdivisiones: grupo de comercio y subgrupo, o subgrupo y actividad;<br>• calles con más establecimientos del sector (recuento absoluto);<br>• fuente de la clasificación. |
| **Locales vacíos** | Los filtros de **sector y franquicia no se aplican** en esta pestaña, porque un local vacío no tiene ni sector ni franquicia y filtrar por ellos daría siempre cero vacíos. Un aviso lo explica y ofrece «Quitar estos filtros»; en las demás pestañas siguen activos.<br>• número y proporción;<br>• fachada media, mediana y rango, con cuántos tienen medida;<br>• histograma de fachada;<br>• **calles con más vacíos\***;<br>• vacíos por CP, con el CP con más vacíos y el de mayor proporción, solo con al menos 5 observados. |
| **Digitalización 1** (presencia y adopción) | • estado de la revisión digital;<br>• por canal (web, Google, venta online, Instagram, Facebook, Twitter / X): barra apilada de las cinco respuestas y adopción;<br>• **mapa de calor calle × canal**;<br>• **mapa por calle**. |
| **Digitalización 2** (intensidad) | • reseñas de Google (mediana, P25–P75, máximo, histograma);<br>• respuesta a reseñas entre quienes tienen Google;<br>• seguidores por red (mediana y cuartiles);<br>• **índice de presencia digital (0–6)**;<br>• comparación por sector y por franquicia, solo con grupos suficientes. |
| **Cobertura y calidad** | • calles con registros frente al ámbito;<br>• pendientes de visita;<br>• sin local identificado;<br>• registros sin establecimiento observado (cálculo directo, nunca negativo);<br>• correspondencias por confianza;<br>• fuentes de clasificación y de franquicia. |
| **Comparar** | Dos campañas cualesquiera, en paralelo y con los mismos filtros. La campaña secundaria se revalida al cambiar la principal: nunca es la misma y, si la elegida pasa a ser la principal o deja de existir, se elige otra y se avisa. Avisos automáticos:<br>• ámbitos geográficos distintos;<br>• cobertura distinta;<br>• histórico frente a campaña;<br>• fuentes de clasificación distintas;<br>• campaña incompleta.<br>Siempre indica que **las diferencias no son aperturas ni cierres confirmados**. |

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
  - El **mapa por calle** colorea la **geometría del callejero** con el valor agregado de sus establecimientos. Se usa en las campañas del demo de Medina (callejero simulado u OSM).
  - Si las calles no tienen geometría fiable, como las vías ficticias del escenario, se muestra un aviso y la alternativa es el **mapa de calor por calle**, en tabla.
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
  - se calculan con funciones puras en `src/domain/panel.ts`: `datosCampana`, `filtrar`, `resumen`, `distribucion`, `topCalles`, `respuestas`, `adopcion`, `matrizCalor`, `estadisticos`, `histograma`, `indicePresencia`, `compararGrupos`.
- **Gráficos genéricos** (`graficos.tsx`): `BarrasH`, `Apilada`, `Histograma`, `MatrizCalor`, `MapaCalles`, `Kpi` y `SinDatos`. Todos tienen estado «sin datos» y muestran números absolutos.
- **Añadir un canal digital o un sector** solo requiere añadirlo a la lista correspondiente.

## 9. Cómo probarlo en Codespaces

1. `npm ci` y `npm run dev`; abre el puerto **5173**.
2. Pulsa **Visualización** en la barra superior. Se abre con Medina del Campo y la campaña del contexto.
3. Cambia entre las pestañas **2026** y **2025**. En 2026 (en curso) muchas respuestas aparecen como «Pendiente»: es lo que hay en el demo, no un error.
4. **Para ver el histórico ficticio:**
   - incorpóralo con el asistente de C1d-A (Datos → Incorporación controlada → … → Incorporar al modelo);
   - vuelve a Visualización y elige el ámbito **«Medina del Campo (escenario ficticio)»**.
5. **Prueba lo siguiente:**
   - en **Resumen**, pulsa una barra de sector, que filtra todo, y una calle de la tabla, que añade el filtro de calle; se quita con la ✕;
   - **Franquicia: Sí** cambia el contador, por ejemplo «58 de 860» en el escenario;
   - **Locales vacíos:** CP 47400 y 47001, que solo existen en el escenario; con un filtro de sector o franquicia activo aparece el aviso de que no se aplican;
   - **Digitalización 1:** estado «Borrador o importada»; en el escenario no hay mapa por calle porque no tiene geometría; en las campañas de Medina sí;
   - **Comparar:** elige otra campaña y lee los avisos de comparabilidad; después pulsa en la pestaña de año de esa misma campaña y comprueba el aviso de cambio de selección.

## 10. Pruebas

| Archivo | Pruebas | Qué cubre |
|---|---:|---|
| `src/domain/panel.test.ts` | 9 | Medidas distintas; registros sin establecimiento con observaciones manuales en la misma campaña (sin resta ni negativos); clasificación histórica sin convertir; CP solo del origen; coincidencia con Oficina; sin contaminación; umbral de calles; denominadores y adopción; mapa de calor con mínimo; índice de presencia y grupos insuficientes; filtros |
| `src/workspaces/visualizacion/visualizacion.test.tsx` | 6 | Ámbito, año y emblema neutro; tipos sin datos deshabilitados; CP deshabilitado sin datos; aviso del histórico e indicadores; filtros vinculados; vacíos con CP; estado digital importado; sin geometría inventada; mapa por calle con geometría; comparar con avisos; cambio del año principal con Comparar abierta; vacíos con filtros de sector y franquicia |

## 11. Limitaciones conocidas

- El demo de 2026 tiene pocas clasificaciones y pocas revisiones digitales, así que muchas cifras salen como «Sin clasificar» o «Pendiente». Es fiel a los datos.
- No hay barrios, ejes comerciales, zonas de estudio ni mercados en los datos de demostración.
- No se muestra ningún escudo hasta disponer de fuentes y licencias verificadas.
